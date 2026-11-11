import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** 手順1つ。ページが useAppSteps で登録し、StandaloneShell の左サイドバー（スマホは上部ステッパー）に出る */
export interface AppStep {
  id: string
  title: string
  /** 補足（一行程度）。パネル見出しの下（StepLayout）に出る。サイドバーには出ない */
  hint?: string
  /** 未完了の間、サイドバーの手順の下に小さく出す一言（例: 「文面をコピーすると完了」）。完了すると消える */
  action?: string
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

/** 進捗の表示文言。任意を除外して数えていることが分かるようにする。
 *  任意あり: 「必須 5 のうち 3 完了（任意 1）」／任意なし: 「5 のうち 3 完了」 */
export function progressLabel(steps: Pick<AppStep, 'done' | 'optional'>[]): string {
  const p = stepProgress(steps as AppStep[])
  const opt = steps.filter((s) => s.optional).length
  return opt > 0 ? `必須 ${p.total} のうち ${p.done} 完了（任意 ${opt}）` : `${p.total} のうち ${p.done} 完了`
}

type PublicStep = Omit<AppStep, 'onSelect'>

export interface AppStepsOptions {
  /** いまメインに表示中の手順の id（サイドバーで「表示中」を強調） */
  activeId?: string
  /** サイドバーで手順がクリックされた時。ページが activeId を切り替える（従来の onSelect も呼ばれる） */
  onSelectStep?: (id: string) => void
  /** サイドバーのアプリ名の下に出す説明（PageHeader compact と組み合わせる） */
  description?: string
}

interface Ctx {
  steps: PublicStep[]
  activeId?: string
  description?: string
  /** StepLayout が表示中か（Shell が body スクロールを止めるために使う） */
  layoutActive: boolean
  setLayoutActive: (v: boolean) => void
  register: (steps: AppStep[], opts?: AppStepsOptions) => void
  select: (id: string) => void
}
const AppStepsContext = createContext<Ctx | null>(null)

const signature = (steps: AppStep[], opts?: AppStepsOptions) =>
  JSON.stringify([steps.map((s) => [s.id, s.title, s.hint ?? '', s.action ?? '', s.done, !!s.optional]), opts?.activeId ?? '', opts?.description ?? ''])

/** StandaloneShell が使う。登録された手順（onSelect を除く）を保持する */
export function AppStepsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ steps: PublicStep[]; activeId?: string; description?: string }>({ steps: [] })
  const [layoutActive, setLayoutActive] = useState(false)
  const handlers = useRef<Record<string, (() => void) | undefined>>({})
  const onSelectStep = useRef<((id: string) => void) | undefined>(undefined)
  const sig = useRef('')
  const value = useMemo<Ctx>(
    () => ({
      ...state,
      layoutActive,
      setLayoutActive,
      register: (next, opts) => {
        handlers.current = Object.fromEntries(next.map((st) => [st.id, st.onSelect]))
        onSelectStep.current = opts?.onSelectStep
        const sg = signature(next, opts)
        if (sg !== sig.current) {
          sig.current = sg
          setState({
            steps: next.map(({ onSelect: _o, ...rest }) => rest),
            activeId: opts?.activeId,
            description: opts?.description,
          })
        }
      },
      select: (id) => {
        handlers.current[id]?.()
        onSelectStep.current?.(id)
      },
    }),
    [state, layoutActive],
  )
  return <AppStepsContext.Provider value={value}>{children}</AppStepsContext.Provider>
}

/** サイドバー側が読む。Provider がなければ空 */
export function useRegisteredSteps() {
  const ctx = useContext(AppStepsContext)
  return {
    steps: ctx?.steps ?? [],
    activeId: ctx?.activeId,
    description: ctx?.description,
    layoutActive: ctx?.layoutActive ?? false,
    select: ctx?.select ?? (() => {}),
  }
}

/** StepLayout が使う。マウント中は Shell が body のスクロールを止める（デスクトップ） */
export function useLayoutActiveFlag() {
  const ctx = useContext(AppStepsContext)
  const set = ctx?.setLayoutActive
  useEffect(() => {
    set?.(true)
    return () => set?.(false)
  }, [set])
}

/**
 * ページが手順を登録する。毎レンダーで最新を渡す（done は状態から計算）。登録しなくても、Provider がなくても壊れない。
 *
 *   useAppSteps(
 *     [
 *       { id: 'place', title: '場所を選ぶ', done: !!point },
 *       { id: 'copy',  title: '結論をコピー', done: copied },
 *       { id: 'share', title: '共有メモを書く', done: false, optional: true },
 *     ],
 *     { activeId, onSelectStep: setActiveId },
 *   )
 */
export function useAppSteps(steps: AppStep[], opts?: AppStepsOptions) {
  const ctx = useContext(AppStepsContext)
  const reg = useRef(ctx?.register)
  reg.current = ctx?.register
  useEffect(() => {
    reg.current?.(steps, opts)
  })
  useEffect(() => () => reg.current?.([]), [])
}

/** 手順の番号。必須手順だけに 1,2,3… を振り（「必須 n のうち」と一致）、任意（参考）は null */
export function stepNumbers(steps: Pick<AppStep, 'optional'>[]): (number | null)[] {
  let n = 0
  return steps.map((s) => (s.optional ? null : ++n))
}

/** 手順の見出し用ラベル: 「3」または「参考」。見つからなければ null（サイドバーの番号と同じ規則） */
export function stepBadgeText(steps: Pick<AppStep, 'id' | 'optional'>[], id: string | undefined): string | null {
  const i = steps.findIndex((s) => s.id === id)
  if (i < 0) return null
  const num = stepNumbers(steps)[i]
  return num == null ? '参考' : String(num)
}

/** 未完了の必須手順（登録順）の { id, 番号, 題名 } */
export function pendingRequired(steps: Pick<AppStep, 'id' | 'title' | 'done' | 'optional'>[]) {
  const nums = stepNumbers(steps)
  return steps
    .map((s, i) => ({ id: s.id, num: nums[i] as number, title: s.title, skip: s.done || !!s.optional }))
    .filter((x) => !x.skip)
    .map(({ id, num, title }) => ({ id, num, title }))
}

/** 「まだ済んでいない手順: 手順3「題名」ほか1件」。未完了の必須がなければ null */
export function pendingLabel(steps: Pick<AppStep, 'id' | 'title' | 'done' | 'optional'>[]): string | null {
  const p = pendingRequired(steps)
  if (!p.length) return null
  const rest = p.length - 1
  return `まだ済んでいない手順: 手順${p[0].num}「${p[0].title}」${rest > 0 ? `ほか${rest}件` : ''}`
}
