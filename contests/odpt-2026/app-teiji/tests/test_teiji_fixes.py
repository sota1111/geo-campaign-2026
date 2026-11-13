"""アグレッサー指摘（R1〜R3・W2〜W6）への修正の追加テスト。全て合成データ。ネットワークは使わない。"""
import datetime as dt
import json
import random
import tempfile
import unittest
from pathlib import Path

from helpers import APP, BASE, DAY, LAT0, LON0, M_PER_DEG_LON, drive, make_line_schedule
from test_aggressor_teiji import SRC, drive_path, ll, path_schedule, vrec
from teiji import build, delay


class TestStopArrivalAndDeparture(unittest.TestCase):
    def test_dwell_gives_arrival_and_departure_separately(self):
        # 各停留所で 120 秒停車（着→発）。着の遅れは時刻表の着と、発の遅れは発と比べる。定刻なら両方とも 0 付近。
        sched, _ = make_line_schedule(n_stops=4, starts=(8 * 3600,), run_s=300, dwell=120)
        trip = sched["trips"][f"T{8 * 3600}"]
        obs, t = [], 8 * 3600
        for i in range(4):
            x = i * 1000.0
            if i > 0:
                obs += [(BASE + t + k, LAT0, LON0 + x / M_PER_DEG_LON) for k in range(0, 121, 10)]
            if i == 3:
                break
            obs += [(BASE + t + 120 + k, LAT0, LON0 + (x + 1000.0 * k / 180) / M_PER_DEG_LON) for k in range(0, 180, 10)]
            t += 300
        out = delay.estimate_trip(trip, sched["stops"], DAY, obs)
        mid = [e for e in out if e["pos"] in (1, 2)]
        self.assertEqual(len(mid), 2)
        for e in mid:
            self.assertIsNotNone(e["arr_delay_s"])
            self.assertAlmostEqual(e["arr_delay_s"], 0, delta=20)
            self.assertAlmostEqual(e["delay_s"], 0, delta=20)
            self.assertAlmostEqual(e["actual"] - e["arr_actual"], 120, delta=30)

    def test_vehicle_still_waiting_at_terminal_stop_of_path_gives_no_departure(self):
        # 始発で待機したまま観測が終わる（発車が観測できていない）ときは、始発の遅れを出さない。
        sched, _ = make_line_schedule(n_stops=4, starts=(8 * 3600,), run_s=300)
        trip = sched["trips"][f"T{8 * 3600}"]
        obs = [(BASE + 8 * 3600 - 900 + k * 30, LAT0, LON0) for k in range(40)]
        self.assertEqual(delay.estimate_trip(trip, sched["stops"], DAY, obs), [])


class TestLoopRobustness(unittest.TestCase):
    def test_loop_with_gps_noise_and_layover(self):
        # ループ線（600m 四方）、始発の 5m 手前で待機、GPS 誤差 σ=5m を 50 回。外れ（30 秒超）は 5% 未満、途中停留所はほぼ毎回出る。
        sq = [(0, 0), (600, 0), (600, 600), (0, 600), (0, 0)]
        s = path_schedule(sq, ["A", "B", "C", "D", "A"])
        wrong = total = 0
        for seed in range(50):
            rnd = random.Random(seed)
            lay = [(BASE + 8 * 3600 - 300 + k * 30,) + ll(rnd.gauss(0, 5), 5 + rnd.gauss(0, 5)) for k in range(10)]
            run = drive_path(sq, 180, 8 * 3600, 60, jitter=lambda t, x, y: (x + rnd.gauss(0, 5), y + rnd.gauss(0, 5)))
            out = delay.estimate_trip(s["trips"]["T1"], s["stops"], DAY, lay + run)
            mids = [e for e in out if 0 < e["pos"] < 4]
            total += 3
            wrong += 3 - len(mids)
            wrong += sum(abs(e["delay_s"] - 60) > 30 for e in mids)
        self.assertLess(wrong / total, 0.05, f"{wrong}/{total}")


class TestOperatingDay(unittest.TestCase):
    def test_late_night_observation_goes_to_previous_day(self):
        # 24:30 始発の便を翌 0:40 に観測 → 前日の運行日。
        sched, _ = make_line_schedule(starts=(24 * 3600 + 1800,))
        tr = sched["trips"][f"T{24 * 3600 + 1800}"]
        t = BASE + 86400 + 40 * 60
        self.assertEqual(delay.op_day(tr, t), dt.date(2026, 11, 18))

    def test_unknown_trip_late_night_is_previous_day_and_daytime_is_same_day(self):
        self.assertEqual(delay.op_day(None, BASE + 86400 + 3600), dt.date(2026, 11, 18))
        self.assertEqual(delay.op_day(None, BASE + 86400 + 10 * 3600), dt.date(2026, 11, 19))

    def test_days_are_streamed_in_order_and_early_days_leave_memory(self):
        # 6 日分。最初の日は、4 日目の記録を読む前に確定して返る（全部を読み終えるのを待たない）。
        sched, _ = make_line_schedule()
        recs = []
        for d in range(6):
            recs += [vrec(t + d * 86400, "V1", f"T{8 * 3600}", None, lat, lon) for t, lat, lon in drive(8 * 3600, 6, 300, 1000, 60)]
        consumed = []

        def gen():
            for r in recs:
                consumed.append(r)
                yield r
        it = delay.estimate_days(gen(), sched)
        day, rows, _ = next(it)
        self.assertEqual(day, dt.date(2026, 11, 18))
        self.assertTrue(rows)
        self.assertLess(len(consumed), len(recs) * 0.7)
        rest = [d for d, _, _ in it]
        self.assertEqual(rest, [dt.date(2026, 11, 19 + k) for k in range(5)])


class TestPublicFiles(unittest.TestCase):
    def test_public_json_has_no_pass_fail_label_or_reason(self):
        from test_aggressor_teiji import STARTS8, recs_for
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        pub, _, agg = build.build_operator(SRC, recs_for(STARTS8, 0), sched, DAY)
        s = json.dumps(pub, ensure_ascii=False)
        for bad in ("不通過", "verdict_reason", "通過"):
            self.assertNotIn(bad, s)
        self.assertIn(agg["quality_detail"]["verdict"], ("不通過", "判定不能"))   # 詳細は agg（out/ に書く）にだけある

    def test_quality_detail_is_written_only_under_out(self):
        from test_aggressor_teiji import STARTS8, recs_for
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        pub, rows, agg = build.build_operator(SRC, recs_for(STARTS8, 0), sched, DAY)
        with tempfile.TemporaryDirectory() as d:
            build.write_detail(Path(d), pub, rows, agg, sched)
            q = json.loads((Path(d) / "quality.json").read_text(encoding="utf-8"))
            self.assertIn("verdict", q)
            self.assertTrue((Path(d) / "stops.csv").exists())

    def test_sink_streaming_returns_no_rows_but_same_counts(self):
        from test_aggressor_teiji import STARTS8, recs_for
        sched, _ = make_line_schedule(starts=tuple(STARTS8))
        recs = recs_for(STARTS8, 0)
        pub1, rows1, agg1 = build.build_operator(SRC, recs, sched, DAY)

        class Sink:
            n = 0

            def add(self, rs):
                self.n += len(rs)
        sk = Sink()
        pub2, rows2, agg2 = build.build_operator(SRC, recs, sched, DAY, sink=sk)
        self.assertEqual(rows2, [])
        self.assertEqual(sk.n, len(rows1))
        self.assertEqual(pub1["routes"], pub2["routes"])

    def test_segments_only_for_enough_routes(self):
        from test_aggressor_teiji import STARTS8, recs_for
        starts = [10 * 3600 + k * 600 for k in range(12)]
        sched, _ = make_line_schedule(starts=tuple(starts))
        pub, _, _ = build.build_operator(SRC, recs_for(starts, 400), sched, DAY)
        self.assertTrue(pub["segments"])
        self.assertEqual(pub["stops"], [])
        self.assertTrue(all(r["enough"] for r in pub["routes"] if r["band"] == "day"))


class TestPage(unittest.TestCase):
    def test_notice_has_three_points_and_placeholder_and_no_unverified_accuracy(self):
        web = APP / "web"
        text = "".join((web / f).read_text(encoding="utf-8") for f in ("index.html", "app.js"))
        for need in ("公共交通オープンデータセンター", "保証されません", "問い合わせ先", "【総司令官記入】"):
            self.assertIn(need, text)
        self.assertNotIn("数十秒", text)
        self.assertNotIn("判定: <b>", text)


if __name__ == "__main__":
    unittest.main()
