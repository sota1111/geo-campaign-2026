import unittest

from helpers import APP  # noqa: F401
from teiji import build, demo
from teiji.gtfs import load_schedule


class TestDemo(unittest.TestCase):
    """合成デモに入れた型（朝の遅れ・夕方の団子運転）を、集計が取り戻せること。"""

    @classmethod
    def setUpClass(cls):
        routes = demo.make_routes()
        sched = load_schedule(demo.make_gtfs(routes), demo.DAYS[-1])
        src = {"dataset": "synthetic_demo", "name": "合成", "page": "x"}
        cls.pub, cls.rows, cls.agg = build.build_operator(src, demo.make_records(routes), sched, demo.DAYS[-1])

    def route(self, name, band):
        return next(r for r in self.agg["routes"] if r["name"] == name and r["band"] == band)

    def test_morning_delay_on_route1(self):
        m, e = self.route("デモ1系統", "morning"), self.route("デモ1系統", "evening")
        self.assertLess(m["ontime_pct"], 90)
        self.assertGreater(e["ontime_pct"], 95)

    def test_evening_bunching_on_route2(self):
        e = self.route("デモ2系統", "evening")
        self.assertTrue(e["bunch_enough"])
        self.assertGreater(e["bunch_pct"], 15)
        self.assertLess(self.route("デモ3系統", "evening")["bunch_pct"], 2)

    def test_worst_morning_segment_is_route1(self):
        segs = [s for s in self.agg["segments"] if s["band"] == "morning"]
        self.assertEqual(segs[0]["name"], "デモ1系統")
        self.assertGreater(segs[0]["median_added_s"], 60)


if __name__ == "__main__":
    unittest.main()
