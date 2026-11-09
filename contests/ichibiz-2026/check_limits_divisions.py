#!/usr/bin/env python3
"""イチBiz 部門別の文字数検査。

python3 contests/ichibiz-2026/check_limits_divisions.py
数え方は tools/check_limits.py と同じ（改行を除く全文字。空白・句読点・【本人加筆】括弧書きを含む）。
超過・空欄があれば exit 1。submission 直下4ファイルがビジネス部門と一致するかも検査する。
reinfolib.md は字数未確認のため400字以内を目安にしている。
"""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent / "submission"
COMMON = {"title.md": 50, "problem.md": 400, "service.md": 700, "background.md": 300}
DIVISIONS = {
    "business": {**COMMON, "market.md": 400, "challenges.md": 400},
    "idea": dict(COMMON),
    "realestate": {**COMMON, "reinfolib.md": 400},
}


def count(text: str) -> int:
    return len(text.replace("\r", "").replace("\n", ""))


def main() -> int:
    ok = True
    for div, limits in DIVISIONS.items():
        print(f"[{div}]")
        for fname, limit in limits.items():
            p = BASE / div / fname
            n = count(p.read_text(encoding="utf-8").strip()) if p.exists() else 0
            if n == 0:
                status, ok = "空欄", False
            elif n > limit:
                status, ok = f"超過 +{n - limit}", False
            else:
                status = f"OK（余り{limit - n}、{n * 100 // limit}%）"
            print(f"  {fname:14s} {n:4d}/{limit:4d}  {status}")
    print("[submission直下 = business]")
    for fname in COMMON:
        a, b = BASE / fname, BASE / "business" / fname
        same = a.exists() and b.exists() and a.read_text(encoding="utf-8") == b.read_text(encoding="utf-8")
        if not same:
            ok = False
        print(f"  {fname:14s} {'一致' if same else '不一致'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
