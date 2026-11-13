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
            self.assertEqual(sum(1 for a in self.d["aed"] if a[0] == i and a[5] == 4), m["kinds"]["nonpublic"], m["id"])
            self.assertEqual(sum(m["unknown_reasons"].values()), m["kinds"]["unknown"], m["id"])
            pop = sum(c[4] for c in self.d["cells"] if c[0] == i)
            self.assertEqual(pop, m["pop"], m["id"])

    def test_machida_registered_count_excludes_blank_rows(self):
        # 町田市の元CSVは337行だが、うち49行は名称・座標・時間とも空の行。登録は288台で、全部に座標がある
        m = next(x for x in self.d["munis"] if x["id"] == "machida")
        self.assertEqual((m["rows"], m["blank_rows"], m["with_xy"]), (288, 49, 288))
        self.assertEqual(m["rows"] + m["blank_rows"], 337)
        self.assertEqual(m["out_of_range"], 1)  # 高ヶ坂学童保育クラブ（座標が市外）

    def test_machida_24h_is_two_sites_and_ambulance_is_not_counted(self):
        # 町田市の24時間AEDは、町田市民病院（同一座標）と薬師池公園警備室の2か所。救急車内・病棟内廊下・外来は数えない
        mi = [m["id"] for m in self.d["munis"]].index("machida")
        m24 = [a for a in self.d["aed"] if a[0] == mi and a[5] == 0 and not a[8]]
        self.assertEqual((len(m24), len({(a[1], a[2]) for a in m24})), (11, 2))
        self.assertFalse(any("救急車" in a[3] + a[4] for a in m24))
        priv = [a[4] for a in self.d["aed"] if a[0] == mi and a[5] == 4]
        self.assertTrue(any("救急車" in x for x in priv), priv)

    def test_machida_special_notes_are_reflected(self):
        # 学校など52台は、特記事項で土日祝の利用可能時間が8:00～21:00と書かれている。日曜の午前中に使える
        mi = [m["id"] for m in self.d["munis"]].index("machida")
        m = self.d["munis"][mi]
        self.assertGreaterEqual(m["notes"]["applied"], 52)
        sunday_morning = [a for a in self.d["aed"] if a[0] == mi and a[5] == 1 and a[7] == 2
                          and any((w[0] >> 6) & 1 and w[1] <= 600 < w[2] for w in a[6])]
        self.assertGreaterEqual(len(sunday_morning), 50)
        self.assertEqual(m["notes"]["none"] + m["notes"]["noted"] + m["notes"]["applied"] + m["notes"]["conditional"], m["with_xy"])

    def test_edge_population_is_recorded(self):
        for i, m in enumerate(self.d["munis"]):
            edge = sum(c[4] for c in self.d["cells"] if c[0] == i and c[5])
            self.assertEqual(edge, m["edge_pop"], m["id"])
        m = next(x for x in self.d["munis"] if x["id"] == "machida")
        self.assertGreater(m["edge_pop"] / m["pop"], 0.5)  # 町田市は市境付近が人口の約59%

    def test_aed_records_valid(self):
        for a in self.d["aed"]:
            mi, lat, lon, name, place, kind, payload, note, out = a
            bb = self.d["munis"][mi]["bbox"]
            if out:
                continue
            self.assertTrue(bb[0] - 0.2 < lon < bb[2] + 0.2 and bb[1] - 0.2 < lat < bb[3] + 0.2, name)
            self.assertIn(kind, (0, 1, 2, 3, 4))
            self.assertIn(note, (0, 1, 2))
            if kind in (1, 3):
                self.assertTrue(payload)
                for mask, s, e in payload:
                    self.assertTrue(1 <= mask <= 127 and 0 <= s < e <= 1440, (name, payload))
            elif kind in (2, 4):
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
            self.assertNotIn("BY-SA", text)  # Geoshape は公式表記の CC BY 4.0
            self.assertIn("おかやまオープンデータカタログ", text)
        d = json.loads(read("data/aed.json"))
        for m in d["munis"]:
            self.assertIn(m["name"], readme)
            self.assertIn(m["license"].split("（")[0], readme)
            if m["id"] in ("ibara", "kurashiki"):
                self.assertIn("おかやまオープンデータカタログ", m["credit"])

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
