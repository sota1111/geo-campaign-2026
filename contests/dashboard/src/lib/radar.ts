// レーダーチャートの座標計算（SVG 自作用の純粋関数）。軸 0 は真上、時計回り。
export interface Pt { x: number; y: number }

const round = (v: number) => Math.round(v * 100) / 100

export function polar(i: number, n: number, value: number, max: number, cx: number, cy: number, r: number): Pt {
  const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
  const rr = (Math.max(0, Math.min(max, value)) / max) * r
  return { x: round(cx + rr * Math.cos(ang)), y: round(cy + rr * Math.sin(ang)) }
}

/** 値の列（null は欠測＝中心扱い）→ SVG の points 文字列 */
export function polygonPoints(values: (number | null)[], max: number, cx: number, cy: number, r: number): string {
  return values.map((v, i) => polar(i, values.length, v ?? 0, max, cx, cy, r)).map((p) => `${p.x},${p.y}`).join(' ')
}

/** 目盛りの輪（level=1..max）の points */
export function ringPoints(n: number, level: number, max: number, cx: number, cy: number, r: number): string {
  return polygonPoints(Array(n).fill(level), max, cx, cy, r)
}

/** 軸ラベルの位置と text-anchor */
export function labelPos(i: number, n: number, cx: number, cy: number, r: number, gap = 14): Pt & { anchor: 'start' | 'middle' | 'end' } {
  const p = polar(i, n, 1, 1, cx, cy, r + gap)
  const dx = p.x - cx
  return { ...p, anchor: Math.abs(dx) < 4 ? 'middle' : dx > 0 ? 'start' : 'end' }
}
