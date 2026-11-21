import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ContestPage from '@/pages/ContestPage'
import Portal from '@/pages/Portal'
import { CONTEST_INFO } from '@/apps/contests-info'
import { TARGETS_KEY, loadTargets, planView } from '@/lib/fit'
import { planSentence } from '@/components/shared/PlanCount'

const save = (targets: Record<string, string[]>) => window.localStorage.setItem(TARGETS_KEY, JSON.stringify({ version: 1, targets }))

describe('提出予定数（総司令官の決定 2026-11-21）', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(cleanup)

  it('データ: 衛星2（スポンサー1・一般1）、イチBiz 3（部門ごと1）、UDC と ODPT は未定（数を作らない）', () => {
    const p = (id: string) => CONTEST_INFO.find((c) => c.id === id)!.planned
    expect(p('satellite-2026').total).toBe(2)
    expect(p('satellite-2026').parts.map((x) => [x.label, x.count])).toEqual([['スポンサー', 1], ['一般', 1]])
    expect(p('ichibiz-2026').total).toBe(3)
    expect(p('ichibiz-2026').parts.map((x) => x.count)).toEqual([1, 1, 1])
    expect(p('udc-2026').total).toBeNull()
    expect(p('odpt-2026').total).toBeNull()
    expect(p('udc-2026').parts).toEqual([])
  })

  it('比べ: 足りない・予定どおり・超過を、記号と言葉で言い分ける', () => {
    expect(planSentence(planView('satellite-2026', {}))).toBe('提出予定 2件（スポンサー1・一般1）／選んだ 0件 ▼あと2件で予定')
    expect(planSentence(planView('satellite-2026', { 'sat-a': ['satellite-2026'] }))).toBe('提出予定 2件（スポンサー1・一般1）／選んだ 1件 ▼あと1件で予定')
    expect(planView('satellite-2026', { 'sat-a': ['satellite-2026'], 'sat-b': ['satellite-2026'] }).state).toBe('match')
    expect(planSentence(planView('satellite-2026', { 'sat-a': ['satellite-2026'], 'sat-b': ['satellite-2026'], 'sat-alpha': ['satellite-2026'] }))).toContain('▲予定より1件多い')
    expect(planSentence(planView('udc-2026', {}))).toBe('提出予定 未定／選んだ 0件')
    expect(planView('udc-2026', {}).state).toBe('undecided')
  })

  it('比べ: イチBiz は部門ごとに予定1・選んだN', () => {
    const v = planView('ichibiz-2026', { 'biz-business': ['ichibiz-2026-business'], 'biz-idea': ['ichibiz-2026-idea'] })
    expect(v.chosen).toBe(2)
    expect(v.state).toBe('short')
    expect(v.parts.map((x) => [x.label, x.planned, x.chosen, x.state])).toEqual([
      ['ビジネス', 1, 1, 'match'], ['アイデア', 1, 1, 'match'], ['不動産', 1, 0, 'short'],
    ])
  })

  it('既存の下書き（localStorage）をそのまま読み、件数を数える（形式は変えていない）', () => {
    save({ 'sat-a': ['satellite-2026'] })
    expect(loadTargets()).toEqual({ 'sat-a': ['satellite-2026'] })
    render(<Portal />)
    expect(screen.getByTestId('planned-satellite-2026').textContent).toContain('提出予定 2件（スポンサー1・一般1）／選んだ 1件')
    expect(screen.getByTestId('planned-satellite-2026').textContent).toContain('▼あと1件で予定')
    expect(screen.getByTestId('planned-udc-2026').textContent).toContain('提出予定 未定／選んだ 0件')
    expect(screen.getByTestId('planned-odpt-2026').textContent).toContain('提出予定 未定')
    expect(screen.getByTestId('planned-ichibiz-2026').textContent).toContain('提出予定 3件')
  })

  it('トップ: 部門ごと「予定1・選んだN」と状態の記号が出る', () => {
    save({ 'biz-idea': ['ichibiz-2026-idea'], 'biz-realestate': ['ichibiz-2026-realestate', 'ichibiz-2026-idea'] })
    render(<Portal />)
    const t = (k: string) => screen.getByTestId(`planned-part-ichibiz-2026-${k}`).textContent
    expect(t('ビジネス')).toContain('予定1・選んだ0')
    expect(t('ビジネス')).toContain('▼')
    expect(t('アイデア')).toContain('予定1・選んだ2')
    expect(t('アイデア')).toContain('▲')
    expect(t('不動産')).toContain('✓')
  })

  it('並び順の説明: コンペを選ぶと「このコンペを提出先に選んだ候補（N件）が先」。N は「選んだ N件」と同じ数え方', () => {
    save({ 'sat-sugi': ['satellite-2026'], 'biz-idea': ['ichibiz-2026-idea'] })
    render(<Portal />)
    expect(screen.getByTestId('sort-note').textContent).toContain('選んだ候補（2件）が先')
    fireEvent.click(screen.getByTestId('pick-satellite-2026'))
    expect(screen.getByTestId('sort-note').textContent).toContain('このコンペを提出先に選んだ候補（1件）が先')
    expect(screen.getByTestId('planned-satellite-2026').textContent).toContain('選んだ 1件')
    const order = [...document.querySelectorAll('[data-testid="app-row"] > li')].map((e) => e.getAttribute('data-app-card'))
    expect(order[0]).toBe('sat-sugi')
    expect(order.indexOf('biz-idea')).toBeGreaterThan(0)
  })

  it('概要ページ: 提出予定数の節があり、要項の上限とは別と書く', () => {
    save({ 'sat-a': ['satellite-2026'] })
    const html = renderToStaticMarkup(<ContestPage contestId="satellite-2026" />)
    expect(html).toContain('contest-planned')
    expect(html).toContain('提出予定 2件')
    expect(html).toContain('要項の上限である下の「提出可能数」とは別')
    expect(html).toContain('2026-11-21 総司令官の指示')
    const udc = renderToStaticMarkup(<ContestPage contestId="udc-2026" />)
    expect(udc).toContain('提出予定 未定')
    expect(udc).toContain('数は作っていません')
  })
})
