# 相談前の1枚シート（biz-realestate）

イチBizアワード 不動産情報活用部門のデモ。提出文書は `contests/ichibiz-2026/submission/realestate/`。

## 不動産情報ライブラリのデータを取り込む（前処理）

取得結果は `contests/ichibiz-2026/app/realestate/web/data/reinfolib.json` に同梱しています（リポジトリに入る。2026-11-12 取得分）。ビルド時に `scripts/copy-data.mjs` が `public/data/biz-realestate/reinfolib.json` にコピーし、画面の「ライブラリ由来」の行は、このファイルが読めるときだけ出ます。無いときは「ライブラリで確認する項目」の案内だけが出て、ライブラリ由来とは表示しません。

ブラウザから API は呼びません。キーが公開されてしまううえ、公式の API 操作説明も「CORSエラーを防ぐため、ブラウザからリクエストしない」としているためです。ビルドの前に手元で一度だけ取得し、JSON を同梱します。

### 準備

1. 不動産情報ライブラリの API 利用申請（https://www.reinfolib.mlit.go.jp/api/request/）で API キーを発行してもらう（承認まで数営業日）。
2. キーはリポジトリ直下の `.env` に `REINFOLIB_API_KEY=…` として置く（`cp .env.example .env` で雛形を作り、値は `.env` にだけ書く）。`.env` は `.gitignore` 済みでコミットされない。スクリプトへは Node の `--env-file` で環境変数として渡す。コード・README・ログ・出力ファイルにキーを書かない。

### 実行（`contests/dashboard` で）

```bash
# 取得する範囲と本数だけ確認（キー不要・通信しない）
node src/apps/biz-realestate/fetch-reinfolib.ts --check

# 取得して同梱データ ../ichibiz-2026/app/realestate/web/data/reinfolib.json を書き換える（キーは ../../.env から環境変数として読む）
node --env-file=../../.env src/apps/biz-realestate/fetch-reinfolib.ts

npm run build        # copy-data が同梱データを public/data/ にコピー → dist/data/ に入る
# 書き換えた同梱データはコミットする（キーが含まれないことを下の方法で確かめてから）
```

Node 22.18 以上（TypeScript をそのまま実行できる版）が必要です。

| オプション | 既定 | 内容 |
|---|---|---|
| `--trade-years 2024,2025` | 前々年,前年 | 取引価格（XIT001）を集める年 |
| `--land-year 2025` | 前年 | 地価公示・地価調査（XPT002）の年。標準地が0点なら1年前に下げて再試行 |
| `--only trade,landPrice,division` | 3つとも | 取得する項目を絞る |
| `--out パス` | `../ichibiz-2026/app/realestate/web/data/reinfolib.json`（同梱データ） | 出力先。`public/data/` に直接書くと、次のビルドで copy-data が同梱版で上書きするので使わない |

### 取得するもの（対象は徳島市）

| 項目 | API | 取得のしかた | JSON に残すもの |
|---|---|---|---|
| 取引価格の傾向 | XIT001（不動産価格（取引価格）情報取得API） | `year`・`area=36`・`city=36201`・`priceClassification=01`。「宅地(土地)」で㎡単価のある取引だけ | 町名ごとの㎡単価の**中央値と件数**（3件未満の町名は出さない）、市全体の中央値、取引時期の範囲。個別の取引（価格・面積・備考）は残さない |
| 地価公示・地価調査 | XPT002（地価公示・地価調査のポイント(点)API） | `response_format=geojson`・`z=13`・徳島市の範囲のタイルごと・`year` | 標準地の位置・番号・用途・当年価格（円/㎡）・対象年 |
| 区域区分 | XKT001（都市計画区域/区域区分API） | `response_format=geojson`・`z=13`・同じタイル | 区域区分の多角形（座標は小数5桁） |

仕様は公式 API 操作説明（https://www.reinfolib.mlit.go.jp/help/apiManual/ の XIT001・XPT002・XKT001、2026-11-12 に閲覧）に合わせています。リクエストヘッダは `Ocp-Apim-Subscription-Key`。通信は GET のみで、失敗時は最大3回再試行します（401/403 は即停止）。キーはログにも出力ファイルにも出ません。

- 1項目も取れなかったときは、出力ファイルを書き換えません。一部だけ取れたときは取れた項目だけ書き、終了コード1で知らせます。
- 約70回のリクエストを0.3秒間隔で送ります（約1分）。
- **2026-11-12 に実キーで取得を確認済み**（3項目とも成功・終了コード0）。結果: 取引価格 2024年 497件・2025年 491件を受信し、うち「宅地(土地)」で㎡単価のある 440件を集計（取引時期 2024年第1四半期〜2025年第4四半期、町名 43件、市全体の中央値 52,000円/㎡）。地価公示・地価調査 2025年の標準地 150点。区域区分 175件（都市計画区域 71・市街化区域 44・市街化調整区域 60）。出力 約745KB。
- 生成した JSON にキーが含まれないことは、`node --env-file=../../.env -e` で JSON 文字列に `process.env.REINFOLIB_API_KEY` が含まれるかの真偽だけを出して確認した（false）。
- `npm test` には、実データがある時だけ動く検証（形・3項目・個別取引やキーらしき項目を含まない・徳島駅付近の照合）が入っている。

### 画面での使われ方

- 手順3の「この土地の条件」に、区域区分・近くの地価（参考）・取引価格の傾向の行が「ライブラリ由来」の印つきで出る。手順4・5の「売る」の聞くことにも同じ印つきで入る。
- 取引価格は町名単位（住所の町名が集計にある時）か市全体の中央値。個別の物件の価格ではない旨を併記する。地価は標準地の価格で、この土地の価格ではない旨を併記する。
- `reinfolib.json` は、作成者（`generator`）・出典・取得日の形が合うものだけ読み込む（`isReinfolibData`）。形が違うファイルは無いものとして扱う。
- 取得結果（集計値・標準地・区域区分の多角形だけで、個別の取引やキーは含まない）は、総司令官の承認（2026-11-12）を受けて同梱データとしてリポジトリに入れている。根拠は API利用規約 第1条(3)「提供情報については、自由に無償で利用できます」で、下の利用規約の表示（出典・加工の明記・クレジット）を画面に出すことが条件。`public/data/` 自体は `.gitignore` の対象のまま。
- キーが含まれないことの確認（真偽だけを出す）: `node --env-file=../../.env -e 'const k=process.env.REINFOLIB_API_KEY,s=require("fs").readFileSync("../ichibiz-2026/app/realestate/web/data/reinfolib.json","utf8");console.log(!!k&&s.includes(k))'` → `false` であること。

### 利用規約と画面の表示

規約: 不動産情報ライブラリ「利用約款」（不動産情報ライブラリ利用規約 2024-04-01 制定・2025-06-18 改定、同 API利用規約 2025-06-18 施行の改正まで）https://www.reinfolib.mlit.go.jp/help/termsOfUse/ （2026-11-12 に curl で閲覧）

| 規約の求め | 画面での対応（文言は `reinfolib.ts` の定数） |
|---|---|
| API利用規約 第7条: 定型のクレジット「このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません」を、エンドユーザが見られる場所に表示 | `REINFOLIB_CREDIT`。手順3の「不動産情報ライブラリとの関係」欄、1枚シート下部（印刷にも入る）、出典ダイアログ、テキストでコピーに出す |
| 利用規約（PDL1.0 重要情報(1)）: 「出典：国土交通省　不動産情報ライブラリ」とURL。加工した場合はコンテンツ名と加工した旨。国が作成したかのような態様にしない | `REINFOLIB_ATTRIBUTION`・`REINFOLIB_PROCESSED`。同じ4か所 |
| API利用規約 第8条(1): アプリは API 利用者が開発・運営し責任を負う旨と、利用者との責任範囲を明示 | `REINFOLIB_RESPONSIBILITY`。同じ4か所 |
| 利用規約 第3条(4): 重要事項説明などの手続きに使うことは保証しない（参考情報） | `REINFOLIB_RESPONSIBILITY` に含める |
| 利用規約 第3条(7): 「不動産情報ライブラリ」を製品・サービス・アプリ名に使わない | アプリ名は「相談前の1枚シート」。変更なし |
| 利用規約 第7条: リンクはトップページへ、ライブラリへのリンクである旨を明示 | リンク先は https://www.reinfolib.mlit.go.jp/ 。「不動産情報ライブラリ（国土交通省）へのリンク」と表示 |
| API利用規約 第8条(2): キーを第三者に公開しない | キーは `.env` と `--env-file` だけ。ブラウザから API を呼ばない |

## 確認コマンド

```bash
npm run typecheck && npm test && npm run build
npx vite preview --port 8847 --host 127.0.0.1 &
node src/apps/biz-realestate/steps-check.mjs <出力フォルダ>
node src/apps/biz-realestate/e2e-check.mjs <出力フォルダ>
```
