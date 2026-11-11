import type { ReactNode } from 'react'
import { CONTESTS, getApp } from '@/apps/registry'
import { DataBadge } from './DataBadge'

/**
 * 各アプリページの先頭に置く。registry.ts の名前・データ種別を表示する。actions に出典ボタン等を渡せる。
 * compact: 1行の小さい形（アプリ名・データ種別バッジ・出典ボタンのみ。説明文はサイドバーへ: useAppSteps の description）
 */
export function PageHeader({ appId, actions, compact }: { appId: string; actions?: ReactNode; compact?: boolean }) {
  const app = getApp(appId)
  if (!app) return null
  const contest = CONTESTS.find((c) => c.id === app.contest)
  if (compact) {
    return (
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4" data-testid="page-header-compact">
        <h1 className="truncate text-base font-bold">{app.name}</h1>
        <DataBadge kind={app.dataKind} />
        {actions && <div className="ml-auto flex shrink-0 gap-2">{actions}</div>}
      </header>
    )
  }
  return (
    <header className="mb-4 space-y-2 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold sm:text-2xl">{app.name}</h1>
        <DataBadge kind={app.dataKind} />
        <span className="text-xs text-muted-foreground">
          {contest?.short}／{app.division}
        </span>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </div>
      <p className="text-sm text-muted-foreground">{app.purpose}</p>
      <p className="text-xs text-muted-foreground">{app.dataNote}</p>
    </header>
  )
}
