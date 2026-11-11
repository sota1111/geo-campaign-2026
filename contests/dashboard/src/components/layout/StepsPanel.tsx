import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  currentStepIndex, progressLabel, stepProgress, stepStatuses, useRegisteredSteps, type AppStep,
} from '@/components/shared/AppSteps'
import { cn } from '@/lib/utils'

type Steps = Omit<AppStep, 'onSelect'>[]

function ProgressLine({ steps }: { steps: Steps }) {
  const p = stepProgress(steps as AppStep[])
  return (
    <div className="space-y-1" data-testid="steps-progress">
      <p className="text-xs font-medium">
        {progressLabel(steps as AppStep[])}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
      </div>
      {p.allDone && <p className="text-xs font-medium text-sky-800">目的に必要な手順はすべて完了しました</p>}
    </div>
  )
}

function StepList({ steps, onPick }: { steps: Steps; onPick?: () => void }) {
  const { select, activeId } = useRegisteredSteps()
  const status = stepStatuses(steps as AppStep[])
  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const st = status[i]
        return (
          <li key={s.id}>
            <button
              type="button"
              data-step={s.id}
              data-status={st}
              data-active={s.id === activeId ? 'true' : undefined}
              aria-selected={s.id === activeId || undefined}
              aria-current={st === 'current' ? 'step' : undefined}
              onClick={() => {
                select(s.id)
                onPick?.()
              }}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border-l-4 border-transparent px-2 py-1.5 text-left text-sm hover:bg-accent',
                s.id === activeId && 'border-primary bg-accent font-semibold',
                st === 'current' && 'font-semibold',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                  st === 'done' && 'border-sky-700 bg-sky-700 text-white',
                  st === 'current' && 'border-primary bg-primary text-primary-foreground',
                  st === 'todo' && 'text-muted-foreground',
                )}
              >
                {st === 'done' ? <Check className="size-3" aria-label="済" /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug">
                  {s.title}
                  {s.optional && <span className="ml-1 rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">任意</span>}
                </span>
                {st === 'current' && <span className="block text-[11px] font-normal text-primary">いまここ（次にやる手順）</span>}
                {s.id === activeId && <span className="block text-[11px] font-normal text-muted-foreground">表示中</span>}
                {s.hint && <span className="block text-xs font-normal text-muted-foreground">{s.hint}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** デスクトップ（md 以上）の左サイドバー。手順が未登録なら何も出さない */
export function StepsSidebar({ appName }: { appName?: string }) {
  const { steps, description } = useRegisteredSteps()
  if (!steps.length) return null
  return (
    <aside
      aria-label="進め方"
      className="sticky top-10 hidden h-[calc(100vh-2.5rem)] w-60 shrink-0 space-y-3 self-start overflow-y-auto border-r bg-sidebar p-3 md:block"
    >
      <div>
        {appName && <p className="text-sm font-bold leading-tight">{appName}</p>}
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        <p className="mt-1 text-xs text-muted-foreground">この順に進めると目的を達成できます</p>
      </div>
      <ProgressLine steps={steps} />
      <StepList steps={steps} />
    </aside>
  )
}

/** スマホ（md 未満）の上部ステッパー。いまここの手順名＋進捗、タップで一覧 */
export function StepsTopbar() {
  const { steps } = useRegisteredSteps()
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  const cur = currentStepIndex(steps as AppStep[])
  const p = stepProgress(steps as AppStep[])
  const label = p.allDone ? '目的に必要な手順はすべて完了しました' : `手順 ${cur + 1}：${steps[cur]?.title ?? ''}`
  return (
    <div className="sticky top-10 z-20 border-b bg-sidebar md:hidden" data-testid="steps-topbar">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <span className="max-w-[45%] shrink-0 text-right text-xs leading-tight text-muted-foreground">{progressLabel(steps as AppStep[])}</span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto border-t p-3">
          <p className="text-xs text-muted-foreground">この順に進めると目的を達成できます</p>
          <ProgressLine steps={steps} />
          <StepList steps={steps} onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
