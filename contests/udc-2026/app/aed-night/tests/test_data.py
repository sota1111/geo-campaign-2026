"""データ・禁止事項・出典・SRI の検査。実行: python3 -I -m unittest discover -s tests（app/aed-night で）"""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


class TestData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = json.loads(read("data/aed.json"))
        cls.b = json.loads(read("data/boundaries.geojson"))

    def test_four_municipalities_incl_machida(self):
        ids = [m["id"] for m in self.d["munis"]]
        self.assertIn("machida", ids)
        self.assertTrue(2 <= len(ids) <= 4)
        self.assertEqual(ids, [f["properties"]["id"] for f in self.b["features"]])

    def test_counts_are_consistent(self):
        for i, m in enumerate(self.d["munis"]):
            n = sum(1 for a in self.d["aed"] if a[0] == i)
            self.assertEqual(n, m["with_xy"], m["id"])
            self.assertEqual(sum(m["kinds"].values()), n, m["id"])
            self.assertLessEqual(m["with_xy"], m["rows"])
            self.assertEqual(sum(m["unknown_reasons"].values()), m["kinds"]["unknown"], m["id"])
            pop = sum(c[4] for c in self.d["cells"] if c[0] == i)
            self.assertEqual(pop, m["pop"], m["id"])

    def test_machida_matches_recon_measurement(self):
        # 偵察隊の実測（2026-11-09取得、簡易判定）: 町田市337台、緯度経度と曜日・時間の記入あり288台
        m = next(x for x in self.d["munis"] if x["id"] == "machida")
        self.assertGreaterEqual(m["rows"], 330)
        self.assertEqual(m["with_xy"], 288)
        self.assertEqual(m["out_of_range"], 1)  # 高ヶ坂学童保育クラブ（座標が市外）

    def test_aed_records_valid(self):
        for a in self.d["aed"]:
            mi, lat, lon, name, place, kind, payload, note, out = a
            bb = self.d["munis"][mi]["bbox"]
            if out:
                continue
            self.assertTrue(bb[0] - 0.2 < lon < bb[2] + 0.2 and bb[1] - 0.2 < lat < bb[3] + 0.2, name)
            self.assertIn(kind, (0, 1, 2, 3))
            if kind in (1, 3):
                self.assertTrue(payload)
                for mask, s, e in payload:
                    self.assertTrue(1 <= mask <= 127 and 0 <= s < e <= 1440, (name, payload))
            elif kind == 2:
                self.assertIsInstance(payload, str)
            else:
                self.assertEqual(payload, [])

    def test_cells_valid(self):
        seen = set()
        for mi, code, lat, lon, pop, edge, area in self.d["cells"]:
            self.assertRegex(code, r"^\d{10}$")
            self.assertNotIn((mi, code), seen)
            seen.add((mi, code))
            self.assertGreater(pop, 0)
            self.assertIn(edge, (0, 1))
            self.assertTrue(0 <= area < len(self.d["areas"]))
            bb = self.d["munis"][mi]["bbox"]
            self.assertTrue(bb[0] - 0.01 < lon < bb[2] + 0.01 and bb[1] - 0.01 < lat < bb[3] + 0.01)

    def test_population_plausible(self):
        # 令和2年国勢調査の市の人口（町田市431,079人、福岡市1,612,392人）に対し、メッシュ合計は秘匿（*）と境界処理で少なめになる
        ref = {"machida": 431079, "fukuoka": 1612392}
        for m in self.d["munis"]:
            if m["id"] in ref:
                self.assertTrue(0.85 * ref[m["id"]] < m["pop"] < 1.05 * ref[m["id"]], (m["id"], m["pop"]))

    def test_no_pii_columns(self):
        # 電話番号・メール等の連絡先はアプリのデータに含めない
        txt = read("data/aed.json")
        self.assertIsNone(re.search(r"\d{2,4}-\d{2,4}-\d{4}", txt))
        self.assertNotIn("@", txt)


class TestSource(unittest.TestCase):
    def test_credits_and_licenses_on_screen_and_readme(self):
        html, readme = read("index.html"), read("README.md")
        for text in (html, readme):
            for w in ("CC BY", "国勢調査", "国土地理院", "民間の24時間AED"):
                self.assertIn(w, text)
        d = json.loads(read("data/aed.json"))
        for m in d["munis"]:
            self.assertIn(m["name"], readme)
            self.assertIn(m["license"].split("（")[0], readme)

    def test_no_forbidden_terms_on_screen(self):
        text = read("index.html") + read("app.js")
        for w in ["課金", "料金", "サブスク", "市場規模", "必ず助かる", "命が助かる", "救える"]:
            self.assertNotIn(w, text)

    def test_no_external_post(self):
        js = read("app.js") + read("lib.js")
        for w in ['method: "POST"', "method:'POST'", "sendBeacon", "XMLHttpRequest", "WebSocket"]:
            self.assertNotIn(w, js)
        self.assertEqual(len(re.findall(r"fetch\(", js)), 2)  # data/aed.json と data/boundaries.geojson の GET のみ

    def test_sri_pinned(self):
        html = read("index.html")
        self.assertIn('maplibre-gl@4.7.1/dist/maplibre-gl.js" integrity="sha384-', html)
        self.assertIn('maplibre-gl@4.7.1/dist/maplibre-gl.css" integrity="sha384-', html)


if __name__ == "__main__":
    unittest.main()
