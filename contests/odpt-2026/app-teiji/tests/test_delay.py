import unittest

from helpers import BASE, DAY, drive, make_line_schedule
from teiji import delay


class TestDelay(unittest.TestCase):
    def setUp(self):
        self.sched, _ = make_line_schedule(n_stops=6, starts=(8 * 3600,), run_s=300)
        self.trip = self.sched["trips"][f"T{8 * 3600}"]

    def est(self, obs, **kw):
        return delay.estimate_trip(self.trip, self.sched["stops"], DAY, obs, **kw)

    def test_constant_delay_recovered(self):
        # 240秒遅れで一定速度、60秒おき観測
        out = self.est(drive(8 * 3600, 6, 300, 1000, 240))
        self.assertGreaterEqual(len(out), 5)
        for e in out:
            self.assertAlmostEqual(e["delay_s"], 240, delta=3)

    def test_early_is_negative(self):
        out = self.est(drive(8 * 3600, 6, 300, 1000, -90))
        self.assertTrue(out)
        for e in out:
            self.assertAlmostEqual(e["delay_s"], -90, delta=3)

    def test_delay_grows_along_route(self):
        # 区間ごとに +60秒ずつ遅れが増える（所要 360 秒で走る）
        obs = drive(8 * 3600, 6, 360, 1000, 0)
        out = self.est(obs)
        d = {e["pos"]: e["delay_s"] for e in out}
        for i in range(1, 6):
            if i in d and (i - 1) in d:
                self.assertAlmostEqual(d[i] - d[i - 1], 60, delta=4)

    def test_long_gap_not_estimated(self):
        # 観測が 600 秒おき → 停留所の通過は推定しない（既定の上限 300 秒）
        out = self.est(drive(8 * 3600, 6, 300, 1000, 0, obs_every=600))
        self.assertEqual(out, [])

    def test_gap_limit_is_a_parameter(self):
        out = self.est(drive(8 * 3600, 6, 300, 1000, 0, obs_every=600), max_gap_s=700)
        self.assertTrue(out)

    def test_off_route_points_dropped(self):
        # 路線から 500m 離れた観測は使わない
        out = self.est(drive(8 * 3600, 6, 300, 1000, 0, lateral_m=500))
        self.assertEqual(out, [])
        out = self.est(drive(8 * 3600, 6, 300, 1000, 0, lateral_m=60))
        self.assertTrue(out)

    def test_too_few_points(self):
        self.assertEqual(self.est([(BASE + 8 * 3600, 35.0, 139.0)]), [])
        self.assertEqual(self.est([]), [])

    def test_stationary_vehicle_not_misread(self):
        # 動かない車両（始発前の待機）: 同じ位置で 10 分 → 停留所 S0 以外は推定されない
        obs = [(BASE + 8 * 3600 + k * 60, 35.0, 139.0) for k in range(10)]
        out = self.est(obs)
        self.assertTrue(all(e["pos"] == 0 for e in out))

    def test_jitter_does_not_go_backwards(self):
        obs = drive(8 * 3600, 6, 300, 1000, 120)
        # 1点だけ後ろへ 30m 戻る（GPS の揺れ）
        t, lat, lon = obs[4]
        obs[4] = (t, lat, lon - 30 / 91000.0)
        out = self.est(obs)
        for a, b in zip(out, out[1:]):
            self.assertLessEqual(a["actual"], b["actual"])

    def test_estimate_all_uses_trip_id_and_start_date(self):
        rows = []
        for k, (t, lat, lon) in enumerate(drive(8 * 3600, 6, 300, 1000, 180)):
            rows.append({"t": int(t) + 5, "kind": "v", "ok": True, "ft": int(t),
                         "v": [["V1", f"T{8 * 3600}", "R1", "20261118", lat, lon, int(t), None, None]]})
            rows.append({"t": int(t) + 5, "kind": "v", "ok": True, "ft": int(t),
                         "v": [["V9", "UNKNOWN", "R1", "20261118", lat, lon, int(t), None, None]]})
        out, stats = delay.estimate_all(rows, self.sched)
        self.assertEqual(stats["trips_observed"], 2)
        self.assertEqual(stats["trips_matched"], 1)
        self.assertEqual(stats["trips_estimated"], 1)
        self.assertTrue(all(abs(r["delay_s"] - 180) < 4 for r in out))
        self.assertEqual({r["date"] for r in out}, {"2026-11-18"})

    def test_observations_outside_service_window_ignored(self):
        # 8時台の便を、夜中（前の運行の trip_id を出し続ける車庫の車両）に観測しても推定しない
        obs = drive(8 * 3600 - 12 * 3600, 6, 300, 1000, 0)
        self.assertEqual(self.est(obs), [])

    def test_absurd_delay_dropped(self):
        # 3時間ずれた観測（別の運行日の便など）は捨てる。窓を広げても 2 時間超の遅れは採用しない
        obs = drive(8 * 3600, 6, 300, 1000, 3 * 3600)
        self.assertEqual(self.est(obs), [])

    def test_day_resolved_without_start_date_for_after_midnight_trip(self):
        # 24:30 始発（翌日 0:30）の便。start_date が無くても、前日の運行として遅れ 120 秒と推定される
        sched, _ = make_line_schedule(starts=(24 * 3600 + 1800,))
        tid = f"T{24 * 3600 + 1800}"
        recs = []
        for t, lat, lon in drive(24 * 3600 + 1800, 6, 300, 1000, 120):
            recs.append({"t": int(t) + 2, "kind": "v", "ok": True, "ft": int(t),
                         "v": [["V1", tid, None, None, lat, lon, int(t), None, None]]})
        rows, stats = delay.estimate_all(recs, sched)
        self.assertEqual(stats["trips_estimated"], 1)
        self.assertEqual({r["date"] for r in rows}, {"2026-11-18"})
        self.assertTrue(all(abs(r["delay_s"] - 120) < 4 for r in rows))

    def test_trip_update_delays(self):
        recs = [{"t": 1, "kind": "u", "ok": True, "u": [["T1", "R1", "20261118", 1, None, [[1, "S1", 60, None, None, None]]]]},
                {"t": 2, "kind": "u", "ok": True, "u": [["T1", "R1", "20261118", 2, None, [[1, "S1", 90, None, None, None]]]]}]
        self.assertEqual(delay.trip_update_delays(recs), {("T1", "20261118", 1): 90})


if __name__ == "__main__":
    unittest.main()
