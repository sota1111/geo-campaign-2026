import unittest

from helpers import drive, make_line_schedule
from teiji import aggregate, delay


def run_rows(starts, delays, run_actual=300, route="R1", obs_every=60):
    """starts の各便を、delays[i] 秒遅れ・停留所間 run_actual 秒で走らせた観測から推定行を作る。"""
    sched, _ = make_line_schedule(n_stops=6, starts=tuple(starts), run_s=300, route=route)
    recs = []
    for s0, d in zip(starts, delays):
        for t, lat, lon in drive(s0, 6, run_actual, 1000, d, obs_every=obs_every):
            recs.append({"t": int(t) + 3, "kind": "v", "ok": True, "ft": int(t),
                         "v": [[f"V{s0}", f"T{s0}", route, "20261118", lat, lon, int(t), None, None]]})
    rows, stats = delay.estimate_all(recs, sched)
    return rows, sched, stats


# 日中（9〜16時）に収まる 12 便、10分おき
STARTS = [10 * 3600 + k * 600 for k in range(12)]


class TestAggregate(unittest.TestCase):
    def test_ontime_rate(self):
        # 9 便は +60 秒（定時）、3 便は +400 秒（遅れ）
        delays = [60] * 9 + [400] * 3
        rows, sched, _ = run_rows(STARTS, delays)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertEqual(r["n_trips"], 12)
        self.assertTrue(r["enough"])
        self.assertAlmostEqual(r["ontime_pct"], 75.0, delta=1.0)
        self.assertAlmostEqual(r["late_pct"], 25.0, delta=1.0)
        self.assertEqual(r["early_pct"], 0.0)
        self.assertAlmostEqual(r["p90_delay_s"], 400, delta=5)
        d = next(x for x in agg["routes"] if x["band"] == "day")
        self.assertEqual(d["n_trips"], 12)
        self.assertEqual({x["band"] for x in agg["routes"]}, {"all", "day"})

    def test_boundaries(self):
        # 遅れ ちょうど +300 は定時、-60 も定時。+301 は遅れ、-61 は早発
        self.assertEqual(aggregate.delay_stats([300, -60])["ontime_pct"], 100.0)
        s = aggregate.delay_stats([301, -61])
        self.assertEqual((s["ontime_pct"], s["late_pct"], s["early_pct"]), (0.0, 50.0, 50.0))

    def test_insufficient_sample(self):
        rows, sched, _ = run_rows(STARTS[:3], [0, 0, 0])
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertEqual(r["n_trips"], 3)
        self.assertFalse(r["enough"])

    def test_segment_added_delay(self):
        # 停留所間を 360 秒で走る（時刻表は 300 秒）→ 各区間で +60 秒ずつ遅れが増える
        rows, sched, _ = run_rows(STARTS, [0] * 12, run_actual=360)
        agg = aggregate.aggregate(rows, sched)
        segs = [s for s in agg["segments"] if s["band"] == "all"]
        self.assertGreaterEqual(len(segs), 4)
        for s in segs:
            self.assertAlmostEqual(s["median_added_s"], 60, delta=4)
            self.assertEqual(s["sched_run_s"], 300)
            self.assertAlmostEqual(s["added_pct_of_run"], 20.0, delta=1.5)
        self.assertEqual([s["median_added_s"] for s in agg["segments"]], sorted([s["median_added_s"] for s in agg["segments"]], reverse=True))

    def test_bunching_detected(self):
        # 10分間隔の 12 便。奇数番の便が直前の便に追いつく（遅れ -500 → 実間隔 100 秒 < 25% の 150 秒）
        delays = [0 if k % 2 == 0 else -500 for k in range(12)]
        rows, sched, _ = run_rows(STARTS, delays)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertTrue(r["bunch_enough"])
        # 隣り合う 11 組のうち、偶数→奇数の組（6組）が団子。奇数→偶数の組は間隔 1100 秒で間延びではない（<2×600）
        self.assertAlmostEqual(r["bunch_pct"], 100.0 * 6 / 11, delta=3.0)
        self.assertEqual(r["gap_pct"], 0.0)

    def test_gap_detected(self):
        # 偶数番の便が 700 秒遅れ → 直前の便との間隔 1300 秒 > 2×600 → 間延び
        delays = [0 if k % 2 == 0 else 700 for k in range(12)]
        rows, sched, _ = run_rows(STARTS, delays)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        # 偶数→奇数の 6 組は間隔 1300 秒で間延び。奇数→偶数の 5 組は間隔 -100 秒（追い越し）で団子に数える
        self.assertAlmostEqual(r["gap_pct"], 100.0 * 6 / 11, delta=3.0)
        self.assertAlmostEqual(r["bunch_pct"], 100.0 * 5 / 11, delta=3.0)

    def test_no_bunching_when_regular(self):
        rows, sched, _ = run_rows(STARTS, [30] * 12)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertEqual(r["bunch_pct"], 0.0)
        self.assertEqual(r["gap_pct"], 0.0)

    def test_low_frequency_route_not_judged_for_bunching(self):
        # 本数が少ない（1時間おき = 3600 秒 > 1200 秒）路線は団子運転の対象にしない
        starts = [10 * 3600 + k * 3600 for k in range(6)]
        rows, sched, _ = run_rows(starts, [0] * 6)
        agg = aggregate.aggregate(rows, sched)
        r = next(x for x in agg["routes"] if x["band"] == "all")
        self.assertEqual(r["bunch_pairs"], 0)
        self.assertFalse(r["bunch_enough"])

    def test_band_of(self):
        from helpers import BASE
        self.assertEqual(aggregate.band_of(BASE + 6 * 3600), "morning")
        self.assertEqual(aggregate.band_of(BASE + 9 * 3600 - 1), "morning")
        self.assertEqual(aggregate.band_of(BASE + 9 * 3600), "day")
        self.assertEqual(aggregate.band_of(BASE + 16 * 3600), "evening")
        self.assertEqual(aggregate.band_of(BASE + 19 * 3600), "night")
        self.assertEqual(aggregate.band_of(BASE + 5 * 3600), "night")


if __name__ == "__main__":
    unittest.main()
