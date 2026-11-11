/** テキストをファイルとして保存する（CSV / GeoJSON / JSON など）。外部送信はしない。 */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Cell = string | number | null | undefined

/** CSV 文字列（Excel で文字化けしないよう BOM 付き）。rows は 2 次元配列 */
export function toCsv(rows: Cell[][]): string {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadCsv(filename: string, rows: Cell[][]) {
  downloadText(filename, toCsv(rows), 'text/csv;charset=utf-8')
}

export function downloadGeoJson(filename: string, data: unknown) {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/geo+json')
}
