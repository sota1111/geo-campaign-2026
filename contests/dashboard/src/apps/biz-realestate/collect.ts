/* 公開データの収集。ネットワークは GET のみ（地理院タイル・ハザードマップポータルのタイル・地理院の住所検索）。送信なし。 */
import {
  classifyFlood, classifyPresence, demElevation, findZone, inBBox, tileOf, transitAround,
  type AreaData, type Facts, type Haz, type HazStatus,
} from './lib'

export const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/'
export const HAZ = 'https://disaportaldata.gsi.go.jp/raster/'

export const OVERLAYS = [
  { value: 'none', label: 'なし', layer: '' },
  { value: 'flood', label: '洪水浸水想定区域（想定最大規模）', layer: '01_flood_l2_shinsuishin_data' },
  { value: 'hightide', label: '高潮浸水想定区域', layer: '03_hightide_l2_shinsuishin_data' },
  { value: 'tsunami', label: '津波浸水想定', layer: '04_tsunami_newlegend_data' },
  { value: 'kyukeisha', label: '土砂災害警戒区域（急傾斜地）', layer: '05_kyukeishakeikaikuiki' },
  { value: 'dosekiryu', label: '土砂災害警戒区域（土石流）', layer: '05_dosekiryukeikaikuiki' },
] as const

type Sample = { status: 'ok'; rgba: number[] } | { status: 'none' } | { status: 'error' }

/** タイルの1画素を読む。404=タイルなし(区域外)。通信失敗は error */
export async function samplePixel(url: string, px: number, py: number): Promise<Sample> {
  let res: Response
  try {
    res = await fetch(url, { mode: 'cors' })
  } catch {
    return { status: 'error' }
  }
  if (res.status === 404) return { status: 'none' }
  if (!res.ok) return { status: 'error' }
  try {
    const bmp = await createImageBitmap(await res.blob())
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(bmp, 0, 0)
    return { status: 'ok', rgba: Array.from(g.getImageData(px, py, 1, 1).data) }
  } catch {
    return { status: 'error' }
  }
}

async function hazard(layer: string, lon: number, lat: number): Promise<Sample> {
  const t = tileOf(lon, lat, 16)
  const r = await samplePixel(`${HAZ}${layer}/${t.z}/${t.x}/${t.y}.png`, t.px, t.py)
  return r.status === 'none' ? { status: 'none' } : r
}

function toHaz(r: Sample, cls: typeof classifyFlood): Haz {
  if (r.status === 'error') return { status: 'error' }
  if (r.status === 'none') return { status: 'outside' }
  const c = cls(r.rgba)
  return { status: c.inside ? 'inside' : 'outside', depth: c.depth }
}

export async function analyze(data: AreaData | null, lon: number, lat: number, place: string): Promise<Facts> {
  const facts: Facts = { place, inArea: false, zone: null, elevation: null, transit: null, flood: null, hightide: null, tsunami: null, sediment: {} }
  if (data) {
    facts.inArea = inBBox(data.bbox, lon, lat)
    if (facts.inArea) {
      facts.zone = findZone(data.zones, lon, lat)
      facts.transit = transitAround(data, lon, lat, 500)
    }
  }
  const dt = tileOf(lon, lat, 14)
  const [fl, hi, ts, ky, ds, js, dem] = await Promise.all([
    hazard('01_flood_l2_shinsuishin_data', lon, lat),
    hazard('03_hightide_l2_shinsuishin_data', lon, lat),
    hazard('04_tsunami_newlegend_data', lon, lat),
    hazard('05_kyukeishakeikaikuiki', lon, lat),
    hazard('05_dosekiryukeikaikuiki', lon, lat),
    hazard('05_jisuberikeikaikuiki', lon, lat),
    samplePixel(`${GSI}dem_png/14/${dt.x}/${dt.y}.png`, dt.px, dt.py),
  ])
  facts.flood = toHaz(fl, classifyFlood)
  facts.hightide = toHaz(hi, classifyPresence)
  facts.tsunami = toHaz(ts, classifyPresence)
  const sd = (r: Sample): HazStatus => (r.status === 'error' ? 'error' : r.status === 'ok' && classifyPresence(r.rgba).inside ? 'inside' : 'outside')
  facts.sediment = { kyukeisha: sd(ky), dosekiryu: sd(ds), jisuberi: sd(js) }
  if (dem.status === 'ok') facts.elevation = demElevation(dem.rgba[0], dem.rgba[1], dem.rgba[2])
  return facts
}

export interface SearchHit { lon: number; lat: number; title: string }
/** 地理院の住所検索（GET）。失敗は例外 */
export async function searchAddress(q: string): Promise<SearchHit[]> {
  const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q))
  if (!r.ok) throw new Error('search failed')
  const j = (await r.json()) as { geometry: { coordinates: [number, number] }; properties: { title: string } }[]
  return j.map((x) => ({ lon: x.geometry.coordinates[0], lat: x.geometry.coordinates[1], title: x.properties.title }))
}
