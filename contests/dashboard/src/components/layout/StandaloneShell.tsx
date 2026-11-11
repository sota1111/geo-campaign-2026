import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { CONTESTS, getApp } from '@/apps/registry'
import { portalUrl } from '@/lib/data'

/** 独立アプリページの外枠: 細いヘッダー（ポータルへ戻るリンク・名前・コンテスト・対象者・データ種別）＋ Toaster ＋ TooltipProvider */
export function StandaloneShell({ appId, children }: { appId: string; children: ReactNode }) {
  const app = getApp(appId)
  const contest = CONTESTS.find((c) => c.id === app?.contest)
  return (
    <TooltipProvider>
      <header className="sticky top-0 z-30 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-background px-3 py-1.5 text-sm">
        <a
          href={portalUrl()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          統合ダッシュボード
        </a>
        <span className="text-muted-foreground" aria-hidden>
          |
        </span>
        <span className="font-bold">{app?.name}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {contest?.short}／{app?.division}
        </span>
        {app && <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">{app.audience}</span>}
        {app && <DataBadge kind={app.dataKind} />}
      </header>
      <main className="min-w-0 p-4 md:p-6">{children}</main>
      <Toaster />
    </TooltipProvider>
  )
}
