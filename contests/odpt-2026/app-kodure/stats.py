"""生成済み web/data から、README・作品説明に書く要約値を再計算する（画面と同じ判定）。

python3 stats.py
行き帰りとも許容時間内に着ける組を「行ける」とし、0〜14歳人口で集計する（画面の「行き帰りとも行ける」と同じ）。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from kodure import build as kb  # noqa: E402

D = ROOT / "web" / "data"
M = json.loads((D / "meta.json").read_text(encoding="utf-8"))
NC = len(M["cells"])
CELLS = M["cells"]
KIDS = sum(x[2] for x in CELLS)
POP = sum(x[1] for x in CELLS)
_cache = {}


def load(d, h, c, t):
    k = (d, h, c, t)
    if k not in _cache:
        _cache[k] = [kb.rle_decode(s, NC) for s in json.loads((D / f"m_{d}{h}_c{c}_t{t}.json").read_text(encoding="utf-8"))]
    return _cache[k]


def head(o=9, r=16, w=45, c=500, t=2, kinds=None, exclude_walkable=False):
    """行き帰りとも行ける行き先が1か所以上ある地区の0〜14歳の割合（%）。"""
    O, R = load("o", o, c, t), load("r", r, c, t)
    lim = w // 5
    ds = [i for i, d in enumerate(M["dests"]) if kinds is None or d[3] in kinds]
    a = 0
    for ci in range(NC):
        if any(0 < O[d][ci] <= lim and 0 < R[d][ci] <= lim for d in ds):
            a += CELLS[ci][2]
    return round(100 * a / KIDS, 1)


def dest(name, o=9, r=16, w=45, c=500, t=2):
    """行き先の名前 -> (行き帰りとも行ける0〜14歳の%, 片道だけの%, 行き先の行)"""
    O, R = load("o", o, c, t), load("r", r, c, t)
    lim = w // 5
    i = [k for k, d in enumerate(M["dests"]) if d[2] == name][0]
    both = sum(CELLS[ci][2] for ci in range(NC) if 0 < O[i][ci] <= lim and 0 < R[i][ci] <= lim)
    one = sum(CELLS[ci][2] for ci in range(NC) if (0 < O[i][ci] <= lim) != (0 < R[i][ci] <= lim))
    return round(100 * both / KIDS, 1), round(100 * one / KIDS, 1), M["dests"][i]


def main():
    print(len(M["dests"]), "行き先、地区", NC, "0〜14歳", KIDS, "総人口", POP)
    print("既定", head())
    for c in (300, 500, 800):
        print("徒歩上限", c, head(c=c))
    print("乗換なし", head(t=1), "30分", head(w=30), "60分", head(w=60), "乗換制限なし", head(t=3))
    print("10時発", head(o=10), "17時発", head(r=17))
    print("公園のみ", head(kinds={"park_l", "park_m"}), "文化施設のみ", head(kinds={"museum", "zoo", "aquarium", "botanical"}),
          "動物園・水族館のみ", head(kinds={"zoo", "aquarium"}))
    for n in sys.argv[1:] or ("上野動物園", "しながわ水族館", "科学技術館", "駒沢オリンピック公園"):
        print(n, dest(n), "60分", dest(n, w=60)[:2])


if __name__ == "__main__":
    main()
