import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Portal from '@/pages/Portal'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('トップの大きなカード（画面いっぱい）', () => {
  it('コンペカードに、締切・判断待ち・次にやること・概要・審査基準・主なルール・提出可能数・2つの操作が出る', () => {
    render(<Portal />)
    const card = screen.getByTestId('contest-satellite-2026')
    for (const id of ['row-deadline', 'row-asks', 'card-next', 'card-summary', 'card-criteria', 'card-rules', 'card-limits']) {
      expect(within(card).getByTestId(id).textContent!.length).toBeGreaterThan(3)
    }
    expect(within(card).getByTestId('row-asks').textContent).toContain('総司令官の判断待ち')
    expect(within(card).getByTestId('pick-satellite-2026')).toBeTruthy()
    expect(within(card).getByTestId('row-satellite-2026').getAttribute('href')).toContain('contest/satellite-2026')
  })
  it('アプリカードに、目的・出せるコンペの言葉・選んだ提出先・進み具合・締切・「アプリを開く」が出る', () => {
    render(<Portal />)
    const card = document.querySelector('[data-app-card="odpt"]') as HTMLElement
    expect(within(card).getByTestId('card-purpose').textContent).toContain('目的')
    expect(within(card).getByTestId('mini-mark-odpt-odpt-2026').textContent).toContain('このコンペ向け')
    expect(within(card).getByTestId('chosen-odpt').textContent).toContain('未選択')
    expect(within(card).getByTestId('plan-odpt').textContent).toMatch(/済\d+・残\d+/)
    expect(within(card).getByTestId('app-deadline-odpt').textContent).toContain('締切')
    expect(within(card).getByTestId('open-app-odpt').getAttribute('href')).toContain('apps/odpt')
  })
  it('提出先を選ぶと、カードに ✓ 選んだ提出先 が出る', () => {
    render(<Portal />)
    fireEvent.click(screen.getByTestId('pick-targets-odpt'))
    fireEvent.click(screen.getByTestId('t-odpt-odpt-2026'))
    expect(screen.getByTestId('chosen-odpt').textContent).toContain('選んだ提出先 1件')
  })
})
