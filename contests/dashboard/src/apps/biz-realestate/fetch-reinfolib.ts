/* 不動産情報ライブラリ（国土交通省）の API から、徳島市の対象データを取得して contests/ichibiz-2026/app/realestate/web/data/reinfolib.json（同梱データ）に書く前処理。
 * ビルド時に scripts/copy-data.mjs が public/data/biz-realestate/ にコピーする。
 * ビルドの前に手元で1回実行する（ブラウザからは API を呼ばない。キーが公開されるうえ、公式も CORS エラーのためブラウザ送信を勧めていない）。
 *
 *   node --env-file=../../.env src/apps/biz-realestate/fetch-reinfolib.ts   # キーはリポジトリ直下 .env の REINFOLIB_API_KEY（雛形 .env.example）
 *   node src/apps/biz-realestate/fetch-reinfolib.ts --check      # キー不要。取得する範囲と本数だけ表示（通信しない）
 *
 * キーは環境変数だけから読む。ファイル・引数・ログには出さない。通信は GET のみ（外部への送信なし）。
 * 使い方の詳細は同じフォルダの README.md。 */
import fs from 'node:fs'
import path from 'node:path'
import { tileOf } from './lib.ts'
import { aggregateTrade, extractDivision, extractLandPoints, GENERATOR, type ReinfolibData } from './reinfolib.ts'

const here = import.meta.dirname
const root = path.resolve(here, '../../..') // contests/dashboard
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const opt = (n: string, d?: string) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d }

const CITY = { code: '36201', name: '徳島市' }
const PREF = '36'
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/'
const now = new Date()
const tradeYears = (opt('--trade-years') ?? `${now.getFullYear() - 2},${now.getFullYear() - 1}`).split(',').map((s) => s.trim()).filter(Boolean)
const landYear = Number(opt('--land-year') ?? now.getFullYear() - 1)
const Z = 13 // XPT002 は 13〜15、XKT001 は 11〜15 で指定できる。両方で使える最小の 13（本数が最も少ない）
// 既定は同梱データの置き場所（リポジトリに入る）。public/data/ に直接書くと、次のビルドで copy-data が同梱版で上書きするため
const outFile = path.resolve(opt('--out') ?? path.resolve(root, '../ichibiz-2026/app/realestate/web/data/reinfolib.json'))
const only = (opt('--only') ?? 'trade,landPrice,division').split(',')
const DELAY_MS = 300

function bboxTiles(): { x: number; y: number }[] {
  // 地図データ（徳島市の範囲）と同じ bbox をタイルに分ける。同梱データが先に無ければ元アプリのデータを読む
  const cands = [path.join(root, 'public/data/biz-realestate/tokushima.json'), path.resolve(root, '../ichibiz-2026/app/realestate/web/data/tokushima.json')]
  const f = cands.find((p) => fs.existsSync(p))
  const bbox: number[] = f ? JSON.parse(fs.readFileSync(f, 'utf8')).bbox : [134.42, 33.98, 134.66, 34.16]
  const a = tileOf(bbox[0], bbox[3], Z), b = tileOf(bbox[2], bbox[1], Z)
  const t: { x: number; y: number }[] = []
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) t.push({ x, y })
  return t
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const key = process.env.REINFOLIB_API_KEY

async function get(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const url = `${BASE}${endpoint}?${new URLSearchParams(params)}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response | null = null
    try {
      res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key as string } })
    } catch { /* 通信失敗は再試行 */ }
    if (res?.ok) { await sleep(DELAY_MS); return res.json() }
    if (res && res.status !== 429 && res.status < 500) {
      // 401/403=キーが無効・未承認、400=パラメータ。再試行しても同じなので止める（応答本文は出さない）
      throw new Error(`${endpoint} が HTTP ${res.status} を返しました（${res.status === 401 || res.status === 403 ? 'キーが無効、または未承認の可能性' : 'パラメータを確認'}）`)
    }
    await sleep(1000 * attempt)
  }
  throw new Error(`${endpoint} に接続できませんでした（3回失敗）`)
}
const featuresOf = (j: unknown) => ((j as { features?: unknown[] })?.features ?? [])

async function fetchTrade() {
  const rows: Record<string, unknown>[] = []
  for (const year of tradeYears) {
    const j = (await get('XIT001', { year, area: PREF, city: CITY.code, priceClassification: '01' })) as { data?: Record<string, unknown>[] }
    rows.push(...(j.data ?? []))
    console.log(`  XIT001 ${year}年: ${(j.data ?? []).length}件`)
  }
  const t = aggregateTrade(rows)
  if (!t) throw new Error('XIT001: 集計できる「宅地(土地)」の取引がありませんでした')
  return t
}
async function fetchLand() {
  const tiles = bboxTiles()
  for (const year of [landYear, landYear - 1]) {
    const feats: unknown[] = []
    for (const [i, t] of tiles.entries()) {
      const j = await get('XPT002', { response_format: 'geojson', z: String(Z), x: String(t.x), y: String(t.y), year: String(year) })
      feats.push(...featuresOf(j))
      if (i % 10 === 9) console.log(`  XPT002 ${year}年: ${i + 1}/${tiles.length} タイル`)
    }
    const points = extractLandPoints(feats)
    console.log(`  XPT002 ${year}年: 標準地 ${points.length}点`)
    if (points.length) return { year, points }
  }
  throw new Error('XPT002: 標準地が取得できませんでした')
}
async function fetchDivision() {
  const feats: unknown[] = []
  const tiles = bboxTiles()
  for (const [i, t] of tiles.entries()) {
    feats.push(...featuresOf(await get('XKT001', { response_format: 'geojson', z: String(Z), x: String(t.x), y: String(t.y) })))
    if (i % 10 === 9) console.log(`  XKT001: ${i + 1}/${tiles.length} タイル`)
  }
  const features = extractDivision(feats)
  console.log(`  XKT001: 区域 ${features.length}件`)
  if (!features.length) throw new Error('XKT001: 区域区分が取得できませんでした')
  return { features }
}

async function main() {
  const tiles = bboxTiles().length
  const plan = [
    only.includes('trade') && `XIT001 取引価格（${CITY.name}・${tradeYears.join('・')}年）: ${tradeYears.length}回`,
    only.includes('landPrice') && `XPT002 地価公示・地価調査（${landYear}年）: ${tiles}タイル`,
    only.includes('division') && `XKT001 区域区分: ${tiles}タイル`,
  ].filter(Boolean)
  console.log(`取得予定（z${Z}）:\n  ${plan.join('\n  ')}\n出力: ${path.relative(process.cwd(), outFile)}`)
  if (flag('--check')) return
  if (!key) {
    console.error('環境変数 REINFOLIB_API_KEY がありません。不動産情報ライブラリのAPIキーを環境変数で渡してください（README.md）。')
    process.exit(2)
  }
  const result: ReinfolibData = { generator: GENERATOR, source: '国土交通省 不動産情報ライブラリ', fetchedAt: now.toISOString().slice(0, 10), city: CITY }
  const failed: string[] = []
  for (const [name, fn] of [['trade', fetchTrade], ['landPrice', fetchLand], ['division', fetchDivision]] as const) {
    if (!only.includes(name)) continue
    console.log(`${name} を取得中…`)
    try {
      ;(result as unknown as Record<string, unknown>)[name] = await fn()
    } catch (e) {
      failed.push(name)
      console.error(`  失敗: ${(e as Error).message}`)
      if (/HTTP 40[13]/.test((e as Error).message)) break // キーの問題は他のAPIでも同じ
    }
  }
  if (!result.trade && !result.landPrice && !result.division) {
    console.error('1つも取得できなかったため、出力ファイルは書き換えません。')
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, JSON.stringify(result))
  console.log(`書き込みました: ${outFile}（${(fs.statSync(outFile).size / 1024).toFixed(0)}KB）${failed.length ? `。取得できなかった項目: ${failed.join('・')}` : ''}`)
  if (failed.length) process.exit(1)
}
await main()
