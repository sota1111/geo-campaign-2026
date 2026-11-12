# 相談前の1枚シート（biz-realestate）

イチBizアワード 不動産情報活用部門のデモ。提出文書は `contests/ichibiz-2026/submission/realestate/`。

## 不動産情報ライブラリのデータを取り込む（前処理）

画面の「ライブラリ由来」の行は、`public/data/biz-realestate/reinfolib.json` があるときだけ出ます。無いときは「ライブラリで確認する項目」の案内だけが出て、ライブラリ由来とは表示しません。

ブラウザから API は呼びません。キーが公開されてしまううえ、公式の API 操作説明も「CORSエラーを防ぐため、ブラウザからリクエストしない」としているためです。ビルドの前に手元で一度だけ取得し、JSON を同梱します。

### 準備

1. 不動産情報ライブラリの API 利用申請（https://www.reinfolib.mlit.go.jp/api/request/）で API キーを発行してもらう（承認まで数営業日）。
2. キーは環境変数 `REINFOLIB_API_KEY` で渡す。ファイルには書かない。リポジトリにも入れない（`.env` や `secrets/` に置かない運用なら、実行するシェルでだけ設定する）。

### 実行（`contests/dashboard` で）

```bash
# 取得する範囲と本数だけ確認（キー不要・通信しない）
node src/apps/biz-realestate/fetch-reinfolib.ts --check

# 取得して public/data/biz-realestate/reinfolib.json を書く（キーは実行する時だけ設定）
read -rs REINFOLIB_API_KEY && export REINFOLIB_API_KEY   # 入力は画面に出ない
node src/apps/biz-realestate/fetch-reinfolib.ts
unset REINFOLIB_API_KEY

npm run build        # 取得結果を含めてビルド（public/data/ は dist/data/ にコピーされる）
```

Node 22.18 以上（TypeScript をそのまま実行できる版）が必要です。

| オプション | 既定 | 内容 |
|---|---|---|
| `--trade-years 2024,2025` | 前々年,前年 | 取引価格（XIT001）を集める年 |
| `--land-year 2025` | 前年 | 地価公示・地価調査（XPT002）の年。標準地が0点なら1年前に下げて再試行 |
| `--only trade,landPrice,division` | 3つとも | 取得する項目を絞る |
| `--out パス` | `public/data/biz-realestate/reinfolib.json` | 出力先 |

### 取得するもの（対象は徳島市）

| 項目 | API | 取得のしかた | JSON に残すもの |
|---|---|---|---|
| 取引価格の傾向 | XIT001（不動産価格（取引価格）情報取得API） | `year`・`area=36`・`city=36201`・`priceClassification=01`。「宅地(土地)」で㎡単価のある取引だけ | 町名ごとの㎡単価の**中央値と件数**（3件未満の町名は出さない）、市全体の中央値、取引時期の範囲。個別の取引（価格・面積・備考）は残さない |
| 地価公示・地価調査 | XPT002（地価公示・地価調査のポイント(点)API） | `response_format=geojson`・`z=13`・徳島市の範囲のタイルごと・`year` | 標準地の位置・番号・用途・当年価格（円/㎡）・対象年 |
| 区域区分 | XKT001（都市計画区域/区域区分API） | `response_format=geojson`・`z=13`・同じタイル | 区域区分の多角形（座標は小数5桁） |

仕様は公式 API 操作説明（https://www.reinfolib.mlit.go.jp/help/apiManual/ の XIT001・XPT002・XKT001、2026-11-12 に閲覧）に合わせています。リクエストヘッダは `Ocp-Apim-Subscription-Key`。通信は GET のみで、失敗時は最大3回再試行します（401/403 は即停止）。キーはログにも出力ファイルにも出ません。

- 1項目も取れなかったときは、出力ファイルを書き換えません。一部だけ取れたときは取れた項目だけ書き、終了コード1で知らせます。
- 約70回のリクエストを0.3秒間隔で送ります（約1分）。
- **実キーでの動作はまだ確認していません**（キー承認待ち）。公式の仕様どおりに作り、疑似サーバーでの流れと整形処理の単体テストだけ確認済みです。キーが届いたら最初に `--only trade` などで1項目ずつ試し、`npm test` のあと画面を見てください。

### 画面での使われ方

- 手順3の「この土地の条件」に、区域区分・近くの地価（参考）・取引価格の傾向の行が「ライブラリ由来」の印つきで出る。手順4・5の「売る」の聞くことにも同じ印つきで入る。
- 取引価格は町名単位（住所の町名が集計にある時）か市全体の中央値。個別の物件の価格ではない旨を併記する。地価は標準地の価格で、この土地の価格ではない旨を併記する。
- `reinfolib.json` は、作成者（`generator`）・出典・取得日の形が合うものだけ読み込む（`isReinfolibData`）。形が違うファイルは無いものとして扱う。
- `public/data/` は `.gitignore` の対象。取得結果をコミットして配布する場合は、利用約款（出典の表記・加工の明記・免責）を確認のうえ、総司令官の判断で扱いを決める。

## 確認コマンド

```bash
npm run typecheck && npm test && npm run build
npx vite preview --port 8847 --host 127.0.0.1 &
node src/apps/biz-realestate/steps-check.mjs <出力フォルダ>
node src/apps/biz-realestate/e2e-check.mjs <出力フォルダ>
```
