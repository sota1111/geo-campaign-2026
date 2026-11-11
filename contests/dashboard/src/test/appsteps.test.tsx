import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import {
  AppStepsProvider, currentStepIndex, progressLabel, stepProgress, stepStatuses, useAppSteps, useRegisteredSteps, type AppStep,
} from '@/components/shared/AppSteps'

const s = (id: string, done: boolean, optional = false): AppStep => ({ id, title: id, done, optional })

describe('AppSteps 判定', () => {
  it('いまここは最初の未完了の必須手順', () => {
    expect(currentStepIndex([s('a', true), s('b', false), s('c', false)])).toBe(1)
    expect(stepStatuses([s('a', true), s('b', false), s('c', false)])).toEqual(['done', 'current', 'todo'])
  })
  it('optional は「いまここ」から除外され、進捗にも数えない', () => {
    const steps = [s('a', true), s('o', false, true), s('b', false)]
    expect(currentStepIndex(steps)).toBe(2)
    expect(stepStatuses(steps)).toEqual(['done', 'todo', 'current'])
    expect(stepProgress(steps)).toEqual({ done: 1, total: 2, allDone: false })
  })
  it('必須がすべて済みなら全完了（optional が未完了でも）', () => {
    const steps = [s('a', true), s('o', false, true)]
    expect(currentStepIndex(steps)).toBe(-1)
    expect(stepProgress(steps).allDone).toBe(true)
  })
})

describe('progressLabel', () => {
  it('任意ありは任意を除外していることを明示、なしは簡潔', () => {
    const steps = [s('a', true), s('b', true), s('c', true), s('d', false), s('e', false), s('o', false, true)]
    expect(progressLabel(steps)).toBe('必須 5 のうち 3 完了（任意 1）')
    expect(progressLabel(steps.slice(0, 5))).toBe('5 のうち 3 完了')
  })
})

describe('useAppSteps', () => {
  function Page({ done, onSelect }: { done: boolean; onSelect: () => void }) {
    useAppSteps([{ id: 'a', title: '最初', done, onSelect }, { id: 'b', title: '次', done: false }])
    return null
  }
  function Probe() {
    const { steps, select } = useRegisteredSteps()
    return (
      <div>
        <span data-testid="n">{steps.length}</span>
        <span data-testid="a">{String(steps[0]?.done)}</span>
        <button onClick={() => select('a')}>go</button>
      </div>
    )
  }
  it('登録・更新・onSelect 呼び出し・アンマウントで解除', () => {
    const onSelect = vi.fn()
    const view = render(
      <AppStepsProvider>
        <Page done={false} onSelect={onSelect} />
        <Probe />
      </AppStepsProvider>,
    )
    expect(screen.getByTestId('n').textContent).toBe('2')
    expect(screen.getByTestId('a').textContent).toBe('false')
    act(() => screen.getByText('go').click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    view.rerender(
      <AppStepsProvider>
        <Page done onSelect={onSelect} />
        <Probe />
      </AppStepsProvider>,
    )
    expect(screen.getByTestId('a').textContent).toBe('true')
  })
  it('Provider がなくても壊れない', () => {
    expect(() => render(<Page done={false} onSelect={() => {}} />)).not.toThrow()
  })
})
