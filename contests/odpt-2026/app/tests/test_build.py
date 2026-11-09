"""合成データでの前処理の通し試験（ネットワーク不要）。"""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from helpers import make_feed_zip, make_geojson_zip, make_mesh_zip
from lifemap import build, sources

TODAY = dt.date(2026, 11, 9)


def point(lon, lat, props):
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [lon, lat]}}


class TestBuildRegion(unittest.TestCase):
    """メッシュ 53394611 付近に、病院と学校と1本のバス路線を置く。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        la0, lo0, la1, lo1 = sources.mesh_bounds("53394611")
        cls.bbox = [lo0 - 0.05, la0 - 0.05, lo1 + 0.05, la1 + 0.05]
        # 停留所は南北に 約1.1km 間隔 3 つ（P1 が住宅地、P3 が病院そば）
        stops = [("p1", "住宅地", la0, lo0), ("p2", "中間", la0 + 0.01, lo0), ("p3", "病院前", la0 + 0.02, lo0)]
        cal = [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"), ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]
        trips = [
            ("w1", "r1", "wk", "0", [("p1", "08:10:00", "08:10:00"), ("p2", "08:20:00", "08:20:00"), ("p3", "08:30:00", "08:30:00")]),
            ("h1", "r1", "ho", "0", [("p1", "12:20:00", "12:20:00"), ("p2", "12:30:00", "12:30:00"), ("p3", "12:40:00", "12:40:00")]),
        ]
        (d / "feed.zip").write_bytes(make_feed_zip(stops, [("r1", "1", "テスト線")], trips, cal, feed_info=("20261101", "20271031")))
        # 人口: 住宅地メッシュ(100人, 65歳以上30)、バス停から遠い(診断範囲外)メッシュ、人口ゼロ
        rows = [("5339461111", 60, 20), ("5339461112", 40, 10), ("5339461121", 30, 5)]
        (d / "mesh.zip").write_bytes(make_mesh_zip(rows))
        (d / "p04.zip").write_bytes(make_geojson_zip([point(lo0 + 0.0005, la0 + 0.0205, {"P04_001": 1, "P04_002": "テスト病院"})]))
        (d / "p29.zip").write_bytes(make_geojson_zip([point(lo0 + 0.0005, la0 + 0.0205, {"P29_003": 16001, "P29_004": "テスト小"})]))
        feeds_json = {"body": [{"organization_id": "o", "organization_name": "テスト交通", "feed_id": "f", "feed_name": "テスト線",
                                "feed_license": "CC BY 4.0", "feed_license_url": "https://creativecommons.org/licenses/by/4.0/deed.ja",
                                "last_updated_at": "2026-11-01"}]}
        (d / "feeds.json").write_text(json.dumps(feeds_json), encoding="utf-8")
        cls.paths = {"feed": {("o", "f"): d / "feed.zip"}, "mesh": {"5339": d / "mesh.zip"},
                     "p04": {"99": d / "p04.zip"}, "p29": {"99": d / "p29.zip"}, "feeds_json": d / "feeds.json"}
        cls.reg = {"id": "t", "name": "試験地域", "pref": "99", "bbox": cls.bbox, "reason": "試験", "feeds": [["o", "f"]]}
        meta = build.feed_meta_index(cls.paths["feeds_json"])
        cls.out = build.build_region(cls.reg, cls.paths, meta, TODAY)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_structure(self):
        o = self.out
        self.assertEqual(o["facility_order"], ["hospital", "school"])
        self.assertEqual(len(o["nodes"]), 3)
        self.assertEqual(len(o["cells"]), 2)
        for c in o["cells"]:
            self.assertEqual(len(c[3]), 12)          # 2施設 × 2日種 × 3時間帯
            self.assertTrue(set(c[3]) <= set("01234"))
        json.dumps(o, ensure_ascii=False)             # JSON化できる

    def test_license_and_provenance_kept(self):
        f = self.out["feeds"][0]
        self.assertEqual(f["license"], "CC BY 4.0")
        self.assertEqual(f["org"], "テスト交通")
        self.assertEqual(f["ref"], {"wd": "2026-11-11", "hol": "2026-11-15"})
        self.assertEqual(self.out["built"], "2026-11-09")

    def test_access_logic(self):
        # 住宅地 p1 を 8:00 に出る → 8:10 発、8:30 着、病院まで 約60m 歩く。所要は約31分 → 45分以内(水準2)、60分(水準1)
        # 順序: 施設(hospital) × [wd m,d,e, hol m,d,e]
        cell = self.out["cells"][0]
        lv = cell[3]
        hosp_wd_m, hosp_wd_d, hosp_wd_e, hosp_hol_m, hosp_hol_d, hosp_hol_e = (int(x) for x in lv[:6])
        self.assertEqual(hosp_wd_m, 2)      # 45分以内
        self.assertEqual(hosp_wd_d, 0)      # 昼12時以降に平日便なし
        self.assertEqual(hosp_wd_e, 0)
        self.assertEqual(hosp_hol_m, 0)     # 休日の便は12:20発なので朝8時出発では60分以内に着けない
        self.assertEqual(hosp_hol_d, 2)     # 12時出発→12:40着+徒歩で約41分 → 45分以内
        self.assertEqual(hosp_hol_e, 0)

    def test_node_stats_in_output(self):
        p1 = next(n for n in self.out["nodes"] if n[2] == "住宅地")
        self.assertEqual(p1[3][3], 1)    # 平日1本
        self.assertEqual(p1[4][3], 1)    # 休日1本
        self.assertEqual(p1[3][5], 8 * 60 + 10)   # 終発 8:10
        hos = next(n for n in self.out["nodes"] if n[2] == "病院前")
        self.assertEqual(hos[3][3], 0)   # 終点は発車なし
        self.assertEqual(hos[3][5], -1)

    def test_routes_and_patterns(self):
        self.assertEqual(self.out["routes"][0][0], "1")
        self.assertEqual(self.out["routes"][0][3:5], [1, 1])    # 平日1便・休日1便
        self.assertEqual(len(self.out["patterns"][0][1]), 3)


if __name__ == "__main__":
    unittest.main()
