// 二段階調査のロジック（純関数）。元アプリ proposal-a/logic.js の TypeScript 移植。
// 数値はすべて架空サンプルデータに対する計算であり、実在の精度・効果を示さない。

export const NOW_YEAR = 2026
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

export interface Segment {
  id: string
  cls: 'life' | 'arterial'
  cell: string
  year: number
  lenM: number
  surveyed: boolean
  sim_cavity: boolean
  coords: [number, number][]
}
export interface Cell {
  id: string
  cx: number
  cy: number
  disp: number
  ring: [number, number][]
}
export interface SampleData {
  note: string
  cells: Cell[]
  segments: Segment[]
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

/** 管の経過年数 → 0〜1（60年で1。画面上の便宜的な正規化で、標準耐用年数50年とは別） */
export const ageNorm = (year: number, now = NOW_YEAR) => clamp01((now - year) / 60)

/** 地表変位（mm/年, 負=沈下）→ 0〜1（-8mm/年以下で1。サンプル上の正規化） */
export const satNorm = (dispMmYr: number) => clamp01(-dispMmYr / 8)

/** 区間の点数。w は衛星指標の重み（0=台帳のみ, 1=衛星のみ） */
export function segScore(seg: Pick<Segment, 'cell' | 'year'>, cellSat: CellSat, w: number) {
  return w * cellSat[seg.cell] + (1 - w) * ageNorm(seg.year)
}

/** 全区間を点数付けして降順に並べる */
export function rank(segs: Segment[], cellSat: CellSat, w: number): Scored[] {
  return segs
    .map((s) => ({ ...s, score: segScore(s, cellSat, w) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
}

/** 未調査の生活道路（候補）だけを取り出す（順位順を保つ） */
export const candidatesOf = (ranked: Scored[]) => ranked.filter((s) => s.cls === 'life' && !s.surveyed)

/** 未調査の生活道路の上位から、予算（km）を超えない範囲で貪欲に選ぶ */
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
