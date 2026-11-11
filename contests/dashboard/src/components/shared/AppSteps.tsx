import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** 手順1つ。ページが useAppSteps で登録し、StandaloneShell の左サイドバー（スマホは上部ステッパー）に出る */
export interface AppStep {
  id: string
  title: string
  /** 補足（一行程度） */
  hint?: string
  /** 完了しているか（ページの状態から計算して渡す） */
  done: boolean
  /** true なら「任意」。「いまここ」の判定と進捗の数から除外される */
  optional?: boolean
  /** 手順をクリックした時（タブ切替・スクロールなど。ページ側が渡す） */
  onSelect?: () => void
}

export type StepStatus = 'done' | 'current' | 'todo'

/** 「いまここ」＝最初の未完了の必須手順の index。なければ -1 */
export function currentStepIndex(steps: AppStep[]): number {
  return steps.findIndex((s) => !s.done && !s.optional)
}

export function stepStatuses(steps: AppStep[]): StepStatus[] {
  const cur = currentStepIndex(steps)
  return steps.map((s, i) => (s.done ? 'done' : i === cur ? 'current' : 'todo'))
}

/** 進捗: 必須手順のうち完了した数／必須手順の数。allDone は必須がすべて完了（必須0件なら false） */
export function stepProgress(steps: AppStep[]) {
  const req = steps.filter((s) => !s.optional)
  const done = req.filter((s) => s.done).length
  return { done, total: req.length, allDone: req.length > 0 && done === req.length }
}

type PublicStep = Omit<AppStep, 'onSelect'>
interface Ctx {
  steps: PublicStep[]
  register: (steps: AppStep[]) => void
  select: (id: string) => void
}
const AppStepsContext = createContext<Ctx | null>(null)

const signature = (steps: AppStep[]) =>
  JSON.stringify(steps.map((s) => [s.id, s.title, s.hint ?? '', s.done, !!s.optional]))

/** StandaloneShell が使う。登録された手順（onSelect を除く）を保持する */
export function AppStepsProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState<PublicStep[]>([])
  const handlers = useRef<Record<string, (() => void) | undefined>>({})
  const sig = useRef('')
  const value = useMemo<Ctx>(
    () => ({
      steps,
      register: (next) => {
        handlers.current = Object.fromEntries(next.map((s) => [s.id, s.onSelect]))
        const s = signature(next)
        if (s !== sig.current) {
          sig.current = s
          setSteps(next.map(({ onSelect: _o, ...rest }) => rest))
        }
      },
      select: (id) => handlers.current[id]?.(),
    }),
    [steps],
  )
  return <AppStepsContext.Provider value={value}>{children}</AppStepsContext.Provider>
}

/** サイドバー側が読む。Provider がなければ空 */
export function useRegisteredSteps() {
  const ctx = useContext(AppStepsContext)
  return { steps: ctx?.steps ?? [], select: ctx?.select ?? (() => {}) }
}

/**
 * ページが手順を登録する。毎レンダーで最新を渡す（done は状態から計算）。登録しなくても、Provider がなくても壊れない。
 *
 *   useAppSteps([
 *     { id: 'place', title: '場所を選ぶ', done: !!point, onSelect: () => setTab('map') },
 *     { id: 'copy',  title: '結論をコピー', done: copied },
 *     { id: 'share', title: '共有メモを書く', done: false, optional: true },
 *   ])
 */
export function useAppSteps(steps: AppStep[]) {
  const ctx = useContext(AppStepsContext)
  const register = ctx?.register
  // register は steps 変化のたびに作り直されないよう ref 経由で呼ぶ
  const reg = useRef(register)
  reg.current = register
  useEffect(() => {
    reg.current?.(steps)
  })
  useEffect(() => () => reg.current?.([]), [])
}
