// 二段階調査のロジック（純関数）。元アプリ proposal-a/logic.js の TypeScript 移植（2026-11-21、実データ版）。
// 点数は「衛星の階級（国土地理院の干渉SAR成果）」と「下水道台帳の竣工年（豊中市）」から計算する。
// 空洞の有無は、利用者が CSV で入れた調査結果（parseOutcomes）だけを使う。同梱の実データには空洞の結果が無い。
// 説明用デモ（架空の結果。既定オフ）を使ったときの AUC などの数字は、実在の精度・効果を示さない。

export const NOW_YEAR = 2026
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export type SegClass = 'life' | 'arterial' | 'noledger'
export interface Segment {
  id: string
  cls: SegClass
  cell: string
  /** 竣工年（台帳で不明なら null） */
  year: number | null
  dia?: number | null
  lenM: number
  hw?: string
  name?: string
  coords: [number, number][]
  /** 実行時: 調査結果が入った区間 */
  surveyed?: boolean
}
export interface Cell {
  id: string
  cx: number
  cy: number
  k: number
  /** 階級の中央値 mm/年（負=沈下） */
  disp: number
  dispW: number
  range: [number, number]
  ring: [number, number][]
}
export interface DataFile {
  note: string
  area: { name: string; bbox: [number, number, number, number] }
  satellite: { name: string; class_width_mm_yr: number; layer: string; palette: string[] }
  stats: {
    segments: number
    segments_by_cls: Record<string, number>
    life_year_unknown: number
    match_rate_by_threshold: Record<string, { matched: number; of: number; rate: number }>
    cell_with_roads_class_counts: Record<string, number>
    sewer_total_records: number
    sewer_unknown_year_all: number
  }
  cells: Cell[]
  segments: Segment[]
}
export interface DemoData {
  note: string
  past: string[]
  hit: string[]
}
export type Scored = Segment & { score: number }
export type CellSat = Record<string, number>
export interface Calibration {
  w: number | null
  reason: string | null
  pos: number
  neg: number
  table: { w: number; auc: number | null }[]
  ledgerOnly?: number | null
  satOnly?: number | null
}
export interface Exclusion {
  n: number
  ok: number
  rate: number
}

/** 台帳で竣工年が不明な管の古さ。中立の 0.5（画面では「不明」と表示） */
export const AGE_UNKNOWN = 0.5
/** 管の経過年数 → 0〜1（60年で1。画面上の便宜的な正規化で、標準耐用年数50年とは別） */
export const ageNorm = (year: number | null | undefined, now = NOW_YEAR) => (year == null ? AGE_UNKNOWN : clamp01((now - year) / 60))

/** 地表変位（階級の中央値 mm/年, 負=沈下）→ 0〜1（-8mm/年以下で1。デモ上の正規化） */
export const satNorm = (dispMmYr: number) => clamp01(-dispMmYr / 8)

/** 区間の点数。w は衛星指標の重み（0=台帳のみ, 1=衛星のみ） */
export function segScore(seg: Pick<Segment, 'cell' | 'year'>, cellSat: CellSat, w: number) {
  return w * cellSat[seg.cell] + (1 - w) * ageNorm(seg.year)
}

/** 全区間を点数付けして降順に並べる */
export function rank(segs: Segment[], cellSat: CellSat, w: number): Scored[] {
  return segs
    .map((s) => ({ ...s, score: segScore(s, cellSat, w) }))
    .sort(byScore)
}

/** 並べ方: 点数の高い順。同点（差 1e-9 未満）は竣工年の古い順（不明は後ろ）、さらに区間ID順 */
const yearKey = (y: number | null | undefined) => (y == null ? 99999 : y)
export function byScore(a: Scored, b: Scored) {
  if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score
  return yearKey(a.year) - yearKey(b.year) || a.id.localeCompare(b.id)
}

/** 重みを変える条件（仮の基準。画面に明示する）: 最良の重みの AUC が MIN_AUC 以上、かつ今の重みより MIN_GAIN 以上高いこと */
export const MIN_AUC = 0.6
export const MIN_GAIN = 0.05
export type AdoptReason = 'short' | 'low' | 'small' | 'same' | null
export interface Adoption { w: number; adopt: boolean; reason: AdoptReason; best: number | null; cur: number | null; capped: boolean; weak: boolean }
/** 1回の較正で重みを動かす上限（仮の基準）。少数・弱い結果で台帳の根拠を一度に捨てないため */
export const MAX_STEP = 0.3
/** これより弱い・少ない結果では、更新しても注意を出す（仮の基準） */
export const WEAK_AUC = 0.7
export const MIN_LABELS = 20
export const ADOPT_REASON: Record<Exclude<AdoptReason, null>, string> = {
  short: '結果が足りない',
  low: 'あり・なしの差が点数に出ていない',
  small: '重みを変えても差が小さい',
  same: '今の重みが最も当たる',
}
/** 較正の結果から、次回に使う重みを決める。条件を満たさなければ今の重みのまま（当てずっぽうに近い結果で重みを動かさない）。更新幅は MAX_STEP まで */
export function adoptWeight(cal: Calibration | null, scanned: Scanned[], cellSat: CellSat, curW: number, minAuc = MIN_AUC, minGain = MIN_GAIN): Adoption {
  if (!cal || cal.w === null) return { w: curW, adopt: false, reason: 'short', best: null, cur: null, capped: false, weak: false }
  const best = aucAt(scanned, cellSat, cal.w) as number
  const cur = aucAt(scanned, cellSat, curW) as number
  const weak = best < WEAK_AUC || scanned.length < MIN_LABELS
  if (Math.abs(cal.w - curW) < 1e-9) return { w: curW, adopt: false, reason: 'same', best, cur, capped: false, weak }
  if (best < minAuc) return { w: curW, adopt: false, reason: 'low', best, cur, capped: false, weak }
  if (best - cur < minGain) return { w: curW, adopt: false, reason: 'small', best, cur, capped: false, weak }
  const d = cal.w - curW
  const capped = Math.abs(d) > MAX_STEP + 1e-9
  const w = capped ? Math.round((curW + Math.sign(d) * MAX_STEP) * 10) / 10 : cal.w
  return { w, adopt: true, reason: null, best, cur, capped, weak }
}

/** 結果が未入力の生活道路（候補）だけを取り出す（順位順を保つ） */
export const candidatesOf = (ranked: Scored[]) => ranked.filter((s) => s.cls === 'life' && !s.surveyed)

/** 結果が未入力の生活道路の上位から、予算（km）を超えない範囲で貪欲に選ぶ */
export function selectByBudget(ranked: Scored[], budgetKm: number): string[] {
  const out: string[] = []
  let m = 0
  for (const s of ranked) {
    if (s.cls !== 'life' || s.surveyed) continue
    if ((m + s.lenM) / 1000 > budgetKm) continue
    out.push(s.id)
    m += s.lenM
  }
  return out
}

export const totalKm = (segs: Segment[], ids: Set<string>) =>
  segs.filter((s) => ids.has(s.id)).reduce((a, s) => a + s.lenM, 0) / 1000

/** AUC（陽性の点数が陰性より高い確率。同点は0.5）。陽性か陰性が無ければ null */
export function auc(items: { hit: boolean; score: number }[]): number | null {
  const pos = items.filter((x) => x.hit)
  const neg = items.filter((x) => !x.hit)
  if (!pos.length || !neg.length) return null
  let s = 0
  for (const p of pos) for (const n of neg) s += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return s / (pos.length * neg.length)
}

export type Scanned = Pick<Segment, 'cell' | 'year'> & { hit: boolean }

export function aucAt(scanned: Scanned[], cellSat: CellSat, w: number) {
  return auc(scanned.map((s) => ({ hit: s.hit, score: segScore(s, cellSat, w) })))
}

/** 重みを0〜1（0.1刻み）で探し、AUCが最大の重みを返す。最大が複数なら 0.5 に近い方。
 *  陽性・陰性のどちらかが minEach 未満なら「データ不足」として w=null */
export function calibrate(scanned: Scanned[], cellSat: CellSat, minEach = 3): Calibration {
  const pos = scanned.filter((s) => s.hit).length
  const neg = scanned.length - pos
  if (pos < minEach || neg < minEach) return { w: null, reason: 'データ不足', pos, neg, table: [] }
  const table: { w: number; auc: number | null }[] = []
  for (let i = 0; i <= 10; i++) {
    const w = i / 10
    table.push({ w, auc: aucAt(scanned, cellSat, w) })
  }
  const best = Math.max(...table.map((t) => t.auc as number))
  const cands = table.filter((t) => Math.abs((t.auc as number) - best) < 1e-12)
  cands.sort((a, b) => Math.abs(a.w - 0.5) - Math.abs(b.w - 0.5) || a.w - b.w)
  return { w: cands[0].w, reason: null, pos, neg, table, ledgerOnly: table[0].auc, satOnly: table[10].auc }
}

/** 点数が下位の半分を「異常なし」と判定したとき、その中で実際に異常なしだった割合。件数が minN 未満なら null */
export function exclusionAccuracy(scanned: Scanned[], cellSat: CellSat, w: number, minN = 5): Exclusion | null {
  const arr = scanned
    .map((s) => ({ hit: s.hit, score: segScore(s, cellSat, w) }))
    .sort((a, b) => a.score - b.score)
  const low = arr.slice(0, Math.floor(arr.length / 2))
  if (low.length < minN) return null
  const ok = low.filter((x) => !x.hit).length
  return { n: low.length, ok, rate: ok / low.length }
}

/** 重み w で並べたときの上位 n 区間のうち、台帳のみ（w=0）の上位 n 区間に無いものの数 */
export function topShift(segs: Segment[], cellSat: CellSat, w: number, n = 20): number {
  const top = (ww: number) => candidatesOf(rank(segs, cellSat, ww)).slice(0, n).map((s) => s.id)
  const base = new Set(top(0))
  return top(w).filter((id) => !base.has(id)).length
}

/** 区間と結果（Map: 区間ID → 空洞あり）から、較正に使う形（hit 付き）を作る */
export const scannedFrom = (segs: Segment[], results: Map<string, boolean>): (Segment & Scanned)[] =>
  segs.filter((s) => results.has(s.id)).map((s) => ({ ...s, hit: results.get(s.id) as boolean }))

// ---------------------------------------------------------------------------
// 調査結果（空洞あり/なし）の CSV の取り込み。処理はブラウザ内だけ。
// 受け付ける書き方は2つ（GMS3 の出力書式は未確認のため、どちらでも受けられるようにしてある）:
//   (1) 区間ID ＋ 空洞あり/なし        例: segment_id,cavity
//   (2) 緯度・経度の点 ＋ 空洞あり/なし  例: lat,lon,cavity   （近い区間に結び付ける）
// ---------------------------------------------------------------------------

/** 点を区間に結び付ける最大距離（m）。デモ上の仮の値 */
export const LINK_MAX_M = 20

const COL_ID = ['segment_id', 'segmentid', 'id', '区間id', '区間', '区間番号']
const COL_LAT = ['lat', 'latitude', '緯度', 'y']
const COL_LON = ['lon', 'lng', 'long', 'longitude', '経度', 'x']
const COL_RES = ['cavity', 'result', 'hit', '空洞', '空洞の有無', '空洞有無', '結果', '有無']
const YES = new Set(['1', 'true', 'yes', 'y', 'あり', '有', '有り', '空洞あり', '空洞有り', '空洞有', '疑い', '疑いあり', 'hit', 'positive', 'pos'])
const NO = new Set(['0', 'false', 'no', 'n', 'なし', '無', '無し', '空洞なし', '空洞無し', '空洞無', '異常なし', '異常無し', 'none', 'ok', 'negative', 'neg'])
const squash = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[\s　]/g, '')

/** 空洞の有無の表記を true/false にする。分からなければ null */
export function parseCavity(v: unknown): boolean | null {
  const k = squash(v)
  if (YES.has(k)) return true
  if (NO.has(k)) return false
  return null
}

/** 最小の CSV パーサ（カンマまたはタブ区切り、引用符、BOM、CRLF） */
export function parseCsv(text: string): string[][] {
  const t = String(text).replace(/^﻿/, '')
  const first = t.split(/\r?\n/, 1)[0] || ''
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  const flush = () => {
    row.push(cell)
    cell = ''
    if (row.some((x) => x.trim() !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++ } else q = false
      } else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; flush() }
    else cell += c
  }
  if (cell !== '' || row.length) flush()
  return rows
}

const findCol = (hdr: string[], names: string[]) => hdr.findIndex((h) => names.includes(h))

/** 点（経度・緯度）から区間（2点の線分）までの距離（m）。区間の近くだけで使う平面近似 */
export function distToSegM(lon: number, lat: number, coords: [number, number][]): number {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const px = lon * kx
  const py = lat * ky
  const [a, b] = coords
  const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky
  const dx = bx - ax, dy = by - ay
  const L2 = dx * dx + dy * dy
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 点に最も近い区間（台帳なしの道路は除く）。しきい値より遠ければ null */
export function nearestSegment(lon: number, lat: number, segs: Segment[], maxM = LINK_MAX_M) {
  let best: Segment | null = null
  let bd = maxM
  for (const s of segs) {
    if (s.cls === 'noledger') continue
    const d = distToSegM(lon, lat, s.coords)
    if (d <= bd) { bd = d; best = s }
  }
  return best ? { seg: best, distM: bd } : null
}

export interface OutcomeSummary {
  rows: number
  byId: number
  byPoint: number
  unknownId: number
  unmatched: number
  invalid: number
  blank: number
  merged: number
  conflicts: number
  segments: number
  hit: number
  none: number
}
export interface ParsedOutcomes {
  error: string | null
  results: Map<string, boolean>
  summary: OutcomeSummary
}
const EMPTY: OutcomeSummary = { rows: 0, byId: 0, byPoint: 0, unknownId: 0, unmatched: 0, invalid: 0, blank: 0, merged: 0, conflicts: 0, segments: 0, hit: 0, none: 0 }

/**
 * 調査結果の CSV を、区間ごとの空洞の有無（Map: 区間ID → true/false）にする。
 * 1つの区間に複数行（または複数の点）があるときは「1つでもあり」なら あり。
 */
export function parseOutcomes(text: string, segs: Segment[], maxM = LINK_MAX_M): ParsedOutcomes {
  const fail = (error: string): ParsedOutcomes => ({ error, results: new Map(), summary: { ...EMPTY } })
  const rows = parseCsv(text)
  if (rows.length < 2) return fail('見出し行とデータ行が必要です。')
  const hdr = rows[0].map(squash)
  const ci = findCol(hdr, COL_ID), cla = findCol(hdr, COL_LAT), clo = findCol(hdr, COL_LON), cr = findCol(hdr, COL_RES)
  if (cr < 0) return fail('空洞の有無の列がありません（見出し: cavity / 空洞 / 結果 など）。')
  if (ci < 0 && (cla < 0 || clo < 0)) return fail('区間ID の列（segment_id / 区間ID）か、緯度・経度の列（lat,lon / 緯度,経度）が必要です。')
  const byId = new Map(segs.map((s) => [s.id, s]))
  const sm: OutcomeSummary = { ...EMPTY }
  const seen = new Map<string, Set<boolean>>()
  for (const r of rows.slice(1)) {
    sm.rows++
    // 空洞の列が空欄の行は「未記入」として読み飛ばす（書き出した CSV に一部だけ記入して戻す使い方のため）
    if (squash(r[cr]) === '') { sm.blank++; continue }
    const v = parseCavity(r[cr])
    if (v === null) { sm.invalid++; continue }
    let id: string | null = null
    const rawId = ci >= 0 ? (r[ci] || '').trim() : ''
    if (rawId) {
      const s = byId.get(rawId)
      if (!s) { sm.unknownId++; continue }
      id = s.id
      sm.byId++
    } else if (cla >= 0 && clo >= 0) {
      const sLat = (r[cla] || '').trim(), sLon = (r[clo] || '').trim()
      const lat = Number(sLat), lon = Number(sLon)
      if (sLat === '' || sLon === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) { sm.invalid++; continue }
      const n = nearestSegment(lon, lat, segs, maxM)
      if (!n) { sm.unmatched++; continue }
      id = n.seg.id
      sm.byPoint++
    } else { sm.invalid++; continue }
    if (!seen.has(id)) seen.set(id, new Set())
    else sm.merged++
    ;(seen.get(id) as Set<boolean>).add(v)
  }
  const results = new Map<string, boolean>()
  for (const [id, set] of seen) {
    if (set.size > 1) sm.conflicts++
    results.set(id, set.has(true))
  }
  sm.segments = results.size
  sm.hit = [...results.values()].filter(Boolean).length
  sm.none = sm.segments - sm.hit
  return { error: null, results, summary: sm }
}

/** 選んだ区間の「まとまり」の数。端点どうしが gapM 以内の区間を同じまとまりとする（現場で続けて走れる塊の目安。gapM は画面に明示する仮の値） */
export const CLUSTER_GAP_M = 150
export function clusterCount(segs: Pick<Segment, 'id' | 'coords'>[], ids: Set<string>, gapM = CLUSTER_GAP_M): number {
  const sel = segs.filter((s) => ids.has(s.id))
  const par = sel.map((_, i) => i)
  const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])))
  const near = (a: Pick<Segment, 'coords'>, b: Pick<Segment, 'coords'>) => a.coords.some((p) => b.coords.some((q) => {
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180)
    return Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * 110540) <= gapM
  }))
  for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) if (near(sel[i], sel[j])) par[find(i)] = find(j)
  return new Set(sel.map((_, i) => find(i))).size
}
