# 交戦規定（ROE）と強制手段

規定は「書いて守らせる」ものと「物理的に越えられない」ものに分ける。後者は hook と permissions で強制する。

| 規定 | 強制手段 |
|---|---|
| main への push・強制 push・ブランチ削除・マージ・公開・デプロイ・外部POSTの禁止（`claude/` ブランチへの通常 push のみ許可） | `.claude/settings.json` の permissions.deny ＋ `.claude/hooks/block_dangerous.py`（全エージェント共通） |
| main へのマージは総司令官のみ | GitHub のブランチ保護（main に PR レビュー必須を設定）＋ hook で `gh pr merge` を禁止 |
| registry.json の変更は承認制 | CI `guard.yml` の registry-approval ジョブ（ラベル `registry-approved` が必要） |
| 役割ごとの書き込み範囲 | 各エージェント frontmatter の PreToolUse hook → `guard_paths.py` |
| 読み取り専用役割のBash制限（整備隊・憲兵） | frontmatter の PreToolUse hook → `guard_bash.py`（連結・リダイレクトも禁止） |
| 秘密情報を読まない | permissions.deny の Read ルール |
| 並列作業の衝突防止 | `isolation: worktree`（工兵・偵察隊・陣地転換隊・作戦研究班） |
| 暴走・予算超過の防止 | `maxTurns` |
| 根拠のない数値を書かない、registry を勝手に変えない | 本文の規定（強制なし）→ 憲兵が監査 |

## 注意
- `tools` を省略すると親の全ツールを継承する。全エージェントで明示している。
- frontmatter の未知フィールドはエラーなく無視される。設定変更後は `claude --debug` で警告を確認する。
- `disallowedTools` に `Bash(git push *)` のような指定子を書くとBash全体が外れるため使っていない。コマンド単位の禁止は permissions と hook で行う。
- plugin 経由で配布すると hooks・permissionMode が無視されるため、`.claude/agents/` に直接置く。
- frontmatter hook が発火しないバージョンがあった報告がある。導入時・アップデート後に README の「動作確認」を必ず行う。
