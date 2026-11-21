#!/usr/bin/env python3
"""既存の正本からキャンペーン全体のグラフ（JSON-LD）を生成する。

読むだけ: contests/registry.json、contests/<id>/brief.md、contests/dashboard/src/apps/{registry,contests-info}.ts、
reports/ops/status-*.md（最新）、reports/audit/*.md、reports/escalations/*.md、reports/command/*.md、
各アプリの README、`gh pr list`（読み取りだけ）、アプリ×コンペの適合 JSON。
手で JSON-LD を書き写さない。取り出せない項目は値を作らず「未抽出」（c:extracted）として残す。

使い方:
  python3 contests/ontology/build_graph.py                 # campaign.jsonld と build-report.json を更新
  python3 contests/ontology/build_graph.py --offline       # gh を呼ばず data/gh-pr-snapshot.json を使う
"""
import argparse
import glob
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from rdflib import Graph, Literal, URIRef, RDF, RDFS, XSD  # noqa: E402

import mappings as M  # noqa: E402
from mdextract import dataset_rows, h1, placeholders, strip_md  # noqa: E402
from schema import C, ID, build_schema  # noqa: E402
from tsliteral import parse_array  # noqa: E402

ROOT = HERE.parent.parent
AS_OF = "2026-11-21"
FIT_BRANCH = "claude/engineer-dashboard-allapps-20261121"
FIT_PATH = "reports/intel/app-contest-fit-20261121.json"
REPORT = {"gaps": [], "counts": {}, "notes": []}


EXCLUDE_HDR = re.compile(r"総司令官作業|総司令官がすべき|総司令官への申し送り|提出前に総司令官|総司令官の判断が要る|総司令官に決め")


def rd(path):
    return (ROOT / path).read_text(encoding="utf-8")


def must_exist(path):
    if not (ROOT / path).exists():
        raise SystemExit(f"対応表のパスが実在しない: {path}（mappings.py を直す）")
    return path


def slug(s):
    return re.sub(r"[^0-9A-Za-z_.-]+", "-", s).strip("-") or hashlib.md5(s.encode()).hexdigest()[:8]


class B:
    """グラフを作る小さな補助。"""

    def __init__(self):
        self.g = build_schema()
        self._src = {}

    def add(self, s, p, o):
        if o is None:
            return
        if isinstance(o, (URIRef, Literal)):
            self.g.add((s, p, o))
        elif isinstance(o, bool):
            self.g.add((s, p, Literal(o)))
        elif isinstance(o, int):
            self.g.add((s, p, Literal(o)))
        else:
            self.g.add((s, p, Literal(str(o))))

    def node(self, iri, cls, label=None):
        self.g.add((iri, RDF.type, C[cls]))
        if label:
            self.g.add((iri, RDFS.label, Literal(label, lang="ja")))
        return iri

    def source(self, path=None, locator=None, url=None):
        key = (path, locator, url)
        if key in self._src:
            return self._src[key]
        iri = ID["src/" + slug(f"{path or url}-{locator or ''}")]
        if iri in self._src.values():  # 日本語だけが違う出典の IRI が衝突したら、内容の短いハッシュを付けて分ける
            iri = ID["src/" + slug(f"{path or url}-{locator or ''}") + "-" + hashlib.md5(repr(key).encode()).hexdigest()[:6]]
        self.g.add((iri, RDF.type, C.Source))
        label = (path or url) + (f" {locator}" if locator else "")
        self.g.add((iri, RDFS.label, Literal(label, lang="ja")))
        if path:
            self.g.add((iri, C.path, Literal(path)))
        if locator:
            self.g.add((iri, C.locator, Literal(locator)))
        if url:
            self.g.add((iri, C.url, Literal(url, datatype=XSD.anyURI)))
        self._src[key] = iri
        return iri

    def cite(self, subj, path=None, locator=None, url=None):
        self.g.add((subj, C.hasSource, self.source(path, locator, url)))

    def gap(self, subj, what):
        """取り出せなかった項目を、値を作らずに残す。"""
        self.g.add((subj, C.extracted, Literal(f"未抽出: {what}")))
        REPORT["gaps"].append({"node": str(subj).replace(str(ID), "id:"), "what": what})


def split_source(s):
    """'path §x; path2 節' → [(path, locator)]。"""
    out = []
    for part in re.split(r"[;；]", s or ""):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([\w./\-]+\.(?:md|ts|json|py|html))\s*(.*)$", part)
        if m:
            out.append((m.group(1), m.group(2).strip() or None))
        else:
            out.append((None, part))
    return out


def dlit(s):
    if not s:
        return None
    return Literal(s, datatype=XSD.date if len(s) == 10 else XSD.dateTime)


def jst_date(y, mo, d, hh=None, mm=None):
    if hh is None:
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return f"{y:04d}-{mo:02d}-{d:02d}T{hh:02d}:{mm:02d}:00+09:00"


# ------------------------------------------------------------------ 入力の読み込み
def load_fit():
    """アプリ×コンペの適合 JSON を (データ, リポジトリ内のパス) で返す。

    既定ブランチに reports/intel/app-contest-fit-*.json があればそれを使う。無ければ
    ブランチ claude/engineer-dashboard-allapps-20261121 から `git show` で読み、
    contests/ontology/data/ に写しを置く（出典のパスはその写し）。
    """
    for p in sorted(glob.glob(str(ROOT / "reports/intel/app-contest-fit-*.json")), reverse=True):
        return json.loads(Path(p).read_text(encoding="utf-8")), str(Path(p).relative_to(ROOT))
    snap = HERE / "data/app-contest-fit-20261121.json"
    try:
        txt = subprocess.run(
            ["git", "show", f"{FIT_BRANCH}:{FIT_PATH}"], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout
        snap.write_text(txt, encoding="utf-8")
    except Exception:
        pass
    return json.loads(snap.read_text(encoding="utf-8")), str(snap.relative_to(ROOT))


def load_prs(offline):
    snap = HERE / "data/gh-pr-snapshot.json"
    if not offline:
        try:
            out = subprocess.run(
                ["gh", "pr", "list", "--state", "all", "--limit", "200", "--json",
                 "number,title,state,headRefName,baseRefName,mergedAt,url,files"],
                cwd=ROOT, capture_output=True, text=True, check=True, timeout=120,
            ).stdout
            prs = json.loads(out)
            slim = [{**{k: v for k, v in p.items() if k != "files"}, "files": [f["path"] for f in p.get("files", [])]} for p in prs]
            slim.sort(key=lambda p: p["number"])
            snap.write_text(json.dumps(slim, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            return slim, "gh pr list --state all（取得時に data/gh-pr-snapshot.json へ保存）"
        except Exception as e:  # gh が無い・認証なし
            REPORT["notes"].append(f"gh を呼べなかったため写しを使用: {e}")
    return json.loads(snap.read_text(encoding="utf-8")), "contests/ontology/data/gh-pr-snapshot.json（gh pr list の写し）"


# ------------------------------------------------------------------ 構築
def build(offline=False):
    b = B()
    g = b.g
    reg = json.loads(rd("contests/registry.json"))
    apps_ts = parse_array(rd("contests/dashboard/src/apps/registry.ts"), "APPS")
    cards_ts = parse_array(rd("contests/dashboard/src/apps/registry.ts"), "CARDS_ONLY")
    info_ts = {c["id"]: c for c in parse_array(rd("contests/dashboard/src/apps/contests-info.ts"), "CONTEST_INFO")}
    fit, fit_src = load_fit()
    REG, REGTS, INFO = "contests/registry.json", "contests/dashboard/src/apps/registry.ts", "contests/dashboard/src/apps/contests-info.ts"

    # ---- 部隊（CLAUDE.md の表） ------------------------------------------------
    claude = rd("CLAUDE.md").split("\n")
    units = {}
    for n, ln in enumerate(claude, 1):
        m = re.match(r"^\|\s*([^|]+?)\s*\|\s*([a-z][a-z-]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$", ln)
        if m and m.group(2) != "agent":
            label, agent, prod, scope = m.groups()
            u = b.node(ID["unit/" + agent], "Unit", label)
            b.add(u, C.agentName, agent)
            b.add(u, C.produces, prod)
            b.add(u, C.writeScope, scope)
            b.cite(u, "CLAUDE.md", f"L{n}（部隊編制）")
            units[agent] = u
    cmd = b.node(ID["commander"], "Commander", "総司令官")
    b.add(cmd, C.agentName, "commander")
    b.cite(cmd, "CLAUDE.md", "「総司令官の意図」「応募フォームへの送信・公開・main へのマージは総司令官だけ」")
    units["commander"] = cmd
    REPORT["counts"]["units"] = len(units) - 1

    def agent(name):
        return units.get(name)

    # ---- 標準の流れ ------------------------------------------------------------
    stages = {}
    for i, (sid, label, who, gate) in enumerate(M.STAGES, 1):
        s = b.node(ID["stage/" + sid], "Stage", label)
        b.add(s, C.stageOrder, i)
        b.add(s, C.performedBy, agent(who))
        b.add(s, C.isHumanGate, gate)
        b.cite(s, "CLAUDE.md", "「標準の流れ」")
        stages[sid] = s

    # ---- コンペ ----------------------------------------------------------------
    contests, divisions, themes = {}, {}, {}
    reg_name = {c["id"]: c["name"] for c in reg["contests"]}
    for c in reg["contests"]:
        cid = c["id"]
        k = b.node(ID["contest/" + cid], "Contest", c["name"])
        contests[cid] = k
        b.add(k, C.sourceId, cid)
        b.add(k, C.url, Literal(c["url"], datatype=XSD.anyURI))
        b.add(k, C.implementationRequired, c["implementation_required"])
        b.cite(k, REG, f"contests[id={cid}]")
        brief = f"contests/{cid}/brief.md"
        if (ROOT / brief).exists():
            b.cite(k, brief, h1(rd(brief)))
            sec = re.search(r"^## 備考\n(.+?)(?:\n## |\Z)", rd(brief), re.S | re.M)
            if sec:
                b.add(k, C.note, strip_md(sec.group(1)))
        else:
            b.gap(k, "brief.md なし")
        for n, d in enumerate(c["deadlines"], 1):
            dl = b.node(ID[f"deadline/{cid}/{n}"], "Deadline", f'{c["name"]} {d["label"]}')
            b.add(dl, C.dueAt, Literal(d["at"], datatype=XSD.dateTime))
            b.add(dl, C.description, d["label"])
            b.add(dl, C.ofContest, k)
            b.cite(dl, REG, f"contests[id={cid}].deadlines[{n - 1}]")
            g.add((k, C.hasDeadline, dl))
            for di in info_ts.get(cid, {}).get("deadlines", []):
                if di["at"] == d["at"] and di.get("doneAt"):
                    b.add(dl, C.doneAt, Literal(di["doneAt"], datatype=XSD.date))
                    b.add(dl, C.status, di.get("doneLabel", "済"))
                    b.cite(dl, INFO, f'{cid} deadlines「{di["label"]}」doneAt')
        for n, name in enumerate(c["criteria"], 1):
            cr = b.node(ID[f"criterion/{cid}/registry-{n}"], "Criterion", name)
            b.add(cr, C.ofContest, k)
            b.cite(cr, REG, f"contests[id={cid}].criteria[{n - 1}]")
            g.add((k, C.hasCriterion, cr))
        for n, txt in enumerate(c["constraints"], 1):
            r = b.node(ID[f"rule/{cid}/constraint-{n}"], "Rule", txt)
            b.add(r, C.ruleKind, "制約（registry）")
            b.add(r, C.description, txt)
            b.cite(r, REG, f"contests[id={cid}].constraints[{n - 1}]")
            g.add((k, C.hasRule, r))
        for field, mx in c.get("field_limits", {}).items():
            sl = b.node(ID[f"limit/{cid}/field-{field}"], "SubmissionLimit", f"{field} {mx}字")
            b.add(sl, C.limitKind, "字数")
            b.add(sl, C.limitField, field)
            b.add(sl, C.limitMax, mx)
            b.add(sl, C.ofContest, k)
            b.cite(sl, REG, f"contests[id={cid}].field_limits.{field}")
            g.add((k, C.hasSubmissionLimit, sl))
        inf = info_ts.get(cid)
        if inf:
            for n, cr in enumerate(inf["criteria"], 1):
                node = b.node(ID[f"criterion/{cid}/info-{n}"], "Criterion", cr["name"])
                b.add(node, C.description, cr["desc"])
                b.add(node, C.note, cr.get("tag"))
                b.add(node, C.ofContest, k)
                b.cite(node, INFO, f"{cid} criteria（{inf['criteriaTitle']}）")
                g.add((k, C.hasCriterion, node))
            for kind, key in (("失格・無効・取消につながる注意", "cautions"), ("未確認", "unconfirmed")):
                for n, txt in enumerate(inf.get(key, []), 1):
                    r = b.node(ID[f"rule/{cid}/{key}-{n}"], "Rule", txt[:60])
                    b.add(r, C.ruleKind, kind)
                    b.add(r, C.description, txt)
                    b.cite(r, INFO, f"{cid} {key}[{n - 1}]")
                    g.add((k, C.hasRule, r))
                    if key == "cautions" and re.search(r"1作品|1提案|1タイプ|複数提案|複数件", txt):
                        sl = b.node(ID[f"limit/{cid}/count-{n}"], "SubmissionLimit", txt[:40])
                        b.add(sl, C.limitKind, "件数")
                        b.add(sl, C.description, txt)
                        b.add(sl, C.ofContest, k)
                        b.cite(sl, INFO, f"{cid} cautions[{n - 1}]")
                        g.add((k, C.hasSubmissionLimit, sl))
        else:
            b.gap(k, "contests-info.ts に該当なし")

    # 部門（適合 JSON の contests 配列が定義。部門は ichibiz のみ）
    for e in fit["contests"]:
        if e.get("division"):
            div_key = {"ビジネス部門": "business", "アイデア部門": "idea", "不動産情報活用部門": "realestate"}[e["division"]]
            d = b.node(ID[f"division/{e['contest']}/{div_key}"], "Division", e["division"])
            b.add(d, C.ofContest, contests[e["contest"]])
            b.add(d, C.sourceId, e["id"])
            b.cite(d, fit_src, f"contests[id={e['id']}]")
            g.add((contests[e["contest"]], C.hasDivision, d))
            divisions[div_key] = d
            for dl in g.objects(contests[e["contest"]], C.hasDeadline):
                lab = str(g.value(dl, C.description))
                if e["division"][:3] in lab:
                    g.add((d, C.hasDeadline, dl))
    for key, label in M.SAT_THEMES.items():
        t = b.node(ID[f"theme/satellite-2026/{key}"], "Theme", label)
        b.add(t, C.ofContest, contests["satellite-2026"])
        b.cite(t, "reports/audit/satellite-2026-alpha-20261113.md", "F-1（要項p6の枠）")
        g.add((contests["satellite-2026"], C.hasTheme, t))
        themes[key] = t
    for dl in g.objects(contests["satellite-2026"], C.hasDeadline):
        for t in themes.values():
            g.add((t, C.hasDeadline, dl))
    udc = contests["udc-2026"]
    b.gap(udc, "テーマ・作品タイプの一覧（要項の分類は contests-info.ts にない）")

    # 提出予定数（総司令官の決定。要項の上限である SubmissionLimit とは別）。total が null のコンペは値を作らず「未定」の穴にする
    for cid, inf in info_ts.items():
        pl = inf.get("planned")
        if pl is None or cid not in contests:
            continue
        k = contests[cid]
        if pl["total"] is None:
            b.gap(k, "提出予定数（総司令官の指示なし。未定）")
            continue
        top = b.node(ID[f"planned/{cid}"], "PlannedSubmission", f"{reg_name[cid]} 提出予定 {pl['total']}件")
        b.add(top, C.plannedCount, pl["total"])
        b.add(top, C.ofContest, k)
        b.cite(top, INFO, f"{cid} planned.total（{pl['src']}）")
        g.add((k, C.hasPlannedSubmission, top))
        for n, part in enumerate(pl["parts"], 1):
            pn = b.node(ID[f"planned/{cid}/{n}"], "PlannedSubmission", f"{reg_name[cid]} 提出予定 {part['label']} {part['count']}件")
            b.add(pn, C.plannedCount, part["count"])
            b.add(pn, C.plannedLabel, part["label"])
            b.add(pn, C.ofContest, k)
            if part.get("columnId"):
                dk = part["columnId"].rsplit("-", 1)[-1]
                b.add(pn, C.plannedFor, divisions.get(dk))
            b.cite(pn, INFO, f"{cid} planned.parts[{n - 1}]（{pl['src']}）")
            g.add((k, C.hasPlannedSubmission, pn))

    # 適合の注意（fit.cautions）→ Rule
    for c in fit["cautions"]:
        scope = c["contest"]
        r = b.node(ID["rule/fit/" + c["id"]], "Rule", c["text"][:60])
        b.add(r, C.ruleKind, "適合上の注意")
        b.add(r, C.description, c["text"])
        for a in c.get("apps", []):
            g.add((r, C.appliesToApp, ID["app/" + a]))
        for p, loc in split_source(c.get("source", "")):
            b.cite(r, p, loc) if p else b.cite(r, fit_src, loc)
        b.cite(r, fit_src, f"cautions[{c['id']}]")
        if scope in contests:
            g.add((contests[scope], C.hasRule, r))
            if re.search(r"1作品|1提案|複数|件数", c["text"][:140]):
                sl = b.node(ID["limit/fit/" + c["id"]], "SubmissionLimit", c["text"][:40])
                b.add(sl, C.limitKind, "件数")
                b.add(sl, C.description, c["text"])
                b.add(sl, C.ofContest, contests[scope])
                b.cite(sl, fit_src, f"cautions[{c['id']}]")
                g.add((contests[scope], C.hasSubmissionLimit, sl))
        else:
            b.add(r, C.note, "全コンペ共通")

    # ---- アプリ・案 -------------------------------------------------------------
    apps = {}
    homes = {}  # app → (contest, division or None, theme-keys)

    def div_of(text):
        for pre, key in M.DIVISION_PREFIX:
            if text.startswith(pre):
                return key
        return None

    for a in apps_ts:
        homes[a["id"]] = (a["contest"], div_of(a["division"]) if a["contest"] == "ichibiz-2026" else None)
    for a in cards_ts:
        homes[a["id"]] = (a["contest"], div_of(a["division"]))
    for aid, (cc, dd) in M.APP_HOME_FALLBACK.items():
        homes[aid] = (cc, dd)

    for a in apps_ts:
        n = b.node(ID["app/" + a["id"]], "App", a["name"])
        apps[a["id"]] = n
        b.add(n, C.sourceId, a["id"])
        b.add(n, C.audience, a.get("audience"))
        b.add(n, C.purpose, a.get("purpose"))
        b.add(n, C.dataKind, {"real": "実データ", "fictional": "架空データ", "partial": "一部架空"}.get(a.get("dataKind")))
        b.add(n, C.planKind, "新案（比較用・未選定）" if a.get("plan") == "new" else "現行案")
        b.add(n, C.appDir, M.APP_DIRS.get(a["id"]))
        b.cite(n, REGTS, f"APPS[id={a['id']}]")
        if a.get("stateNote"):
            b.add(n, C.note, a["stateNote"])
    for a in cards_ts:
        n = b.node(ID["app/" + a["id"]], "App", a["name"])
        apps[a["id"]] = n
        b.add(n, C.sourceId, a["id"])
        b.add(n, C.planKind, "提出文のみ（デモなし）")
        b.add(n, C.purpose, a["note"])
        b.cite(n, REGTS, f"CARDS_ONLY[id={a['id']}]")
        if a.get("demoAppId"):
            g.add((n, C.demoOf, ID["app/" + a["demoAppId"]]))  # 向きは後で直す
    for aid in M.APP_HOME_FALLBACK:
        d = M.APP_DIRS[aid]
        readme = must_exist(d + "/README.md")
        n = b.node(ID["app/" + aid], "App", (h1(rd(readme)) or aid))
        apps[aid] = n
        b.add(n, C.sourceId, aid)
        b.add(n, C.planKind, "新案（dashboard registry.ts 未登録）")
        b.add(n, C.appDir, d)
        b.cite(n, readme, "L1")
        b.cite(n, fit_src, "cells（◎のセル）")
        b.gap(n, "audience・purpose（registry.ts に未登録）")
    for aid, d in M.APP_DIRS.items():
        must_exist(d)
        if aid not in apps:
            raise SystemExit(f"APP_DIRS にあるが registry.ts にも fallback にも無い: {aid}")
    # デモの向き: 提出文のみの案 ← デモのアプリ
    for s_, p_, o_ in list(g.triples((None, C.demoOf, None))):
        g.remove((s_, p_, o_))
        g.add((o_, C.demoOf, s_))
    # 競合（registry.ts の pairWith）
    for a in apps_ts + cards_ts:
        if a.get("pairWith") and a["pairWith"] in apps:
            g.add((apps[a["id"]], C.competesWith, apps[a["pairWith"]]))
            g.add((apps[a["pairWith"]], C.competesWith, apps[a["id"]]))
    # 未作成の資料: 提出文だけの案 IN1 にはアプリがない
    REPORT["counts"]["apps"] = len(apps)

    # ---- 適合 ------------------------------------------------------------------
    fit_targets = {}
    for e in fit["contests"]:
        fit_targets[e["id"]] = (e["contest"], {"ビジネス部門": "business", "アイデア部門": "idea", "不動産情報活用部門": "realestate"}.get(e.get("division")))
    cells = fit["cells"]
    for cell in cells:
        if cell["app"] not in apps:
            raise SystemExit(f"適合 JSON に未知のアプリ: {cell['app']}")
        cc, dd = fit_targets[cell["contest"]]
        tgt = divisions[dd] if dd else contests[cc]
        f = b.node(ID[f"fit/{cell['app']}/{cell['contest']}"], "Fit", f"{cell['app']} × {cell['contest']} {cell['mark']}")
        g.add((f, C.fitApp, apps[cell["app"]]))
        g.add((f, C.fitTarget, tgt))
        b.add(f, C.mark, cell["mark"])
        b.add(f, C.score, int(cell["score"]))
        b.add(f, C.reason, cell["reason"])
        for p, loc in split_source(cell.get("source", "")):
            b.cite(f, p, loc) if p else b.cite(f, fit_src, loc)
        b.cite(f, fit_src, f"cells[{cell['app']} × {cell['contest']}]")
        if cell["score"] >= 1:
            g.add((apps[cell["app"]], C.fitsContest, contests[cc]))
    REPORT["counts"]["fits"] = len(cells)
    apps_without_fit = [a for a in apps if not any(c["app"] == a for c in cells)]
    for a in apps_without_fit:
        b.gap(apps[a], "アプリ×コンペの適合（適合 JSON に行がない）")

    # ---- データ・ライセンス ------------------------------------------------------
    restr = {r: C[r] for r in ("NonCommercial", "AttributionRequired", "ShareAlike", "NoRedistribution", "CommercialUseAllowed")}
    datasets, licenses = {}, {}

    def classify(name, source):
        for pat_target in (name, f"{name} {source or ''}"):
            for did, label, pat in M.DATASET_CATALOG:
                if re.search(pat, pat_target):
                    return did, label
        return None, None

    def license_nodes(text, ds_node, src_cite):
        found = []
        for lid, label, pat, rs in M.LICENSE_CATALOG:
            if re.search(pat, text):
                if lid not in licenses:
                    ln = b.node(ID["license/" + lid], "License", label)
                    for r in rs:
                        g.add((ln, C.restricts, restr[r]))
                    if lid == "non-commercial":
                        b.add(ln, C.conditionStatus, "未確認（許諾の可否を示す記録がない）")
                    else:
                        b.add(ln, C.conditionStatus, "記載あり")
                    licenses[lid] = ln
                    src_cite(ln)
                g.add((ds_node, C.hasLicense, licenses[lid]))
                found.append(lid)
        if re.search(M.UNCONFIRMED_RE, text):
            lid = "unconfirmed-" + hashlib.md5(text.encode()).hexdigest()[:6]
            ln = b.node(ID["license/" + lid], "License", "条件が未確認と記録されている")
            b.add(ln, C.licenseText, text[:200])
            b.add(ln, C.conditionStatus, "未確認")
            g.add((ds_node, C.hasLicense, ln))
            src_cite(ln)
            found.append(lid)
        if not found:
            lid = "other-" + hashlib.md5(text.encode()).hexdigest()[:6]
            if lid not in licenses:
                ln = b.node(ID["license/" + lid], "License", text[:40])
                b.add(ln, C.licenseText, text[:200])
                b.add(ln, C.conditionStatus, "記載あり（分類未実施）")
                licenses[lid] = ln
                src_cite(ln)
            g.add((ds_node, C.hasLicense, licenses[lid]))
        return found

    nodata = []
    for aid in apps:
        if aid not in M.APP_DIRS:
            continue
        rows = []  # (name, source, license, cite_path, cite_loc)
        readme = M.APP_DIRS[aid] + "/README.md"
        for r in dataset_rows(rd(readme)):
            rows.append((r["name"], r["source"], r["license"], readme, f"L{r['line']}（{r['section']}）"))
        a_ts = next((x for x in apps_ts if x["id"] == aid), None)
        if a_ts and a_ts.get("sources"):
            for s in a_ts["sources"]:
                rows.append((s["name"], s.get("provider"), s.get("license"), REGTS, f"APPS[id={aid}].sources"))
        got = 0
        for name, source, lic, cp, cl in rows:
            if re.search(M.DATASET_SKIP_RE, name):
                continue
            did, label = classify(name, source)
            if did is None:
                did, label = f"{aid}--{slug(name)[:30]}", f"{name}（{aid} 固有）"
            if did not in datasets:
                datasets[did] = b.node(ID["dataset/" + did], "Dataset", label)
            ds = datasets[did]
            g.add((apps[aid], C.usesDataset, ds))
            b.cite(ds, cp, cl)
            got += 1
            txt = lic or ""
            if txt.strip():
                license_nodes(txt, ds, lambda ln, cp=cp, cl=cl: b.cite(ln, cp, cl))
            else:
                b.add(ds, C.note, f"{aid}: ライセンス欄が空")
        if not got:
            nodata.append(aid)
            b.gap(apps[aid], "使うデータ（README に出典・ライセンス表がなく、registry.ts にも sources がない）")
    REPORT["counts"]["datasets"] = len(datasets)
    REPORT["counts"]["licenses"] = len(set(g.subjects(RDF.type, C.License)))
    REPORT["apps_without_dataset_rows"] = nodata

    # ---- 応募（Submission） ------------------------------------------------------
    subs = {}  # (app, contest) → node
    targets = defaultdict(set)
    for aid, (cc, dd) in homes.items():
        targets[aid].add((cc, dd))
    for cell in cells:
        if cell["mark"] == "◎":
            cc, dd = fit_targets[cell["contest"]]
            targets[cell["app"]].add((cc, dd))
    for aid in sorted(targets):
        if aid not in apps:
            continue
        if (apps[aid], C.demoOf, None) in g and any(g.triples((apps[aid], C.demoOf, None))):
            b.add(apps[aid], C.note, "提出文のみの案 IN1 のデモとして使う。応募は IN1 側（registry.ts の注記）")
            continue
        for cc, dd in sorted(targets[aid], key=lambda t: (t[0], t[1] or "")):
            sid = f"{aid}/{cc}" + (f"/{dd}" if dd else "")
            s = b.node(ID["sub/" + sid], "Submission", f"{g.value(apps[aid], RDFS.label)} → {g.value(contests[cc], RDFS.label)}" + (f" {g.value(divisions[dd], RDFS.label)}" if dd else ""))
            subs[(aid, cc)] = s
            g.add((s, C.ofApp, apps[aid]))
            g.add((s, C.toContest, contests[cc]))
            g.add((apps[aid], C.hasSubmission, s))
            if dd:
                g.add((s, C.toDivision, divisions[dd]))
            for t in M.SAT_APP_THEMES.get(aid, []) if cc == "satellite-2026" else []:
                g.add((s, C.toTheme, themes[t]))
            slot = (
                f"satellite-2026/{'+'.join(M.SAT_APP_THEMES[aid])}" if cc == "satellite-2026" and aid in M.SAT_APP_THEMES
                else f"satellite-2026/テーマ未決/{aid}" if cc == "satellite-2026"
                else f"ichibiz-2026/{dd}" if cc == "ichibiz-2026"
                else "odpt-2026" if cc == "odpt-2026"
                else f"udc-2026/{aid}"
            )
            b.add(s, C.slotKey, slot)
            if cc == "satellite-2026" and aid not in M.SAT_APP_THEMES:
                b.gap(s, "出すテーマ枠（未決。fit 注意 C3）")
            b.cite(s, REGTS if aid in {a['id'] for a in apps_ts + cards_ts} else fit_src, f"{aid} の所属")
            for cell in cells:
                if cell["app"] == aid and fit_targets[cell["contest"]][0] == cc and cell["mark"] == "◎":
                    b.cite(s, fit_src, f"cells[{aid} × {cell['contest']}] ◎")
    REPORT["counts"]["submissions"] = len(subs)

    # 枠ごとの競合 → 案の選定（人間の関門）
    slots = defaultdict(list)
    for (aid, cc), s in subs.items():
        slots[str(g.value(s, C.slotKey))].append(s)
    sel_decisions = {}
    for slot, ss in slots.items():
        unresolved_theme = "テーマ未決" in slot
        if len(ss) < 2 and not unresolved_theme:
            continue
        d = b.node(ID["decision/select/" + slug(slot)], "SelectionDecision",
                   f"案の選定: {slot}" + ("（テーマ枠が未決）" if unresolved_theme else f"（{len(ss)}案）"))
        b.add(d, C.status, "未決")
        b.add(d, C.description, "案の選定は総司令官だけが決める（CLAUDE.md「案の選定と提出は必ず総司令官に戻す」）。")
        b.cite(d, "CLAUDE.md", "「標準の流れ」「案の選定と提出は必ず総司令官に戻す」")
        for s in ss:
            g.add((s, C.awaitsDecision, d))
            g.add((d, C.forSubmission, s))
        # 期限: その枠の応募先（部門があれば部門、なければコンペ）の、済んでいない最も早い締切
        tgt = g.value(ss[0], C.toDivision) or g.value(ss[0], C.toContest)
        dues = sorted(
            str(g.value(dl, C.dueAt)) for dl in g.objects(tgt, C.hasDeadline) if g.value(dl, C.doneAt) is None
        )
        if dues:
            b.add(d, C.dueAt, Literal(dues[0], datatype=XSD.dateTime))
        sel_decisions[slot] = d
    REPORT["counts"]["selection_decisions"] = len(sel_decisions)

    # ---- 未記入欄・未作成の提出物 ---------------------------------------------------
    unfilled_total = 0
    for (aid, cc), s in subs.items():
        files = M.SUBMISSION_FILES.get((aid, cc))
        if files is None:
            if aid in M.NO_DRAFT_SOURCES or cc != "udc-2026":
                k = b.node(ID[f"blocker/nodraft/{aid}/{cc}"], "MissingDeliverable", f"提出文が未作成: {aid} → {cc}")
                src = M.NO_DRAFT_SOURCES.get(aid)
                if src:
                    b.cite(k, src, "提出文なしの記載")
                else:
                    b.gap(k, "提出文の有無の根拠（対応表に該当ファイルなし）")
                g.add((s, C.blockedBy, k))
                g.add((k, C.affects, apps[aid]))
            continue
        for f in files:
            must_exist(f)
            hits = placeholders(rd(f), M.PLACEHOLDER_RE)
            if not hits:
                continue
            k = b.node(ID[f"blocker/unfilled/{aid}/{cc}/{slug(Path(f).stem)}"], "UnfilledField",
                       f"未記入 {len(hits)}か所: {f}")
            b.add(k, C.description, "、".join(f"L{n}" for n, _ in hits))
            b.cite(k, f, f"L{hits[0][0]}")
            g.add((k, C.affects, apps[aid]))
            g.add((s, C.blockedBy, k))
            unfilled_total += len(hits)
    REPORT["counts"]["unfilled_placeholders"] = unfilled_total

    # ---- 未確認のデータ条件 -----------------------------------------------------------
    for ds_iri in set(g.subjects(RDF.type, C.Dataset)):
        nc = any(
            (lic, C.restricts, C.NonCommercial) in g or (lic, C.conditionStatus, Literal("未確認")) in g
            for lic in g.objects(ds_iri, C.hasLicense)
        )
        if not nc:
            continue
        for a in g.subjects(C.usesDataset, ds_iri):
            k = b.node(ID["blocker/data/" + slug(f"{str(ds_iri).split('/')[-1]}-{str(a).split('/')[-1]}")], "UnconfirmedDataCondition",
                       f"データ利用条件が未確認: {g.value(ds_iri, RDFS.label)}")
            b.add(k, C.description, "ライセンスが非商用、または未確認と記録されている。憲兵は同種を失格級の候補として扱った（reports/audit/odpt-2026-kodure-20261114.md B1）。")
            g.add((k, C.overDataset, ds_iri))
            g.add((k, C.affects, a))
            for src in g.objects(ds_iri, C.hasSource):
                g.add((k, C.hasSource, src))
            for sub in g.objects(a, C.hasSubmission):
                g.add((sub, C.blockedBy, k))
    for i, fct in enumerate(M.UNCONFIRMED_DATA_FACTS, 1):
        must_exist(fct["source"])
        ds = datasets.get(fct["dataset"])
        for aid in fct["apps"]:
            k = b.node(ID[f"blocker/datafact/{fct['dataset']}/{aid}"], "UnconfirmedDataCondition", f"データ利用条件が未確認: {g.value(ds, RDFS.label) if ds is not None else fct['dataset']}（{aid}）")
            b.add(k, C.description, fct["text"])
            b.cite(k, fct["source"])
            g.add((k, C.affects, apps[aid]))
            if ds is not None:
                g.add((k, C.overDataset, ds))
                g.add((apps[aid], C.usesDataset, ds))  # 監査・エスカレーションが使用を明記している
            for sub in g.objects(apps[aid], C.hasSubmission):
                g.add((sub, C.blockedBy, k))
    REPORT["counts"]["unconfirmed_data_conditions"] = len(list(g.subjects(RDF.type, C.UnconfirmedDataCondition)))

    # ---- 監査・指摘 ----------------------------------------------------------------
    audit_files = sorted(Path(ROOT / "reports/audit").glob("*.md"))
    sev_re = [
        (re.compile(r"失格級|失格につながり"), "sev-disqualifying", "失格級"),
        (re.compile(r"要修正|重大|減点級"), "sev-fix", None),
        (re.compile(r"軽微|注意"), "sev-minor", None),
    ]
    id_re = re.compile(r"^([A-Z]{1,2}-?\d+(?:-\d+)?|\d+(?:-\d+)?)[.．、:：\s　]\s*(.*)$")
    bold_re = re.compile(r"^(?:[-*]\s+)?\*\*([A-Z]{1,2}-?\d+|[A-Z]|\d+)[.．、:：\s　（(]")
    findings_by_audit = {}
    audits = {}
    for p in audit_files:
        name = p.stem
        if name not in M.AUDITS:
            raise SystemExit(f"reports/audit/{name}.md が mappings.AUDITS にない。対象アプリを追記する")
        rel = f"reports/audit/{name}.md"
        text = p.read_text(encoding="utf-8")
        lines = text.split("\n")
        dm = re.search(r"-(\d{8})(?:-r\d+)?$", name)
        date = f"{dm.group(1)[:4]}-{dm.group(1)[4:6]}-{dm.group(1)[6:]}" if dm else None
        a = b.node(ID["audit/" + name], "Audit", h1(text) or name)
        audits[name] = a
        b.add(a, C.auditDate, Literal(date, datatype=XSD.date) if date else None)
        b.cite(a, rel)
        for aid in M.AUDITS[name]["apps"]:
            g.add((a, C.auditsApp, apps[aid]))
        for old in M.AUDITS[name]["supersedes"]:
            g.add((a, C.supersedes, ID["audit/" + old]))
        dq = re.search(r"失格級[^:：\n]{0,12}[:：]\s*\**(\d+)\s*件?", text)
        if dq:
            b.add(a, C.declaredDisqualifying, int(dq.group(1)))
        sev, sev_raw, sev_hdr, n_f = None, None, "", 0
        for n, ln in enumerate(lines, 1):
            hm = re.match(r"^(#{2,4})\s+(.*)$", ln)
            found = None
            if hm:
                level, title = len(hm.group(1)), hm.group(2).strip()
                idm = id_re.match(title) if level >= 3 else None
                if idm and sev:
                    found = (idm.group(1), idm.group(2))
                elif level <= 3:
                    sev, sev_raw, sev_hdr = None, None, title
                    for rx, sid, raw in ([] if EXCLUDE_HDR.search(title) else sev_re):
                        if rx.search(title):
                            sev, sev_raw = sid, raw or rx.search(title).group(0)
                            break
                    continue
            elif sev:
                bm = bold_re.match(ln)
                if bm:
                    inner = re.match(r"^(?:[-*]\s+)?\*\*(.+?)\*\*", ln).group(1)
                    idm = id_re.match(inner.replace("（未解消）", ""))
                    found = (bm.group(1), idm.group(2) if idm else inner)
            if not found:
                continue
            fid, ftitle = found
            ftitle = strip_md(ftitle)
            f = b.node(ID[f"finding/{name}/{fid}"], "Finding", f"{fid} {ftitle}"[:100])
            g.add((f, C.raisedIn, a))
            g.add((f, C.severity, C[sev]))
            b.add(f, C.rawSeverity, sev_raw)
            cert = "要確認" if (sev == "sev-disqualifying" and re.search(r"候補|要確認|可能性|条件付き|未解消|結果待ち", ftitle + sev_hdr)) else "確定"
            if sev == "sev-disqualifying":
                b.add(f, C.certainty, cert)
            b.add(f, C.description, ftitle)
            b.cite(f, rel, f"L{n}")
            findings_by_audit.setdefault(name, []).append(f)
            n_f += 1
        if n_f == 0:
            b.gap(a, "個別の指摘（見出し・太字の ID が見つからない形式）")
    REPORT["counts"]["audits"] = len(audits)
    REPORT["counts"]["findings"] = sum(len(v) for v in findings_by_audit.values())
    REPORT["counts"]["findings_by_severity"] = {
        s: len(list(g.subjects(C.severity, C[s]))) for s in ("sev-disqualifying", "sev-fix", "sev-minor")
    }

    # 現行の監査 = 他に置き換えられていないもの。アプリごとに現行の監査の指摘を応募に付ける
    superseded = {o for v in M.AUDITS.values() for o in v["supersedes"]}
    for name, meta in M.AUDITS.items():
        if name in superseded:
            for f in findings_by_audit.get(name, []):
                b.add(f, C.status, "置き換えられた旧版の指摘（現行の監査で解消状況を確認）")
            continue
        for f in findings_by_audit.get(name, []):
            sv = g.value(f, C.severity)
            b.add(f, C.status, "現行の監査に残る指摘（解消の記録がなければ未解消）")
            if sv == C["sev-minor"]:
                continue
            toks = M.AUDIT_APP_TOKENS.get(name, {})
            ftitle_ = str(g.value(f, C.description) or "")
            named = [a_ for a_, ws in toks.items() if any(w in ftitle_ for w in ws)]
            for aid in (named or meta["apps"]):
                for (a2, cc), s in subs.items():
                    if a2 != aid:
                        continue
                    udc_audit = name.startswith("udc-2026")
                    has_non_udc = any(k2[0] == aid and k2[1] != "udc-2026" for k2 in subs)
                    if udc_audit != (cc == "udc-2026") and has_non_udc:
                        continue
                    g.add((s, C.blockedBy, f))
                    g.add((f, C.affects, apps[aid]))

    # ---- 段階の記録 ----------------------------------------------------------------
    def record(s, stage, paths, note=None):
        r = b.node(ID[f"stagerec/{str(s).split('/sub/')[1]}/{stage}"], "StageRecord", f"{stage}: {str(s).split('/sub/')[1]}")
        g.add((r, C.ofSubmission, s))
        g.add((r, C.atStage, stages[stage]))
        b.add(r, C.note, note)
        for p in paths or ["CLAUDE.md"]:
            b.cite(r, p)

    for (aid, cc), s in subs.items():
        intel = sorted(str(Path(p).relative_to(ROOT)) for p in glob.glob(str(ROOT / f"reports/intel/{cc}-*.md")))
        recon = sorted(str(Path(p).relative_to(ROOT)) for p in glob.glob(str(ROOT / f"reports/recon/{cc}-*.md")))
        if intel:
            record(s, "intel", intel, "コンペ単位の記録")
        if recon:
            record(s, "recon", recon, "コンペ単位の記録")
        slot = str(g.value(s, C.slotKey))
        if slot not in sel_decisions:
            record(s, "select", [], "同じ枠に競合する案がない（選定する対象がない）")
        d = M.APP_DIRS.get(aid)
        if d and (ROOT / d / "README.md").exists():
            record(s, "build", [d + "/README.md"], "アプリのディレクトリと README がある")
        elif M.SUBMISSION_FILES.get((aid, cc)):
            record(s, "build", [M.SUBMISSION_FILES[(aid, cc)][0]], "提出文の初稿がある")
        files = [must_exist("reports/aggressor/" + f) for f in M.AGGRESSOR.get(aid, [])]
        if files:
            record(s, "aggress", files)
        files = [must_exist("reports/ops/" + f) for f in M.OPS_RESEARCH.get(aid, [])]
        if files:
            record(s, "research", files)
        cur = [n for n, mt in M.AUDITS.items() if aid in mt["apps"] and n not in superseded]
        if cur:
            record(s, "audit", [f"reports/audit/{n}.md" for n in cur])

    # ---- 進捗（作業・判断待ち） --------------------------------------------------------
    status_files = sorted(glob.glob(str(ROOT / "reports/ops/status-*.md")))
    st = str(Path(status_files[-1]).relative_to(ROOT))
    REPORT["status_file"] = st
    REPORT["status_asof"] = re.search(r"(\d{4}-\d{2}-\d{2})", rd(st).split("\n")[0]).group(1) if re.search(r"(\d{4}-\d{2}-\d{2})", rd(st).split("\n")[0]) else None
    sl = rd(st).split("\n")
    cur_contest, cur_app, cur_target, n_task, n_dec = None, None, None, 0, 0
    in_pending_list = False

    def split_items(s):
        out, depth, cur = [], 0, ""
        for ch in s:
            if ch in "（(":
                depth += 1
            elif ch in "）)":
                depth -= 1
            if ch == "／" and depth <= 0:
                out.append(cur.strip())
                cur = ""
            else:
                cur += ch
        if cur.strip():
            out.append(cur.strip())
        return [strip_md(x).rstrip("。") for x in out if x.strip()]

    def owner(text):
        if "判断待ち" in text:
            return "commander"
        for kw, ag in M.OWNER_KEYWORDS:
            if kw in text:
                return ag
        return None

    def due_of(text):
        m = re.search(r"期限\s*(?:は)?\s*(\d{1,2})/(\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?", text)
        if m:
            mo, d, hh, mm = int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)
            return jst_date(2026, mo, d, int(hh), int(mm)) if hh else jst_date(2026, mo, d, 23, 59)
        return None

    def decision_class(t):
        if "registry" in t:
            return "RegistryChange"
        if re.search(r"ページ.*削除|削除", t):
            return "PageDeletion"
        if re.search(r"どちら|どれを|今の案・新しい案|両方|出すか|選ぶ|に出す作品", t):
            return "SelectionDecision"
        if re.search(r"提出|登録するか", t):
            return "SubmissionDecision"
        return "HumanGate"

    def last_deadline(t):
        ms = list(re.finditer(r"(?:(2027)/)?(\d{1,2})/(\d{1,2})(?:\s*(\d{1,2}):(\d{2}))?", t))
        if not ms:
            return None
        m = ms[-1]
        y = 2027 if m.group(1) else 2026
        if not m.group(4):
            return jst_date(y, int(m.group(2)), int(m.group(3)))  # 時刻の記載がなければ日付だけ
        return jst_date(y, int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)))

    for n, ln in enumerate(sl, 1):
        m2 = re.match(r"^##\s+(.*)$", ln)
        if m2:
            cm = re.search(r"（([a-z]+-2026)）", m2.group(1))
            cur_contest = cm.group(1) if cm else None
            in_pending_list = "判断待ちの一覧" in m2.group(1)
            cur_app = cur_target = None
            continue
        m3 = re.match(r"^###\s+(.*)$", ln)
        if m3:
            cur_app, cur_target = None, None
            for rx, aid, tgt in M.STATUS_HEADINGS:
                if re.search(rx, m3.group(1)):
                    cur_app, cur_target = aid, tgt or cur_contest
                    break
            continue
        if in_pending_list:
            lm = re.match(r"^\d+\.\s+(.*)$", ln)
            if lm:
                txt = strip_md(lm.group(1))
                n_dec += 1
                dd = b.node(ID[f"decision/status/list-{n_dec}"], decision_class(txt), txt[:80])
                b.add(dd, C.status, "未決（進捗一覧の判断待ちの一覧）")
                b.add(dd, C.description, txt)
                b.add(dd, C.dueAt, dlit(last_deadline(txt)))
                b.cite(dd, st, f"L{n}")
            continue
        bm = re.match(r"^-\s+(完了|残作業|判断待ち|決定):\s*(.*)$", ln)
        if not bm:
            continue
        kind, body = bm.groups()
        if cur_app is None and cur_contest is None:
            continue
        if kind == "決定":
            continue
        if kind == "判断待ち":
            for it in split_items(body):
                n_dec += 1
                dd = b.node(ID[f"decision/status/{n_dec}"], decision_class(it), it[:80])
                b.add(dd, C.status, "未決（進捗一覧の判断待ち）")
                b.add(dd, C.description, it)
                if cur_app:
                    g.add((dd, C.forApp, apps[cur_app]))
                    if (cur_app, cur_target) in subs:
                        g.add((dd, C.forSubmission, subs[(cur_app, cur_target)]))
                        g.add((subs[(cur_app, cur_target)], C.awaitsDecision, dd))
                elif cur_contest:
                    b.add(dd, C.note, f"コンペ共通: {cur_contest}")
                    g.add((dd, C.ofContest, contests[cur_contest]))
                b.cite(dd, st, f"L{n}")
            continue
        for it in split_items(body):
            n_task += 1
            t = b.node(ID[f"task/{n_task}"], "Task", it[:80])
            b.add(t, C.description, it)
            b.add(t, C.status, "done" if kind == "完了" else "open")
            if kind == "残作業":
                who = owner(it)
                if who:
                    g.add((t, C.assignedTo, agent(who)))
                else:
                    b.gap(t, "担当（文面に部隊名・総司令官の語がない）")
                b.add(t, C.dueAt, dlit(due_of(it)))
            if cur_app:
                g.add((t, C.forApp, apps[cur_app]))
                if (cur_app, cur_target) in subs:
                    g.add((t, C.forSubmission, subs[(cur_app, cur_target)]))
            elif cur_contest:
                g.add((t, C.note, Literal(f"コンペ共通: {cur_contest}")))
            b.cite(t, st, f"L{n}")
    REPORT["counts"]["tasks"] = n_task
    REPORT["counts"]["open_tasks"] = len(list(g.subjects(C.status, Literal("open"))))
    REPORT["counts"]["decisions_from_status"] = n_dec

    # ---- エスカレーション・補佐の決定 -------------------------------------------------
    for p in sorted(glob.glob(str(ROOT / "reports/escalations/*.md"))):
        name = Path(p).stem
        rel = f"reports/escalations/{name}.md"
        if name not in M.ESCALATION_APPS:
            raise SystemExit(f"{rel} が mappings.ESCALATION_APPS にない")
        text = rd(rel)
        e = b.node(ID["escalation/" + name], "Escalation", h1(text) or name)
        b.add(e, C.status, "エスカレーション記録（解決の記録は未抽出）")
        b.add(e, C.recordedOn, Literal(f"{name[:4]}-{name[4:6]}-{name[6:8]}", datatype=XSD.date))
        b.cite(e, rel, "L1")
        for aid in M.ESCALATION_APPS[name]:
            g.add((e, C.forApp, apps[aid]))
    for p in sorted(glob.glob(str(ROOT / "reports/command/decision-*.md"))):
        name = Path(p).stem
        rel = f"reports/command/{name}.md"
        text = rd(rel)
        d = b.node(ID["decision/aide/" + name], "Decision", h1(text) or name)
        b.add(d, C.status, "判断済み（総司令官補佐の決定。後続の期限つき作業は進捗一覧を参照）")
        g.add((d, C.decidedBy, agent("commander-aide")))
        dm = re.search(r"(\d{4})-(\d{2})-(\d{2})", h1(text) or "")
        b.add(d, C.recordedOn, Literal(dm.group(0), datatype=XSD.date) if dm else None)
        b.cite(d, rel, "L1")
        for aid in M.DECISION_APPS.get(name, []):
            g.add((d, C.forApp, apps[aid]))
    REPORT["counts"]["escalations"] = len(list(g.subjects(RDF.type, C.Escalation)))

    # ---- PR・マージ記録 -------------------------------------------------------------
    prs, pr_src = load_prs(offline)
    pr_nodes = {}
    for p in prs:
        n = b.node(ID[f"pr/{p['number']}"], "PullRequest", f"#{p['number']} {p['title']}"[:100])
        pr_nodes[p["number"]] = n
        b.add(n, C.prNumber, p["number"])
        b.add(n, C.prState, p["state"])
        b.add(n, C.headRef, p["headRefName"])
        b.add(n, C.baseRef, p["baseRefName"])
        if p.get("mergedAt"):
            b.add(n, C.mergedAt, Literal(p["mergedAt"], datatype=XSD.dateTime))
        b.add(n, C.url, Literal(p["url"], datatype=XSD.anyURI))
        b.cite(n, url=p["url"])
        for aid, d in M.APP_DIRS.items():
            if any(f.startswith(d + "/") for f in p.get("files", [])):
                g.add((n, C.contains, apps[aid]))
    REPORT["counts"]["pull_requests"] = len(prs)
    # ---- 代理マージ（総司令官 2026-11-21 の指示）: PR のマージは HumanGate ではなく、総司令官補佐が承認なしで行う委任の作業 ----
    rule = b.node(ID["rule/merge-delegation"], "DelegationRule", "代理マージの規則（総司令官補佐が承認なしでマージ）")
    g.add((rule, C.delegatedTo, agent("commander-aide")))
    b.add(rule, C.approvalRequired, False)
    b.add(rule, C.condition, "マージを止める条件は、CI の必須チェックが通らない・registry の変更に総司令官の承認がない・競合がある・秘密情報の混入・ページ削除を含む（PageDeletion は総司令官の判断）だけ。憲兵の監査の失格級・デザイン審査の重大が残っていてもマージは止めないが、残っていれば記録し、提出可能・完成とは報告しない")
    b.add(rule, C.note, "確定: 総司令官本人が PR #46 をマージした（2026-11-21 13:41 UTC）。補佐の SOP は「失格級・重大は記録するがマージを止めない」。.claude/agents/commander-aide.md・CLAUDE.md・doctrine/roe.md に反映済み")
    b.cite(rule, path="総司令官の指示（2026-11-21）", locator="原文「代理マージは承認なしで行うこと」")
    b.cite(rule, path="総司令官の指示（2026-11-21）", locator="原文「以降は指示なしでも代理でマージを行う仕組みにすること」")
    b.cite(rule, url="https://github.com/sota1111/geo-campaign-2026/pull/46")
    b.cite(rule, path="doctrine/roe.md", locator="表の「総司令官補佐は条件を満たす PR を指示なしでマージ可」の行")
    b.cite(rule, path="CLAUDE.md", locator="成果の返し方 4")
    for p in prs:
        if p["state"] != "OPEN":
            continue
        md = b.node(ID[f"mergedelegation/{p['number']}"], "MergeDelegation", f"代理マージの判断: #{p['number']} {p['title']}"[:100])
        b.add(md, C.status, "open")
        b.add(md, C.description, f"PR #{p['number']} を総司令官補佐が代理マージするか判断する（条件を満たさなければマージしない。総司令官の承認は不要）")
        g.add((md, C.assignedTo, agent("commander-aide")))
        g.add((md, C.forPullRequest, pr_nodes[p["number"]]))
        g.add((md, C.delegationRule, rule))
        b.cite(md, path="CLAUDE.md", locator="成果の返し方 4")
        b.cite(md, url=p["url"])
    REPORT["pr_source"] = pr_src
    for p in sorted(glob.glob(str(ROOT / "reports/command/merge-*.md"))):
        name = Path(p).stem
        rel = f"reports/command/{name}.md"
        dm = re.search(r"(\d{4})(\d{2})(\d{2})", name)
        for n, ln in enumerate(rd(rel).split("\n"), 1):
            m = re.match(r"^\|\s*#(\d+)\b[^|]*\|\s*(マージ(?:した|しなかった)[^|]*?)\s*\|(.*)\|\s*$", ln)
            if not m or int(m.group(1)) not in pr_nodes:
                continue
            num = int(m.group(1))
            mr = b.node(ID[f"mergerec/{name}/{num}"], "MergeRecord", f"{name} #{num}")
            b.add(mr, C.verdict, m.group(2))
            b.add(mr, C.reason, strip_md(m.group(3).split("|")[-1] if "|" in m.group(3) else m.group(3)))
            b.add(mr, C.recordedOn, Literal(f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}", datatype=XSD.date))
            b.cite(mr, rel, f"L{n}")
            g.add((pr_nodes[num], C.mergeRecord, mr))

    # ---- 出力 ------------------------------------------------------------------------
    return b, {"asOf": AS_OF, "fit_source": fit_src, "pr_source": pr_src}


def serialize(g, path):
    ctx = {"c": str(C), "id": str(ID), "rdfs": str(RDFS), "xsd": str(XSD)}
    path.write_text(g.serialize(format="json-ld", context=ctx, indent=1) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="gh を呼ばず data/gh-pr-snapshot.json を使う")
    ap.add_argument("--out", default=str(HERE / "campaign.jsonld"))
    ap.add_argument("--check", action="store_true", help="書かずに、生成結果が既存の campaign.jsonld と一致するか調べる（古ければ exit 1）")
    args = ap.parse_args()
    b, meta = build(args.offline or args.check)
    out = Path(args.out)
    if args.check:
        old = Graph().parse(out, format="json-ld")
        same = set(old) == set(b.g)
        print("最新" if same else f"古い: 追加 {len(set(b.g) - set(old))} 件・消えた {len(set(old) - set(b.g))} 件。build_graph.py を実行する")
        sys.exit(0 if same else 1)
    serialize(b.g, out)
    REPORT["triples"] = len(b.g)
    REPORT["meta"] = meta
    REPORT["gap_count"] = len(REPORT["gaps"])
    (HERE / "build-report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{out}: {len(b.g)} triples")
    print(json.dumps(REPORT["counts"], ensure_ascii=False))
    print(f"未抽出: {REPORT['gap_count']} 件（build-report.json）")


if __name__ == "__main__":
    main()
