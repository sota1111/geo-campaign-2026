#!/usr/bin/env python3
"""全エージェント共通の PreToolUse ガード（settings.json から登録）。

公開・破壊・外部送信につながる操作を一律でブロックする。
コンペの応募・公開は総司令官（人間）だけが行う。
"""
import json
import re
import sys

PATTERNS = [
    (r"\bgit\s+push\b", "git push は総司令官のみ"),
    (r"\bgh\s+(repo|release|pr\s+merge)\b", "GitHub への公開操作は総司令官のみ"),
    (r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f|\brm\s+-[a-zA-Z]*f[a-zA-Z]*r", "再帰削除は禁止"),
    (r"\bcurl\b.*\s-(X\s*POST|d|F)\b|--data", "外部への送信（応募フォーム送信など）は禁止"),
    (r"\b(gcloud|firebase|vercel|netlify)\b.*\bdeploy\b", "デプロイは総司令官のみ"),
]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("tool_name") != "Bash":
        return 0
    cmd = (data.get("tool_input") or {}).get("command", "")
    for pat, why in PATTERNS:
        if re.search(pat, cmd):
            print(f"交戦規定違反: {why}。コマンド: {cmd}", file=sys.stderr)
            return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
