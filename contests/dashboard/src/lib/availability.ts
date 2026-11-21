import { useEffect, useState } from 'react'
import { siteRoot } from '@/lib/data'
import type { AppMeta } from '@/apps/registry'

/**
 * 元のソースが PR にだけある案（registry の pendingPr）が、このビルドに含まれているか。
 * copy-data が書く embedded/availability.json（id → 含まれているか）を読む。
 * 読めない間・ファイルが無いときは「含まれている」とみなす（案内を誤って出さない）。
 */
let cache: Promise<Record<string, boolean>> | null = null
function load(): Promise<Record<string, boolean>> {
  if (!cache) {
    cache = fetch(`${siteRoot()}embedded/availability.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, boolean>>) : {}))
      .catch(() => ({}))
  }
  return cache
}

/** 'unknown' = まだ読めていない（審査待ちの案のみ）、'missing' = 審査待ちで、このビルドに含まれていない */
export type Presence = 'present' | 'unknown' | 'missing'

export function usePresence(app: Pick<AppMeta, 'id' | 'pendingPr'> | undefined): Presence {
  const [map, setMap] = useState<Record<string, boolean> | null>(null)
  useEffect(() => {
    if (!app?.pendingPr) return
    let live = true
    load().then((m) => live && setMap(m))
    return () => { live = false }
  }, [app?.id, app?.pendingPr])
  if (!app?.pendingPr) return 'present'
  if (!map) return 'unknown'
  return map[app.id] === false ? 'missing' : 'present'
}

/** その案が審査待ちのため、このビルドに含まれていないなら true */
export function useIsPending(app: Pick<AppMeta, 'id' | 'pendingPr'> | undefined): boolean {
  return usePresence(app) === 'missing'
}

/** 審査待ちの案内文（ページ・カード共通） */
export function pendingText(app: Pick<AppMeta, 'pendingPr'>): string {
  return `元のアプリは ${app.pendingPr} で審査待ちのため、このビルドには含まれていません。${app.pendingPr} がマージされれば、次のビルドで自動的に表示されます。`
}

/** 審査待ちの案の目印の言葉（サイドバー・カード・ページで共通） */
export function pendingLabel(app: Pick<AppMeta, 'pendingPr'>): string {
  return `審査待ち（${app.pendingPr}）・未収録`
}

/** 渡した案のうち、審査待ちで、このビルドに含まれていない案の PR 番号（重複なし）。無ければ空 */
export function useMissingPrs(ids: { id: string; pendingPr?: string }[]): string[] {
  const [map, setMap] = useState<Record<string, boolean> | null>(null)
  const has = ids.some((a) => a.pendingPr)
  useEffect(() => {
    if (!has) return
    let live = true
    load().then((m) => live && setMap(m))
    return () => { live = false }
  }, [has])
  if (!map) return []
  return [...new Set(ids.filter((a) => a.pendingPr && map[a.id] === false).map((a) => a.pendingPr as string))]
}
