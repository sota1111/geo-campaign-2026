import maplibregl from 'maplibre-gl'
import { OVERLAYS, VISIBILITY, gsiLink, overlayTileUrl, type LoreItem, type MemoryRecord } from './logic'

const ICHIRAN = 'https://maps.gsi.go.jp/development/ichiran.html'

/** 選んだ重ね合わせだけを地図に載せる（他は外す）。背景切替で style が作り直された後にも呼ぶ */
export function applyOverlay(map: maplibregl.Map, selectedId: string, opacity: number) {
  try {
    for (const o of OVERLAYS) {
      if (o.id === 'none') continue
      const lid = `ovl-${o.id}`
      if (o.id !== selectedId) {
        if (map.getLayer(lid)) map.removeLayer(lid)
        if (map.getSource(lid)) map.removeSource(lid)
        continue
      }
      if (!map.getSource(lid)) {
        map.addSource(lid, {
          type: 'raster', tileSize: 256, minzoom: o.minzoom, maxzoom: o.maxzoom, tiles: [overlayTileUrl(o)],
          attribution: `<a href="${ICHIRAN}">国土地理院（地理院タイル：${o.label}）</a>`,
        })
      }
      if (!map.getLayer(lid)) {
        // 点・円などのベクタ層より下に入れる
        const before = map.getStyle().layers.find((l) => l.type !== 'raster')?.id
        map.addLayer({ id: lid, type: 'raster', source: lid, paint: { 'raster-opacity': opacity } }, before)
      } else {
        map.setPaintProperty(lid, 'raster-opacity', opacity)
      }
    }
  } catch {
    /* スタイル読み込み中。style.load で再適用される */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag)
  if (text != null) e.textContent = text
  if (cls) e.className = cls
  return e
}
function line(parent: HTMLElement, text: string, cls?: string) {
  const d = el('div', text, cls)
  parent.appendChild(d)
  return d
}

/** ポップアップは textContent で組み立てる（記録の文字列を HTML として解釈しない） */
export function lorePopup(map: maplibregl.Map, it: LoreItem) {
  const root = el('div', undefined, 'text-[13px] leading-relaxed')
  line(root, `${it.name}（${it.year}年建立）`, 'font-bold')
  line(root, `種類: ${it.kind}`)
  line(root, `災害: ${it.disaster}`)
  line(root, `所在: ${it.address}`)
  line(root, it.info.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'))
  const a = el('a', '地理院地図で見る（写真もここで確認）', 'underline text-blue-700')
  a.href = gsiLink(it.lon, it.lat, 17)
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  root.appendChild(a)
  line(root, '出典: 国土地理院 自然災害伝承碑（実データ）', 'text-[11px] text-neutral-600')
  return new maplibregl.Popup({ maxWidth: '300px', offset: 14 }).setLngLat([it.lon, it.lat]).setDOMContent(root).addTo(map)
}

export function recordPopup(map: maplibregl.Map, r: MemoryRecord) {
  const root = el('div', undefined, 'text-[13px] leading-relaxed')
  line(root, `${r.placeName}（${r.placeType}）`, 'font-bold')
  line(root, `${r.verified ? `確認済み（${r.verifiedBy}）` : '未確認'}・確からしさ: ${r.certainty}`)
  line(root, r.story)
  line(root, `出典: ${r.basis}`)
  line(root, `語り手: ${r.teller}`)
  line(root, `公開範囲: ${VISIBILITY[r.visibility]}・${r.license}`)
  return new maplibregl.Popup({ maxWidth: '300px', offset: 14 }).setLngLat([r.lon, r.lat]).setDOMContent(root).addTo(map)
}

/* マーカー。色（Okabe-Ito）だけに頼らず、形・枠線・文字でも区別する */
function pin(text: string, cls: string, label: string) {
  const b = el('button', text, cls)
  b.type = 'button'
  b.setAttribute('aria-label', label)
  return b
}
const BASE = 'max-w-[9rem] truncate rounded-md px-2 py-1 text-xs font-bold shadow cursor-pointer '

export function placePin(name: string, selected: boolean) {
  return pin(
    name,
    BASE + 'bg-[#D55E00] text-white border-2 ' + (selected ? 'border-black ring-2 ring-white' : 'border-white'),
    `地名 ${name}（サンプル・架空）を選ぶ`,
  )
}
export function recordPin(r: MemoryRecord) {
  return pin(
    (r.verified ? '✓ ' : '？ ') + r.placeName,
    BASE + 'bg-white text-[#7a3a62] border-2 border-[#CC79A7] ' + (r.verified ? '' : 'border-dashed'),
    `残した記録 ${r.placeName}${r.verified ? '（確認済み）' : '（未確認）'}`,
  )
}
export function newPin() {
  return pin('＋', 'size-8 rounded-full bg-white text-lg font-bold leading-none text-black border-4 border-black shadow', '新しい地名の位置')
}
