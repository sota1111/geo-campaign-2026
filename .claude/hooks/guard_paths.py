#!/usr/bin/env python3
"""PreToolUse ガード: Write/Edit の書き込み先を許可プレフィックス配下に限定する。

使い方（サブエージェントの frontmatter hooks から）:
  python3 guard_paths.py reports/intel/ contests/
許可外なら exit 2 でブロックし、理由を stderr で Claude に返す。
"""
import json
import os
import sys


def rel_candidates(path: str, bases: list[str]) -> list[str]:
    out = []
    ap = os.path.realpath(path)
    for b in bases:
        if not b:
            continue
        rb = os.path.realpath(b)
        if ap == rb or ap.startswith(rb + os.sep):
            out.append(os.path.relpath(ap, rb).replace(os.sep, "/"))
    return out


def main() -> int:
    allowed = [a.rstrip("/") + "/" for a in sys.argv[1:]]
    try:
        data = json.load(sys.stdin)
    except Exception:
        print("guard_paths: 入力JSONを解釈できないため安全側でブロックします", file=sys.stderr)
        return 2
    ti = data.get("tool_input", {}) or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ti.get("path")
    if not path:
        return 0
    cwd = data.get("cwd") or os.getcwd()
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    bases = [cwd, os.environ.get("CLAUDE_PROJECT_DIR", "")]
    rels = rel_candidates(path, bases)
    if not rels:
        print(f"交戦規定違反: リポジトリ外への書き込み {path} は禁止です。", file=sys.stderr)
        return 2
    for rel in rels:
        if any(rel.startswith(a) for a in allowed):
            return 0
    print(
        f"交戦規定違反: {rels[0]} への書き込みは許可されていません。"
        f" 許可範囲: {', '.join(allowed)}。必要なら停止して reports/escalations/ に記録してください。",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
