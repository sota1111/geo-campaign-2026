"""アグレッサー（2026-11-13）による失敗テスト: 夜も使えるAED診断マップの時間表記パーサー（tools/aed_time.py）。

本体は修正しない方針のため、現時点で落ちるものは @known_bug を付けて「既知の失敗」とする
（通常実行は緑。直ると unexpected success で知らせる）。赤で見たいときは AGGRESSOR_STRICT=1:

    cd <リポジトリ>
    python3 -I -m unittest discover -s reports/aggressor/udc-2026-aed-tests -v
    AGGRESSOR_STRICT=1 python3 -I -m unittest discover -s reports/aggressor/udc-2026-aed-tests -v

app/aed-night/tests/ にコピーしてもそのまま動く（APP の探し方を両対応にしてある）。
入力文はすべて福岡市「AED」（BODIK ODM）・町田市「AED設置箇所一覧」に実際にある記載か、その最小形。
報告: reports/aggressor/udc-2026-aed-20261113.md
"""
import os
import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if (_HERE.parent / "tools" / "aed_time.py").is_file():
    APP = _HERE.parent
else:
    APP = _HERE.parents[2] / "contests" / "udc-2026" / "app" / "aed-night"
sys.path.insert(0, str(APP / "tools"))
import aed_time as t  # noqa: E402

STRICT = os.environ.get("AGGRESSOR_STRICT") == "1"


def known_bug(f):
    return f if STRICT else unittest.expectedFailure(f)


MON, TUE, WED, THU, FRI, SAT, SUN = range(7)


def hm(h, m=0):
    return h * 60 + m


def days_of(r):
    return sorted({w[0] for w in r["windows"]})


class TestDayWordsInsideOtherWords(unittest.TestCase):
    """「開館日」「休館日」の『日』や「4月～9月」の『月』を曜日として読んでしまう（福岡市で約48台）。"""

    @known_bug
    def test_kaikanbi_is_not_sunday(self):
        # 福岡市立早良市民センター等。実際は開館日（休館日以外）の9-21時。日曜だけ、ではない
        r = t.parse_availability("", "", "", "開館日の9時～21時まで使用可能")
        self.assertNotEqual(days_of(r), [SUN], r)

    @known_bug
    def test_month_range_is_not_monday(self):
        # 博多の森陸上競技場等。「4月～9月」は月の範囲で、月曜日ではない
        r = t.parse_availability("", "", "", "4月～9月は9時～19時、10月～3月は9時～17時まで使用可能")
        self.assertNotEqual(days_of(r), [MON], r)

    @known_bug
    def test_date_exclusion_is_not_monday(self):
        # 福岡市立西部療育センター。「12月29日～1月3日を除く」は年末年始で、月曜だけではない
        r = t.parse_availability("", "", "", "12月29日～1月3日を除く9時～17時まで使用可能")
        self.assertNotEqual(days_of(r), [MON], r)

    @known_bug
    def test_closed_on_monday_means_open_other_days(self):
        # 「休館日以外の9時～18時 ※休館日：毎週月曜日」→ 火～日。現状は日曜だけ
        r = t.parse_availability("", "", "", "休館日以外の9時～18時　※休館日：毎週月曜日、年末年始（12/29～1/3）")
        self.assertTrue(r["kind"] == "unknown" or days_of(r) == [TUE, WED, THU, FRI, SAT, SUN], r)

    @known_bug
    def test_closed_sat_sun_is_not_open_sunday(self):
        # 「休園日以外の9時～17時 ※休館日：毎週土、日、祝日」→ 平日だけ。現状は日曜だけ（逆）
        r = t.parse_availability("", "", "", "休園日以外の9時～17時　※休館日：毎週土、日、祝日、夏季休暇（8/13～8/15）")
        self.assertFalse(t.is_usable(r["windows"], SUN, hm(10)), r)

    @known_bug
    def test_regardless_of_day(self):
        # 「平日、休日、祭日問わず10時～19時」→ 毎日。現状は日曜だけ
        r = t.parse_availability("", "", "", "原則として、平日、休日、祭日問わず10時00分～19時00分まで可能。")
        self.assertTrue(r["kind"] == "unknown" or len(days_of(r)) == 7, r)

    @known_bug
    def test_kyujitsu_in_exclusion_is_not_weekend(self):
        # 「年末年始の休日を除く 午前9時～午後10時」→ 毎日。現状は土日だけ
        r = t.parse_availability("", "", "", "年末年始の休日を除く　午前９時～午後１０時")
        self.assertTrue(r["kind"] == "unknown" or t.is_usable(r["windows"], WED, hm(12)), r)


class TestDayField(unittest.TestCase):
    @known_bug
    def test_donichi_kyu_means_closed_on_weekend(self):
        # 曜日欄「土日休」は土日が休み。現状は土日だけ使えると読む（意味が逆）
        r = t.parse_availability("土日休", "08:30", "17:00")
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(10)), r)

    @known_bug
    def test_monday_closed_freetext(self):
        # 「月曜休館 9時～17時」→ 火～日。現状は月曜だけ（逆）
        r = t.parse_availability("", "", "", "月曜休館 9時～17時")
        self.assertFalse(t.is_usable(r["windows"], MON, hm(10)), r)


class TestTwelveHourClock(unittest.TestCase):
    @known_bug
    def test_gogo_applies_to_both_ends(self):
        # 「午後1時～5時」は13-17時。現状は13時～翌5時の夜またぎになり、深夜3時に「使える」と出る
        r = t.parse_availability("", "", "", "毎日 午後1時～5時")
        self.assertFalse(t.is_usable(r["windows"], TUE, hm(3)), r)
        self.assertTrue(t.is_usable(r["windows"], TUE, hm(16)), r)


class TestAllDayWording(unittest.TestCase):
    @known_bug
    def test_shujitsu_with_listed_days_excludes_sunday(self):
        # 「平日 終日 土曜日 終日」→ 月～土。現状は日曜も24時間に入る
        r = t.parse_availability("", "", "", "平日　終日（２４時間）　土曜日　終日（２４時間）")
        self.assertFalse(t.is_usable(r["windows"], SUN, hm(3)), r)

    @known_bug
    def test_24h_except_weekend(self):
        # 「24時間使用可能（土日除く）」→ 平日だけ。現状は毎日24時間
        r = t.parse_availability("", "", "", "24時間使用可能（土日除く）")
        self.assertFalse(t.is_usable(r["windows"], SAT, hm(3)), r)

    @known_bug
    def test_locked_at_night_is_not_plain_24h(self):
        # 福岡市消防局（本部）: 「終日使用可能（土日祝日・夜間については施錠されているので、インターホンを使用）」
        # 夜間に誰でも取り出せる24時間とは言えない。少なくとも条件付き（unknown/conditional）にすべき
        r = t.parse_availability("", "", "", "終日使用可能（土日祝日・夜間については施錠されているので、インターホンを使用）")
        self.assertNotEqual(r["kind"], "24h", r)

    @known_bug
    def test_circled_numbers_not_glued_to_dates(self):
        # 大濠公園: 「①12月29日～1月3日を除く8時30分～17時30分、②・③24時間、…」
        # NFKC で ①→1 になり「112月29日」になる。②③は24時間と書かれているが、①の結果（月曜だけ）が全行に付く
        r = t.parse_availability("", "", "", "①１２月２９日～１月３日を除く８時３０分～１７時３０分、②・③２４時間、④１２月２９日～１月３日を除く９時～１７時")
        self.assertNotEqual(days_of(r), [MON], r)


class TestInputValidation(unittest.TestCase):
    @known_bug
    def test_minute_over_59_is_rejected(self):
        r = t.parse_availability("月火水木金", "09:00", "17:75")
        self.assertEqual(r["kind"], "unknown", r)

    def test_fullwidth_digits_ok(self):
        # 全角は NFKC で通る（攻撃したが壊れなかった）
        r = t.parse_availability("月～金", "９：００", "１７：００")
        self.assertTrue(t.is_usable(r["windows"], MON, hm(10)))

    def test_overnight_next_day(self):
        # 夜またぎ（翌1時）は翌日の0-1時に入る（攻撃したが壊れなかった）
        r = t.parse_availability("", "", "", "平日９時３０分～翌日１時まで使用可能")
        self.assertTrue(t.is_usable(r["windows"], SAT, hm(0, 30)))
        self.assertFalse(t.is_usable(r["windows"], MON, hm(0, 30)))


if __name__ == "__main__":
    unittest.main()
