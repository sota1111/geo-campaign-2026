import { describe, expect, it } from 'vitest'
import { DECISIONS, PLANS, commanderTasks, groupByDeadline } from '@/data/progress'
import { CONTEST_STATUS, crossItems } from '@/data/status'
import { CONTESTS, getApp } from '@/apps/registry'

describe('進捗データ（参謀長が更新する表）', () => {
  it('案の id が重複せず、appId は registry に実在し、コンペも実在する', () => {
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(PLANS.length)
    for (const p of PLANS) {
      if (p.appId) expect(getApp(p.appId), p.id).toBeTruthy()
      expect(CONTESTS.some((c) => c.id === p.contest), p.id).toBe(true)
      expect(p.done.length).toBeGreaterThan(0)
      expect(p.todo.length).toBeGreaterThan(0)
    }
  })
  it('総司令官の作業は締切順に並び、締切ごとにまとまる', () => {
    const t = commanderTasks()
    expect(t.length).toBeGreaterThan(0)
    const times = t.map((r) => Date.parse(r.plan.deadlineAt))
    expect([...times].sort((a, b) => a - b)).toEqual(times)
    const g = groupByDeadline(t)
    expect(new Set(g.map((x) => x.at)).size).toBe(g.length)
    expect(t.every((r) => r.task.owner === '総司令官')).toBe(true)
  })
  it('判断待ちは正本どおり6件で、締切のあるものは締切順', () => {
    expect(DECISIONS).toHaveLength(6)
    const dated = DECISIONS.filter((d) => d.deadlineAt).map((d) => Date.parse(d.deadlineAt!))
    expect([...dated].sort((a, b) => a - b)).toEqual(dated)
  })
  it('各コンペの状況は次にやることが3つ以内、横断一覧は締切順で締切なしが最後', () => {
    for (const c of CONTESTS) {
      const s = CONTEST_STATUS[c.id]
      expect(s.gap.length).toBeGreaterThan(0)
      expect(s.next.length).toBeGreaterThan(0)
      expect(s.next.length).toBeLessThanOrEqual(3)
    }
    const t = crossItems().map((x) => (x.at ? Date.parse(x.at) : Infinity))
    expect([...t].sort((a, b) => a - b)).toEqual(t)
    expect(crossItems().at(-1)?.at).toBeUndefined()
  })
  it('案ごとに提出の見込みがあり、新しい案は「提出予定」にならない', () => {
    for (const p of PLANS) expect(['提出予定', '比較中', '出さない']).toContain(p.intent)
    expect(PLANS.find((p) => p.id === 'udc-3')?.intent).toBe('出さない')
    expect(PLANS.filter((p) => p.kind.startsWith('新しい案')).every((p) => p.intent !== '提出予定')).toBe(true)
  })
  it('AED マップ（udc-aed）は UDC のコンペに属さない（UDC には登録しない決定）', () => {
    expect(getApp('udc-aed')?.contest).toBe('ichibiz-2026')
    expect(PLANS.find((p) => p.id === 'udc-3')?.decided).toMatch(/UDC には登録しない/)
  })
})
