// 盛土巡視台帳: ロジック（元アプリ proposal-b/lib.js の TypeScript 移植）。
// 解析結果そのものは扱わず、与えられた候補の並べ替えと記録を担う。

export type Mode = 'real' | 'sample'

export interface Site {
  id: string
  lon?: number
  lat?: number
  x: number
  y: number
  areaM2: number
  zone: string
  // 実データ
  type?: string
  ring?: number[][]
  reliefM?: number | null
  slopeDeg?: number | null
  elevM?: number | null
  demRes?: string
  demPx?: number
  // 架空サンプル
  name?: string
  change?: string
  terrain?: string
  permit?: string
  detected?: string
  seasonal?: boolean
  note?: string
}

export type Part = [label: string, points: number | null]

export interface PatrolResult {
  siteId: string
  date: string
  who: string
  result: string
  memo: string
}

export type Ranked = Site & { score: number; parts: Part[]; latest: PatrolResult | null; rank: number }

type Band = [number, number][]
export interface RealWeights {
  type: Record<string, number>
  zone: Record<string, number>
  relief: Band
  slope: Band
  area: Band
}
export interface SampleWeights {
  change: Record<string, number>
  terrain: Record<string, number>
  permit: Record<string, number>
  zone: Record<string, number>
  ageMax: number
  seasonalPenalty: number
}
export type Weights = RealWeights | SampleWeights

export const DEFAULT_WEIGHTS: SampleWeights = {
  change: { 新設: 30, 拡大: 25, 変位: 20, 植生消失: 10 },
  terrain: { 谷埋め: 25, 斜面: 15, 平地: 0 },
  permit: { '許可・届出なし': 25, 確認中: 15, '許可・届出あり': 0 },
  zone: { 特定盛土等規制区域: 10, 宅地造成等工事規制区域: 5, 区域外: 0 },
  ageMax: 10,
  seasonalPenalty: -15,
}

// 実データ版の重み。入力はすべて実指標。しきい値と点数は説明用の仮置き。
export const DEFAULT_WEIGHTS_REAL: RealWeights = {
  type: { 谷埋め型: 25, 腹付け型: 15, 区分なし: 0 },
  zone: { 特定盛土等規制区域: 10, 宅地造成等工事規制区域: 5, 区域外: 0 },
  relief: [[40, 20], [20, 10], [10, 5]],
  slope: [[20, 20], [15, 12], [8, 6]],
  area: [[50000, 15], [10000, 10], [3000, 5]],
}

export const RESULTS = ['是正対象', '要継続観察', '問題なし', '立入不可・再訪'] as const

export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

export function scoreSite(site: Site, w: SampleWeights = DEFAULT_WEIGHTS, refDate: string) {
  const age = Math.max(0, daysBetween(site.detected ?? refDate, refDate))
  const parts: Part[] = [
    ['変化の種類（' + site.change + '）', w.change[site.change ?? ''] || 0],
    ['地形（' + site.terrain + '）', w.terrain[site.terrain ?? ''] || 0],
    ['許可・届出（' + site.permit + '）', w.permit[site.permit ?? ''] || 0],
    ['区域（' + site.zone + '）', w.zone[site.zone] || 0],
    ['検出からの経過（' + age + '日）', Math.round((w.ageMax * Math.min(age, 30)) / 30)],
  ]
  if (site.seasonal) parts.push(['季節変動の可能性（農地等）', w.seasonalPenalty])
  const score = Math.max(0, parts.reduce((s, p) => s + (p[1] ?? 0), 0))
  return { score, parts }
}

export function band(v: number | null | undefined, table: Band): number {
  if (v == null) return 0
  for (const [th, pt] of table) if (v >= th) return pt
  return 0
}

/** 実データ: 衛星由来の変化量は未接続のため点数に入れない（null 行で明示）。 */
export function scoreReal(site: Site, w: RealWeights = DEFAULT_WEIGHTS_REAL) {
  const noDem = site.reliefM == null
  const parts: Part[] = [
    ['衛星由来の変化（未接続。実運用では Sentinel-1/2 で算出）', null],
    ['型（' + site.type + '）', w.type[site.type ?? ''] || 0],
    ['区域（' + site.zone + '）', w.zone[site.zone] || 0],
    ['面積（' + site.areaM2 + ' m²）', band(site.areaM2, w.area)],
    [noDem ? '区域内の標高差（算出不可）' : '区域内の標高差（' + site.reliefM + ' m）', band(site.reliefM, w.relief)],
    [noDem ? '平均傾斜（算出不可）' : '平均傾斜（' + site.slopeDeg + '°）', band(site.slopeDeg, w.slope)],
  ]
  return { score: parts.reduce((s, p) => s + (p[1] ?? 0), 0), parts }
}

/** 緯度経度 → 地理院タイル（z/x/y とタイル内ピクセル） */
export function tileOf(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z) * 256
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  const tx = Math.floor(x / 256), ty = Math.floor(y / 256)
  return { z, x: tx, y: ty, px: x - tx * 256, py: y - ty * 256, wx: x, wy: y }
}

export function latestResult(results: PatrolResult[], id: string): PatrolResult | null {
  for (let i = results.length - 1; i >= 0; i--) if (results[i].siteId === id) return results[i]
  return null
}

export function rank(sites: Site[], w: Weights, refDate: string, results: PatrolResult[], mode: Mode): Ranked[] {
  return sites
    .map((s) => {
      const sc = mode === 'real' ? scoreReal(s, w as RealWeights) : scoreSite(s, w as SampleWeights, refDate)
      return { ...s, score: sc.score, parts: sc.parts, latest: latestResult(results, s.id), rank: 0 }
    })
    .sort((a, b) => b.score - a.score || (b.areaM2 || 0) - (a.areaM2 || 0) || (a.id < b.id ? -1 : 1))
    .map((s, i) => ({ ...s, rank: i + 1 }))
}

export interface Pt { x: number; y: number }
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

function tourLength(route: Pt[], origin: Pt): number {
  let total = 0
  let cur = origin
  for (const p of route) { total += dist(cur, p); cur = p }
  return route.length ? total + dist(cur, origin) : 0
}

/** 近い順に回る初期解（最近傍法） */
function nearestOrder<T extends Pt>(points: T[], origin: Pt): T[] {
  const pool = points.slice()
  const route: T[] = []
  let cur: Pt = origin
  while (pool.length) {
    let bi = 0
    for (let i = 1; i < pool.length; i++) if (dist(cur, pool[i]) < dist(cur, pool[bi])) bi = i
    const nx = pool.splice(bi, 1)[0]
    route.push(nx)
    cur = nx
  }
  return route
}

/** 2-opt: 区間の逆順化で短くなる限り入れ替える（起点は固定の周回路） */
function twoOpt<T extends Pt>(start: T[], origin: Pt): T[] {
  let best = start.slice()
  let len = tourLength(best, origin)
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)]
        const l = tourLength(cand, origin)
        if (l < len - 1e-9) { best = cand; len = l; improved = true }
      }
    }
  }
  return best
}

/** 全順列から最短の周回路を選ぶ（8件以下） */
function exactOrder<T extends Pt>(points: T[], origin: Pt): T[] {
  let best = nearestOrder(points, origin)
  let bestLen = tourLength(best, origin)
  const cur: T[] = []
  const used = new Array(points.length).fill(false)
  const walk = (len: number) => {
    if (len >= bestLen) return
    if (cur.length === points.length) {
      const l = tourLength(cur, origin)
      if (l < bestLen - 1e-9) { best = cur.slice(); bestLen = l }
      return
    }
    for (let i = 0; i < points.length; i++) {
      if (used[i]) continue
      used[i] = true; cur.push(points[i])
      walk(len + dist(cur.length > 1 ? cur[cur.length - 2] : origin, points[i]))
      cur.pop(); used[i] = false
    }
  }
  walk(0)
  return best
}

/** 上位 n 件を、起点から出て起点へ戻る周回路で回る順に並べる。
 *  8件以下は全順列で最短、それ以上は最近傍法の結果を 2-opt で改善する。距離は地図上の直線距離（道路距離ではない） */
export function planRoute<T extends Pt>(ranked: T[], origin: Pt, n: number) {
  const pool = ranked.slice(0, Math.max(0, n))
  const route = pool.length <= 8 ? exactOrder(pool, origin) : twoOpt(nearestOrder(pool, origin), origin)
  return { route, total: tourLength(route, origin), nearest: tourLength(nearestOrder(pool, origin), origin) }
}

/** 区分ごとの巡視結果の集計（件数のみ） */
export function hitStats(sites: Site[], results: PatrolResult[], key: 'type' | 'change') {
  const byId: Record<string, Site> = {}
  sites.forEach((s) => (byId[s.id] = s))
  const out: Record<string, { n: number; hit: number }> = {}
  results.forEach((r) => {
    const s = byId[r.siteId]
    if (!s) return
    const k = String(s[key])
    const o = out[k] || (out[k] = { n: 0, hit: 0 })
    o.n++
    if (r.result === '是正対象') o.hit++
  })
  return out
}

export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // 表計算ソフトで数式として解釈されないようにする
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function toCSV(header: string[], rows: unknown[][]): string {
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

// ---- データセット ----
export interface RealRaw {
  city: string
  fetched: string
  sites: Site[]
  zones: { type: string; ring: number[][]; notice?: string }[]
}
export interface SampleRaw {
  notice: string
  refDate: string
  city: string
  origin: { x: number; y: number; name: string }
  zones: { type: string; points: string }[]
  river?: string
  roads?: string[]
  sites: Site[]
}

export const CITY_HALL = { lon: 139.6722, lat: 35.2814 }

export interface Dataset {
  kind: Mode
  sites: Site[]
  origin: Pt & { name: string; lon?: number; lat?: number }
  refDate: string
  /** 実データのみ: 地図の範囲 */
  bounds?: [[number, number], [number, number]]
  /** 実データのみ: 区域ポリゴン */
  zones?: RealRaw['zones']
  raw?: SampleRaw
}

export function buildReal(raw: RealRaw): Dataset {
  const n = raw.sites.length
  const lat0 = raw.sites.reduce((a, s) => a + (s.lat ?? 0), 0) / n
  const lon0 = raw.sites.reduce((a, s) => a + (s.lon ?? 0), 0) / n
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574
  const proj = (lon: number, lat: number): Pt => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky })
  const sites = raw.sites.map((s) => ({ ...s, ...proj(s.lon ?? 0, s.lat ?? 0) }))
  const o = proj(CITY_HALL.lon, CITY_HALL.lat)
  let w = Infinity, s0 = Infinity, e = -Infinity, nn = -Infinity
  raw.sites.forEach((s) => {
    w = Math.min(w, s.lon ?? w); e = Math.max(e, s.lon ?? e)
    s0 = Math.min(s0, s.lat ?? s0); nn = Math.max(nn, s.lat ?? nn)
  })
  return {
    kind: 'real', sites, refDate: raw.fetched, bounds: [[w, s0], [e, nn]], zones: raw.zones,
    origin: { ...o, name: '市役所付近', lon: CITY_HALL.lon, lat: CITY_HALL.lat },
  }
}

export function buildSample(raw: SampleRaw): Dataset {
  return { kind: 'sample', sites: raw.sites, origin: raw.origin, refDate: raw.refDate, raw }
}

/** 台帳の絞り込み */
export function filterSites(
  ranked: Ranked[], mode: Mode, f: { zone: string; second: string; unvisited: boolean },
): Ranked[] {
  const key = mode === 'real' ? 'type' : 'permit'
  return ranked.filter((s) => (!f.zone || s.zone === f.zone) && (!f.second || s[key] === f.second) && (!f.unvisited || !s.latest))
}
