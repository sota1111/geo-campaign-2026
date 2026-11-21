#!/usr/bin/env python3
"""提案 md の各項目の字数を数える（docx 化の前の下見）。
python3 contests/satellite-2026/tools/cnt_md.py proposal-sugi proposal-yabu
改行を除く全文字。[図] 行は除く。【本人加筆…】を除いた字数も出す。450〜550字が目安（check_docx.py と同じ範囲）。
"""
import re
import sys
from pathlib import Path

SUB = Path(__file__).resolve().parent.parent / "submission"
for n in sys.argv[1:]:
    t = (SUB / f"{n}.md").read_text(encoding="utf-8")
    for s in re.split(r"\n## ", t)[1:]:
        h, _, b = s.partition("\n")
        body = "".join(l for l in b.split("\n") if not l.startswith("[図]"))
        nob = re.sub(r"【本人加筆[^】]*】", "", body)
        print(n, h[:14], len(body), "(本人加筆を除く", len(nob), ")")
