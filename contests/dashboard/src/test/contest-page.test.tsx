import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ContestPage from '@/pages/ContestPage'
import { CONTESTS, orderedAppsByContest } from '@/apps/registry'
import { contestUrl } from '@/lib/data'

describe('コンペの概要ページ', () => {
  for (const c of CONTESTS) {
    it(`${c.id}: 概要・審査基準・アプリカードが registry の並びで出る`, () => {
      const html = renderToStaticMarkup(<ContestPage contestId={c.id} />)
      expect(html).toContain(c.name)
      expect(html).toContain('審査基準')
      const ids = [...html.matchAll(/data-app-card="([^"]+)"/g)].map((m) => m[1])
      expect(ids).toEqual(orderedAppsByContest(c.id).map((a) => a.id))
    })
  }
  it('contestUrl はサイトルートからの相対パス', () => {
    expect(contestUrl('udc-2026')).toBe('./contest/udc-2026/index.html')
  })
})
