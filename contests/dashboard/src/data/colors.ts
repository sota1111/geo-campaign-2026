import type { ContestId } from '@/apps/registry'

/**
 * コンペごとの色（トップの大カードとコンペ概要ページの見出し）。色だけで区別せず、コンペ名の言葉と記号を必ず併用する。
 * 帯は白文字で WCAG AA（4.5:1）以上になる濃い色、淡い面は濃い文字で AA 以上。赤と緑の対比は使わない（青・橙・紫・青緑）。
 *  sky-800 #075985 / orange-700 #c2410c / violet-800 #5b21b6 / teal-800 #115e59（いずれも白との比 5:1 以上）
 */
export interface ContestColor {
  /** 帯（白文字） */
  band: string
  /** 淡い面と枠 */
  tint: string
  /** 小カードの左の太線 */
  edge: string
  /** 記号 */
  mark: string
}

const COLORS: Record<ContestId, ContestColor> = {
  'satellite-2026': { band: 'bg-sky-800 text-white', tint: 'bg-sky-50 border-sky-700', edge: 'border-l-sky-700', mark: '◆' },
  'ichibiz-2026': { band: 'bg-orange-700 text-white', tint: 'bg-orange-50 border-orange-700', edge: 'border-l-orange-700', mark: '●' },
  'udc-2026': { band: 'bg-violet-800 text-white', tint: 'bg-violet-50 border-violet-800', edge: 'border-l-violet-800', mark: '■' },
  'odpt-2026': { band: 'bg-teal-800 text-white', tint: 'bg-teal-50 border-teal-800', edge: 'border-l-teal-800', mark: '✦' },
}

export function contestColor(id: ContestId): ContestColor {
  return COLORS[id]
}
