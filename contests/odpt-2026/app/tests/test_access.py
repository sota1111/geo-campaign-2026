import random
import unittest

from helpers import reference_levels, threshold_level
from lifemap import access
from lifemap.access import NEG, Grid, latest_departures, level_for, walk_seconds


def hms(h, m=0):
    return h * 3600 + m * 60


class TestWalk(unittest.TestCase):
    def test_walk_seconds(self):
        # 400m 直線 × 1.25 を 80m/分 → 6.25分
        self.assertAlmostEqual(walk_seconds(400) / 60, 6.25, places=6)

    def test_grid_within(self):
        pts = [(35.0, 135.0), (35.0045, 135.0), (35.02, 135.0)]  # 0m, 約498m, 約2.2km
        g = Grid(pts)
        got = {i for i, _ in g.within(35.0, 135.0, 500)}
        self.assertEqual(got, {0, 1})
        got = {i for i, _ in g.within(35.0, 135.0, 400)}
        self.assertEqual(got, {0})


class TestLatestDepartures(unittest.TestCase):
    # ノード 0 -(便A 8:00-8:20)-> 1 -(便B 8:25-8:45)-> 2, 便C は 0->2 を 9:00-9:30
    CONNS = None

    def setUp(self):
        rows = [
            (hms(8), hms(8, 20), 0, 1, 0),
            (hms(8, 25), hms(8, 45), 1, 2, 1),
            (hms(9), hms(9, 30), 0, 2, 2),
        ]
        self.conns = sorted(rows, key=lambda r: -r[0])

    def test_direct_and_transfer(self):
        ld = latest_departures(self.conns, 3, {2: hms(10)})
        self.assertEqual(ld[0], hms(9))       # 直行便Cが最遅
        self.assertEqual(ld[1], hms(8, 25))
        self.assertEqual(ld[2], NEG)          # 目的地自身から乗って着く便は無い

    def test_transfer_needs_buffer(self):
        # 便Aの到着 8:20、乗継は便B 8:25 発 → 5分 >= 3分 で可
        ld = latest_departures(self.conns, 3, {2: hms(8, 45)})
        self.assertEqual(ld[0], hms(8))
        # 乗継余裕が足りない（便B を 8:22 発にする）と不可
        rows = [(hms(8), hms(8, 20), 0, 1, 0), (hms(8, 22), hms(8, 45), 1, 2, 1)]
        ld = latest_departures(sorted(rows, key=lambda r: -r[0]), 3, {2: hms(8, 45)})
        self.assertEqual(ld[0], NEG)
        self.assertEqual(ld[1], hms(8, 22))

    def test_stay_on_same_trip_without_buffer(self):
        # 同一便での通過には乗継時間は不要（到着=次の出発の同時刻でも可）
        rows = [(hms(8), hms(8, 10), 0, 1, 7), (hms(8, 10), hms(8, 20), 1, 2, 7)]
        ld = latest_departures(sorted(rows, key=lambda r: (-r[0])), 3, {2: hms(8, 20)})
        self.assertEqual(ld[0], hms(8))

    def test_deadline_respected(self):
        ld = latest_departures(self.conns, 3, {2: hms(9, 29)})
        self.assertEqual(ld[0], hms(8))  # 9:30着の直行は間に合わない


class TestLevel(unittest.TestCase):
    def test_level_for(self):
        n = len(access.THRESHOLDS)
        # W=20,30,45,60 の ld。出発 t0=8:00、徒歩 5分
        t0 = hms(8)
        never = [NEG, NEG]
        ok = [hms(8, 10), 0]
        # 60分でのみ到達可 → 水準1
        lds = [never, never, never, ok]
        self.assertEqual(level_for(lds, [(0, 300)], t0), 1)
        # 全て到達可 → 最良の水準
        self.assertEqual(level_for([ok] * n, [(0, 300)], t0), n)
        # 徒歩が長くて間に合わない
        self.assertEqual(level_for([ok] * n, [(0, 700)], t0), 0)


class TestAgainstReference(unittest.TestCase):
    """後退走査の結果が、独立に書いた前方探索と一致すること（乱数の合成ネットワーク）。"""

    def make_net(self, rng, n_nodes=25, n_trips=40):
        rows = []
        for tno in range(n_trips):
            length = rng.randint(2, 7)
            nodes = rng.sample(range(n_nodes), length)
            t = hms(rng.randint(6, 18), rng.choice([0, 10, 20, 30, 40, 50]))
            for a, b in zip(nodes, nodes[1:]):
                dep = t
                arr = dep + rng.randint(2, 12) * 60
                rows.append((dep, arr, a, b, tno))
                t = arr + rng.choice([0, 0, 60, 120])   # 停車時間
        return sorted(rows, key=lambda r: (-r[0], -r[4]))

    def test_random_networks(self):
        rng = random.Random(20261109)
        checked = 0
        for trial in range(25):
            conns = self.make_net(rng)
            n = 25
            facility = {rng.randrange(n): rng.choice([0, 120, 300]) for _ in range(2)}
            starts = [(rng.randrange(n), rng.choice([60, 200, 400])) for _ in range(3)]
            for t0 in (hms(8), hms(12), hms(17)):
                ref_min = reference_levels(conns, n, starts, facility, t0)
                lds = []
                for w in access.THRESHOLDS:
                    fd = {}
                    for node, w_out in facility.items():
                        fd[node] = max(fd.get(node, NEG), t0 + w * 60 - w_out)
                    lds.append(latest_departures(conns, n, fd))
                got = level_for(lds, starts, t0)
                self.assertEqual(got, threshold_level(ref_min), f"trial={trial} t0={t0} ref={ref_min}")
                checked += got > 0
        self.assertGreater(checked, 5)  # 到達ありの場合を十分に含んでいる


if __name__ == "__main__":
    unittest.main()
