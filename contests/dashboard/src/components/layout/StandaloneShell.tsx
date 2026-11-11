import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppStepsProvider, useRegisteredSteps } from '@/components/shared/AppSteps'
import { CONTESTS, getApp } from '@/apps/registry'
import { portalUrl } from '@/lib/data'
import { StepsSidebar, StepsTopbar } from './StepsPanel'

/**
 * 独立アプリページの外枠。
 * - 細いヘッダー: 「← 統合ダッシュボード」＋コンテスト・対象者（名前とデータ種別は各ページの PageHeader が出す）
 * - 手順が登録されたページ（useAppSteps）は、デスクトップは左サイドバー、スマホは上部の折りたたみステッパー
 * - Toaster ＋ TooltipProvider
 */
export function StandaloneShell({ appId, children }: { appId: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppStepsProvider>
        <ShellBody appId={appId}>{children}</ShellBody>
        <Toaster />
      </AppStepsProvider>
    </TooltipProvider>
  )
}

function ShellBody({ appId, children }: { appId: string; children: ReactNode }) {
  const { layoutActive } = useRegisteredSteps()
  const app = getApp(appId)
  const contest = CONTESTS.find((c) => c.id === app?.contest)
  return (
    <div className={layoutActive ? 'md:h-dvh md:overflow-hidden' : undefined}>
      <header className="sticky top-0 z-30 flex h-10 items-center gap-x-3 overflow-hidden border-b bg-background px-3 text-sm">
        <a
          href={portalUrl()}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent"
        >
          <ArrowLeft className="size-4" />
          統合ダッシュボード
        </a>
        <span className="truncate text-xs text-muted-foreground">
          {contest?.short}／{app?.division}
        </span>
        {app && <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium sm:inline">{app.audience}</span>}
      </header>
      <StepsTopbar />
      <div className="flex">
        <StepsSidebar appName={app?.name} />
        <main
          className={
            layoutActive
              ? 'min-w-0 flex-1 md:flex md:h-[calc(100dvh-2.5rem)] md:flex-col md:overflow-hidden'
              : 'min-w-0 flex-1 p-4 md:p-6'
          }
        >
          {children}
        </main>
      </div>
    </div>
  )
}
