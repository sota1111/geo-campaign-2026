import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ContestPage from '@/pages/ContestPage'
import Portal from '@/pages/Portal'
import { CONTESTS } from '@/apps/registry'

describe('賞金の表示', () => {
  const EXPECT: Record<string, string> = {
    'udc-2026': '最高50万円（総額200万円）',
    'satellite-2026': '最高300万円',
    'ichibiz-2026': '総額200万円（予定）',
    'odpt-2026': '総額最大300万円',
  }
  const top = renderToStaticMarkup(<Portal />)
  it('トップは4コンペ分の賞金の要約を出す', () => {
    expect([...top.matchAll(/data-testid="row-prize"/g)].length).toBe(CONTESTS.length)
  })
  for (const c of CONTESTS) {
    it(`${c.id}: トップに要約、概要ページに内訳と出典`, () => {
      expect(top).toContain(EXPECT[c.id])
      const html = renderToStaticMarkup(<ContestPage contestId={c.id} />)
      expect(html).toContain('prize-breakdown')
      expect(html).toContain('出典:')
    })
  }
  it('要項に無い金額は推測せず「記載なし」「未確認」と書く', () => {
    const html = renderToStaticMarkup(<ContestPage contestId="ichibiz-2026" />)
    expect(html).toContain('金額は要項に記載なし')
    expect(html).toContain('未確認')
  })
})
