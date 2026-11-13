import type { ReactNode } from 'react'
import { stepBadgeText } from './AppSteps'
import { useLayoutActiveFlag, useRegisteredSteps } from './AppSteps'
import { useAppId } from './AppIdContext'
import { SampleStepNote } from '@/components/layout/SampleBar'

/**
 * 手順ごとの画面レイアウト。サイドバーで選んだ手順の内容だけをメインに出す（スクロールで移動しない）。
 *
 * - デスクトップ（md＝768px 以上）: ヘッダー直下からウィンドウ下端までの高さに収め、body はスクロールしない。
 *   左に手順パネル（幅 380〜440px。手順名＋1行ヒント＋枠内スクロールの本文）、右に aside（地図など常設領域）が残り幅いっぱい。
 * - スマホ: 縦並び。aside（地図）が上（高さ 38vh）、手順パネルがその下で、ページ全体がスクロールする。
 * - title の前にサイドバーと同じ番号（activeId の手順の順番。任意の参考手順は「参考」）が自動で付く。
 *   ページ側は番号なしの題名を渡すこと。
 * - notice: 1行の注意・データ範囲（ページが渡した場合のみ。全幅の帯として最上部に出る）
 *
 * aside に MapView を入れる時は className なしで構わない（高さは親に合わせて 100% になる）。
 */
export function StepLayout({
  title, hint, aside, asideClassName, notice, children,
}: { title: string; hint?: string; aside?: ReactNode; /** 地図側の追加クラス（例: スマホで小さくする） */ asideClassName?: string; notice?: ReactNode; children: ReactNode }) {
  useLayoutActiveFlag()
  const { steps, activeId } = useRegisteredSteps()
  const appId = useAppId()
  const badge = stepBadgeText(steps, activeId)
  const shownHint = hint ?? steps.find((x) => x.id === activeId)?.hint
  return (
    <div className="flex flex-col md:min-h-0 md:flex-1 md:overflow-hidden" data-testid="step-layout">
      {notice && (
        <div
          data-testid="step-notice"
          className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-950 md:truncate"
        >
          {notice}
        </div>
      )}
      <div className="flex flex-col md:min-h-0 md:flex-1 md:flex-row md:overflow-hidden">
        <section className="flex min-w-0 flex-col md:min-h-0 md:w-[clamp(380px,34vw,440px)] md:shrink-0 md:border-r">
          <div className="shrink-0 border-b px-4 py-2.5">
            <h2 className="flex items-center gap-2 text-base font-bold leading-tight">
              {badge && (
                <span
                  data-testid="step-badge"
                  className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                >
                  {badge}
                </span>
              )}
              <span className="min-w-0">{title}</span>
            </h2>
            {shownHint && <p className="mt-0.5 text-xs text-muted-foreground">{shownHint}</p>}
          </div>
          <div className="min-h-0 flex-1 p-4 md:overflow-y-auto" data-testid="step-panel-body">
            <SampleStepNote appId={appId} stepId={activeId} />
            {children}
          </div>
        </section>
        {aside && (
          <div className={`order-first h-[38vh] shrink-0 md:order-none md:h-auto md:min-w-0 md:flex-1 [&>*]:!h-full [&>*]:!rounded-none [&>*]:!border-0 ${asideClassName ?? ''}`}>
            {aside}
          </div>
        )}
      </div>
    </div>
  )
}
