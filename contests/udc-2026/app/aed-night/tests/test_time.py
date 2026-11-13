"""時間表記パーサー（tools/aed_time.py）のテスト。実行: python3 -I -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import aed_time as t  # noqa: E402

MON, TUE, SAT, SUN = 0, 1, 5, 6


def hm(h, m=0):
    return h * 60 + m


class TestStandardFields(unittest.TestCase):
    def test_weekday_office_hours(self):
        r = t.parse_availability("月火水木金", "08:15", "16:45")
        self.assertEqual(r["kind"], "timed")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(9)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(3)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(16, 45)))  # 終了時刻ちょうどは含まない
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(9)))

    def test_24h_variants(self):
        for e in ("23:59", "24:00", "00:00"):
            r = t.parse_availability("月火水木金土日", "00:00", e)
            self.assertEqual(r["kind"], "24h", e)
            self.assertTrue(t.is_usable(r["windows"], SUN, hm(3)))
            self.assertTrue(t.is_usable(r["windows"], MON, 1439))

    def test_24h_but_not_every_day_is_timed(self):
        r = t.parse_availability("月火水木金", "00:00", "24:00")
        self.assertEqual(r["kind"], "timed")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(3)))
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(3)))

    def test_overnight_splits_into_next_day(self):
        r = t.parse_availability("月", "18:00", "06:00")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(23)))
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(5)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(5)))

    def test_empty_is_unknown(self):
        r = t.parse_availability("", "", "")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "empty"))

    def test_days_without_times_is_unknown(self):
        r = t.parse_availability("火水木金土日", "", "")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "no_time"))

    def test_blank_days_with_times_is_unknown_unless_assumed(self):
        r = t.parse_availability("", "08:30", "21:00")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "no_day"))
        self.assertFalse(r["assumed"])
        a = t.parse_availability("", "08:30", "21:00", assume_everyday=True)
        self.assertEqual(a["kind"], "timed")
        self.assertTrue(a["assumed"])
        self.assertTrue(t.is_usable(a["windows"], SUN, hm(10)))

    def test_same_start_end_is_bad_range(self):
        r = t.parse_availability("月火", "09:00", "09:00")
        self.assertEqual(r["kind"], "unknown")


class TestDays(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(t.parse_days("月火水木金土日"), list(range(7)))
        self.assertEqual(t.parse_days("毎日"), list(range(7)))
        self.assertEqual(t.parse_days("平日"), [0, 1, 2, 3, 4])
        self.assertEqual(t.parse_days("土日"), [5, 6])
        self.assertEqual(t.parse_days("月～金"), [0, 1, 2, 3, 4])
        self.assertEqual(t.parse_days("月曜日、水曜日"), [0, 2])
        self.assertEqual(t.parse_days("月火水木金土日祝"), list(range(7)))  # 祝は無視

    def test_blank_and_garbage(self):
        self.assertIsNone(t.parse_days(""))
        self.assertIsNone(t.parse_days("要問合せ"))


class TestFreeText(unittest.TestCase):
    def kind(self, s):
        r = t.parse_freetext(s)
        return r["kind"], r["reason"]

    def test_24h_notations(self):
        for s in ("24時間", "２４時間使用可能", "24時間、365日使用可能", "24h", "終日", "常時使用可能"):
            self.assertEqual(t.parse_freetext(s)["kind"], "24h", s)

    def test_24h_with_condition_is_unknown(self):
        self.assertEqual(self.kind("終日使用可能（学校使用時のみ）"), ("unknown", "conditional"))
        self.assertEqual(self.kind("２４時間（学校使用時のみ）"), ("unknown", "conditional"))

    def test_facility_hours_is_unknown(self):
        self.assertEqual(self.kind("施設の開館時間"), ("unknown", "facility"))
        self.assertEqual(self.kind("地下鉄営業時間内"), ("unknown", "facility"))
        self.assertEqual(self.kind("開館時間内"), ("unknown", "facility"))
        self.assertEqual(self.kind("営業時間"), ("unknown", "facility"))

    def test_weekday_range(self):
        r = t.parse_freetext("平日9:00-17:00")
        self.assertEqual(r["kind"], "timed")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(12)))
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(12)))

    def test_japanese_time_notation(self):
        r = t.parse_freetext("平日　８時３０分～１７時１５分まで使用可能")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(8, 30)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(17, 15)))
        r = t.parse_freetext("毎日 9時半〜17時")
        self.assertTrue(t.is_usable(r["windows"], SUN, hm(9, 30)))
        self.assertFalse(t.is_usable(r["windows"], SUN, hm(9, 29)))

    def test_am_pm(self):
        r = t.parse_freetext("毎日 午前9時から午後5時まで")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(16)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(17)))

    def test_over_24h_end(self):
        r = t.parse_freetext("毎日 ６時～２４時３０分")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(23, 59)))
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(0, 10)))
        self.assertFalse(t.is_usable(r["windows"], TUE, hm(0, 30)))

    def test_multiple_ranges_and_days(self):
        r = t.parse_freetext("平日9:00-17:00、土日10:00～16:00")
        self.assertTrue(t.is_usable(r["windows"], SAT, hm(10)))
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(9)))
        self.assertTrue(t.is_usable(r["windows"], MON, hm(9)))

    def test_two_ranges_one_day_spec(self):
        r = t.parse_freetext("毎日 7時～9時、16時～20時")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(8)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(12)))
        self.assertTrue(t.is_usable(r["windows"], MON, hm(17)))

    def test_everyday_except_new_year(self):
        r = t.parse_freetext("年末年始（１２/２９～１/３）を除く毎日 ９時～１７時")
        self.assertEqual(r["kind"], "timed")
        self.assertTrue(t.is_usable(r["windows"], SUN, hm(10)))

    def test_closed_weekday_excluded(self):
        r = t.parse_freetext("月曜日及び年末年始（１２/２９～１/３）を除く毎日 ９時～１７時")
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(10)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(10)))

    def test_closed_day_in_parentheses(self):
        r = t.parse_freetext("９時～２２時（休館日（日曜、祝日及び12月29日～１月３日））")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(10)))
        self.assertFalse(t.is_usable(r["windows"], SUN, hm(10)))

    def test_no_day_is_unknown_unless_assumed(self):
        self.assertEqual(self.kind("９時～２２時"), ("unknown", "no_day"))
        r = t.parse_availability("", "", "", "９時～２２時", assume_everyday=True)
        self.assertEqual(r["kind"], "timed")
        self.assertTrue(r["assumed"])

    def test_garbage_and_empty(self):
        self.assertEqual(self.kind(""), ("unknown", "empty"))
        self.assertEqual(self.kind("要問い合わせ")[0], "unknown")
        self.assertEqual(self.kind("放課後児童クラブ開設時"), ("unknown", "garbled"))


if __name__ == "__main__":
    unittest.main()
