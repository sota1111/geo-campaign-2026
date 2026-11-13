"""生成済みの web/data を検査する（ビルド済みデータがリポジトリに入っている前提）。"""
import json
import re
import unittest

import kh
from kodure import build as kb
from kodure import router as rt

DATA = kh.ROOT / "web" / "data"
META = json.loads((DATA / "meta.json").read_text(encoding="utf-8"))
NC, ND = len(META["cells"]), len(META["dests"])
P = META["params"]


def load(name):
    return [kb.rle_decode(s, NC) for s in json.loads((DATA / name).read_text(encoding="utf-8"))]


class TestMeta(unittest.TestCase):
    def test_structure(self):
        self.assertGreater(NC, 1000)
        self.assertGreater(ND, 100)
        self.assertEqual({k for k, _ in META["kinds"]}, {d[3] for d in META["dests"]})
        for c in META["cells"]:
            self.assertEqual(len(c[0]), 9)
            self.assertGreater(c[1], 0)
            self.assertLessEqual(c[2], c[1])      # 0〜14歳は総人口以下
            self.assertIn(c[3], (0, 1))
        self.assertEqual(META["region"]["name"], "東京都区部")

    def test_files_listed_and_present(self):
        expect = {f"m_{d}{h}_c{cap}_t{ly}.json" for d, hs in (("o", P["out_hours"]), ("r", P["ret_hours"])) for h in hs
                  for cap in P["caps_m"] for ly in P["layers"]}
        self.assertEqual(set(META["files"]), expect)
        for f in expect:
            self.assertTrue((DATA / f).exists(), f)

    def test_params_are_assumptions_slower_than_existing(self):
        self.assertLess(P["walk_m_per_min"], 80)
        self.assertEqual(P["walk_m_per_min"], rt.WALK_M_PER_MIN)
        self.assertEqual(P["transfer_s"], rt.TRANSFER_S)

    def test_every_feed_has_license_and_credit_and_is_not_challenge_limited(self):
        self.assertEqual(len(META["feeds"]), META["coverage"]["feeds"])
        for f in META["feeds"]:
            self.assertTrue(f["license"], f["org"])
            self.assertTrue(f["credit"] or f["license"].startswith("公共交通オープンデータ基本ライセンス"), f["org"])
            self.assertNotIn("チャレンジ限定", f["license"])
            self.assertNotIn("Challenge", f["license"])
            self.assertTrue(f["valid"][1], f["org"])
            self.assertRegex(f["ref_hol"], r"^\d{4}-\d{2}-\d{2}$")
        orgs = " ".join(f["org"] for f in META["feeds"])
        # チャレンジ限定ライセンスのデータ（JR東日本・京王電鉄・東武・相鉄のGTFS）を含めない
        for bad in ("東日本旅客", "JR東", "京王電鉄", "東武", "相模鉄道"):
            self.assertNotIn(bad, orgs)

    def test_coverage_and_rail_marks(self):
        self.assertIn("鉄道", META["coverage"]["modes"])
        self.assertGreater(len(META["rail"]), 50)            # 未収録鉄道の駅
        self.assertGreater(sum(c[3] for c in META["cells"]), 0)
        ops = {r[3] for r in META["rail"]}
        self.assertNotIn("東京都", ops)                      # 収録済みの都営地下鉄は除く
        self.assertNotIn("東京地下鉄", ops)


class TestMatrices(unittest.TestCase):
    def test_shapes_and_alphabet(self):
        for name in META["files"]:
            rows = json.loads((DATA / name).read_text(encoding="utf-8"))
            self.assertEqual(len(rows), ND, name)
            for s in rows:
                self.assertRegex(s, r"^(\d+|[A-R])*$")
                self.assertEqual(len(kb.rle_decode(s, NC)), NC)

    def test_no_trip_level_data(self):
        # 出力は所要時間の符号（A〜R）と0の長さだけ。便・時刻の語や形式を含まない
        for name in META["files"]:
            text = (DATA / name).read_text(encoding="utf-8")
            self.assertNotRegex(text, r"\d{1,2}:\d{2}")
        text = (DATA / "meta.json").read_text(encoding="utf-8")
        for bad in ("stop_times", "trip_id", "departure", "consumerKey", "ODPT_ACCESS_TOKEN"):
            self.assertNotIn(bad, text)

    def test_monotone_in_layers_and_cap(self):
        """乗換の許容が増えても、徒歩上限が増えても、所要は短くなるだけ（着けない→着ける はあっても逆は無い）。"""
        for d, h in (("o", 9), ("r", 16)):
            for cap in P["caps_m"]:
                a, b, c = (load(f"m_{d}{h}_c{cap}_t{ly}.json") for ly in (1, 2, 3))
                for di in range(0, ND, 7):
                    for ci in range(0, NC, 5):
                        x1, x2, x3 = a[di][ci], b[di][ci], c[di][ci]
                        if x1:
                            self.assertTrue(0 < x2 <= x1 and 0 < x3 <= x2)
                        if x2:
                            self.assertTrue(0 < x3 <= x2)
            for ly in (1, 3):
                lo, mid, hi = (load(f"m_{d}{h}_c{cap}_t{ly}.json") for cap in P["caps_m"])
                for di in range(0, ND, 7):
                    for ci in range(0, NC, 5):
                        if lo[di][ci]:
                            self.assertTrue(0 < mid[di][ci] <= lo[di][ci])
                        if mid[di][ci]:
                            self.assertTrue(0 < hi[di][ci] <= mid[di][ci])

    def test_durations_within_limit_and_reachable_share_is_plausible(self):
        m = load("m_o9_c500_t3.json")
        nz = sum(1 for row in m for v in row if v)
        self.assertGreater(nz, 0.02 * ND * NC)
        self.assertLess(nz, 0.6 * ND * NC)
        self.assertTrue(all(v <= P["max_min"] // P["quant_min"] for row in m for v in row))

    def test_return_differs_from_outbound(self):
        """帰り（夕方）は行き（午前）と別に計算している（同じ行列を使い回していない）。"""
        o = load("m_o9_c500_t3.json")
        r = load("m_r16_c500_t3.json")
        self.assertNotEqual([bytes(x) for x in o], [bytes(x) for x in r])
        self.assertNotEqual([bytes(x) for x in load("m_o9_c500_t3.json")], [bytes(x) for x in load("m_o10_c500_t3.json")])


class TestOsaka(unittest.TestCase):
    def test_positions_only_no_times(self):
        o = json.loads((DATA / "osaka.json").read_text(encoding="utf-8"))
        self.assertGreater(len(o["dests"]), 50)
        self.assertEqual(set(o), {"id", "name", "bbox", "center", "dests"})
        self.assertFalse(any(re.match(r"m_.*osaka", f.name) for f in DATA.iterdir()))


class TestSizes(unittest.TestCase):
    def test_file_sizes(self):
        for f in DATA.iterdir():
            self.assertLess(f.stat().st_size, 1_500_000, f.name)


if __name__ == "__main__":
    unittest.main()
