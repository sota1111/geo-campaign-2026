import os
import tempfile
import unittest

import helpers
from kansui import gtfs

BBOX = (35.66, 139.76, 35.70, 139.80)


class GtfsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = os.path.join(self.tmp.name, "f.zip")
        helpers.make_gtfs(self.p)
        self.stops, self.meta = gtfs.load_bus_stops(self.p, BBOX)
        self.by = {s["name"]: s for s in self.stops}

    def tearDown(self):
        self.tmp.cleanup()

    def test_ref_dates(self):
        self.assertEqual(self.meta["ref_weekday"], "2026-11-18")
        self.assertEqual(self.meta["ref_holiday"], "2026-11-15")
        self.assertEqual(self.meta["feed_version"], "v1")

    def test_out_of_bbox_excluded(self):
        self.assertNotIn("圏外", self.by)

    def test_poles_merged_by_parent(self):
        self.assertEqual(sum(1 for s in self.stops if s["name"] == "駅前"), 1)
        self.assertAlmostEqual(self.by["駅前"]["lat"], 35.6801, places=4)

    def test_counts_weekday_holiday(self):
        self.assertEqual((self.by["駅前"]["wd"], self.by["駅前"]["hol"]), (2, 1))
        # 公園は t3・t2 の終点なので、途中停車の t1 だけ数える
        self.assertEqual((self.by["公園"]["wd"], self.by["公園"]["hol"]), (1, 0))

    def test_terminal_not_counted(self):
        self.assertEqual((self.by["終点"]["wd"], self.by["終点"]["hol"]), (0, 0))

    def test_first_last_hourly_over_24h(self):
        s = self.by["駅前"]
        self.assertEqual((s["first"], s["last"]), ("08:00", "25:10"))
        self.assertEqual(s["hourly"][8], 1)
        self.assertEqual(s["hourly"][23], 1)   # 24時以降は 23 に丸める
        self.assertEqual(sum(s["hourly"]), s["wd"])
        self.assertEqual(s["routes"], ["都01"])

    def test_helpers(self):
        self.assertEqual(gtfs.parse_time("25:10:00"), 25 * 3600 + 600)
        self.assertIsNone(gtfs.parse_time(""))
        self.assertIsNone(gtfs.parse_date("2026"))
        self.assertEqual(gtfs.hhmm(3660), "01:01")

    def test_calendar_dates_exception(self):
        cal = [{"service_id": "WD", "wednesday": "1", "start_date": "20261101", "end_date": "20261231"}]
        import datetime as dt
        day = dt.date(2026, 11, 18)
        self.assertEqual(gtfs.active_services(cal, [], day), {"WD"})
        self.assertEqual(gtfs.active_services(cal, [{"service_id": "WD", "date": "20261118", "exception_type": "2"}], day), set())
        self.assertEqual(gtfs.active_services([], [{"service_id": "X", "date": "20261118", "exception_type": "1"}], day), {"X"})


if __name__ == "__main__":
    unittest.main()
