import { isSampleMode, SAMPLE_MARK, withSampleMarkCsv } from '@/lib/sample'

/** CSV 用。BOM 付きの CSV でも BOM を先頭に保ったまま、サンプル中だけ印の行を付ける（通常は csv をそのまま返す） */
export function markCsv(csv: string): string {
  if (!isSampleMode()) return csv
  const hasBom = csv.startsWith('﻿')
  const marked = withSampleMarkCsv(hasBom ? csv.slice(1) : csv)
  return hasBom ? '﻿' + marked : marked
}

/** GeoJSON 用。サンプル中だけ、先頭の注記（sample_notice）と各地物の properties に印を付ける（通常は gj をそのまま返す） */
export function markGeoJson<T extends { features?: { properties?: Record<string, unknown> | null }[] }>(gj: T): T {
  if (!isSampleMode()) return gj
  return {
    sample_notice: SAMPLE_MARK,
    ...gj,
    features: (gj.features ?? []).map((f) => ({ ...f, properties: { sample_notice: SAMPLE_MARK, ...(f.properties ?? {}) } })),
  } as T
}
