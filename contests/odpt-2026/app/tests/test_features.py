"""R1〜R3・ODPTセンター取り込み・期限表示の試験（合成データ、ネットワーク不要）。"""
import datetime as dt
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from helpers import make_feed_zip, make_geojson_zip, make_mesh_zip
from lifemap import access, build, fetch, odpt_adapter, sources
from lifemap.gtfs import load_feed
from lifemap.network import Network

TODAY = dt.date(2026, 11, 9)
CAL = [("wk", 1, 1, 1, 1, 1, 0, 0, "20261101", "20271031"), ("ho", 0, 0, 0, 0, 0, 1, 1, "20261101", "20271031")]


def n02_zip(stations):
    """stations [(lon, lat, 駅名, 運営会社, 路線名)] -> N02 の zip（UTF-8/…_Station.geojson のみ）。"""
    feats = [{"type": "Feature", "properties": {"N02_003": ln, "N02_004": op, "N02_005": nm},
              "geometry": {"type": "LineString", "coordinates": [[lo, la], [lo + 0.0002, la + 0.0002]]}}
             for lo, la, nm, op, ln in stations]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("UTF-8/N02-22_Station.geojson", json.dumps({"type": "FeatureCollection", "features": feats}))
    return buf.getvalue()


class TestWalkModel(unittest.TestCase):
    """R1: 徒歩だけで着けるかは、徒歩モデル（直線×1.25÷分速80m）と許容時間に一致する。"""

    def test_levels(self):
        self.assertEqual(access.walk_level(1280), 4)    # 20分ちょうど
        self.assertEqual(access.walk_level(1281), 3)
        self.assertEqual(access.walk_level(1920), 3)    # 30分
        self.assertEqual(access.walk_level(2880), 2)    # 45分
        self.assertEqual(access.walk_level(3840), 1)    # 60分
        self.assertEqual(access.walk_level(3841), 0)

    def test_max_walk(self):
        self.assertAlmostEqual(access.max_walk_m(), 3840.0, places=6)

    def test_walk_matches_walk_seconds(self):
        for d in (100, 900, 1500, 2500, 3700):
            lvl = access.walk_level(d)
            w = access.THRESHOLDS[len(access.THRESHOLDS) - lvl]
            self.assertLessEqual(access.walk_seconds(d), w * 60)


class TestRouteGrouping(unittest.TestCase):
    """R3: 同じ事業者・同じ路線名の route_id は1つの路線にまとめ、止めると全部が止まる。"""

    @classmethod
    def setUpClass(cls):
        k = 1 / 110574.0
        stops = [("a", "甲", 35.0, 135.0), ("b", "乙", 35.0 + 3000 * k, 135.0), ("c", "丙", 35.0 + 6000 * k, 135.0)]
        routes = [("r1", "1", "下赤江線"), ("r2", "1", "下赤江線"), ("r3", "2", "別線")]   # r1 と r2 は同名（方向・系統違い）
        trips = [("t1", "r1", "wk", "0", [("a", "08:05:00", "08:05:00"), ("b", "08:15:00", "08:15:00")]),
                 ("t2", "r2", "wk", "1", [("b", "08:20:00", "08:20:00"), ("c", "08:30:00", "08:30:00")]),
                 ("t3", "r3", "wk", "0", [("a", "09:00:00", "09:00:00"), ("c", "09:20:00", "09:20:00")])]
        fd = load_feed(make_feed_zip(stops, routes, trips, CAL), [130, 30, 140, 40], TODAY)
        cls.net = Network([fd], [("o", "f")])

    def test_groups(self):
        group_of, members, keys = build.group_routes(self.net, ["東京都交通局"])
        self.assertEqual(len(keys), 2)
        self.assertEqual(len(set(group_of)), 2)
        g = max(range(len(members)), key=lambda i: len(members[i]))
        self.assertEqual(len(members[g]), 2)
        self.assertEqual(keys[g], ("東京都交通局", "1", "下赤江線"))

    def test_same_name_other_operator_is_not_merged(self):
        _g, _m, keys = build.group_routes(self.net, ["事業者A"])
        # フィードが1つなので事業者は1つ。事業者が違えば別キーになることを、キーの構成で確認
        self.assertEqual({k[0] for k in keys}, {"事業者A"})
        self.assertEqual(len({(o, n, s) for (o, n, s) in keys}), 2)

    def test_prune_patterns(self):
        self.assertEqual(build.prune_patterns([[1, 2], [1, 2, 3], [4, 5]]), [[1, 2, 3], [4, 5]])


class TestRailAndOdptBuild(unittest.TestCase):
    """R2 と E1: 未収録の鉄道駅の徒歩圏に印を付ける。ODPTセンター由来のフィードをメタ情報つきで出力する。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        la0, lo0, la1, lo1 = sources.mesh_bounds("53394611")
        cls.bbox = [lo0 - 0.05, la0 - 0.05, lo1 + 0.05, la1 + 0.05]
        stops = [("p1", "住宅地", la0, lo0), ("p2", "病院前", la0 + 0.02, lo0)]
        trips = [("w1", "r1", "wk", "0", [("p1", "08:10:00", "08:10:00"), ("p2", "08:30:00", "08:30:00")])]
        # 有効期間が公開期間の途中（2027-02-10）で終わるフィード
        (d / "feed.zip").write_bytes(make_feed_zip(stops, [("r1", "1", "テスト線")], trips, CAL, feed_info=("20261101", "20270210")))
        # 人口: 駅の近く（徒歩圏）と、駅から遠い地区。どちらも施設・バスからは遠くて「行けない」になる位置にする
        rows = [("5339461111", 60, 20), ("5339461112", 40, 10), ("5339461122", 30, 5)]
        (d / "mesh.zip").write_bytes(make_mesh_zip(rows))
        (d / "p04.zip").write_bytes(make_geojson_zip([]))
        (d / "p29.zip").write_bytes(make_geojson_zip([]))
        a, b, c_, e = sources.mesh_bounds("533946111")
        # 駅: 5339461111 の中心のすぐそばに JR（未収録）と東京都（収録済みとして除外）
        lat, lon = (a + c_) / 2, (b + e) / 2
        (d / "n02.zip").write_bytes(n02_zip([(lon, lat, "テスト駅", "東日本旅客鉄道", "中央線"),
                                            (lon, lat, "収録済み駅", "東京都", "浅草線"),
                                            (lon + 1, lat + 1, "遠い駅", "東日本旅客鉄道", "遠線")]))
        (d / "feeds.json").write_text(json.dumps({"body": []}), encoding="utf-8")
        cls.paths = {"feed": {("odpt", "x"): d / "feed.zip"}, "mesh": {"5339": d / "mesh.zip"},
                     "p04": {"99": d / "p04.zip"}, "p29": {"99": d / "p29.zip"}, "feeds_json": d / "feeds.json",
                     "rail": d / "n02.zip"}
        cls.reg = {"id": "t", "name": "試験", "pref": "99", "bbox": cls.bbox, "reason": "試験",
                   "rail_covered": [["東京都", None]],
                   "feeds": [{"source": "odpt", "id": "x", "path": "Toei/data/x.zip", "organization_name": "東京都交通局",
                              "feed_name": "試験フィード", "feed_license": "CC BY 4.0",
                              "feed_license_url": "https://creativecommons.org/licenses/by/4.0/deed.ja",
                              "credit": "東京都交通局・公共交通オープンデータ協議会",
                              "page_url": "https://ckan.odpt.org/dataset/b_bus_gtfs_jp-toei", "last_updated_at": ""}]}
        cls.out = build.build_region(cls.reg, cls.paths, build.feed_meta_index(cls.paths["feeds_json"]), TODAY)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_odpt_feed_metadata(self):
        f = self.out["feeds"][0]
        self.assertEqual(f["source"], "odpt")
        self.assertEqual(f["license"], "CC BY 4.0")
        self.assertIn("公共交通オープンデータ協議会", f["credit"])
        self.assertTrue(f["url"].startswith("https://ckan.odpt.org/"))
        self.assertEqual(self.out["coverage"]["sources"], ["公共交通オープンデータセンター"])
        self.assertEqual(self.out["coverage"]["modes"], ["バス"])

    def test_expiry_flags(self):
        f = self.out["feeds"][0]
        self.assertFalse(f["expired"])
        self.assertTrue(f["ends_before_public_end"])      # 2027-02-10 < 2027-03-12
        self.assertEqual(self.out["public_until"], "2027-03-12")

    def test_rail_stations_exclude_covered_operator(self):
        names = [r[2] for r in self.out["rail"]]
        self.assertIn("テスト駅", names)
        self.assertNotIn("収録済み駅", names)    # rail_covered の事業者は除く
        self.assertNotIn("遠い駅", names)         # bbox の外

    def test_rail_flag_on_cells_near_station(self):
        flags = {c[0]: c[5] for c in self.out["cells"]}
        self.assertEqual(flags.get("533946111"), 1)

    def test_walk_levels_are_digits(self):
        for c in self.out["cells"]:
            self.assertEqual(len(c[4]), 2)     # 病院・学校
            self.assertTrue(set(c[4]) <= set("01234"))
        json.dumps(self.out, ensure_ascii=False)

    def test_no_rail_data_means_no_flag(self):
        paths = dict(self.paths, rail=None)
        out = build.build_region(self.reg, paths, build.feed_meta_index(paths["feeds_json"]), TODAY)
        self.assertFalse(out["coverage"]["rail_checked"])
        self.assertEqual(out["rail"], [])
        self.assertTrue(all(c[5] == 0 for c in out["cells"]))


class TestOdptAdapter(unittest.TestCase):
    def test_file_url_is_public_key_free_endpoint(self):
        u = odpt_adapter.file_url("Toei/data/ToeiBus-GTFS.zip")
        self.assertEqual(u, "https://api-public.odpt.org/api/v4/files/Toei/data/ToeiBus-GTFS.zip")
        self.assertNotIn("acl:consumerKey", u)

    def test_feed_key(self):
        self.assertEqual(fetch.feed_key(["org", "feed"]), ("org", "feed"))
        self.assertEqual(fetch.feed_key({"source": "odpt", "id": "toei-bus"}), ("odpt", "toei-bus"))

    def test_regions_json_odpt_feeds_have_license_and_credit(self):
        cfg = json.loads((Path(__file__).resolve().parent.parent / "regions.json").read_text(encoding="utf-8"))
        odpt = [f for r in cfg["regions"] for f in r["feeds"] if isinstance(f, dict)]
        self.assertGreaterEqual(len(odpt), 1)
        for f in odpt:
            self.assertEqual(f["source"], "odpt")
            self.assertTrue(f["feed_license"] and f["feed_license_url"] and f["credit"] and f["page_url"])


if __name__ == "__main__":
    unittest.main()
