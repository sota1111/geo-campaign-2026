import type { ReactNode } from 'react'
import { CONTESTS, getApp } from '@/apps/registry'
import { DataBadge } from './DataBadge'

/** 各アプリページの先頭に置く。registry.ts の名前・目的・データ種別を表示する。actions に出典ボタン等を渡せる */
export function PageHeader({ appId, actions }: { appId: string; actions?: ReactNode }) {
  const app = getApp(appId)
  if (!app) return null
  const contest = CONTESTS.find((c) => c.id === app.contest)
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
