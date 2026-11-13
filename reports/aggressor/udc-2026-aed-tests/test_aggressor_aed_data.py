"""アグレッサー（2026-11-13）による失敗テスト: data/aed.json と作品説明（entry-3-aed.md）の主張の整合。

実行・方針は test_aggressor_aed_time.py と同じ（@known_bug、AGGRESSOR_STRICT=1 で赤）。ネットワークは使わない。
元CSV（raw/aed_machida.csv、git管理外）がある時だけ動くテストは、無ければ skip する。
"""
import csv
import io
import json
import os
import re
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
if (_HERE.parent / "data" / "aed.json").is_file():
    APP = _HERE.parent
    REPO = _HERE.parents[4]
else:
    REPO = _HERE.parents[2]
    APP = REPO / "contests" / "udc-2026" / "app" / "aed-night"
ENTRY3 = REPO / "contests" / "udc-2026" / "submission" / "entry-3-aed.md"

STRICT = os.environ.get("AGGRESSOR_STRICT") == "1"


def known_bug(f):
    return f if STRICT else unittest.expectedFailure(f)


class TestMachida24h(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads((APP / "data" / "aed.json").read_text(encoding="utf-8"))
        mi = [m["id"] for m in cls.d["munis"]].index("machida")
        cls.m24 = [a for a in cls.d["aed"] if a[0] == mi and a[5] == 0 and not a[8]]

    @known_bug
    def test_ambulance_is_not_a_public_24h_aed(self):
        # 「町田市民病院 救急車内」が24時間使えるAEDとして数えられ、病院の位置に固定されている
        names = [a[3] + " " + a[4] for a in self.m24]
        self.assertFalse(any("救急車" in n for n in names), names)

    def test_fact_fourteen_24h_aeds_are_two_sites(self):
        # 事実の記録（緑）: 「平日午前3時に使える14台」は町田市民病院13台（同一座標）＋薬師池公園警備室1台の2か所。
        # データ更新でこれが変わったら、提出文・IN1 の「14台」の書き方を見直す合図
        sites = {(a[1], a[2]) for a in self.m24}
        self.assertEqual((len(self.m24), len(sites)), (14, 2), sorted(sites))


class TestEntry3Claims(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = ENTRY3.read_text(encoding="utf-8")

    def _row(self, needle):
        for line in self.text.splitlines():
            if needle in line:
                return line
        self.fail("行が見つからない: " + needle)

    @known_bug
    def test_14_units_row_says_two_sites(self):
        row = self._row("14台")
        self.assertRegex(row, r"2か所|2施設|同一施設|病院", row)

    @known_bug
    def test_979_row_discloses_boundary_share(self):
        # 町田市はメッシュ人口の59.3%が市境800m以内（隣市のAED未読込）。境界を除くと95.6%
        row = self._row("97.9%")
        self.assertRegex(row, r"境界|市境", row)

    @known_bug
    def test_weekday_means_monday_is_stated(self):
        # 「平日」は画面のプリセットでは月曜（d=0）。月曜14時20.4%、火曜14時19.9%
        row = self._row("平日14時")
        self.assertRegex(row, r"月曜", row)

    @known_bug
    def test_machida_readable_100pct_mentions_special_notes(self):
        # 町田市は288台中287台に「利用可能日時特記事項」があり、未反映（例: 学校52台は土日祝8-21時に使えると書かれている）
        row = self._row("時間表記を読めた割合")
        self.assertRegex(row, r"特記", row)

    @known_bug
    def test_has_differentiation_section_vs_entry1(self):
        # ①（GTFS診断マップ）と同じ「メッシュ×人口割合×1つ変えると何人」の型。①には差別化節があるが③に無い
        self.assertRegex(self.text, r"## 差別化")


class TestMachidaRawBlankRows(unittest.TestCase):
    RAW = APP / "raw" / "aed_machida.csv"

    @unittest.skipUnless((APP / "raw" / "aed_machida.csv").is_file(), "raw/aed_machida.csv が無い（tools/fetch_raw.py で取得）")
    @known_bug
    def test_49_rows_without_xy_are_blank_rows_not_aeds(self):
        # README・提出文は「緯度経度の無い49台」と書くが、元CSVの49行は名称も空の空行。登録数337台は誤り（288台）
        rows = list(csv.DictReader(io.StringIO(self.RAW.read_text(encoding="utf-8-sig"))))
        noxy = [r for r in rows if not (r.get("緯度") or "").strip()]
        named = [r for r in noxy if (r.get("名称") or "").strip()]
        self.assertEqual(len(named), len(noxy), "緯度経度なしの行のうち名称があるのは %d / %d" % (len(named), len(noxy)))


if __name__ == "__main__":
    unittest.main()
