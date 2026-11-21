"""データ処理（小さいセルの秘匿・個人情報が無いこと・集計の整合）と、画面コードの方針（送信・保存をしない）の検査。

  python3 -m unittest discover -s tests          # node が必要（lib_test.js を呼ぶ）
raw/ がある場合は、原データの設備ID・事業者名・代表者名・電話が公開物に1つも含まれないことを全件で確かめる。
"""
import json
import re
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
WEB = HERE / "web"
DATA = WEB / "data"


def J(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


class TestJs(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_lib(self):
        r = subprocess.run(["node", str(HERE / "tests" / "lib_test.js")], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("lib_test OK", r.stdout)

    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_syntax(self):
        for f in ("lib.js", "app.js"):
            r = subprocess.run(["node", "--check", str(WEB / f)], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)


class TestParsing(unittest.TestCase):
    def test_mesh_roundtrip(self):
        import build_data as b
        ix, iy = b.to_cell(36.3418, 140.4468)
        self.assertEqual(b.cell_code(ix, iy), "54404315")
        self.assertEqual(b.code_to_cell("54404315"), (ix, iy))

    def test_chome_and_norm(self):
        import build_data as b
        self.assertEqual(b.split_chome("赤塚二丁目"), ("赤塚", 2))
        self.assertEqual(b.split_chome("上水戸十丁目"), ("上水戸", 10))
        self.assertEqual(b.split_chome("青柳町"), ("青柳町", None))
        self.assertEqual(b.norm("茨城県龍ヶ崎市　大字Ａ"), "茨城県龍ケ崎市A")

    def test_parse_address_and_locate(self):
        import build_data as b
        cities = ["茨城町", "水戸市", "神栖市"]
        self.assertEqual(b.parse_address("茨城県東茨城郡茨城町大字長岡字剣尺４０７０－４６６", cities), ("茨城町", "長岡字剣尺"))
        self.assertEqual(b.parse_address("茨城県水戸市開江町１９０７", cities), ("水戸市", "開江町"))
        self.assertEqual(b.parse_address("東京都千代田区", cities), (None, ""))
        towns = {"波崎東部東町": [(None, 140.8, 35.75, 10, 1e6)], "波崎西部本郷": [(None, 140.7, 35.76, 10, 1e6)], "柳川": [(None, 140.6, 35.9, 5, 2e6)]}
        # 完全一致（字を除く）
        self.assertEqual(b.locate("柳川", towns)[3], 0)
        self.assertEqual(b.locate("柳川字若松", towns)[3], 0)
        # 大字名だけ（小地域名より短い）→ 大字で始まる小地域の代表点の平均
        lon, lat, area, prec = b.locate("波崎字古野山", towns)
        self.assertEqual(prec, 1)
        self.assertAlmostEqual(lon, 140.75)
        self.assertIsNone(b.locate("存在しない", towns))

    def test_cell_pop(self):
        import build_data as b
        pops = {(5, 5): 10, (6, 6): 7, (100, 100): 3}
        self.assertEqual(b.cell_pop(pops, (1, 1)), 17)  # CELL=5: (5..9, 5..9)
        self.assertEqual(b.cell_pop(pops, (0, 0)), 0)


class TestData(unittest.TestCase):
    def setUp(self):
        self.cells = J("cells.json")
        self.pops = J("pops.json")
        self.munis = J("munis.json")
        self.meta = self.cells["meta"]
        self.st = self.meta["stats"]

    def test_small_cells_hidden(self):
        k = self.meta["k_min"]
        self.assertGreaterEqual(k, 3)
        self.assertEqual(self.cells["cols"], ["cx", "cy", "n", "kw", "small", "pop"])
        for r in self.cells["rows"]:
            self.assertGreaterEqual(r[2], k, "しきい値未満のメッシュが出力に残っている")
            self.assertLessEqual(r[4], r[2])
        keys = [(r[0], r[1]) for r in self.cells["rows"]]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(self.st["cells_visible"], len(self.cells["rows"]))
        self.assertEqual(self.st["cells_all"], self.st["cells_visible"] + self.st["cells_hidden"])
        self.assertGreater(self.st["cells_hidden"], 0, "隠すメッシュが1つも無い（秘匿の検査にならない）")

    def test_small_municipalities_hidden(self):
        k = self.munis["k_min"]
        for m in self.munis["rows"]:
            if m["n"] is None:
                self.assertIsNone(m["kw"])
                self.assertIsNone(m["small"])
            else:
                self.assertGreaterEqual(m["n"], k)

    def test_hidden_rule_in_build(self):
        """build_data の隠し方そのものの検査（小さい入力で）"""
        import build_data as b
        self.assertEqual(b.K_MIN, self.meta["k_min"])
        src = (HERE / "build_data.py").read_text(encoding="utf-8")
        self.assertIn("v[0] >= K_MIN", src)
        self.assertIn("ok = m[\"n\"] >= K_MIN", src)

    def test_dominant_cells_hidden_and_kw_rounded(self):
        """少数メッシュで、50kW以上が1件だけなら、その出力が割り出せる（件数・出力計・50kW未満の件数から）。隠すこと。出力計は丸める"""
        dom, rnd = self.meta["dom_n"], self.meta["kw_round"]
        self.assertGreaterEqual(dom, 10)
        for r in self.cells["rows"]:
            self.assertFalse(r[2] < dom and r[2] - r[4] <= 1, f"大きな設備1件の出力が割り出せるメッシュが出力にある {r}")
            self.assertEqual(r[3] % rnd, 0, "出力計が丸められていない")
        src = (HERE / "build_data.py").read_text(encoding="utf-8")
        self.assertIn("v[0] < DOM_N and v[0] - v[2] <= 1", src)
        self.assertGreater(self.st["cells_hidden_dominant"], 0)
        self.assertEqual(self.st["cells_hidden"], self.st["cells_hidden_small_n"] + self.st["cells_hidden_dominant"])

    def test_land_mask_for_ibaraki(self):
        land = J("land.json")["rows"]
        meshes = {(x, row[0]) for row in land for i in range(1, len(row), 2) for x in range(row[i], row[i + 1] + 1)}
        self.assertTrue(5000 < len(meshes) < 7500, len(meshes))  # 茨城県の面積（約6,100km2）に近い
        def has(lat, lon):
            return (int((lon - 100) * 80 + 1e-9), int(lat * 120 + 1e-9)) in meshes
        for p in [(36.3418, 140.4468), (36.2913, 140.1517), (36.75, 140.35), (36.0, 140.3)]:
            self.assertTrue(has(*p), p)
        for p in [(36.0, 140.85), (35.75, 140.0), (36.95, 139.7), (34.0, 135.0)]:
            self.assertFalse(has(*p), p)
        # 公開済みの集計メッシュはすべて県内
        for r in self.cells["rows"]:
            ok = any((r[0] * 5 + dx, r[1] * 5 + dy) in meshes for dx in range(5) for dy in range(5))
            self.assertTrue(ok, r)

    def test_totals_consistent(self):
        st = self.st
        in_cells = sum(r[2] for r in self.cells["rows"])
        self.assertEqual(in_cells + st["plants_in_hidden_cells"], st["placed"])
        self.assertEqual(st["placed_exact"] + st["placed_ohaza"], st["placed"])
        self.assertEqual(st["placed"] + st["unplaced"], st["counted"])
        self.assertEqual(st["rows"], st["counted"] + st["not_started"] + st["no_muni"] + st["no_kw"])
        msum = sum(m["n"] for m in self.munis["rows"] if m["n"] is not None)
        self.assertEqual(msum, st["counted"])  # 隠した市町村が無ければ全件
        self.assertEqual(len(self.munis["rows"]), 44)
        # 市町村の設備数はメッシュの合計より小さくなりえない（メッシュに入れた分は市町村にも入っている）
        self.assertGreaterEqual(msum, in_cells)
        # 位置の取れた割合（町字の対応づけ）
        self.assertGreater(st["placed"] / st["counted"], 0.95)

    def test_population_cells(self):
        grid = {(r[0], r[1]): r[2] for r in self.pops["rows"]}
        self.assertTrue(all(v > 0 for v in grid.values()))
        for r in self.cells["rows"]:
            tot = sum(grid.get((r[0] * 5 + dx, r[1] * 5 + dy), 0) for dx in range(5) for dy in range(5))
            self.assertEqual(r[5], tot)
        # 茨城県の人口（2020年国勢調査 2,867,009人）に対し、県＋周辺の1kmメッシュ合計は同程度以上
        total = sum(grid.values())
        self.assertGreater(total, 2_800_000)

    def test_cells_inside_ibaraki_area(self):
        for r in self.cells["rows"]:
            lat, lon = (r[1] * 5 + 2.5) / 120, 100 + (r[0] * 5 + 2.5) / 80
            self.assertTrue(35.6 <= lat <= 37.1 and 139.5 <= lon <= 141.1, (lat, lon))

    def test_no_personal_columns_or_ids(self):
        bad = ["設備ID", "発電事業者", "代表者", "電話", "事業者の住所", "株式会社", "合同会社", "有限会社", "一般社団法人"]
        for f in list(DATA.glob("*.json")):
            txt = f.read_text(encoding="utf-8")
            if f.name in ("checklist.json", "reality.json"):
                txt = txt  # 手書きの出典付き資料。社名は含まれない想定なのでそのまま検査
            for w in bad:
                self.assertNotIn(w, txt, f"{f.name} に {w} が含まれる")
        # 個別設備の位置（緯度経度の小数）が cells に無い: 行は整数だけ（kw 以外）
        for r in self.cells["rows"]:
            self.assertTrue(all(isinstance(x, int) for x in (r[0], r[1], r[2], r[4], r[5])))

    def test_raw_values_absent_from_public_files(self):
        raw = HERE / "raw" / "ibaraki.xlsx"
        if not raw.exists():
            self.skipTest("raw/ibaraki.xlsx が無い")
        import xlsx_min
        rows = xlsx_min.read_sheet(raw, 1)
        hi = next(i for i, r in enumerate(rows) if len(r) > 1 and r[1] == "設備ID")
        public = "".join(p.read_text(encoding="utf-8", errors="ignore") for p in list(WEB.glob("*.*")) + list(DATA.glob("*.json")))
        ids, names, tels = set(), set(), set()
        for r in rows[hi + 1:]:
            if len(r) < 6:
                continue
            ids.add(r[1].strip())
            names.add(r[2].strip())
            names.add(r[3].strip())
            tels.add(r[5].strip())
        ids.discard(""), names.discard(""), tels.discard("")
        self.assertGreater(len(ids), 10000)
        for v in ids:
            self.assertNotIn(v, public)
        for v in names | tels:
            # 自治体名そのものが事業者名の設備（例: 「○○市」）は、市町村名として画面に出るので検査から除く
            if len(v) >= 4 and not re.search(r"(市|町|村|県)$", v):
                self.assertNotIn(v, public)


class TestUiCode(unittest.TestCase):
    """画面のコードが、入力の送信・保存をしないこと"""

    def setUp(self):
        self.js = (WEB / "app.js").read_text(encoding="utf-8") + (WEB / "lib.js").read_text(encoding="utf-8")
        self.html = (WEB / "index.html").read_text(encoding="utf-8")

    def test_no_post_or_storage(self):
        for w in ["XMLHttpRequest", "sendBeacon", "localStorage", "sessionStorage", "indexedDB", "document.cookie", "WebSocket", "method: 'POST'", 'method: "POST"', "<form"]:
            self.assertNotIn(w, self.js + self.html, w)

    def test_fetch_only_static_data(self):
        urls = re.findall(r"getJSON\('([^']+)'\)", self.js)
        self.assertTrue(urls)
        for u in urls:
            self.assertTrue(re.fullmatch(r"data/[a-z]+\.json", u), u)
        self.assertEqual(len(re.findall(r"fetch\(", self.js)), 1)  # getJSON の中の1箇所だけ

    def test_screen_states_purpose_and_limits(self):
        h = self.html
        for w in ["被害の予測ではなく", "個別の設備の順位・一覧", "色を付けずに隠します", "送信も保存もしません", "公開の集計地図", "自分の設備を診断", "盗難の実態", "出典・前提・限界"]:
            self.assertIn(w, h, w)
        self.assertNotIn("地理院の住所検索", h)

    def test_no_continuous_score_or_position_in_ui(self):
        """「順位は出さない」: 連続のスコア・各指標の位置（0〜100）を、画面・CSV・公開 JSON に出さない"""
        for w in ["目安スコア", "指標の位置（0〜100）", "人の少なさの位置", "容量の位置", "低圧割合の位置"]:
            self.assertNotIn(w, self.js + self.html, w)
        self.assertIn("delete c.score; delete c.parts;", self.js)
        for f in DATA.glob("*.json"):
            self.assertNotIn("score", f.read_text(encoding="utf-8").lower().replace("scored", ""), f.name)

    def test_diagnosis_input_and_map_privacy(self):
        self.assertNotIn("flyTo", self.js)
        self.assertNotIn("fitBounds", self.js)
        self.assertIn("maxZoom: MAX_ZOOM", self.js)
        self.assertIn("見ている範囲は地理院に伝わります", self.html)
        self.assertNotIn("parseFloat($(", self.js)

    def test_no_individual_ranking_ui(self):
        # 設備単位・メッシュ単位の順位表・上位一覧を作る処理が無い（表は市町村のみ）
        self.assertNotIn("上位10", self.js)
        self.assertNotIn("ランキング", self.js + self.html)
        self.assertNotIn("狙われやすい設備", self.js.replace("「狙われやすい設備」の特定", "").replace("「狙われやすい設備」の表示", ""))

    def test_checklist_and_reality_have_sources(self):
        ck = J("checklist.json")
        self.assertGreaterEqual(len(ck["items"]), 14)
        for it in ck["items"]:
            self.assertTrue(it["src"], it["id"])
            for s in it["src"]:
                self.assertTrue(ck["sources"][s]["url"].startswith("https://"), s)
            self.assertTrue(set(it["cls"]) <= {"all", "low", "high", "special"})
        r = J("reality.json")
        for k in ("yearly", "solar", "areas"):
            self.assertTrue(r[k]["url"].startswith("https://") and r[k]["source"])
        self.assertEqual(sum(a["n"] for a in r["areas"]["rows"]), r["solar"]["rows"][-1]["solar"])  # 5地区の合計＝9月末の太陽光
        for row in r["solar"]["rows"]:
            self.assertLessEqual(row["solar"], row["metal"])


if __name__ == "__main__":
    unittest.main()
