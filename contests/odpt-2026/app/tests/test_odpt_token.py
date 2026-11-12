"""ODPTセンター認証API（アクセストークン必須のデータ）の取り込みの試験（ネットワーク不要）。

- トークンは取得URLにだけ付け、例外・警告・キャッシュ名・生成物に出さない
- トークンが無い環境では、トークン必須のフィードを警告して飛ばし、ビルドは続く
- 鉄道フィードの rail_covered は、そのフィードを読み込めたときだけ「未収録の鉄道」から外す
- 再配布条件: 公共交通オープンデータチャレンジ限定ライセンスのデータは組み込まない（UDC にも出すため）
"""
import contextlib
import datetime as dt
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from helpers import make_feed_zip, make_geojson_zip, make_mesh_zip
from lifemap import build, fetch, odpt_adapter, sources
from test_features import CAL, n02_zip

ROOT = Path(__file__).resolve().parent.parent
FAKE = "tok_TEST_0123456789abcdef"   # 試験用の偽トークン（本物ではない）
TODAY = dt.date(2026, 11, 12)


def token_feed(fid="metro", **kw):
    f = {"source": "odpt", "auth": "token", "id": fid, "path": "TokyoMetro/data/TokyoMetro-Train-GTFS.zip",
         "organization_name": "東京地下鉄（東京メトロ）", "feed_name": "試験メトロ",
         "feed_license": "公共交通オープンデータ基本ライセンス",
         "feed_license_url": "https://developer.odpt.org/terms/data_basic_license.html",
         "credit": "東京地下鉄株式会社・公共交通オープンデータセンター",
         "page_url": "https://ckan.odpt.org/dataset/train-tokyometro", "last_updated_at": ""}
    f.update(kw)
    return f


class TestTokenUrlAndRedaction(unittest.TestCase):
    def test_token_url_uses_authenticated_endpoint(self):
        u = odpt_adapter.file_url("TokyoMetro/data/TokyoMetro-Train-GTFS.zip", token=FAKE)
        self.assertTrue(u.startswith("https://api.odpt.org/api/v4/files/TokyoMetro/data/"))
        self.assertIn("acl:consumerKey=" + FAKE, u)

    def test_query_date_is_kept(self):
        u = odpt_adapter.file_url("odpt/KantoBus/AllLines.zip", token=FAKE, query={"date": "20261201"})
        self.assertIn("date=20261201", u)
        self.assertIn("acl:consumerKey=", u)
        self.assertEqual(odpt_adapter.file_url("a/b.zip", query={"date": "20260401"}),
                         "https://api-public.odpt.org/api/v4/files/a/b.zip?date=20260401")

    def test_redact_hides_token_in_url_and_raw(self):
        u = odpt_adapter.file_url("x/y.zip", token=FAKE, query={"date": "1"})
        r = odpt_adapter.redact(f"取得失敗: {u}: boom {FAKE}", token=FAKE)
        self.assertNotIn(FAKE, r)
        self.assertIn("acl:consumerKey=***", r)
        self.assertIn("date=1", r)
        # 環境変数のトークンも伏せる（token 引数なし）
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: FAKE}):
            self.assertNotIn(FAKE, odpt_adapter.redact("key " + FAKE))

    def test_http_get_error_message_is_redacted(self):
        u = odpt_adapter.file_url("x/y.zip", token=FAKE)

        def boom(*a, **k):
            raise OSError(f"connection refused for {u}")
        with mock.patch.object(fetch.urllib.request, "urlopen", boom), mock.patch.object(fetch.time, "sleep"):
            with self.assertRaises(RuntimeError) as cm:
                fetch.http_get(u, retries=2)
        self.assertNotIn(FAKE, str(cm.exception))
        self.assertIsNone(cm.exception.__cause__)
        self.assertTrue(cm.exception.__suppress_context__)   # 元の例外（URL入り）をトレースバックに出さない

    def test_needs_token(self):
        self.assertTrue(odpt_adapter.needs_token(token_feed()))
        self.assertFalse(odpt_adapter.needs_token({"source": "odpt", "id": "toei-bus"}))
        self.assertFalse(odpt_adapter.needs_token(["org", "feed"]))


class TestFetchTokenFeed(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _no_network(self, *a, **k):
        raise AssertionError("ネットワークに出てはいけない")

    def test_no_token_no_cache_skips_with_warning(self):
        err = io.StringIO()
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: ""}), \
                mock.patch.object(fetch, "http_get", self._no_network), contextlib.redirect_stderr(err):
            self.assertIsNone(fetch.fetch_feed(token_feed(), self.cache))
        self.assertIn("ODPT_ACCESS_TOKEN", err.getvalue())

    def test_cached_token_feed_is_used_without_token(self):
        p = self.cache / "feed" / "odpt__metro.zip"
        p.parent.mkdir(parents=True)
        p.write_bytes(b"PK")
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: ""}), mock.patch.object(fetch, "http_get", self._no_network):
            self.assertEqual(fetch.fetch_feed(token_feed(), self.cache), p)

    def test_download_uses_token_but_cache_name_does_not(self):
        seen = []

        def fake_get(url, **k):
            seen.append(url)
            return b"PKzip"
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: FAKE}), mock.patch.object(fetch, "http_get", fake_get):
            p = fetch.fetch_feed(token_feed(query={"date": "20261201"}), self.cache)
        self.assertIn(FAKE, seen[0])
        self.assertIn("date=20261201", seen[0])
        self.assertNotIn(FAKE, str(p))
        self.assertEqual(p.name, "odpt__metro.zip")
        for q in self.cache.rglob("*"):
            self.assertNotIn(FAKE, str(q))

    def test_download_failure_skips_and_warning_is_redacted(self):
        def fake_get(url, **k):
            raise RuntimeError(odpt_adapter.redact(f"取得失敗: {url}: HTTP Error 401"))
        err = io.StringIO()
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: FAKE}), \
                mock.patch.object(fetch, "http_get", fake_get), contextlib.redirect_stderr(err):
            self.assertIsNone(fetch.fetch_feed(token_feed(), self.cache))
        self.assertIn("401", err.getvalue())
        self.assertNotIn(FAKE, err.getvalue())

    def test_fetch_all_records_skipped(self):
        reg = {"id": "t", "pref": "99", "bbox": [139.0, 35.0, 139.01, 35.01], "feeds": [token_feed()]}
        with mock.patch.dict(os.environ, {odpt_adapter.TOKEN_ENV: ""}), \
                mock.patch.object(fetch, "cached", lambda path, url, refresh=False: path), \
                contextlib.redirect_stderr(io.StringIO()):
            paths = fetch.fetch_all([reg], self.cache)
        self.assertEqual(paths["skipped"], [("odpt", "metro")])
        self.assertNotIn(("odpt", "metro"), paths["feed"])


class TestBuildWithSkippedTokenFeed(unittest.TestCase):
    """トークン必須の鉄道フィードを読めたら、その鉄道の駅は「未収録」から外れ、飛ばしたら残る。"""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        la0, lo0, la1, lo1 = sources.mesh_bounds("53394611")
        cls.bbox = [lo0 - 0.05, la0 - 0.05, lo1 + 0.05, la1 + 0.05]
        a, b, c_, e = sources.mesh_bounds("533946111")
        lat, lon = (a + c_) / 2, (b + e) / 2
        bus = make_feed_zip([("p1", "住宅地", la0, lo0), ("p2", "病院前", la0 + 0.02, lo0)], [("r1", "3", "バス")],
                            [("w1", "r1", "wk", "0", [("p1", "08:10:00", "08:10:00"), ("p2", "08:30:00", "08:30:00")])], CAL)
        metro = make_feed_zip([("m1", "テスト駅", lat, lon), ("m2", "遠くの駅", lat + 0.03, lon)], [("R", "1", "テスト線")],
                              [("t1", "R", "wk", "0", [("m1", "08:00:00", "08:00:00"), ("m2", "08:06:00", "08:06:00")])], CAL)
        (d / "bus.zip").write_bytes(bus)
        (d / "metro.zip").write_bytes(metro)
        (d / "mesh.zip").write_bytes(make_mesh_zip([("5339461111", 60, 20)]))
        (d / "p04.zip").write_bytes(make_geojson_zip([]))
        (d / "p29.zip").write_bytes(make_geojson_zip([]))
        (d / "n02.zip").write_bytes(n02_zip([(lon, lat, "テスト駅", "東京地下鉄", "テスト線")]))
        (d / "feeds.json").write_text(json.dumps({"body": []}), encoding="utf-8")
        cls.d = d
        cls.reg = {"id": "t", "name": "試験", "pref": "99", "bbox": cls.bbox, "reason": "試験", "rail_covered": [],
                   "feeds": [{"source": "odpt", "id": "bus", "path": "x/bus.zip", "organization_name": "試験バス",
                              "feed_name": "試験バス", "feed_license": "CC BY 4.0", "feed_license_url": "u", "credit": "c",
                              "page_url": "https://ckan.odpt.org/dataset/x", "last_updated_at": ""},
                             token_feed("metro", rail_covered=[["東京地下鉄", None]])]}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def paths(self, with_metro):
        d = self.d
        feed = {("odpt", "bus"): d / "bus.zip"}
        if with_metro:
            feed[("odpt", "metro")] = d / "metro.zip"
        return {"feed": feed, "skipped": [] if with_metro else [("odpt", "metro")], "mesh": {"5339": d / "mesh.zip"},
                "p04": {"99": d / "p04.zip"}, "p29": {"99": d / "p29.zip"}, "feeds_json": d / "feeds.json", "rail": d / "n02.zip"}

    def test_loaded_metro_removes_station_from_unevaluated(self):
        out = build.build_region(self.reg, self.paths(True), {}, TODAY)
        self.assertEqual([f["name"] for f in out["feeds"]], ["試験バス", "試験メトロ"])
        self.assertEqual(out["rail"], [])
        self.assertTrue(all(c[5] == 0 for c in out["cells"]))
        metro = out["feeds"][1]
        self.assertEqual(metro["license"], "公共交通オープンデータ基本ライセンス")
        self.assertIn("公共交通オープンデータセンター", metro["credit"])
        self.assertNotIn("auth", json.dumps(out, ensure_ascii=False).replace("author", ""))

    def test_skipped_metro_keeps_station_unevaluated_and_build_continues(self):
        out = build.build_region(self.reg, self.paths(False), {}, TODAY)
        self.assertEqual([f["name"] for f in out["feeds"]], ["試験バス"])
        self.assertEqual([r[2] for r in out["rail"]], ["テスト駅"])
        self.assertEqual({c[0]: c[5] for c in out["cells"]}.get("533946111"), 1)


class TestUpdatedDate(unittest.TestCase):
    def test_version_and_query_dates(self):
        self.assertEqual(build.updated_from_version("20261008"), "2026-10-08")
        self.assertEqual(build.updated_from_version("edo_20260715_001"), "2026-07-15")
        self.assertEqual(build.updated_from_version("261001"), "")
        self.assertEqual(build.updated_from_query({"query": {"date": "20261001"}}), "2026-10-01")
        self.assertEqual(build.updated_from_query(["org", "feed"]), "")


class TestRegionsAndOutputsHaveNoToken(unittest.TestCase):
    def test_token_feeds_in_regions_json(self):
        text = (ROOT / "regions.json").read_text(encoding="utf-8")
        self.assertNotIn("consumerKey", text)
        cfg = json.loads(text)
        tok = [f for r in cfg["regions"] for f in r["feeds"] if odpt_adapter.needs_token(f)]
        self.assertGreaterEqual(len(tok), 1)
        ids = [f["id"] for r in cfg["regions"] for f in r["feeds"] if isinstance(f, dict)]
        self.assertEqual(len(ids), len(set(ids)))           # キャッシュ名（odpt__<id>.zip）が重ならない
        for f in tok:
            self.assertEqual(f["feed_license"], "公共交通オープンデータ基本ライセンス")
            self.assertIn("公共交通オープンデータセンター", f["credit"])
            self.assertTrue(f["page_url"].startswith("https://ckan.odpt.org/dataset/"))
            self.assertFalse(f["path"].startswith("http"))

    def test_challenge_limited_license_data_is_not_used(self):
        """チャレンジ限定ライセンスは応募目的以外の利用を認めない。UDC にも出すので組み込まない。"""
        text = (ROOT / "regions.json").read_text(encoding="utf-8")
        self.assertNotIn("チャレンジ限定", text)
        for ds in ("jreast_tokyo_area", "keio_train", "tobu_train", "sotetsu_train"):
            self.assertNotIn(ds, text)

    def test_generated_data_has_no_token_parameter(self):
        for p in sorted((ROOT / "web").rglob("*")):
            if p.is_file() and p.suffix in (".json", ".js", ".html"):
                t = p.read_text(encoding="utf-8")
                self.assertNotIn("consumerKey", t, p.name)
                self.assertNotIn("api.odpt.org/api/v4/files", t, p.name)


if __name__ == "__main__":
    unittest.main()
