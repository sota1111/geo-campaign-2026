import { describe, expect, it } from 'vitest'
import { APP_EVALS, EVALUATORS, cMax, sum } from '@/apps/eval-results'
import { APPS } from '@/apps/registry'

// 評価報告書の小計と、データの項目点の合計が一致することを確かめる（点の転記ミス防止）
describe('eval-results', () => {
  it('A の小計（19・19・18・18）が項目点の合計と一致する', () => {
    expect(EVALUATORS.map((e) => sum(e.a))).toEqual([19, 19, 18, 18])
    for (const e of EVALUATORS) expect(sum(e.a)).toBe(e.aReported)
  })
  it('B・C の小計が報告書と一致し、全アプリが評価済み', () => {
    for (const ev of APP_EVALS) {
      expect(sum(ev.b)).toBe(ev.bReported)
      for (const c of ev.c) expect(sum(c.items.map((i) => i.score))).toBe(c.reported)
    }
    expect(APP_EVALS.map((e) => e.appId).sort()).toEqual(APPS.map((a) => a.id).sort())
  })
  it('C の満点（ODPT 20・UDC 15・衛星 25・イチBiz 20）', () => {
    const max = (id: string, k: number) => cMax(APP_EVALS.find((e) => e.appId === id)!.c[k])
    expect([max('odpt', 0), max('odpt', 1), max('sat-a', 0), max('biz-idea', 0)]).toEqual([20, 15, 25, 20])
  })
})
