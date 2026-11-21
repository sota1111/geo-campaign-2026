import random
import unittest

import kh  # noqa: F401  (sys.path の設定)
from kodure import router as rt
from kh import make_network, reference_rounds


def hms(h, m=0):
    return h * 3600 + m * 60


class FakeNet:
    """Router が使う最小の Network 互換（connections は出発時刻の降順）。"""

    def __init__(self, n, trips):
        self.n = n
        self.nodes = [(35.0, 139.0 + i * 0.01, str(i)) for i in range(n)]
        self.trips = trips
        rows = []
        for tno, seq in enumerate(trips):
            for i in range(len(seq) - 1):
                rows.append((seq[i][2], seq[i + 1][1], seq[i][0], seq[i + 1][0], tno))
        order = sorted(range(len(rows)), key=lambda k: (-rows[k][0], -k))
        self._rows = [rows[k] for k in order]

    def connections(self, dtype, exclude_routes=frozenset()):
        return self._rows


def random_trips(rng, n_nodes, n_trips):
    trips = []
    for _ in range(n_trips):
        length = rng.randint(2, 6)
        nodes = rng.sample(range(n_nodes), length)
        t = hms(8) + rng.randint(0, 150) * 60
        seq = []
        for nd in nodes:
            arr = t
            t += rng.randint(2, 9) * 60
            seq.append((nd, arr, arr + 30))
            t += 30
        trips.append(seq)
    return trips


class TestScanAgainstReference(unittest.TestCase):
    def test_random_networks(self):
        rng = random.Random(7)
        for trial in range(40):
            n = rng.randint(7, 14)
            trips = random_trips(rng, n, rng.randint(6, 30))
            router = rt.Router(FakeNet(n, trips))
            t0 = hms(9)
            sources = {rng.randrange(n): t0 + rng.randint(0, 600) for _ in range(rng.randint(1, 3))}
            got = router.scan(sources, t0)
            ref = reference_rounds(trips, n, sources, t0, rt.TRANSFER_S, t0 + rt.MAX_MIN * 60)
            for layer in range(3):
                for v in range(n):
                    g = got[layer][v]
                    r = ref[layer][v]
                    self.assertEqual(g if g < rt.INF else float("inf"), r, f"trial {trial} layer {layer + 1} node {v}")

    def test_layers_are_nested(self):
        rng = random.Random(3)
        n = 12
        trips = random_trips(rng, n, 40)
        router = rt.Router(FakeNet(n, trips))
        a1, a2, a3 = router.scan({0: hms(9), 3: hms(9, 5)}, hms(9))
        for v in range(n):
            self.assertLessEqual(a3[v], a2[v])
            self.assertLessEqual(a2[v], a1[v])


class TestSingleScenarios(unittest.TestCase):
    def test_transfer_needs_buffer(self):
        # 便A 0->1 (9:10-9:20)、便B 1->2: 5分後(9:25)なら乗継可、3分後(9:23)は不可（余裕は300秒）
        ok = [[(0, hms(9, 10), hms(9, 10)), (1, hms(9, 20), hms(9, 20))], [(1, hms(9, 25), hms(9, 25)), (2, hms(9, 40), hms(9, 40))]]
        ng = [ok[0], [(1, hms(9, 23), hms(9, 23)), (2, hms(9, 40), hms(9, 40))]]
        r1 = rt.Router(FakeNet(3, ok)).scan({0: hms(9)}, hms(9))
        r2 = rt.Router(FakeNet(3, ng)).scan({0: hms(9)}, hms(9))
        self.assertEqual(r1[2][2], hms(9, 40))
        self.assertEqual(r1[0][2], rt.INF)    # 乗換なしでは着けない
        self.assertEqual(r1[1][2], hms(9, 40))  # 乗換1回までなら着く
        self.assertEqual(r2[2][2], rt.INF)

    def test_same_trip_continues_without_buffer(self):
        trips = [[(0, hms(9, 10), hms(9, 10)), (1, hms(9, 15), hms(9, 15)), (2, hms(9, 20), hms(9, 20))]]
        a1, a2, a3 = rt.Router(FakeNet(3, trips)).scan({0: hms(9)}, hms(9))
        self.assertEqual(a1[2], hms(9, 20))

    def test_cannot_board_before_ready(self):
        trips = [[(0, hms(9, 0), hms(9, 0)), (1, hms(9, 10), hms(9, 10))]]
        a1, _a2, _a3 = rt.Router(FakeNet(2, trips)).scan({0: hms(9, 1)}, hms(9))
        self.assertEqual(a1[1], rt.INF)

    def test_window_limit(self):
        trips = [[(0, hms(10, 40), hms(10, 40)), (1, hms(10, 50), hms(10, 50))]]  # 出発から100分後
        a1, _a2, _a3 = rt.Router(FakeNet(2, trips)).scan({0: hms(9)}, hms(9))
        self.assertEqual(a1[1], rt.INF)


class TestQuant(unittest.TestCase):
    def test_quant_ceil(self):
        self.assertEqual(rt.quant(0.5), 1)
        self.assertEqual(rt.quant(5.0), 1)
        self.assertEqual(rt.quant(5.01), 2)
        self.assertEqual(rt.quant(90.0), 18)
        self.assertEqual(rt.quant(90.5), 0)

    def test_walk_speed_is_slow_assumption(self):
        # 400m 直線 × 1.25 を 分速60m → 8.33分
        self.assertAlmostEqual(rt.walk_seconds(400) / 60, 400 * 1.25 / 60, places=6)
        self.assertLess(rt.WALK_M_PER_MIN, 80)   # 既存アプリ（分速80m）より遅い


if __name__ == "__main__":
    unittest.main()
