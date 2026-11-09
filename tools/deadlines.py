#!/usr/bin/env python3
"""締切一覧を残り日数順に表示する。7日以内は🔴、21日以内は🟡。過ぎたものは除外。

python3 tools/deadlines.py [--now 2026-11-09T09:00:00+09:00]
"""
import argparse
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

JST = timezone(timedelta(hours=9))
REG = Path(__file__).resolve().parent.parent / "contests" / "registry.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--now")
    args = ap.parse_args()
    now = datetime.fromisoformat(args.now) if args.now else datetime.now(JST)
    rows = []
    for c in json.loads(REG.read_text(encoding="utf-8"))["contests"]:
        for d in c["deadlines"]:
            at = datetime.fromisoformat(d["at"])
            if at > now:
                rows.append((at, c["id"], c["name"], d["label"]))
    rows.sort()
    for at, cid, name, label in rows:
        days = (at - now).total_seconds() / 86400
        flag = "🔴" if days <= 7 else ("🟡" if days <= 21 else "🟢")
        print(f"{flag} 残り{days:5.1f}日  {at.strftime('%m/%d %H:%M')}  {name} / {label}  [{cid}]")


if __name__ == "__main__":
    main()
