#!/usr/bin/env python3
"""イチBiz 不動産部門の新案 RN1（submission/realestate-rn1/）の文字数検査。

python3 contests/ichibiz-2026/check_limits_rn1.py
数え方・上限は check_limits_divisions.py の realestate と同じ（改行を除く全文字。空白・句読点・【本人加筆】括弧書きを含む）。
reinfolib.md は字数未確認のため400字以内を目安にしている。超過・空欄があれば exit 1。
現行案（submission/realestate/）の検査は check_limits_divisions.py。こちらはそれを変更せずに追加した検査。
"""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent / "submission" / "realestate-rn1"
LIMITS = {"title.md": 50, "problem.md": 400, "service.md": 700, "background.md": 300, "reinfolib.md": 400}


def count(text: str) -> int:
    return len(text.replace("\r", "").replace("\n", ""))


def main() -> int:
    ok = True
    print("[realestate-rn1]")
    for fname, limit in LIMITS.items():
        p = BASE / fname
        n = count(p.read_text(encoding="utf-8").strip()) if p.exists() else 0
        if n == 0:
            status, ok = "空欄", False
        elif n > limit:
            status, ok = f"超過 +{n - limit}", False
        else:
            status = f"OK（余り{limit - n}、{n * 100 // limit}%）"
        print(f"  {fname:14s} {n:4d}/{limit:4d}  {status}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
