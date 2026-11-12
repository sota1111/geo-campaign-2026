/* 地名の記憶マップ: 画面に依存しない処理（元アプリ contests/ichibiz-2026/app/idea/lib.js の移植） */

export const CERTAINTY = ['定説', '諸説', '不明'] as const
export const VISIBILITY = {
  undecided: '未定（確認後に選ぶ）', public: '公開', local: '地域の関係者のみ', private: '非公開',
} as const

/** 公開分に入っていない理由（空なら公開分に入る）。画面での案内用 */
export function publishBlockers(rec: MemoryRecord): string[] {
  const out: string[] = []
  if (!rec.verified) out.push('未確認')
  if (rec.visibility !== 'public') out.push(`公開範囲が「${VISIBILITY[rec.visibility]}」（公開にする必要があります）`)
  if (rec.license === 'none') out.push('利用条件が「利用不可」')
  if (rec.sample) out.push('サンプル（架空）')
  return out
}
export const LICENSES = {
  'CC BY 4.0': 'CC BY 4.0（出典を示せば利用可）',
  CC0: 'CC0（制限なし）',
  none: '利用不可（記録のみ）',
} as const
export const KINDS = ['洪水', '土砂災害', '地震', '津波', '高潮', '火山', 'その他'] as const

export type Visibility = keyof typeof VISIBILITY

export interface LoreItem {
  id: string; name: string; year: string; address: string; disaster: string
  kind: string; info: string; lon: number; lat: number
}
export interface SamplePlace {
  id: string; name: string; reading?: string; type: string; lon: number; lat: number
  teller: string; heardOn: string; story: string; basis: string
  claimedKinds: string[]; certainty: string
}
export interface NearItem { item: LoreItem; dist: number }
export interface CrossResult {
  level: 'clue' | 'none'; hits: NearItem[]; matchedKinds: string[]; missingKinds: string[]; nearCount: number
}
export interface RecordInput {
  placeName: string; placeType?: string; teller?: string; heardOn?: string; story: string; basis: string
  claimedKinds?: string[]; certainty: string; visibility: string; license: string
  checked?: string[]; lon: number | string | null; lat: number | string | null
  /** 保存時点の伝承碑との突き合わせ結果（理由つきの1文）。手順2を経ていなければ空 */
  crossNote?: string
}
export interface MemoryRecord {
  id: string; placeName: string; placeType: string; teller: string; heardOn: string; story: string
  basis: string; claimedKinds: string[]; certainty: string; visibility: Visibility; license: string
  checked: string[]; lon: number; lat: number; verified: boolean; verifiedBy: string
  verifiedAt?: string; createdAt: string; sample: boolean
  /** 保存時点の伝承碑との突き合わせ結果（理由つき）。確認役が判断する材料 */
  crossNote?: string
}

const rad = (d: number) => (d * Math.PI) / 180

/** 2点間の距離(m)。球面近似（地図上の目安用） */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

/** 「洪水・土砂災害」のような区切り表記を種別の配列にする */
export function kindsOf(str: string | null | undefined): string[] {
  const out: string[] = []
  String(str ?? '').split(/[・,、/]/).forEach((raw) => {
    let s = raw.trim()
    if (s && !(KINDS as readonly string[]).includes(s)) s = 'その他'
    if (s && !out.includes(s)) out.push(s)
  })
  return out
}

/** 地点から半径内の伝承碑を近い順に返す */
export function nearby(items: LoreItem[], lon: number, lat: number, radiusM: number): NearItem[] {
  return items
    .map((item) => ({ item, dist: distanceM(lon, lat, item.lon, item.lat) }))
    .filter((x) => x.dist <= radiusM)
    .sort((a, b) => a.dist - b.dist)
}

/**
 * 突き合わせ。語られている災害の種類と、近くの伝承碑の種類を比べる。
 * 危険度は判定しない。結果は「手がかりあり／公開データでは見つからず」の2通りで、
 * 後者は「その話が誤り」という意味ではない。
 */
export function crossCheck(claimed: string[], near: NearItem[]): CrossResult {
  const claimedKinds = [...(claimed ?? [])]
  const hits: NearItem[] = []
  const matchedKinds: string[] = []
  near.forEach((n) => {
    const m = kindsOf(n.item.kind).filter((k) => claimedKinds.includes(k))
    if (m.length) {
      hits.push(n)
      m.forEach((k) => { if (!matchedKinds.includes(k)) matchedKinds.push(k) })
    }
  })
  return {
    level: hits.length ? 'clue' : 'none',
    hits, matchedKinds,
    missingKinds: claimedKinds.filter((k) => !matchedKinds.includes(k)),
    nearCount: near.length,
  }
}

const trim = (v: unknown) => String(v == null ? '' : v).trim()

/** 聞き取り記録の検証。errors が空なら ok */
export function validateRecord(input: RecordInput): string[] {
  const errors: string[] = []
  if (!trim(input.placeName)) errors.push('地名を入力してください')
  if (!trim(input.story)) errors.push('聞き取った話の内容を入力してください')
  if (!trim(input.basis)) errors.push('話の出典（誰から・どの資料で）を入力してください')
  if (!(CERTAINTY as readonly string[]).includes(input.certainty)) errors.push('確からしさ（定説／諸説／不明）を選んでください')
  if (!(input.visibility in VISIBILITY)) errors.push('公開範囲を選んでください')
  if (!(input.license in LICENSES)) errors.push('利用条件を選んでください')
  const lon = Number(input.lon), lat = Number(input.lat)
  if (!isFinite(lon) || !isFinite(lat) || input.lon === '' || input.lat === '' || input.lon == null || input.lat == null) {
    errors.push('地図で位置を選んでください')
  } else if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    errors.push('位置が範囲外です')
  }
  return errors
}

let seq = 0
/** 記録を作る。新規は必ず「未確認」。確認役の確認は別の操作（setVerified） */
export function createRecord(
  input: RecordInput, nowIso: string,
): { ok: true; record: MemoryRecord } | { ok: false; errors: string[] } {
  const errors = validateRecord(input)
  if (errors.length) return { ok: false, errors }
  seq += 1
  return {
    ok: true,
    record: {
      id: `rec-${String(nowIso).replace(/\D/g, '').slice(0, 14)}-${seq}`,
      placeName: trim(input.placeName),
      placeType: trim(input.placeType) || '旧地名',
      teller: trim(input.teller) || '（匿名）',
      heardOn: trim(input.heardOn),
      story: trim(input.story),
      basis: trim(input.basis),
      claimedKinds: (input.claimedKinds ?? []).filter((k) => (KINDS as readonly string[]).includes(k)),
      certainty: input.certainty,
      visibility: input.visibility as Visibility,
      license: input.license,
      checked: [...(input.checked ?? [])],
      lon: Number(input.lon),
      lat: Number(input.lat),
      verified: false,
      verifiedBy: '',
      createdAt: nowIso,
      sample: false,
      ...(trim(input.crossNote) ? { crossNote: trim(input.crossNote) } : {}),
    },
  }
}

export function setVerified(rec: MemoryRecord, by: string, nowIso: string): MemoryRecord {
  return { ...rec, verified: true, verifiedBy: trim(by) || '（確認役）', verifiedAt: nowIso }
}

/** 公開してよい記録: 確認済み・公開・利用条件あり。サンプル（架空）は常に対象外 */
export function isPublishable(rec: MemoryRecord | null | undefined): boolean {
  return !!rec && rec.verified === true && rec.visibility === 'public' && rec.license !== 'none' && !rec.sample
}

export function toGeoJSON(
  records: MemoryRecord[], opts: { onlyPublishable?: boolean; includePrivate?: boolean; exportedAt?: string } = {},
) {
  const list = opts.onlyPublishable
    ? records.filter(isPublishable)
    : records.filter((r) => r.visibility !== 'private' || opts.includePrivate)
  return {
    type: 'FeatureCollection' as const,
    name: 'chimei-kioku-map',
    properties: {
      note: '地名の記憶マップ（デモ）の書き出し。サンプル（架空）を含む場合は sample=true。危険度の判定は含まない。',
      exportedAt: opts.exportedAt ?? null,
      scope: opts.onlyPublishable ? 'publishable' : 'all-except-private',
    },
    features: list.map((r) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [r.lon, r.lat] },
      properties: {
        id: r.id, placeName: r.placeName, placeType: r.placeType, teller: r.teller, heardOn: r.heardOn,
        story: r.story, basis: r.basis, claimedKinds: r.claimedKinds, certainty: r.certainty,
        visibility: r.visibility, license: r.license, checked: r.checked,
        verified: r.verified, verifiedBy: r.verifiedBy || '', sample: !!r.sample,
        crossCheck: r.crossNote || '',
      },
    })),
  }
}

export function fmtDist(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

/** 半径 rM(m) の円（多角形近似） */
export function circlePoly(lon: number, lat: number, rM: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const pts: [number, number][] = []
  const dLat = rM / 111320, dLon = rM / (111320 * Math.cos(rad(lat)))
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI
    pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }
}

export function gsiLink(lon: number, lat: number, z = 16) {
  return `https://maps.gsi.go.jp/#${z}/${lat}/${lon}/`
}

/* 重ね合わせ（地理院タイル。URL・ズーム範囲は元アプリと同じ） */
export interface Overlay {
  id: string; label: string; ext?: string; minzoom?: number; maxzoom?: number; note: string
}
export const GSI_XYZ = 'https://cyberjapandata.gsi.go.jp/xyz/'
export const OVERLAYS: Overlay[] = [
  { id: 'none', label: 'なし', note: '背景地図だけを表示します。' },
  { id: 'ort_USA10', label: '空中写真 1945〜50年', ext: 'png', minzoom: 10, maxzoom: 17, note: '終戦前後に撮影された空中写真。昔の水路・田・集落の位置を見る手がかりになります。' },
  { id: 'ort_old10', label: '空中写真 1961〜69年', ext: 'png', minzoom: 10, maxzoom: 17, note: '高度成長期の空中写真。宅地になる前の様子を見る手がかりになります。' },
  { id: 'swale', label: '明治期の低湿地', ext: 'png', minzoom: 10, maxzoom: 16, note: '明治期の地形図などから読み取られた低湿地の範囲。重なるかどうかを目で確かめます（範囲は目安です）。' },
  { id: 'lcmfc2', label: '治水地形分類図', ext: 'png', minzoom: 11, maxzoom: 16, note: '河川沿いの地形（旧河道・氾濫原など）を分類した図。凡例は国土地理院の公開ページで確認できます。' },
  { id: 'relief', label: '色別標高図', ext: 'png', minzoom: 5, maxzoom: 15, note: '標高を色で表した図。谷・低地の位置関係を見る手がかりになります。' },
]
/** 語られている災害の種類に応じた、おすすめの重ね地図（OVERLAYS の id と理由）。種類が未選択なら昔の空中写真と低湿地 */
const RECOMMEND: Record<string, string[]> = {
  洪水: ['swale', 'lcmfc2'],
  土砂災害: ['relief', 'ort_USA10'],
  地震: ['relief', 'ort_USA10'],
  津波: ['relief', 'swale'],
  高潮: ['relief', 'swale'],
  火山: ['relief', 'ort_USA10'],
  その他: ['ort_USA10', 'ort_old10'],
}
export function recommendOverlays(kinds: string[]): { id: string; because: string }[] {
  const out: { id: string; because: string }[] = []
  for (const k of kinds) {
    for (const id of RECOMMEND[k] ?? []) {
      if (!out.some((o) => o.id === id)) out.push({ id, because: `${k}の話なら` })
    }
  }
  if (!out.length) return ['ort_USA10', 'swale'].map((id) => ({ id, because: '災害の種類が未選択でも、まず' }))
  return out.slice(0, 4)
}

export const overlayTileUrl = (o: Overlay) => `${GSI_XYZ}${o.id}/{z}/{x}/{y}.${o.ext}`

export const CHECKS = [
  '伝承碑の記載に、この話と重なる点があった',
  '明治期の低湿地に重なっていた',
  '古い空中写真に、話と関係しそうな水路や地形が見えた',
  '治水地形分類図に、話と関係しそうな地形があった',
  '公開データでは手がかりが見つからなかった',
]
