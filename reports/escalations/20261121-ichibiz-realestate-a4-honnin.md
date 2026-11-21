# エスカレーション: イチBiz 不動産部門 新案 A4 の本人欄未記入（憲兵監査 D1 の転記）2026-11-21

出典: reports/audit/ichibiz-2026-realestate-a4-20261121.md D1

## 事実
- contests/ichibiz-2026/submission/realestate-a4/ に【本人加筆】の未記入が3か所: problem.md 1行目末尾（150字以内）、service.md 2行目（150字以内）、background.md 全文（必須項目の背景300字が指示文のみ）。
- check_limits_a4.py は指示文も字数に数えるため検出しない。
- 未記入のまま提出すると、必須欄の欠落と生成AI条項（20261109-ichibiz-genai-clause.md）で失格級。

## 経緯
- PR #42 は総司令官の明示の指示（2026-11-21「Bで進めて。全て確認しました。マージしてください。」）により、失格級を含むまま既定ブランチへマージ（提出可能ではない）。

## 総司令官の作業（12/10 20:00 締切まで）
1. 3か所を本人が記入 → `python3 contests/ichibiz-2026/check_limits_a4.py` → `grep -r "【" contests/ichibiz-2026/submission/realestate-a4/` が0件。
2. 憲兵の再監査（G2・G3 の言い切りの修正も併せて工兵が対応）。
3. 同梱データ（web/data/fukuoka.json）の二次配布の確認が取れるまで公開しない（G1）。
