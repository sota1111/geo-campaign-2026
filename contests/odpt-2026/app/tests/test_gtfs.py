import datetime as dt
import unittest

from helpers import make_feed_zip
from lifemap import gtfs

BBOX = [130.0, 30.0, 140.0, 40.0]


class TestTimeAndCalendar(unittest.TestCase):
    def test_parse_time(self):
        self.assertEqual(gtfs.parse_time("08:05:30"), 8 * 3600 + 5 * 60 + 30)
        self.assertEqual(gtfs.parse_time("25:10:00"), 25 * 3600 + 600)  # 24時超
        self.assertIsNone(gtfs.parse_time(""))
        self.assertIsNone(gtfs.parse_time("abc"))
        self.assertIsNone(gtfs.parse_time(None))

    def test_active_services_with_exceptions(self):
        cal = [{"service_id": "wk", "monday": "1", "tuesday": "1", "wednesday": "1", "thursday": "1", "friday": "1",
                "saturday": "0", "sunday": "0", "start_date": "20261101", "end_date": "20261231"},
               {"service_id": "hol", "monday": "0", "tuesday": "0", "wednesday": "0", "thursday": "0", "friday": "0",
                "saturday": "1", "sunday": "1", "start_date": "20261101", "end_date": "20261231"}]
        cd = [{"service_id": "wk", "date": "20261111", "exception_type": "2"},     # 運休
              {"service_id": "hol", "date": "20261111", "exception_type": "1"}]    # 休日ダイヤで運行
        self.assertEqual(gtfs.active_services(cal, [], dt.date(2026, 11, 11)), {"wk"})
        self.assertEqual(gtfs.active_services(cal, cd, dt.date(2026, 11, 11)), {"hol"})
        self.assertEqual(gtfs.active_services(cal, cd, dt.date(2026, 11, 15)), {"hol"})
        self.assertEqual(gtfs.active_services(cal, cd, dt.date(2027, 1, 6)), set())  # 期間外

    def test_pick_ref_date(self):
        today = dt.date(2026, 11, 9)  # 月曜
        self.assertEqual(gtfs.pick_ref_date(today, None, None, 2), dt.date(2026, 11, 11))  # 水
        self.assertEqual(gtfs.pick_ref_date(today, None, None, 6), dt.date(2026, 11, 15))  # 日
        # 開始が先なら開始以降の最初の水曜
        self.assertEqual(gtfs.pick_ref_date(today, dt.date(2026, 12, 1), None, 2), dt.date(2026, 12, 2))
        # 終了が過ぎていたら期間内の最後の水曜
        self.assertEqual(gtfs.pick_ref_date(today, None, dt.date(2026, 11, 5), 2), dt.date(2026, 11, 4))

    def test_fill_times(self):
        seq = [["a", None, None], ["b", 100, 120], ["c", None, None], ["d", None, None], ["e", 400, 400], ["f", None, None]]
        out = gtfs.fill_times(seq)
        self.assertEqual([r[0] for r in out], ["b", "c", "d", "e"])  # 前後の欠損は捨てる
        self.assertEqual(out[1][1], 120 + (400 - 120) * 1 // 3)
        self.assertLessEqual(out[1][2], out[2][1])
        self.assertEqual(gtfs.fill_times([["a", None, None], ["b", 5, 5]]), [])  # 補えない


class TestLoadFeed(unittest.TestCase):
    def setUp(self):
        stops = [("s1", "駅前", 35.0, 135.0), ("s2", "市役所", 35.01, 135.0), ("s3", "病院", 35.02, 135.0),
                 ("far", "遠方", 50.0, 135.0)]
        routes = [("r1", "1", "市内線")]
        cal = [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"),
               ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]
        trips = [
            ("t1", "r1", "wk", "0", [("s1", "08:00:00", "08:00:00"), ("s2", "", ""), ("s3", "08:20:00", "08:20:00")]),
            ("t2", "r1", "ho", "0", [("s1", "09:00:00", "09:00:00"), ("s3", "09:30:00", "09:30:00")]),
            ("t3", "r1", "wk", "0", [("s1", "10:00:00", "10:00:00"), ("far", "11:00:00", "11:00:00")]),
        ]
        self.zip = make_feed_zip(stops, routes, trips, cal, feed_info=("20261101", "20271031"))

    def test_load_feed(self):
        fd = gtfs.load_feed(self.zip, BBOX, dt.date(2026, 11, 9))
        self.assertEqual(fd["ref"]["wd"], dt.date(2026, 11, 11))
        self.assertEqual(fd["ref"]["hol"], dt.date(2026, 11, 15))
        self.assertNotIn("far", fd["stops"])   # bbox 外
        by_id = {t["trip_id"]: t for t in fd["trips"]}
        self.assertTrue(by_id["t1"]["active"]["wd"] and not by_id["t1"]["active"]["hol"])
        self.assertTrue(by_id["t2"]["active"]["hol"] and not by_id["t2"]["active"]["wd"])
        # 時刻欠損は補間される（08:00 と 08:20 の中間）
        self.assertEqual(by_id["t1"]["seq"][1][1], 8 * 3600 + 600)
        # bbox 外の停留所しか無くなる便は残らない（s1 のみ → 2停留所未満）
        self.assertNotIn("t3", by_id)
        self.assertEqual(fd["routes"]["r1"][0], "1")


if __name__ == "__main__":
    unittest.main()
