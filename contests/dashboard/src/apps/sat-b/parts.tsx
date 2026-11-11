import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { cn } from '@/lib/utils'
import { tileOf, type Dataset, type Ranked, type Site } from './lib'

const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/'
const PHOTO = {
  before: { path: 'gazo1', label: '1974〜78年' },
  now: { path: 'seamlessphoto', label: '現在' },
} as const

/** 地理院タイルの空中写真（前: 年代別 1974〜78年 / 現在: シームレス空中写真）。crop 指定で地点周辺を切り出す */
export function TilePhoto({
  site, which, crop, className,
}: { site: Site; which: 'before' | 'now'; crop?: number; className?: string }) {
  const t = tileOf(site.lon ?? 0, site.lat ?? 0, 17)
  const ph = PHOTO[which]
  const url = `${TILE}${ph.path}/17/${t.x}/${t.y}.jpg`
  let vb = '0 0 256 256'
  if (crop) {
    const ox = Math.max(0, Math.min(256 - crop, t.px - crop / 2))
    const oy = Math.max(0, Math.min(256 - crop, t.py - crop / 2))
    vb = `${ox.toFixed(0)} ${oy.toFixed(0)} ${crop} ${crop}`
  }
  const poly = !crop && site.ring
    ? site.ring.map((c) => {
        const q = tileOf(c[0], c[1], 17)
        return `${(q.wx - t.x * 256).toFixed(1)},${(q.wy - t.y * 256).toFixed(1)}`
      }).join(' ')
    : ''
  return (
    <svg viewBox={vb} role="img" aria-label={`${ph.label}の空中写真（国土地理院）`} className={cn('block h-auto w-full rounded border bg-muted', className)}>
      <rect width="256" height="256" fill="#d9d4c5" />
      <text x="128" y="128" fontSize="14" textAnchor="middle" fill="#666">写真なし</text>
      <image href={url} width="256" height="256" />
      {poly && <polygon points={poly} fill="none" stroke="#ffd400" strokeWidth="2" />}
    </svg>
  )
}

/** 架空サンプルの模式図の模式画像 */
export function SampleFrame({ after }: { after: boolean }) {
  return (
    <svg viewBox="0 0 120 80" role="img" aria-label={`${after ? '変化後' : '変化前'}の模式図（サンプル）`} className="block h-auto w-full rounded border">
      <rect width="120" height="80" fill={after ? '#cdbb96' : '#a9c48f'} />
      <polygon points="25,60 55,20 95,35 85,65" fill={after ? '#b08a55' : '#8fb070'} />
      <text x="4" y="12" fontSize="8" fill="#222">{after ? '変化後（模式）' : '変化前（模式）'}</text>
    </svg>
  )
}

// 色覚配慮: 赤⇔緑を使わず、淡い橙→濃い茶の明度差で優先度を表す
const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#fde0b8', 40, '#e08a2c', 75, '#5a2a05']
export function scoreColor(score: number, max: number): string {
  const t = Math.min(1, score / max)
  return `rgb(${Math.round(253 - 163 * t)},${Math.round(224 - 182 * t)},${Math.round(184 - 179 * t)})`
}

interface SiteMapProps {
  ds: Dataset
  /** 地図に出す台帳の行（絞り込み後） */
  rows: Ranked[]
  sel: string | null
  onSelect: (id: string) => void
  /** 巡視計画の回り順（あれば経路と番号を描く） */
  route?: Ranked[]
  className?: string
}

export function SiteMap(props: SiteMapProps) {
  return props.ds.kind === 'real' ? <RealMap {...props} /> : <SampleMap {...props} />
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function RealMap({ ds, rows, sel, onSelect, route, className }: SiteMapProps) {
  const [map, setMap] = useState<maplibregl.Map | null>(null)

  const layers = useMemo<MapLayer[]>(() => {
    const zones: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: (ds.zones ?? []).map((z) => ({
        type: 'Feature', properties: { type: z.type }, geometry: { type: 'Polygon', coordinates: [z.ring] },
      })),
    }
    const polys: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: rows.filter((s) => s.ring).map((s) => ({
        type: 'Feature', properties: { id: s.id, score: s.score, rank: s.rank },
        geometry: { type: 'Polygon', coordinates: [s.ring as number[][]] },
      })),
    }
    const pts: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: rows.map((s) => ({
        type: 'Feature', properties: { id: s.id, score: s.score, rank: s.rank, top: s.rank <= 20 ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [s.lon ?? 0, s.lat ?? 0] },
      })),
    }
    const selS = sel ? rows.find((s) => s.id === sel) : undefined
    const selFc: GeoJSON.FeatureCollection = selS
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [selS.lon ?? 0, selS.lat ?? 0] } }] }
      : EMPTY
    const routeCoords: [number, number][] = route && route.length
      ? [[ds.origin.lon ?? 0, ds.origin.lat ?? 0], ...route.map((s) => [s.lon ?? 0, s.lat ?? 0] as [number, number]), [ds.origin.lon ?? 0, ds.origin.lat ?? 0]]
      : []
    const routeFc: GeoJSON.FeatureCollection = routeCoords.length
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeCoords } }] }
      : EMPTY
    return [
      { id: 'zones', type: 'fill', data: zones, paint: { 'fill-color': '#8fb8d8', 'fill-opacity': 0.12, 'fill-outline-color': '#4a6b86' } },
      { id: 'sites-poly', type: 'fill', data: polys, minzoom: 13, paint: { 'fill-color': SCORE_COLOR, 'fill-opacity': 0.75, 'fill-outline-color': '#222' } },
      {
        id: 'sites-pt', type: 'circle', data: pts,
        paint: {
          'circle-color': SCORE_COLOR,
          'circle-radius': ['case', ['==', ['get', 'top'], 1], 7, 4],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1,
        },
      },
      { id: 'route', type: 'line', data: routeFc, paint: { 'line-color': '#0072B2', 'line-width': 3, 'line-dasharray': [2, 1] } },
      { id: 'sel', type: 'circle', data: selFc, paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': 13, 'circle-stroke-color': '#000', 'circle-stroke-width': 3 } },
    ]
  }, [ds, rows, sel, route])

  // 計画の番号（HTML マーカー）と市役所
  const markers = useRef<maplibregl.Marker[]>([])
  useEffect(() => {
    if (!map) return
    markers.current.forEach((m) => m.remove())
    markers.current = []
    const mk = (el: HTMLElement, lng: number, lat: number) => {
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map))
    }
    if (route && route.length) {
      route.forEach((s, i) => {
        const el = document.createElement('div')
        el.textContent = String(i + 1)
        el.className = 'flex size-6 items-center justify-center rounded-full border-2 border-white bg-[#0072B2] text-xs font-bold text-white shadow'
        el.setAttribute('aria-label', `回る順 ${i + 1}: ${s.id}`)
        mk(el, s.lon ?? 0, s.lat ?? 0)
      })
      const el = document.createElement('div')
      el.textContent = '起'
      el.title = ds.origin.name
      el.className = 'flex size-6 items-center justify-center rounded-sm border-2 border-white bg-neutral-900 text-xs font-bold text-white shadow'
      mk(el, ds.origin.lon ?? 0, ds.origin.lat ?? 0)
    }
    return () => { markers.current.forEach((m) => m.remove()); markers.current = [] }
  }, [map, route, ds])

  // 選択した地点へ寄る
  useEffect(() => {
    if (!map || !sel) return
    const s = rows.find((r) => r.id === sel)
    if (s) map.easeTo({ center: [s.lon ?? 0, s.lat ?? 0], zoom: Math.max(map.getZoom(), 14), duration: 400 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, sel])

  const bounds = useMemo<[[number, number], [number, number]] | undefined>(() => {
    if (route && route.length) {
      const lons = [ds.origin.lon ?? 0, ...route.map((s) => s.lon ?? 0)]
      const lats = [ds.origin.lat ?? 0, ...route.map((s) => s.lat ?? 0)]
      return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]]
    }
    return ds.bounds
  }, [ds, route])

  return (
    <MapView
      bounds={bounds}
      layers={layers}
      clickableLayerIds={['sites-pt', 'sites-poly']}
      onFeatureClick={(f) => { const id = (f.properties as { id?: string } | null)?.id; if (id) onSelect(id) }}
      attribution="国土数値情報 A54・A56（国土交通省）、地理院DEM"
      onMapReady={setMap}
      className={className}
      ariaLabel="横須賀市の大規模盛土造成地の位置図。色が濃いほど優先度が高い"
    />
  )
}

/** 架空サンプルの模式図（実在の地図ではない） */
function SampleMap({ ds, rows, sel, onSelect, route, className }: SiteMapProps) {
  const raw = ds.raw!
  const order = new Map((route ?? []).map((s, i) => [s.id, i + 1]))
  const ids = new Set(rows.map((s) => s.id))
  const list = rows.filter((s) => ids.has(s.id)).slice().reverse()
  return (
    <svg viewBox="0 0 600 400" role="img" aria-label="架空サンプルの模式図。実在の地図ではありません" className={cn('block h-auto w-full rounded-md border bg-stone-50', className)}>
      {raw.zones.map((z, i) => (
        <polygon key={i} points={z.points} fill={z.type.startsWith('特定') ? '#e8d3b0' : '#dde6cf'} stroke="#8a7a55" strokeWidth="2" strokeDasharray="12 6" />
      ))}
      {raw.river && <polyline points={raw.river} fill="none" stroke="#8fb8d8" strokeWidth="5" />}
      {(raw.roads ?? []).map((r, i) => <polyline key={i} points={r} fill="none" stroke="#b5ad9a" strokeWidth="2" />)}
      <text x="12" y="388" fontSize="11" fill="#777">サンプル（架空）・模式図</text>
      {route && route.length > 0 && (
        <polyline fill="none" stroke="#0072B2" strokeWidth="3" strokeDasharray="8 4"
          points={[ds.origin, ...route, ds.origin].map((p) => `${p.x},${p.y}`).join(' ')} />
      )}
      <rect x={ds.origin.x - 6} y={ds.origin.y - 6} width="12" height="12" fill="#2b2a27" />
      <text x={ds.origin.x + 10} y={ds.origin.y + 4} fontSize="11">{ds.origin.name}</text>
      {list.map((s) => (
        <g key={s.id} className="cursor-pointer" onClick={() => onSelect(s.id)} role="button" aria-label={`${s.id} 順位${s.rank}`}>
          <circle cx={s.x} cy={s.y} r={s.id === sel ? 15 : 12} fill={order.has(s.id) ? '#0072B2' : scoreColor(s.score, 90)} stroke={s.id === sel ? '#000' : '#fff'} strokeWidth={s.id === sel ? 3 : 2} />
          <text x={s.x} y={s.y + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={order.has(s.id) || s.score > 45 ? '#fff' : '#222'}>{order.get(s.id) ?? s.rank}</text>
        </g>
      ))}
    </svg>
  )
}
