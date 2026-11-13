#!/usr/bin/env python3
"""新案NB（回収圏計画）の文字数検査。python3 contests/ichibiz-2026/check_limits_nb.py
submission/business-nb/ を、ビジネス部門の上限（check_limits_divisions.py と同じ数え方）で検査する。
超過・空欄があれば exit 1。現行案（submission/business/）は見ない。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_limits_divisions import COMMON, DIVISIONS, count  # noqa: E402

BASE = Path(__file__).resolve().parent / "submission" / "business-nb"


def main() -> int:
    ok = True
    print("[business-nb]")
    for fname, limit in DIVISIONS["business"].items():
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
