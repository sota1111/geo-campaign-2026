# イチBiz 新案NB: 本人欄の未記入（憲兵監査 F1 の転記）2026-11-13

出典: reports/audit/ichibiz-2026-business-nb-20261113.md

- submission/business-nb/ に【本人加筆】【提出時に記入】が8箇所、background.md は全文が指示文のみ。字数検査は指示文も数えるため検知しない。
- 未記入のまま提出すると生成AI条項（20261109-ichibiz-genai-clause.md）と必須欄の欠落で失格級。現行案（submission/business/）も本人欄は同じ扱い。
- 総司令官の作業: 8箇所の記入 → `python3 contests/ichibiz-2026/check_limits_nb.py` → `grep -r "【" contests/ichibiz-2026/submission/business-nb/` が0件であることを確認。AI文をどこまで許容するか（監査 M1）も判断。
