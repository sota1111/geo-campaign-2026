import json
import random
import unittest

import kh  # noqa: F401
from kodure import build as kb
from kodure import router as rt
from kh import make_network
from lifemap.network import dist_m

LAT0, LON0 = 35.5000, 139.5000


def off_lat(m):
    return m / 110574.0


class TestRle(unittest.TestCase):
    def test_roundtrip(self):
        rng = random.Random(1)
        for _ in range(200):
            n = rng.randint(1, 80)
            row = bytearray(rng.choice([0, 0, 0, 0, rng.randint(1, 18)]) for _ in range(n))
            self.assertEqual(kb.rle_decode(kb.rle_row(row), n), row)

    def test_known(self):
        self.assertEqual(kb.rle_row(bytearray([0, 0, 0, 2, 0, 1])), "3B1A")
        self.assertEqual(kb.rle_row(bytearray(5)), "")
        self.assertEqual(kb.rle_row(bytearray([1, 18])), "AR")


def two_stop_network():
    stops = [("s0", "甲", LAT0, LON0), ("s1", "乙", LAT0 + 0.02, LON0), ("s2", "丙", LAT0 + 0.04, LON0)]
    trips = [("out", "r1", "ho", "0", [("s0", "09:10:00", "09:10:00"), ("s1", "09:30:00", "09:30:00")]),
             ("ret", "r1", "ho", "1", [("s1", "16:10:00", "16:10:00"), ("s0", "16:30:00", "16:30:00")]),
             # 乗継が要る便（乙→丙）と、乗継余裕が足りない便
             ("b", "r1", "ho", "0", [("s1", "09:40:00", "09:40:00"), ("s2", "10:00:00", "10:00:00")])]
    return make_network(stops, trips)


class TestComputeMatrices(unittest.TestCase):
    def setUp(self):
        self.net = two_stop_network()
        self.cell = (LAT0 + off_lat(200), LON0)             # 甲から約200m
        self.dest1 = (LAT0 + 0.02 + off_lat(100), LON0)     # 乙から約100m
        self.dest2 = (LAT0 + 0.04 + off_lat(100), LON0)     # 丙から約100m（乗継が要る）
        self.dest_near = (LAT0 + off_lat(500), LON0)        # 家から約300m（歩いて行ける距離）

    def run_mats(self, caps):
        return kb.compute_matrices(self.net, [self.cell], [self.dest1, self.dest2, self.dest_near], caps=caps,
                                   out_hours=(9,), ret_hours=(16,), workers=1, window_min=0)

    def test_outbound_duration_and_layers(self):
        mats = self.run_mats((300, 500))
        d_in = dist_m(*self.cell, LAT0, LON0)
        d_out = dist_m(LAT0 + 0.02, LON0, *self.dest1)
        want = (30 * 60 + rt.walk_seconds(d_out)) / 60.0       # 9:00 発 → 9:30 着 + 降車後の徒歩
        self.assertLessEqual(rt.walk_seconds(d_in), 600)
        code = mats[("o", 9, 300, 1)][0][0]
        self.assertEqual(code, rt.quant(want))
        # 乗換が要る丙へは、層1（乗換なし）では着けず、層2・3で着く（9:20乙着→9:40発は余裕300秒以上）
        self.assertEqual(mats[("o", 9, 300, 1)][1][0], 0)
        self.assertGreater(mats[("o", 9, 300, 2)][1][0], 0)
        self.assertEqual(mats[("o", 9, 300, 2)][1][0], mats[("o", 9, 300, 3)][1][0])

    def test_return_trip_uses_evening_service(self):
        mats = self.run_mats((300,))
        # 帰り: 乙の近く(行き先)を16:00に出て 16:10→16:30、甲から家へ徒歩
        d_in = dist_m(*self.dest1, LAT0 + 0.02, LON0)
        d_out = dist_m(LAT0, LON0, *self.cell)
        want = (30 * 60 + rt.walk_seconds(d_out)) / 60.0
        self.assertLessEqual(rt.walk_seconds(d_in), 600)
        self.assertEqual(mats[("r", 16, 300, 1)][0][0], rt.quant(want))
        # 丙の行き先からは帰りの便が無い
        self.assertEqual(mats[("r", 16, 300, 3)][1][0], 0)

    def test_walk_cap_blocks_boarding(self):
        # 家から甲まで約200m: 上限150m（選択肢外だが探索は任意の上限で動く）では乗れない
        mats = kb.compute_matrices(self.net, [self.cell], [self.dest1], caps=(150,), out_hours=(9,), ret_hours=(16,), workers=1, window_min=0)
        self.assertEqual(mats[("o", 9, 150, 3)][0][0], 0)

    def test_walk_only(self):
        mats = self.run_mats((500,))
        d = dist_m(*self.cell, *self.dest_near)
        self.assertLessEqual(d, 500)
        self.assertEqual(mats[("o", 9, 500, 1)][2][0], rt.quant(rt.walk_seconds(d) / 60.0))
        self.assertEqual(mats[("r", 16, 500, 1)][2][0], rt.quant(rt.walk_seconds(d) / 60.0))
        # 上限300mでは（約300m先なので）歩きだけでは着けない or 着ける: 距離で決まる
        mats3 = self.run_mats((300,))
        self.assertEqual(mats3[("o", 9, 300, 3)][2][0] > 0, d <= 300)

    def test_parallel_equals_serial(self):
        a = self.run_mats((300, 500))
        b = kb.compute_matrices(self.net, [self.cell], [self.dest1, self.dest2, self.dest_near], caps=(300, 500),
                                out_hours=(9,), ret_hours=(16,), workers=2, window_min=0)
        self.assertEqual(a, b)

    def test_larger_cap_never_slower(self):
        a = self.run_mats((300, 500))
        for d in range(3):
            lo, hi = a[("o", 9, 300, 3)][d][0], a[("o", 9, 500, 3)][d][0]
            self.assertTrue(lo == 0 and hi >= 0 or (hi > 0 and hi <= lo))


if __name__ == "__main__":
    unittest.main()
