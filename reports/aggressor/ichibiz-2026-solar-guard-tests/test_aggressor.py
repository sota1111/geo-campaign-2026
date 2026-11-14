"""アグレッサーの失敗テスト（データ・計算・主張と実装の一致）。ichibiz-2026 solar-guard、2026-11-13。

  python3 reports/aggressor/ichibiz-2026-solar-guard-tests/test_aggressor.py               # 弱点は表示するだけ（成功扱い）
  AGGRESSOR_STRICT=1 python3 reports/aggressor/ichibiz-2026-solar-guard-tests/test_aggressor.py   # 弱点があれば失敗

置き場所: 交戦規定の hook により contests/ichibiz-2026/app/solar-guard/tests/ へは書けないため reports/aggressor/ に置く。
工兵が tests/ へ移す場合は APP を Path(__file__).resolve().parent.parent に変えればよい。
報告: reports/aggressor/ichibiz-2026-solar-guard-20261113.md
"""
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[3] / "contests" / "ichibiz-2026" / "app" / "solar-guard"
WEB = APP / "web"
DATA = WEB / "data"
STRICT = os.environ.get("AGGRESSOR_STRICT") == "1"


def J(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def node(js):
    """lib.js とデータを読み込んだ node で js を評価し、JSON で受け取る"""
    prog = "const Sg=require(%s);const C=require(%s);const P=require(%s);const K=require(%s);const M=require(%s);\n" % tuple(
        json.dumps(str(p)) for p in (WEB / "lib.js", DATA / "cells.json", DATA / "pops.json", DATA / "checklist.json", DATA / "munis.json"))
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
        self.weak("'目安スコア'" in js, "CSV のメッシュ別に『目安スコア』列がある（並べ替えれば235メッシュの順位表）")
        self.weak("'人の少なさの位置', '容量の位置', '低圧割合の位置'" in js, "CSV のメッシュ別に3指標の位置（0〜100の百分位順位）がある")
        self.weak("指標の位置（0〜100）" in js, "地図ポップアップに各メッシュの指標の位置（0〜100）が出る。位置×234/100 で県内順位が復元できる")

    def test_no_visible_cell_isolates_one_large_plant(self):
        """件数3以上でも、件数・出力計・50kW未満の件数の3つから、1件だけの大きな設備の出力が狭い幅で割り出せるメッシュが無いこと。
        n - small == 1 なら、その1件の出力は [kw - 50*small, kw - 20*small]（認定情報は20kW以上）に入る。"""
        bad = []
        for cx, cy, n, kw, small, pop in J("cells.json")["rows"]:
            if n - small == 1 and n < 10:
                bad.append(f"({cx},{cy}) n={n} 出力計{kw}kW 50kW未満{small} → 残る1件は{kw - 50 * small:.0f}〜{kw - 20 * small:.0f}kW")
        self.weak(bad, "1件の大きな設備の出力が割り出せる少数メッシュ: " + " / ".join(bad))

    def test_diagnosis_uses_only_the_5km_cell(self):
        """画面・README『位置は約5kmメッシュに直して使い、正確な地点は使いません』: 同じ5kmメッシュ内の2点で結果が同じこと"""
        r = node("""
          var pops=Sg.popGrid(P.rows), ctx={cells:C.rows,pops:pops,items:K.items,weights:{quiet:1,kw:1,small:1}};
          var m=Sg.toMesh(140.4468,36.3418), b=Sg.cellBounds(m.cx,m.cy);
          var a=Sg.diagnose({lon:b[0]+0.005,lat:b[1]+0.005,cls:'unknown',answers:{}},ctx), z=Sg.diagnose({lon:b[2]-0.005,lat:b[3]-0.005,cls:'unknown',answers:{}},ctx);
          return [a.localPop3km, z.localPop3km, a.code, z.code];""")
        self.weak(r[0] != r[1] or r[2] != r[3], f"同じ5kmメッシュの2点で『周囲3km四方の人口』が {r[0]} と {r[1]}（1kmメッシュ {r[2]} / {r[3]}）。実際は1km単位の位置を使っている")

    def test_quiet_position_in_range(self):
        """人の少なさの位置は0〜100（人口0のメッシュ＝海上・山林でも）"""
        q = node("""var pops=Sg.popGrid(P.rows);return Sg.diagnose({lon:140.85,lat:36.0,cls:'unknown',answers:{}},{cells:C.rows,pops:pops,items:K.items,weights:{quiet:1,kw:1,small:1}}).quietPos;""")
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
    def test_score_agrees_with_police_district_counts(self):
        """唯一できる粗い検証: 県警の5地区別の太陽光被害（R8.9月末・暫定）と、市町村の目安（初期の重み）の地区平均が逆向きでないこと。
        前提（推測）: 5地区は茨城県の地域区分と同じ。"""
        theft = {r["area"]: r["n"] for r in J("reality.json")["areas"]["rows"]}
        ms = node("return Sg.scoreMunis(M.rows,{quiet:1,kw:1,small:1}).map(function(m){return [m.name,m.n,m.score];});")
        by = {m[0]: m for m in ms}
        names = [n for v in REGIONS.values() for n in v.split()]
        self.assertEqual(sorted(names), sorted(by), "地域区分の市町村名が munis.json と一致しない")
        keys = list(REGIONS)
        rate, score = [], []
        for k in keys:
            mm = [by[n] for n in REGIONS[k].split()]
            rate.append(theft[k] / sum(m[1] for m in mm) * 1000)
            score.append(sum(m[2] for m in mm) / len(mm))
        rho = spearman(score, rate)
        detail = " / ".join(f"{k}: 目安平均{s:.1f}・被害{theft[k]}件(設備千件あたり{r:.1f})" for k, s, r in zip(keys, score, rate))
        self.weak(rho < 0, f"市町村の目安の地区平均と、設備あたりの被害件数の順位相関が {rho:.2f}（逆向き）。{detail}")

    def test_capacity_indicator_is_not_just_plant_count(self):
        """『設備容量のまとまり』（出力合計kW）が、ほぼ設備の件数の言い換えになっていないこと"""
        rho = node("""var s=Sg.scoreCells(C.rows,{quiet:1,kw:1,small:1});var a=s.map(function(c){return c.parts.kw}),b=Sg.percentRank(s.map(function(c){return c.n}));
          var n=a.length,ma=a.reduce(function(x,y){return x+y})/n,mb=b.reduce(function(x,y){return x+y})/n,c=0,va=0,vb=0;
          for(var i=0;i<n;i++){c+=(a[i]-ma)*(b[i]-mb);va+=(a[i]-ma)*(a[i]-ma);vb+=(b[i]-mb)*(b[i]-mb);}return c/Math.sqrt(va*vb);""")
        self.weak(rho > 0.7, f"容量の位置と件数の位置の相関が {rho:.2f}。目安の3分の1が『設備が多い所』を測っており、手薄さの代理として弱い")


if __name__ == "__main__":
    unittest.main()
