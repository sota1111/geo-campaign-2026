#!/usr/bin/env python3
"""グラフ（campaign.jsonld）への SPARQL 問い合わせから「次の行動」を出す。

  python3 contests/ontology/next_actions.py                       # 人が読む md を標準出力へ
  python3 contests/ontology/next_actions.py --format json         # 機械用 JSON を標準出力へ
  python3 contests/ontology/next_actions.py --out-md a.md --out-json a.json
  python3 contests/ontology/next_actions.py --unusable ksj-P13    # このデータが使えないなら、影響を受けるアプリ・応募

出力に含むもの:
  1. 案・応募ごとの「提出可能か／止めているもの」（Q1・Q2）
  2. 部隊ごとの次の作業（標準の流れで次に来る部隊 Q3 ＋ 止めているものの解消。締切の近い順）
  3. 総司令官の判断待ち一覧（Q4）。人間の関門は自動で進めない（doctrine/roe.md）
  4. データの利用条件で影響を受ける案（Q5・Q5b）
  5. 進捗一覧の残作業（担当別。Q7）
reports/ には書かない。保存は参謀長が行う。
"""
import argparse
import datetime as dt
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

from rdflib import Graph, URIRef

HERE = Path(__file__).resolve().parent
ID = "https://geo-campaign-2026.example/id/"
JST = dt.timezone(dt.timedelta(hours=9))
PH = "本人加筆等の未記入"

# 止めているものの担当を決める規則（推定。出力に「規則による割当」と明記する）
COMMANDER_WORDS = re.compile(r"本人|未記入|総司令官|判断|電話|事務局|問い合わせ|記入|決定待ち|解釈|重複応募|FAQ")
CONFIRM_WORDS = re.compile(r"確認|未解消|結果待ち")
OUTSIDE_CHECK = re.compile(r"電話|事務局|問い合わせ|回答")


def short(u):
    return str(u).replace(ID, "id:")


def load_graph(path=None):
    g = Graph()
    g.parse(HERE / "schema.jsonld", format="json-ld")
    g.parse(path or HERE / "campaign.jsonld", format="json-ld")
    return g


def q(g, name, **bind):
    text = (HERE / "queries" / f"{name}.rq").read_text(encoding="utf-8")
    init = {k: URIRef(v) if isinstance(v, str) and v.startswith("http") else v for k, v in bind.items()}
    rows = []
    for r in g.query(text, initBindings=init):
        rows.append({str(k): (None if v is None else str(v)) for k, v in r.asdict().items()})
    return rows


def parse_dt(s):
    d = dt.datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=JST)


def compute(g, now):
    readiness = q(g, "q1_readiness")
    blockers = q(g, "q2_blockers")
    nxt = {r["sub"]: r for r in q(g, "q3_next_stage")}
    decisions = q(g, "q4_pending_decisions")
    deadlines = defaultdict(list)
    for r in q(g, "q8_deadlines"):
        deadlines[r["sub"]].append((parse_dt(r["at"]), r["label"]))
    tasks = q(g, "q7_open_tasks")
    risky = q(g, "q5b_risky_datasets")

    def due_of(sub):
        ds = sorted(deadlines.get(sub, []))
        future = [d for d in ds if d[0] > now]
        if future:
            return future[0]
        return (ds[-1][0], ds[-1][1] + "（過ぎている）") if ds else (None, None)

    by_sub_blockers = defaultdict(list)
    for b in blockers:
        by_sub_blockers[b["sub"]].append(b)

    subs = []
    unit_actions = defaultdict(list)
    for r in readiness:
        sub = r["sub"]
        at, dlabel = due_of(sub)
        bl = []
        for b in by_sub_blockers.get(sub, []):
            typ = b["type"].split("#")[-1]
            sev = b.get("severity")
            text = b["label"]
            if typ == "Finding" and sev == "軽微":
                continue
            blob = text + (b.get("description") or "")
            owner = "commander" if COMMANDER_WORDS.search(blob) else ("intelligence" if CONFIRM_WORDS.search(blob) else "engineer")
            action = {"commander": "総司令官の記入・判断が要る指摘の解消", "intelligence": "要項・事実の確認", "engineer": "指摘の修正"}[owner]
            if typ == "UnfilledField":
                owner, action = "commander", "未記入欄を書く（部隊は代筆しない。生成AI条項）"
            elif typ == "UnconfirmedDataCondition":
                owner = "commander" if OUTSIDE_CHECK.search(b.get("description") or "") else "intelligence"
                action = "データ利用条件の確認"
            elif typ == "MissingDeliverable":
                owner, action = "engineer", "提出文の作成"
            bl.append(
                {
                    "type": typ,
                    "severity": sev,
                    "certainty": b.get("certainty"),
                    "label": text,
                    "source": b.get("firstSource"),
                    "owner": owner,
                    "action": action,
                }
            )
        # 未記入欄は応募ごとに 1 件へまとめる（ファイル単位の内訳は label に残す）
        uf = [b for b in bl if b["type"] == "UnfilledField"]
        if len(uf) > 1:
            files = [re.sub(r".*submission/", "", x["label"].split(": ", 1)[-1]) for x in uf]
            bl = [b for b in bl if b["type"] != "UnfilledField"] + [
                {**uf[0], "label": f"未記入欄 {len(uf)} ファイル: " + "、".join(files), "source": uf[0]["source"]}
            ]
        n = nxt.get(sub)
        hard = [b for b in bl if b["type"] != "Finding" or b["severity"] == "失格級"]
        item = {
            "submission": short(sub),
            "label": r["label"],
            "app": short(r["app"]),
            "contest": short(r["contest"]),
            "readiness": r["readiness"],
            "counts": {
                "失格級": int(r["disqualifying"]),
                "失格級（確定）": sum(1 for b in bl if b["type"] == "Finding" and b["severity"] == "失格級" and b.get("certainty") == "確定"),
                "失格級（要確認）": sum(1 for b in bl if b["type"] == "Finding" and b["severity"] == "失格級" and b.get("certainty") != "確定"),
                "要修正": int(r["mustFix"]),
                "未記入欄ファイル": int(r["unfilled"]),
                "データ条件": int(r["dataCondition"]),
                "提出文なし": int(r["missingDraft"]),
                "監査記録": int(r["audited"]),
                "選定待ち": int(r["pendingSelection"]),
            },
            "deadline": {"at": at.isoformat() if at else None, "label": dlabel},
            "nextStage": ({"stage": n["stageLabel"], "unit": n["unitName"], "agent": short(n["unit"]).split("/")[-1], "humanGate": n["human"] == "true"} if n else None),
            "blockerOwners": sorted({b["owner"] for b in bl}),
            "blockers": bl,
        }
        subs.append(item)
        # --- 部隊ごとの次の作業 ---
        key = at or dt.datetime.max.replace(tzinfo=JST)
        due = at.isoformat() if at else None
        if n:
            gate_blocked = n["human"] == "true" and r["readiness"] != "提出可能な状態"
            if not gate_blocked:
                ag = item["nextStage"]["agent"]
                act = f"標準の流れの次: {n['stageLabel']}" + ("（総司令官の判断。自動では進めない）" if n["human"] == "true" else "")
                unit_actions[ag].append({"due": due, "app": item["app"], "submission": item["submission"], "action": act,
                                         "why": "記録のある最後の段階の次（Q3）", "_k": key})
        seen = set()
        for b in bl:
            k2 = (b["owner"], b["action"], b["label"])
            if k2 in seen:
                continue
            seen.add(k2)
            unit_actions[b["owner"]].append({"due": due, "app": item["app"], "submission": item["submission"],
                                             "action": f"{b['action']}: {b['label']}", "why": f"{b['type']}（規則による割当）",
                                             "source": b["source"], "_k": key})
        if any(b["owner"] == "engineer" and b["type"] == "Finding" for b in bl):
            unit_actions["military-police"].append({"due": due, "app": item["app"], "submission": item["submission"],
                                                    "action": "指摘の修正後に再監査（失格級が0になるまで提出可能と報告しない）",
                                                    "why": "憲兵の SOP", "_k": key})
    # 開いている PR の代理マージ: 総司令官補佐の作業（承認は不要。総司令官の判断待ちには入れない）
    seen_pr = set()
    for r in q(g, "q10_merge_delegations"):
        if r["task"] in seen_pr:
            continue
        seen_pr.add(r["task"])
        unit_actions[r["agentName"]].append({"due": None, "app": short(r["app"]) if r.get("app") else None, "submission": None,
                                              "action": f"代理マージを判断: PR #{r['prNumber']}（承認不要。条件: {r['condition'][:60]}…）",
                                              "why": "総司令官の指示（2026-11-21）による委任の作業", "source": "CLAUDE.md 成果の返し方 4",
                                              "pr": short(r["pr"]), "_k": dt.datetime.max.replace(tzinfo=JST)})
    return subs, unit_actions, decisions, tasks, risky


def impact(g, dataset=None):
    rows = q(g, "q5_data_impact", **({"dataset": ID + "dataset/" + dataset} if dataset else {}))
    out = defaultdict(lambda: {"apps": {}, "submissions": []})
    for r in rows:
        d = out[short(r["dataset"])]
        d["label"] = r["datasetLabel"]
        d["apps"][short(r["app"])] = r["appLabel"]
        if r.get("sub"):
            item = {"submission": short(r["sub"]), "contest": short(r["contest"]), "division": short(r["division"]) if r.get("division") else None}
            if item not in d["submissions"]:  # 同じ応募を重ねて数えない
                d["submissions"].append(item)
    return out


def build_report(g, now, datasets=None):
    subs, unit_actions, decisions, tasks, risky = compute(g, now)
    ids = [d if d.startswith("id:") else None for d in []]
    if datasets:
        imp = {}
        for d in datasets:
            imp.update(impact(g, d))
        why = {}
    else:
        imp = {}
        for r in risky:
            imp.update(impact(g, r["dataset"].replace(ID + "dataset/", "")))
        why = {short(r["dataset"]): r["why"] for r in risky}
    for k, v in imp.items():
        v["why"] = why.get(k)
    # 判断待ち
    dec = [
        {"decision": short(d["decision"]), "type": d["type"].split("#")[-1], "label": d["label"], "due": d.get("due"), "source": d.get("firstSource")}
        for d in decisions
    ]
    dec.sort(key=lambda x: (x["due"] is None, x["due"] or "", x["label"]))
    # 進捗一覧の残作業（担当別）
    t_by = defaultdict(list)
    for t in tasks:
        t_by[t.get("agentName") or "未抽出"].append(
            {"text": t["text"], "app": short(t["app"]) if t.get("app") else None, "due": t.get("due"), "source": t.get("firstSource")}
        )
    for v in t_by.values():
        v.sort(key=lambda x: (x["due"] is None, x["due"] or ""))
    for ag in unit_actions:
        unit_actions[ag].sort(key=lambda x: (x["_k"], x["app"] or "", x["action"]))
        for a in unit_actions[ag]:
            a.pop("_k", None)
    subs.sort(key=lambda s: (s["deadline"]["at"] is None, s["deadline"]["at"] or "", s["app"]))
    summary = defaultdict(int)
    for s in subs:
        summary[s["readiness"]] += 1
    return {
        "asOf": now.date().isoformat(),
        "generatedBy": "contests/ontology/next_actions.py（SPARQL: contests/ontology/queries/*.rq）",
        "notes": [
            "『提出可能な状態』は憲兵の失格級・未記入欄・データ条件・提出文の欠落がなく、要修正が残らず、監査があり、案の選定が済んでいること。提出・案の選定は総司令官が決める（自動では進めない）。",
            "止めているものの担当は規則による割当（推定）。指摘の解消の記録は無いため、現行の監査に残る指摘は未解消として数える。",
            "進捗一覧（reports/ops/status-*.md）は作成日以降の変化を含まない。",
            "PR のマージは総司令官補佐（commander-aide）が承認なしで行う委任の作業で、総司令官の判断待ちには入れない（総司令官 2026-11-21 の指示、CLAUDE.md 成果の返し方 4）。ページ削除を含む PR だけは総司令官の許可が要る。",
        ],
        "summary": dict(summary),
        "submissions": subs,
        "unitActions": unit_actions,
        "commanderDecisions": dec,
        "dataImpact": imp,
        "statusTasksByAgent": t_by,
    }


def to_md(rep, units_label):
    L = []
    w = L.append
    w(f"# 次の行動（オントロジーから導出）{rep['asOf']}")
    w("")
    for n in rep["notes"]:
        w(f"- {n}")
    w("")
    w("## 1. 案・応募ごとの提出可否（締切の近い順）")
    w("")
    w("| 締切 | 応募 | 判定 | 失格級（確定/要確認） | 要修正 | 未記入欄ファイル | データ条件 | 提出文なし | 先に解消する担当 | 流れの次 |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for s in rep["submissions"]:
        c = s["counts"]
        d = (s["deadline"]["at"] or "未抽出")[:16].replace("T", " ")
        ns = f"{s['nextStage']['unit']}（{s['nextStage']['stage']}）" if s["nextStage"] else "未抽出"
        own = "・".join(units_label.get(o, o) for o in s["blockerOwners"]) or "なし"
        w(f"| {d} | {s['label'][:34]} | **{s['readiness']}** | {c['失格級']}（{c['失格級（確定）']}/{c['失格級（要確認）']}） | {c['要修正']} | {c['未記入欄ファイル']} | {c['データ条件']} | {c['提出文なし']} | {own} | {ns} |")
    w("")
    w("### 止めているもの（失格級・未記入欄・データ条件・提出文なし）")
    for s in rep["submissions"]:
        hard = [b for b in s["blockers"] if not (b["type"] == "Finding" and b["severity"] == "要修正")]
        if not hard:
            continue
        w(f"- **{s['label']}**")
        for b in hard:
            cert = f"・{b['certainty']}" if b.get("certainty") else ""
            w(f"  - {b['type']}{('（' + b['severity'] + cert + '）') if b.get('severity') else ''}: {b['label'][:90]} — 出典 {b['source']}")
    w("")
    w("## 2. 部隊ごとの次の作業（締切の近い順）")
    order = ["commander", "intelligence", "recon", "engineer", "aggressor", "operations-research", "military-police", "design-reviewer"]
    for ag in order + [a for a in rep["unitActions"] if a not in order]:
        acts = rep["unitActions"].get(ag)
        if not acts:
            continue
        w("")
        w(f"### {units_label.get(ag, ag)}（{len(acts)} 件）")
        shown = acts[:12]
        for a in shown:
            due = (a["due"] or "締切未抽出")[:16].replace("T", " ")
            w(f"- [{due}] {a['app'].replace('id:app/', '')}: {a['action'][:110]}")
        if len(acts) > len(shown):
            w(f"- …ほか {len(acts) - len(shown)} 件（JSON に全件）")
    w("")
    w("## 3. 総司令官の判断待ち")
    w("")
    for d in rep["commanderDecisions"]:
        due = (d["due"] or "期限未抽出")[:16].replace("T", " ")
        w(f"- [{due}] {d['type']}: {d['label']}")
    w("")
    w("## 4. データの利用条件で影響を受ける案（非商用・未確認のデータ）")
    w("")
    for k, v in sorted(rep["dataImpact"].items()):
        subs_ = ", ".join(sorted({s['submission'].replace('id:sub/', '') for s in v["submissions"]})) or "応募なし"
        w(f"- **{v['label']}**（{v.get('why') or '指定'}）: アプリ {', '.join(sorted(a.replace('id:app/', '') for a in v['apps']))} ／ 応募 {subs_}")
    w("")
    w("## 5. 進捗一覧の残作業（担当別。作成日時点）")
    for ag, ts in sorted(rep["statusTasksByAgent"].items()):
        w("")
        w(f"### {units_label.get(ag, ag)}（{len(ts)} 件）")
        for t in ts[:8]:
            w(f"- {(t['app'] or '共通').replace('id:app/', '')}: {t['text'][:100]}")
        if len(ts) > 8:
            w(f"- …ほか {len(ts) - 8} 件")
    return "\n".join(L) + "\n"


def unit_labels(g):
    from rdflib import Namespace, RDFS

    C = Namespace("https://geo-campaign-2026.example/ontology#")
    out = {}
    for u in g.subjects(C.agentName, None):
        out[str(g.value(u, C.agentName))] = str(g.value(u, RDFS.label))
    out["未抽出"] = "担当 未抽出"
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--out-md")
    ap.add_argument("--out-json")
    ap.add_argument("--now", help="基準日 YYYY-MM-DD（既定は今日。締切の「先」を決める）")
    ap.add_argument("--unusable", action="append", help="このデータ id（例 ksj-P13）が使えない場合の影響を出す。複数可")
    args = ap.parse_args()
    now = dt.datetime.fromisoformat(args.now + "T00:00:00").replace(tzinfo=JST) if args.now else dt.datetime.now(JST)
    g = load_graph(args.graph)
    rep = build_report(g, now, args.unusable)
    md = to_md(rep, unit_labels(g))
    js = json.dumps(rep, ensure_ascii=False, indent=1)
    if args.out_md:
        Path(args.out_md).write_text(md, encoding="utf-8")
    if args.out_json:
        Path(args.out_json).write_text(js + "\n", encoding="utf-8")
    if not (args.out_md or args.out_json):
        sys.stdout.write(md if args.format == "md" else js + "\n")


if __name__ == "__main__":
    main()
