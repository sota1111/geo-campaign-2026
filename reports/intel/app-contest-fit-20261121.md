# 全18アプリ × 4コンペ（イチBizは3部門）の応募適合 事実整理（2026-11-21）

- 対象: 既定ブランチ claude/ops-campaign-20261109（HEAD 49eafed）のアプリ18件 × コンペ6列（UDC／衛星／イチBiz ビジネス・アイデア・不動産情報活用／ODPT）= 108セル
- 機械可読版（同内容。セルごとの根拠・出典の全文）: reports/intel/app-contest-fit-20261121.json
- 方法: 既存の情報部報告（取得日 2026-11-09〜11-15）、contests/*/brief.md、各アプリの README・提出文、reports/escalations・ops・command を読んで整理した。**今回、公式ページの再取得はしていない**。取得日以後の変更は反映していない。修正・提案はしていない。
- この表が示すのは「要項に照らして出せるか」。提出文・本人欄・憲兵監査の準備状況は対象外（注意 C12 を参照）。

## 判定の規則（セルの意味）

| 記号 | 点 | 意味 |
|---|---|---|
| ◎ | 3 | 今の応募先（このコンペ向けに作った。README・registry・status に記録がある） |
| ○ | 2 | 出せる（要項の条件に反する点がなく、満たす根拠を示せる） |
| △ | 1 | 条件付き（必須データ・事業モデル・データ利用条件・決定事項などの未充足がある） |
| × | 0 | 出せない（要項の必須条件を満たさない） |
| ？ | 0 | 要項からは判断できない |

規則（情報部の読み。各セルの根拠欄に当てはめた規則を明記した）:
- UDC: 要領「本応募には作品概要エントリーに応募された作品のみ応募可能」。登録記録は作品①②のみ → それ以外は×。
- 衛星: 提出物は所定様式の提案書。アプリは最終選考の加点で必須ではない。「衛星データ活用の妥当性」は審査項目（要項p8）で資格条件ではない → 衛星データを使わないアプリは△（題材の書き換えと提案書の新規作成が要る）。
- イチBiz ビジネス: 独自項目「市場・顧客ニーズ」「事業化の課題」。受け手に事業者・自治体など顧客がいれば○、個人向けで事業モデル未整備なら△（registry の audience による情報部の読み）。
- イチBiz アイデア: 独自項目なし・実装不要・資格制限なし。地理空間情報で社会課題を扱うアプリは○。
- イチBiz 不動産情報活用: 独自項目「活用する不動産情報ライブラリの情報」。活用必須の明記は無い（「実質必須」は情報部の推測）→ ライブラリ未使用のアプリは？。
- ODPT: 応募資格（必須）が公共交通オープンデータセンター／GTFSデータリポジトリのデータ活用 → 使っていなければ×。

## 一覧（記号と点）

| アプリ | UDC | 衛星 | イチBiz ビジネス | イチBiz アイデア | イチBiz 不動産 | ODPT |
|---|---|---|---|---|---|---|
| odpt 生活アクセス診断マップ | ◎3 | △1 | △1 | ○2 | ？0 | ◎3 |
| odpt-teiji バス定時性カルテ | ×0 | △1 | ○2 | ○2 | ？0 | ◎3 |
| odpt-kankou 観光バスを避ける生活ルート | ×0 | △1 | △1 | △1 | ？0 | ◎3 |
| odpt-kansui 大雨の駅出入口と迂回 | ×0 | △1 | ○2 | ○2 | ？0 | ◎3 |
| odpt-kodure 子連れお出かけ診断 | ×0 | △1 | △1 | △1 | ？0 | ◎3 |
| udc-moritsuchi みんなの盛土ウォッチ | ◎3 | △1 | △1 | ○2 | ？0 | ×0 |
| udc-aed 夜も使えるAED診断マップ | ×0 | △1 | ○2 | ◎3 | ？0 | ×0 |
| sat-a 路面下リスクの二段階調査 | ×0 | ◎3 | ○2 | ○2 | ？0 | ×0 |
| sat-b 盛土巡視台帳 | ×0 | ◎3 | ○2 | ○2 | ？0 | ×0 |
| sat-alpha 配電線沿いの優先伐採地図 | ×0 | ◎3 | ○2 | ○2 | ？0 | ×0 |
| sat-yabu 藪払いの優先地図 | ×0 | ◎3 | ○2 | ○2 | ？0 | ×0 |
| sat-sugi スギ植え替えの優先地 | ×0 | ◎3 | ○2 | ○2 | ？0 | ×0 |
| biz-business バス路線見直し案の比較 | ×0 | △1 | ◎3 | ○2 | ？0 | ○2 |
| biz-business-nb 使用済み太陽光パネルの回収圏計画 | ×0 | △1 | ◎3 | ○2 | ？0 | ×0 |
| biz-idea 地名の記憶マップ | ×0 | △1 | △1 | ◎3 | ？0 | ×0 |
| biz-realestate 相談前の1枚シート | ×0 | △1 | △1 | ○2 | ◎3 | ×0 |
| biz-realestate-rn1 住む場所の先行き | ×0 | △1 | △1 | ○2 | ◎3 | ×0 |
| biz-solar-guard 太陽光 盗難対策マップ | ×0 | △1 | △1 | ◎3 | ？0 | ×0 |

集計: ◎19・○22・△23・×28・？16（計108）。○以上は41組。

## 確定事項

### 1. コンペ側の条件（セルの根拠になった事実）

| コンペ | 条件 | 出典（取得日） |
|---|---|---|
| UDC | 同一主体の応募数に上限なし。1作品が応募できるタイプ・テーマは1つ。同一／類似作品の複数応募、同一作品の別タイプ・テーマ応募は審査対象外（無効）になることがある。「類似」の基準は非公開。他コンテスト発表済み・公開済みも可。本応募は概要エントリー済みの作品のみ。概要登録 11/15 23:59（締切済み）、本応募 12/27 23:59。必須データなし | reports/intel/udc-2026-aed-facts-20261113.md §確定事項1・2（https://urbandata-challenge.jp/udc2026_entry 、2026-11-13）、contests/udc-2026/brief.md |
| 衛星 | 提出は所定様式の提案書（様式1 docx）＋フォーム。テーマは協賛／共通1／共通2。各テーマへの応募は1提案まで（p6）。審査項目に「衛星データ活用の妥当性」（一次・最終）、アプリ開発は最終のみ加点で必須でない（p8）。事業化意思のない案は選考対象外（p4）。締切 11/30 12:00。他コンペとの併願制限の記載なし | reports/intel/satellite-2026-20261109.md §1-1〜1-4（要項PDF、2026-11-09）、reports/intel/satellite-2026-evidence-20261109.md §1 |
| イチBiz | 全部門共通: タイトル50・課題400・サービス700・背景300字、補足資料任意。ビジネス部門のみ市場・顧客ニーズ400字と事業化課題400字。不動産部門のみ「活用する不動産情報ライブラリの情報」。アイデア部門は実装不要。個人・グループ・法人可。同一人物の複数アイデア可。他コンテスト提案済みも「本コンテストとしては可」。締切 ビジネス 11/30 20:00、アイデア・不動産 12/10 20:00 | reports/intel/ichibiz-2026-20261109.md §確定事項1・3・4・5、reports/intel/ichibiz-2026-multi-entry-20261113.md（https://g-idea.go.jp/2026/application/ 、FAQ、2026-11-09/13） |
| ODPT | 応募資格（必須）は公共交通オープンデータセンターおよびGTFSデータリポジトリの公共交通オープンデータの活用。実際に動作するアプリ・サービス。1応募者が複数作品可。他コンペの作品の応募は歓迎。成果物は開催期間（〜2027/3/12）中、誰でも無償で利用できる状態で公開。締切 2027/1/11 23:59 | reports/intel/odpt-2026-20261109.md §確定事項3〜5（https://challenge2026.odpt.org/ja/outline.html ほか、2026-11-09）、reports/intel/odpt-2026-challengeinfo-20261112.md |

### 2. セルの根拠（グループ別。セルごとの全文は JSON）

#### UDC（出典: udc-2026-aed-facts-20261113 §確定事項1・2、udc-2026-registration-20261109、status-20261113）
- ◎ odpt: 作品①（アプリケーション／道路・交通）として概要登録済み。README が「同一アプリを ODPT と UDC の両方に出す」。
- ◎ udc-moritsuchi: 作品②（登録時はアイデア／防犯・防災）として概要登録済み。本応募でアプリ化するかは判断待ち。
- × udc-aed: 「UDC には登録しない」（11/13 総司令官決定）。id が udc- 始まりでもイチBiz アイデア IN1 のデモ。
- × 他15件: 概要登録の記録なし。締切 11/15 23:59 は過ぎている。sat-a は strategy-20261109 が「公開されるUDCには出さない」方針。

#### 衛星（出典: satellite-2026-20261109 §1-2〜1-3、evidence-20261109、20261113-satellite-alpha-slot）
- ◎ sat-a（協賛＋共通1）、sat-b（共通2）、sat-alpha（共通2）: 提案書 docx あり。B と α の同時提出は失格級（p6・憲兵F-1）。
- ◎ sat-yabu・sat-sugi: 衛星アワード向けの比較用新案（各 README）。ただし提案書が無く、テーマ未決。要項のテーマ文（インフラ起点）に獣害・花粉症対策が合致するかは要確認。◎は「このコンペ向けに作った」の意味で、テーマ適合の確認ではない。
- △ 他13件: 衛星データ未使用。udc-moritsuchi は提案B の転用先で同系統（共通2の枠を取り合う）。

#### イチBiz ビジネス（出典: ichibiz-2026-20261109 §確定事項1・3、registry.ts の audience）
- ◎ biz-business、biz-business-nb。
- ○ odpt-teiji（事業者・自治体）、odpt-kansui（施設管理者・自治体）、udc-aed（自治体の担当者）、sat-a・sat-b・sat-alpha・sat-yabu・sat-sugi（自治体・事業者向けの事業提案）。
- △ 個人向けで事業モデル未整備: odpt、udc-moritsuchi、biz-idea、biz-realestate、biz-realestate-rn1。△ データの非商用条件: odpt-kankou（P12）、odpt-kodure（P13・P27）。△ 決定事項: biz-solar-guard（補佐決定 2026-11-14「ビジネス部門には出さない」）。

#### イチBiz アイデア（出典: ichibiz-2026-20261109 §確定事項1・3、multi-entry-20261113 確定事項4）
- ◎ udc-aed（IN1 のデモ）、biz-idea、biz-solar-guard（アイデア部門のみ。認定情報の利用ルールが電話確認待ち、12/02）。
- ○ 13件: 独自項目なし・実装不要・資格制限なし。
- △ odpt-kankou（P12 非商用が未確認）、odpt-kodure（P13・P27 非商用が未解決、行き先データ未同梱）。

#### イチBiz 不動産情報活用（出典: ichibiz-2026-20261109 §確定事項1・5、rn1-facts-20261113）
- ◎ biz-realestate（不動産情報ライブラリの実データ）、biz-realestate-rn1（同API由来。本人欄未記入、XKT003・XKT025 の条件は判断待ち）。
- ？ 他16件。

#### ODPT（出典: odpt-2026-20261109 §確定事項3〜5、challengeinfo-20261112）
- ◎ odpt、odpt-teiji、odpt-kankou、odpt-kansui、odpt-kodure。kodure は行き先データ未同梱で現状動作しない（P13・P27 回答待ち）。kankou は P12 の懸念が未監査。
- ○ biz-business: GTFSデータリポジトリとODPTセンター（都営）の両方を使う動作する静的Webアプリ。odpt と同データ・機能が重なる。
- × 他12件: 必須データ未使用。

### 3. 同時に出すときの注意（セルとは別の数の制約・重複）
JSON の cautions（C1〜C13）と同じ。

- C1 UDC: 同一主体の同一・類似作品は無効の恐れ（基準非公開）。1作品1タイプ1テーマ。①と②は別と整理済み。
- C2 UDC: 本応募は概要エントリー済みのみ。登録は①②だけで締切済み。登録済み作品を別アプリに差し替えられるかは記載なし。ODPT 系や biz-business を足すと①と類似扱いの恐れ。
- C3 衛星: 各テーマ1提案まで。A＝協賛＋共通1、B・α＝共通2。B と α の同時提出は失格級。yabu・sugi のテーマ未決（共通2に当てると同じ枠）。
- C4 衛星: FAQ7（代表者重複なら提案を1つにまとめる等）が本アワードに適用されるか未確定。要項p6と併記し、どちらも採用していない。
- C5 衛星: yabu・sugi は提案書なし、α は未記入欄 F-3。事業化意思のない案は対象外。代表者は日本国籍が必要（NEDO FAQ、適用範囲は要確認）。
- C6 イチBiz: 同一人物の複数アイデアは可。同一部門の複数件・件数上限・同一アイデアの複数部門同時応募は明記なし。現行案と新案を同じ部門に出す場合（biz-business と NB、biz-realestate と RN1）が該当。
- C7 イチBiz: solar-guard はアイデア部門のみ・2部門同時応募もしない（補佐決定 2026-11-14）。
- C8 イチBiz: 生成AI条項（本人の書き換えが必須）、内容は協賛企業・外部審査員に提供、協賛企業との交渉禁止。ビジネス部門 11/30 20:00 は衛星アワード 11/30 12:00 と同日。
- C9 ODPT: 複数作品可だが類似の扱いは記載なし。他コンペとの併願は可（相手規約の確認が前提）。応募規約全文は未取得。提出後は説明文を編集不可。
- C10 ODPT: 公開義務（〜2027/3/12 無償）。チャレンジ限定ライセンスのデータは再配布禁止・他コンペに出すアプリには使わない方針。必須データが「両方必須か一方でよいか」未確定。teiji・kankou・kansui・kodure はODPTセンターのみ、odpt・biz-business は両方。
- C11 データ利用条件の未解決: kodure（P13・P27、12/11）、kankou（P12）、solar-guard（認定情報、12/02）、RN1（XKT003・XKT025）、udc-aed（Geoshape のライセンス表記の食い違い）。
- C12 どの応募も本人欄が未記入。憲兵の再監査で失格級0になるまで提出可能ではない。この表は要項適合で、提出可否ではない。
- C13 同題材を複数コンペに出す場合は各コンペの規定を個別に確認（UDC②は提案B の転用、biz-business は odpt の生成データを再利用）。

## 要確認事項
1. UDC: 11/15 までの追加登録の有無（記録は①②のみ。正本は Google の自動返信メール）。登録済み作品を別アプリに差し替えられるか。reports/ops/business-alt-summary-20261112.md は11/12時点で「登録した記録がない」と書き、udc-2026-registration-20261109.md は「登録完了」と書いている（併記。どちらも採用しない）。
2. 衛星: sat-yabu・sat-sugi のテーマ当てはめ、FAQ7 の適用範囲、様式1の項目・字数（intel 要確認#1）。
3. イチBiz: 不動産部門の「ライブラリ情報」欄が必須か・字数（応募フォーム未取得）。同一部門の複数件、同一アイデアの複数部門同時応募。
4. ODPT: 必須データの「両方／一方」、応募規約全文（既存作品の可否）。
5. データ利用条件: C11 の5件。
6. 情報部の読みを含む判定: ビジネス部門の○/△（registry の audience による）、衛星の△（p8 の読み）。要項が明示した条件ではない。
7. 公式ページは今回再取得していない。取得日以後の変更は未反映。

## registry更新提案（差分。brief.md・registry.json・registry.ts は変更していない）
- contests/dashboard/src/apps/registry.ts の APPS は12件。odpt-kankou、odpt-kansui、odpt-kodure、sat-yabu、sat-sugi、biz-solar-guard の6件が未登録（progress.ts には solar-guard・kodure の記載あり。copy-data.mjs にも無い）。
- contests/udc-2026/brief.md: 「本応募は概要エントリー済みの作品のみ」「1作品1タイプ・1テーマ」が無い。
- contests/satellite-2026/brief.md: 「各テーマへの応募は1提案まで」「事業化意思のない案は選考対象外」「審査基準（p8）」が無い（intel 2026-11-09 の提案と同じ）。
- contests/ichibiz-2026/brief.md: 不動産部門の独自項目、複数応募（同一人物可・同一部門／部門間は明記なし）が無い。
- contests/odpt-2026/brief.md: 公開義務（〜2027/3/12）、限定ライセンスの再配布禁止、提出物（動画・PDF等）が無い（challengeinfo-20261112 の提案と同じ）。
- registry.ts の udc-aed は contest が ichibiz-2026、originalPath が udc-2026/app/aed-night。id と置き場の接頭辞が UDC のまま（事実の指摘）。

## 出典一覧
- contests/udc-2026/brief.md、contests/satellite-2026/brief.md、contests/ichibiz-2026/brief.md、contests/odpt-2026/brief.md、contests/registry.json
- reports/intel/: udc-2026-20261109、udc-2026-aed-facts-20261113、satellite-2026-20261109、satellite-2026-evidence-20261109、ichibiz-2026-20261109、ichibiz-2026-multi-entry-20261113、ichibiz-2026-rn1-facts-20261113、ichibiz-2026-solar-guard-terms-20261114、odpt-2026-20261109、odpt-2026-challengeinfo-20261112
- reports/escalations/: 20261109-satellite-duplicate、20261109-odpt-center-data、20261109-ichibiz-genai-clause、20261113-satellite-alpha-slot、20261114-ichibiz-rn1-honnin-kahitsu
- reports/ops/: udc-2026-registration-20261109、status-20261113、strategy-20261109、relocation-odpt-2026-to-udc-2026、relocation-satellite-2026-to-udc-2026、business-alt-summary-20261112
- reports/command/: merge-20261121、decision-20261114-odpt-kodure、decision-20261114-solar-guard
- 各アプリの README: contests/odpt-2026/app・app-teiji・app-kankou・app-kansui・app-kodure、contests/satellite-2026/app/proposal-alpha・proposal-yabu・proposal-sugi、contests/ichibiz-2026/app/business・solar-guard
- contests/dashboard/src/apps/registry.ts、scripts/copy-data.mjs
- 公式（各 intel 経由。取得日は各報告に記載）: https://urbandata-challenge.jp/udc2026_entry ／ https://space-data-challenge.nedo.go.jp/infrastructure/ ／ https://g-idea.go.jp/2026/application/ ／ https://challenge2026.odpt.org/ja/outline.html
