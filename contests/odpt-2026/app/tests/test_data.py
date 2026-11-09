"""リポジトリに含めた生成データ(web/data)の検査。ライセンス表示・容量・整合性。"""
import json
import random
import unittest
from pathlib import Path

from helpers import APP, reference_levels, threshold_level
from lifemap import access, fetch, sources
from lifemap.gtfs import load_feed
from lifemap.network import Network

DATA = APP / "web" / "data"
MAX_BYTES = 3 * 1024 * 1024
KNOWN_LICENSES = {"CC BY 4.0", "CC0 1.0", "CC BY 2.1 JP", "CC-BY"}


@unittest.skipUnless((DATA / "index.json").exists(), "web/data が未生成（python3 build.py を実行）")
class TestGeneratedData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
        cls.regions = {r["id"]: json.loads((DATA / f"{r['id']}.json").read_text(encoding="utf-8")) for r in cls.index["regions"]}

    def test_region_count_3_to_5(self):
        self.assertTrue(3 <= len(self.regions) <= 5)

    def test_odpt_center_data_is_used_and_labelled(self):
        """応募資格（公共交通オープンデータセンターのデータの活用）: ODPTセンター由来のフィードがあり、ライセンスとクレジットが付く。"""
        odpt = [(rid, f) for rid, d in self.regions.items() for f in d["feeds"] if f["source"] == "odpt"]
        self.assertGreaterEqual(len(odpt), 1)
        for rid, f in odpt:
            self.assertIn("公共交通オープンデータ協議会", f["credit"])
            self.assertTrue(f["license_url"].startswith("https://creativecommons.org/licenses/"))
            self.assertTrue(f["url"].startswith("https://ckan.odpt.org/"))
        self.assertIn("公共交通オープンデータセンター", self.regions["tokyo"]["coverage"]["sources"])

    def test_coverage_and_rail_present(self):
        """収録範囲（件数・種別）と、未収録鉄道の駅・徒歩圏の印が全地域にある（データなしを行けないと誤読させない）。"""
        for rid, d in self.regions.items():
            self.assertGreaterEqual(d["coverage"]["feeds"], 1, rid)
            self.assertTrue(d["coverage"]["modes"], rid)
            self.assertTrue(d["coverage"]["rail_checked"], rid)
            self.assertGreater(len(d["rail"]), 0, rid)
            self.assertGreater(sum(c[5] for c in d["cells"]), 0, rid)
            self.assertEqual(d["params"]["rail_walk_m"], round(access.RAIL_WALK_MIN * 60 / access.walk_seconds(1.0)))

    def test_expiry_flags(self):
        for rid, d in self.regions.items():
            for f in d["feeds"]:
                self.assertIsInstance(f["expired"], bool)
                self.assertEqual(f["ends_before_public_end"], bool(f["valid"][1] and f["valid"][1] < d["public_until"]), (rid, f["id"]))

    def test_whatif_routes_are_grouped_by_operator_and_name(self):
        """「路線を止めたら？」の単位（routes）は (事業者, 名称, 副名) で一意。"""
        for rid, d in self.regions.items():
            keys = [(r[2], r[0], r[1]) for r in d["routes"]]
            self.assertEqual(len(keys), len(set(keys)), rid)

    def test_file_sizes(self):
        for p in DATA.glob("*.json"):
            self.assertLess(p.stat().st_size, MAX_BYTES, p.name)

    def test_every_feed_has_license_and_source(self):
        for rid, d in self.regions.items():
            self.assertTrue(d["feeds"], rid)
            for f in d["feeds"]:
                self.assertIn(f["license"], KNOWN_LICENSES, (rid, f["id"]))
                self.assertTrue(f["org"] and f["name"] and f["updated"], (rid, f["id"]))
                self.assertTrue(f["ref"]["wd"] and f["ref"]["hol"])

    def test_cells_consistent(self):
        for rid, d in self.regions.items():
            n_fac = len(d["facility_order"])
            for code, pop, p65, lv, walk, rail in d["cells"]:
                self.assertEqual(len(code), 9)
                self.assertGreater(pop, 0)
                self.assertGreaterEqual(p65, 0)
                self.assertEqual(len(lv), n_fac * 6)
                self.assertTrue(set(lv) <= set("01234"))
                self.assertEqual(len(walk), n_fac)          # 徒歩だけで着ける水準（施設ごと1桁、0..4）
                self.assertTrue(set(walk) <= set("01234"))
                self.assertIn(rail, (0, 1))
                # 時間帯が遅くなるほど水準が単調、という保証は無いが、範囲は 0..4
            self.assertGreater(sum(c[1] for c in d["cells"]), 10000, rid)

    def test_node_and_pattern_references(self):
        for rid, d in self.regions.items():
            nn, nr = len(d["nodes"]), len(d["routes"])
            for n in d["nodes"]:
                self.assertTrue(all(0 <= r < nr for r in n[5]))
            for ridx, seq in d["patterns"]:
                self.assertTrue(0 <= ridx < nr)
                self.assertTrue(all(0 <= i < nn for i in seq))

    def test_whatif_files(self):
        for rid, d in self.regions.items():
            wp = DATA / f"whatif_{rid}.json"
            if not wp.exists():
                continue
            w = json.loads(wp.read_text(encoding="utf-8"))
            self.assertGreater(len(w["routes"]), 0, rid)
            for r, diffs in w["routes"].items():
                self.assertTrue(0 <= int(r) < len(d["routes"]))
                for k, lv in diffs:
                    self.assertTrue(0 <= k < len(d["cells"]))
                    self.assertEqual(len(lv), len(d["cells"][k][3]))
                    # 路線を除いて水準が上がることはない
                    self.assertTrue(all(int(a) <= int(b) for a, b in zip(lv, d["cells"][k][3])), (rid, r, k))

    def test_index_matches_regions(self):
        for r in self.index["regions"]:
            d = self.regions[r["id"]]
            self.assertEqual(r["population"], sum(c[1] for c in d["cells"]))

    def test_no_nationwide_claim_in_web(self):
        web = APP / "web"
        for name in ("index.html", "app.js"):
            text = (web / name).read_text(encoding="utf-8")
            self.assertNotIn("全国どこでも", text)
            self.assertNotIn("全国対応", text)


CACHE = APP / "cache"


@unittest.skipUnless((CACHE / "feeds.json").exists() and (DATA / "toyama.json").exists(), "キャッシュ未取得")
class TestRealDataCrossCheck(unittest.TestCase):
    """実データ（富山）でも、後退走査の結果が独立実装の前方探索と一致すること。"""

    def test_toyama_sample_cells_match_reference(self):
        import datetime as dt
        cfg = json.loads((APP / "regions.json").read_text(encoding="utf-8"))
        reg = next(r for r in cfg["regions"] if r["id"] == "toyama")
        built = json.loads((DATA / "toyama.json").read_text(encoding="utf-8"))
        today = dt.date.fromisoformat(built["built"])
        keys = [fetch.feed_key(k) for k in reg["feeds"]]
        paths = fetch.fetch_all([reg], CACHE)
        net = Network([load_feed(paths["feed"][k], reg["bbox"], today) for k in keys], keys)
        hospitals = sources.read_hospitals(paths["p04"][reg["pref"]], reg["bbox"])
        grid = access.Grid([(la, lo) for la, lo, _ in net.nodes])
        fac_nodes = {}
        for la, lo, _n in hospitals:
            for node, d in grid.within(la, lo, access.MAX_WALK_OUT_M):
                w = access.walk_seconds(d)
                fac_nodes[node] = min(fac_nodes.get(node, 1e18), w)
        rng = random.Random(7)
        sample = rng.sample(built["cells"], 60)
        conns = net.connections("wd")
        checked = reached = 0
        for code, _pop, _p65, lv, _walk, _rail in sample:
            a, b, c, d = sources.mesh_bounds(code)
            cands = [(i, access.walk_seconds(dd)) for i, dd in grid.within((a + c) / 2, (b + d) / 2, access.MAX_WALK_IN_M)]
            for per, idx in (("m", 0), ("d", 1), ("e", 2)):
                t0 = access.START_HOURS[per] * 3600
                want = threshold_level(reference_levels(conns, net.n, cands, fac_nodes, t0))
                self.assertEqual(int(lv[idx]), want, (code, per))
                checked += 1
                reached += want > 0
        self.assertEqual(checked, 180)
        self.assertGreater(reached, 10)


if __name__ == "__main__":
    unittest.main()
