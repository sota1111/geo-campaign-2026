import csv
import json
import tempfile
import unittest
from pathlib import Path

from helpers import DAY, drive, make_line_schedule
from teiji import build

STARTS = [10 * 3600 + k * 600 for k in range(12)]


def records(starts, delays):
    recs = []
    for s0, d in zip(starts, delays):
        for t, lat, lon in drive(s0, 6, 360, 1000, d):
            recs.append({"t": int(t) + 3, "kind": "v", "ok": True, "ft": int(t), "bytes": 1, "n": 1,
                         "v": [[f"V{s0}", f"T{s0}", "R1", "20261118", lat, lon, int(t), None, None]]})
    return recs


SRC = {"dataset": "demo_op", "name": "デモ交通", "page": "https://ckan.odpt.org/dataset/demo"}


class TestBuild(unittest.TestCase):
    def test_public_json_and_detail_csv(self):
        sched, _ = make_line_schedule(starts=tuple(STARTS))
        pub, rows, agg = build.build_operator(SRC, records(STARTS, [0] * 12), sched, DAY)
        self.assertEqual(pub["license"], "CC BY 4.0")
        self.assertIn("CC BY 4.0", pub["credit"])
        self.assertIn("デモ交通", pub["credit"])
        self.assertEqual(pub["period"]["estimated_days"], ["2026-11-18"])
        r = next(x for x in pub["routes"] if x["band"] == "all")
        self.assertTrue(r["enough"])
        self.assertIn("ontime_pct", r)
        self.assertTrue(pub["segments"])
        json.dumps(pub)  # JSON にできる
        with tempfile.TemporaryDirectory() as d:
            build.write_detail(Path(d), pub, rows, agg, sched)
            for name in ("routes.csv", "segments.csv", "stops.csv", "trips.csv"):
                self.assertTrue((Path(d) / name).exists(), name)
            with (Path(d) / "trips.csv").open(encoding="utf-8-sig") as f:
                trips = list(csv.reader(f))
            self.assertEqual(trips[0][0:3], ["運行日", "trip_id", "route_id"])
            self.assertEqual(len(trips) - 1, len(rows))

    def test_insufficient_rows_have_no_numbers_in_public(self):
        sched, _ = make_line_schedule(starts=tuple(STARTS[:3]))
        pub, rows, agg = build.build_operator(SRC, records(STARTS[:3], [0] * 3), sched, DAY)
        r = next(x for x in pub["routes"] if x["band"] == "all")
        self.assertFalse(r["enough"])
        for k in ("ontime_pct", "late_pct", "median_delay_s", "p90_delay_s", "n_obs"):
            self.assertNotIn(k, r)

    def test_public_has_no_trip_level_detail(self):
        sched, _ = make_line_schedule(starts=tuple(STARTS))
        pub, rows, agg = build.build_operator(SRC, records(STARTS, [0] * 12), sched, DAY)
        s = json.dumps(pub, ensure_ascii=False)
        self.assertNotIn('"vehicle"', s)
        self.assertNotIn(f"T{STARTS[0]}", s)   # trip_id は公開しない
        self.assertNotIn("V" + str(STARTS[0]), s)  # 車両IDは公開しない

    def test_no_schedule_still_builds(self):
        pub, rows, agg = build.build_operator(SRC, records(STARTS[:2], [0, 0]), None, DAY)
        self.assertEqual(rows, [])
        self.assertEqual(pub["routes"], [])

    def test_no_ranking_keys(self):
        # 事業者を並べるための順位・得点の項目を作っていない
        sched, _ = make_line_schedule(starts=tuple(STARTS))
        pub, _, _ = build.build_operator(SRC, records(STARTS, [0] * 12), sched, DAY)
        s = json.dumps(pub).lower()
        for bad in ("rank", "score", "ranking"):
            self.assertNotIn(bad, s)


class TestWebFiles(unittest.TestCase):
    def test_web_has_no_operator_ranking_ui(self):
        web = Path(__file__).resolve().parent.parent / "web"
        text = "".join((web / f).read_text(encoding="utf-8") for f in ("index.html", "app.js") if (web / f).exists())
        self.assertIn("順位", text)  # 「順位は付けない」の注記がある
        for bad in ("sort(function(a, b) { return b.ontime", "ランキング"):
            self.assertNotIn(bad, text)

    def test_credit_on_page(self):
        web = Path(__file__).resolve().parent.parent / "web"
        text = (web / "index.html").read_text(encoding="utf-8") + (web / "app.js").read_text(encoding="utf-8")
        for need in ("CC BY 4.0", "公共交通オープンデータセンター", "地理院タイル"):
            self.assertIn(need, text)


if __name__ == "__main__":
    unittest.main()
