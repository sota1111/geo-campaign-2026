# 統合ダッシュボード（contests/dashboard）

4つのコンペ向けの7つのデモアプリを、1つの静的サイト（React + TypeScript + Tailwind CSS + shadcn/ui）にまとめた土台です。
サイドバーに「概要」とコンテスト別の7アプリがあり、スマホ幅ではサイドバーがシートになります。

## 起動

```bash
cd contests/dashboard
npm install
npm run dev          # 開発サーバー（http://localhost:5173/）
npm run build        # copy-data → tsc → vite build（dist/ に静的ファイル）
npm run preview      # dist/ の確認
npm run typecheck    # 型検査
npm test             # 共通部品の単体テスト（vitest）
npm run copy-data    # 元アプリのデータを public/data/<id>/ にコピー
node scripts/smoke.mjs http://127.0.0.1:8840/ docs/screenshots '' apps/odpt/   # 撮影＋コンソールエラー確認（要 preview 起動。'' はポータル）
node scripts/roundtrip.mjs http://127.0.0.1:8840/                            # ポータル→各アプリ→「← 統合ダッシュボード」の往復確認
```

`vite.config.ts` の `base` は `./` で、ルーターは使いません（ポータルは通常の `<a>` リンク）。`dist/` を任意のサブパスに置くだけで動きます。

## ページ構成（マルチページ。アプリごとに独立）

ポータル（概要のカード一覧）と7アプリは別 URL・別エントリ・別バンドルです。各アプリは単独で開いて完結し（サイドバーなし）、上部の細いヘッダーの「← 統合ダッシュボード」でポータルに戻れます。

| URL（dist/ 直下から。dev でも同じ） | ページ |
|---|---|
| `index.html` | ポータル（統合ダッシュボード） |
| `apps/odpt/` | 生活アクセス診断マップ |
| `apps/udc-moritsuchi/` | みんなの盛土ウォッチ |
| `apps/sat-a/` | 路面下リスクの二段階調査 |
| `apps/sat-b/` | 盛土巡視台帳 |
| `apps/biz-business/` | バス路線見直し案の比較 |
| `apps/biz-idea/` | 地名の記憶マップ |
| `apps/biz-realestate/` | 相談前の1枚シート |

仕組み: `apps/<id>/index.html` が `src/standalone/<id>.tsx` を読み、`src/apps/<id>/index.tsx` を `StandaloneShell`（ヘッダー・Toaster・TooltipProvider）で包んで描画します。HTML の `#root` の `data-root="../../"` がサイトルートへの相対パスで、`@/lib/data` の `dataUrl`/`fetchData`（`../../data/<id>/…`）、`portalUrl`、`appUrl` が使います。ハッシュが空なら起動時に `#/` にします。共有リンク（`useHashState` や `location.href`）は、そのアプリ独立ページの URL になります。

## 構成と、工兵が触ってよい範囲

```
src/apps/registry.ts          7アプリのメタデータ（名前・目的・対象者・締切・データ種別）  ← 触らない
src/apps/<id>/index.tsx       各アプリのページ。default export の React コンポーネント ← 自分の id だけ編集
src/apps/<id>/**              そのアプリ専用の部品・ロジック（自由に追加）           ← 自分の id だけ
public/data/<id>/             そのアプリのデータ（JSON/GeoJSON）                      ← 自分の id だけ
src/components/shared/        共通部品                                                ← 触らない（要望は報告に書く）
src/components/ui/            shadcn/ui                                               ← 触らない
src/components/layout/, src/pages/, src/App.tsx  シェル                               ← 触らない
```

**規約: 工兵は `src/apps/<自分のid>/` と `public/data/<自分のid>/` だけを変更する。** `registry.ts`・`package.json` も触らない（依存の追加が必要なら報告に書く）。
並行作業での衝突を避けるための取り決めです。

| id | アプリ | 元の静的版（ロジック・データ・文言の出典。変更禁止） |
|---|---|---|
| `odpt` | 生活アクセス診断マップ | contests/odpt-2026/app/web/ |
| `udc-moritsuchi` | みんなの盛土ウォッチ | contests/udc-2026/app/moritsuchi-watch/ |
| `sat-a` | 路面下リスクの二段階調査 | contests/satellite-2026/app/proposal-a/ |
| `sat-b` | 盛土巡視台帳 | contests/satellite-2026/app/proposal-b/ |
| `biz-business` | バス路線見直し案の比較 | contests/ichibiz-2026/app/business/web/ |
| `biz-idea` | 地名の記憶マップ | contests/ichibiz-2026/app/idea/ |
| `biz-realestate` | 相談前の1枚シート | contests/ichibiz-2026/app/realestate/web/ |

## ページの書き方

`src/apps/<id>/index.tsx` は `export default function ...` でコンポーネントを返します（`src/standalone/<id>.tsx` が読み込む）。
先頭に `<PageHeader appId="<id>" />` を置くと、アプリ名・目的・データ種別が registry の文言で表示されます（日本語UI。赤緑の対比を避け、地図の既定色は青・橙）。
shadcn のコンポーネントは `@/components/ui/...`、共通部品は `@/components/shared/...` から import します（`@` は `src/`）。

```tsx
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView } from '@/components/shared/MapView'

export default function App() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader appId="odpt" />
      <MapView center={[137.21, 36.69]} zoom={12} />
    </div>
  )
}
```

`src/components/shared/Placeholder.tsx` が使用例です（現在の仮ページ）。

## データの置き場所と読み方

`npm run copy-data`（`scripts/copy-data.mjs`）が、元アプリのデータを `public/data/<id>/` にコピーします（`.js` 形式は JSON に変換。`window.REAL` → `sat-b/real.json`、`window.SAMPLE` → `sat-b/sample.json`）。大きい生データやキャッシュは含めていません。
コピー対象を増やす場合はシェル担当に依頼してください。`public/data/<自分のid>/` に自作のデータファイルを足すのは自由です（copy-data は同名ファイルだけ上書きします）。

| id | 置かれるファイル |
|---|---|
| odpt | index.json, {iida,kumamoto,tokushima,tokyo,toyama}.json, whatif_{同}.json |
| udc-moritsuchi | fills.geojson |
| sat-a | sample.json |
| sat-b | real.json, sample.json |
| biz-business | odpt と同じ（index.json, 5地域, whatif_ 5地域） |
| biz-idea | lore.json, samples.json |
| biz-realestate | tokushima.json |

```ts
import { fetchData, dataUrl } from '@/lib/data'

const fills = await fetchData<GeoJSON.FeatureCollection>('udc-moritsuchi', 'fills.geojson')
const url = dataUrl('odpt', 'tokushima.json')   // 'fetch' や MapView の GeoJSON 取得に
```

## 共通部品（src/components/shared/）

| 部品 | 使い方 |
|---|---|
| `MapView` | `<MapView center={[lng,lat]} zoom={12} bounds={[[w,s],[e,n]]} layers={[...]} onClick={({lng,lat}) => ...} onFeatureClick={(f, layerId, lngLat) => ...} clickableLayerIds={['a']} basemap="pale" attribution="国土数値情報（国土交通省）" onMapReady={(map) => ...} className="h-[480px]" />` |
| `MapLayer`（型） | `{ id, type: 'fill'｜'line'｜'circle', data: GeoJSON, paint?, layout?, filter?, minzoom?, maxzoom? }`。`layers` は `useMemo` で安定させる。同じ `id` で `data` / `paint` を変えると更新、配列から消すとレイヤーも消える。`paint` 省略時は青／橙の既定色 |
| `DataBadge` | `<DataBadge kind="real｜fictional｜partial" />` →「実データ」「架空データ」「一部架空」。`label` で文言変更可 |
| `SourceDialog` | `<SourceDialog sources={[{ name, provider?, license?, url?, note? }]} />` 出典・ライセンスのダイアログ（ボタン付き。`trigger` で差し替え可） |
| `PageHeader` | `<PageHeader appId="odpt" actions={<SourceDialog .../>} />` |
| `downloadText` ほか | `downloadText(filename, text, mime?)`、`downloadCsv(filename, rows)`（BOM付きCSV。`rows` は2次元配列）、`downloadGeoJson(filename, obj)`、`toCsv(rows)` |
| `useLocalStorage` | `const [v, setV, reset] = useLocalStorage('<id>:records', [])`（JSON保存。キーは `<id>:` で始める） |
| `useHashState` | `const [q, setQ] = useHashState('q', '')` → URL が `apps/<id>/index.html#/?q=...` に。共有リンク用。文字列のみ（数値や配列は呼び出し側で変換）。`setQ` は履歴を増やさない |

- 地図の背景は国土地理院タイル（淡色 pale・標準 std・写真 seamlessphoto）で、左上のボタンで切り替わります。右下に出典表示が常に出ます。独自の背景が必要なら `onMapReady` で `map` を受け取って操作します。
- 親要素に高さが必要です（`MapView` の既定は `h-[420px]`。`className` で変更）。
- トースト通知は `import { toast } from 'sonner'`（`Toaster` はシェルに設置済み）。`TooltipProvider` もシェルに設置済みです。
- 入っている shadcn コンポーネント: sidebar, card, button, badge, tabs, table, select, slider, input, label, textarea, checkbox, dialog, sheet, tooltip, separator, scroll-area, toggle-group (toggle), alert, sonner, dropdown-menu, progress, breadcrumb, skeleton。足りないものは `npx shadcn@latest add <name>` でよいが、他の工兵と競合するのでシェル担当に依頼すること。

## 検証の状況

- `npm run build` 成功、`npm test`（vitest 6件）成功、`npm run typecheck` 成功。
- ヘッドレスChromeで概要ページとアプリページをデスクトップ(1280px)・スマホ(390px)で撮影し、コンソールエラーなしを確認。画像は `docs/screenshots/`。

## ライセンス・出典

- shadcn/ui: MIT（コードを `src/components/ui/` にコピーして使用）
- Radix UI: MIT / React: MIT / Tailwind CSS: MIT / lucide-react: ISC
- maplibre-gl 4.7.x: BSD-3-Clause
- 背景地図: 国土地理院タイル（淡色・標準・シームレス空中写真）。出典の表示が必要。https://maps.gsi.go.jp/development/ichiran.html
- 各アプリのデータの出典・ライセンスは、元アプリの README・画面の記載に従い、各ページの `SourceDialog` に書く。

## 手順サイドバー（useAppSteps）

各アプリページは、目的を達成する手順を `useAppSteps` で登録できます。登録すると、デスクトップ（768px 以上）では左サイドバー（幅 240px）に、スマホでは上部の折りたたみステッパー（いまここの手順名＋進捗、タップで一覧）に出ます。登録しないページでは何も出ません（壊れません）。

```tsx
import { useAppSteps } from '@/components/shared/AppSteps'

useAppSteps([
  { id: 'place', title: '場所を選ぶ', hint: '地図をタップ', done: !!point, onSelect: () => setTab('map') },
  { id: 'copy', title: '結論をコピーする', done: copied },
  { id: 'memo', title: '共有メモを書く', done: false, optional: true },
])
```

- 型: `AppStep = { id; title; hint?; done; optional?; onSelect? }`。毎レンダーで最新を渡す（`done` は状態から計算する）。
- 表示: 番号つきで上から。済（✓）／いまここ（最初の未完了の必須手順を強調）／未着手。`optional` は「任意」表示で、「いまここ」と進捗の数から除外。クリックで `onSelect`（タブ切替・スクロールなど）。
- 進捗は「必須の完了数/必須の数 完了」。必須がすべて済むと「目的に必要な手順はすべて完了しました」。
- 判定関数 `currentStepIndex` / `stepStatuses` / `stepProgress` も同じファイルから export（テスト: `src/test/appsteps.test.tsx`）。

## 地図・Select の注意

- `MapView` は既定で `cooperativeGestures`（ページのスクロール中に地図が拡大されない。Ctrl/⌘＋ホイールで拡大、スマホは2本指で移動。日本語メッセージ）。`cooperativeGestures={false}` で無効化。
- `src/components/ui/select.tsx` と `dropdown-menu.tsx` は閉じるアニメーション（animate-out）を外してあります。Radix Select は開いている間 body に `pointer-events:none` を付け、閉じるアニメ終了まで外さないため、閉じた直後の最初のクリックが無反応になっていたためです（再現: `node scripts/select-repro.mjs <base_url>`）。shadcn で再生成する時は同じ修正を戻すこと。
- 確認用スクリプト: `scripts/wheel-check.mjs`（地図上のホイール）。

## 新しいページの書き方（サイドバー主導・1画面に収める）

方針: **サイドバーが唯一のナビゲーション**。メインは「サイドバーで選んだ手順」の内容だけを表示し（スクロールで移動せず切り替える）、デスクトップでは body をスクロールさせない。長い表・リストは手順パネルの枠内だけでスクロールする。

```tsx
const [step, setStep] = useState('place')
useAppSteps(
  [
    { id: 'place', title: '場所を選ぶ', done: !!point },
    { id: 'result', title: '結論を見る', done: copied },
    { id: 'memo', title: '共有メモ', done: false, optional: true },
  ],
  { activeId: step, onSelectStep: setStep, description: '車を使わない家族が…（目的の一文）' },
)
return (
  <>
    <PageHeader appId="odpt" compact actions={<SourceDialog sources={...} />} />
    <StepLayout title={titles[step]} hint="地図をタップして出発地を選ぶ" aside={<MapView ... />}>
      {step === 'place' && <PlacePanel />}
      {step === 'result' && <ResultPanel />}
    </StepLayout>
  </>
)
```

- `useAppSteps(steps, { activeId, onSelectStep, description })`（2つ目は省略可・後方互換）。サイドバーで「表示中」（`activeId`：左の太い帯＋背景）と「いまここ（次にやる必須手順）」は別の表現。手順が済になっても自動で表示は切り替わらない（いまここの強調が次へ移るだけ）。サイドバーの手順をクリックすると `onSelectStep(id)`（と従来の `onSelect`）が呼ばれる。`description` はサイドバーのアプリ名の下に出る。
- `StepLayout`（`@/components/shared/StepLayout`）: `title`（手順名）、`hint`（1行）、`aside`（地図など常設領域・任意）、`children`（手順パネル本文。枠内スクロール）。デスクトップ（768px 以上）は、ヘッダーからウィンドウ下端までに収まり、左に手順パネル（幅 380〜440px）・右に aside が残り幅いっぱい。スマホは縦並び（aside が上、高さ 38vh。パネルの下でページ全体がスクロール）。aside の `MapView` に高さ指定は不要（親に合わせて 100%）。`StepLayout` を使うページでは Shell が body のスクロールを止め、`main` の余白もなくなる。
- `PageHeader compact`: アプリ名・データ種別・`actions`（出典ボタン）だけの1行（高さ 44px）。説明文はサイドバーの `description` へ。
- 旧書き方のページ（`PageHeader` ＋縦に長い本文）もそのまま動く。

共通部分の仕様（デザイン審査対応）:
- **ヘッダー**: `PageHeader compact` は自分の行を持たず、データ種別バッジと `actions`（出典ボタン等）を Shell の細いヘッダー（「← 統合ダッシュボード」の行）の右側に描画します。アプリ名はサイドバー上端のみ（スマホはヘッダーに短く出る）。狭い幅では折り返します。ページ側のコード変更は不要。
- **番号**: `StepLayout` の `title` の前に、サイドバーと同じ番号（`activeId` の手順の順番。必須手順だけに 1,2,3…。任意は「参考」）が自動で付きます。**ページ側は番号なしの題名を渡す**（「1 」「1. 」を付けない）。
- **サイドバー**: 手順リストはサイドバー内でスクロールします。任意の手順は「参考（任意）」の見出しの下にまとめて小さく表示（折りたたみ可。表示中の手順が任意なら自動で開く）。
- **スマホの上部ステッパー**: 主表示は表示中の手順（`activeId`。「手順 3／5：題名」「参考：題名」）。いまここが別の手順なら「次: 手順n …」を小さく添える。`activeId` を渡さないページは従来どおり、いまここを主表示。
- **注意帯**: `StepLayout` の `notice`（1行の注意・データ範囲。ページが渡した場合のみ、全幅の帯として最上部に出る）。

「済」の付け方の共通ルール:
- 「見る」手順（結論・比較・確認）: 前提が満たされた状態でその手順を表示したら済。
- 「する」手順（検索・選択・保存・書き出し・コピー）: その主操作を行ったら済。
- 初期値で成り立つ手順: 表示したら済。

サイドバーの表示の取り決め:
- サイドバーの各手順は**題名だけ**（`hint` はサイドバーに出ない。パネル見出しの下＝`StepLayout` にだけ出る。`StepLayout` の `hint` を省略すると登録した手順の `hint` が使われる）。「表示中」は左の太い帯と背景で示し、文字ラベルは出さない。「次にやる手順」は「次はこれ」と出る。
- `AppStep.action`（任意。例: `'文面をコピーすると完了'`）: 未完了の間だけ、サイドバーの手順の下に小さく出る。主操作が何かを示すのに使う。
- **前の必須手順を飛ばして先へ進んだ時だけ**（表示中の `activeId` が最初の未完了の必須手順より後ろ）、サイドバー下部（スマホは上部バーを開いた一覧の先頭）に「まだ済んでいない手順: 手順3「…」ほか1件」を表示し、押すとその手順へ移動する（`onSelectStep`）。順番どおりの間と `activeId` を渡さないページでは出ない（「次はこれ」で足りるため）。ページ内に同じ案内を重ねて作らない。すべて済むと「目的に必要な手順はすべて完了しました」を1行出す。
- **最後の手順の主操作は、パネル内で最も目立つボタン1つにする**（コピー・書き出し・保存など。副次の操作は `outline` などで控えめに）。押さずに終えられないよう、`action` で何をすれば完了かを書く。

撤去すべき重複要素のチェックリスト（サイドバーと機能が被るもの）:
- [ ] ページ内のタブ・段階タブ・ステッパー（手順の切り替えはサイドバーだけ）
- [ ] ページ内の手順一覧・「使い方 n ステップ」・進捗表示（サイドバーに出る）
- [ ] 「次へ」「〜へ進む」「〜に移動」ボタン（サイドバーで移動する。次の手順は「いまここ」で分かる）
- [ ] 手順間の自動スクロール（`scrollIntoView` など。原則禁止）
- [ ] PageHeader の長い説明文（サイドバーの `description` へ）
- [ ] 縦に長く伸びるカードの積み重ね（手順ごとに切り替える。表・リストは枠内スクロール）

## 実行サンプル（?sample=1）
- `apps/<id>/index.html?sample=1#/` で、初見ユーザー試験で AI（Sonnet）が使用目的だけを与えられて操作した「模擬利用」を再現した状態で開く（実在の住民・職員の利用実績ではない）。通常の使い方は `?sample` なしの URL（従来どおり）。ポータルのカードに「実行サンプル」、各アプリのヘッダーに「実行サンプルを見る」。
- 判定は `isSampleMode()`（src/lib/sample.ts）。サンプル中は localStorage／sessionStorage に書き込まない（`useLocalStorage` の第3引数でサンプルの初期値を渡せる）。
- AI の模擬利用の記録は `src/apps/<id>/sample.ts`（SampleRun）。`notes` は手順 id ごとの「AI が模擬利用でしたこと」で、StepLayout が本文の先頭に紫の枠（既定は2行に省略、「詳しく」で開閉）で出す。出典は reports/aggressor/20261111-r6/<id>.md。
- サンプル中も手順は操作できる（保存はしない）。帯（1行。スマホでは固定されない）の「通常の使い方に切り替える」（文字リンク）で初期状態の通常ページへ。
