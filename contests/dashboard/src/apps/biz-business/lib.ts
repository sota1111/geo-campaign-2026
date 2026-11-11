/* 見直し案の比較: 画面に依存しない計算。元アプリ contests/ichibiz-2026/app/business/web/lib.js の移植（計算は同一）。 */
export const DAYS = ['wd', 'hol'] as const
export const PERIODS = ['m', 'd', 'e'] as const
export type Day = (typeof DAYS)[number]
export type Period = (typeof PERIODS)[number]
export const DAY_LABEL: Record<Day, string> = { wd: '平日', hol: '休日' }
export const PERIOD_LABEL: Record<Period, string> = { m: '朝', d: '昼', e: '夕' }

/** [code, pop, pop65, levels, walkLevels, rail] */
export type Cell = [string, number, number, string, string, number]
export type RouteRow = [string, string, string, number, number, number]
export type Node = [number, number, string, ...unknown[]]
export interface Feed {
  org: string
  name: string
  license: string
  license_url?: string
  credit?: string
  updated: string
  valid: (string | null)[]
  url: string
  source?: string
  expired?: boolean
  ends_before_public_end?: boolean
  ref: { wd: string; hol: string }
}
export interface RegionData {
  id: string
  name: string
  reason: string
  bbox: [number, number, number, number]
  facility_order: string[]
  facility_labels: Record<string, string>
  params: {
    thresholds: number[]
    start_hours: Record<Period, number>
    walk_in_m: number
    walk_out_m: number
    diag_radius_m: number
    walk_m_per_min: number
    detour: number
  }
  built: string
  feeds: Feed[]
  nodes: Node[]
  routes: RouteRow[]
  patterns: [number, number[]][]
  cells: Cell[]
}
export type WhatIf = { routes: Record<string, [number, string][]> }

export function meshBounds(code: string): [number, number, number, number] {
  const p = +code.slice(0, 2), q = +code.slice(2, 4)
  const r = +code[4], s = +code[5], t = +code[6], u = +code[7]
  let lat = (p * 2) / 3 + r / 12 + t / 120
  let lon = 100 + q + s / 8 + u / 80
  const dlat = 1 / 240, dlon = 1 / 160
  const m = +code[8] - 1
  lat += Math.floor(m / 2) * dlat
  lon += (m % 2) * dlon
  return [lon, lat, lon + dlon, lat + dlat]
}

export function condIndex(fi: number, day: Day, per: Period) {
  return fi * 6 + DAYS.indexOf(day) * 3 + PERIODS.indexOf(per)
}

export function needLevel(thresholds: number[], w: number) {
  const k = thresholds.indexOf(w)
  if (k < 0) throw new Error('unknown threshold ' + w)
  return thresholds.length - k
}

export type Status = 'walk' | 'transit' | 'rail' | 'none'
export function cellStatus(cell: Cell, fi: number, day: Day, per: Period, need: number): Status {
  if (+String(cell[4]).charAt(fi) >= need) return 'walk'
  const lv = +cell[3][condIndex(fi, day, per)]
  if (lv >= need) return 'transit'
  return cell[5] ? 'rail' : 'none'
}
export const reachable = (st: Status) => st === 'walk' || st === 'transit'

/** 1路線を止めたとき「行けていたのに行けなくなる」セル番号 */
export function lostCells(cells: Cell[], diffs: [number, string][], fi: number, day: Day, per: Period, need: number) {
  const out: number[] = []
  for (const [k, lv] of diffs || []) {
    const c = cells[k]
    const after: Cell = [c[0], c[1], c[2], lv, c[4], c[5]]
    if (reachable(cellStatus(c, fi, day, per, need)) && !reachable(cellStatus(after, fi, day, per, need))) out.push(k)
  }
  return out
}

export interface Loss {
  lost: number
  lost65: number
  cells: number[]
  exact: boolean
}
/** 案＝止める路線の集まり。複数路線は単独停止結果のセル和集合（下限） */
export function planLoss(
  cells: Cell[], W: WhatIf, routeIds: number[], fi: number, day: Day, per: Period, need: number,
): Loss {
  const seen = new Set<number>()
  const list: number[] = []
  for (const id of routeIds) {
    for (const k of lostCells(cells, W.routes[String(id)] || [], fi, day, per, need)) {
      if (!seen.has(k)) {
        seen.add(k)
        list.push(k)
      }
    }
  }
  let lost = 0, lost65 = 0
  for (const k of list) {
    lost += cells[k][1]
    lost65 += cells[k][2]
  }
  return { lost, lost65, cells: list, exact: routeIds.length <= 1 }
}

export function distM(lon1: number, lat1: number, lon2: number, lat2: number) {
  const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574)
}

export interface Group {
  name: string
  lost: number
  lost65: number
  meshes: number
  maxDist: number
}
export function groupByNearestStop(cells: Cell[], idx: number[], nodes: Node[]): Group[] {
  const groups: Record<string, Group> = {}
  for (const k of idx) {
    const b = meshBounds(cells[k][0])
    const lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2
    let best = -1, bd = Infinity
    for (let i = 0; i < nodes.length; i++) {
      const d = distM(lon, lat, nodes[i][0], nodes[i][1])
      if (d < bd) {
        bd = d
        best = i
      }
    }
    const name = best >= 0 ? nodes[best][2] : '（停留所なし）'
    const g = groups[name] || (groups[name] = { name, lost: 0, lost65: 0, meshes: 0, maxDist: 0 })
    g.lost += cells[k][1]
    g.lost65 += cells[k][2]
    g.meshes += 1
    g.maxDist = Math.max(g.maxDist, Math.round(bd))
  }
  return Object.values(groups).sort((a, b) => b.lost - a.lost || (a.name < b.name ? -1 : 1))
}

export function baseline(cells: Cell[], fi: number, day: Day, per: Period, need: number) {
  const o = { pop: 0, pop65: 0, reach: 0, reach65: 0 }
  for (const c of cells) {
    o.pop += c[1]
    o.pop65 += c[2]
    if (reachable(cellStatus(c, fi, day, per, need))) {
      o.reach += c[1]
      o.reach65 += c[2]
    }
  }
  return o
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0)

/** CSVの1セル。表計算ソフトの数式として解釈される先頭文字を無効化（元アプリと同じ） */
export function csvCell(v: unknown) {
  let s = String(v == null ? '' : v)
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export function toCsvText(rows: unknown[][]) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export interface Verdict {
  /** 影響が小さい案（losses の添字）。完全に同じなら複数 */
  winners: number[]
  /** 確定か。false=暫定（下限値どうしで大小が決まらない） */
  firm: boolean
}
/**
 * 影響が小さい案の判定（losses は案ごとの「病院へ行けなくなる人」。exact=false は「少なくとも」の下限値）。
 * 第1基準=行けなくなる人、同数ならうち65歳以上。
 * 確定の条件: 勝ち案が確定値（exact）で、相手が確定値なら常に確定、相手が下限値なら相手の下限値が勝ち案より大きいとき確定
 * （相手の実際の人数は下限値以上なので）。勝ち案が下限値、または相手の下限値が同数以下なら、実際の人数は上振れしうるので暫定。
 */
export function pickSmaller(losses: { lost: number; lost65: number; exact: boolean }[]): Verdict {
  if (!losses.length) return { winners: [], firm: true }
  let best = [0]
  for (let i = 1; i < losses.length; i++) {
    const a = losses[i], b = losses[best[0]]
    if (a.lost < b.lost || (a.lost === b.lost && a.lost65 < b.lost65)) best = [i]
    else if (a.lost === b.lost && a.lost65 === b.lost65) best.push(i)
  }
  const firm = best.every((w) => {
    const x = losses[w]
    if (!x.exact) return false
    return losses.every((y, j) => best.includes(j) || y.exact || y.lost > x.lost)
  })
  return { winners: best, firm }
}

/**
 * 総数で影響が小さい案（勝ち案が1つのときのみ）より、65歳以上が少ない案があれば {winner, other}（losses の添字）を返す。
 * 複数あれば65歳以上が最も少ない案。losses は案ごとの「病院へ行けなくなる人」。
 */
export function find65Reversal(
  losses: { lost: number; lost65: number; exact: boolean }[],
): { winner: number; other: number } | null {
  const v = pickSmaller(losses)
  if (losses.length < 2 || v.winners.length !== 1) return null
  const w = v.winners[0]
  let j = -1
  losses.forEach((l, i) => {
    if (i !== w && l.lost65 < losses[w].lost65 && (j < 0 || l.lost65 < losses[j].lost65)) j = i
  })
  return j < 0 ? null : { winner: w, other: j }
}
