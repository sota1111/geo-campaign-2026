"""アグレッサー・デザイン審査（2026-11-14）の指摘を直した部分の検査: 徒歩乗換・出発時刻の幅（中央値）・行き先の入口（公園の外周）・最寄り停留所の距離。"""
import json
import math
import unittest

import kh  # noqa: F401
from kodure import build as kb
from kodure import dests as dm
from kodure import router as rt
from kh import make_network
from lifemap.network import dist_m

LAT0, LON0 = 35.5000, 139.5000


def off_lat(m):
    return m / 110574.0


def secs(h, m=0):
    return h * 3600 + m * 60


class TestWalkTransfer(unittest.TestCase):
    def two_lines(self, gap_m, b_dep):
        stops = [("s0", "出発", LAT0, LON0), ("a", "A駅", LAT0 + 0.01, LON0),
                 ("b", "B停留所", LAT0 + 0.01 + off_lat(gap_m), LON0), ("t", "到着", LAT0 + 0.03, LON0)]
        trips = [("t1", "r1", "ho", 0, [("s0", "10:00:00", "10:00:00"), ("a", "10:10:00", "10:10:00")]),
                 ("t2", "r2", "ho", 0, [("b", b_dep, b_dep), ("t", "10:50:00", "10:50:00")])]
        net = make_network(stops, trips, routes=(("r1", "1", "A線"), ("r2", "2", "B線")))
        node = {nm: i for i, (_la, _lo, nm) in enumerate(net.nodes)}
        return net, node

    def test_walk_time_and_margin_are_required(self):
        # 約250m = 徒歩 250*1.25/1m/s = 312秒 + 余裕300秒 → A着10:10 から 10:20:12 以降の便なら乗れる
        need = secs(10, 10) + rt.walk_seconds(250) + rt.TRANSFER_S
        self.assertTrue(secs(10, 20) < need < secs(10, 21))
        ok_net, ok_n = self.two_lines(250, "10:21:00")
        ng_net, ng_n = self.two_lines(250, "10:20:00")
        t0 = secs(10)
        _r, alight = rt.Router(ok_net).scan_full({ok_n["出発"]: t0}, t0)
        self.assertEqual(alight[1][ok_n["到着"]], secs(10, 50))
        _r, alight = rt.Router(ng_net).scan_full({ng_n["出発"]: t0}, t0)
        self.assertEqual(alight[2][ng_n["到着"]], rt.INF, "徒歩時間と乗継の余裕が足りない便には乗れない")

    def test_beyond_limit_is_not_connected(self):
        net, n = self.two_lines(rt.WALK_TRANSFER_M + 100, "11:00:00")
        t0 = secs(10)
        _r, alight = rt.Router(net).scan_full({n["出発"]: t0}, t0)
        self.assertEqual(alight[2][n["到着"]], rt.INF)
        # 徒歩乗換を無効にすると、近くても乗り継げない（比較用）
        net, n = self.two_lines(100, "10:30:00")
        _r, alight = rt.Router(net, walk_transfer_m=0).scan_full({n["出発"]: t0}, t0)
        self.assertEqual(alight[2][n["到着"]], rt.INF)
        _r, alight = rt.Router(net).scan_full({n["出発"]: t0}, t0)
        self.assertEqual(alight[1][n["到着"]], secs(10, 50))

    def test_walk_transfer_counts_as_a_transfer(self):
        net, n = self.two_lines(100, "10:30:00")
        t0 = secs(10)
        _r, alight = rt.Router(net).scan_full({n["出発"]: t0}, t0)
        self.assertEqual(alight[0][n["到着"]], rt.INF, "乗換なし（層1）では着けない")


class TestDepartureWindow(unittest.TestCase):
    def setUp(self):
        stops = [("s0", "甲", LAT0, LON0), ("s1", "乙", LAT0 + 0.02, LON0)]
        # 9:25 発の1便だけ（9:00〜9:30の幅の中に1本）。乗車20分
        trips = [("a", "r1", "ho", 0, [("s0", "09:25:00", "09:25:00"), ("s1", "09:45:00", "09:45:00")])]
        self.net = make_network(stops, trips)
        self.cell = (LAT0, LON0)
        self.dest = (LAT0 + 0.02, LON0)

    def code(self, hour, window_min):
        m = kb.compute_matrices(self.net, [self.cell], [self.dest], caps=(300,), out_hours=(hour,), ret_hours=(16,),
                                workers=1, window_min=window_min)
        return m[("o", hour, 300, 1)][0][0]

    def test_median_over_departures_in_window(self):
        # 出発 9:00,9:05,…,9:30 の7回。便は9:25発: 待ち 25,20,15,10,5,0 分 + 乗車20分、9:30出発は便を逃して着けない（INF）。
        # 昇順の4番目（中央値）= 待ち15分 + 乗車20分 = 35分 → 符号 7
        self.assertEqual(self.code(9, 30), 7)
        # 出発1点（9:00ちょうど）なら待ち25分 + 20分 = 45分 → 符号 9。幅で見ると値が変わる
        self.assertEqual(self.code(9, 0), 9)

    def test_window_starts(self):
        self.assertEqual(rt.window_starts(9, 0), [secs(9)])
        w = rt.window_starts(9)
        self.assertEqual((w[0], w[-1], len(w)), (secs(9), secs(9, 30), 7))

    def test_median_helper(self):
        inf = rt.INF
        self.assertEqual(rt.median_minutes([5, 7, 9, inf, inf, inf, inf]), inf)
        self.assertEqual(rt.median_minutes([30, 5, 20, 10, inf, 15, 25]), 20)

    def test_small_shift_changes_few_results(self):
        # 9:00 と 9:05 の幅で、同じ便なら符号が1段（5分）以内にしか動かない
        a, b = self.code(9, 30), self.code(9 + 5 / 60, 30)
        self.assertLessEqual(abs(a - b), 1)


class TestParkEntrance(unittest.TestCase):
    def test_ring_geometry(self):
        area = 400000   # 40ha
        r = dm.equivalent_radius_m(area)
        self.assertAlmostEqual(r, math.sqrt(area / math.pi), places=6)
        pts = dm.access_points(139.5, 35.5, "park_l", area)
        self.assertEqual(len(pts), 1 + dm.RING_POINTS)
        for la, lo in pts[1:]:
            self.assertAlmostEqual(dist_m(35.5, 139.5, la, lo), r, delta=1.0)

    def test_facilities_are_single_point(self):
        self.assertEqual(len(dm.access_points(139.5, 35.5, "zoo", 0)), 1)
        self.assertEqual(len(dm.access_points(139.5, 35.5, "museum", 0)), 1)

    def test_radius_is_capped(self):
        self.assertEqual(dm.equivalent_radius_m(10 ** 9), dm.RING_MAX_M)

    def test_large_park_reachable_through_its_edge(self):
        # 40ha の公園（等価半径約357m）。中心から約500m先に停留所がある: 中心点の判定では徒歩上限300mで乗れないが、
        # 外周の点なら約143m
        stops = [("s0", "出発", LAT0, LON0 + 0.08), ("p", "公園前", LAT0, LON0), ("t", "家", LAT0, LON0 + 0.081)]
        trips = [("a", "r1", "ho", 0, [("s0", "10:05:00", "10:05:00"), ("p", "10:20:00", "10:20:00")])]
        # 停留所 p は公園の中心から東へ約 500m
        stops[1] = ("p", "公園前", LAT0, LON0 + 500 / (111320.0 * math.cos(math.radians(LAT0))))
        net = make_network(stops, trips)
        center = (LAT0, LON0)
        home = (LAT0, LON0 + 0.08)
        only_center = kb.compute_matrices(net, [home], [center], caps=(300,), out_hours=(10,), ret_hours=(16,), workers=1, window_min=0)
        self.assertEqual(only_center[("o", 10, 300, 1)][0][0], 0)
        access_pts = [dm.access_points(LON0, LAT0, "park_l", 400000)]
        ring = kb.compute_matrices(net, [home], [center], caps=(300,), out_hours=(10,), ret_hours=(16,), workers=1,
                                   window_min=0, dest_access=access_pts)
        self.assertGreater(ring[("o", 10, 300, 1)][0][0], 0, "外周の入口の点なら乗った停留所から歩いて着ける")

    def test_dedupe_ignores_rounding_boundary(self):
        tol = 0.0003
        x = (463334 + 0.5) * tol
        a = (x - 0.00002, 35.0, "同じ館", "museum", 0, "")
        b = (x + 0.00002, 35.0, "同じ館", "museum", 0, "")
        c = (x + 0.01, 35.0, "同じ館", "museum", 0, "")
        self.assertEqual(len(dm.dedupe([a, b])), 1)
        self.assertEqual(len(dm.dedupe([a, c])), 2)

    def test_closed_facility_excluded(self):
        self.assertIn("逓信総合博物館", dm.CLOSED)


class TestGeneratedMeta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta = json.loads((kh.ROOT / "web" / "data" / "meta.json").read_text(encoding="utf-8"))

    def test_nearest_stop_distance_recorded(self):
        for d in self.meta["dests"]:
            self.assertEqual(len(d), 7, d)
            self.assertTrue(0 <= d[6] <= 2000, d)

    def test_params_describe_the_definitions(self):
        p = self.meta["params"]
        for k in ("window_min", "window_step_min", "walk_transfer_m", "ring_points"):
            self.assertIn(k, p)
        self.assertGreaterEqual(p["window_min"], 10)

    def test_closed_facility_not_listed(self):
        self.assertNotIn("逓信総合博物館", {d[2] for d in self.meta["dests"]})


if __name__ == "__main__":
    unittest.main()
