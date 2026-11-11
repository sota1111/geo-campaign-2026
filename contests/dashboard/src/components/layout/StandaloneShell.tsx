import { useState, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { AppStepsProvider, useRegisteredSteps } from '@/components/shared/AppSteps'
import { HeaderSlotContext } from '@/components/shared/HeaderSlot'
import { CONTESTS, getApp } from '@/apps/registry'
import { portalUrl } from '@/lib/data'
import { StepsSidebar, StepsTopbar } from './StepsPanel'
import { SampleBar, sampleUrl } from './SampleBar'
import { AppIdContext } from '@/components/shared/AppIdContext'
import { isSampleMode } from '@/lib/sample'
import { getSample } from '@/apps/_samples'

/**
 * 独立アプリページの外枠。
 * - 細いヘッダー: 「← 統合ダッシュボード」＋コンテスト・対象者（スマホはアプリ名）。右側の差し込み口に
 *   PageHeader compact のデータ種別バッジ・出典ボタン等が入る（狭い幅では折り返す）
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
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const app = getApp(appId)
  const contest = CONTESTS.find((c) => c.id === app?.contest)
  return (
    <AppIdContext.Provider value={appId}>
    <HeaderSlotContext.Provider value={{ el: slot }}>
      <div className={layoutActive ? 'md:flex md:h-dvh md:flex-col md:overflow-hidden' : undefined}>
        <div className="sticky top-0 z-30 bg-background">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-sm md:h-10 md:flex-nowrap md:overflow-hidden md:py-0">
            <a
              href={portalUrl()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-primary hover:bg-accent"
            >
              <ArrowLeft className="size-4" />
              統合ダッシュボード
            </a>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold md:hidden">{app?.name}</span>
            <span className="hidden truncate text-xs text-muted-foreground md:inline">
              {contest?.short}／{app?.division}
            </span>
            {app && <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium sm:inline">{app.audience}</span>}
            {!isSampleMode() && getSample(appId) && (
              <a
                href={sampleUrl(appId)}
                data-testid="sample-open"
                className="hidden shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-violet-700 underline-offset-2 hover:bg-violet-50 hover:underline sm:inline"
              >
                実行サンプルを見る
              </a>
            )}
            <div ref={setSlot} className="flex min-w-0 flex-wrap items-center gap-2 max-md:basis-full md:ml-auto md:flex-nowrap" />
          </header>
          <SampleBar appId={appId} />
          <StepsTopbar />
        </div>
        <div className={layoutActive ? 'flex md:min-h-0 md:flex-1' : 'flex'}>
          <StepsSidebar appName={app?.name} />
          <main
            className={
              layoutActive
                ? 'min-w-0 flex-1 md:flex md:min-h-0 md:flex-col md:overflow-hidden'
                : 'min-w-0 flex-1 p-4 md:p-6'
            }
          >
            {children}
          </main>
        </div>
      </div>
    </HeaderSlotContext.Provider>
    </AppIdContext.Provider>
  )
}
