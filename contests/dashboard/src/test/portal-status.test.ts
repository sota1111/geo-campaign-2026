import { describe, expect, it } from 'vitest'
import { CONTEST_INFO, contestsByDeadline } from '@/apps/contests-info'
import { STAGES, STATUS_LABEL, otherNextCount } from '@/data/status'

describe('ポータル一覧の段階・状況', () => {
  it('4コンペとも段階（✓・？・□）を持ち、比較中の案は「？」に分かれている', () => {
    for (const c of CONTEST_INFO) {
      const st = STAGES[c.id]
      expect(st.length).toBeGreaterThanOrEqual(4)
      expect(st.every((s) => ['✓', '？', '□'].includes(s.mark))).toBe(true)
      expect(st.some((s) => s.mark === '？')).toBe(true)
    }
    expect(STAGES['satellite-2026'].find((s) => s.mark === '？')?.note).toBe('B かα')
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
