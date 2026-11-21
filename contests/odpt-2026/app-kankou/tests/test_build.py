import csv
import datetime as dt
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from helpers import APP, make_feed_zip, make_p12_zip
from kankou import build, fetch, sources

LAT, LON = 35.70, 139.79
CAL = [("wk", "1", "1", "1", "1", "1", "0", "0", "20260101", "20271231"),
       ("we", "0", "0", "0", "0", "0", "1", "1", "20260101", "20271231")]


def geojson_zip(name, features):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, json.dumps({"type": "FeatureCollection", "features": features}))
    return buf.getvalue()


def write(tmp, name, data):
    p = Path(tmp) / name
    p.write_bytes(data)
    return p


class TestAssemble(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = self.tmp.name
        stops = [("a", "Ａ停", LAT, LON), ("b", "B停", LAT + 0.010, LON), ("c", "C停", LAT + 0.020, LON)]
        feed = make_feed_zip(stops, [("r1", "観光１", "")],
                             [("t1", "r1", "wk", [("a", "10:00:00"), ("b", "10:05:00"), ("c", "10:10:00")])], CAL)
        self.blobs = {"f": feed}
        self.region = {
            "id": "x", "name": "テスト地域", "bbox": [139.7, 35.6, 139.9, 35.8], "reason": "理由",
            "feeds": [{"key": "f", "name": "テストバス", "operator": "テスト市", "license": "CC BY 4.0",
                       "license_url": "https://creativecommons.org/licenses/by/4.0/deed.ja", "page": "https://example.invalid/p", "url": "https://example.invalid/u"}],
        }
        self.ksj = {
            "tourist": write(t, "p12.zip", make_p12_zip([("名所", "博物館・美術館", "台東区1-1", LON, LAT + 0.0102)])),
            "hospital": write(t, "p04.zip", geojson_zip("P04/P04.geojson", [
                {"type": "Feature", "properties": {"P04_001": 1, "P04_002": "テスト病院"}, "geometry": {"type": "Point", "coordinates": [LON, LAT + 0.02]}},
                {"type": "Feature", "properties": {"P04_001": 2, "P04_002": "診療所"}, "geometry": {"type": "Point", "coordinates": [LON, LAT]}}])),
            "school": write(t, "p29.zip", geojson_zip("P29.geojson", [
                {"type": "Feature", "properties": {"P29_003": 16001, "P29_004": "テスト小"}, "geometry": {"type": "Point", "coordinates": [LON, LAT]}},
                {"type": "Feature", "properties": {"P29_003": 16004, "P29_004": "高校"}, "geometry": {"type": "Point", "coordinates": [LON, LAT]}}])),
            "station": write(t, "n02.zip", geojson_zip("UTF-8/N02-22_Station.geojson", [
                {"type": "Feature", "properties": {"N02_003": "線", "N02_004": "社", "N02_005": "テスト"},
                 "geometry": {"type": "LineString", "coordinates": [[LON, LAT], [LON + 0.0002, LAT]]}},
                {"type": "Feature", "properties": {"N02_003": "線", "N02_004": "社", "N02_005": "テスト"},
                 "geometry": {"type": "LineString", "coordinates": [[LON, LAT], [LON + 0.0002, LAT]]}}])),
        }
        self.data = build.assemble(self.region, self.blobs, self.ksj, dt.date(2026, 11, 16))

    def tearDown(self):
        self.tmp.cleanup()

    def test_structure_and_license(self):
        d = self.data
        self.assertEqual(d["schema"], build.SCHEMA)
        self.assertEqual(d["feeds"][0]["license"], "CC BY 4.0")
        self.assertEqual(d["feeds"][0]["ref"], {"wd": "2026-11-18", "hol": "2026-11-22"})
        self.assertEqual(d["stops"][0][2], "A停")           # NFKC 正規化
        self.assertEqual(len(d["patterns"]), 1)
        self.assertEqual(d["routes"][0]["name"], "観光1")
        self.assertEqual(d["routes"][0]["tstops"], 1)
        self.assertEqual(sorted(d["tstop"].keys()), ["1"])

    def test_facilities_filtered_by_kind(self):
        kinds = sorted(f[3] for f in self.data["facilities"])
        self.assertEqual(kinds, ["小学校", "病院", "鉄道駅", "高校"])   # 診療所は除外（高校は 2026-11-16 から含める）、同じ駅の重複は1件

    def test_csv_matches_table(self):
        text = build.to_csv(self.data)
        self.assertTrue(text.startswith("系統,事業者フィード,日種別"))
        rows = list(csv.reader(io.StringIO(text)))
        self.assertEqual(len(rows) - 1, len(self.data["table"]))
        self.assertEqual(rows[1][0], "観光1")
        self.assertEqual(rows[1][2], "平日")
        self.assertEqual(rows[1][3], "10")
        self.assertEqual(rows[1][-1], "名所")


class TestFetchSafety(unittest.TestCase):
    def test_refuses_authenticated_api(self):
        with self.assertRaises(ValueError):
            fetch.http_get("https://api.odpt.org/api/v4/files/odpt/X/Y.zip?acl:consumerKey=SECRET")
        with self.assertRaises(ValueError):
            fetch.http_get("http://example.com/a.zip")

    def test_region_urls_are_public_and_tokenless(self):
        r = build.load_region()
        urls = [f["url"] for f in r["feeds"]] + list(r["ksj"].values())
        for u in urls:
            self.assertTrue(u.startswith(fetch.PUBLIC_HOSTS), u)
            self.assertNotIn("consumerKey", u)
        for f in r["feeds"]:
            self.assertIn("CC BY 4.0", f["license"])

    def test_source_code_does_not_touch_secrets_or_post(self):
        for p in list((APP / "kankou").glob("*.py")) + list((APP / "web").glob("*.js")) + [APP / "web" / "index.html"]:
            if p.name == "lib.js" or p.suffix == ".py" or p.suffix == ".html" or p.suffix == ".js":
                t = p.read_text(encoding="utf-8")
                self.assertNotIn(".env", t, p.name)
                self.assertNotIn("ODPT_ACCESS_TOKEN", t, p.name)
                self.assertNotIn("sendBeacon", t, p.name)
                self.assertNotIn("XMLHttpRequest", t, p.name)
                self.assertNotIn("method: 'POST'", t, p.name)
                self.assertNotIn('method: "POST"', t, p.name)


class TestBuiltData(unittest.TestCase):
    """web/data/kankou.json（ビルド済みの実データ）の整合性。無ければスキップ。"""

    @classmethod
    def setUpClass(cls):
        p = APP / "web" / "data" / "kankou.json"
        if not p.exists():
            raise unittest.SkipTest("kankou.json が無い（python3 -m kankou.build を実行）")
        cls.p = p
        cls.d = json.loads(p.read_text(encoding="utf-8"))

    def test_size_and_schema(self):
        self.assertLess(self.p.stat().st_size, 3_000_000)
        self.assertEqual(self.d["schema"], build.SCHEMA)

    def test_every_feed_has_license_and_is_current(self):
        for f in self.d["feeds"]:
            self.assertEqual(f["license"], "CC BY 4.0")
            self.assertTrue(f["page"].startswith("https://ckan.odpt.org/dataset/"))
            self.assertFalse(f["expired"], f["name"])
            self.assertGreaterEqual(f["end"], f["ref"]["wd"])
            self.assertLessEqual(f["start"], f["ref"]["wd"])

    def test_references_are_consistent(self):
        d = self.d
        ns, nr, nsp = len(d["stops"]), len(d["routes"]), len(d["spots"])
        for r, stops, off, dwd, dhol in d["patterns"]:
            self.assertLess(r, nr)
            self.assertEqual(len(stops), len(off))
            self.assertTrue(all(0 <= s < ns for s in stops))
            self.assertEqual(off[0], 0)
            self.assertEqual(off, sorted(off))
            self.assertEqual(dwd, sorted(dwd))
            self.assertEqual(dhol, sorted(dhol))
        for k, v in d["tstop"].items():
            self.assertLess(int(k), ns)
            self.assertLess(v, nsp)
        for rt in d["routes"]:
            self.assertTrue(all(i < nsp for i in rt["spots"]))
            self.assertLessEqual(rt["tstops"], rt["stops"])
        for r, dt_, h, trips, visits in d["table"]:
            self.assertLess(r, nr)
            self.assertIn(dt_, ("wd", "hol"))
            self.assertTrue(0 <= h <= 30)
            self.assertGreaterEqual(visits, trips)
            self.assertGreater(trips, 0)

    def test_coverage_is_meaningful(self):
        d = self.d
        self.assertGreater(len(d["stops"]), 1000)
        self.assertGreaterEqual(len(d["spots"]), 15)
        self.assertGreaterEqual(sum(1 for r in d["routes"] if r["tstops"] > 0), 20)
        kinds = {f[3] for f in d["facilities"]}
        self.assertTrue({"病院", "鉄道駅", "小学校", "中学校"} <= kinds)
        sensoji = [s for s in d["spots"] if "浅草寺" in s[2]]
        self.assertTrue(sensoji)
        # 浅草寺の近く（300m以内）に観光地点に近い停留所がある
        la, lo = sensoji[0][0], sensoji[0][1]
        near = [i for i in map(int, d["tstop"]) if abs(d["stops"][i][0] - la) < 0.004 and abs(d["stops"][i][1] - lo) < 0.004]
        self.assertTrue(near)

    def test_csv_file_matches_json(self):
        rows = list(csv.reader(io.StringIO((APP / "web" / "data" / "route_hour.csv").read_text(encoding="utf-8-sig"))))
        self.assertEqual(len(rows) - 1, len(self.d["table"]))


class TestStatic(unittest.TestCase):
    def test_html_states_estimate_license_and_limits(self):
        h = (APP / "web" / "index.html").read_text(encoding="utf-8")
        for w in ("これは推定です", "occupancy", "出典・ライセンス・前提", "この画面の限界", "CSV", "maplibre-gl"):
            self.assertIn(w, h)
        self.assertIn('name="viewport"', h)
        a = (APP / "web" / "app.js").read_text(encoding="utf-8")
        for w in ("非商用", "地理院タイル", "国土数値情報", "f.license"):
            self.assertIn(w, a)

    def test_no_green_in_palette(self):
        """赤緑の対比を避ける: 使っている色に緑系（色相90〜160度で彩度が高いもの）が無い"""
        import colorsys
        import re
        text = (APP / "web" / "style.css").read_text(encoding="utf-8") + (APP / "web" / "app.js").read_text(encoding="utf-8")
        found = set(re.findall(r"#([0-9a-fA-F]{6})\b", text))
        self.assertGreater(len(found), 3)
        for hx in found:
            r, g, b = (int(hx[i:i + 2], 16) / 255 for i in (0, 2, 4))
            h, sat, v = colorsys.rgb_to_hsv(r, g, b)
            if sat > 0.25 and v > 0.2:
                self.assertFalse(90 <= h * 360 <= 160, "緑系の色 #" + hx)

    def test_sources_json_unused(self):
        self.assertTrue(callable(sources.read_hospitals))


if __name__ == "__main__":
    unittest.main()
