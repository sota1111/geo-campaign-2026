#!/usr/bin/env python3
"""本人が書ける字数の計測（G1 生成AI条項の判定用）。

python3 contests/ichibiz-2026/scorecards/measure_ai_share.py

各欄について次を出す。
- AI文: 【本人加筆…】の括弧書きを除いた字数（＝AIが書いた文の字数）
- 本人枠: 上限 − AI文（本人が書ける最大字数）
- 本人枠率: 本人枠 ÷ 上限
数え方は check_limits_divisions.py と同じ（改行を除く全文字）。
"""
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / "submission"
LIMITS = {"title.md": 50, "problem.md": 400, "service.md": 700, "background.md": 300,
          "market.md": 400, "challenges.md": 400, "reinfolib.md": 400}
DIVS = {"business": ["problem.md", "service.md", "background.md", "market.md", "challenges.md"],
        "idea": ["problem.md", "service.md", "background.md"],
        "realestate": ["problem.md", "service.md", "background.md"]}
PLACEHOLDER = re.compile(r"【本人加筆[^】]*】")


def main() -> None:
    print(f"{'欄':28s} {'AI文':>5s} {'本人枠':>6s} {'本人枠率':>7s}")
    for div, files in DIVS.items():
        for f in files:
            t = (BASE / div / f).read_text(encoding="utf-8").strip().replace("\r", "").replace("\n", "")
            ai = len(PLACEHOLDER.sub("", t))
            lim = LIMITS[f]
            room = lim - ai
            print(f"{div + '/' + f:28s} {ai:5d} {room:6d} {room * 100 // lim:6d}%")


if __name__ == "__main__":
    main()
