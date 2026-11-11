import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CONTESTS, getApp } from '@/apps/registry'
import { DataBadge } from './DataBadge'
import { HeaderSlotContext } from './HeaderSlot'

/**
 * 各アプリページの先頭に置く。registry.ts の名前・データ種別を表示する。actions に出典ボタン等を渡せる。
 * compact: 自分の行を持たず、データ種別バッジと actions を StandaloneShell の細いヘッダー（「← 統合ダッシュボード」の行）の
 *   右側に描画する（アプリ名はサイドバー上端／スマホは上部バー。説明文は useAppSteps の description）。
 *   Shell の外で使うと、従来どおり1行で自分の場所に出す。
 */
export function PageHeader({ appId, actions, compact }: { appId: string; actions?: ReactNode; compact?: boolean }) {
  const slot = useContext(HeaderSlotContext)
  const app = getApp(appId)
  if (!app) return null
  const contest = CONTESTS.find((c) => c.id === app.contest)
  if (compact) {
    const content = (
      <>
        <DataBadge kind={app.dataKind} />
        {actions}
      </>
    )
    if (slot) return slot.el ? createPortal(content, slot.el) : null
    return (
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1" data-testid="page-header-compact">
        <h1 className="min-w-[8rem] truncate text-base font-bold">{app.name}</h1>
        {content}
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
