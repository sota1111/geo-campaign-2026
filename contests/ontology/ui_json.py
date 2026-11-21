#!/usr/bin/env python3
"""ダッシュボードのオントロジー画面が読む「次の行動」JSON を作る（画面はビルド時にこれを public/ へ写す）。

  python3 contests/ontology/ui_json.py --out contests/ontology/next-actions.json [--now YYYY-MM-DD]

next_actions.build_report の結果に、全データについて「このデータが使えなければ」の影響
（next_actions.py --unusable と同じ計算）を dataImpactAll として足す。reports/ には書かない。
"""
import argparse
import datetime as dt
import json
from pathlib import Path

import next_actions as NA


def build(now):
    g = NA.load_graph()
    ids = sorted({NA.short(r["dataset"]).replace("id:dataset/", "") for r in NA.q(g, "q5_data_impact")})
    rep = NA.build_report(g, now, ids)
    rep["dataImpactAll"] = rep.pop("dataImpact")
    rep["unitLabels"] = NA.unit_labels(g)
    # 提出予定数（総司令官の決定 2026-11-21。要項の上限とは別）。コンペ id → {total, parts}。未定のコンペは含めない
    planned = {}
    for r in NA.q(g, "q11_planned_counts"):
        cid = NA.short(r["contest"]).replace("id:contest/", "")
        e = planned.setdefault(cid, {"total": None, "parts": {}})
        if r.get("plannedLabel"):
            e["parts"][r["plannedLabel"]] = int(r["count"])
        else:
            e["total"] = int(r["count"])
    rep["plannedSubmissions"] = planned
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--now", help="基準日 YYYY-MM-DD（既定は今日）")
    a = ap.parse_args()
    now = dt.datetime.fromisoformat(a.now + "T00:00:00").replace(tzinfo=NA.JST) if a.now else dt.datetime.now(NA.JST)
    rep = build(now)
    Path(a.out).write_text(json.dumps(rep, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{a.out}: ok（データ {len(rep['dataImpactAll'])} 件の影響を含む）")


if __name__ == "__main__":
    main()
