import { describe, expect, it } from 'vitest'
import { DECISIONS, PLANS, commanderTasks, groupByDeadline, isConditionalPlan } from '@/data/progress'
import { CONTEST_STATUS, crossItems } from '@/data/status'
import { CONTESTS, getApp } from '@/apps/registry'

describe('進捗データ（参謀長が更新する表）', () => {
  it('案の id が重複せず、appId は registry に実在し、コンペも実在する', () => {
    expect(new Set(PLANS.map((p) => p.id)).size).toBe(PLANS.length)
    for (const p of PLANS) {
      if (p.appId) expect(getApp(p.appId), p.id).toBeTruthy()
      expect(CONTESTS.some((c) => c.id === p.contest), p.id).toBe(true)
      expect(p.done.length).toBeGreaterThan(0)
      // 出さないと決めた案は作業を持たない（残作業は IN1 の側）
      if (p.intent !== '出さない') expect(p.todo.length).toBeGreaterThan(0)
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
  it('未選定の案の作業は本体に出ず、判断の行の下に入る。UDC 作品③の作業は IN1 側だけ', () => {
    const main = crossItems()
    const body = main.filter((x) => x.kind === 'task').map((x) => x.who)
    for (const p of PLANS.filter((x) => isConditionalPlan(x))) expect(body, p.id).not.toContain(p.short)
    const sat = main.find((x) => x.kind === 'decision' && x.contest === 'satellite-2026')
    expect(sat?.children?.map((c) => c.who)).toEqual(expect.arrayContaining(['提案B', '新案α']))
    expect(main.some((x) => x.contest === 'udc-2026' && x.text.includes('AED'))).toBe(false)
    expect(PLANS.find((p) => p.id === 'udc-3')?.todo).toEqual([])
    expect(PLANS.find((p) => p.id === 'biz-idea-in1')?.todo.some((t) => t.text.includes('アプリの公開'))).toBe(true)
  })
  it('判断待ちの担当は総司令官にそろっている', () => {
    for (const p of PLANS) for (const t of p.todo) if (t.tag === '判断待ち') expect(t.owner, t.text).toBe('総司令官')
    for (const c of CONTESTS) for (const n of CONTEST_STATUS[c.id].next) if (n.decision) expect(n.owner).toBe('総司令官')
  })
  it('締切の「済」は doneAt の印で判定する（UDC の概要登録だけ）', async () => {
    const { CONTEST_INFO } = await import('@/apps/contests-info')
    const udc = CONTEST_INFO.find((c) => c.id === 'udc-2026')!
    expect(udc.deadlines.find((d) => d.label === '概要登録')?.doneAt).toBe('2026-11-09')
    expect(udc.deadlines.find((d) => d.label === '本応募')?.doneAt).toBeUndefined()
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
    for (const c of CONTESTS) expect(CONTEST_STATUS[c.id].done.length, c.id).toBeGreaterThan(0)
  })
  it('案ごとに提出の見込みがあり、新しい案は「提出予定」にならない', () => {
    for (const p of PLANS) expect(['提出予定', '比較中', '出さない']).toContain(p.intent)
    expect(PLANS.find((p) => p.id === 'udc-3')?.intent).toBe('出さない')
    expect(PLANS.find((p) => p.id === 'sat-b')?.intentNote).toBe('αと択一')
    expect(PLANS.filter((p) => p.kind.startsWith('新しい案')).every((p) => p.intent !== '提出予定')).toBe(true)
  })
  it('AED マップ（udc-aed）は UDC のコンペに属さない（UDC には登録しない決定）', () => {
    expect(getApp('udc-aed')?.contest).toBe('ichibiz-2026')
    expect(PLANS.find((p) => p.id === 'udc-3')?.decided).toMatch(/UDC には登録しない/)
  })
})
