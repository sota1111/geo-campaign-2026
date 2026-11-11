import { NEAR_M, inCoverage, type NearFill } from './lib'

export { NEAR_M }

export const KIND_HELP: Record<string, string> = {
  谷埋め型: '谷を埋めた盛土',
  腹付け型: '斜面に盛った盛土',
  区分なし: 'データ上、区分がないもの',
}

export interface PlaceHit {
  title: string
  lng: number
  lat: number
  inArea: boolean
}

/** 国土地理院 地名検索API（AddressSearch）の応答を候補にする。熱海市・伊東市の範囲内を先に並べ、重複を除く */
export function parseGsiSearch(json: unknown, limit = 6): PlaceHit[] {
  if (!Array.isArray(json)) return []
  const out: PlaceHit[] = []
  const seen = new Set<string>()
  for (const raw of json) {
    const r = raw as { geometry?: { coordinates?: unknown[] }; properties?: { title?: unknown } }
    const c = r.geometry?.coordinates
    const title = typeof r.properties?.title === 'string' ? r.properties.title : ''
    if (!c || typeof c[0] !== 'number' || typeof c[1] !== 'number' || !isFinite(c[0]) || !isFinite(c[1]) || !title) continue
    const key = `${title}|${c[0].toFixed(4)}|${c[1].toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title, lng: c[0], lat: c[1], inArea: inCoverage(c[0], c[1]) })
  }
  return [...out.filter((x) => x.inArea), ...out.filter((x) => !x.inArea)].slice(0, limit)
}

const API = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q='

/** 地名検索（GETのみ）。熱海・伊東を含まない語は「熱海市」を付けた検索も併用して範囲内の候補を優先する */
export async function searchPlaces(q: string): Promise<PlaceHit[]> {
  const term = q.trim()
  if (!term) return []
  const qs = [term]
  if (!/熱海|伊東/.test(term)) qs.push('熱海市' + term)
  const res = await Promise.all(
    qs.map(async (s) => {
      const r = await fetch(API + encodeURIComponent(s))
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as unknown[]
    }),
  )
  return parseGsiSearch(res.flat())
}

/** 起点から見た最寄りの造成地の説明文 */
export function nearSummary(list: NearFill[]): string {
  if (!list.length) return '登録された大規模盛土造成地データはありません。'
  const n = list[0]
  const m = n.inside ? 0 : n.distM < 100 ? Math.round(n.distM / 10) * 10 : Math.round(n.distM / 50) * 50
  const head = n.inside
    ? `この地点は大規模盛土造成地「${n.id}」（${n.kind}）の範囲内です。`
    : `最寄りの造成地「${n.id}」（${n.kind}）まで約${m}m（直線）。`
  const tail =
    n.distM <= NEAR_M
      ? `${NEAR_M}m以内を「近く」とみなしています。`
      : `${NEAR_M}m以内を「近く」とみなしており、この地点の近くには登録された造成地はありません（より遠い造成地を距離順に表示）。`
  return head + tail
}
