#!/usr/bin/env python3
"""イチBiz 不動産部門の新案（時間地図）（submission/realestate-timeline/）の文字数検査。

python3 contests/ichibiz-2026/check_limits_timeline.py
数え方・上限は check_limits_divisions.py の realestate と同じ（改行を除く全文字。空白・句読点を含む）。
reinfolib.md は字数未確認のため400字以内を目安にしている。
次のどれかがあれば exit 1:
  - 超過・空欄
  - 【…】が残っている（本人が書く欄の指示文が未記入のまま。「未記入あり」）。指示文は字数に数えず、
    「本人が上限いっぱい（【本人加筆（150字以内）…】なら150字）書いた場合」の見込み字数で上限を判定する
    （本人加筆後に超過しないかを、書く前に見る）。background.md のように全文が指示文のファイルは、上限いっぱいを見込む。
現行案（submission/realestate/）の検査は check_limits_divisions.py。こちらはそれを変更せずに追加した検査。
"""
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent / "submission" / "realestate-timeline"
LIMITS = {"title.md": 50, "problem.md": 400, "service.md": 700, "background.md": 300, "reinfolib.md": 400}
# 本人欄の指示文。上限字数は「（N字以内」から読む。background の「（本人が書く。300字以内）」にも対応
HOLE = re.compile(r"【[^】]*?(\d+)字以内[^】]*】")
ANY_HOLE = re.compile(r"【[^】]*】")


def count(text: str) -> int:
    return len(text.replace("\r", "").replace("\n", ""))


def analyze(text: str, limit: int):
    """(本文のみの字数, 未記入の欄の数, 本人が上限いっぱい書いた場合の見込み字数)"""
    text = text.strip()
    holes = ANY_HOLE.findall(text)
    budget = 0
    for m in ANY_HOLE.finditer(text):
        n = HOLE.match(m.group(0))
        budget += int(n.group(1)) if n else 0
    body = count(ANY_HOLE.sub("", text))
    return body, len(holes), body + budget


def main() -> int:
    ok = True
    print("[realestate-timeline]")
    for fname, limit in LIMITS.items():
        p = BASE / fname
        text = p.read_text(encoding="utf-8") if p.exists() else ""
        body, holes, projected = analyze(text, limit)
        total = body if holes == 0 else projected
        notes = []
        if not text.strip():
            notes.append("空欄")
            ok = False
        if holes:
            notes.append(f"未記入あり（本人加筆の指示文 {holes} か所。本文 {body}字 + 本人が上限まで書いた見込みで {projected}字）")
            ok = False
        if total > limit:
            notes.append(f"超過 +{total - limit}" + ("（本人加筆の見込みを含む）" if holes else ""))
            ok = False
        status = "OK" if not notes else " / ".join(notes)
        print(f"  {fname:14s} {total:4d}/{limit:4d}  {status}")
    if not ok:
        print("→ 失敗: 上のとおり（未記入の【…】は、本人が書いて消すまで残る。AI は本人欄を書かない）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
