import type { ReactNode } from 'react'
import { useLayoutActiveFlag } from './AppSteps'

/**
 * 手順ごとの画面レイアウト。サイドバーで選んだ手順の内容だけをメインに出す（スクロールで移動しない）。
 *
 * - デスクトップ（md＝768px 以上）: ヘッダー直下からウィンドウ下端までの高さ（100dvh − ヘッダー。Shell の main が flex 列になり、
 *   PageHeader compact があればその残り）に収め、body はスクロールしない。左に手順パネル（幅 380〜440px。手順名＋1行ヒント＋枠内スクロールの本文）、
 *   右に aside（地図など常設領域）が残り幅いっぱいに並ぶ。
 * - スマホ: 縦並び。aside（地図）が上（高さ 38vh）、手順パネルがその下で、ページ全体がスクロールする。
 *
 * aside に MapView を入れる時は className なしで構わない（高さは親に合わせて 100% になる）。
 */
export function StepLayout({
  title, hint, aside, children,
}: { title: string; hint?: string; aside?: ReactNode; children: ReactNode }) {
  useLayoutActiveFlag()
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row md:overflow-hidden" data-testid="step-layout">
      <section className="flex min-w-0 flex-col md:min-h-0 md:w-[clamp(380px,34vw,440px)] md:shrink-0 md:border-r">
        <div className="shrink-0 border-b px-4 py-2.5">
          <h2 className="text-base font-bold leading-tight">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="min-h-0 flex-1 p-4 md:overflow-y-auto" data-testid="step-panel-body">
          {children}
        </div>
      </section>
      {aside && (
        <div className="order-first h-[38vh] shrink-0 md:order-none md:h-auto md:min-w-0 md:flex-1 [&>*]:!h-full [&>*]:!rounded-none [&>*]:!border-0">
          {aside}
        </div>
      )}
    </div>
  )
}
