import { useMemo } from 'react'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import type { Cell, Scored } from './logic'

// 点数の色: 淡灰青 → 琥珀 → 紫（赤緑を使わない）
const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#dbe5ec', 0.5, '#f4b942', 1, '#8e1b6b']
const ATTRIBUTION = '解析：国土地理院 原初データ所有：JAXA／© OpenStreetMap contributors／豊中市（CC BY 4.0）／加工して作成'

export interface SatMapProps {
  round: number
  bbox: [number, number, number, number]
  palette: string[]
  cells: Cell[]
  ranked: Scored[]
  selected: Set<string>
  focus: string | null
  step: '1' | '2'
  results: Map<string, boolean>
  demo: boolean
  onSegmentClick: (id: string) => void
  className?: string
}

export function SatMap({ round, bbox, palette, cells, ranked, selected, focus, step, results, demo, onSegmentClick, className }: SatMapProps) {
  const cellsFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: cells.map((c) => ({
        type: 'Feature',
        properties: { id: c.id, k: c.k },
        geometry: { type: 'Polygon', coordinates: [c.ring] },
      })),
    }),
    [cells],
  )
  const segFc = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: ranked.map((s) => ({
        type: 'Feature',
        properties: {
          id: s.id, score: s.score, cls: s.cls,
          none: s.cls === 'noledger' ? 1 : 0,
          art: s.cls === 'arterial' && !s.surveyed ? 1 : 0,
          done: s.surveyed ? 1 : 0,
          sel: selected.has(s.id) ? 1 : 0,
        },
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

  const layers = useMemo<MapLayer[]>(() => {
    const fillColor = ['match', ['get', 'k'], ...palette.flatMap((c, k) => [k, c]), '#cccccc']
    const lineW = ['interpolate', ['linear'], ['zoom'], 12, 1, 14, 2.5, 17, 6]
    return [
      { id: 'cells-fill', type: 'fill', data: cellsFc, paint: { 'fill-color': fillColor, 'fill-opacity': step === '1' ? 0.45 : 0.15 } },
      { id: 'cells-line', type: 'line', data: cellsFc, paint: { 'line-color': '#9fb0bf', 'line-width': 0.5, 'line-opacity': 0.6 } },
      { id: 'seg-none', type: 'line', data: segFc, filter: ['==', ['get', 'none'], 1], paint: { 'line-color': '#8a969d', 'line-width': 1, 'line-dasharray': [1.5, 2] } },
      { id: 'seg-art', type: 'line', data: segFc, filter: ['==', ['get', 'art'], 1], paint: { 'line-color': '#9aa5ab', 'line-width': 1.2 } },
      {
        id: 'seg-focus', type: 'line', data: segFc, filter: ['==', ['get', 'id'], focus ?? ''],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': '#111', 'line-width': 11, 'line-opacity': 0.55 },
      },
      {
        id: 'seg-sel', type: 'line', data: segFc, filter: ['==', ['get', 'sel'], 1],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': '#00a3c4', 'line-width': 10, 'line-opacity': 0.85 },
      },
      {
        id: 'seg-done', type: 'line', data: segFc, filter: ['all', ['==', ['get', 'done'], 1], ['==', ['get', 'none'], 0]],
        paint: { 'line-color': '#6f7d86', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
      },
      {
        id: 'seg-todo', type: 'line', data: segFc, filter: ['all', ['==', ['get', 'done'], 0], ['==', ['get', 'none'], 0], ['==', ['get', 'art'], 0]],
        layout: { 'line-cap': 'round' }, paint: { 'line-color': SCORE_COLOR, 'line-width': lineW },
      },
      // 調査結果の印（形と大きさで区別。色だけに頼らない）。結果が入った区間にだけ出る
      { id: 'res-ok', type: 'circle', data: resFc, filter: ['==', ['get', 'hit'], 0], paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#0072b2', 'circle-stroke-width': 2 } },
      { id: 'res-hit', type: 'circle', data: resFc, filter: ['==', ['get', 'hit'], 1], paint: { 'circle-radius': 8, 'circle-color': '#d55e00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } },
      // タップしやすいように、ほぼ透明の太い線を最前面に置く
      { id: 'seg-hit', type: 'line', data: segFc, paint: { 'line-color': '#000', 'line-width': 18, 'line-opacity': 0.01 } },
    ]
  }, [cellsFc, segFc, resFc, step, focus, palette])

  const bounds: [[number, number], [number, number]] = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]]

  return (
    <div className={`relative ${className ?? ''}`}>
      <MapView
        className="h-full"
        cooperativeGestures={false}
        bounds={bounds}
        layers={layers}
        basemap="none"
        showBasemapSwitcher={false}
        attributionText={ATTRIBUTION}
        clickableLayerIds={['seg-hit']}
        onFeatureClick={(f) => onSegmentClick(String(f.properties?.id))}
        ariaLabel="道路区間の地図（豊中市北東部。衛星の階級・道路・下水道台帳は実データ。背景地図なし）"
      />
      {demo ? (
        <div
          role="alert"
          data-testid="demo-banner"
          className="pointer-events-none absolute left-2 top-2 z-20 max-w-[calc(100%-4rem)] rounded border-2 border-amber-600 bg-amber-50/95 px-2 py-1 text-xs font-bold text-amber-950 shadow"
        >
          説明用デモ中：地中レーダの結果は架空（乱数）です／第{round}回
        </div>
      ) : (
        <div
          data-testid="real-badge"
          className="pointer-events-none absolute left-2 top-2 z-20 max-w-[calc(100%-4rem)] rounded border border-slate-400 bg-white/95 px-2 py-1 text-xs font-medium text-slate-800 shadow"
        >
          実データ（衛星・道路・台帳）／レーダ結果は未入力／第{round}回
        </div>
      )}
    </div>
  )
}
