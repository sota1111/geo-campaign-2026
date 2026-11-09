# クラウド実行（Claude Code on the web / Routines）

このリポジトリは単一リポジトリなので、クラウドのセッションでも CLAUDE.md・.claude/agents/・.claude/settings.json の hook がそのまま読み込まれる。**複数リポジトリを1つの Routine に紐づけると settings.json の hook が読み込まれなくなる**ため、必ず contest-command 単体で設定すること。

Routines はリサーチプレビューのため、画面や仕様が変わる可能性がある。

## 成果の返し方（クラウド共通）
1. 各部隊は reports/ や contests/ にファイルを書く（従来どおり）
2. 参謀長（メインセッション）が `claude/<部隊>-<contest-id>-<YYYYMMDD>` ブランチにコミットして push
3. `gh pr create` で PR を作成し、本文は `.github/pull_request_template.md` の書式で報告する
4. **マージは総司令官だけ**（hook と CI で強制）

`block_dangerous.py` は `claude/` で始まるブランチへの通常 push のみ許可する。クラウド環境の作業ブランチ名が別の接頭辞になる場合は、環境変数 `CONTEST_PUSH_PREFIX` で合わせる。

## 環境設定
- **ネットワーク**: 情報部・整備隊が公式サイトを取得する。環境のネットワーク許可に以下を追加する（WebFetch で取得できる場合は不要）
  - urbandata-challenge.jp / g-idea.go.jp / canaan-geo.jp / challenge2026.odpt.org
- **セットアップ**: Python 3.10+ の標準ライブラリのみで動くため追加インストール不要
- **秘密情報**: 環境変数に API キー等を入れる場合も、.env をリポジトリに置かない

## Routine 一覧
| ファイル | 部隊 | トリガー | 目的 |
|---|---|---|---|
| maintainer-daily.md | 整備隊 | スケジュール（毎朝 7:00 JST） | 締切・要項変更の巡回 |
| audit-on-pr.md | 憲兵 | GitHub イベント（PR の作成・更新） | 提出物の要項適合監査 |
| intel-on-demand.md | 情報部 | API（スマホのショートカット等から） | 要項の事実確認 |

各ファイルの「プロンプト」節を Routine のプロンプト欄に貼り付ける。作成は Web の Routines 画面、デスクトップアプリの Code タブ、または CLI の `/schedule` から行う（API トリガーは Web から設定）。

## 動作確認（Routine 作成後に1回）
1. 整備隊の Routine を手動実行し、`claude/maintenance-*` の PR ができること
2. その PR に対して憲兵の Routine が起動し、監査結果がコメントされること
3. Web のセッションで「main に push して」と指示し、**ブロックされること**
