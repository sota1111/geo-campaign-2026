# geo-campaign-2026

4つのコンペ・ハッカソン（UDC2026／イチBizアワード2026／衛星データ活用アワード2026–2027／公共交通オープンデータチャレンジ2026）への応募を、Claude Code の8つのサブエージェントで遂行するための司令部リポジトリ。

設計思想は**任務指揮**：各エージェントに「手順」ではなく**意図・交戦規定・SOP・PACE・終了条件**を渡し、物理的に越えてはいけない線は hook と permissions で強制する。

## 構成
```
CLAUDE.md                 総司令官の意図・部隊編制・引き渡し・PACE（参謀長＝メインセッション用）
.claude/
  agents/                 8部隊の定義（frontmatter＝交戦規定、本文＝意図/SOP/PACE/終了条件）
  hooks/                  guard_paths.py / guard_bash.py / block_dangerous.py（push は claude/ のみ）
  settings.json           全体の deny ルールと共通 hook
contests/
  registry.json           締切・審査基準・字数上限（唯一の正）
  <id>/brief.md           戦域ごとの要項要約
  <id>/submission/        提出物
  <id>/app/               実装（ODPTは必須）
  <id>/scorecards/        作戦研究班の採点記録
doctrine/                 交戦規定の強制手段・報告書式・AAR
reports/<部隊>/            各部隊の報告（escalations/ は総司令官への上申）
tools/                    deadlines.py（締切一覧）, check_limits.py（字数検査）
routines/                 クラウド定期実行（Routines）の設定とプロンプト
.github/                  PR テンプレート（報告書式）、CI（テスト・registry 承認・字数検査）
tests/                    ガード・ツール・エージェント定義のテスト
```

## セットアップ
```bash
gh repo create sota1111/geo-campaign-2026 --private --source=. --push
gh label create registry-approved --description "registry.json の変更を総司令官が承認"
python3 -m unittest discover tests   # すべてOKであること
```
GitHub の Settings → Branches で main にブランチ保護（PR 必須・`guard` の tests と registry-approval を必須チェック）を設定する。

## クラウド実行
Claude Code on the web でリポジトリを開けば、8部隊と hook がそのまま使える。定期・イベント実行は Routines で設定する（手順とプロンプトは `routines/README.md`）。

| Routine | トリガー | 内容 |
|---|---|---|
| 整備隊 毎朝巡回 | 毎朝 7:00 JST | 🔴締切・要項差分があれば PR |
| 憲兵 PR監査 | PR の作成・更新 | 監査結果を PR にコメント（失格級は ⛔） |
| 情報部 オンデマンド | API | 依頼内容を調査して PR |

成果はすべて `claude/` ブランチの PR で返り、マージは総司令官だけが行う。
依存は Python 3.10+ の標準ライブラリのみ。

## 動作確認（導入時とClaude Codeアップデート後に必ず）
frontmatter hook の発火はバージョンにより不具合報告があるため、実地で確認する。
1. `claude` を起動し、`/agents` に10部隊（総司令官補佐を含む）が表示されることを確認
2. 「intelligence エージェントに CLAUDE.md へ1行追記させて」と依頼 → **交戦規定違反でブロックされれば正常**
3. 「military-police エージェントに `ls` を実行させて」と依頼 → ブロックされれば正常
4. メインセッションで `git push origin main` を試させる → ブロックされれば正常（`claude/` ブランチへの push は通る）
5. 「commander-aide に `gh pr merge --help` を実行させて」と依頼 → **通れば正常**（同じコマンドをメインセッションや他の部隊が実行するとブロックされる）
6. `claude --debug` で起動し、debug ログに未認識フィールドの警告がないことを確認

いずれかが素通りしたら、その部隊は使わず `reports/escalations/` に記録すること。

## 使い方の例
```
今日の巡回を maintainer に。
udc-2026 について intelligence に概要登録の入力項目と字数を調べさせて。
udc-2026 で recon に3案出させて。転用候補（odpt-2026）も意識して。
案Bで engineer に概要登録の文面を作らせて、military-police で監査。
```

## 初動（2026-11-09時点）
- 🔴 **UDC 概要登録 11/15 23:59**：情報部→偵察隊→工兵→憲兵 を今週中に一周
- 衛星アワードは **11/30 正午** 締切（夜ではない）
- 題材の重なり：UDC↔ODPT（オープンデータ・交通）、イチBiz↔衛星（地理空間）は陣地転換隊の候補。ただしUDCの類似作品重複ルールに注意

## 注意
registry.json と brief.md は 2026-11-07 時点の提供情報に基づき、公式要項との再照合は未実施。整備隊・情報部が照合し、差分は総司令官の承認後に反映する。
