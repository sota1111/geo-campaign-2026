/* 相談前の1枚シート: 純粋ロジック（元アプリ web/lib.js の TypeScript 版＋画面用の要約）。DOM・ネットワークには触れない。 */
import { REINFOLIB_ATTRIBUTION, REINFOLIB_CREDIT, REINFOLIB_PROCESSED, REINFOLIB_RESPONSIBILITY, yen, type LibFacts } from './reinfolib.ts'

export type Ring = [number, number][]
export type Poly = Ring[]
export interface Zone { name: string; bcr?: number | null; far?: number | null; polys: Poly[] }
export type Stop = [number, number, string, string?]
export interface AreaData {
  municipality: string
  center: [number, number]
  bbox: [number, number, number, number]
  zones: Zone[]
  bus: Stop[]
  rail: Stop[]
  zones_source: string
  transit_source: string
}

// ---- 地理 ----
export function lonLatToWorld(lon: number, lat: number, z: number) {
  const n = Math.pow(2, z)
  const x = ((lon + 180) / 360) * n
  const s = Math.sin((lat * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n
  return { x, y }
}
export function worldToLonLat(x: number, y: number, z: number) {
  const n = Math.pow(2, z)
  const lon = (x / n) * 360 - 180
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  return { lon, lat }
}
export function tileOf(lon: number, lat: number, z: number) {
  const w = lonLatToWorld(lon, lat, z)
  const tx = Math.floor(w.x), ty = Math.floor(w.y)
  return { z, x: tx, y: ty, px: Math.min(255, Math.floor((w.x - tx) * 256)), py: Math.min(255, Math.floor((w.y - ty) * 256)) }
}
export function haversine(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371008.8, r = Math.PI / 180
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
function inRing(lon: number, lat: number, ring: Ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
export function inPolygon(lon: number, lat: number, rings: Poly) {
  if (!rings.length || !inRing(lon, lat, rings[0])) return false
  for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k])) return false
  return true
}
export function findZone(zones: Zone[], lon: number, lat: number): Zone | null {
  for (const z of zones) for (const poly of z.polys) if (inPolygon(lon, lat, poly)) return z
  return null
}
export function inBBox(bbox: number[], lon: number, lat: number) {
  return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]
}

// ---- 公共交通 ----
export interface Nearest { name: string; dist: number; operator?: string }
export function nearest(list: Stop[], lon: number, lat: number): Nearest | null {
  let best: Nearest | null = null
  for (const s of list) {
    const d = haversine(lon, lat, s[0], s[1])
    if (!best || d < best.dist) best = { name: s[2], dist: d, operator: s[3] }
  }
  return best
}
export interface Transit { radius: number; busNames: number; bus: Nearest | null; rail: Nearest | null }
export function transitAround(data: Pick<AreaData, 'bus' | 'rail'>, lon: number, lat: number, radius: number): Transit {
  const near = new Set<string>()
  for (const s of data.bus) if (haversine(lon, lat, s[0], s[1]) <= radius) near.add(s[2])
  return { radius, busNames: near.size, bus: nearest(data.bus, lon, lat), rail: nearest(data.rail, lon, lat) }
}

// ---- ハザードタイルの画素の読み取り ----
export const FLOOD_LEGEND = [
  { rgb: [247, 245, 169], label: '0.5m未満' },
  { rgb: [255, 216, 192], label: '0.5〜3m' },
  { rgb: [255, 183, 183], label: '3〜5m' },
  { rgb: [255, 145, 145], label: '5〜10m' },
  { rgb: [242, 133, 201], label: '10〜20m' },
  { rgb: [220, 122, 220], label: '20m以上' },
]
export function classifyFlood(rgba: number[] | null | undefined): { inside: boolean; depth?: string | null } {
  if (!rgba || rgba[3] < 40) return { inside: false }
  let best: { d: number; label: string } | null = null
  for (const l of FLOOD_LEGEND) {
    const d = Math.hypot(rgba[0] - l.rgb[0], rgba[1] - l.rgb[1], rgba[2] - l.rgb[2])
    if (!best || d < best.d) best = { d, label: l.label }
  }
  return { inside: true, depth: best && best.d <= 30 ? best.label : null }
}
export function classifyPresence(rgba: number[] | null | undefined) {
  return { inside: !!rgba && rgba[3] >= 40 }
}
export function demElevation(r: number, g: number, b: number): number | null {
  const x = r * 65536 + g * 256 + b
  if (x === 8388608) return null
  return (x < 8388608 ? x : x - 16777216) * 0.01
}

// ---- 事実と1枚シート ----
export type HazStatus = 'inside' | 'outside' | 'error'
export interface Haz { status: HazStatus; depth?: string | null }
export interface Facts {
  /** 「例を見る」で出した例の土地（徳島駅付近の実際の位置の実データ。回答は例の回答＝架空） */
  example?: boolean
  /** 不動産情報ライブラリ由来のデータ（同梱の取得結果があり、この地点に該当した分だけ） */
  lib?: LibFacts | null
  place: string
  inArea: boolean
  zone: Zone | null
  flood: Haz | null
  hightide: Haz | null
  tsunami: Haz | null
  sediment: { kyukeisha?: HazStatus; dosekiryu?: HazStatus; jisuberi?: HazStatus }
  elevation: number | null
  transit: Transit | null
}
export interface Answers { building?: string; landUse?: string; road?: string; registered?: string }

/** 例の土地（徳島駅付近）に添える回答。実在の人の回答ではなく、例として置いたもの（架空） */
export const SAMPLE_ANSWERS: Answers = { building: 'あり', landUse: '不明', road: '不明', registered: '未' }

/** 「約◯m」。50m未満は「50m未満」 */
export function fmtApprox(m: number) {
  return m < 50 ? '50m未満' : '約' + fmtDist(m)
}
export function fmtDist(m: number) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m / 10) * 10 + 'm'
}
/** 「まで〜」に続ける距離の言い方。50m未満は「直線約0m」にせず「すぐ近く（50m未満）」 */
export function fmtNear(m: number) {
  return m < 50 ? 'すぐ近く（50m未満）' : '直線約' + fmtDist(m)
}

export type LibSection = 'division' | 'landPrice' | 'trade'
export interface Item { basis: 'data' | 'library' | 'answer' | 'none'; fact: string; ask: string; who: string }
export interface Exit { key: 'sell' | 'rent' | 'use' | 'release'; label: string; items: Item[] }
export interface Sheet { title: string; place: string; example: boolean; libSections: LibSection[]; exits: Exit[]; missing: string[]; otherItems: string[] }

export function hazardErrors(f: Facts): string[] {
  const out: string[] = []
  if (f.flood?.status === 'error') out.push('洪水')
  if (f.hightide?.status === 'error') out.push('高潮')
  if (f.tsunami?.status === 'error') out.push('津波')
  const s = f.sediment || {}
  if (s.kyukeisha === 'error' || s.dosekiryu === 'error' || s.jisuberi === 'error') out.push('土砂災害')
  return out
}

export function buildSheet(f: Facts, answers?: Answers): Sheet {
  const ans = answers || {}
  const exits: Record<Exit['key'], Item[]> = { sell: [], rent: [], use: [], release: [] }
  const missing: string[] = []

  if (f.zone) {
    const z = f.zone
    const far = z.bcr || z.far ? '（データ上の建ぺい率' + (z.bcr || '—') + '%・容積率' + (z.far || '—') + '%）' : ''
    exits.sell.push({ basis: 'data', fact: '用途地域は「' + z.name + '」' + far + '。', ask: 'この用途地域で建てられる建物と、買い手が使える範囲を市役所・不動産会社に聞く。', who: '市役所・不動産会社' })
    exits.use.push({ basis: 'data', fact: '用途地域は「' + z.name + '」。', ask: '自分で建てる・使う場合に建てられる建物の種類を市役所に聞く。', who: '市役所' })
    exits.rent.push({ basis: 'data', fact: '用途地域は「' + z.name + '」。', ask: '貸して使える用途（駐車場・店舗・住宅など）に制限がないかを市役所・不動産会社に聞く。', who: '市役所・不動産会社' })
  } else if (f.inArea) {
    const m = '用途地域の指定がデータにない（市街化調整区域・都市計画区域外・データが古い、のいずれかの可能性）。'
    exits.sell.push({ basis: 'data', fact: m, ask: '区域区分（市街化調整区域か）と建てられる建物の条件を市役所の都市計画担当に聞く。', who: '市役所' })
    exits.use.push({ basis: 'data', fact: m, ask: '建築や利用に必要な手続きの有無を市役所に聞く。', who: '市役所' })
  } else {
    missing.push('用途地域・区域区分（この地図データは徳島市のみ。範囲外のため出せません）')
  }

  const hz: string[] = []
  if (f.flood?.status === 'inside') hz.push('洪水浸水想定区域（想定最大規模）内' + (f.flood.depth ? '・凡例色の目安は' + f.flood.depth : ''))
  if (f.hightide?.status === 'inside') hz.push('高潮浸水想定区域内')
  if (f.tsunami?.status === 'inside') hz.push('津波浸水想定区域内')
  const sed: string[] = []
  if (f.sediment) {
    if (f.sediment.kyukeisha === 'inside') sed.push('急傾斜地崩壊')
    if (f.sediment.dosekiryu === 'inside') sed.push('土石流')
    if (f.sediment.jisuberi === 'inside') sed.push('地すべり')
  }
  if (sed.length) hz.push('土砂災害警戒区域等（' + sed.join('・') + '）内')
  const errs = hazardErrors(f)
  const allOutside =
    f.flood?.status === 'outside' && f.hightide?.status === 'outside' && f.tsunami?.status === 'outside' &&
    f.sediment.kyukeisha === 'outside' && f.sediment.dosekiryu === 'outside' && f.sediment.jisuberi === 'outside'
  if (hz.length) {
    const t = hz.join('、') + '。'
    exits.rent.push({ basis: 'data', fact: t, ask: '借り手に何を説明すべきかを不動産会社に確かめる。', who: '不動産会社' })
    exits.sell.push({ basis: 'data', fact: t, ask: '買い手への説明事項と、売り出し前に確認すべき点を不動産会社に聞く。', who: '不動産会社' })
    exits.use.push({ basis: 'data', fact: t, ask: '自分で使う・建てる場合の備えと、自治体のハザードマップ上の避難先を市役所の防災担当に聞く。', who: '市役所' })
  } else if (!errs.length && allOutside) {
    exits.rent.push({ basis: 'data', fact: '洪水・高潮・津波・土砂災害の想定区域には、この地点では該当しなかった（国の公開タイルによる）。', ask: '想定区域外でも、自治体のハザードマップで過去の浸水や内水の記録がないかを市役所に聞く。', who: '市役所' })
  }
  if (errs.length) missing.push('災害リスク（' + errs.join('・') + '：通信できず取得できませんでした。ハザードマップポータルで確認）')
  if (f.elevation != null) {
    exits.use.push({ basis: 'data', fact: '地理院の標高タイルで約' + f.elevation.toFixed(1) + 'm（誤差あり。測量ではない）。', ask: '浸水や排水が心配な場合、敷地の高さを現地で確かめる方法を専門家に聞く。', who: '土地家屋調査士・建築士' })
  }

  if (f.transit) {
    const t = f.transit
    const parts: string[] = []
    if (t.bus) parts.push('最寄りのバス停「' + t.bus.name + '」まで' + fmtNear(t.bus.dist) + '（半径' + t.radius + 'm内に' + t.busNames + '停留所名）')
    if (t.rail) parts.push('最寄り駅「' + t.rail.name + '」まで' + fmtNear(t.rail.dist))
    if (parts.length) {
      const far = t.bus && t.bus.dist > t.radius
      exits.rent.push({ basis: 'data', fact: parts.join('。') + '。便数・運行日は含まない。', ask: far ? '歩いて使える停留所が近くにない場合、借り手の足をどう想定するかを不動産会社に聞く。' : '借り手の通勤・通学の足として十分かを不動産会社に聞く。', who: '不動産会社' })
      exits.sell.push({ basis: 'data', fact: parts.join('。') + '。便数・運行日は含まない。', ask: '買い手が車なしで暮らせる場所かを不動産会社に聞く。', who: '不動産会社' })
    }
  }

  // ---- 不動産情報ライブラリ由来（同梱の取得結果があり、この地点に該当した分だけ。無ければ何も足さない） ----
  const libSections: LibSection[] = []
  if (f.lib?.division) {
    libSections.push('division')
    const m = f.lib.division.main
    const fact = '区域区分は「' + m + '」（不動産情報ライブラリ・都市計画決定GISデータ）。'
    if (m.includes('調整')) {
      exits.sell.push({ basis: 'library', fact, ask: '建てられる建物の条件を市役所の都市計画担当に聞く。買い手の想定を不動産会社に聞く。', who: '市役所・不動産会社' })
      exits.use.push({ basis: 'library', fact, ask: '自分で建てる・使う場合に必要な手続きを市役所に聞く。', who: '市役所' })
    } else if (!f.zone) {
      // 用途地域が分かっている時は、用途地域の項目が同じこと（建てられる建物の条件）を聞いているので重ねない
      exits.sell.push({ basis: 'library', fact, ask: '用途地域とあわせて、建てられる建物の条件を市役所の都市計画担当に聞く。', who: '市役所' })
    }
  }
  if (f.lib?.landPrice) {
    libSections.push('landPrice')
    const { point: p, dist, year } = f.lib.landPrice
    exits.sell.push({
      basis: 'library',
      fact: '近くの標準地「' + p.lot + '」（' + (p.kind || '地価公示・地価調査') + (p.use ? '・' + p.use : '') + '・' + fmtApprox(dist) + '・' + (p.year || year + '年') + '）の価格は1平方メートルあたり' + yen(p.price) + '（参考値。この土地の価格ではない）。',
      ask: 'この参考値と、実際の土地への当てはめ方（形・接道などによる違い）を不動産会社に聞く。',
      who: '不動産会社',
    })
  }
  if (f.lib?.trade) {
    libSections.push('trade')
    const { stat, scope, period } = f.lib.trade
    exits.sell.push({
      basis: 'library',
      fact: (scope === 'district' ? '「' + stat.name + '」の' : '徳島市全体の') + '土地の取引（' + period + '・' + stat.n + '件）の1平方メートル単価の中央値は約' + yen(stat.medianUnitPrice) + '（' + (scope === 'district' ? '町名単位' : '町名の集計がないため市全体') + 'の集計。個別の物件の価格ではない）。',
      ask: '相場の見方（立地・形・接道による違い）を不動産会社に聞く。',
      who: '不動産会社',
    })
  }

  if (ans.building === 'あり') {
    exits.release.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。建物がある土地は、相続土地国庫帰属制度の申請ができない。', ask: '解体の要否と費用の見通しを、司法書士・法務局に聞く。', who: '司法書士・法務局' })
    exits.sell.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。', ask: '建物付きで売るか更地にして売るかを不動産会社に聞く。', who: '不動産会社' })
    exits.rent.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。', ask: '貸す前に必要な修繕・安全面の確認を不動産会社に聞く。', who: '不動産会社' })
  } else if (ans.building === 'なし') {
    exits.release.push({ basis: 'answer', fact: '建物はない（あなたの回答）。', ask: '国庫帰属の申請の条件（境界・担保権など、建物以外の却下事由）と負担金を法務局に聞く。', who: '法務局' })
  } else {
    exits.release.push({ basis: 'answer', fact: '建物の有無が未確認。', ask: '建物の有無と、国庫帰属が申請できる土地かどうかを法務局に聞く。', who: '法務局' })
  }
  if (ans.landUse === '農地') {
    exits.sell.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地の売却・貸し出しに必要な手続きを農業委員会に聞く。', who: '農業委員会' })
    exits.rent.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地を貸す場合の手続きを農業委員会に聞く。', who: '農業委員会' })
    exits.use.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地以外の使い方にする場合の手続きを農業委員会に聞く。', who: '農業委員会' })
  }
  if (ans.road === 'なし') {
    exits.sell.push({ basis: 'answer', fact: '道路に接していない・不明確（あなたの回答）。', ask: '建築できる土地か、売却に影響するかを不動産会社・市役所に聞く。', who: '不動産会社・市役所' })
    exits.use.push({ basis: 'answer', fact: '道路に接していない・不明確（あなたの回答）。', ask: '建築できる条件を市役所の建築指導担当に聞く。', who: '市役所' })
  }
  if (ans.registered === '未') {
    exits.sell.push({ basis: 'answer', fact: '相続登記が済んでいない（あなたの回答）。', ask: '売る・貸す・手放すの前に必要な相続登記の進め方を司法書士に聞く。', who: '司法書士' })
    exits.release.push({ basis: 'answer', fact: '相続登記が済んでいない（あなたの回答）。', ask: '国庫帰属の申請の前に必要な登記を司法書士に聞く。', who: '司法書士' })
  }

  missing.push('接道（道路に接しているか）。登記・現地で確認')
  missing.push('地目（農地か宅地か）。登記事項証明書で確認')
  missing.push('建物の状態（傷み・残置物）。現地で確認')
  missing.push('境界が確定しているか。測量・登記で確認')

  const empty = (arr: Item[], text: string): Item[] =>
    arr.length ? arr : [{ basis: 'none', fact: text, ask: '相談先に、この出口で確認すべき点を聞く。', who: '相談先' }]
  return {
    title: f.example ? '例（徳島駅付近）の1枚シート' : '相談前の1枚シート',
    place: f.place,
    example: !!f.example,
    libSections,
    exits: [
      { key: 'sell', label: '売る', items: empty(exits.sell, 'この地点の用途地域データがない。') },
      { key: 'rent', label: '貸す', items: empty(exits.rent, 'この地点の災害・交通データがない。') },
      { key: 'use', label: '活かす', items: empty(exits.use, 'この地点の用途地域データがない。') },
      { key: 'release', label: '手放す', items: exits.release },
    ],
    missing,
    otherItems: [
      ...(libSections.includes('trade') ? [] : ['周辺の取引価格の傾向（地区単位）']),
      ...(libSections.includes('landPrice') ? [] : ['近くの地価公示・地価調査の標準地']),
      ...(libSections.includes('division') ? [] : ['区域区分（市街化調整区域か）']),
      '将来推計人口（250mメッシュ）', '医療機関・小学校区',
    ],
  }
}

// ---- 画面用の「この土地の条件」要約 ----
export type Tone = 'ok' | 'warn' | 'unknown'
export interface SummaryRow { key: string; label: string; value: string; tone: Tone; /** 不動産情報ライブラリ由来の行 */ lib?: boolean }

function hazRow(key: string, label: string, h: Haz | null | undefined): SummaryRow {
  if (!h) return { key, label, value: '未確認', tone: 'unknown' }
  if (h.status === 'error') return { key, label, value: '取得できなかった（通信失敗。ハザードマップポータルで確認）', tone: 'unknown' }
  if (h.status === 'inside') return { key, label, value: '想定区域に入る' + (h.depth ? `（浸水の深さの目安 ${h.depth}）` : ''), tone: 'warn' }
  return { key, label, value: 'この地点では想定区域に入らない', tone: 'ok' }
}

export function summarize(f: Facts): SummaryRow[] {
  const rows: SummaryRow[] = []
  if (f.zone) {
    const z = f.zone
    rows.push({ key: 'zone', label: '用途地域', value: z.name + (z.bcr || z.far ? `（建ぺい率${z.bcr || '—'}%・容積率${z.far || '—'}%）` : ''), tone: 'ok' })
  } else if (f.inArea) rows.push({ key: 'zone', label: '用途地域', value: '指定がデータにない（調整区域・都市計画区域外・データが古い可能性。市役所で確認）', tone: 'unknown' })
  else rows.push({ key: 'zone', label: '用途地域', value: '出せない（地図データは徳島市のみ。範囲外）', tone: 'unknown' })
  rows.push(hazRow('flood', '洪水（想定最大規模）', f.flood))
  rows.push(hazRow('hightide', '高潮', f.hightide))
  rows.push(hazRow('tsunami', '津波', f.tsunami))
  const s = f.sediment || {}
  const sv = [s.kyukeisha, s.dosekiryu, s.jisuberi]
  const names = [s.kyukeisha === 'inside' && '急傾斜地崩壊', s.dosekiryu === 'inside' && '土石流', s.jisuberi === 'inside' && '地すべり'].filter(Boolean)
  if (names.length) rows.push({ key: 'sediment', label: '土砂災害警戒区域', value: '入る（' + names.join('・') + '）', tone: 'warn' })
  else if (sv.some((v) => v === 'error')) rows.push({ key: 'sediment', label: '土砂災害警戒区域', value: '取得できなかった（通信失敗。ハザードマップポータルで確認）', tone: 'unknown' })
  else if (sv.every((v) => v === 'outside')) rows.push({ key: 'sediment', label: '土砂災害警戒区域', value: 'この地点では入らない', tone: 'ok' })
  else rows.push({ key: 'sediment', label: '土砂災害警戒区域', value: '未確認', tone: 'unknown' })
  rows.push(f.elevation != null
    ? { key: 'elev', label: '標高（参考）', value: `約${f.elevation.toFixed(1)}m（地理院の標高タイル。測量ではない）`, tone: 'ok' }
    : { key: 'elev', label: '標高（参考）', value: '取得できなかった・値なし', tone: 'unknown' })
  if (f.transit) {
    const t = f.transit
    rows.push({ key: 'bus', label: '最寄りバス停', value: t.bus ? `${t.bus.name}まで${fmtNear(t.bus.dist)}（便数・運行日は含まない）` : 'データなし', tone: t.bus ? 'ok' : 'unknown' })
    rows.push({ key: 'rail', label: '最寄り駅', value: t.rail ? `${t.rail.name}まで${fmtNear(t.rail.dist)}` : 'データなし', tone: t.rail ? 'ok' : 'unknown' })
  } else {
    rows.push({ key: 'bus', label: '最寄りバス停・駅', value: '出せない（地図データは徳島市のみ。範囲外）', tone: 'unknown' })
  }
  // 不動産情報ライブラリ由来（同梱の取得結果がこの地点に該当した分だけ。無ければ行を出さない）
  const L = f.lib
  if (L?.division) {
    // 「都市計画区域」は市街化区域・市街化調整区域と常に重なるので、それらがある時は併記しない（区分が本当に複数ある時だけ並べる）
    const shown = L.division.classes.length > 1 ? L.division.classes.filter((c) => c !== '都市計画区域') : L.division.classes
    rows.push({ key: 'lib-division', label: '区域区分', value: L.division.main + (shown.length > 1 ? '（データ上の区分: ' + shown.join('・') + '）' : ''), tone: 'ok', lib: true })
  }
  if (L?.landPrice) {
    const { point: p, dist, year } = L.landPrice
    rows.push({ key: 'lib-land', label: '近くの地価（参考）', value: '標準地「' + p.lot + '」（' + (p.kind || '地価公示・地価調査') + (p.use ? '・' + p.use : '') + '、' + (p.year || year + '年') + '、' + fmtApprox(dist) + '）1平方メートルあたり' + yen(p.price) + '。この土地の価格ではない', tone: 'ok', lib: true })
  }
  if (L?.trade) {
    const { stat, scope, period } = L.trade
    rows.push({ key: 'lib-trade', label: '取引価格の傾向', value: (scope === 'district' ? stat.name + '（町名）' : '徳島市全体') + '・土地' + stat.n + '件（' + period + '）の1平方メートル単価の中央値 約' + yen(stat.medianUnitPrice) + '。個別の物件の価格ではない', tone: 'ok', lib: true })
  }
  return rows
}

// ---- 検索結果の選び方 ----
export interface Hit { lon: number; lat: number; title: string }
/** 検索語に「駅」を含む場合は、駅名の候補（title が「〜駅」）→同梱の駅データの順に優先。それ以外は徳島市周辺の候補を優先 */
export function pickSearchHit(q: string, hits: Hit[], data: Pick<AreaData, 'bbox' | 'rail'> | null): Hit | null {
  const inArea = (h: Hit) => !data || inBBox(data.bbox, h.lon, h.lat)
  if (q.includes('駅')) {
    // 1) 同梱の駅データ（鉄道駅の座標＝駅舎の位置）を優先。駅名が完全一致するものだけ
    const key = q.replace(/\s/g, '').replace(/^徳島県|^徳島市/, '').replace(/駅$/, '')
    if (data && key) {
      const r = data.rail.find((s) => s[2] === key)
      if (r) return { lon: r[0], lat: r[1], title: r[2] + '駅' }
    }
    // 2) 駅データにない場合のみ、GSIの結果のうち title が「〜駅」のもの
    const st = hits.filter((h) => h.title.endsWith('駅'))
    const hit = st.find(inArea) || (data ? null : st[0])
    if (hit) return hit
    if (st[0]) return st[0]
  }
  return hits.find(inArea) || hits[0] || null
}

// ---- シート最上部の要約（4出口の内容から機械的に組み立てる。助言はしない） ----
export function buildDigest(f: Facts, sheet: Sheet): string[] {
  const lines: string[] = []
  const rows = summarize(f)
  const strip = (l: string) => l.replace('（想定最大規模）', '').replace('警戒区域', '')
  const warn = rows.filter((r) => r.tone === 'warn').map((r) => strip(r.label))
  const unknown = rows.filter((r) => /取得できなかった（通信失敗/.test(r.value)).map((r) => strip(r.label))
  if (warn.length) lines.push('注意が必要な項目: ' + warn.join('・') + 'の想定区域に入る。')
  else if (!unknown.length && f.flood) lines.push('この地点では、洪水・高潮・津波・土砂災害の想定区域には入らなかった（国の公開タイルによる）。')
  if (unknown.length) lines.push('取得できなかった項目: ' + unknown.join('・') + '（ハザードマップポータルで確認）。')
  const count = new Map<string, number>()
  for (const e of sheet.exits) for (const it of e.items) for (const w of it.who.split('・')) if (w !== '相談先') count.set(w, (count.get(w) ?? 0) + 1)
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w)
  if (top.length) lines.push('まず相談する先の候補（4つの出口で多く出る相手）: ' + top.join('・') + '（くわしくは各出口の項目）。')
  return lines.slice(0, 3)
}

// ---- 用語の説明（シートに出てくる専門語に1行の説明） ----
export const GLOSSARY: { term: string; re: RegExp; text: string }[] = [
  { term: '相続土地国庫帰属制度（国庫帰属）', re: /国庫帰属/, text: '相続した土地を、一定の条件で国に引き取ってもらう制度。' },
  { term: '用途地域', re: /用途地域/, text: '都市計画で、建てられる建物の種類や使い方を地域ごとに定めたもの。' },
  { term: '建ぺい率・容積率', re: /建ぺい率|容積率/, text: '敷地に対して建物を建てられる面積の割合（建ぺい率）と、延べ床面積の割合（容積率）の上限。' },
  { term: '市街化調整区域', re: /市街化調整区域/, text: '市街化を抑える区域。建物の新築などに制限がある。' },
  { term: '想定最大規模', re: /想定最大規模/, text: '想定しうる最大級の大雨を前提にした浸水の想定。' },
  { term: '農業委員会', re: /農業委員会/, text: '農地の売買・貸し借りなどの手続きを扱う市町村の機関。' },
  { term: '相続登記', re: /相続登記/, text: '相続した土地の名義を、法務局の登記簿で変える手続き。' },
]
export function glossaryFor(text: string) {
  return GLOSSARY.filter((g) => g.re.test(text))
}

// ---- テキストでコピー（相談先にメール等で送る用）。画面のシートと同じ内容の素のテキスト ----
export function sheetToText(sheet: Sheet, rows: SummaryRow[], digest: string[], where: string, answerLines: string[]): string {
  const L: string[] = []
  L.push(sheet.title + (sheet.example ? '（実在の相続土地ではありません。回答は例として置いた架空のものです）' : ''))
  if (where) L.push(where)
  if (digest.length) L.push('', '【まず確認すること】', ...digest.map((d) => '・' + d))
  L.push('', '【あなたの回答】', answerLines.join('／'))
  L.push('', '【この土地の条件（公開データから）】', ...rows.map((r) => '・' + r.label + (r.lib ? '［不動産情報ライブラリ由来］' : '') + '：' + r.value))
  for (const e of sheet.exits) {
    L.push('', '【' + e.label + '】')
    for (const it of e.items) L.push('・' + it.fact, '　→ ' + it.ask + '（' + it.who + '）')
  }
  L.push('', '【データにない項目（相談先で確かめる）】', ...sheet.missing.map((m) => '・' + m))
  L.push('', '国のデータを加工した参考情報であり、法的・税務的な判断や査定ではありません。区域境界付近や古いデータでは実際と異なります。必ず相談先で確認してください。')
  // 不動産情報ライブラリ由来の行があるときは、利用規約が求める出典・加工の明記・クレジット・責任の所在を付ける
  if (rows.some((r) => r.lib)) L.push(REINFOLIB_ATTRIBUTION, REINFOLIB_PROCESSED + '。', REINFOLIB_CREDIT + '。', REINFOLIB_RESPONSIBILITY + '。')
  return L.join('\n')
}
