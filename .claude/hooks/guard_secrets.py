#!/usr/bin/env python3
"""PreToolUse ガード: 秘密情報（.env 系・secrets/）の読み書きを止める。.env.example だけは許す。

permissions.deny は deny が allow より優先されるため「.env.* を禁止しつつ .env.example だけ許す」を
書けない。そこでこの hook で判定する（2026-11-14 総司令官の決定: .env の読み取り禁止は継続、.env.example は読める）。

- Read / Edit / Write / NotebookEdit / Grep: 対象パスの名前が .env または .env.<何か>（.env.example 以外）、
  またはパスに secrets/ を含む時にブロック。リポジトリ内のどの階層（worktree を含む）でも同じ。
- Bash: コマンド中に .env / .env.<何か> / .env* （.env.example 以外）や secrets/ が現れたらブロック。
ブロック時は exit 2 と理由（stderr）。
"""
import json
import os
import re
import sys

ALLOWED = {".env.example"}
TOKEN = re.compile(r"""(?:^|(?<=[\s'"=/<>(|;&:`]))(\.env(?:\.[A-Za-z0-9_.*-]+|\*)?)(?=$|[\s'"/;|&)<>`])""")
SECRETS_DIR = re.compile(r"""(?:^|(?<=[\s'"=/<>(|;&:`]))secrets/""")


def secret_name(name: str) -> bool:
    return (name == ".env" or name.startswith(".env.") or name == ".env*") and name not in ALLOWED


def blocked_path(path: str) -> bool:
    parts = path.replace("\\", "/").split("/")
    if "secrets" in parts[:-1] or (parts and parts[-1] == "secrets"):
        return True
    return secret_name(parts[-1]) if parts else False


def blocked_command(cmd: str) -> str | None:
    for m in TOKEN.finditer(cmd):
        if secret_name(m.group(1)):
            return m.group(1)
    if SECRETS_DIR.search(cmd):
        return "secrets/"
    return None


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        print("guard_secrets: 入力JSONを解釈できないため安全側でブロックします", file=sys.stderr)
        return 2
    tool = data.get("tool_name", "")
    ti = data.get("tool_input", {}) or {}
    if tool == "Bash":
        hit = blocked_command(ti.get("command", "") or "")
        if hit:
            print(f"交戦規定違反: 秘密情報（{hit}）に触れるコマンドは禁止です。.env.example は読めます。", file=sys.stderr)
            return 2
        return 0
    path = ti.get("file_path") or ti.get("notebook_path") or ti.get("path")
    if path and blocked_path(path):
        print(f"交戦規定違反: 秘密情報 {path} の読み書きは禁止です。.env.example は読めます。", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
