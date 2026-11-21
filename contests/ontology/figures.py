#!/usr/bin/env python3
"""オントロジーの「図解ページ」（図が主役の1枚の HTML）を生成する。標準ライブラリのみ（rdflib 不要）。

  python3 contests/ontology/figures.py
  python3 contests/ontology/figures.py --out contests/dashboard/public/ontology-figures/index.html

入力（すべて contests/ontology/ の生成物。数値はここから計算し、手で書き写さない）:
  schema.jsonld … 型（クラス）と関係の名前
  campaign.jsonld … 件数、データの利用条件、適合判定（Fit）
  graph.json … 凡例（型の表示名）、アプリ・コンペの名前
  next-actions.json … 提出を止めているもの、次の行動、総司令官の判断待ち、データの影響

作り方は u-ichi/agent-plugins の figure-docs（MIT）に従う: 言いたいことごとに1文、図を先に、文は図ごとの要点1行。
位置・長さ・面積は作成時に計算して SVG に埋め込む（外部ライブラリは読み込まない）。
"""
import argparse
import datetime as dt
import html
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ID = "https://geo-campaign-2026.example/id/"
DEFAULT_OUT = HERE.parent / "dashboard" / "public" / "ontology-figures" / "index.html"

# ---- 色（コントラスト AA 以上。色だけに頼らず、数字・記号・線種も併用する） ----
INK = "#1f2937"
MUTED = "#4b5563"
RED = ("#fee2e2", "#991b1b", "#7f1d1d")     # 塗り, 線, 文字
AMB = ("#fef3c7", "#92400e", "#78350f")
BLU = ("#dbeafe", "#1e40af", "#1e3a8a")
GRN = ("#dcfce7", "#166534", "#14532d")
GRY = ("#f3f4f6", "#4b5563", "#1f2937")
WHT = ("#ffffff", "#1f2937", "#1f2937")


def esc(s):
    return html.escape(str(s), quote=True)


def wrap(s, n):
    out = []
    while len(s) > n:
        out.append(s[:n])
        s = s[n:]
    return out + [s]


def short(s, n):
    s = str(s)
    return s if len(s) <= n else s[: n - 1] + "…"


def sid(x):
    return x.replace(ID, "id:") if isinstance(x, str) else x


def ref(v):
    """JSON-LD の参照（{'@id':..} または その配列）を id 文字列のリストにする。"""
    if v is None:
        return []
    if isinstance(v, dict):
        return [v.get("@id")]
    return [x.get("@id") for x in v]


def label_of(node):
    v = node.get("rdfs:label")
    return v.get("@value") if isinstance(v, dict) else v


def load():
    j = lambda n: json.loads((HERE / n).read_text(encoding="utf-8"))
    return j("schema.jsonld")["@graph"], j("campaign.jsonld")["@graph"], j("graph.json"), j("next-actions.json")


# ---- SVG 部品 ----
def box(x, y, w, h, lines, col, bold=False, dash=False, sw=1.5, anchor="middle"):
    f, s, t = col
    d = ' stroke-dasharray="5 3"' if dash else ""
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{f}" stroke="{s}" stroke-width="{sw}"{d}/>']
    n = len(lines)
    lh = 15
    y0 = y + h / 2 - (n - 1) * lh / 2 + 4
    for i, ln in enumerate(lines):
        wt = ' font-weight="700"' if (i == 0 and bold) else ""
        out.append(f'<text x="{x + w / 2}" y="{y0 + i * lh}" text-anchor="middle" font-size="12" fill="{t}"{wt}>{esc(ln)}</text>')
    return "".join(out)


def arrow(x1, y1, x2, y2, label=None, lx=None, ly=None, dash=False, anchor="middle", color=INK):
    d = ' stroke-dasharray="4 3"' if dash else ""
    out = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="1.6"{d} marker-end="url(#ah)"/>']
    if label:
        out.append(f'<text x="{lx if lx is not None else (x1 + x2) / 2}" y="{ly if ly is not None else (y1 + y2) / 2 - 4}" text-anchor="{anchor}" font-size="11" fill="{MUTED}">{esc(label)}</text>')
    return "".join(out)


DEFS = (
    '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
    f'<path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>'
    '<pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
    '<rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#991b1b" stroke-width="2"/></pattern></defs>'
)


def svg(w, h, body, label, title=None):
    t = f"<title>{esc(title or label)}</title>"
    return (f'<svg viewBox="0 0 {w} {h}" width="{w}" role="img" aria-label="{esc(label)}" xmlns="http://www.w3.org/2000/svg" '
            f'font-family="\'Noto Sans JP\',\'Hiragino Sans\',\'Yu Gothic\',Meiryo,sans-serif">{t}{DEFS}{body}</svg>')


# ---- 数の定義（ここ1か所。全図がこれを使う。図どうしで食い違えば assert で生成を止める） ----
def md(d):
    return f"{int(d[5:7])}/{int(d[8:10])}"


def due_text(due):
    if not due:
        return "期限なし"
    t = md(due[:10])
    return t + (f" {due[11:16]}" if due[11:16] not in ("", "00:00") else "")


class Defs:
    """図に出す数の定義。値はすべて生成物から計算する。

    案 apps        … 適合判定（Fit）のあるアプリ・案。ダッシュボードの「アプリ（N件）」と同じ範囲。
                      それ以外（提出文だけで、アプリのない IN1 等）は extra_apps として別に注記する。
    応募 subs      … Submission。同じ案が複数のコンペに出る・案のない応募（IN1）・応募のない案があるので、案の数とは一致しない。
    提出を止めるもの … 失格級の指摘・未記入欄のあるファイル・未確認のデータ条件（応募についたもの）・提出物の欠落。
                      要修正は別枠（提出可否の判定には入るが「止めるもの」の件数には足さない）。軽微は数えない。
    部隊の作業      … 総司令官以外の部隊の作業（unitActions）。総司令官の作業は別に数える。
    """

    def __init__(self, schema, camp, graph, na):
        self.na, self.graph, self.camp = na, graph, camp
        self.app_label = {n["id"]: n["label"] for n in graph["nodes"] if n["type"] == "App"}
        fits = [x for x in camp if x.get("@type") == "c:Fit"]
        self.fit_apps = {sid(ref(f["c:fitApp"])[0]) for f in fits}
        self.extra_apps = sorted(set(self.app_label) - self.fit_apps)
        assert self.fit_apps <= set(self.app_label), "適合判定にあるのにグラフにないアプリがある"
        self.subs = na["submissions"]
        self.n_subs = len(self.subs)
        self.n_ng = sum(1 for s in self.subs if s["readiness"] == "提出不可")
        self.n_fix = sum(1 for s in self.subs if s["readiness"] != "提出不可")
        assert self.n_ng == na["summary"].get("提出不可", 0) and self.n_fix == na["summary"].get("要修正あり", 0), "判定の件数が next-actions.json の summary と合わない"
        csum = lambda k: sum(s["counts"][k] for s in self.subs)
        self.n_dq, self.n_dq_sure = csum("失格級"), csum("失格級（確定）")
        self.n_fix_items = csum("要修正")
        self.n_unfilled_files = csum("未記入欄ファイル")
        self.n_data = csum("データ条件")
        self.n_miss = csum("提出文なし")
        self.n_stop = self.n_dq + self.n_unfilled_files + self.n_data + self.n_miss
        # 内訳を blockers の一覧から数え直して突き合わせる
        bl = [b for s in self.subs for b in s["blockers"]]
        assert sum(1 for b in bl if b["type"] == "Finding" and b["severity"] == "失格級") == self.n_dq
        assert sum(1 for b in bl if b["type"] == "Finding" and b["severity"] == "要修正") == self.n_fix_items
        assert sum(1 for b in bl if b["type"] == "UnconfirmedDataCondition") == self.n_data
        assert sum(1 for b in bl if b["type"] == "MissingDeliverable") == self.n_miss
        assert sum(1 for s in self.subs if s["counts"]["未記入欄ファイル"]) == sum(1 for s in self.subs if any(b["type"] == "UnfilledField" for b in s["blockers"]))
        # 未確認のデータ条件: 全体（campaign）と、応募についたもの（図2）
        sub_apps = {s["app"] for s in self.subs}
        udc = [x for x in camp if x.get("@type") == "c:UnconfirmedDataCondition"]
        self.n_data_all = len(udc)
        self.data_no_sub = [sid(ref(x["c:affects"])[0]) for x in udc if sid(ref(x["c:affects"])[0]) not in sub_apps]
        assert self.n_data_all - len(self.data_no_sub) == self.n_data, "未確認のデータ条件の全体と応募についた件数が合わない"
        # 次の行動
        lab = na["unitLabels"]
        main_units = ["engineer", "intelligence", "military-police", "aggressor"]
        others = [u for u in na["unitActions"] if u not in main_units and u != "commander"]  # 例: 総司令官補佐の代理マージ判断
        self.unit_rows = [(u, lab.get(u, u), na["unitActions"][u]) for u in main_units + others if u in na["unitActions"]]
        self.n_unit = sum(len(a) for _, _, a in self.unit_rows)
        assert self.n_unit == sum(len(v) for u, v in na["unitActions"].items() if u != "commander"), "部隊の作業の数え漏れ"
        self.cmd_actions = na["unitActions"].get("commander", [])
        self.cmd_decisions = na["commanderDecisions"]
        self.cmd_status = na["statusTasksByAgent"].get("commander", [])
        self.first_due = min(s["deadline"]["at"][:10] for s in self.subs if s.get("deadline"))
        on = lambda items, key: sum(1 for i in items if (i[key] or "")[:10] == self.first_due)
        self.n_dec_first = on(self.cmd_decisions, "due")
        self.n_act_first = on(self.cmd_actions, "due")
        self.n_first = self.n_dec_first + self.n_act_first + on(self.cmd_status, "due")

    def check_fig(self, **got):
        """図の中で数えた値が定義と同じか確かめる。"""
        for k, v in got.items():
            assert getattr(self, k) == v, f"図の {k}={v} が定義 {getattr(self, k)} とずれている"


# ---- 図: 型（クラスと関係） ----
def fig_schema(schema, D):
    classes = {x["@id"]: x for x in schema if x.get("@type") == "owl:Class"}
    props = {x["@id"]: x for x in schema if "ObjectProperty" in str(x.get("@type"))}
    cnt = Counter(str(x.get("@type")) for x in D.camp)
    for k in ["c:App", "c:Submission", "c:Contest", "c:Dataset", "c:License", "c:Blocker"]:
        if k not in classes:
            sys.exit(f"schema.jsonld に {k} がありません")
    rels = [("c:hasSubmission", "c:App", "c:Submission"), ("c:toContest", "c:Submission", "c:Contest"),
            ("c:usesDataset", "c:App", "c:Dataset"), ("c:hasLicense", "c:Dataset", "c:License"),
            ("c:blockedBy", "c:Submission", "c:Blocker"), ("c:affects", "c:Blocker", "c:App")]
    for p, d, r in rels:
        pr = props.get(p)
        if not pr or pr.get("rdfs:domain", {}).get("@id") != d or pr.get("rdfs:range", {}).get("@id") != r:
            sys.exit(f"schema.jsonld の関係 {p} が {d} → {r} ではありません")
    name = lambda c: label_of(classes[c])
    W, bw, bh = 360, 130, 52
    L, R = 10, 220
    ys = [14, 112, 210, 308]
    pos = {"c:Contest": (R, ys[0]), "c:App": (L, ys[1]), "c:Submission": (R, ys[1]), "c:Dataset": (L, ys[2]),
           "c:Blocker": (R, ys[2]), "c:License": (L, ys[3])}
    col = {"c:Contest": BLU, "c:App": WHT, "c:Submission": WHT, "c:Dataset": GRN, "c:License": GRN, "c:Blocker": RED}
    n_contest = cnt["c:Contest"]
    n_data, n_lic = cnt["c:Dataset"], cnt["c:License"]
    lines = {
        "c:Contest": [name("c:Contest"), f"{n_contest} 件"],
        "c:App": [name("c:App"), f"{len(D.fit_apps)} 件"],
        "c:Submission": [name("c:Submission"), f"{D.n_subs} 件"],
        "c:Dataset": [name("c:Dataset"), f"{n_data} 件"],
        "c:License": [name("c:License"), f"{n_lic} 件"],
        "c:Blocker": [name("c:Blocker"), f"提出を止める {D.n_stop} 件"],
    }
    assert cnt["c:Submission"] == D.n_subs, "応募の件数が campaign.jsonld と next-actions.json でずれている"
    b = []
    for c, (x, y) in pos.items():
        b.append(box(x, y, bw, bh, lines[c], col[c], bold=True))
    cx = lambda c: pos[c][0] + bw / 2
    b.append(arrow(L + bw, ys[1] + 20, R, ys[1] + 20, "応募", (L + bw + R) / 2, ys[1] + 14))
    b.append(arrow(cx("c:Submission"), ys[1], cx("c:Contest"), ys[0] + bh, "出すコンペ", cx("c:Contest") + 6, ys[0] + bh + 30, anchor="start"))
    b.append(arrow(cx("c:App"), ys[1] + bh, cx("c:Dataset"), ys[2], "使うデータ", cx("c:App") + 6, ys[2] - 14, anchor="start"))
    b.append(arrow(cx("c:Dataset"), ys[2] + bh, cx("c:License"), ys[3], "ライセンス", cx("c:Dataset") + 6, ys[3] - 14, anchor="start"))
    b.append(arrow(cx("c:Submission"), ys[1] + bh, cx("c:Blocker"), ys[2], "応募につく", cx("c:Submission") - 6, ys[2] - 14, anchor="end"))
    b.append(arrow(R, ys[2] + 8, L + bw, ys[1] + bh - 6, None, dash=True))
    b.append(f'<text x="{cx("c:Blocker")}" y="{ys[2] + bh + 16}" text-anchor="middle" font-size="11" fill="{MUTED}">点線: アプリに影響</text>')
    if D.extra_apps:
        b.append(f'<text x="10" y="{ys[1] - 8}" font-size="11" fill="{MUTED}">＋提出文のみ {len(D.extra_apps)} 件（アプリなし）</text>')
    claim = "提出を止めるのは、応募についた「止めているもの」で、その影響はアプリに及ぶ"
    point = (f"案 {len(D.fit_apps)} 件（ダッシュボードのアプリ数と同じ）から応募 {D.n_subs} 件が出る。止めているもの {D.n_stop} 件は"
             f"失格級 {D.n_dq}・未記入欄のあるファイル {D.n_unfilled_files}・未確認のデータ条件 {D.n_data}・提出物なし {D.n_miss}（要修正 {D.n_fix_items} は別枠）。矢印は「から → へ」。")
    return claim, svg(W, 372, "".join(b), "オントロジーの型。アプリ・案から応募、応募から出すコンペ。アプリはデータを使い、データはライセンスを持つ。応募には止めているものがつき、アプリに影響する。"), point


# ---- 図: 提出を止めているもの（HTML の表。名前を切らず、列見出しを固定） ----
def table_blockers(D):
    order = sorted(D.subs, key=lambda s: (((s["deadline"] or {}).get("at") or "9")[:10], s["label"].split(" → ")[-1], s["label"]))
    groups = []
    for s in order:
        key = (s["deadline"]["at"][:10], s["label"].split(" → ")[-1])
        if not groups or groups[-1][0] != key:
            groups.append([key, []])
        groups[-1][1].append(s)
    cols = [("失格級", "失格級", "dq"), ("要修正", "要修正", "fx"), ("未記入欄ファイル", "未記入欄", "un"), ("データ条件", "データ条件", "da"), ("提出文なし", "提出物なし", "ms")]
    th = "".join(f'<th scope="col" class="n">{esc(n)}</th>' for _, n, _ in cols)
    rows = [f'<thead><tr><th scope="col" class="nm">応募</th><th scope="col" class="jd">判定</th>{th}</tr></thead><tbody>']
    tot = Counter()
    for (d, tail), ss in groups:
        rows.append(f'<tr class="grp"><th colspan="7" scope="colgroup">{esc(md(d))} 締切　{esc(tail)}</th></tr>')
        for s in ss:
            ng = s["readiness"] == "提出不可"
            nm = D.app_label.get(s["app"], s["label"].split(" → ")[0])
            if s["app"] in D.extra_apps:
                nm += "（提出文のみ・アプリなし）"
            cells = []
            for k, _, cls in cols:
                v = s["counts"][k]
                tot[k] += v
                cells.append(f'<td class="n {cls if v else "z"}">{v if v else "–"}</td>')
            rows.append(f'<tr><th scope="row" class="nm">{esc(nm)}</th><td class="jd {"ngc" if ng else "fxc"}">{"提出不可" if ng else "要修正"}</td>{"".join(cells)}</tr>')
    rows.append('<tr class="sum"><th scope="row" class="nm">合計</th><td class="jd">' + f'提出不可 {D.n_ng}</td>' + "".join(f'<td class="n">{tot[k]}</td>' for k, _, _ in cols) + "</tr></tbody>")
    D.check_fig(n_dq=tot["失格級"], n_fix_items=tot["要修正"], n_unfilled_files=tot["未記入欄ファイル"], n_data=tot["データ条件"], n_miss=tot["提出文なし"])
    claim = f"{D.n_subs} 応募のうち {D.n_ng} 応募が「提出不可」、残り {D.n_fix} 応募は「要修正」"
    point = (f"提出を止めるもの {D.n_stop} 件の内訳は、失格級 {D.n_dq}（確定 {D.n_dq_sure}・要確認 {D.n_dq - D.n_dq_sure}）・未記入欄のあるファイル {D.n_unfilled_files}・"
             f"未確認のデータ条件 {D.n_data}・提出物なし {D.n_miss}。要修正 {D.n_fix_items} 件は別枠。–は 0。")
    html_ = f'<div class="tblwrap"><table class="bt">{"".join(rows)}</table></div>'
    return claim, html_, point


# ---- 図: 次の行動（締切順）と、総司令官の一覧 ----
def fig_next(D, graph):
    na = D.na
    asof = dt.date.fromisoformat(na["asOf"])
    day = lambda d: (dt.date.fromisoformat(d) - asof).days
    cnt_by = lambda items, key: Counter(((i[key] or "none")[:10]) for i in items)
    rows = [("総司令官の判断待ち", "", cnt_by(D.cmd_decisions, "due"), True),
            ("総司令官の作業", "（指摘の解消）", cnt_by(D.cmd_actions, "due"), True),
            ("総司令官の作業", "（進捗一覧）", cnt_by(D.cmd_status, "due"), True)]
    for u, nm, acts in D.unit_rows:
        rows.append((nm, "", cnt_by(acts, "due"), False))
    D.check_fig(n_unit=sum(sum(c.values()) for _, _, c, h in rows if not h))
    dates = sorted({d for *_, c, _h in rows for d in c if d != "none"})
    W, lw = 360, 112
    ax0, ax1 = lw + 8, 286
    span = max(day(d) for d in dates)
    xs = lambda d: ax0 + (ax1 - ax0) * day(d) / span
    xnone = 338
    rr = lambda n: max(9.5, 4.4 * math.sqrt(n))
    rh = 40
    top = 50
    b = []
    bot = top + rh * len(rows) - 14
    for i, d in enumerate(dates):
        x = xs(d)
        b.append(f'<text x="{x}" y="{14 + 13 * (i % 2)}" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">{md(d)}</text>')
        b.append(f'<line x1="{x}" y1="{28 + 0}" x2="{x}" y2="{bot}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 3"/>')
    b.append(f'<text x="{xnone}" y="14" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">期限なし</text>')
    b.append(f'<line x1="{xnone}" y1="28" x2="{xnone}" y2="{bot}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 3"/>')
    for i, (nm, sub, cnt, human) in enumerate(rows):
        cy = top + i * rh + 8
        if human:
            b.append(f'<rect x="0" y="{cy - 20}" width="{W}" height="{rh - 2}" fill="#fff7ed"/>')
        ty = cy + (0 if sub else 4)
        b.append(f'<text x="6" y="{ty}" font-size="11" fill="{INK}" font-weight="{700 if human else 400}">{esc(nm)}</text>')
        if sub:
            b.append(f'<text x="6" y="{ty + 13}" font-size="11" fill="{INK}">{esc(sub)}</text>')
        for d, n in cnt.items():
            x = xnone if d == "none" else xs(d)
            r = rr(n)
            f, s, t = (AMB if human else BLU)
            b.append(f'<circle cx="{x}" cy="{cy}" r="{r}" fill="{f}" stroke="{s}" stroke-width="{2.5 if human else 1.5}"/>')
            b.append(f'<text x="{x}" y="{cy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="{t}">{n}</text>')
    H = bot + 22
    first = D.first_due
    claim = f"総司令官は、{md(first)} の締切までに判断 {D.n_dec_first} 件・作業 {D.n_act_first} 件を抱えている"
    point = (f"円の面積が件数、横軸は日数に比例。総司令官の行（塗り）は人間の関門で、自動では進めない。部隊の作業は計 {D.n_unit} 件"
             f"（工兵・情報部・憲兵・アグレッサー）で、総司令官の作業とは別に数えた。")
    # 一覧（項目・締切・対象の応募）
    items = []
    for d in D.cmd_decisions:
        items.append(("判断待ち", d["label"], d["due"], "—"))
    for a in D.cmd_actions:
        items.append(("作業（指摘の解消）", a["action"], a["due"], D.app_label.get(a["app"], a["app"])))
    for t in D.cmd_status:
        items.append(("作業（進捗一覧）", t["text"], t["due"], D.app_label.get(t["app"], t["app"]) if t["app"] else "—"))
    assert len(items) == len(D.cmd_decisions) + len(D.cmd_actions) + len(D.cmd_status)
    return claim, svg(W, H, "".join(b), "締切順の次の行動。横軸は日数に比例。総司令官の判断待ち、総司令官の作業、部隊の作業ごとの件数。円の面積が件数。"), point, items


def table_items(items):
    out = ['<div class="tblwrap"><table class="it"><thead><tr><th scope="col" class="k">種類</th><th scope="col">項目</th><th scope="col" class="d">締切</th><th scope="col" class="a">対象の応募</th></tr></thead><tbody>']
    for k, it, due, app in items:
        out.append(f'<tr><td class="k">{esc(k)}</td><th scope="row">{esc(it)}</th><td class="d">{esc(due_text(due))}</td><td class="a">{esc(app)}</td></tr>')
    out.append("</tbody></table></div>")
    return "".join(out)


# ---- 図: データ条件と影響 ----
def risky_datasets(camp):
    by = {x["@id"]: x for x in camp}
    out = {}
    for x in camp:
        t = x.get("@type")
        if t == "c:Dataset":
            for lid in ref(x.get("c:hasLicense")):
                l = by.get(lid, {})
                st = str(l.get("c:conditionStatus", ""))
                if "c:NonCommercial" in ref(l.get("c:restricts")):
                    out.setdefault(sid(x["@id"]), "非商用")
                elif st.startswith("未確認"):
                    out.setdefault(sid(x["@id"]), "条件が未確認")
        if t == "c:UnconfirmedDataCondition":
            for d in ref(x.get("c:overDataset")):
                out.setdefault(sid(d), "未確認と記録")
    return out, {sid(x["@id"]): label_of(x) for x in camp if x.get("@type") == "c:Dataset"}


def fig_data(D, graph):
    risky, dlabel = risky_datasets(D.camp)
    impact = D.na["dataImpactAll"]
    contest_name = {n["id"]: n["label"] for n in graph["nodes"] if n["type"] in ("Contest", "Division")}
    sub_of = defaultdict(list)
    for s in D.subs:
        sub_of[s["app"]].append(s)
    rows = []
    for d, why in sorted(risky.items()):
        im = impact.get(d, {})
        apps = im.get("apps", {})
        cs = defaultdict(set)
        for s in im.get("submissions", []):
            nm = contest_name.get(s["contest"], s["contest"])
            if s.get("division"):
                nm = contest_name.get(s["division"], nm)
            cs["id:app/" + s["submission"].split("/")[1]].add(nm)
        rows.append((d, why, apps, cs))
    rows.sort(key=lambda r: (-len(r[2]), r[0]))
    W, lw = 360, 20
    b = []
    y = 4
    colmap = {"非商用": RED, "条件が未確認": AMB, "未確認と記録": AMB}
    apps_all, apps_sub, apps_rec = set(), set(), set()
    for d, why, apps, cs in rows:
        f, s, t = colmap.get(why, AMB)
        nm_lines = wrap(dlabel.get(d, d), 25)
        hh = 8 + 16 * len(nm_lines) + 16
        b.append(f'<g><title>{esc(dlabel.get(d, d))}</title><rect x="0" y="{y}" width="{W}" height="{hh}" rx="5" fill="{f}" stroke="{s}" stroke-width="1.5"/>')
        for k, ln in enumerate(nm_lines):
            b.append(f'<text x="8" y="{y + 20 + 16 * k}" font-size="12" font-weight="700" fill="{t}">{esc(ln)}</text>')
        b.append(f'<text x="8" y="{y + hh - 6}" font-size="11" font-weight="700" fill="{t}">【{esc(why)}】</text></g>')
        y0 = y + hh
        y += hh + 4
        if not apps:
            b.append(f'<text x="{lw}" y="{y + 12}" font-size="11" fill="{MUTED}">使うアプリの記録なし</text>')
            y += 22
        for aid in apps:
            apps_all.add(aid)
            aname = D.app_label.get(aid, aid)
            subs_a = sub_of.get(aid, [])
            ct = "、".join(sorted({x.replace("アワード2026", "").replace("チャレンジ2026", "").replace("2026–2027", "").replace("2026", "") for x in cs.get(aid, [])}))
            if subs_a:
                apps_sub.add(aid)
                rec = any(s_["counts"]["データ条件"] for s_ in subs_a)
                if rec:
                    apps_rec.add(aid)
                status = "応募に「止めているもの」の記録: " + ("あり" if rec else "なし（要確認）")
            else:
                status = "応募の記録なし（案の段階）"
            lines = wrap(aname, 29)
            tl = wrap("→ 応募先: " + (ct or "なし"), 27)
            sl = wrap(status, 27)
            b.append(f'<line x1="10" y1="{y0}" x2="10" y2="{y + 12}" stroke="{INK}" stroke-width="1.2"/><line x1="10" y1="{y + 12}" x2="{lw - 2}" y2="{y + 12}" stroke="{INK}" stroke-width="1.2"/>')
            yy = y + 10
            for k, ln in enumerate(lines):
                b.append(f'<text x="{lw + 2}" y="{yy}" font-size="11" font-weight="700" fill="{INK}">{esc(ln)}</text>')
                yy += 13
            for ln in tl + sl:
                b.append(f'<text x="{lw + 2}" y="{yy}" font-size="11" fill="{MUTED}">{esc(ln)}</text>')
                yy += 13
            y0 = y + 12
            y = yy + 4
        y += 6
    # 図2 との突き合わせ: 応募に記録がある案は、必ずこの図の案に含まれる
    assert apps_rec <= apps_all
    n_sub = len({s_["submission"] for aid in apps_sub for s_ in sub_of[aid]})
    n_rec_sub = len(apps_rec)
    claim = f"利用条件が未確認・非商用のデータ {len(rows)} 件を使う案は {len(apps_all)} 件で、うち {len(apps_sub)} 案の応募 {n_sub} 件が影響を受けうる"
    point = (f"未確認のデータ条件 {D.n_data_all} 件のうち {D.n_data} 件が応募についている（図「止めているもの」の{D.n_data}件。残り {len(D.data_no_sub)} 件は応募のない案）。"
             f"データを使うのに応募へ記録がない案が {len(apps_sub) - n_rec_sub} 件あるのは、記録の範囲の差で、要確認。")
    return claim, svg(W, y + 4, "".join(b), f"利用条件に注意が要るデータ{len(rows)}件と、それを使うアプリ、応募先のコンペ。"), point


# ---- 図: 適合 ----
MARKS = {"◎": (GRN, "出せる（強い）"), "○": (GRN, "出せる"), "△": (AMB, "条件つき"), "×": (RED, "出せない"), "？": (GRY, "未確認")}
SCORE = {"◎": 3, "○": 2, "△": 1, "×": 0, "？": 0}


def fig_fit(D, graph):
    fits = [x for x in D.camp if x.get("@type") == "c:Fit"]
    tgt = [("id:contest/udc-2026", "UDC"), ("id:contest/satellite-2026", "衛星"), ("id:division/ichibiz-2026/business", "ビジネス"),
           ("id:division/ichibiz-2026/idea", "アイデア"), ("id:division/ichibiz-2026/realestate", "不動産"), ("id:contest/odpt-2026", "ODPT")]
    cell = {}
    for f in fits:
        cell[(sid(ref(f["c:fitApp"])[0]), sid(ref(f["c:fitTarget"])[0]))] = f["c:mark"]
    apps = sorted({a for a, _ in cell}, key=lambda a: (-sum(SCORE[cell[(a, t)]] for t, _ in tgt if (a, t) in cell), a))
    D.check_fig(fit_apps=set(apps))
    W, lw, cw = 360, 100, 43.3
    b = []
    y = 4
    for i, (_, nm) in enumerate(tgt):
        b.append(f'<text x="{lw + i * cw + cw / 2}" y="{y + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">{esc(nm)}</text>')
    y += 20
    cnt = Counter()
    for a in apps:
        b.append(f'<text x="6" y="{y + 18}" font-size="11" fill="{INK}"><title>{esc(D.app_label.get(a, a))}</title>{esc(short(D.app_label.get(a, a), 9))}</text>')
        for i, (t, _) in enumerate(tgt):
            m = cell.get((a, t))
            if m is None:
                continue
            cnt[m] += 1
            f, s, tx = MARKS[m][0]
            b.append(f'<rect x="{lw + i * cw + 2}" y="{y + 2}" width="{cw - 4}" height="22" rx="3" fill="{f}" stroke="{s}" stroke-width="{2 if m == "◎" else 1}"/>')
            b.append(f'<text x="{lw + i * cw + cw / 2}" y="{y + 19}" text-anchor="middle" font-size="14" font-weight="700" fill="{tx}">{m}</text>')
        y += 26
    ly = y + 8
    lx = 6
    for m, (c, nm) in MARKS.items():
        f, s, tx = c
        b.append(f'<rect x="{lx}" y="{ly}" width="20" height="18" rx="3" fill="{f}" stroke="{s}"/><text x="{lx + 10}" y="{ly + 14}" text-anchor="middle" font-size="12" font-weight="700" fill="{tx}">{m}</text>')
        b.append(f'<text x="{lx + 24}" y="{ly + 14}" font-size="11" fill="{INK}">{nm}</text>')
        lx += 24 + 11 * len(nm) + 10
        if lx > 230 and m == "△":
            lx = 6
            ly += 24
    H = ly + 28
    good = {a for a in apps if any(cell.get((a, t)) in ("◎", "○") for t, _ in tgt)}
    none_ok = [a for a in apps if a not in good]
    unk_col = max(tgt, key=lambda t: sum(1 for a in apps if cell.get((a, t[0])) == "？"))
    n_unk = sum(1 for a in apps if cell.get((a, unk_col[0])) == "？")
    claim = (f"{len(good)} 案は ◎か○で出せる先があり、{len(none_ok)} 案は △・×・？の先だけ" if none_ok else f"{len(good)} 案すべてに、◎か○で出せる先がある")
    point = (f"{len(apps)} 案 × {len(tgt)} 先 = {len(cell)} 組（◎{cnt['◎']}・○{cnt['○']}・△{cnt['△']}・×{cnt['×']}・？{cnt['？']}）。"
             f"？が最も多い先は「{unk_col[1]}」（{n_unk} 案）。×は「出せない」の意味で、他の図の判定には使わない。"
             "出せるかどうか（要項との適合）の判定で、提出文や監査の準備状況の評価ではない。")
    return claim, svg(W, H, "".join(b), f"{len(apps)}案とコンペ・部門の適合。◎○△×？の記号。"), point


CSS = """
:root{--ink:#1f2937;--muted:#4b5563;--line:#d1d5db;--bg:#f9fafb;--hh:44px}
*{box-sizing:border-box}
html{scroll-padding-top:56px}
body{margin:0;font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;font-size:15px}
header.top{background:#fff;border-bottom:1px solid var(--line);padding:0 12px;position:sticky;top:0;z-index:5;display:flex;gap:6px 6px;flex-wrap:wrap;align-items:center;min-height:var(--hh)}
header.top a{color:#1e3a8a;font-weight:700;font-size:14px;text-decoration:underline;padding:10px 6px;display:inline-block}
main{max-width:960px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:8px 0 6px}
h2{font-size:17px;margin:0 0 8px;line-height:1.5}
.lead{font-size:13px;color:var(--muted);margin:0 0 10px}
.now{background:#fff7ed;border:2px solid #78350f;border-radius:8px;padding:8px 12px;margin:0 0 12px;font-size:14px;color:#78350f}
.now a{color:#78350f;font-weight:700}
nav.toc ul{display:flex;flex-wrap:wrap;gap:0 6px;margin:0 0 14px;padding:0;list-style:none;font-size:13px}
nav.toc a{color:#1e3a8a;font-weight:700;display:inline-block;padding:8px 8px}
section.fig{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 18px;min-width:0;scroll-margin-top:56px}
figure{margin:0}
.svgwrap{max-width:440px;margin:6px auto}
.svgwrap svg{width:100%;height:auto;display:block}
.point{margin:8px 0 0;font-size:14px}
.gate{display:inline-block;border:2px solid #78350f;background:#fef3c7;color:#78350f;font-weight:700;font-size:12px;padding:1px 8px;border-radius:4px;margin-right:6px}
details{margin-top:8px;font-size:13px;color:var(--muted)}
details summary{cursor:pointer;color:var(--ink);font-weight:700;padding:6px 0}
details ul{margin:6px 0 0;padding-left:20px}
.tblwrap{max-width:760px;margin:6px auto}
table{border-collapse:collapse;width:100%;font-size:13px;line-height:1.45}
table th,table td{border-bottom:1px solid var(--line);padding:5px 6px;text-align:left;vertical-align:top}
table.bt thead th{position:sticky;top:var(--hh);background:#fff;z-index:2;border-bottom:2px solid var(--ink);text-align:center;font-size:12px}
table.bt td.n,table.bt th.n{text-align:center;width:11%}
table.bt td.jd{text-align:center;width:14%;font-weight:700;white-space:nowrap}
table.bt th.nm{font-weight:400}
table.bt tr.grp th{background:#f3f4f6;font-size:12px;border-bottom:1px solid var(--line)}
table.bt td.dq{background:#fee2e2;color:#7f1d1d;font-weight:700;border:2px solid #991b1b}
table.bt td.fx,table.bt td.un,table.bt td.da,table.bt td.ms{background:#fef3c7;color:#78350f;font-weight:700}
table.bt td.z{color:var(--muted)}
table.bt td.ngc{background:#fee2e2;color:#7f1d1d}
table.bt td.fxc{background:#fef3c7;color:#78350f;border:2px dashed #92400e}
table.bt tr.sum th,table.bt tr.sum td{border-top:2px solid var(--ink);font-weight:700}
table.it th[scope=row]{font-weight:400}
table.it td.k{width:15%;font-weight:700;font-size:12px}
table.it td.d{width:13%;white-space:nowrap}
table.it td.a{width:24%}
@media (max-width:600px){main{padding:6px}section.fig{padding:6px!important}table{font-size:12px}table.it td.k{font-size:11px}
table.it,table.it tbody,table.it tr,table.it td,table.it th{display:block;width:auto!important}table.it thead{display:none}table.it tr{padding:6px 0;border-bottom:1px solid var(--line)}table.it td,table.it th{border:0;padding:1px 4px}table.it td.d::before{content:'締切 '}table.it td.a::before{content:'対象 '}table.it td.d,table.it td.a{color:var(--muted)}}
footer{font-size:12px;color:var(--muted);margin:24px 0 40px}
footer p{margin:4px 0}
"""


def page(schema, camp, graph, na, generated):
    D = Defs(schema, camp, graph, na)
    f_next = fig_next(D, graph)
    f_block = table_blockers(D)
    f_data = fig_data(D, graph)
    f_fit = fig_fit(D, graph)
    f_types = fig_schema(schema, D)
    first = D.first_due
    items = f_next[3]
    until_first = [i for i in items if (i[2] or "")[:10] <= first and i[2]]
    later = [i for i in items if i[2] and i[2][:10] > first]
    nodue = [i for i in items if not i[2]]
    until_first.sort(key=lambda i: (i[2], i[0]))
    later.sort(key=lambda i: (i[2], i[0]))
    assert len(until_first) + len(later) + len(nodue) == len(items)
    assert len(until_first) == D.n_first, "総司令官の最初の締切までの一覧と件数がずれている"

    def sec(i, anchor, fig, extra="", gate=False, body=None):
        claim, svgs, point = fig[0], fig[1], fig[2]
        g = '<span class="gate">総司令官の判断</span>' if gate else ""
        inner = body if body is not None else f'<div class="svgwrap">{svgs}</div>'
        return (f'<section class="fig" id="{anchor}" aria-labelledby="h-{anchor}"><h2 id="h-{anchor}">{i}. {esc(claim)}</h2>'
                f'<figure>{inner}<figcaption class="point">{g}{esc(point)}</figcaption></figure>{extra}</section>')

    ex_next = (f'<h3 style="font-size:14px;margin:14px 0 2px">総司令官がやること（{md(first)} まで、{len(until_first)} 件）</h3>' + table_items(until_first)
               + f'<details><summary>それ以降の期限つき（{len(later)} 件）</summary>{table_items(later)}</details>'
               + f'<details><summary>期限の記録がない総司令官の判断・作業（{len(nodue)} 件）</summary>{table_items(nodue)}</details>')
    leg = defaultdict(list)
    for s in D.subs:
        tail = s["label"].split(" → ")[-1]
        if s.get("deadline") and tail not in leg[s["deadline"]["at"][:10]]:
            leg[s["deadline"]["at"][:10]].append(tail)
    ex_next += "<details><summary>日付とコンペ</summary><ul>" + "".join(f"<li>{esc(md(d))}: {esc('、'.join(v))}</li>" for d, v in sorted(leg.items())) + "</ul></details>"
    secs = [
        sec(1, "next", f_next, ex_next, gate=True),
        sec(2, "blockers", f_block, '<details><summary>読み方と数え方</summary><ul>'
            '<li>失格級: 憲兵の監査の指摘のうち「失格級」（確定と要確認）。要修正: 同じく「要修正」。軽微の指摘は提出を止めないので数えない。</li>'
            '<li>未記入欄: 応募文に未記入の欄が残るファイルの本数（部隊は代筆しない。生成AI条項）。</li>'
            '<li>データ条件: 利用条件が未確認のデータ（応募についたもの）。提出物なし: 応募文などの提出物がまだ作られていない。</li>'
            '<li>判定の規則は contests/ontology/next_actions.py（失格級・未記入欄・データ条件・提出文の欠落がなく、要修正がなく、監査があり、案の選定が済んでいること）。</li></ul></details>',
            body=f_block[1]),
        sec(3, "data", f_data, "", gate=True),
        sec(4, "fit", f_fit, "", gate=True),
        sec(5, "types", f_types, ""),
    ]
    toc = "".join(f'<li><a href="#{a}">{esc(t)}</a></li>' for a, t in [("next", "1 次の行動"), ("blockers", "2 止めているもの"), ("data", "3 データ条件"), ("fit", "4 適合"), ("types", "5 型（つながり方）")])
    asof = na["asOf"]
    extra_txt = "、".join(D.app_label[a] for a in D.extra_apps)
    defs = ('<details><summary>数の定義（図のあいだで数をそろえた決まり）</summary><ul>'
            f'<li>案 {len(D.fit_apps)} 件: 適合判定のあるアプリ・案（ダッシュボードの「アプリ」と同じ範囲）。別に、提出文のみでアプリのないもの {len(D.extra_apps)} 件（{esc(extra_txt)}）。</li>'
            f'<li>応募 {D.n_subs} 件: 同じ案が複数のコンペに出る・案のない応募・応募のない案があるので、案の数とは一致しない。</li>'
            f'<li>提出を止めるもの {D.n_stop} 件 = 失格級 {D.n_dq} + 未記入欄のあるファイル {D.n_unfilled_files} + 未確認のデータ条件 {D.n_data}（応募についたもの。全体では {D.n_data_all}） + 提出物なし {D.n_miss}。要修正 {D.n_fix_items} 件は別枠、軽微は数えない。</li>'
            f'<li>総司令官の作業と判断待ち（判断待ち {len(D.cmd_decisions)}・作業 {len(D.cmd_actions)}・進捗一覧の作業 {len(D.cmd_status)}）と、部隊の作業 {D.n_unit} 件は別に数える。</li>'
            '<li>「総司令官の判断」の札は、案の選定・提出・registry 変更・ページ削除など、自動では進めない人間の関門。</li>'
            '<li>図どうしの同じ量は生成時に突き合わせ、ずれれば生成が止まる。</li></ul></details>')
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>オントロジーの図解（要約）｜統合ダッシュボード</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<header class="top"><a href="../index.html">ダッシュボード</a><a href="../ontology/index.html">つながり図</a></header>
<main id="main">
<h1>オントロジーの図解（要約）: 次に誰が何をするか、何が提出を止めているか</h1>
<p class="now" role="note"><strong>{esc(md(first))} まで:</strong> 総司令官の判断待ち {D.n_dec_first} 件・作業 {D.n_act_first} 件（<a href="#next">一覧へ</a>）／提出不可 {D.n_ng} 応募・要修正 {D.n_fix} 応募（<a href="#blockers">内訳へ</a>）</p>
<p class="lead">{esc(asof)} 時点の記録から生成。案の選定・提出・registry 変更・ページ削除は<strong>総司令官の判断</strong>（自動では進めない関門）で、このページからは進めません。</p>
<nav class="toc" aria-label="図の一覧"><ul>{toc}</ul></nav>
{''.join(secs)}
{defs}
<footer>
<p>生成日: {esc(generated)}（記録の基準日: {esc(asof)}）。生成コマンド: <code>python3 contests/ontology/figures.py</code></p>
<p>出典（すべて contests/ontology/）: schema.jsonld（型と関係）、campaign.jsonld（件数・データの利用条件・適合判定）、graph.json（名前）、next-actions.json（件数・次の行動・判断待ち・データの影響）。数値は手で書き写さず、このスクリプトが計算した。</p>
<p>図の作り方は u-ichi/agent-plugins の figure-docs（MIT License, Copyright (c) 2026 u-ichi。事業の図の分類は Financial Times Visual Vocabulary〈MIT〉による）に従った。</p>
</footer>
</main>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--today", default=None, help="生成日（YYYY-MM-DD。既定は記録の基準日 asOf。再現性のため）")
    a = ap.parse_args()
    schema, camp, graph, na = load()
    if graph.get("asOf") != na.get("asOf"):
        sys.exit(f"graph.json（{graph.get('asOf')}）と next-actions.json（{na.get('asOf')}）の基準日が違います。再生成してください")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(page(schema, camp, graph, na, a.today or na["asOf"]), encoding="utf-8")
    print(f"figures: wrote {out}")


if __name__ == "__main__":
    main()
