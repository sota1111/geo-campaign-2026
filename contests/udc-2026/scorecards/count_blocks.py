#!/usr/bin/env python3
"""UDC下書きの ```text ブロックを、直前の見出し行（「NN字以内」「NN字版」）の上限と照合する。

python3 contests/udc-2026/scorecards/count_blocks.py contests/udc-2026/submission/entry-*.md
字数は改行を除く全文字（空白・句読点を含む）。tools/check_limits.py は registry.json の
field_limits が空（UDCのフォーム字数は未確認）のため、作品名20/40字・概要100/200/400字の
自主上限はこのスクリプトで検査する。超過があれば exit 1。
"""
import re
import sys


def main() -> int:
    ok = True
    for path in sys.argv[1:]:
        lines = open(path, encoding="utf-8").read().splitlines()
        label = None
        i = 0
        while i < len(lines):
            ln = lines[i]
            if ln.startswith("```text"):
                j = i + 1
                body = []
                while not lines[j].startswith("```"):
                    body.append(lines[j])
                    j += 1
                n = len("".join(body))
                m = re.search(r"(\d+)字", label or "")
                lim = int(m.group(1)) if m else None
                if lim is None:
                    st = "上限不明"
                elif n <= lim:
                    st = f"OK（余り{lim - n}）"
                else:
                    st, ok = f"超過 +{n - lim}", False
                print(f"{path.split('/')[-1]}\t{label}\t{n}/{lim}\t{st}")
                i = j
            elif ln.strip():
                label = ln.strip()
            i += 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
