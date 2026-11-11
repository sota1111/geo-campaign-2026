// 生活アクセス診断マップ: 画面に依存しない純粋関数。
// 元アプリ contests/odpt-2026/app/web/lib.js の計算ロジックの TypeScript 移植（挙動は同一）。

export type Day = 'wd' | 'hol'
export type Period = 'm' | 'd' | 'e'
export type Status = 'walk' | 'transit' | 'rail' | 'none'

/** [code, 人口, 65歳以上人口, 公共交通の水準文字列, 徒歩の水準文字列, 鉄道駅が近いか(0|1)] */
export type Cell = [string, number, number, string, string, number]
/** [m, d, e, 1日の本数, 初発, 終発] */
export type NodeStat = number[]
/** [lon, lat, 名前, 平日, 休日, 路線index[]] */
export type StopNode = [number, number, string, NodeStat, NodeStat, number[]]
/** [路線名, 路線の補足, 事業者, ...] */
export type Route = [string, string, string, ...number[]]

export interface Feed {
  org: string
  name: string
  license: string
  license_url?: string
  updated: string
  valid: [string | null, string | null]
  ref: { wd: string; hol: string }
  url: string
  id: string
  source: string
  credit: string
  modes: string[]
  expired?: boolean
  ends_before_public_end?: boolean
}

export interface RegionData {
  id: string
  name: string
  reason: string
  bbox: [number, number, number, number]
  center: [number, number]
  facility_order: string[]
  facility_labels: Record<string, string>
  params: {
    thresholds: number[]
    start_hours: Record<Period, number>
    walk_in_m: number
    walk_out_m: number
    rail_walk_min: number
    diag_radius_m: number
    walk_m_per_min: number
    detour: number
  }
  built: string
  public_until: string
  coverage: { feeds: number; sources: string[]; modes: string[]; rail_checked?: boolean }
  rail: [number, number, string, string][]
  feeds: Feed[]
  nodes: StopNode[]
  routes: Route[]
  /** [路線index, 停留所index[]] */
  patterns: [number, number[]][]
  facilities: Record<string, [number, number, string][]>
  cells: Cell[]
}

export interface RegionIndexItem {
  id: string
  name: string
  center: [number, number]
  bbox: [number, number, number, number]
  population: number
  operators: string[]
  built: string
}
export interface RegionIndex { regions: RegionIndexItem[]; built: string }

export const DAYS: Day[] = ['wd', 'hol']
export const PERIODS: Period[] = ['m', 'd', 'e']
export const DAY_LABEL: Record<Day, string> = { wd: '平日', hol: '休日' }
export const PERIOD_LABEL: Record<Period, string> = { m: '朝', d: '昼', e: '夕' }
/** 休日は日曜のダイヤで計算している（基準日が日曜）。文章中ではこちらを使う */
export const DAY_FULL: Record<Day, string> = { wd: '平日', hol: '休日（日曜ダイヤ）' }

/** 500m メッシュコード(9桁) -> [lonMin, latMin, lonMax, latMax] */
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

/** 診断文字列の位置: 施設(fi) × 日種(wd,hol) × 時間帯(m,d,e) */
export function condIndex(fi: number, day: Day, per: Period): number {
  return fi * 6 + DAYS.indexOf(day) * 3 + PERIODS.indexOf(per)
}

/** しきい値 W(分) -> 必要な水準（thresholds は昇順。W が小さいほど高い水準が必要） */
export function needLevel(thresholds: number[], w: number): number {
  const k = thresholds.indexOf(w)
  if (k < 0) throw new Error('unknown threshold ' + w)
  return thresholds.length - k
}

/** 'walk' 歩いて着く | 'transit' 公共交通で着く | 'rail' 着けないが未収録の鉄道駅が近い | 'none' 着けない */
export function cellStatus(cell: Cell, fi: number, day: Day, per: Period, need: number): Status {
  if (+String(cell[4]).charAt(fi) >= need) return 'walk'
  const lv = +cell[3][condIndex(fi, day, per)]
  if (lv >= need) return 'transit'
  return cell[5] ? 'rail' : 'none'
}

export function reachable(st: Status): boolean {
  return st === 'walk' || st === 'transit'
}

export interface Summary {
  pop: number; walk: number; transit: number; rail: number; none: number
  pop65: number; walk65: number; transit65: number; rail65: number; none65: number
}

export function summarize(cells: Cell[], fi: number, day: Day, per: Period, need: number): Summary {
  const out: Summary = { pop: 0, walk: 0, transit: 0, rail: 0, none: 0, pop65: 0, walk65: 0, transit65: 0, rail65: 0, none65: 0 }
  for (const c of cells) {
    const st = cellStatus(c, fi, day, per, need)
    out.pop += c[1]
    out[st] += c[1]
    out.pop65 += c[2]
    out[`${st}65` as 'walk65' | 'transit65' | 'rail65' | 'none65'] += c[2]
  }
  return out
}

export interface Lost { lost: number; lost65: number; idx: Record<number, 1> }

/** 路線を止めた場合の差分。「行けていたのに行けなくなる」人口を数える */
export function lostPopulation(cells: Cell[], diffs: [number, string][], fi: number, day: Day, per: Period, need: number): Lost {
  const out: Lost = { lost: 0, lost65: 0, idx: {} }
  for (const [k, lv] of diffs) {
    const c = cells[k]
    const after: Cell = [c[0], c[1], c[2], lv, c[4], c[5]]
    const was = reachable(cellStatus(c, fi, day, per, need))
    const now = reachable(cellStatus(after, fi, day, per, need))
    if (was && !now) {
      out.lost += c[1]
      out.lost65 += c[2]
      out.idx[k] = 1
    }
  }
  return out
}

export function pct(a: number, b: number): number {
  return b > 0 ? Math.round((1000 * a) / b) / 10 : 0
}

export function levelLabel(level: number, thresholds: number[]): string {
  if (!level) return '×'
  return thresholds[thresholds.length - level] + '分以内'
}

/** 分(0起点・24時超可) -> 'H:MM'。1440以上は「翌」を付ける */
export function fmtMin(m: number | null | undefined): string {
  if (m == null || m < 0) return '—'
  const next = m >= 1440
  const mm = m % 1440
  const h = Math.floor(mm / 60), mi = mm % 60
  return (next ? '翌' : '') + h + ':' + (mi < 10 ? '0' : '') + mi
}

export function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = 111320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)
  return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574)
}

export interface Near { i: number; d: number }

/** 半径内の停留所を距離順に返す */
export function nearbyNodes(nodes: StopNode[], lon: number, lat: number, radius: number, limit?: number): Near[] {
  const out: Near[] = []
  for (let i = 0; i < nodes.length; i++) {
    const d = distM(lon, lat, nodes[i][0], nodes[i][1])
    if (d <= radius) out.push({ i, d })
  }
  out.sort((a, b) => a.d - b.d)
  return limit ? out.slice(0, limit) : out
}

export function indexCells(cells: Cell[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (let i = 0; i < cells.length; i++) m[cells[i][0]] = i
  return m
}

/** 緯度経度 -> 500mメッシュコード(9桁) */
export function meshCodeAt(lon: number, lat: number): string {
  const p = Math.floor(lat * 1.5)
  const a = lat * 1.5 - p
  const r = Math.floor(a * 8)
  const a2 = a * 8 - r
  const t = Math.floor(a2 * 10)
  const a3 = a2 * 10 - t
  const q = Math.floor(lon) - 100
  const b = lon - Math.floor(lon)
  const s = Math.floor(b * 8)
  const b2 = b * 8 - s
  const u = Math.floor(b2 * 10)
  const b3 = b2 * 10 - u
  const m = (a3 >= 0.5 ? 2 : 0) + (b3 >= 0.5 ? 2 : 1)
  return ('0' + p).slice(-2) + ('0' + q).slice(-2) + r + s + t + u + m
}

/** 停留所の自動コメント（事実のみ） */
export function nodeFacts(node: StopNode): string[] {
  const wd = node[3], hol = node[4]
  const facts: string[] = []
  if (wd[3] === 0 && hol[3] === 0) return ['この停留所群から発車する便は基準日にありません']
  if (wd[3] > 0) facts.push('平日は1日' + wd[3] + '本、終発は' + fmtMin(wd[5]))
  else facts.push('平日の運行はありません')
  if (hol[3] > 0) {
    const ratio = wd[3] > 0 ? '（平日の本数の' + Math.round((100 * hol[3]) / wd[3]) + '%）' : ''
    facts.push('休日は1日' + hol[3] + '本' + ratio + '、終発は' + fmtMin(hol[5]))
  } else facts.push('休日の運行はありません')
  return facts
}

const WORD: Record<Status, string> = {
  walk: '行けます（歩いて着ける距離。バスに乗らなくても可）',
  transit: '行けます（公共交通で）',
  rail: '行けません（収録した範囲では）',
  none: '行けません',
}

export interface VerdictOpts {
  fi: number; day: Day; per: Period; w: number
  thresholds: number[]
  startHours: Record<Period, number>
  facLabel: string
}
export interface Verdict {
  status: Status; ok: boolean; otherStatus: Status; otherOk: boolean
  main: string; cmp: string; extra: string; short: string
  /** 「行けます（徒歩）」など短い結論 */
  yesNo: string; otherYesNo: string
  otherDay: Day
}

export function verdict(cell: Cell | null, o: VerdictOpts): Verdict | null {
  if (!cell) return null
  const need = needLevel(o.thresholds, o.w)
  const st = cellStatus(cell, o.fi, o.day, o.per, need)
  const other: Day = o.day === 'wd' ? 'hol' : 'wd'
  const st2 = cellStatus(cell, o.fi, other, o.per, need)
  const hr = o.startHours[o.per]
  const cond = DAY_FULL[o.day] + PERIOD_LABEL[o.per] + hr + '時'
  const main = 'この地点から' + cond + 'に出発すると、' + o.facLabel + 'へ' + o.w + '分以内に ' + WORD[st]
  const ocond = DAY_FULL[other] + 'の' + PERIOD_LABEL[o.per] + hr + '時発'
  const cmp = st === st2 ? ocond + 'も同じ結果です。' : ocond + 'は ' + WORD[st2] + '。'
  const extra = st === 'rail' ? '近くに未収録の鉄道駅があり、鉄道を使えば行ける可能性があります（本アプリは未評価）。' : ''
  const short = DAY_LABEL[o.day] + PERIOD_LABEL[o.per] + hr + '時発・' + o.w + '分以内: ' + o.facLabel + 'へ ' + WORD[st]
  const yn = (s: Status) => (s === 'walk' ? '行けます（徒歩）' : s === 'transit' ? '行けます（公共交通）' : '行けません')
  return {
    status: st, ok: reachable(st), otherStatus: st2, otherOk: reachable(st2), main, cmp, extra, short,
    yesNo: yn(st), otherYesNo: yn(st2), otherDay: other,
  }
}

/** 同名の停留所が近傍に複数あるとき、路線名で区別した表示名を返す */
export function stopLabels(nodes: StopNode[], near: Near[], routes: Route[]): string[] {
  const count: Record<string, number> = {}
  near.forEach((o) => { const n = nodes[o.i][2] || '(名称なし)'; count[n] = (count[n] || 0) + 1 })
  return near.map((o) => {
    const n = nodes[o.i]
    const name = n[2] || '(名称なし)'
    if (count[name] < 2) return name
    const rs = n[5].slice(0, 2).map((r) => routes[r][0])
    return name + '（' + (rs.length ? rs.join('・') + (n[5].length > 2 ? ' ほか' : '') + '方面' : '約' + Math.round(o.d) + 'm') + '）'
  })
}

export interface Last { t: number; name: string; m: number }

/** 近くの停留所のうち、その日いちばん遅い最終便。運行がなければ null */
export function lastService(nodes: StopNode[], near: Near[], day: Day): Last | null {
  const k = day === 'wd' ? 3 : 4
  let best: Last | null = null
  for (const o of near) {
    const n = nodes[o.i]
    const t = n[k][5]
    if (n[k][3] > 0 && t != null && (best == null || t > best.t)) best = { t, name: n[2] || '(名称なし)', m: Math.round(o.d) }
  }
  return best
}

// ---------- 共有リンク（ハッシュのクエリ） ----------
export interface ShareState {
  region: string; fi: number; day: Day; per: Period; w: number
  route?: string | null
  pt?: [number, number] | null
}

/** 状態 -> クエリ文字列（先頭に ? を付けない） */
export function writeQuery(s: ShareState): string {
  const p = ['region=' + s.region, 'f=' + s.fi, 'd=' + s.day, 'p=' + s.per, 'w=' + s.w]
  if (s.route != null && s.route !== '') p.push('r=' + s.route)
  if (s.pt) p.push('pt=' + (+s.pt[0]).toFixed(5) + ',' + (+s.pt[1]).toFixed(5))
  return p.join('&')
}

export interface ParsedQuery {
  region?: string; fi?: number; day?: Day; per?: Period; w?: number; route?: string; pt?: [number, number]
}

/** 読めた項目だけを返す（不正な値は捨てる） */
export function parseQuery(q: string): ParsedQuery {
  const out: ParsedQuery = {}
  String(q || '').replace(/^[#?]/, '').split('&').forEach((kv) => {
    const i = kv.indexOf('=')
    if (i < 0) return
    const k = kv.slice(0, i), v = kv.slice(i + 1)
    if (k === 'region' && /^[a-z0-9_-]{1,40}$/.test(v)) out.region = v
    else if (k === 'f' && /^\d{1,2}$/.test(v)) out.fi = +v
    else if (k === 'd' && (DAYS as string[]).includes(v)) out.day = v as Day
    else if (k === 'p' && (PERIODS as string[]).includes(v)) out.per = v as Period
    else if (k === 'w' && /^\d{1,3}$/.test(v)) out.w = +v
    else if (k === 'r' && /^\d{1,5}$/.test(v)) out.route = v
    else if (k === 'pt') {
      const m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,2}(?:\.\d+)?)$/.exec(v)
      if (m && +m[1] >= 120 && +m[1] <= 155 && +m[2] >= 20 && +m[2] <= 46) out.pt = [+m[1], +m[2]]
    }
  })
  return out
}

// ---------- 地名検索（国土地理院 AddressSearch の応答） ----------
export interface GsiHit { lon: number; lat: number; title: string }

export function parseGsi(json: unknown): GsiHit[] {
  if (!Array.isArray(json)) return []
  const out: GsiHit[] = []
  for (const f of json as { geometry?: { coordinates?: number[] }; properties?: { title?: string } }[]) {
    const c = f?.geometry?.coordinates
    if (!c || !isFinite(c[0]) || !isFinite(c[1])) continue
    out.push({ lon: +c[0], lat: +c[1], title: String(f.properties?.title ?? '') })
  }
  return out
}

/** 点を含む bbox の地域id（複数なら面積が小さい方）。無ければ null */
export function regionForPoint(regions: { id: string; bbox: number[] }[], lon: number, lat: number): string | null {
  let best: string | null = null, bestA = Infinity
  for (const r of regions) {
    const b = r.bbox
    if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) {
      const a = (b[2] - b[0]) * (b[3] - b[1])
      if (a < bestA) { best = r.id; bestA = a }
    }
  }
  return best
}

/** 「東京都区部（都営バス…）」-> 「東京都区部」 */
export function shortName(name: string): string { return String(name).replace(/（.*$/, '') }

// ---------- 地域比較 ----------
export interface CompareRow {
  id: string; name: string; pop: number; pop65: number; okPct: number
  none: number; nonePct: number; none65: number; none65Pct: number
}

export function compareRow(d: RegionData, facKey: string, day: Day, per: Period, w: number): CompareRow | null {
  const fi = d.facility_order.indexOf(facKey)
  if (fi < 0 || d.params.thresholds.indexOf(w) < 0) return null
  const s = summarize(d.cells, fi, day, per, needLevel(d.params.thresholds, w))
  return {
    id: d.id, name: d.name, pop: s.pop, pop65: s.pop65, okPct: pct(s.walk + s.transit, s.pop),
    none: s.none, nonePct: pct(s.none, s.pop), none65: s.none65, none65Pct: pct(s.none65, s.pop65),
  }
}

// ---------- 出典の例文 ----------
export function citationText(d: RegionData, o: { url: string; date: string }): string {
  const seen: Record<string, number> = {}
  const parts: string[] = []
  d.feeds.forEach((f) => {
    const k = f.org + '|' + f.license
    if (seen[k]) return
    seen[k] = 1
    parts.push(f.org + '（' + f.license + (f.credit ? '、' + f.credit : '') + '）')
  })
  const srcs = (d.coverage?.sources ?? []).join('・')
  return '出典: 生活アクセス診断マップ（' + o.url + '、' + d.name + '、最終閲覧 ' + o.date + '）。' +
    '公共交通の時刻表は' + srcs + 'で公開されている次のGTFSデータを加工して利用: ' + parts.join('、') + '。' +
    '人口は令和2年国勢調査地域メッシュ統計（政府統計の総合窓口 e-Stat）、施設は国土数値情報（医療機関データ・学校データ、国土交通省）、' +
    '鉄道駅は国土数値情報（鉄道データ）、地図は地理院タイル、地名検索は国土地理院の地名検索APIを使用し、いずれも加工して作成。' +
    '診断は収録した事業者のデータだけに基づく（未収録の鉄道・デマンド交通・代替交通は考慮しない）。'
}

/** 停留所名の部分一致（地名検索に接続できない時の代替。データ内の停留所のみ） */
export function searchStops(nodes: StopNode[], q: string, limit = 5): { i: number; name: string }[] {
  const s = q.trim()
  if (!s) return []
  const seen = new Set<string>()
  const out: { i: number; name: string }[] = []
  nodes.forEach((n, i) => {
    if (n[2] && n[2].includes(s) && !seen.has(n[2]) && out.length < limit) { seen.add(n[2]); out.push({ i, name: n[2] }) }
  })
  return out
}

/** 地名検索の並べ替え用。0=名前が完全一致、1=前方一致、2=それ以外（「富山駅」で南富山駅より先に富山駅を出す） */
export function matchRank(title: string, q: string): number {
  const t = title.trim(), s = q.trim()
  if (!s) return 2
  if (t === s) return 0
  return t.startsWith(s) ? 1 : 2
}

export interface AltResult { per: Period; status: Status; ok: boolean }
export interface Alternatives {
  /** 同じ曜日で、ほかの時間帯 */
  periods: AltResult[]
  /** いまの許容時間より長い許容時間のうち、最初に行けるようになるもの（無ければ null） */
  longerW: { w: number; status: Status } | null
}

/** 「行けません」のときの次の一歩に使う、画面にある事実だけ（ほかの時間帯・許容時間を延ばした場合の結果） */
export function altConditions(cell: Cell, o: { fi: number; day: Day; per: Period; w: number; thresholds: number[] }): Alternatives {
  const need = needLevel(o.thresholds, o.w)
  const periods = PERIODS.filter((p) => p !== o.per).map((per) => {
    const status = cellStatus(cell, o.fi, o.day, per, need)
    return { per, status, ok: reachable(status) }
  })
  let longerW: Alternatives['longerW'] = null
  for (const w of o.thresholds.filter((x) => x > o.w)) {
    const status = cellStatus(cell, o.fi, o.day, o.per, needLevel(o.thresholds, w))
    if (reachable(status)) { longerW = { w, status }; break }
  }
  return { periods, longerW }
}
