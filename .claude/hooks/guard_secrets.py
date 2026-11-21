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


# 例外（2026-11-21 総司令官の許可: 「.env は読まないが、名前を使って API を実行するのは許可」）。
# .env の中身を読む・表示するのではなく、node に環境変数として渡してデータ取得スクリプトを動かす形だけを通す。
#   [cd <このリポジトリ> && ] node --env-file=.env <contests/ 配下の tools/fetch*.mjs> [--オプション …]
# パイプ・リダイレクト・コマンド置換・複数コマンドは不可。スクリプトはリポジトリ内（worktree を含む）の
# contests/**/tools/fetch*.mjs に限る（取得スクリプトはキーを出力しないことをレビューしてから使う）。
REPO = os.path.realpath(os.environ.get("CLAUDE_PROJECT_DIR") or os.path.join(os.path.dirname(__file__), "..", ".."))
FETCH_CMD = re.compile(
    r"""^\s*(?:cd\s+(?P<cd>\S+)\s*&&\s*)?node\s+--env-file=\.env\s+(?P<script>[\w./-]+\.mjs)(?P<args>(?:\s+--?[\w-]+(?:=[\w.:/-]+)?|\s+[\w.:/-]+)*)\s*$"""
)
FETCH_SCRIPT = re.compile(r"""(?:^|/)contests/(?:[\w.-]+/)+tools/fetch[\w-]*\.mjs$""")


def allowed_fetch(cmd: str) -> bool:
    m = FETCH_CMD.match(cmd)
    if not m:
        return False
    base = REPO
    if m.group("cd"):
        cd = os.path.realpath(m.group("cd"))
        if cd != REPO:
            return False
        base = cd
    script = os.path.realpath(os.path.join(base, m.group("script")))
    if not (script == REPO or script.startswith(REPO + os.sep)):
        return False
    rel = os.path.relpath(script, REPO).replace(os.sep, "/")
    return bool(FETCH_SCRIPT.search(rel)) and os.path.isfile(script)


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        print("guard_secrets: 入力JSONを解釈できないため安全側でブロックします", file=sys.stderr)
        return 2
    tool = data.get("tool_name", "")
    ti = data.get("tool_input", {}) or {}
    if tool == "Bash":
        cmd = ti.get("command", "") or ""
        hit = blocked_command(cmd)
        if hit and allowed_fetch(cmd):
            return 0
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
