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


# ---- 図1: 型（クラスと関係） ----
def fig_schema(schema, camp, graph):
    classes = {x["@id"]: x for x in schema if x.get("@type") == "owl:Class"}
    props = {x["@id"]: x for x in schema if "ObjectProperty" in str(x.get("@type"))}
    sub = {k: v.get("rdfs:subClassOf", {}).get("@id") for k, v in classes.items() if isinstance(v.get("rdfs:subClassOf"), dict)}

    def inherits(c, root):
        while c:
            if c == root:
                return True
            c = sub.get(c)
        return False

    cnt = Counter(str(x.get("@type")) for x in camp)
    n_of = lambda cls: sum(v for k, v in cnt.items() if inherits(k, cls))
    # 部品（6つ）と、その関係。名前と向きは schema.jsonld から取り、見つからなければ止める
    need = {
        "c:App": None, "c:Submission": None, "c:Contest": None, "c:Dataset": None, "c:License": None, "c:Blocker": None,
    }
    for k in need:
        if k not in classes:
            sys.exit(f"schema.jsonld に {k} がありません")
    rels = [("c:hasSubmission", "c:App", "c:Submission"), ("c:toContest", "c:Submission", "c:Contest"),
            ("c:usesDataset", "c:App", "c:Dataset"), ("c:hasLicense", "c:Dataset", "c:License"),
            ("c:blockedBy", "c:Submission", "c:Blocker"), ("c:affects", "c:Blocker", "c:App")]
    rl = {}
    for p, d, r in rels:
        pr = props.get(p)
        if not pr or pr.get("rdfs:domain", {}).get("@id") != d or pr.get("rdfs:range", {}).get("@id") != r:
            sys.exit(f"schema.jsonld の関係 {p} が {d} → {r} ではありません")
        rl[p] = label_of(pr)
    name = lambda c: label_of(classes[c])
    W, bw, bh = 360, 130, 52
    L, R = 10, 220
    ys = [14, 112, 210, 308]
    pos = {"c:Contest": (R, ys[0]), "c:App": (L, ys[1]), "c:Submission": (R, ys[1]), "c:Dataset": (L, ys[2]),
           "c:Blocker": (R, ys[2]), "c:License": (L, ys[3])}
    col = {"c:Contest": BLU, "c:App": WHT, "c:Submission": WHT, "c:Dataset": GRN, "c:License": GRN, "c:Blocker": RED}
    b = []
    for c, (x, y) in pos.items():
        b.append(box(x, y, bw, bh, [name(c), f"{n_of(c)} 件"], col[c], bold=True))
    cx = lambda c: pos[c][0] + bw / 2
    # アプリ → 応募
    b.append(arrow(L + bw, ys[1] + 20, R, ys[1] + 20, rl["c:hasSubmission"], (L + bw + R) / 2, ys[1] + 14))
    # 応募 → コンペ（上へ）
    b.append(arrow(cx("c:Submission"), ys[1], cx("c:Contest"), ys[0] + bh, rl["c:toContest"], cx("c:Contest") + 6, ys[0] + bh + 30, anchor="start"))
    # アプリ → データ → ライセンス（下へ）
    b.append(arrow(cx("c:App"), ys[1] + bh, cx("c:Dataset"), ys[2], rl["c:usesDataset"], cx("c:App") + 6, ys[2] - 14, anchor="start"))
    b.append(arrow(cx("c:Dataset"), ys[2] + bh, cx("c:License"), ys[3], rl["c:hasLicense"], cx("c:Dataset") + 6, ys[3] - 14, anchor="start"))
    # 応募 → 止めているもの（下へ）
    b.append(arrow(cx("c:Submission"), ys[1] + bh, cx("c:Blocker"), ys[2], rl["c:blockedBy"], cx("c:Submission") - 6, ys[2] - 14, anchor="end"))
    # 止めているもの → アプリ（点線の斜め）
    b.append(arrow(R, ys[2] + 8, L + bw, ys[1] + bh - 6, None, dash=True))
    b.append(f'<text x="{cx("c:Blocker")}" y="{ys[2] + bh + 16}" text-anchor="middle" font-size="11" fill="{MUTED}">点線: {esc(rl["c:affects"])}</text>')
    # 止めているものの種類
    kinds = [c for c in classes if sub.get(c) == "c:Blocker"]
    kinds.sort(key=lambda c: -n_of(c))
    txt = "止めているものの種類: " + "、".join(f"{name(c)} {n_of(c)}" for c in kinds)
    note = txt
    body = "".join(b)
    claim = "コンペ・応募・アプリ・データ・ライセンスがつながり、その間に「止めているもの」が挟まる"
    point = (f"提出を止めるのは、応募につく「止めているもの」（{'、'.join(name(c) for c in kinds)} の{len(kinds)}種）。"
             "矢印の向きは「から → へ」、点線は影響の向き。")
    return claim, svg(W, 372, body, "オントロジーの型。アプリ・案から応募、応募から出すコンペ。アプリはデータを使い、データはライセンスを持つ。応募には止めているものがつき、アプリに影響する。"), point, note


# ---- 図2: 提出を止めているもの ----
COLS = [("失格級", ("失格級",), RED), ("要修正", ("要修正",), AMB), ("未記入欄ファイル", ("未記入欄", "のファイル"), AMB),
        ("データ条件", ("データ", "条件"), AMB), ("提出文なし", ("提出物", "なし"), AMB)]


def fig_blockers(na, graph):
    subs = na["submissions"]
    app_label = {n["id"]: n["label"] for n in graph["nodes"] if n["type"] == "App"}
    order = sorted(subs, key=lambda s: (((s["deadline"] or {}).get("at") or "9")[:10], s["label"].split(" → ")[-1], s["label"]))
    groups = []
    for s in order:
        tail = s["label"].split(" → ")[-1]
        key = (s["deadline"]["at"][:10], tail)
        if not groups or groups[-1][0] != key:
            groups.append([key, []])
        groups[-1][1].append(s)
    W, lw, cw = 360, 110, 50
    x0 = lw
    y = 4
    b = []
    # 列見出し
    for i, (_, nm, _) in enumerate(COLS):
        for j, ln in enumerate(nm):
            b.append(f'<text x="{x0 + i * cw + cw / 2}" y="{y + 12 + j * 13}" text-anchor="middle" font-size="11" fill="{INK}" font-weight="700">{esc(ln)}</text>')
    y += 32
    tot = [0] * len(COLS)
    mx = max((s["counts"][k] for s in subs for k, _, _ in COLS), default=1)
    for (d, tail), ss in groups:
        md = f"{int(d[5:7])}/{int(d[8:10])}"
        b.append(f'<rect x="0" y="{y}" width="{W}" height="20" fill="{GRY[0]}"/>')
        b.append(f'<text x="6" y="{y + 14}" font-size="11" fill="{INK}" font-weight="700">{esc(md)} 締切　{esc(short(tail, 24))}</text>')
        y += 22
        for s in ss:
            name = app_label.get(s["app"], s["label"].split(" → ")[0])
            ok = s["readiness"] != "提出不可"
            b.append(f'<g><title>{esc(s["label"])}（判定: {esc(s["readiness"])}）</title>')
            b.append(f'<text x="6" y="{y + 17}" font-size="11" fill="{INK}">{esc(short(name, 10))}</text>')
            for i, (k, _, c) in enumerate(COLS):
                v = s["counts"][k]
                tot[i] += v
                cx = x0 + i * cw
                if v:
                    f, st, t = c
                    b.append(f'<rect x="{cx + 2}" y="{y + 2}" width="{cw - 4}" height="22" rx="3" fill="{f}" stroke="{st}" stroke-width="{2 if c is RED else 1}"/>')
                    b.append(f'<text x="{cx + cw / 2}" y="{y + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="{t}">{v}</text>')
                else:
                    b.append(f'<text x="{cx + cw / 2}" y="{y + 18}" text-anchor="middle" font-size="11" fill="{MUTED}">–</text>')
            b.append("</g>")
            y += 26
        y += 4
    # 合計
    b.append(f'<line x1="0" y1="{y}" x2="{W}" y2="{y}" stroke="{INK}" stroke-width="1.5"/>')
    b.append(f'<text x="6" y="{y + 18}" font-size="12" font-weight="700" fill="{INK}">合計</text>')
    for i, v in enumerate(tot):
        b.append(f'<text x="{x0 + i * cw + cw / 2}" y="{y + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="{INK}">{v}</text>')
    H = y + 28
    n = len(subs)
    ng = sum(1 for s in subs if s["readiness"] == "提出不可")
    claim = f"{n} 応募のうち {ng} 応募が「提出不可」です"
    k_dis = tot[0]
    k_det = sum(s["counts"]["失格級（確定）"] for s in subs)
    point = (f"失格級の指摘は {k_dis} 件（確定 {k_det}・要確認 {k_dis - k_det}）、未記入欄のあるファイルは {tot[2]} 本、未確認のデータ条件は {tot[3]} 件、"
             f"提出文がない応募は {tot[4]} 件。数字は各応募の件数で、–は 0。")
    return claim, svg(W, H, "".join(b), f"{n}応募ごとの、提出を止めているものの件数。失格級、要修正、未記入欄、データ条件、提出物なし。"), point, tot


# ---- 図3: 次の行動（締切順） ----
def fig_next(na, graph):
    subs = na["submissions"]
    deadlines = sorted({s["deadline"]["at"][:10] for s in subs if s.get("deadline")})
    asof = dt.date.fromisoformat(na["asOf"])
    day = lambda d: (dt.date.fromisoformat(d) - asof).days
    lab = na["unitLabels"]
    rows = []
    cd = na["commanderDecisions"]
    rows.append(("総司令官の判断待ち", Counter(((d["due"] or "none")[:10]) for d in cd), True))
    for u in ["commander", "engineer", "intelligence", "military-police", "aggressor"]:
        if u in na["unitActions"]:
            rows.append((lab.get(u, u) + ("の作業" if u == "commander" else ""), Counter((a["due"] or "none")[:10] for a in na["unitActions"][u]), u == "commander"))
    W, lw = 360, 118
    span = max(day(d) for d in deadlines)
    ax0, ax1 = lw, 288
    xs = lambda d: ax0 + (ax1 - ax0) * day(d) / span
    xnone = 338
    mxn = max(max(c.values()) for _, c, _ in rows)
    rr = lambda n: max(9.5, 4.4 * math.sqrt(n))
    rh = 40
    b = []
    top = 38
    for d in deadlines:
        x = xs(d)
        b.append(f'<text x="{x}" y="14" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">{int(d[5:7])}/{int(d[8:10])}</text>')
        b.append(f'<line x1="{x}" y1="22" x2="{x}" y2="{top + rh * len(rows) - 14}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 3"/>')
    b.append(f'<text x="{xnone}" y="14" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">期限なし</text>')
    b.append(f'<line x1="{xnone}" y1="22" x2="{xnone}" y2="{top + rh * len(rows) - 14}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="2 3"/>')
    for i, (nm, cnt, human) in enumerate(rows):
        cy = top + i * rh + 8
        if human:
            b.append(f'<rect x="0" y="{cy - 20}" width="{W}" height="{rh - 2}" fill="#fff7ed"/>')
        b.append(f'<text x="6" y="{cy + 4}" font-size="11" fill="{INK}" font-weight="{700 if human else 400}">{esc(nm)}</text>')
        for d, n in cnt.items():
            x = xnone if d == "none" else xs(d) if d in deadlines else None
            if x is None:
                # 締切一覧にない日付は、最も近い後ろの締切の位置に置かず、その日付で置く
                x = ax0 + (ax1 - ax0) * day(d) / span
            r = rr(n)
            f, s, t = (AMB if human else BLU)
            b.append(f'<circle cx="{x}" cy="{cy}" r="{r}" fill="{f}" stroke="{s}" stroke-width="{2.5 if human else 1.5}"/>')
            b.append(f'<text x="{x}" y="{cy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="{t}">{n}</text>')
    H = top + rh * len(rows) - 6
    claim = "最初の締切（11/30）に向けて、総司令官の判断待ちと作業が積まれている"
    n30 = deadlines[0]
    c30 = {nm: cnt.get(n30, 0) for nm, cnt, _ in rows}
    tot_all = sum(sum(c.values()) for nm, c, _ in rows[1:])
    point = (f"{int(n30[5:7])}/{int(n30[8:10])} 締切に向けて、総司令官の判断待ち {c30['総司令官の判断待ち']} 件・総司令官の作業 {c30['総司令官の作業']} 件。"
             f"円の面積が件数（部隊の作業は計 {tot_all} 件）。総司令官の行（塗り）は人間の関門で、自動では進めない。")
    # 日付→コンペの対応
    by = defaultdict(list)
    for s in subs:
        if s.get("deadline"):
            tail = s["label"].split(" → ")[-1]
            if tail not in by[s["deadline"]["at"][:10]]:
                by[s["deadline"]["at"][:10]].append(tail)
    legend = {f"{int(d[5:7])}/{int(d[8:10])}": "、".join(v) for d, v in sorted(by.items())}
    return claim, svg(W, H, "".join(b), "締切順の次の行動。横軸は締切までの日数に比例。行は総司令官の判断待ち、総司令官の作業、工兵、情報部、憲兵、アグレッサー。円の面積が件数。"), point, legend


# ---- 図4: データ条件と影響 ----
def risky_datasets(camp, na):
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


def fig_data(camp, graph, na):
    risky, dlabel = risky_datasets(camp, na)
    impact = na["dataImpactAll"]
    contest_name = {n["id"]: n["label"] for n in graph["nodes"] if n["type"] in ("Contest", "Division")}
    rows = []
    for d, why in sorted(risky.items()):
        im = impact.get(d, {})
        apps = im.get("apps", {})
        cs = defaultdict(set)
        for s in im.get("submissions", []):
            nm = contest_name.get(s["contest"], s["contest"])
            if s.get("division"):
                nm = contest_name.get(s["division"], nm)
            cs[s["submission"].split("/")[1]].add(nm)
        rows.append((d, why, apps, cs))
    rows.sort(key=lambda r: (-len(r[2]), r[0]))
    W, lw = 360, 20
    b = []
    y = 4
    colmap = {"非商用": RED, "条件が未確認": AMB, "未確認と記録": AMB}
    napp = set()
    for d, why, apps, cs in rows:
        f, s, t = colmap.get(why, AMB)
        b.append(f'<g><title>{esc(dlabel.get(d, d))}</title><rect x="0" y="{y}" width="{W}" height="26" rx="5" fill="{f}" stroke="{s}" stroke-width="1.5"/>')
        b.append(f'<text x="8" y="{y + 17}" font-size="12" font-weight="700" fill="{t}">{esc(short(dlabel.get(d, d), 19))}</text>')
        b.append(f'<text x="{W - 8}" y="{y + 17}" text-anchor="end" font-size="11" font-weight="700" fill="{t}">【{esc(why)}】</text></g>')
        y0 = y + 26
        y += 30
        if not apps:
            b.append(f'<text x="{lw}" y="{y + 12}" font-size="11" fill="{MUTED}">使うアプリの記録なし</text>')
            y += 22
        for aid, aname in apps.items():
            napp.add(aid)
            slug = aid.split("/")[1]
            c = sorted(cs.get(slug, []))
            b.append(f'<line x1="10" y1="{y0}" x2="10" y2="{y + 12}" stroke="{INK}" stroke-width="1.2"/><line x1="10" y1="{y + 12}" x2="{lw - 2}" y2="{y + 12}" stroke="{INK}" stroke-width="1.2"/>')
            b.append(f'<text x="{lw + 2}" y="{y + 10}" font-size="11" fill="{INK}">{esc(short(aname, 20))}</text>')
            ct = "、".join(sorted({short(x.replace("アワード2026", "").replace("チャレンジ2026", "").replace("2026–2027", "").replace("2026", ""), 14) for x in c})) or "出し先の記録なし"
            parts = wrap("→ 応募先: " + ct, 27)
            for k, ln in enumerate(parts):
                b.append(f'<text x="{lw + 2}" y="{y + 24 + 13 * k}" font-size="11" fill="{MUTED}">{esc(ln)}</text>')
            y0 = y + 12
            y += 32 + 13 * (len(parts) - 1)
        y += 6
    n_sub = len({k for _, _, _, cs in rows for k in cs})
    claim = f"利用条件が×なら、{len(rows)} 件のデータに頼る {len(napp)} 個のアプリと {n_sub} 件の応募が影響を受ける"
    point = ("対象は、利用条件が非商用・未確認と記録されているデータ（contests/ontology/queries/q5b と同じ条件）。"
             "条件の確認は総司令官の問い合わせ・判断待ち。確認前は、そのデータを使う案を出せるとは言えない。")
    return claim, svg(W, y + 4, "".join(b), f"利用条件に注意が要るデータ{len(rows)}件と、それを使うアプリ、応募先のコンペ。"), point


# ---- 図5: 適合 ----
MARKS = {"◎": (GRN, "出せる（強い）"), "○": (GRN, "出せる"), "△": (AMB, "条件つき"), "×": (RED, "出せない"), "？": (GRY, "未確認")}
SCORE = {"◎": 3, "○": 2, "△": 1, "×": 0, "？": 0}


def fig_fit(camp, graph):
    fits = [x for x in camp if x.get("@type") == "c:Fit"]
    app_label = {n["id"]: n["label"] for n in graph["nodes"] if n["type"] == "App"}
    tgt = [("id:contest/udc-2026", "UDC"), ("id:contest/satellite-2026", "衛星"), ("id:division/ichibiz-2026/business", "ビジネス"),
           ("id:division/ichibiz-2026/idea", "アイデア"), ("id:division/ichibiz-2026/realestate", "不動産"), ("id:contest/odpt-2026", "ODPT")]
    cell = {}
    for f in fits:
        a = sid(ref(f["c:fitApp"])[0])
        t = sid(ref(f["c:fitTarget"])[0])
        cell[(a, t)] = f["c:mark"]
    apps = sorted({a for a, _ in cell}, key=lambda a: (-sum(SCORE[cell[(a, t)]] for t, _ in tgt if (a, t) in cell), a))
    W, lw, cw = 360, 100, 43.3
    b = []
    y = 4
    for i, (_, nm) in enumerate(tgt):
        b.append(f'<text x="{lw + i * cw + cw / 2}" y="{y + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="{INK}">{esc(nm)}</text>')
    y += 20
    cnt = Counter()
    for a in apps:
        b.append(f'<text x="6" y="{y + 18}" font-size="11" fill="{INK}"><title>{esc(app_label.get(a, a))}</title>{esc(short(app_label.get(a, a), 9))}</text>')
        for i, (t, _) in enumerate(tgt):
            m = cell.get((a, t))
            if m is None:
                continue
            cnt[m] += 1
            f, s, tx = MARKS[m][0]
            b.append(f'<rect x="{lw + i * cw + 2}" y="{y + 2}" width="{cw - 4}" height="22" rx="3" fill="{f}" stroke="{s}" stroke-width="{2 if m == "◎" else 1}"/>')
            b.append(f'<text x="{lw + i * cw + cw / 2}" y="{y + 19}" text-anchor="middle" font-size="14" font-weight="700" fill="{tx}">{m}</text>')
        y += 26
    # 凡例
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
    claim = f"◎は {cnt['◎']} 組、◎か○は {cnt['◎'] + cnt['○']} 組（全 {len(cell)} 組）"
    point = (f"{len(apps)} 案 × {len(tgt)} 先 = {len(cell)} 組（◎{cnt['◎']}・○{cnt['○']}・△{cnt['△']}・×{cnt['×']}・？{cnt['？']}）。"
             "出せるかどうか（要項との適合）の判定で、提出文や監査の準備状況の評価ではない。案の選定は総司令官の判断。")
    return claim, svg(W, H, "".join(b), f"{len(apps)}案とコンペ・部門の適合。◎○△×？の記号。"), point


CSS = """
:root{--ink:#1f2937;--muted:#4b5563;--line:#d1d5db;--bg:#f9fafb}
*{box-sizing:border-box}
body{margin:0;font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",Meiryo,sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;font-size:15px}
header.top{background:#fff;border-bottom:1px solid var(--line);padding:10px 16px;position:sticky;top:0;z-index:5;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
header.top a{color:#1e3a8a;font-weight:700;font-size:14px;text-decoration:underline}
main{max-width:960px;margin:0 auto;padding:16px}
@media (max-width:600px){main{padding:6px}section.fig{padding:6px!important}}
h1{font-size:20px;margin:8px 0 6px}
h2{font-size:17px;margin:0 0 8px;line-height:1.5}
.lead{font-size:13px;color:var(--muted);margin:0 0 14px}
nav.toc{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 18px;padding:0;list-style:none;font-size:13px}
nav.toc a{color:#1e3a8a}
section.fig{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 18px;min-width:0}
figure{margin:0}
.svgwrap{max-width:520px;margin:6px auto}
.svgwrap svg{width:100%;height:auto;display:block}
.point{margin:8px 0 0;font-size:14px}
.gate{display:inline-block;border:2px solid #78350f;background:#fef3c7;color:#78350f;font-weight:700;font-size:12px;padding:1px 8px;border-radius:4px;margin-right:6px}
details{margin-top:8px;font-size:13px;color:var(--muted)}
details summary{cursor:pointer;color:var(--ink);font-weight:700}
details ul{margin:6px 0 0;padding-left:20px}
footer{font-size:12px;color:var(--muted);margin:24px 0 40px}
footer p{margin:4px 0}
"""


def page(schema, camp, graph, na, generated):
    f1 = fig_schema(schema, camp, graph)
    f2 = fig_blockers(na, graph)
    f3 = fig_next(na, graph)
    f4 = fig_data(camp, graph, na)
    f5 = fig_fit(camp, graph)
    summ = na["summary"]
    secs = []

    def sec(i, anchor, fig, extra="", gate=False):
        claim, svgs, point = fig[0], fig[1], fig[2]
        g = '<span class="gate">総司令官の判断</span>' if gate else ""
        return (f'<section class="fig" id="{anchor}" aria-labelledby="h-{anchor}"><h2 id="h-{anchor}">{i}. {esc(claim)}</h2>'
                f'<figure><div class="svgwrap">{svgs}</div><figcaption class="point">{g}{esc(point)}</figcaption></figure>{extra}</section>')

    leg3 = "".join(f"<li>{esc(d)}: {esc(c)}</li>" for d, c in f3[3].items())
    secs.append(sec(1, "types", f1, f'<details><summary>{esc(f1[3])}</summary></details>'))
    secs.append(sec(2, "blockers", f2, '<details><summary>読み方と数え方</summary><ul>'
                    '<li>失格級: 憲兵の監査の指摘のうち「失格級」。確定と要確認を合わせた件数。</li>'
                    '<li>要修正: 監査の「要修正」の指摘。</li><li>未記入欄: 応募文に未記入の欄が残るファイルの本数。部隊は代筆しない（生成AI条項）。</li>'
                    '<li>データ条件: 利用条件が未確認のデータ。提出物なし: 応募文などの提出物がまだ作られていない。</li>'
                    '<li>判定の規則は contests/ontology/next_actions.py（失格級・未記入欄・データ条件・提出文の欠落がなく、要修正がなく、監査があり、案の選定が済んでいること）。</li></ul></details>'))
    secs.append(sec(3, "next", f3, f'<details><summary>日付とコンペ</summary><ul>{leg3}</ul></details>', gate=True))
    secs.append(sec(4, "data", f4, "", gate=True))
    secs.append(sec(5, "fit", f5, "", gate=True))
    toc = "".join(f'<li><a href="#{a}">{esc(t)}</a></li>' for a, t in [("types", "1 型"), ("blockers", "2 止めているもの"), ("next", "3 次の行動"), ("data", "4 データ条件"), ("fit", "5 適合")])
    asof = na["asOf"]
    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>オントロジーの図解｜統合ダッシュボード</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>
<header class="top"><a href="../index.html">統合ダッシュボード</a><a href="../ontology/index.html">つながり図（オントロジー）</a><span style="font-size:13px;color:var(--muted)">図解</span></header>
<main id="main">
<h1>オントロジーの図解: 何がつながり、何が提出を止め、次に誰が何をするか</h1>
<p class="lead">{esc(asof)} 時点の記録から生成。提出不可 {summ.get("提出不可", 0)} 応募・要修正あり {summ.get("要修正あり", 0)} 応募。案の選定・提出・registry 変更・ページ削除は<strong>総司令官の判断</strong>で、このページからは進めません。</p>
<ul class="toc" aria-label="図の一覧">{toc}</ul>
{''.join(secs)}
<footer>
<p>生成日: {esc(generated)}（記録の基準日: {esc(asof)}）。生成コマンド: <code>python3 contests/ontology/figures.py</code></p>
<p>出典（すべて contests/ontology/）: schema.jsonld（図1の型と関係）、campaign.jsonld（件数・データの利用条件・適合判定）、graph.json（名前）、next-actions.json（図2〜4の件数・次の行動・判断待ち・データの影響）。数値は手で書き写さず、このスクリプトが計算した。</p>
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
