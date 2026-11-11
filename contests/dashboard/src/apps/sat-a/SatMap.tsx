import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import type { Cell, Scored, CellSat } from './logic'

// 点数の色: 淡灰青 → 琥珀 → 紫（赤緑を使わない）
const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#dbe5ec', 0.5, '#f4b942', 1, '#8e1b6b']
const BOUNDS: [[number, number], [number, number]] = [[-0.0006, -0.0006], [0.015, 0.0114]]

export interface SatMapProps {
  round: number
  cells: Cell[]
  cellSat: CellSat
  ranked: Scored[]
  selected: Set<string>
  focus: string | null
  step: '1' | '2' | '3'
  results: Map<string, boolean>
  onSegmentClick: (id: string) => void
  className?: string
}

export function SatMap({ round, cells, cellSat, ranked, selected, focus, step, results, onSegmentClick, className }: SatMapProps) {
  const [mapReady, setMapReady] = useState(false)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const mapRef = useRef<maplibregl.Map | null>(null)
  const resMarkersRef = useRef<maplibregl.Marker[]>([])

  const cellsFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: cells.map((c) => ({
        type: 'Feature',
        properties: { id: c.id, sat: cellSat[c.id] },
        geometry: { type: 'Polygon', coordinates: [c.ring] },
      })),
    }),
    [cells, cellSat],
  )
  const segFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: ranked.map((s) => ({
        type: 'Feature',
        properties: { id: s.id, score: s.score, cls: s.cls, done: s.surveyed ? 1 : 0, sel: selected.has(s.id) ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: s.coords },
      })),
    }),
    [ranked, selected],
  )
  const resFc = useMemo<GeoJSON.FeatureCollection>(() => {
    const byId = new Map(ranked.map((s) => [s.id, s]))
    return {
      type: 'FeatureCollection',
      features: [...results].map(([id, hit]) => {
        const [a, b] = (byId.get(id) as Scored).coords
        return {
          type: 'Feature',
          properties: { id, hit: hit ? 1 : 0 },
          geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        }
      }),
    }
  }, [ranked, results])

  const layers = useMemo<MapLayer[]>(
    () => [
      {
        id: 'cells-fill', type: 'fill', data: cellsFc,
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'sat'], 0, '#f3f1ea', 1, '#7fa3c0'],
          'fill-opacity': step === '1' ? 0.55 : 0.15,
        },
      },
      { id: 'cells-line', type: 'line', data: cellsFc, paint: { 'line-color': '#9fb0bf', 'line-width': 1 } },
      {
        id: 'seg-focus', type: 'line', data: segFc, filter: ['==', ['get', 'id'], focus ?? ''],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': '#111', 'line-width': 11, 'line-opacity': 0.55 },
      },
      {
        id: 'seg-sel', type: 'line', data: segFc, filter: ['==', ['get', 'sel'], 1],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': '#00a3c4', 'line-width': 12, 'line-opacity': 0.85 },
      },
      {
        id: 'seg-done', type: 'line', data: segFc, filter: ['==', ['get', 'done'], 1],
        paint: { 'line-color': '#6f7d86', 'line-width': 4, 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'seg-todo', type: 'line', data: segFc, filter: ['==', ['get', 'done'], 0],
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': SCORE_COLOR, 'line-width': ['case', ['==', ['get', 'cls'], 'arterial'], 3, 5] },
      },
      // タップしやすいように、ほぼ透明の太い線を最前面に置く
      { id: 'seg-hit', type: 'line', data: segFc, paint: { 'line-color': '#000', 'line-width': 20, 'line-opacity': 0.01 } },
    ],
    [cellsFc, segFc, step, focus],
  )

  // 区画ラベルは第1段階のみ表示
  useEffect(() => {
    markersRef.current.forEach((m) => {
      m.getElement().style.display = step === '1' ? '' : 'none'
    })
  }, [step])

  // 走査結果は形で区別するマーカー（▲＝空洞の疑い、○＝異常なし）。色だけに頼らない
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    resMarkersRef.current.forEach((mk) => mk.remove())
    resMarkersRef.current = []
    for (const f of resFc.features) {
      const hit = f.properties?.hit === 1
      const el = document.createElement('div')
      el.setAttribute('aria-hidden', 'true')
      el.style.pointerEvents = 'none'
      el.innerHTML = hit
        ? '<svg width="26" height="24" viewBox="0 0 26 24"><polygon points="13,2 24,22 2,22" fill="#d55e00" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="#fff" stroke="#0072b2" stroke-width="2.5"/></svg>'
      const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates
      resMarkersRef.current.push(new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map))
    }
  }, [resFc, mapReady])

  const onMapReady = (map: maplibregl.Map) => {
    mapRef.current = map
    setMapReady(true)
    // 架空の街なので背景地図（地理院タイル）は使わない。単色の背景に差し替える
    map.on('style.load', () => {
      if (map.getLayer('gsi')) map.removeLayer('gsi')
      if (map.getSource('gsi')) map.removeSource('gsi')
      if (!map.getLayer('fict-bg')) {
        map.addLayer({ id: 'fict-bg', type: 'background', paint: { 'background-color': '#eceae3' } })
      }
    })
    for (const c of cells) {
      const el = document.createElement('div')
      el.textContent = `${c.id} ${c.disp.toFixed(1)}mm/年`
      el.style.cssText =
        'font-size:10px;line-height:1.2;padding:1px 3px;border-radius:3px;background:rgba(255,255,255,.8);color:#333;pointer-events:none;white-space:nowrap'
      const [x0, y0] = c.ring[0]
      const [, y1] = c.ring[2]
      const marker = new maplibregl.Marker({ element: el, anchor: 'top-left' })
        .setLngLat([x0 + 0.00015, y1 - 0.00012 > y0 ? y1 - 0.00012 : y0])
        .addTo(map)
      markersRef.current.push(marker)
    }
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      <MapView
        className="h-full"
        cooperativeGestures={false}
        bounds={BOUNDS}
        layers={layers}
        showBasemapSwitcher={false}
        clickableLayerIds={['seg-hit']}
        onFeatureClick={(f) => onSegmentClick(String(f.properties?.id))}
        onMapReady={onMapReady}
        ariaLabel="道路区間の地図（架空の街。背景地図なし）"
      />
      {/* 共通部品の出典表示（国土地理院）は、背景地図を使わないこの地図では不適切なので覆う */}
      <div className="pointer-events-none absolute bottom-0 right-0 z-20 min-w-[16rem] bg-white px-1.5 py-0.5 text-right text-[10px] leading-tight text-neutral-800">
        背景地図なし（架空の街）／サンプルデータ
      </div>
      <div className="pointer-events-none absolute left-2 top-2 z-20 max-w-[calc(100%-4rem)] rounded border border-dashed border-amber-500 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-900 shadow">
        ◇ 架空の街「サンプル市」（実在の地点ではありません）／第{round}回
      </div>
    </div>
  )
}
