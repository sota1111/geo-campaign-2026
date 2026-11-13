import datetime as dt
import http.server
import json
import tempfile
import threading
import unittest
from pathlib import Path

from helpers import BASE, JST, drive, make_line_schedule
from teiji import ckan, collect, gtfsrt, quality

METHODS = []
PAYLOAD = {"body": b"", "status": 200}


class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        METHODS.append(("GET", self.headers.get("User-Agent")))
        self.send_response(PAYLOAD["status"])
        self.end_headers()
        self.wfile.write(PAYLOAD["body"])

    def do_POST(self):  # 呼ばれたら失敗させる
        METHODS.append(("POST", None))
        self.send_response(405)
        self.end_headers()

    def log_message(self, *a):
        pass


class TestCollect(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = http.server.HTTPServer(("127.0.0.1", 0), H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        METHODS.clear()
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = Path(self.tmp.name)
        self.src = [{"dataset": "dummy", "vehicle": f"http://127.0.0.1:{self.port}/v", "trip_update": f"http://127.0.0.1:{self.port}/u"}]

    def tearDown(self):
        self.tmp.cleanup()

    def lines(self):
        out = []
        for f in sorted((self.raw / "dummy").glob("*.jsonl")):
            out += [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines()]
        return out

    def test_get_only_and_saved(self):
        PAYLOAD.update(status=200, body=gtfsrt.build_vehicle_feed(1700000000, [
            {"id": "V1", "trip_id": "T1", "route_id": "R1", "start_date": "20261118", "lat": 35.0, "lon": 139.0, "timestamp": 1699999990}]))
        collect.run(self.src, 15, 0, True, self.raw, once=True)
        self.assertTrue(all(m[0] == "GET" for m in METHODS))
        self.assertEqual(len(METHODS), 2)  # vehicle と trip_update
        v = [r for r in self.lines() if r["kind"] == "v"][0]
        self.assertTrue(v["ok"])
        self.assertEqual(v["n"], 1)
        self.assertEqual(v["v"][0][0:4], ["V1", "T1", "R1", "20261118"])
        self.assertEqual(v["v"][0][6], 1699999990)

    def test_same_feed_time_not_stored_twice(self):
        PAYLOAD.update(status=200, body=gtfsrt.build_vehicle_feed(1700000000, [{"id": "V1", "trip_id": "T1", "lat": 35.0, "lon": 139.0}]))
        r1 = collect.snapshot(self.src[0]["vehicle"], "v", None)
        r2 = collect.snapshot(self.src[0]["vehicle"], "v", r1["ft"])
        self.assertIn("v", r1)
        self.assertEqual(r2.get("same"), 1)
        self.assertNotIn("v", r2)

    def test_http_error_is_recorded_not_raised(self):
        PAYLOAD.update(status=500, body=b"oops")
        r = collect.snapshot(self.src[0]["vehicle"], "v", None)
        self.assertFalse(r["ok"])
        self.assertIn("500", r["err"])

    def test_garbage_body_is_recorded(self):
        PAYLOAD.update(status=200, body=b"<html>not protobuf</html>")
        r = collect.snapshot(self.src[0]["vehicle"], "v", None)
        self.assertFalse(r["ok"])

    def test_duration_stops(self):
        PAYLOAD.update(status=200, body=gtfsrt.build_vehicle_feed(1700000000, []))
        n = collect.run(self.src, 15, 0, False, self.raw, once=False)
        self.assertEqual(n, 1)


def day_records(n_polls, vehicles_per_poll, hour=10, interval=60, same_ft_every=0):
    recs = []
    t0 = BASE + hour * 3600
    for k in range(n_polls):
        t = int(t0 + k * interval)
        rows = [[f"V{i}", f"T{i}", "R1", "20261118", 35.0, 139.0 + 0.001 * k, t - 5, None, None] for i in range(vehicles_per_poll)]
        recs.append({"t": t, "kind": "v", "ok": True, "ft": t - 2, "bytes": 100, "n": vehicles_per_poll, "v": rows})
    return recs


class TestQuality(unittest.TestCase):
    def setUp(self):
        starts = tuple(10 * 3600 + i * 600 for i in range(10))
        self.sched, _ = make_line_schedule(starts=starts)
        # 実際の trip_id は T<時刻>。day_records は T0.. を使うので、一致率のテストでは付け替える

    def test_night_is_undecidable(self):
        m = quality.measure_dataset(day_records(5, 0, hour=0), self.sched, DAY_)
        self.assertEqual(m["verdict"], "判定不能")
        self.assertEqual(m["vehicles_median"], 0)

    def test_daytime_pass(self):
        recs = day_records(20, 8, hour=10)
        for r in recs:
            for i, row in enumerate(r["v"]):
                row[1] = f"T{10 * 3600 + i * 600}"
        m = quality.measure_dataset(recs, self.sched, DAY_)
        self.assertEqual(m["verdict"], "通過", m["verdict_reason"])
        self.assertEqual(m["success_rate"], 100.0)
        self.assertEqual(m["vehicles_median_daytime"], 8)
        self.assertEqual(m["position_interval_s"], 60)
        self.assertEqual(m["trip_match_active_pct"], 100.0)

    def test_trip_id_mismatch_fails(self):
        m = quality.measure_dataset(day_records(20, 8, hour=10), self.sched, DAY_)  # T0.. は時刻表に無い
        self.assertEqual(m["verdict"], "不通過")
        self.assertIn("trip_id一致率", m["verdict_reason"])

    def test_few_vehicles_fails(self):
        recs = day_records(20, 2, hour=10)
        for r in recs:
            for i, row in enumerate(r["v"]):
                row[1] = f"T{10 * 3600 + i * 600}"
        m = quality.measure_dataset(recs, self.sched, DAY_)
        self.assertEqual(m["verdict"], "不通過")
        self.assertIn("車両数", m["verdict_reason"])

    def test_failed_polls_lower_success(self):
        recs = day_records(20, 8, hour=10)
        recs += [{"t": r["t"], "kind": "v", "ok": False, "err": "x"} for r in recs[:5]]
        m = quality.measure_dataset(recs, self.sched, DAY_)
        self.assertEqual(m["success_rate"], 80.0)
        self.assertEqual(m["verdict"], "不通過")

    def test_no_data(self):
        self.assertEqual(quality.measure_dataset([], None, None)["verdict"], "データなし")

    def test_trip_update_delay_share(self):
        recs = day_records(12, 8, hour=10)
        recs.append({"t": 1, "kind": "u", "ok": True, "n": 2, "u": [["A", "R", "20261118", 1, None, [[1, "S0", 30, None, None, None]]],
                                                                    ["B", "R", "20261118", 1, None, [[1, "S0", None, None, None, None]]]]})
        m = quality.measure_dataset(recs, self.sched, DAY_)
        self.assertEqual(m["tu_with_delay_pct"], 50.0)


DAY_ = dt.date(2026, 11, 18)


class TestCkan(unittest.TestCase):
    def test_classify(self):
        f = ckan.classify
        self.assertEqual(f("", "", "https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_X_Y_vehicle"), "VehiclePosition")
        self.assertEqual(f("", "", "https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_X_Y_trip_update"), "TripUpdate")
        self.assertEqual(f("", "", "https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_X_Y_alert"), "Alerts")
        self.assertEqual(f("", "", "https://api-public.odpt.org/api/v4/gtfs/realtime/ToeiBus"), "VehiclePosition")

    def test_usable_requires_ccby_and_no_token(self):
        res = [{"kind": "VehiclePosition", "url": "https://api-public.odpt.org/api/v4/gtfs/realtime/odpt_X_vehicle"},
               {"kind": "VehiclePosition", "url": "https://api.odpt.org/api/v4/gtfs/realtime/odpt_X_vehicle?acl:consumerKey=XXX"},
               {"kind": "VehiclePosition", "url": "https://api-challenge.odpt.org/api/v4/gtfs/realtime/odpt_X_vehicle"}]
        self.assertEqual(len(ckan.usable({"license": "Creative Commons Attribution 4.0 International (CC BY 4.0)", "resources": res})), 1)
        self.assertEqual(ckan.usable({"license": "公共交通オープンデータ基本ライセンス", "resources": res}), [])
        self.assertEqual(ckan.usable({"license": "", "resources": res}), [])

    def test_committed_sources_are_public_ccby(self):
        src = json.loads((Path(__file__).resolve().parent.parent / "data" / "sources.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(src), 10)
        for s in src:
            self.assertIn("CC BY 4.0", s["license"])
            for k in ("vehicle", "trip_update", "gtfs"):
                if s[k]:
                    self.assertTrue(s[k].startswith("https://api-public.odpt.org/"), s[k])
                    self.assertNotIn("consumerKey", s[k])


if __name__ == "__main__":
    unittest.main()
