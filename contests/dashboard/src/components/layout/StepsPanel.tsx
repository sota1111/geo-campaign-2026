import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  currentStepIndex, progressLabel, stepBadgeText, stepNumbers, stepProgress, stepStatuses, useRegisteredSteps,
  type AppStep, type StepStatus,
} from '@/components/shared/AppSteps'
import { cn } from '@/lib/utils'

type Steps = Omit<AppStep, 'onSelect'>[]

function ProgressLine({ steps }: { steps: Steps }) {
  const p = stepProgress(steps as AppStep[])
  return (
    <div className="space-y-1" data-testid="steps-progress">
      <p className="text-xs font-medium">{progressLabel(steps as AppStep[])}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-all" style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
      </div>
      {p.allDone && <p className="text-xs font-medium text-sky-800">目的に必要な手順はすべて完了しました</p>}
    </div>
  )
}

function StepItem({
  step, status, num, small, onPick,
}: { step: Steps[number]; status: StepStatus; num: number | null; small?: boolean; onPick?: () => void }) {
  const { select, activeId } = useRegisteredSteps()
  const active = step.id === activeId
  return (
    <li>
      <button
        type="button"
        data-step={step.id}
        data-status={status}
        data-active={active ? 'true' : undefined}
        aria-selected={active || undefined}
        aria-current={status === 'current' ? 'step' : undefined}
        onClick={() => {
          select(step.id)
          onPick?.()
        }}
        className={cn(
          'flex w-full items-start gap-2 rounded-md border-l-4 border-transparent px-2 py-1.5 text-left hover:bg-accent',
          small ? 'text-xs' : 'text-sm',
          active && 'border-primary bg-accent font-semibold',
          status === 'current' && 'font-semibold',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex shrink-0 items-center justify-center rounded-full border text-[11px]',
            small ? 'size-4 text-[9px]' : 'size-5',
            status === 'done' && 'border-sky-700 bg-sky-700 text-white',
            status === 'current' && 'border-primary bg-primary text-primary-foreground',
            status === 'todo' && 'text-muted-foreground',
          )}
        >
          {status === 'done' ? <Check className="size-3" aria-label="済" /> : num ?? '参'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block leading-snug">{step.title}</span>
          {status === 'current' && <span className="block text-[11px] font-normal text-primary">いまここ（次にやる手順）</span>}
          {active && <span className="block text-[11px] font-normal text-muted-foreground">表示中</span>}
          {step.hint && !small && <span className="block text-xs font-normal text-muted-foreground">{step.hint}</span>}
        </span>
      </button>
    </li>
  )
}

/** 必須手順は番号つきで上から。任意の手順は「参考（任意）」の見出しの下にまとめて小さく（折りたたみ可） */
function StepList({ steps, onPick }: { steps: Steps; onPick?: () => void }) {
  const { activeId } = useRegisteredSteps()
  const status = stepStatuses(steps as AppStep[])
  const nums = stepNumbers(steps)
  const optIdx = steps.map((s, i) => (s.optional ? i : -1)).filter((i) => i >= 0)
  const reqIdx = steps.map((s, i) => (s.optional ? -1 : i)).filter((i) => i >= 0)
  const activeIsOptional = optIdx.some((i) => steps[i].id === activeId)
  const [open, setOpen] = useState(activeIsOptional)
  useEffect(() => {
    if (activeIsOptional) setOpen(true)
  }, [activeIsOptional])
  return (
    <div className="space-y-2">
      <ol className="space-y-1">
        {reqIdx.map((i) => (
          <StepItem key={steps[i].id} step={steps[i]} status={status[i]} num={nums[i]} onPick={onPick} />
        ))}
      </ol>
      {optIdx.length > 0 && (
        <div className="border-t pt-2" data-testid="steps-optional">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center gap-1 px-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
            参考（任意）{optIdx.length}件
          </button>
          {open && (
            <ol className="mt-1 space-y-0.5">
              {optIdx.map((i) => (
                <StepItem key={steps[i].id} step={steps[i]} status={status[i]} num={null} small onPick={onPick} />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

/** デスクトップ（md 以上）の左サイドバー。手順が未登録なら何も出さない。手順リストはこの中でスクロールする */
export function StepsSidebar({ appName }: { appName?: string }) {
  const { steps, description } = useRegisteredSteps()
  if (!steps.length) return null
  return (
    <aside
      aria-label="進め方"
      className="sticky top-10 hidden h-[calc(100dvh-2.5rem)] w-60 shrink-0 flex-col self-start border-r bg-sidebar md:flex"
    >
      <div className="shrink-0 space-y-3 p-3 pb-2">
        <div>
          {appName && <p className="text-sm font-bold leading-tight">{appName}</p>}
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">この順に進めると目的を達成できます</p>
        </div>
        <ProgressLine steps={steps} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="steps-list">
        <StepList steps={steps} />
      </div>
    </aside>
  )
}

/**
 * スマホ（md 未満）の上部ステッパー。主表示は表示中の手順（activeId）。いまここが別の手順なら「次: 手順n」を小さく添える。
 * activeId を渡していないページは、従来どおりいまここの手順を主表示にする。タップで一覧。
 */
export function StepsTopbar() {
  const { steps, activeId } = useRegisteredSteps()
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  const all = steps as AppStep[]
  const p = stepProgress(all)
  const cur = currentStepIndex(all)
  const nums = stepNumbers(steps)
  const actIdx = activeId ? steps.findIndex((s) => s.id === activeId) : -1
  const mainIdx = actIdx >= 0 ? actIdx : cur
  const badge = mainIdx >= 0 ? stepBadgeText(steps, steps[mainIdx].id) : null
  const mainLabel =
    mainIdx < 0
      ? '完了'
      : badge === '参考'
        ? `参考：${steps[mainIdx].title}`
        : `手順 ${badge}／${p.total}：${steps[mainIdx].title}`
  const showNext = actIdx >= 0 && cur >= 0 && cur !== actIdx
  return (
    <div className="border-b bg-sidebar md:hidden" data-testid="steps-topbar">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium" data-testid="steps-topbar-main">
            {mainLabel}
          </span>
          {showNext && (
            <span className="block truncate text-[11px] text-muted-foreground" data-testid="steps-topbar-next">
              次: 手順 {nums[cur]}　{steps[cur].title}
            </span>
          )}
        </span>
        <span className="max-w-[40%] shrink-0 text-right text-xs leading-tight text-muted-foreground">
          {progressLabel(all)}
        </span>
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
