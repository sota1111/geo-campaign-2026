/* 不動産情報ライブラリ（国土交通省）の取得結果: 型・整形・照合。DOM・ネットワークには触れない。
 * 前処理スクリプト（fetch-reinfolib.ts）が API から取得して整形し、public/data/biz-realestate/reinfolib.json に書く。
 * アプリはそのファイルがあり、検証を通った場合にだけ「ライブラリ由来」として表示する。
 * この型に合わないファイル・手書きのファイルは読み込まない（isReinfolibData）。 */
import { haversine, inPolygon, type Poly } from './lib.ts'

export const REINFOLIB_URL = 'https://www.reinfolib.mlit.go.jp/'
export const GENERATOR = 'fetch-reinfolib.ts'
/** 町名ごとの取引集計は、この件数以上の時だけ出す（少数だと個別の取引が推測できるため） */
export const MIN_TRADES = 3
/** 地価公示の標準地を「近く」とみなす距離（m） */
export const LAND_PRICE_RADIUS = 1500

export interface TradeStat { name: string; n: number; medianUnitPrice: number }
export interface TradeData {
  /** 取引時期（Period）の範囲。例 2024年第1四半期〜2025年第3四半期 */
  period: string
  /** 集計に使った「宅地(土地)」の取引件数 */
  total: number
  /** 市全体（件数が MIN_TRADES 未満なら null） */
  city: TradeStat | null
  districts: TradeStat[]
}
export interface LandPoint { id: number; lon: number; lat: number; lot: string; use: string; price: number; year: string; location: string; kind: '地価公示' | '地価調査' | '' }
export interface LandPriceData { year: number; points: LandPoint[] }
export interface DivisionFeature { cls: string; polys: Poly[] }
export interface DivisionData { features: DivisionFeature[] }
export interface ReinfolibData {
  generator: typeof GENERATOR
  source: '国土交通省 不動産情報ライブラリ'
  /** 取得日（YYYY-MM-DD） */
  fetchedAt: string
  city: { code: string; name: string }
  trade?: TradeData
  landPrice?: LandPriceData
  division?: DivisionData
}

// ---- 検証 ----
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStat = (s: unknown): s is TradeStat => !!s && isStr((s as TradeStat).name) && isNum((s as TradeStat).n) && (s as TradeStat).n >= MIN_TRADES && isNum((s as TradeStat).medianUnitPrice) && (s as TradeStat).medianUnitPrice > 0

/** 前処理スクリプトが書いた形式か。節（trade・landPrice・division）は、形が正しいものだけ残して返す。使える節が1つもなければ null */
export function isReinfolibData(x: unknown): ReinfolibData | null {
  const d = x as Partial<ReinfolibData> | null
  if (!d || typeof d !== 'object') return null
  if (d.generator !== GENERATOR || d.source !== '国土交通省 不動産情報ライブラリ') return null
  if (!isStr(d.fetchedAt) || !/^\d{4}-\d{2}-\d{2}/.test(d.fetchedAt)) return null
  if (!d.city || !isStr(d.city.code) || !isStr(d.city.name)) return null
  const out: ReinfolibData = { generator: GENERATOR, source: d.source, fetchedAt: d.fetchedAt.slice(0, 10), city: d.city }
  const t = d.trade
  if (t && isStr(t.period) && isNum(t.total) && Array.isArray(t.districts)) {
    out.trade = { period: t.period, total: t.total, city: isStat(t.city) ? t.city : null, districts: t.districts.filter(isStat) }
    if (!out.trade.city && !out.trade.districts.length) delete out.trade
  }
  const l = d.landPrice
  if (l && isNum(l.year) && Array.isArray(l.points)) {
    const points = l.points.filter((p) => p && isNum(p.lon) && isNum(p.lat) && isNum(p.price) && p.price > 0 && isStr(p.lot))
    if (points.length) out.landPrice = { year: l.year, points }
  }
  const v = d.division
  if (v && Array.isArray(v.features)) {
    const features = v.features.filter((f) => f && isStr(f.cls) && Array.isArray(f.polys))
    if (features.length) out.division = { features }
  }
  return out.trade || out.landPrice || out.division ? out : null
}

// ---- API 応答の整形（スクリプトとテストが使う） ----
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const n = Number(v.replace(/[,，\s]/g, '').replace(/[（(].*$/, ''))
  return v.trim() !== '' && Number.isFinite(n) ? n : null
}
export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const periodKey = (p: string) => {
  const m = /(\d{4})年第(\d)四半期/.exec(p)
  return m ? Number(m[1]) * 10 + Number(m[2]) : 0
}
/** 全角・半角の括弧の違いを吸収して「宅地(土地)」か判定 */
const isLand = (type: unknown) => typeof type === 'string' && type.replace(/（/g, '(').replace(/）/g, ')').trim() === '宅地(土地)'

/** XIT001 の data 配列 → 町名ごとの㎡単価の中央値。「宅地(土地)」で㎡単価がある取引だけを数える。個別の取引は残さない */
export function aggregateTrade(rows: Record<string, unknown>[]): TradeData | null {
  const land = rows.filter((r) => isLand(r.Type) && num(r.UnitPrice) != null && (num(r.UnitPrice) as number) > 0)
  if (!land.length) return null
  const byDistrict = new Map<string, number[]>()
  for (const r of land) {
    const name = typeof r.DistrictName === 'string' ? r.DistrictName.trim() : ''
    if (!name) continue
    byDistrict.set(name, [...(byDistrict.get(name) ?? []), num(r.UnitPrice) as number])
  }
  const stat = (name: string, xs: number[]): TradeStat | null => (xs.length >= MIN_TRADES ? { name, n: xs.length, medianUnitPrice: Math.round(median(xs) as number) } : null)
  const districts = [...byDistrict.entries()].map(([n, xs]) => stat(n, xs)).filter((s): s is TradeStat => !!s).sort((a, b) => a.name.localeCompare(b.name, 'ja'))
  const periods = land.map((r) => String(r.Period ?? '')).filter((p) => periodKey(p) > 0).sort((a, b) => periodKey(a) - periodKey(b))
  const first = periods[0], last = periods[periods.length - 1]
  return {
    period: first && last ? (first === last ? first : `${first}〜${last}`) : '期間不明',
    total: land.length,
    city: stat('市全体', land.map((r) => num(r.UnitPrice) as number)),
    districts,
  }
}

/** XPT002 の GeoJSON（複数タイル分を連結してよい）→ 標準地の点。point_id で重複を除く */
export function extractLandPoints(features: unknown[]): LandPoint[] {
  const seen = new Map<number, LandPoint>()
  for (const f of features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const g = f?.geometry, p = f?.properties
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || !p) continue
    const [lon, lat] = g.coordinates as number[]
    const price = num(p.u_current_years_price_ja)
    const id = num(p.point_id)
    if (!isNum(lon) || !isNum(lat) || price == null || price <= 0 || id == null) continue
    const kind = p.land_price_type === 0 || p.land_price_type === '0' ? '地価公示' : p.land_price_type === 1 || p.land_price_type === '1' ? '地価調査' : ''
    seen.set(id, {
      id, lon: +lon.toFixed(5), lat: +lat.toFixed(5),
      lot: String(p.standard_lot_number_ja ?? ''), use: String(p.use_category_name_ja ?? '').replace(/^\d+,/, ''),
      price, year: String(p.target_year_name_ja ?? ''), location: String(p.location ?? p.location_number_ja ?? ''), kind,
    })
  }
  return [...seen.values()].sort((a, b) => a.id - b.id)
}

/** XKT001 の GeoJSON → 区域区分の多角形（座標は小数5桁に丸める） */
export function extractDivision(features: unknown[]): DivisionFeature[] {
  const out: DivisionFeature[] = []
  const r5 = (c: number[]) => [+c[0].toFixed(5), +c[1].toFixed(5)] as [number, number]
  for (const f of features as { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[]) {
    const g = f?.geometry, cls = f?.properties?.area_classification_ja
    if (!g || typeof cls !== 'string' || !cls) continue
    let polys: number[][][][] = []
    if (g.type === 'Polygon') polys = [g.coordinates as number[][][]]
    else if (g.type === 'MultiPolygon') polys = g.coordinates as number[][][][]
    else continue
    out.push({ cls, polys: polys.map((poly) => poly.map((ring) => ring.map(r5))) })
  }
  return out
}

// ---- 地点との照合（アプリ側） ----
export interface LibFacts {
  fetchedAt: string
  division?: { classes: string[]; main: string }
  landPrice?: { point: LandPoint; dist: number; year: number }
  trade?: { stat: TradeStat; scope: 'district' | 'city'; period: string }
}

/** 「徳島県徳島市寺島本町東三丁目付近」のような住所から、丁目を除いた町名（寺島本町東）を取り出す */
export function townOf(address: string | null | undefined, cityName: string): string | null {
  if (!address) return null
  const i = address.indexOf(cityName)
  if (i < 0) return null
  const town = address.slice(i + cityName.length).replace(/付近$/, '').replace(/[一二三四五六七八九十〇]+丁目$/, '').trim()
  return town || null
}

/** 区域区分の代表値: 市街化調整区域 > 市街化区域 > それ以外（都市計画区域など） */
export function mainDivision(classes: string[]): string {
  return classes.find((c) => c.includes('市街化調整区域')) ?? classes.find((c) => c.includes('市街化区域')) ?? classes[0]
}

export function lookupLibrary(d: ReinfolibData | null, lon: number, lat: number, address: string | null | undefined): LibFacts | null {
  if (!d) return null
  const out: LibFacts = { fetchedAt: d.fetchedAt }
  if (d.division) {
    const classes = [...new Set(d.division.features.filter((f) => f.polys.some((p) => inPolygon(lon, lat, p))).map((f) => f.cls))]
    if (classes.length) out.division = { classes, main: mainDivision(classes) }
  }
  if (d.landPrice) {
    let best: { point: LandPoint; dist: number } | null = null
    for (const p of d.landPrice.points) {
      const dist = haversine(lon, lat, p.lon, p.lat)
      if (dist <= LAND_PRICE_RADIUS && (!best || dist < best.dist)) best = { point: p, dist }
    }
    if (best) out.landPrice = { ...best, year: d.landPrice.year }
  }
  if (d.trade) {
    const town = townOf(address, d.city.name)
    // 住所が徳島市内と確認できた時だけ使う（住所が取れない・他市町村の地点に「徳島市全体」の数値を当てない）
    const dist = town ? d.trade.districts.find((s) => s.name === town) : undefined
    if (dist) out.trade = { stat: dist, scope: 'district', period: d.trade.period }
    else if (town && d.trade.city) out.trade = { stat: d.trade.city, scope: 'city', period: d.trade.period }
  }
  return out.division || out.landPrice || out.trade ? out : null
}

export const yen = (n: number) => Math.round(n).toLocaleString('ja-JP') + '円'
