import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { aggregate, stat } from '../../scripts/eval3-lib.mjs'
import { EVAL3, compareGroups, goalText } from '@/apps/eval3'
import { labelPos, polar, polygonPoints, ringPoints } from '@/lib/radar'
import { ContestEval3, PortalEval3 } from '@/pages/Eval3Panels'
import { BROKEN_FILES, FIXTURE_FILES } from './eval3-fixture'

describe('第3回評価の集計', () => {
  it('stat: 平均・最小・最大・人数。不正値は除外', () => {
    expect(stat([4, 2, 3, null])).toEqual({ mean: 3, min: 2, max: 4, n: 3 })
    expect(stat([7, 1.5, null])).toBeNull()
    expect(stat([1, 2, 2])?.mean).toBe(1.67)
  })
  it('評価者が無ければ未集計', () => {
    const d = aggregate([])
    expect(d.collected).toBe(false)
    expect(d.apps).toEqual({})
  })
  it('アプリごとの平均・幅・評価者数・目標の達成数', () => {
    const d = aggregate(FIXTURE_FILES)
    expect(d.collected).toBe(true)
    expect(d.evaluatorCount).toBe(4)
    expect(d.apps['sat-alpha'].n).toBe(4)
    expect(d.apps['sat-alpha'].B[0]).toEqual({ mean: 5, min: 5, max: 5, n: 4 })
    expect(d.apps['sat-b'].C['C-SAT3']).toEqual({ mean: 2, min: 2, max: 2, n: 4 })
    expect(d.apps['sat-alpha'].goals['G8-1']).toEqual({ achieved: 3, n: 4 })
    expect(d.portal?.A[4]).toEqual({ mean: 5, min: 5, max: 5, n: 4 })
    expect(d.portal?.goals['P-1']).toEqual({ achieved: 2, n: 4 })
    expect(d.warnings).toEqual([])
  })
  it('崩れた JSON・値は警告して除外し、残りで集計する', () => {
    const d = aggregate([...FIXTURE_FILES, ...BROKEN_FILES])
    expect(d.warnings.some((w) => w.startsWith('eval-05.json') && w.includes('読めない'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('purpose 99'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('長さ 3'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('C.C-SAT1') && w.includes('9'))).toBe(true)
    expect(d.warnings.some((w) => w.includes('achieved'))).toBe(true)
    // 06 の B は除外、C-SAT2 の 3 は採用
    expect(d.apps['sat-b'].B[0]?.n).toBe(4)
    expect(d.apps['sat-b'].C['C-SAT2']).toEqual({ mean: 2.2, min: 2, max: 3, n: 5 })
    expect(d.apps['sat-b'].C['C-SAT1']?.n).toBe(4)
    expect(d.apps['sat-b'].goals['G4-1'].n).toBe(4)
    expect(d.evaluatorCount).toBe(5)
  })
  it('eval-r3.json は集計スクリプトの出力の形（0〜5 の範囲・人数が整合）', () => {
    expect(EVAL3.date).toBe('2026-11-13')
    if (!EVAL3.collected) return
    expect(EVAL3.evaluatorCount).toBeGreaterThan(0)
    expect(EVAL3.portal?.n).toBeLessThanOrEqual(EVAL3.evaluatorCount)
    for (const a of Object.values(EVAL3.apps)) {
      for (const s of [...a.B, ...Object.values(a.C)]) {
        if (!s) continue
        expect(s.min).toBeLessThanOrEqual(s.mean)
        expect(s.mean).toBeLessThanOrEqual(s.max)
        expect(s.max).toBeLessThanOrEqual(5)
        expect(s.n).toBeLessThanOrEqual(a.n)
      }
    }
  })
})

describe('レーダー座標', () => {
  it('軸0は真上、満点は半径、0 は中心', () => {
    expect(polar(0, 4, 5, 5, 100, 100, 50)).toEqual({ x: 100, y: 50 })
    expect(polar(1, 4, 5, 5, 100, 100, 50)).toEqual({ x: 150, y: 100 })
    expect(polar(2, 4, 0, 5, 100, 100, 50)).toEqual({ x: 100, y: 100 })
    expect(polar(2, 4, 2.5, 5, 100, 100, 50)).toEqual({ x: 100, y: 125 })
  })
  it('範囲外は丸め、null は中心、points 文字列', () => {
    expect(polar(0, 4, 9, 5, 100, 100, 50).y).toBe(50)
    expect(polygonPoints([5, null, 5, 5], 5, 100, 100, 50)).toBe('100,50 100,100 100,150 50,100')
    expect(ringPoints(4, 5, 5, 100, 100, 50)).toBe('100,50 150,100 100,150 50,100')
  })
  it('ラベルは外側、左右で anchor が変わる', () => {
    expect(labelPos(0, 4, 100, 100, 50, 10)).toMatchObject({ x: 100, y: 40, anchor: 'middle' })
    expect(labelPos(1, 4, 100, 100, 50, 10).anchor).toBe('start')
    expect(labelPos(3, 4, 100, 100, 50, 10).anchor).toBe('end')
  })
})

describe('比べる組', () => {
  it('衛星は sat-b と sat-alpha が組、sat-a は単独。UDC は udc-moritsuchi 単独', () => {
    const ids = compareGroups('satellite-2026').map((g) => g.map((a) => a.id))
    expect(ids[0]).toEqual(['sat-b', 'sat-alpha'])
    expect(ids).toContainEqual(['sat-a'])
    expect(compareGroups('udc-2026').map((g) => g.map((a) => a.id))).toEqual([['udc-moritsuchi']])
  })
  it('goalText', () => expect(goalText({ achieved: 3, n: 4 })).toBe('3/4名'))
})

describe('画面', () => {
  const data = aggregate(FIXTURE_FILES)
  it('未集計なら「評価中」でチャートを出さない', () => {
    render(<ContestEval3 contest="satellite-2026" data={aggregate([])} />)
    expect(screen.getByTestId('eval3-pending').textContent).toContain('評価中')
    expect(screen.queryByTestId('radar')).toBeNull()
    expect(screen.getByTestId('eval3-notice').textContent).toContain('実際の審査結果ではありません')
  })
  it('ポータルも未集計なら評価中', () => {
    render(<PortalEval3 data={aggregate([])} />)
    expect(screen.getByTestId('eval3-pending')).toBeTruthy()
    expect(screen.queryByTestId('radar')).toBeNull()
  })
  it('集計済みなら B・C のレーダー2つと表、チェックで切り替え', () => {
    render(<ContestEval3 contest="satellite-2026" data={data} />)
    expect(screen.getAllByTestId('radar')).toHaveLength(2)
    expect(screen.getAllByTestId('radar-series-sat-b')).toHaveLength(2)
    expect(screen.getAllByTestId('radar-series-sat-alpha')).toHaveLength(2)
    expect(screen.queryByTestId('radar-series-sat-a')).toBeNull()
    expect(screen.getAllByTestId('radar-table')[0].querySelector('[data-cell="sat-alpha-0"]')?.textContent).toContain('5.00')
    expect(screen.getByTestId('goal-table').querySelector('[data-cell="goal-sat-alpha-G8-1"]')?.textContent).toBe('3/4名')
    fireEvent.click(screen.getByLabelText(/今: 盛土巡視台帳/))
    expect(screen.queryByTestId('radar-series-sat-b')).toBeNull()
    expect((screen.getByLabelText(/路面下リスクの二段階調査/) as HTMLInputElement).disabled).toBe(true)
  })
  it('ポータル A のレーダーは平均＋最小・最大の幅、表に平均と幅と人数', () => {
    render(<PortalEval3 data={data} />)
    const r = screen.getByTestId('eval3-portal')
    expect(within(r).getByTestId('radar-min')).toBeTruthy()
    expect(within(r).getByTestId('radar-max')).toBeTruthy()
    expect(r.querySelector('[data-cell="portal-0"]')?.textContent).toBe('1.001〜1・4名')
    expect(r.querySelector('[data-cell="portal-goal-P-1"]')?.textContent).toBe('2/4名')
  })
})
