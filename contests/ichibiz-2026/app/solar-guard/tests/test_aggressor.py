"""アグレッサーの失敗テスト（データ・計算・主張と実装の一致）。ichibiz-2026 solar-guard、2026-11-13。工兵が tests/ へ移した版。

  python3 tests/test_aggressor.py                  # 弱点は表示するだけ（成功扱い）
  AGGRESSOR_STRICT=1 python3 tests/test_aggressor.py   # 弱点があれば失敗

原本: reports/aggressor/ichibiz-2026-solar-guard-tests/（アグレッサーの報告 reports/aggressor/ichibiz-2026-solar-guard-20261113.md）。
工兵が変えた点（報告に記載）: APP のパス、F1 の判定（下記）。2026-11-21 のリスク色分けの作り直し（重み・5段階の帯を廃止）に合わせて、診断・F1・容量の検査を新しい仕様に置き換えた。
F1（県警の5地区別の被害と目安の順位相関）について: 工兵は実績に合わせて重みを調整しない方針（総司令官の指示）。
そのため、相関が負でも「README と画面が食い違いを開示している」なら弱点としない。開示が無ければ弱点。
"""
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
DATA = WEB / "data"
STRICT = os.environ.get("AGGRESSOR_STRICT") == "1"


def J(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def node(js):
    """lib.js とデータを読み込んだ node で js を評価し、JSON で受け取る"""
    prog = "const Sg=require(%s);const C=require(%s);const P=require(%s);const K=require(%s);const M=require(%s);const RK=require(%s);const RE=require(%s);const DI=require(%s);\n" % tuple(
        json.dumps(str(p)) for p in (WEB / "lib.js", DATA / "cells.json", DATA / "pops.json", DATA / "checklist.json", DATA / "munis.json", DATA / "risk.json", DATA / "reality.json", DATA / "districts.json"))
    prog += ("const D711=Sg.districtStats(DI.regions,RE.areas711.rows,M.rows);const TIERS=C.regions.map(function(nm){return D711.rows.filter(function(r){return r.area===nm})[0].tier});"
             "const CTX=function(){return {cells:C.rows,pops:Sg.popGrid(P.rows),items:K.items,conds:RK.conds,tiers:TIERS,regionNames:C.regions}};\n")
    r = subprocess.run(["node", "-e", prog + "console.log(JSON.stringify((function(){" + js + "})()))"], capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return json.loads(r.stdout)


class Weakness(unittest.TestCase):
    def weak(self, cond, msg):
        """cond が真なら弱点。STRICT のときだけ失敗させる"""
        if cond:
            print("\n[AGGRESSOR] " + msg)
            if STRICT:
                self.fail(msg)


# 茨城県の地域区分（県北・県央・鹿行・県南・県西）。県警 Metal News の5地区が県の区分と同じという前提は誌面に無い（推測）。
REGIONS = {
    "県北": "日立市 常陸太田市 高萩市 北茨城市 常陸大宮市 大子町",
    "県央": "水戸市 笠間市 ひたちなか市 那珂市 小美玉市 茨城町 大洗町 城里町 東海村",
    "鹿行": "鹿嶋市 潮来市 神栖市 行方市 鉾田市",
    "県南": "土浦市 石岡市 龍ケ崎市 取手市 牛久市 つくば市 守谷市 稲敷市 かすみがうら市 つくばみらい市 美浦村 阿見町 河内町 利根町",
    "県西": "古河市 結城市 下妻市 常総市 筑西市 坂東市 桜川市 八千代町 五霞町 境町",
}


def spearman(a, b):
    def rank(v):
        s = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(s):
            j = i
            while j + 1 < len(s) and v[s[j + 1]] == v[s[i]]:
                j += 1
            for k in range(i, j + 1):
                r[s[k]] = (i + j) / 2
            i = j + 1
        return r
    ra, rb = rank(a), rank(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return cov / (va * vb)


@unittest.skipUnless(shutil.which("node"), "node が無い")
class TestAbuse(Weakness):
    def test_mesh_score_is_not_exposed_as_rankable_values(self):
        """「順位は出さない・色は五分位」の主張: CSV とポップアップにメッシュ別の連続値（順位に直せる値）が無いこと"""
        js = (WEB / "app.js").read_text(encoding="utf-8")
        self.weak("'目安スコア'" in js or "score:" in js, "CSV のメッシュ別に『目安スコア』列がある（並べ替えれば235メッシュの順位表）")
        self.weak("'人の少なさの位置', '容量の位置', '低圧割合の位置'" in js, "CSV のメッシュ別に3指標の位置（0〜100の百分位順位）がある")
        self.weak("指標の位置（0〜100）" in js, "地図ポップアップに各メッシュの指標の位置（0〜100）が出る。位置×234/100 で県内順位が復元できる")

    def test_no_visible_cell_isolates_one_large_plant(self):
        """件数3以上でも、件数・出力計・50kW未満の件数の3つから、1件だけの大きな設備の出力が狭い幅で割り出せるメッシュが無いこと。
        n - small == 1 なら、その1件の出力は [kw - 50*small, kw - 20*small]（認定情報は20kW以上）に入る。"""
        bad = []
        for cx, cy, n, kw, small, pop, _region in J("cells.json")["rows"]:
            if n - small == 1 and n < 10:
                bad.append(f"({cx},{cy}) n={n} 出力計{kw}kW 50kW未満{small} → 残る1件は{kw - 50 * small:.0f}〜{kw - 20 * small:.0f}kW")
        self.weak(bad, "1件の大きな設備の出力が割り出せる少数メッシュ: " + " / ".join(bad))

    def test_diagnosis_uses_only_the_5km_cell(self):
        """画面・README『位置は約5kmメッシュに直して使い、正確な地点は使いません』: 同じ5kmメッシュ内の2点で結果が同じこと"""
        r = node("""
          var ctx=CTX(), inp=function(lon,lat){return {lon:lon,lat:lat,cls:'unknown',answers:{camera:'no'},cond:{hidden:'yes'}}};
          var m=Sg.toMesh(140.4468,36.3418), b=Sg.cellBounds(m.cx,m.cy);
          var a=Sg.diagnose(inp(b[0]+0.005,b[1]+0.005),ctx), z=Sg.diagnose(inp(b[2]-0.005,b[3]-0.005),ctx);
          return [[a.cellPopulation,a.scoreMin,a.scoreMax,JSON.stringify(a.region)].join('|'), [z.cellPopulation,z.scoreMin,z.scoreMax,JSON.stringify(z.region)].join('|'), a.code, z.code];""")
        self.weak(r[0] != r[1] or r[2] != r[3], f"同じ5kmメッシュの2点で診断の結果（人口|点数|地区）が {r[0]} と {r[1]}（1kmメッシュ {r[2]} / {r[3]}）。実際は1km単位の位置を使っている")

    def test_quiet_position_in_range(self):
        """人の少なさの位置は0〜100（人口0のメッシュ＝海上・山林でも）"""
        q = node("""return Sg.diagnose({lon:140.85,lat:36.0,cls:'unknown',answers:{},cond:{}},CTX()).quietPos;""")
        self.weak(not (0 <= q <= 100), f"人口0のメッシュで quietPos={q:.2f}（0〜100の外）")

    def test_diagnosis_rejects_outside_ibaraki(self):
        """診断は茨城県内のみ（画面の案内）。範囲判定が矩形（BOX）だけだと、海上・千葉・栃木を受け付ける"""
        js = (WEB / "app.js").read_text(encoding="utf-8")
        self.weak("var BOX = { lat: [35.7, 36.97], lon: [139.68, 140.88] }" in js and "BOX.lat[0]" in js,
                  "範囲判定が矩形だけ: 鹿島灘の海上(36.00,140.85)・千葉県(35.75,140.00)・栃木県(36.95,139.70)で診断が出る。海上では『人が少ない側（上位2割）』の文まで出る")
        self.weak("parseFloat($('in-lon').value)" in js,
                  "parseFloat で読むため『36,34』→36、『36.34abc』→36.34 を黙って受理する（全角『３６．３４』は拒否）")


@unittest.skipUnless(shutil.which("node"), "node が無い")
class TestJudge(Weakness):
    def test_color_agrees_with_police_district_counts(self):
        """県警の5地区別の太陽光被害（R7.11末＝色の根拠、R8.9末＝別の期間）と、メッシュの色の地区平均の順位相関。
        人目の少ないメッシュの割合と被害率の相関（地区間で逆向きなら、人目は実績の裏づけが無い）も見る。
        工兵の方針: 実績に合わせて規則を調整しない。逆向き・独立でないことは、README と画面が開示していれば弱点としない。"""
        regions = J("districts.json")["regions"]
        self.assertEqual({k: " ".join(v) for k, v in regions.items()}, REGIONS, "districts.json が地域区分と一致しない")
        ml = node("return Sg.meshLevels(C.rows,TIERS).map(function(c){return [c.region,c.level,c.quiet?1:0];});")
        keys = list(REGIONS)
        t711 = {r["area"]: r["n"] for r in J("reality.json")["areas711"]["rows"]}
        t89 = {r["area"]: r["n"] for r in J("reality.json")["areas"]["rows"]}
        munis = {m["name"]: m["n"] or 0 for m in J("munis.json")["rows"]}
        plants = {k: sum(munis[n] for n in REGIONS[k].split()) for k in keys}
        rate711 = [t711[k] / plants[k] * 1000 for k in keys]
        rate89 = [t89[k] / plants[k] * 1000 for k in keys]
        mean = [sum(m[1] for m in ml if m[0] == i) / sum(1 for m in ml if m[0] == i) for i in range(5)]
        quiet = [sum(m[2] for m in ml if m[0] == i) / sum(1 for m in ml if m[0] == i) for i in range(5)]
        r1, r2, r3 = spearman(mean, rate711), spearman(mean, rate89), spearman(quiet, rate711)
        readme = (APP / "README.md").read_text(encoding="utf-8")
        screen = (WEB / "app.js").read_text(encoding="utf-8") + (WEB / "index.html").read_text(encoding="utf-8")
        disclosed = all(w in readme for w in ("独立の検証ではありません", "逆向き", "推測", "仮")) and all(w in screen for w in ("独立の検証ではありません", "逆向き", "推測", "dist-compare"))
        print(f"\n[F1] 色の平均×R7.11 {r1:.2f} / ×R8.9 {r2:.2f} / 人目の少ない割合×被害率 {r3:.2f}（開示 {'あり' if disclosed else 'なし'}）")
        self.weak((r3 < 0 or r1 < 0) and not disclosed, f"色の地区平均や人目の指標が実績と逆向き（{r1:.2f} / {r3:.2f}）なのに、README か画面が開示していない")

    def test_scale_is_not_used_for_color(self):
        """規模は JPEA・REASP と県警で向きが食い違うので色に使わない。使っていれば弱点（両論併記の主張と矛盾）"""
        lib = (WEB / "lib.js").read_text(encoding="utf-8")
        a = lib.index("function mapLevel")
        line = lib[a:lib.index("\n", a)]
        body = line + lib[lib.index("var base = rows.map", lib.index("function meshLevels")):lib.index("return base;", lib.index("function meshLevels"))].split("base.forEach")[1]
        self.weak(".kw" in body or ".small" in body or ".share" in body, "メッシュの色の計算に出力・低圧割合が入っている")



if __name__ == "__main__":
    unittest.main()
