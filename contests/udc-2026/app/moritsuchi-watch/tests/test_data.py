"""データの検査。実行: python3 -I -m unittest discover -s tests（app/moritsuchi-watch で）"""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TestData(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "data", "fills.geojson"), encoding="utf-8") as f:
            self.fc = json.load(f)

    def test_counts_match_source(self):
        # 国土数値情報 A54-23 静岡県: 熱海市14、伊東市13（取得時に集計）
        by = {}
        for f in self.fc["features"]:
            by[f["properties"]["city"]] = by.get(f["properties"]["city"], 0) + 1
        self.assertEqual(by, {"熱海市": 14, "伊東市": 13})

    def test_valid_polygons(self):
        ids = set()
        for f in self.fc["features"]:
            p = f["properties"]
            self.assertIn(p["kind"], {"谷埋め型", "腹付け型", "区分なし"})
            self.assertTrue(re.match(r"^(熱海市|伊東市)\d{4}$", p["id"]))
            self.assertNotIn(p["id"], ids)
            ids.add(p["id"])
            ring = f["geometry"]["coordinates"][0]
            self.assertGreaterEqual(len(ring), 4)
            self.assertEqual(ring[0], ring[-1])
            for lng, lat in ring:
                self.assertTrue(138.9 < lng < 139.2 and 34.8 < lat < 35.2)

    def test_not_declared_as_sample(self):
        # 実データなので「サンプル」とは書かない。出典と注意は README と画面にある
        readme = open(os.path.join(ROOT, "README.md"), encoding="utf-8").read()
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
        for text in (readme, html):
            self.assertIn("CC BY 4.0", text)
            self.assertIn("KsjTmplt-A54-2023", text)
            self.assertIn("直ちに危険", text)

    def test_no_forbidden_business_terms_on_screen(self):
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read() + open(os.path.join(ROOT, "app.js"), encoding="utf-8").read()
        for w in ["課金", "料金", "サブスク", "SAR", "Sentinel", "事業", "顧客", "市場規模"]:
            self.assertNotIn(w, html)

    def test_no_external_post(self):
        js = open(os.path.join(ROOT, "app.js"), encoding="utf-8").read() + open(os.path.join(ROOT, "lib.js"), encoding="utf-8").read()
        for w in ["method: \"POST\"", "method:'POST'", "sendBeacon", "XMLHttpRequest", "WebSocket"]:
            self.assertNotIn(w, js)
        self.assertEqual(len(re.findall(r"fetch\(", js)), 1)  # data/fills.geojson の GET のみ

    def test_sri_pinned(self):
        html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
        self.assertIn("maplibre-gl@4.7.1/dist/maplibre-gl.js\" integrity=\"sha384-", html)
        self.assertIn("maplibre-gl@4.7.1/dist/maplibre-gl.css\" integrity=\"sha384-", html)


if __name__ == "__main__":
    unittest.main()
