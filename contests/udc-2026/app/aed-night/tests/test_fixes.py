"""アグレッサー指摘（reports/aggressor/udc-2026-aed-20261113.md）の重大5件・中の一部の修正を固定するテスト。
入力文は福岡市「AED」・町田市「AED設置箇所一覧」の実際の記載か、その最小形。実行: python3 -I -m unittest discover -s tests"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import aed_time as t  # noqa: E402

MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def hm(h, m=0):
    return h * 60 + m


def days_of(r):
    return sorted({w[0] for w in r["windows"]})


class TestDayWordsAreNotDays(unittest.TestCase):
    """「開館日」の日、「4月～9月」の月を曜日と読まない（S2）"""

    def test_kaikanbi_is_unknown_not_sunday(self):
        r = t.parse_availability("", "", "", "開館日の9時～21時まで使用可能")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "facility"))

    def test_month_range_is_seasonal_unknown(self):
        r = t.parse_availability("", "", "", "4月～9月は9時～19時、10月～3月は9時～17時まで使用可能")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "seasonal"))

    def test_date_exclusion_is_not_a_day(self):
        r = t.parse_availability("", "", "", "12月29日～1月3日を除く9時～17時まで使用可能")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "no_day"))  # 曜日がないので毎日とは決めつけない

    def test_closed_monday_means_other_days(self):
        r = t.parse_availability("", "", "", "休館日以外の9時～18時　※休館日：毎週月曜日、年末年始（12/29～1/3）")
        self.assertEqual(days_of(r), [1, 2, 3, 4, 5, 6])

    def test_closed_sat_sun_means_weekdays(self):
        r = t.parse_availability("", "", "", "休園日以外の9時～17時　※休館日：毎週土、日、祝日、夏季休暇（8/13～8/15）")
        self.assertEqual(days_of(r), [0, 1, 2, 3, 4])

    def test_closed_without_days_is_unknown(self):
        r = t.parse_availability("", "", "", "休館日以外の9時～18時")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "closure"))

    def test_regardless_of_day_is_everyday(self):
        r = t.parse_availability("", "", "", "原則として、平日、休日、祭日問わず10時00分～19時00分まで可能。")
        self.assertEqual(len(days_of(r)), 7)

    def test_new_year_holiday_exclusion_is_not_weekend(self):
        r = t.parse_availability("", "", "", "年末年始の休日を除く　午前９時～午後１０時")
        self.assertEqual(r["kind"], "unknown")

    def test_nth_saturday_is_not_every_saturday(self):
        r = t.parse_availability("", "", "", "平日8時30分～17時，第1・3・5土曜日8時30分～12時30分")
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(10)))
        self.assertTrue(t.is_usable(r["windows"], MON, hm(10)))

    def test_circled_numbers_mean_multiple_sites(self):
        r = t.parse_availability("", "", "", "①１２月２９日～１月３日を除く８時３０分～１７時３０分、②・③２４時間")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "multi"))


class TestDayFieldClosedWording(unittest.TestCase):
    def test_donichi_kyu(self):
        r = t.parse_availability("土日休", "08:30", "17:00")
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(10)))
        self.assertTrue(t.is_usable(r["windows"], MON, hm(10)))

    def test_monday_closed(self):
        r = t.parse_availability("", "", "", "月曜休館 9時～17時")
        self.assertFalse(t.is_usable(r["windows"], MON, hm(10)))
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(10)))


class TestTwelveHourClockBothEnds(unittest.TestCase):
    def test_gogo_applies_to_both_ends(self):
        r = t.parse_availability("", "", "", "毎日 午後1時～5時")
        self.assertFalse(t.is_usable(r["windows"], TUE, hm(3)))
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(16)))
        self.assertFalse(t.is_usable(r["windows"], TUE, hm(18)))

    def test_gogo_only_on_end_keeps_morning_start(self):
        r = t.parse_availability("", "", "", "毎日 9時～午後5時")
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(10)))


class TestAllDayWording(unittest.TestCase):
    def test_listed_days_all_day(self):
        r = t.parse_availability("", "", "", "平日　終日（２４時間）　土曜日　終日（２４時間）")
        self.assertEqual(days_of(r), [0, 1, 2, 3, 4, 5])

    def test_24h_except_weekend(self):
        r = t.parse_availability("", "", "", "24時間使用可能（土日除く）")
        self.assertEqual(days_of(r), [0, 1, 2, 3, 4])

    def test_locked_at_night_is_conditional(self):
        r = t.parse_availability("", "", "", "終日使用可能（土日祝日・夜間については施錠されているので、インターホンを使用）")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "conditional"))


class TestMinuteValidation(unittest.TestCase):
    def test_minute_over_59_is_rejected(self):
        r = t.parse_availability("月火水木金", "09:00", "17:75")
        self.assertEqual((r["kind"], r["reason"]), ("unknown", "bad_range"))
        r = t.parse_availability("", "", "", "毎日 9時75分～17時")
        self.assertEqual(r["kind"], "unknown")


class TestSpecialNote(unittest.TestCase):
    """町田市の「利用可能日時特記事項」の反映（S3）"""

    def base(self, days, s, e):
        return t.parse_availability(days, s, e)

    def test_school_weekend_hours(self):
        # 学校体育館: 曜日欄は毎日 17:00-21:00、特記に「土曜日、日曜日、祝休日の利用可能時間は8:00～21:00まで」
        a, st = t.apply_special_note(self.base("月火水木金土日", "17:00", "21:00"),
                                     "土曜日、日曜日、祝休日の利用可能時間は8:00～21:00まで。夏季期間の平日については、8:00～21:00まで利用可能。")
        self.assertEqual(st, "applied")
        self.assertTrue(t.is_usable(a["windows"], SUN, hm(9)))
        self.assertTrue(t.is_usable(a["windows"], SAT, hm(20)))
        self.assertFalse(t.is_usable(a["windows"], MON, hm(9)))  # 夏季の平日は反映しない
        self.assertTrue(t.is_usable(a["windows"], MON, hm(18)))

    def test_closed_day_removed(self):
        a, st = t.apply_special_note(self.base("月火水木金土日", "09:00", "17:00"), "日曜日、祝休日、年末年始は終日利用不可。")
        self.assertEqual(st, "applied")
        self.assertFalse(t.is_usable(a["windows"], SUN, hm(10)))
        self.assertTrue(t.is_usable(a["windows"], SAT, hm(10)))

    def test_nth_week_is_not_reflected(self):
        a, st = t.apply_special_note(self.base("月火水木金土日", "09:00", "17:00"), "第1・第3月曜日（休日の場合は翌日）と年末年始は終日利用不可。")
        self.assertEqual(st, "noted")
        self.assertTrue(t.is_usable(a["windows"], MON, hm(10)))

    def test_year_end_only_is_noted(self):
        a, st = t.apply_special_note(self.base("月火水木金", "09:00", "17:00"), "年末年始は終日利用不可。")
        self.assertEqual(st, "noted")

    def test_conditional_becomes_unknown(self):
        a, st = t.apply_special_note(self.base("月火水木金土日", "09:00", "17:00"), "施設の貸出がある場合のみ利用可能。")
        self.assertEqual((st, a["kind"], a["reason"]), ("conditional", "unknown", "conditional"))

    def test_saturday_end_time(self):
        a, st = t.apply_special_note(self.base("月火水木金土", "08:00", "21:00"), "土曜日の利用可能時間は8:00～19:00まで。日曜日、祝休日、年末年始は終日利用不可。")
        self.assertEqual(st, "applied")
        self.assertTrue(t.is_usable(a["windows"], SAT, hm(18)))
        self.assertFalse(t.is_usable(a["windows"], SAT, hm(20)))
        self.assertTrue(t.is_usable(a["windows"], MON, hm(20)))

    def test_no_note(self):
        a, st = t.apply_special_note(self.base("月", "09:00", "17:00"), "")
        self.assertEqual(st, "none")


class TestAccess(unittest.TestCase):
    """一般の人が使えない設置位置（S1）"""

    def avail24(self):
        return t.parse_availability("月火水木金土日", "00:00", "23:59")

    def test_ambulance_and_ward_are_not_public(self):
        for place in ("救急車内", "南棟10階病棟内廊下（105号室前）", "東棟1階口腔外科外来", "１階診察室内", "２階医務室"):
            a, acc = t.classify_access("町田市民病院", place, self.avail24())
            self.assertEqual(acc, "nonpublic", place)

    def test_public_areas_in_hospital_are_counted(self):
        for place in ("南棟1F中央ホール", "東棟・南棟4階コンコース（連絡通路）消化器付近", "外来及び病棟各階ロビー"):
            a, acc = t.classify_access("病院", place, self.avail24())
            self.assertEqual((acc, a["kind"]), ("public", "24h"), place)

    def test_24h_in_staff_room_is_conditional_but_outer_wall_box_is_not(self):
        a, acc = t.classify_access("高屋小学校", "職員室", self.avail24())
        self.assertEqual((acc, a["kind"], a["reason"]), ("public", "unknown", "conditional"))
        a, acc = t.classify_access("倉敷市立老松小学校", "職員室南側外壁の収納ボックス", self.avail24())
        self.assertEqual((acc, a["kind"]), ("public", "24h"))


if __name__ == "__main__":
    unittest.main()
