import { useEffect, useRef, type ReactNode } from 'react'
import { currentStepIndex, stepBadgeText, stepNumbers, type AppStep } from './AppSteps'
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
  const { steps, activeId, select } = useRegisteredSteps()
  const appId = useAppId()
  const badge = stepBadgeText(steps, activeId)
  const shownHint = hint ?? steps.find((x) => x.id === activeId)?.hint
  // 表示中の手順が済んだら、次に残っている必須手順へ進むボタンを見出しの下に出す（確定・保存しても画面は自動で切り替わらないため）
  const active = steps.find((x) => x.id === activeId)
  const curIdx = currentStepIndex(steps as AppStep[])
  // 操作で済む手順（action のある手順）だけに出す。見ただけで済む手順は開いた瞬間に済むため出さない（本文の次へボタン・サイドバーの「次はこれ」と重ならないように）
  const next = active?.done && active.action && curIdx >= 0 && steps[curIdx].id !== activeId ? steps[curIdx] : null
  const nextIsBack = next ? curIdx < steps.findIndex((x) => x.id === activeId) : false
  const nextNum = next ? stepNumbers(steps)[curIdx] : null
  // 手順を切り替えたら本文を先頭から見せる（前の手順のスクロール位置が残ると、上部の操作が隠れる）
  const bodyRef = useRef<HTMLDivElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const firstRun = useRef(true)
  useEffect(() => {
    bodyRef.current?.scrollTo?.({ top: 0 })
    // スマホはページ全体がスクロールする。手順を替えたら手順の見出しが見える位置へ（最初の表示では動かさない）
    if (firstRun.current) { firstRun.current = false; return }
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches) {
      sectionRef.current?.scrollIntoView?.({ block: 'start' })
    }
  }, [activeId])
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
        <section ref={sectionRef} className="flex min-w-0 scroll-mt-24 flex-col md:min-h-0 md:w-[clamp(380px,34vw,440px)] md:shrink-0 md:border-r">
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
            {next && (
              <button
                type="button"
                onClick={() => select(next.id)}
                data-testid="step-next"
                className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-primary bg-primary/5 px-2 py-1 text-left text-xs font-medium text-primary hover:bg-primary/10"
              >
                <span aria-hidden>✓</span>
                <span className="min-w-0">この手順は済みました。{nextIsBack ? `残っている手順 ${nextNum}「${next.title}」へ戻る` : `次の手順 ${nextNum}「${next.title}」へ進む`}<span aria-hidden className="whitespace-nowrap">&nbsp;→</span></span>
              </button>
            )}
          </div>
          <div ref={bodyRef} className="min-h-0 flex-1 p-4 md:overflow-y-auto" data-testid="step-panel-body">
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
