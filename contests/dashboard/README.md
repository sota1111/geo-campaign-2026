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
node scripts/smoke.mjs http://127.0.0.1:8840/ docs/screenshots / /apps/odpt   # ヘッドレスChromeで撮影＋コンソールエラー確認（要 preview 起動）
```

`vite.config.ts` の `base` は `./`、ルーティングは HashRouter なので、`dist/` を任意のサブパスに置くだけで動きます。

## 構成と、工兵が触ってよい範囲

```
src/apps/registry.ts          7アプリのメタデータ（名前・目的・締切・データ種別）  ← 触らない
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

`src/apps/<id>/index.tsx` は `export default function ...` でコンポーネントを返します（`registry.ts` が `lazy(() => import('./<id>/index'))` で読み込む）。
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
| `useHashState` | `const [q, setQ] = useHashState('q', '')` → URL が `#/apps/<id>?q=...` に。共有リンク用。文字列のみ（数値や配列は呼び出し側で変換）。`setQ` は履歴を増やさない |

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
