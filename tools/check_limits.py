#!/usr/bin/env python3
"""提出項目の文字数を registry.json の field_limits と照合する。

python3 tools/check_limits.py ichibiz-2026
文字数は改行を除いた全文字（空白・句読点を含む）で数える。超過・空欄があれば exit 1。
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def count(text: str) -> int:
    return len(text.replace("\r", "").replace("\n", ""))


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    cid = sys.argv[1]
    reg = json.loads((ROOT / "contests" / "registry.json").read_text(encoding="utf-8"))
    c = next((x for x in reg["contests"] if x["id"] == cid), None)
    if c is None:
        print(f"未登録のコンペ: {cid}")
        return 2
    limits = c.get("field_limits", {})
    if not limits:
        print(f"{cid}: 文字数上限が未登録です（情報部の調査待ち）")
        return 0
    ok = True
    for fname, limit in limits.items():
        p = ROOT / "contests" / cid / "submission" / fname
        n = count(p.read_text(encoding="utf-8").strip()) if p.exists() else 0
        if n == 0:
            status, ok = "空欄", False
        elif n > limit:
            status, ok = f"超過 +{n - limit}", False
        else:
            status = f"OK（余り{limit - n}）"
        print(f"{fname:16s} {n:4d}/{limit:4d}  {status}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
