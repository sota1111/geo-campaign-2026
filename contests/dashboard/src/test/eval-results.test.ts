import { describe, expect, it } from 'vitest'
import {
  APP_EVALS_R1,
  APP_EVALS_R2,
  EVALUATORS_R1,
  EVALUATORS_R2,
  bTotal,
  cMax,
  cTotal,
  deltaText,
  diffOf,
  sum,
} from '@/apps/eval-results'
import { CURRENT_APPS } from '@/apps/registry'

// 評価報告書の小計と、データの項目点の合計が一致することを確かめる（点の転記ミス防止）
describe('eval-results 第1回（2026-11-11）', () => {
  it('A の小計（19・19・18・18）が項目点の合計と一致する', () => {
    expect(EVALUATORS_R1.map((e) => sum(e.a))).toEqual([19, 19, 18, 18])
    for (const e of EVALUATORS_R1) expect(sum(e.a)).toBe(e.aReported)
  })
  it('B・C の小計が報告書と一致し、全アプリが評価済み', () => {
    for (const ev of APP_EVALS_R1) {
      expect(sum(ev.b)).toBe(ev.bReported)
      for (const c of ev.c) expect(sum(c.items.map((i) => i.score))).toBe(c.reported)
    }
    expect(APP_EVALS_R1.map((e) => e.appId).sort()).toEqual(CURRENT_APPS.map((a) => a.id).sort())
  })
  it('C の満点（ODPT 20・UDC 15・衛星 25・イチBiz 20）', () => {
    const max = (id: string, k: number) => cMax(APP_EVALS_R1.find((e) => e.appId === id)!.c[k])
    expect([max('odpt', 0), max('odpt', 1), max('sat-a', 0), max('biz-idea', 0)]).toEqual([20, 15, 25, 20])
  })
})

describe('eval-results 第2回（2026-11-12）', () => {
  it('A の小計（19・20・19・19）が項目点の合計と一致する', () => {
    expect(EVALUATORS_R2.map((e) => sum(e.a))).toEqual([19, 20, 19, 19])
    for (const e of EVALUATORS_R2) expect(sum(e.a)).toBe(e.aReported)
  })
  it('B・C の項目点の合計が報告書の小計と一致し、全アプリが評価済み', () => {
    for (const ev of APP_EVALS_R2) {
      expect(sum(ev.b)).toBe(ev.bReported)
      for (const c of ev.c) expect(cTotal(c)).toBe(c.reported)
    }
    expect(APP_EVALS_R2.map((e) => e.appId).sort()).toEqual(CURRENT_APPS.map((a) => a.id).sort())
  })
  it('B の小計が報告書の値（29・28・28・28・27・27・27）', () => {
    expect(APP_EVALS_R2.map((e) => [e.appId, bTotal(e)])).toEqual([
      ['odpt', 29],
      ['udc-moritsuchi', 28],
      ['sat-a', 28],
      ['sat-b', 28],
      ['biz-business', 27],
      ['biz-idea', 27],
      ['biz-realestate', 27],
    ])
  })
  it('C の小計が報告書の値（ODPT 16・UDC①②11・衛星 19/19・イチBiz 14/13/13）', () => {
    const cs = APP_EVALS_R2.flatMap((e) => e.c.map((c) => [e.appId, c.contest, cTotal(c)]))
    expect(cs).toEqual([
      ['odpt', 'odpt-2026', 16],
      ['odpt', 'udc-2026', 11],
      ['udc-moritsuchi', 'udc-2026', 11],
      ['sat-a', 'satellite-2026', 19],
      ['sat-b', 'satellite-2026', 19],
      ['biz-business', 'ichibiz-2026', 14],
      ['biz-idea', 'ichibiz-2026', 13],
      ['biz-realestate', 'ichibiz-2026', 13],
    ])
  })
  it('C の満点は第1回と同じ（回をまたいで比べられる）', () => {
    for (const ev of APP_EVALS_R2) {
      const prev = APP_EVALS_R1.find((e) => e.appId === ev.appId)!
      expect(ev.c.map((c) => [c.contest, cMax(c)])).toEqual(prev.c.map((c) => [c.contest, cMax(c)]))
    }
  })
})

describe('第1回と第2回の差', () => {
  it('バス路線は B 29→27、C 13→14（−2/+1）', () => {
    expect(diffOf('biz-business', 'ichibiz-2026')).toEqual({ b: -2, c: 1 })
  })
  it('各アプリの差が報告書の点から計算できる', () => {
    expect(diffOf('odpt', 'odpt-2026')).toEqual({ b: 3, c: 0 })
    expect(diffOf('odpt', 'udc-2026')).toEqual({ b: 3, c: 0 })
    expect(diffOf('udc-moritsuchi', 'udc-2026')).toEqual({ b: -1, c: 0 })
    expect(diffOf('sat-a', 'satellite-2026')).toEqual({ b: 0, c: 2 })
    expect(diffOf('sat-b', 'satellite-2026')).toEqual({ b: -1, c: 4 })
    expect(diffOf('biz-idea', 'ichibiz-2026')).toEqual({ b: -2, c: -1 })
    expect(diffOf('biz-realestate', 'ichibiz-2026')).toEqual({ b: 2, c: 0 })
  })
  it('符号つきの表記', () => {
    expect([deltaText(3), deltaText(-2), deltaText(0)]).toEqual(['+3', '−2', '±0'])
  })
})
