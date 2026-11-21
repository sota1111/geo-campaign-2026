#!/usr/bin/env python3
"""グラフ表示用の JSON（ノードとエッジ）を campaign.jsonld から作る。画面は作らない。

  python3 contests/ontology/graph_json.py --out contests/ontology/graph.json
  python3 contests/ontology/graph_json.py            # 標準出力

形:
  {"asOf", "legend": {type: {label}}, "relations": {rel: label},
   "nodes": [{id, type, label, status, sources:[{path,locator,url}], props:{...}}],
   "edges": [{source, target, rel, label, props?}]}
status: 画面の色分け用の短い語。Submission=提出判定、Finding=重大度、Task/Decision/PR=状態、
        Dataset=利用条件の注意（要確認/なし）、App=案の種別。
"""
import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from rdflib import Namespace, RDF, RDFS, URIRef

import next_actions as NA

C = Namespace("https://geo-campaign-2026.example/ontology#")
ID = "https://geo-campaign-2026.example/id/"
HERE = Path(__file__).resolve().parent

# 画面に出すノードの種類（より具体的な型を先に）
TYPES = [
    "SelectionDecision", "SubmissionDecision", "RegistryChange", "PageDeletion", "HumanGate", "Escalation",
    "UnfilledField", "UnconfirmedDataCondition", "MissingDeliverable",
    "Finding", "Submission", "App", "Contest", "Division", "Theme", "Deadline", "Criterion", "Rule",
    "SubmissionLimit", "Dataset", "License", "MergeDelegation", "DelegationRule", "Task", "Decision", "PullRequest", "Audit", "Unit", "Commander", "Stage",
]
# グラフに線を引く関係（画面で意味のあるもの。hasSource は各ノードの sources に入れる）
RELS = [
    "hasDivision", "hasTheme", "hasDeadline", "hasCriterion", "hasRule", "hasSubmissionLimit", "ofContest",
    "ofApp", "toContest", "toDivision", "toTheme", "hasSubmission", "usesDataset", "hasLicense", "restricts",
    "fitsContest", "competesWith", "demoOf", "blockedBy", "awaitsDecision", "assignedTo", "forApp", "forSubmission",
    "raisedIn", "contains", "auditsApp", "supersedes", "affects", "overDataset", "appliesToApp", "performedBy", "decidedBy", "forPullRequest", "delegationRule", "delegatedTo",
]


def build(g, now):
    subs, *_ = NA.compute(g, now)
    ready = {s["submission"]: s for s in subs}
    nodes, ids = [], set()

    def node_type(n):
        have = {str(t).split("#")[-1] for t in g.objects(n, RDF.type)}
        return next((t for t in TYPES if t in have), None)

    def sources(n):
        out = []
        for s in g.objects(n, C.hasSource):
            out.append({k: (str(g.value(s, C[k])) if g.value(s, C[k]) is not None else None) for k in ("path", "locator", "url")})
        return sorted(out, key=lambda x: (x["path"] or "", x["locator"] or ""))

    risky = {NA.short(r["dataset"]) for r in NA.q(g, "q5b_risky_datasets")}

    for n in sorted(set(g.subjects(RDF.type, None)), key=str):
        if not str(n).startswith(ID) or "/src/" in str(n):
            continue
        t = node_type(n)
        if t is None or t in ("Deadline",) and False:
            continue
        sid = NA.short(n)
        props = {}
        status = None
        if t == "Submission":
            r = ready.get(sid)
            status = r["readiness"] if r else None
            if r:
                props = {"counts": r["counts"], "deadline": r["deadline"], "nextStage": r["nextStage"]}
        elif t == "Finding":
            status = str(g.value(g.value(n, C.severity), RDFS.label)) if g.value(n, C.severity) is not None else None
            props = {k: str(g.value(n, C[k])) for k in ("certainty", "rawSeverity") if g.value(n, C[k]) is not None}
        elif t in ("Task", "MergeDelegation", "Decision", "SelectionDecision", "SubmissionDecision", "RegistryChange", "PageDeletion", "HumanGate", "Escalation"):
            status = str(g.value(n, C.status)) if g.value(n, C.status) is not None else None
            if g.value(n, C.dueAt) is not None:
                props["dueAt"] = str(g.value(n, C.dueAt))
            if t not in ("Task", "MergeDelegation"):
                props["humanGate"] = t in ("SelectionDecision", "SubmissionDecision", "RegistryChange", "PageDeletion", "HumanGate")
        elif t == "PullRequest":
            status = str(g.value(n, C.prState))
            props = {"number": int(g.value(n, C.prNumber)), "url": str(g.value(n, C.url))}
        elif t == "Dataset":
            status = "要確認" if sid in risky else "記載あり"
        elif t == "App":
            status = str(g.value(n, C.planKind)) if g.value(n, C.planKind) is not None else None
            props = {k: str(g.value(n, C[k])) for k in ("audience", "purpose", "dataKind") if g.value(n, C[k]) is not None}
        elif t == "Deadline":
            status = "済" if g.value(n, C.doneAt) is not None else "未"
            props = {"at": str(g.value(n, C.dueAt))}
        elif t == "Audit":
            props = {"date": str(g.value(n, C.auditDate))} if g.value(n, C.auditDate) is not None else {}
        if g.value(n, C.extracted) is not None:
            props["extracted"] = [str(x) for x in g.objects(n, C.extracted)]
        label = g.value(n, RDFS.label)
        nodes.append({"id": sid, "type": t, "label": str(label) if label is not None else sid, "status": status,
                      "sources": sources(n), "props": props})
        ids.add(sid)

    edges, seen = [], set()
    rel_label = {r: str(g.value(C[r], RDFS.label)) for r in RELS}
    for r in RELS:
        for s, o in g.subject_objects(C[r]):
            a, b = NA.short(s), NA.short(o)
            if a in ids and b in ids and (a, b, r) not in seen:
                seen.add((a, b, r))
                edges.append({"source": a, "target": b, "rel": r, "label": rel_label[r]})
    # 適合（Fit）は線にして、◎○△×？とスコアを持たせる
    for f in g.subjects(RDF.type, C.Fit):
        a, b = NA.short(g.value(f, C.fitApp)), NA.short(g.value(f, C.fitTarget))
        if a in ids and b in ids:
            edges.append({"source": a, "target": b, "rel": "fit", "label": "適合",
                          "props": {"mark": str(g.value(f, C.mark)), "score": int(g.value(f, C.score)), "reason": str(g.value(f, C.reason)),
                                    "sources": sources(f)}})
    legend = {t: {"label": str(g.value(C[t], RDFS.label))} for t in TYPES}
    return {
        "asOf": now.date().isoformat(),
        "generatedBy": "contests/ontology/graph_json.py（正本は contests/ontology/campaign.jsonld）",
        "legend": legend,
        "relations": {**rel_label, "fit": "適合（◎○△×？）"},
        "nodes": nodes,
        "edges": edges,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--graph")
    ap.add_argument("--out")
    ap.add_argument("--now", help="基準日 YYYY-MM-DD（Submission の締切の先を決める）")
    args = ap.parse_args()
    now = dt.datetime.fromisoformat(args.now + "T00:00:00").replace(tzinfo=NA.JST) if args.now else dt.datetime.now(NA.JST)
    g = NA.load_graph(args.graph)
    js = json.dumps(build(g, now), ensure_ascii=False, indent=1)
    if args.out:
        Path(args.out).write_text(js + "\n", encoding="utf-8")
        print(f"{args.out}: ok")
    else:
        sys.stdout.write(js + "\n")


if __name__ == "__main__":
    main()
