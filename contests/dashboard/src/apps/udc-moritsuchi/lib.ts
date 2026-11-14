/* みんなの盛土ウォッチ: 地図に依存しない純粋なロジック。
 * 元アプリ contests/udc-2026/app/moritsuchi-watch/lib.js の移植（挙動は同じ）。 */

export const KINDS = [
  { id: 'crack', label: '亀裂・段差' },
  { id: 'water', label: '湧水・水の濁り' },
  { id: 'wall', label: '擁壁・のり面のふくらみ／変形' },
  { id: 'haul', label: '土砂・資材の搬入や新しい盛り上がり' },
  { id: 'slide', label: '崩れ・落石' },
  // ダッシュボード版で追加: 昔の写真との見比べで気づいた違い（現地で亀裂等を見たわけではない記録を、現地の異常と取り違えないため）
  { id: 'photo', label: '写真で見た違い（現地は未確認）' },
  { id: 'other', label: 'その他' },
] as const

export const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.id, k.label]))

/** 対象2市のデータが収まる範囲（熱海市・伊東市。余白つき） */
export const COVERAGE = { west: 138.99, south: 34.88, east: 139.18, north: 35.17 }

/** 熱海駅の目安の位置（案内用。盛土データではない） */
export const ATAMI_STATION = { lng: 139.0777, lat: 35.1039 }

export type Pt = [number, number]

export interface FillProps {
  id: string
  city: string
  kind: string
}
export interface FillFeature {
  type: 'Feature'
  properties: FillProps
  geometry: { type: 'Polygon'; coordinates: Pt[][] }
}

export interface NearFill {
  id: string
  kind: string
  city: string
  inside: boolean
  distM: number
}

export interface MwRecord {
  id: string
  lng: number
  lat: number
  kind: string
  memo: string
  observedAt: string
  blurred: boolean
  nearFill: NearFill | null
  outOfCoverage: boolean
}

export function inCoverage(lng: number, lat: number) {
  return lng >= COVERAGE.west && lng <= COVERAGE.east && lat >= COVERAGE.south && lat <= COVERAGE.north
}

export function haversine(lng1: number, lat1: number, lng2: number, lat2: number) {
  const R = 6371008.8
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function pointInRing(lng: number, lat: number, ring: Pt[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** 点と線分の距離（m）。局所の平面近似（数km以内で十分） */
export function distToSegment(lng: number, lat: number, a: Pt, b: Pt) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110574
  const ax = (a[0] - lng) * kx
  const ay = (a[1] - lat) * ky
  const bx = (b[0] - lng) * kx
  const by = (b[1] - lat) * ky
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / len2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

function fillDistance(lng: number, lat: number, f: FillFeature) {
  const ring = f.geometry.coordinates[0]
  if (pointInRing(lng, lat, ring)) return { inside: true, distM: 0 }
  let d = Infinity
  for (let i = 0; i < ring.length - 1; i++) d = Math.min(d, distToSegment(lng, lat, ring[i], ring[i + 1]))
  return { inside: false, distM: d }
}

function toNear(f: FillFeature, d: { inside: boolean; distM: number }): NearFill {
  return { id: f.properties.id, kind: f.properties.kind, city: f.properties.city, ...d }
}

/** 最も近い大規模盛土造成地。inside=true なら範囲内（distM=0） */
export function nearestFill(lng: number, lat: number, features: FillFeature[]): NearFill | null {
  let best: NearFill | null = null
  for (const f of features) {
    const d = fillDistance(lng, lat, f)
    if (!best || d.distM < best.distM) best = toNear(f, d)
  }
  return best
}

/** 地点に近い順の盛土造成地（案内用）。city を渡すとその市だけ */
export function nearbyFills(lng: number, lat: number, features: FillFeature[], limit = 5, city?: string): NearFill[] {
  return features
    .filter((f) => !city || f.properties.city === city)
    .map((f) => toNear(f, fillDistance(lng, lat, f)))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, limit)
}

/** 盛土造成地の中心（頂点の平均。地図の移動先用） */
export function fillCenter(f: FillFeature): Pt {
  const ring = f.geometry.coordinates[0].slice(0, -1)
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

/** 位置のぼかし: 小数3桁（約100m）に丸める */
export function blur(v: number) {
  return Math.round(v * 1000) / 1000
}

const pad = (n: number) => (n < 10 ? '0' : '') + n
export function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function makeRecord(o: {
  id: string
  lng: number
  lat: number
  kind?: string
  memo?: string
  observedAt: string
  blurred?: boolean
  nearFill?: NearFill | null
}): MwRecord {
  const blurred = !!o.blurred
  const lng = blurred ? blur(o.lng) : Math.round(o.lng * 1e5) / 1e5
  const lat = blurred ? blur(o.lat) : Math.round(o.lat * 1e5) / 1e5
  return {
    id: o.id,
    lng,
    lat,
    kind: o.kind && KIND_LABEL[o.kind] ? o.kind : 'other',
    memo: String(o.memo || '').slice(0, 500),
    observedAt: o.observedAt,
    blurred,
    nearFill: o.nearFill || null,
    outOfCoverage: !inCoverage(lng, lat),
  }
}

export function toGeoJSON(records: MwRecord[]) {
  return {
    type: 'FeatureCollection' as const,
    name: 'moritsuchi-watch-records',
    features: records.map((r) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [r.lng, r.lat] },
      properties: {
        id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], memo: r.memo, observedAt: r.observedAt,
        blurred: r.blurred, nearFill: r.nearFill, outOfCoverage: r.outOfCoverage,
      } as Record<string, unknown>,
    })),
  }
}

function csvCell(v: unknown) {
  let s = v === null || v === undefined ? '' : String(v)
  // CSVインジェクション対策: 式として解釈され得る先頭文字を無効化
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

export function toCSV(records: MwRecord[]) {
  const head = ['id', 'observedAt', 'kindLabel', 'lat', 'lng', 'blurred', 'nearFill', 'nearFillDistM', 'memo']
  const rows = [head.map(csvCell).join(',')]
  for (const r of records) {
    const nf = r.nearFill
    rows.push(
      [r.id, r.observedAt, KIND_LABEL[r.kind], r.lat, r.lng, r.blurred ? 'yes' : 'no', nf ? nf.id : '', nf ? Math.round(nf.distM) : '', r.memo]
        .map(csvCell)
        .join(','),
    )
  }
  return '﻿' + rows.join('\r\n') + '\r\n'
}

/** GeoJSON から記録を取り込む。不正なものは捨てる */
export function fromGeoJSON(obj: unknown): { records: MwRecord[]; skipped: number } {
  const out: MwRecord[] = []
  let skipped = 0
  const o = obj as { type?: string; features?: unknown[] } | null
  const feats = o && o.type === 'FeatureCollection' && Array.isArray(o.features) ? o.features : []
  for (const raw of feats) {
    try {
      const f = raw as { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, any> }
      const c = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null
      if (!c || typeof c[0] !== 'number' || typeof c[1] !== 'number' || !isFinite(c[0]) || !isFinite(c[1]) ||
        Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) {
        skipped++
        continue
      }
      const p = f.properties || {}
      const nf: NearFill | null =
        p.nearFill && typeof p.nearFill.id === 'string' && isFinite(p.nearFill.distM)
          ? {
              id: p.nearFill.id.slice(0, 40),
              kind: String(p.nearFill.kind || '').slice(0, 20),
              city: String(p.nearFill.city || '').slice(0, 20),
              inside: !!p.nearFill.inside,
              distM: +p.nearFill.distM,
            }
          : null
      out.push(
        makeRecord({
          id: String(p.id || 'imp-' + out.length).slice(0, 60),
          lng: c[0], lat: c[1], kind: p.kind, memo: p.memo,
          observedAt: String(p.observedAt || '').slice(0, 32), blurred: !!p.blurred, nearFill: nf,
        }),
      )
    } catch {
      skipped++
    }
  }
  return { records: out, skipped }
}

/** 保存済みデータ（localStorage）を安全に記録配列へ */
export function sanitizeRecords(v: unknown): MwRecord[] {
  return Array.isArray(v) ? fromGeoJSON(toGeoJSON(v as MwRecord[])).records : []
}

export function distText(nf: NearFill | null) {
  if (!nf) return '近くに登録された大規模盛土造成地データはありません'
  if (nf.inside) return `大規模盛土造成地「${nf.id}」（${nf.kind}）の範囲内`
  const m = nf.distM < 100 ? Math.round(nf.distM / 10) * 10 : Math.round(nf.distM / 50) * 50
  return `大規模盛土造成地「${nf.id}」（${nf.kind}）から約${m}m`
}

export function kindDescription(kind: string) {
  return kind === '谷埋め型'
    ? '谷や沢を埋めた盛土造成地（概ねの範囲）'
    : kind === '腹付け型'
      ? '傾斜地盤の上に盛土した造成地（概ねの範囲）'
      : '区分は整備されていません'
}

/** 「近く」とみなす距離（m）。案内表示用の目安であり、安全性の基準ではない */
export const NEAR_M = 500

/** 通報文の一文: この地点から NEAR_M 以内に登録された造成地があるか */
export function nearLine(r: MwRecord) {
  const head = `この地点から${NEAR_M}m以内に登録された大規模盛土造成地: `
  if (r.outOfCoverage) return head + '判定できていません（対象範囲外）'
  const nf = r.nearFill
  if (!nf) return head + 'ありません'
  if (nf.inside || nf.distM <= NEAR_M) return head + 'あります（' + distText(nf) + '）'
  return head + 'ありません（最寄りは' + distText(nf).replace(/^大規模盛土造成地/, '') + '）'
}

export interface LedgerSummary {
  total: number
  /** 気づいたことの種類ごとの件数（0件の種類は含めない。KINDS の順） */
  byKind: { id: string; label: string; n: number }[]
  /** 近くの造成地ごとの件数（件数の多い順）。造成地の範囲内か NEAR_M 以内の記録だけ */
  byFill: { id: string; kind: string; n: number }[]
  /** 対象範囲外の記録 */
  outside: number
  /** 近くに登録された造成地がない（NEAR_M より遠い）記録 */
  far: number
}

/** 地域の点検台帳の集計。記録の件数を数えるだけで、危険度の判定はしない */
export function ledgerSummary(records: MwRecord[]): LedgerSummary {
  const byKind = KINDS.map((k) => ({ id: k.id as string, label: k.label as string, n: records.filter((r) => r.kind === k.id).length })).filter((x) => x.n > 0)
  const fills = new Map<string, { id: string; kind: string; n: number }>()
  let outside = 0
  let far = 0
  for (const r of records) {
    if (r.outOfCoverage) { outside++; continue }
    const nf = r.nearFill
    if (nf && (nf.inside || nf.distM <= NEAR_M)) {
      const cur = fills.get(nf.id) ?? { id: nf.id, kind: nf.kind, n: 0 }
      cur.n++
      fills.set(nf.id, cur)
    } else far++
  }
  return { total: records.length, byKind, byFill: [...fills.values()].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)), outside, far }
}

/** 自治体窓口に伝えるための通報文のたたき台。送信はしない（コピーして各窓口へ） */
export function reportText(r: MwRecord) {
  const lines = [
    '【盛土の変化に関する情報提供（たたき台）】',
    '気づいた日時: ' + r.observedAt,
    '場所（緯度,経度）: ' + r.lat + ',' + r.lng + (r.blurred ? '（約100mにぼかした位置。詳しい場所は電話等でお伝えします）' : ''),
    '地図: https://maps.gsi.go.jp/#17/' + r.lat + '/' + r.lng + '/',
    '気づいた内容: ' + KIND_LABEL[r.kind],
    '状況: ' + (r.memo || '（記入なし）'),
    '国の大規模盛土造成地データとの位置関係: ' + distText(r.nearFill),
    nearLine(r),
    '撮影は公道など立ち入ってよい場所から行い、個人が特定される写真は添付しません。',
    '※盛土造成地であること自体は、直ちに危険であることを意味しません。危険かどうかの判定はしていません。',
  ]
  if (r.outOfCoverage) {
    lines.splice(8, 0, '※この位置は本アプリの対象範囲（熱海市・伊東市）の外です。大規模盛土造成地データとの比較はできていません。')
  }
  return lines.join('\n')
}
