#!/usr/bin/env python3
"""全エージェント共通の PreToolUse ガード（settings.json から登録）。

クラウド実行（Claude Code on the web / Routines）では、成果をブランチの push と PR で返す。
そのため push は「作業ブランチ（既定 claude/）への通常 push」だけを許可し、
main への push・強制 push・ブランチ削除・マージ・公開・デプロイ・外部 POST はブロックする。
作業ブランチの接頭辞は環境変数 CONTEST_PUSH_PREFIX で変更できる。
"""
import json
import os
import re
import shlex
import subprocess
import sys

PREFIX = os.environ.get("CONTEST_PUSH_PREFIX", "claude/")
PROTECTED = {"main", "master"}

ALWAYS_BLOCK = [
    (r"\bgh\s+pr\s+merge\b", "PRのマージは総司令官のみ"),
    (r"\bgh\s+(repo|release|secret|variable|workflow\s+run)\b", "リポジトリ設定・公開操作は総司令官のみ"),
    (r"\bgh\s+api\b.*(-X|--method)\s*(POST|PUT|PATCH|DELETE)", "GitHub APIへの書き込みは禁止"),
    (r"\bgit\s+merge\b.*\b(main|master)\b|\bgit\s+checkout\s+(main|master)\b.*&&.*\bmerge\b", "mainへのマージは総司令官のみ"),
    (r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r", "再帰削除は禁止"),
    (r"\bcurl\b.*\s-(X\s*POST|d|F)\b|--data|\bwget\b.*--post", "外部への送信（応募フォーム送信など）は禁止"),
    (r"\b(gcloud|firebase|vercel|netlify|wrangler)\b.*\bdeploy\b", "デプロイは総司令官のみ"),
]


def block(msg: str) -> int:
    print(f"交戦規定違反: {msg}", file=sys.stderr)
    return 2


def current_branch(cwd: str) -> str | None:
    try:
        out = subprocess.run(["git", "symbolic-ref", "--short", "HEAD"], cwd=cwd,
                             capture_output=True, text=True, timeout=10)
        name = out.stdout.strip()
        return name if out.returncode == 0 and name else None
    except Exception:
        return None


def check_push(segment: str, cwd: str) -> str | None:
    """git push の1コマンド分を検査し、違反なら理由を返す。"""
    try:
        toks = shlex.split(segment)
    except ValueError:
        return "git push を解釈できません"
    i = toks.index("push")
    args = toks[i + 1:]
    for a in args:
        if a in ("-f", "--force", "--force-with-lease", "--mirror", "--all", "--tags", "-d", "--delete", "--prune") \
                or a.startswith("--force") or (a.startswith("-") and not a.startswith("--") and "f" in a[1:] and a != "-u"):
            return f"git push の {a} は禁止"
    positional = [a for a in args if not a.startswith("-")]
    refspecs = positional[1:]  # 先頭はリモート名
    if not refspecs:
        refspecs = ["HEAD"]
    for rs in refspecs:
        if rs.startswith(":"):
            return "リモートブランチの削除は禁止"
        if rs.startswith("+"):
            return "強制 push（+refspec）は禁止"
        dst = rs.split(":", 1)[1] if ":" in rs else rs
        dst = dst.removeprefix("refs/heads/")
        if dst == "HEAD":
            dst = current_branch(cwd) or ""
        if dst in PROTECTED:
            return f"{dst} への push は総司令官のみ"
        if not dst.startswith(PREFIX):
            return f"push 先は {PREFIX} で始まる作業ブランチに限ります（指定: {dst or '不明'}）"
    return None


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command", "")
    cwd = data.get("cwd") or os.getcwd()
    for pat, why in ALWAYS_BLOCK:
        if re.search(pat, cmd):
            return block(f"{why}。コマンド: {cmd}")
    for seg in re.split(r"&&|\|\||;|\n|\|", cmd):
        if re.search(r"\bgit\b.*\bpush\b", seg):
            why = check_push(seg.strip(), cwd)
            if why:
                return block(f"{why}。コマンド: {cmd}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
