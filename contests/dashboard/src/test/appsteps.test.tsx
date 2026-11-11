import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import {
  AppStepsProvider, currentStepIndex, progressLabel, stepBadgeText, stepNumbers, stepProgress, stepStatuses, useAppSteps, useRegisteredSteps, type AppStep,
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

describe('stepNumbers / stepBadgeText', () => {
  it('必須だけに番号を振り、任意は「参考」', () => {
    const steps = [s('a', true), s('o', false, true), s('b', false)]
    expect(stepNumbers(steps)).toEqual([1, null, 2])
    expect(stepBadgeText(steps, 'b')).toBe('2')
    expect(stepBadgeText(steps, 'o')).toBe('参考')
    expect(stepBadgeText(steps, 'zzz')).toBeNull()
    expect(stepBadgeText(steps, undefined)).toBeNull()
  })
})

describe('progressLabel', () => {
  it('任意ありは任意を除外していることを明示、なしは簡潔', () => {
    const steps = [s('a', true), s('b', true), s('c', true), s('d', false), s('e', false), s('o', false, true)]
    expect(progressLabel(steps)).toBe('必須 5 のうち 3 完了（任意 1）')
    expect(progressLabel(steps.slice(0, 5))).toBe('5 のうち 3 完了')
  })
})

describe('activeId / onSelectStep', () => {
  function Page({ activeId, onSelectStep, onSelect }: { activeId: string; onSelectStep: (id: string) => void; onSelect?: () => void }) {
    useAppSteps([{ id: 'a', title: 'A', done: true, onSelect }, { id: 'b', title: 'B', done: false }], { activeId, onSelectStep, description: '説明' })
    return null
  }
  function Probe() {
    const { activeId, description, select } = useRegisteredSteps()
    return (
      <div>
        <span data-testid="active">{activeId}</span>
        <span data-testid="desc">{description}</span>
        <button onClick={() => select('b')}>pickB</button>
        <button onClick={() => select('a')}>pickA</button>
      </div>
    )
  }
  it('activeId を共有し、選択で onSelectStep と onSelect が呼ばれる。済になっても activeId は自動で変わらない', () => {
    const onSelectStep = vi.fn()
    const onSelect = vi.fn()
    render(
      <AppStepsProvider>
        <Page activeId="a" onSelectStep={onSelectStep} onSelect={onSelect} />
        <Probe />
      </AppStepsProvider>,
    )
    expect(screen.getByTestId('active').textContent).toBe('a')
    expect(screen.getByTestId('desc').textContent).toBe('説明')
    act(() => screen.getByText('pickB').click())
    expect(onSelectStep).toHaveBeenCalledWith('b')
    act(() => screen.getByText('pickA').click())
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelectStep).toHaveBeenLastCalledWith('a')
    // 手順 a は済だが、いまここは b、表示中は a のまま
    expect(currentStepIndex([s('a', true), s('b', false)])).toBe(1)
    expect(screen.getByTestId('active').textContent).toBe('a')
  })
  it('opts なしの従来の呼び方でも動く', () => {
    function Old() {
      useAppSteps([s('a', false)])
      return null
    }
    expect(() => render(<AppStepsProvider><Old /><Probe /></AppStepsProvider>)).not.toThrow()
    expect(screen.getByTestId('active').textContent).toBe('')
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
