import { describe, expect, it } from 'vitest'
import { CONTEST_INFO, contestsByDeadline } from '@/apps/contests-info'
import { STAGES, STATUS_LABEL, cardPlans, contestDecisionTexts, otherNextCount } from '@/data/status'

describe('ポータルの進捗カード', () => {
  it('カードの案ごとの数は PLANS から数え、判断待ちは一覧＋案ごとの判断を二重に数えない', () => {
    const sat = cardPlans('satellite-2026')
    expect(sat.map((p) => p.id)).toEqual(['sat-a', 'sat-b', 'sat-yabu-sugi', 'sat-alpha'])
    expect(sat.find((p) => p.id === 'sat-a')).toMatchObject({ done: 2, left: 3, asks: 0, mine: 3 })
    expect(contestDecisionTexts('satellite-2026')).toHaveLength(1)
    expect(contestDecisionTexts('udc-2026')).toHaveLength(1)
    expect(contestDecisionTexts('ichibiz-2026')).toHaveLength(2)
    // ODPT: 一覧の N2 の判断（N2 の案ごとの判断はこれに含まれる）＋子連れの案にある「出す作品」の判断
    expect(contestDecisionTexts('odpt-2026')).toHaveLength(2)
    // UDC 作品③（出さない）はカードの案に数えない
    expect(cardPlans('udc-2026').map((p) => p.id)).toEqual(['udc-1', 'udc-2'])
  })
})

describe('ポータル一覧の段階・状況', () => {
  it('4コンペとも段階（✓・？・□）を持ち、比較中の案は「？」に分かれている', () => {
    for (const c of CONTEST_INFO) {
      const st = STAGES[c.id]
      expect(st.length).toBeGreaterThanOrEqual(4)
      expect(st.every((s) => ['✓', '？', '□'].includes(s.mark))).toBe(true)
      expect(st.some((s) => s.mark === '？')).toBe(true)
    }
    expect(STAGES['satellite-2026'].find((s) => s.mark === '？')?.note).toBe('B・α・新案')
  })
  it('状況の札はコンペごとに文言が違う', () => {
    const labels = Object.values(STATUS_LABEL)
    expect(new Set(labels).size).toBe(labels.length)
  })
  it('次の一手の「ほか N 件」は 0 以上', () => {
    for (const c of CONTEST_INFO) expect(otherNextCount(c.id)).toBeGreaterThanOrEqual(0)
  })
  it('締切順の並び（サイドバーと本文で共通）の先頭は衛星', () => {
    expect(contestsByDeadline()[0].id).toBe('satellite-2026')
  })
})
