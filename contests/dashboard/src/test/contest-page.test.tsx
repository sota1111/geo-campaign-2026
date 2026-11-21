import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ContestPage from '@/pages/ContestPage'
import Portal from '@/pages/Portal'
import { CARDS_ONLY, CONTESTS, orderedAppsByContest } from '@/apps/registry'
import { contestUrl } from '@/lib/data'

describe('コンペの概要ページ', () => {
  for (const c of CONTESTS) {
    it(`${c.id}: 概要・審査基準・アプリカードが registry の並びで出る`, () => {
      const html = renderToStaticMarkup(<ContestPage contestId={c.id} />)
      expect(html).toContain(c.name)
      expect(html).toContain('審査基準')
      const cardOnly = new Set(CARDS_ONLY.map((x) => x.id))
      const ids = [...html.matchAll(/data-app-card="([^"]+)"/g)].map((m) => m[1]).filter((id) => !cardOnly.has(id))
      expect(ids).toEqual(orderedAppsByContest(c.id).map((a) => a.id))
    })
  }
  it('contestUrl はサイトルートからの相対パス', () => {
    expect(contestUrl('udc-2026')).toBe('./contest/udc-2026/index.html')
  })
  it('トップ画面の詳細欄にあった進捗（判断待ち・次にやること）・案ごとのチェックリスト・AI評価が移っている', () => {
    const html = renderToStaticMarkup(<ContestPage contestId="satellite-2026" />)
    expect(html).toContain('contest-status')
    expect(html).toContain('判断待ち')
    expect(html).toContain('次にやること')
    expect(html).toContain('plan-progress-sat-a')
    expect(html).toContain('contest-eval')
  })
})

describe('トップ画面（コンペの大カードの中にアプリの小カード）', () => {
  const html = renderToStaticMarkup(<Portal />)
  it('4コンペの大カードが締切順に並び、押すとコンペ概要ページへ移る', () => {
    const ids = [...html.matchAll(/data-contest-card="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toEqual(['satellite-2026', 'ichibiz-2026', 'udc-2026', 'odpt-2026'])
    for (const c of CONTESTS) expect(html).toContain(`href="${contestUrl(c.id)}"`)
  })
  it('各コンペの小カードは registry の並びで、押すとアプリのページへ移る', () => {
    for (const c of CONTESTS) {
      const box = html.split(`data-testid="apps-${c.id}"`)[1].split('</article>')[0]
      const ids = [...box.matchAll(/data-app-card="([^"]+)"/g)].map((m) => m[1])
      expect(ids).toEqual(orderedAppsByContest(c.id).map((a) => a.id))
      for (const id of ids) expect(box).toContain(`href="./apps/${id}/index.html"`)
    }
  })
  it('詳細欄・細いタブ状の一覧は無い', () => {
    expect(html).not.toContain('detail-pane')
    expect(html).not.toContain('data-tab-card')
  })
})
