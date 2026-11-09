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
            for code, pop, p65, lv, walk in d["cells"]:
                self.assertEqual(len(code), 9)
                self.assertGreater(pop, 0)
                self.assertGreaterEqual(p65, 0)
                self.assertEqual(len(lv), n_fac * 6)
                self.assertTrue(set(lv) <= set("01234"))
                self.assertTrue(0 <= walk < (1 << n_fac))
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
        keys = [tuple(k) for k in reg["feeds"]]
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
        for code, _pop, _p65, lv, _walk in sample:
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
