"""福岡市CSVの自由記述に parse_freetext をかけた結果の目視確認用（使い捨て）。
usage: python3 -I tools/try_parse.py raw/aed_fukuoka.csv [unknown|timed|24h] [件数]
"""
import collections
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aed_time as t  # noqa: E402

rows = list(csv.DictReader(open(sys.argv[1], encoding="cp932")))
want = sys.argv[2] if len(sys.argv) > 2 else None
lim = int(sys.argv[3]) if len(sys.argv) > 3 else 30
c = collections.Counter()
ex = collections.defaultdict(collections.Counter)
for x in rows:
    f = x["フリースペース"]
    m = re.search(r"使用時間[：:](.*)", f, re.S)
    txt = (m.group(1) if m else f).strip()
    r = t.parse_freetext(txt)
    key = (r["kind"], r["reason"])
    c[key] += 1
    ex[r["kind"]][txt[:60].replace("\n", " ")] += 1
print(c)
if want:
    for k, v in ex[want].most_common(lim):
        print(v, k)
