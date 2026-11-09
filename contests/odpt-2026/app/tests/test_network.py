import datetime as dt
import unittest

from helpers import make_feed_zip
from lifemap import gtfs
from lifemap.network import Network, cluster_stops, dist_m, norm_name

BBOX = [130.0, 30.0, 140.0, 40.0]


class TestCluster(unittest.TestCase):
    def test_norm_name(self):
        self.assertEqual(norm_name("市役所前（北行）"), "市役所前")
        self.assertEqual(norm_name("中央 病院"), "中央病院")

    def test_dist(self):
        self.assertAlmostEqual(dist_m(35.0, 135.0, 35.001, 135.0), 110.6, delta=1)

    def test_cluster_rules(self):
        base = 35.0
        d100 = 100 / 110574.0
        stops = [
            ("a", base, 135.0, "市役所前"),
            ("b", base + d100, 135.0, "市役所前(南)"),     # 同名・100m → 併合
            ("c", base + 5 * d100, 135.0, "市役所前"),     # 同名でも500m → 別
            ("d", base + 0.00001, 135.0, "別名"),  # 1m → 近すぎるので併合
            ("e", base + d100, 135.0 + 0.0013, "別の名前"),  # 別名・約100m → 別
        ]
        node_of, nodes = cluster_stops(stops)
        self.assertEqual(node_of["a"], node_of["b"])
        self.assertEqual(node_of["a"], node_of["d"])
        self.assertNotEqual(node_of["a"], node_of["c"])
        self.assertNotEqual(node_of["b"], node_of["e"])
        self.assertEqual(len(nodes), 3)


def feed(stops, trips, cal=None):
    cal = cal or [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"), ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]
    z = make_feed_zip(stops, [("r1", "1", "A線"), ("r2", "2", "B線")], trips, cal, feed_info=("20261101", "20271031"))
    return gtfs.load_feed(z, BBOX, dt.date(2026, 11, 9))


class TestNetwork(unittest.TestCase):
    def setUp(self):
        # 2社が同じ停留所（同名・近接）で接続する
        stops1 = [("a1", "甲", 35.0, 135.0), ("a2", "乙", 35.01, 135.0)]
        stops2 = [("b1", "乙", 35.0101, 135.0), ("b2", "丙", 35.02, 135.0)]
        t1 = [("x1", "r1", "wk", "0", [("a1", "07:00:00", "07:00:00"), ("a2", "07:10:00", "07:10:00")]),
              ("x2", "r1", "wk", "0", [("a1", "17:00:00", "17:00:00"), ("a2", "17:10:00", "17:10:00")]),
              ("x3", "r1", "ho", "0", [("a1", "10:00:00", "10:00:00"), ("a2", "10:10:00", "10:10:00")])]
        t2 = [("y1", "r2", "wk", "0", [("b1", "07:20:00", "07:20:00"), ("b2", "07:30:00", "07:30:00")])]
        self.net = Network([feed(stops1, t1), feed(stops2, t2)], [("o1", "f1"), ("o2", "f2")])

    def test_merge_across_feeds(self):
        self.assertEqual(self.net.n, 3)  # 甲・乙(統合)・丙
        names = sorted(n[2] for n in self.net.nodes)
        self.assertEqual(names, ["丙", "乙", "甲"])

    def test_connections_sorted_desc(self):
        c = self.net.connections("wd")
        self.assertEqual(len(c), 3)
        deps = [x[0] for x in c]
        self.assertEqual(deps, sorted(deps, reverse=True))
        self.assertEqual(len(self.net.connections("hol")), 1)
        self.assertEqual(len(self.net.connections("wd", exclude_routes={0})), 1)  # 路線0を除外

    def test_node_stats(self):
        cnt, first, last, routes = self.net.node_stats("wd")
        kou = next(i for i, n in enumerate(self.net.nodes) if n[2] == "甲")
        self.assertEqual(cnt[kou], [1, 0, 1, 2])   # 朝6-9:1本, 昼0, 夕16-20:1本, 全日2
        self.assertEqual(first[kou], 7 * 3600)
        self.assertEqual(last[kou], 17 * 3600)
        otsu = next(i for i, n in enumerate(self.net.nodes) if n[2] == "乙")
        self.assertEqual(cnt[otsu][3], 1)           # 乙は B線のみ発車（A線は着のみ）
        hei = next(i for i, n in enumerate(self.net.nodes) if n[2] == "丙")
        self.assertEqual(cnt[hei][3], 0)            # 終点は発車なし
        self.assertIsNone(first[hei])


if __name__ == "__main__":
    unittest.main()
