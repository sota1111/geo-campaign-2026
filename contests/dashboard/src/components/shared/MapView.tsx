import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { GSI_BASEMAPS, buildStyle, type BasemapId, type MapBase } from './mapStyle'

export type { BasemapId, MapBase } from './mapStyle'

export interface MapLayer {
  /** レイヤーID（アプリ内で一意）。同じ id で data を変えると更新される */
  id: string
  data: GeoJSON.GeoJSON
  type: 'fill' | 'line' | 'circle'
  /** MapLibre の paint 式。省略時は type ごとの既定色（青系） */
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  filter?: unknown[]
  minzoom?: number
  maxzoom?: number
}

/** ラスタタイルの重ね合わせ（昔の航空写真など）。背景を切り替えても維持され、GeoJSON レイヤーの下に入る */
export interface RasterOverlay {
  /** 一意のID */
  id: string
  /** XYZ タイルURL（{z}/{x}/{y} を含む） */
  tiles: string[]
  tileSize?: number
  /** 0〜1（既定 1）。変更すると反映される */
  opacity?: number
  /** false で非表示（既定 true） */
  visible?: boolean
  minzoom?: number
  maxzoom?: number
  /** 出典の表記。表示中のものが画面右下に追記される */
  attribution?: string
}

export interface MapViewProps {
  /** [lng, lat] */
  center?: [number, number]
  zoom?: number
  /** 指定すると初期表示をこの範囲に合わせる [[minLng,minLat],[maxLng,maxLat]]（変更時にも追従） */
  bounds?: [[number, number], [number, number]]
  layers?: MapLayer[]
  /** ラスタ重ね合わせ。useMemo で安定させること */
  rasterOverlays?: RasterOverlay[]
  /** 地図クリックで経度緯度を返す */
  onClick?: (lngLat: { lng: number; lat: number }) => void
  /** layers のうち clickableLayerIds のフィーチャをクリックした時（先頭の1件） */
  onFeatureClick?: (feature: GeoJSON.Feature, layerId: string, lngLat: { lng: number; lat: number }) => void
  clickableLayerIds?: string[]
  /** 初期の背景。pale=淡色 / std=標準 / photo=写真 / none=背景なし（白地。切替ボタンも出さない） */
  basemap?: MapBase
  /** 背景切替ボタンを出すか（既定 true。basemap="none" の時は常に非表示） */
  showBasemapSwitcher?: boolean
  /** 追加の出典表記（例: 「国土数値情報（国土交通省）」）。国土地理院は常に表示 */
  attribution?: string
  /** 出典表示の全文を差し替える（指定すると国土地理院の既定表記・attribution・オーバーレイの出典は出ない）。空文字で非表示 */
  attributionText?: string
  /** true（既定）: ページのスクロール中に地図が拡大されない。Ctrl/⌘＋ホイールで拡大、スマホは2本指で移動。false で従来の挙動 */
  cooperativeGestures?: boolean
  /** 地図オブジェクトが必要な時（マーカー・独自レイヤー追加など）。 */
  onMapReady?: (map: maplibregl.Map) => void
  className?: string
  /** 地図の説明（スクリーンリーダー用） */
  ariaLabel?: string
}

const DEFAULT_PAINT: Record<MapLayer['type'], Record<string, unknown>> = {
  fill: { 'fill-color': '#0072B2', 'fill-opacity': 0.35, 'fill-outline-color': '#004b78' },
  line: { 'line-color': '#D55E00', 'line-width': 2 },
  circle: { 'circle-color': '#E69F00', 'circle-radius': 6, 'circle-stroke-color': '#222', 'circle-stroke-width': 1 },
}

function srcId(id: string) {
  return `src-${id}`
}
function rasterSrcId(id: string) {
  return `rsrc-${id}`
}
function rasterLayerId(id: string) {
  return `rlayer-${id}`
}

function syncRasters(map: maplibregl.Map, overlays: RasterOverlay[], firstVectorId: string | undefined, prevIds: Set<string>) {
  const nextIds = new Set(overlays.map((o) => o.id))
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      if (map.getLayer(rasterLayerId(id))) map.removeLayer(rasterLayerId(id))
      if (map.getSource(rasterSrcId(id))) map.removeSource(rasterSrcId(id))
    }
  }
  for (const o of overlays) {
    const lid = rasterLayerId(o.id)
    const visibility = o.visible === false ? 'none' : 'visible'
    if (map.getLayer(lid)) {
      map.setPaintProperty(lid, 'raster-opacity', o.opacity ?? 1)
      map.setLayoutProperty(lid, 'visibility', visibility)
    } else {
      map.addSource(rasterSrcId(o.id), {
        type: 'raster',
        tiles: o.tiles,
        tileSize: o.tileSize ?? 256,
        ...(o.minzoom != null ? { minzoom: o.minzoom } : {}),
        ...(o.maxzoom != null ? { maxzoom: o.maxzoom } : {}),
      })
      map.addLayer(
        {
          id: lid,
          type: 'raster',
          source: rasterSrcId(o.id),
          paint: { 'raster-opacity': o.opacity ?? 1 },
          layout: { visibility },
        },
        firstVectorId && map.getLayer(firstVectorId) ? firstVectorId : undefined,
      )
    }
  }
  return nextIds
}

function syncLayers(map: maplibregl.Map, layers: MapLayer[], prevIds: Set<string>) {
  const nextIds = new Set(layers.map((l) => l.id))
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(srcId(id))) map.removeSource(srcId(id))
    }
  }
  for (const l of layers) {
    const existing = map.getSource(srcId(l.id)) as maplibregl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(l.data)
      if (map.getLayer(l.id)) {
        // paint / filter の更新
        for (const [k, v] of Object.entries(l.paint ?? DEFAULT_PAINT[l.type])) {
          map.setPaintProperty(l.id, k, v as never)
        }
        map.setFilter(l.id, (l.filter as never) ?? null)
      }
    } else {
      map.addSource(srcId(l.id), { type: 'geojson', data: l.data })
      map.addLayer({
        id: l.id,
        type: l.type,
        source: srcId(l.id),
        paint: (l.paint ?? DEFAULT_PAINT[l.type]) as never,
        layout: (l.layout ?? {}) as never,
        ...(l.filter ? { filter: l.filter as never } : {}),
        ...(l.minzoom != null ? { minzoom: l.minzoom } : {}),
        ...(l.maxzoom != null ? { maxzoom: l.maxzoom } : {}),
      } as maplibregl.AddLayerObject)
    }
  }
  return nextIds
}

/**
 * 共通の地図。地理院タイル（淡色・標準・写真）＋ ラスタ重ね合わせ ＋ GeoJSON レイヤー。
 * 親は高さを持つ要素に入れるか className で高さを与えること（既定 h-[420px]）。
 * 親のサイズが変わると自動で追従する。
 */
export function MapView({
  center = [137.0, 36.0],
  zoom = 5,
  bounds,
  layers = [],
  rasterOverlays,
  onClick,
  onFeatureClick,
  clickableLayerIds,
  basemap = 'pale',
  showBasemapSwitcher = true,
  attribution,
  attributionText,
  cooperativeGestures = true,
  onMapReady,
  className,
  ariaLabel = '地図',
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const layerIdsRef = useRef<Set<string>>(new Set())
  const rasterIdsRef = useRef<Set<string>>(new Set())
  const layersRef = useRef(layers)
  const overlaysRef = useRef<RasterOverlay[]>(rasterOverlays ?? [])
  const cbRef = useRef({ onClick, onFeatureClick, clickableLayerIds })
  layersRef.current = layers
  overlaysRef.current = rasterOverlays ?? []
  cbRef.current = { onClick, onFeatureClick, clickableLayerIds }
  const [base, setBase] = useState<MapBase>(basemap)
  const [ready, setReady] = useState(false)

  /** ラスタ（下）→ GeoJSON（上）の順で全部同期する。引数 fresh=true はスタイル再読込後（既存IDなし） */
  const syncAll = (map: maplibregl.Map, fresh: boolean) => {
    // 先にラスタを入れる時、最初のGeoJSONレイヤーより下に挿入するため、GeoJSON を先に同期して id を取る
    layerIdsRef.current = syncLayers(map, layersRef.current, fresh ? new Set() : layerIdsRef.current)
    const first = layersRef.current.find((l) => map.getLayer(l.id))?.id
    rasterIdsRef.current = syncRasters(map, overlaysRef.current, first, fresh ? new Set() : rasterIdsRef.current)
  }

  // 初期化（1回）
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(base),
      center,
      zoom,
      attributionControl: false,
      cooperativeGestures,
      locale: {
        'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl キーを押しながらスクロールすると地図を拡大・縮小できます',
        'CooperativeGesturesHandler.MacHelpText': '⌘ キーを押しながらスクロールすると地図を拡大・縮小できます',
        'CooperativeGesturesHandler.MobileHelpText': '2本指で地図を動かせます',
      },
      ...(bounds ? { bounds, fitBoundsOptions: { padding: 20 } } : {}),
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => {
      syncAll(map, true)
      setReady(true)
    })
    map.on('click', (e) => {
      const { onClick: oc, onFeatureClick: ofc, clickableLayerIds: ids } = cbRef.current
      if (ofc && ids?.length) {
        const f = map.queryRenderedFeatures(e.point, { layers: ids.filter((i) => map.getLayer(i)) })[0]
        if (f) ofc(f as unknown as GeoJSON.Feature, f.layer.id, e.lngLat)
      }
      oc?.({ lng: e.lngLat.lng, lat: e.lngLat.lat })
    })
    // 親サイズ変化への追従（サイドバー開閉・パネル切替・画面回転など）
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : undefined
    ro?.observe(containerRef.current)
    onMapReady?.(map)
    return () => {
      ro?.disconnect()
      map.remove()
      mapRef.current = null
      layerIdsRef.current = new Set()
      rasterIdsRef.current = new Set()
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 背景切替: スタイルを差し替え、レイヤー・ラスタを再追加
  const firstBase = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (firstBase.current) {
      firstBase.current = false
      return
    }
    map.setStyle(buildStyle(base))
    map.once('style.load', () => syncAll(map, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // レイヤー・ラスタ更新
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    try {
      syncAll(map, false)
    } catch {
      /* 背景切替中。style.load で再同期される */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, rasterOverlays, ready])

  // 外部からの中心・範囲変更に追従
  const boundsKey = bounds ? bounds.flat().join(',') : ''
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !bounds) return
    map.fitBounds(bounds, { padding: 20, duration: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, ready])

  const centerKey = center.join(',')
  const firstCenter = useRef(true)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (firstCenter.current) {
      firstCenter.current = false
      return
    }
    if (!bounds) map.jumpTo({ center, zoom })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey, zoom, ready])

  const overlayAttrs = (rasterOverlays ?? [])
    .filter((o) => o.visible !== false && o.attribution)
    .map((o) => o.attribution as string)
  const extra = [attribution, ...overlayAttrs].filter(Boolean).join('／')

  return (
    <div className={cn('relative h-[420px] w-full overflow-hidden rounded-md border', className)}>
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" role="region" aria-label={ariaLabel} />
      </div>
      {showBasemapSwitcher && basemap !== 'none' && (
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={base}
          onValueChange={(v) => v && setBase(v as BasemapId)}
          className="absolute left-2 top-2 rounded-md bg-white/90 shadow"
          aria-label="背景地図の切替"
        >
          {(Object.keys(GSI_BASEMAPS) as BasemapId[]).map((k) => (
            <ToggleGroupItem key={k} value={k} className="px-2 text-xs">
              {GSI_BASEMAPS[k].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      {attributionText !== undefined ? (
        attributionText && (
          <div className="pointer-events-none absolute bottom-0 right-0 max-w-[80%] bg-white/80 px-1.5 py-0.5 text-[10px] leading-tight text-neutral-700">
            {attributionText}
          </div>
        )
      ) : (
        (base !== 'none' || extra) && (
          <div className="pointer-events-none absolute bottom-0 right-0 max-w-[80%] bg-white/80 px-1.5 py-0.5 text-[10px] leading-tight text-neutral-700">
            {base !== 'none' && (
              <>
                出典：
                <a
                  className="pointer-events-auto underline"
                  href="https://maps.gsi.go.jp/development/ichiran.html"
                  target="_blank"
                  rel="noreferrer"
                >
                  国土地理院タイル（{GSI_BASEMAPS[base].label}）
                </a>
              </>
            )}
            {extra ? `${base !== 'none' ? '／' : '出典：'}${extra}` : ''}
          </div>
        )
      )}
    </div>
  )
}
