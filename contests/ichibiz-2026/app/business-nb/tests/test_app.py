import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
DATA = HERE / "web" / "data"


class TestLibJs(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_lib(self):
        r = subprocess.run(["node", str(HERE / "tests" / "lib_test.js")], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("lib_test OK", r.stdout)

    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_syntax(self):
        for f in ("lib.js", "app.js"):
            r = subprocess.run(["node", "--check", str(HERE / "web" / f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class TestBuild(unittest.TestCase):
    def test_split_address(self):
        import build_data as b
        self.assertEqual(b.split_address("京都府京都市南区吉祥院観音堂南町１－５５"), ("京都市南区", "京都府京都市南区", "吉祥院観音堂南町"))
        self.assertEqual(b.split_address("京都府相楽郡和束町大字木屋小字滝ヶ谷１"), ("和束町", "京都府相楽郡和束町", "木屋"))
        self.assertEqual(b.split_address("京都府京丹後市久美浜町平田２０"), ("京丹後市", "京都府京丹後市", "久美浜町平田"))
        self.assertEqual(b.split_address("京都府船井郡京丹波町和田寺谷１"), ("京丹波町", "京都府船井郡京丹波町", "和田寺谷"))
        self.assertIsNone(b.split_address("大阪府大阪市"))

    def test_dates(self):
        import build_data as b
        self.assertEqual(b.ym("2024年10月"), 202410)
        self.assertEqual(b.ym("-"), 0)
        self.assertEqual(b.serial_ym("45260"), 202311)
        self.assertEqual(b.num("127.9"), 127.9)
        self.assertIsNone(b.num("-"))

    def test_xlsx_reader_on_raw_if_present(self):
        raw = HERE / "raw" / "kyoto.xlsx"
        if not raw.exists():
            self.skipTest("raw/kyoto.xlsx が無い（取得元は build_data.py）")
        import xlsx_min
        rows = xlsx_min.read_sheet(raw, 1)
        self.assertTrue(any(len(r) > 1 and r[1] == "設備ID" for r in rows))


class TestData(unittest.TestCase):
    def setUp(self):
        self.p = json.loads((DATA / "plants.json").read_text(encoding="utf-8"))
        self.f = json.loads((DATA / "facilities.json").read_text(encoding="utf-8"))

    def test_meta_and_counts(self):
        m = self.p["meta"]
        self.assertTrue(m["real_data"])
        self.assertEqual(m["cols"], ["lat", "lon", "kw", "start_ym", "fit_end_ym", "cert_ym", "precision", "muni"])
        self.assertIn("fit-portal.go.jp", m["plants_url"])
        self.assertIn("fit-portal.go.jp/Terms", m["terms_url"])
        st = m["stats"]
        self.assertEqual(len(self.p["rows"]), st["town"] + st["muni"])
        self.assertEqual(st["rows"], len(self.p["rows"]) + st["not_started"] + st["unplaced"])
        self.assertGreater(len(self.p["rows"]), 1000)
        self.assertGreater(st["town"], st["muni"])

    def test_facilities(self):
        # 京都府の公表3社＋京都北部の拠点（推定）＋府外（JPEA一覧の掲載）。施設ごとに出典を持ち、府外は pref で区別する
        self.assertEqual(len(self.f), 6)
        self.assertEqual(sum(1 for f in self.f if f["pref"] == "京都府"), 4)
        self.assertEqual(sorted(f["pref"] for f in self.f if f["pref"] != "京都府"), ["三重県", "大阪府"])
        for f in self.f:
            self.assertTrue(f["url"].startswith("https://"))
            self.assertTrue(f["source"] and f["source_url"].startswith("https://"), f)
            self.assertTrue(f["address"].startswith(f["pref"]), f)
            self.assertTrue(33.4 < f["lat"] < 36.6 and 133.8 < f["lon"] < 137.2, f)
            if f["pref"] == "京都府":
                self.assertTrue(34.7 < f["lat"] < 35.8 and 135.0 < f["lon"] < 136.0, f)
        self.assertIn("推定", " ".join(f["name"] for f in self.f))

    def test_no_personal_fields(self):
        text = (DATA / "plants.json").read_text(encoding="utf-8")
        for w in ("株式会社", "代表者", "電話", "設備ID"):
            self.assertNotIn(w, text)
        self.assertFalse(re.search(r"\d{2,4}-\d{2,4}-\d{3,4}", text))
        for r in self.p["rows"]:
            self.assertEqual(len(r), 8)

    def test_munis_reference(self):
        for r in self.p["rows"]:
            self.assertLess(r[7], len(self.p["munis"]))
        self.assertTrue(all(m.endswith(("市", "町", "村", "区")) for m in self.p["munis"]))


class TestScreen(unittest.TestCase):
    def test_static_only(self):
        for f in ("app.js", "lib.js", "index.html"):
            t = (HERE / "web" / f).read_text(encoding="utf-8")
            self.assertNotRegex(t, r"method\s*:\s*['\"]POST", f)
            self.assertNotIn("XMLHttpRequest", t)
            self.assertNotIn("sendBeacon", t)
            self.assertNotRegex(t, r"api[_-]?key", f)
        t = (HERE / "web" / "app.js").read_text(encoding="utf-8")
        for m in re.findall(r"getJSON\('([^']+)'", t):
            self.assertTrue(m.startswith("data/"), m)

    def test_hypothesis_and_limits_stated_on_screen(self):
        t = (HERE / "web" / "index.html").read_text(encoding="utf-8")
        for w in ("仮説", "直線", "20kW未満", "実データ", "トン数には換算していません"):
            self.assertIn(w, t)
        a = (HERE / "web" / "app.js").read_text(encoding="utf-8")
        for w in ("加工して作成", "国が作成したものではない", "架空", "real_data"):
            self.assertIn(w, a)


if __name__ == "__main__":
    unittest.main()
