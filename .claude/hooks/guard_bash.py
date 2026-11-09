#!/usr/bin/env python3
"""PreToolUse ガード: Bash コマンドを許可リストの接頭辞に限定する。

使い方: python3 guard_bash.py "python3 tools/" "git status" "git diff"
"""
import json
import shlex
import sys

FORBIDDEN_TOKENS = ["&&", "||", ";", "|", "`", "$(", ">", "<"]


def main() -> int:
    allowed = sys.argv[1:]
    try:
        data = json.load(sys.stdin)
    except Exception:
        print("guard_bash: 入力JSONを解釈できないため安全側でブロックします", file=sys.stderr)
        return 2
    cmd = ((data.get("tool_input") or {}).get("command") or "").strip()
    if any(t in cmd for t in FORBIDDEN_TOKENS):
        print(f"交戦規定違反: 連結・リダイレクトを含むコマンドは禁止です: {cmd}", file=sys.stderr)
        return 2
    norm = " ".join(shlex.split(cmd)) if cmd else ""
    if any(norm.startswith(a) for a in allowed):
        return 0
    print(f"交戦規定違反: 許可外のコマンドです: {cmd}。許可: {allowed}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
