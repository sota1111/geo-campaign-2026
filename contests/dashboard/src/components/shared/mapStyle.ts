import type { StyleSpecification } from 'maplibre-gl'

export type BasemapId = 'pale' | 'std' | 'photo'

/** 国土地理院タイル。https://maps.gsi.go.jp/development/ichiran.html */
export const GSI_BASEMAPS: Record<BasemapId, { label: string; url: string; maxzoom: number }> = {
  pale: { label: '淡色', url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', maxzoom: 18 },
  std: { label: '標準', url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', maxzoom: 18 },
  photo: { label: '写真', url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', maxzoom: 18 },
}

/** 'none' は背景地図なし（白地）。独自の画像・タイルだけを見せたい時 */
export type MapBase = BasemapId | 'none'

export function buildStyle(base: MapBase): StyleSpecification {
  if (base === 'none') {
    return { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4f4f5' } }] }
  }
  const b = GSI_BASEMAPS[base]
  return {
    version: 8,
    sources: {
      gsi: { type: 'raster', tiles: [b.url], tileSize: 256, maxzoom: b.maxzoom, attribution: '国土地理院' },
    },
    layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
  }
}
