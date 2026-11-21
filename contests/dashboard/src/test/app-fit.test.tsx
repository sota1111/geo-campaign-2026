import fs from 'node:fs'
import path from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Portal from '@/pages/Portal'
import { APPS, CONTESTS } from '@/apps/registry'
import { FIT_CELLS, FIT_COLUMNS } from '@/data/app-fit'
import {
  TARGETS_KEY, activeCautions, appsForContest, cellOf, contestScore, isSelectable, loadTargets, sanitizeTargets, selectedCount, sortApps, toggleTarget, totalScore,
} from '@/lib/fit'

// 正本 JSON に未反映の新案（app-fit.ts に先に足した。反映後はここから外す）。a4・timeline は 2026-11-21 に参謀長が正本へ反映済み
const NEW_UNREFLECTED: string[] = []
const json = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../../reports/intel/app-contest-fit-20261121.json'), 'utf-8'))

describe('適合表（情報部の正本）の取り込み', () => {
  it('20アプリ×6列=120セルで、registry の APPS と一致する', () => {
    expect(FIT_CELLS).toHaveLength(120)
    expect(new Set(FIT_CELLS.map((c) => c.app))).toEqual(new Set(APPS.map((a) => a.id)))
    expect(FIT_COLUMNS).toHaveLength(6)
  })
  it('UDC 列と注意 C2（2026-11-21 総司令官の更新）以外は正本の JSON と一字一句同じ（新案 biz-realestate-a4 の6セルは正本への反映待ちのため除く）', () => {
    // biz-realestate-a4: 不動産部門 ◎・他は ？（未判定）を app-fit.ts に先に足した。正本 reports/intel/app-contest-fit-20261121.json は書き込み範囲外のため情報部が反映する。反映後はこの除外を外す
    const rest = (cs: { app?: string; contest: string }[]) => cs.filter((c) => c.contest !== 'udc-2026' && !NEW_UNREFLECTED.includes(c.app ?? ''))
    expect(rest(FIT_CELLS)).toEqual(rest(json.cells))
    // UDC 列: 正本が × のうち、総司令官の更新で △ になったもの以外は同じ判定
    for (const c of FIT_CELLS.filter((x) => x.contest === 'udc-2026')) {
      const o = json.cells.find((x: { app: string; contest: string }) => x.app === c.app && x.contest === 'udc-2026')
      if (!o) { expect(NEW_UNREFLECTED).toContain(c.app); continue } // 正本に未反映の新案
      if (c.mark !== o.mark) {
        expect(o.mark).toBe('×')
        expect(c.mark).toBe('△')
        expect(c.score).toBe(1)
      }
    }
  })
  it('score は記号の点（◎3 ○2 △1 ×0 ？0）に一致する', () => {
    for (const c of FIT_CELLS) expect(c.score).toBe(json.scoring[c.mark])
  })
})

describe('並び順', () => {
  it('未選択は全列の score 合計の高い順、同点は registry の並び', () => {
    const all = sortApps(APPS, null).map((a) => a.id)
    // 判定が大半「？」の新しい案（biz-realestate-a4・timeline）は、選んだ候補の次（ここでは先頭）に置く（M7）
    expect(all.slice(0, 2)).toEqual(['biz-realestate-a4', 'biz-realestate-timeline'])
    const ids = all.slice(2)
    const tot = ids.map(totalScore)
    for (let i = 1; i < tot.length; i++) expect(tot[i - 1]).toBeGreaterThanOrEqual(tot[i])
    const idx = (id: string) => APPS.findIndex((a) => a.id === id)
    for (let i = 1; i < ids.length; i++) if (tot[i - 1] === tot[i]) expect(idx(ids[i - 1])).toBeLessThan(idx(ids[i]))
  })
  it('コンペを選ぶと、そのコンペの score の高い順（衛星は A・B・α・藪払い・スギが先頭）', () => {
    const ids = sortApps(APPS, 'satellite-2026').map((a) => a.id)
    expect(ids.slice(0, 5)).toEqual(['sat-a', 'sat-b', 'sat-alpha', 'sat-yabu', 'sat-sugi'])
    const s = ids.map((id) => contestScore(id, 'satellite-2026'))
    for (let i = 1; i < s.length; i++) expect(s[i - 1]).toBeGreaterThanOrEqual(s[i])
  })
  it('コンペを選んでいないとき: 何かを提出先に選んだアプリが先頭に来て、各群の中は元の並びを保つ', () => {
    const none = sortApps(APPS, null).map((a) => a.id)
    const pick = [none[7], none[3]]
    const t: Record<string, string[]> = {}
    for (const id of pick) t[id] = [FIT_COLUMNS.find((c) => isSelectable(cellOf(id, c.id)))!.id]
    const ids = sortApps(APPS, null, t).map((a) => a.id)
    expect(ids.slice(0, 2)).toEqual(none.filter((id) => pick.includes(id)))
    expect(ids.slice(2)).toEqual(none.filter((id) => !pick.includes(id)))
    expect(sortApps(APPS, null, {}).map((a) => a.id)).toEqual(none)
  })
  it('コンペを選んでいるとき: そのコンペを提出先に選んだアプリだけが先頭。他のコンペ向けに選んだアプリは先頭にならず、通常の並びに混ざる', () => {
    const base = sortApps(APPS, 'satellite-2026').map((a) => a.id)
    // sat-sugi は衛星の下位。UDC だけを選んだアプリは、UDC に出せる（× でない）もののうち衛星の上位（sat-a は UDC × なので別のアプリを探す）
    const udcOnly = base.find((id) => id !== 'sat-sugi' && isSelectable(cellOf(id, 'udc-2026')))!
    const t: Record<string, string[]> = { 'sat-sugi': ['satellite-2026'], [udcOnly]: ['udc-2026'] }
    const ids = sortApps(APPS, 'satellite-2026', t).map((a) => a.id)
    expect(ids[0]).toBe('sat-sugi') // 衛星を選んだアプリは先頭
    expect(ids.slice(1)).toEqual(base.filter((id) => id !== 'sat-sugi')) // UDC だけを選んだアプリは先頭に来ない（通常の位置のまま）
    expect(ids.indexOf(udcOnly)).toBeGreaterThan(0)
    expect(sortApps(APPS, 'satellite-2026', {}).map((a) => a.id)).toEqual(base)
  })
  it('イチBiz を選んでいるとき: 3部門のどれかを選んだアプリが先頭', () => {
    const t = { 'biz-idea': ['ichibiz-2026-idea'], 'sat-a': ['satellite-2026'] }
    const ids = sortApps(APPS, 'ichibiz-2026', t).map((a) => a.id)
    expect(ids[0]).toBe('biz-idea')
    expect(ids.indexOf('sat-a')).toBeGreaterThan(0)
    expect(ids.slice(0, 2)).not.toContain('sat-a')
  })
  it('「選んだ N件」はそのコンペを提出先にした組の数（並び順の説明と提出予定数で共通）', () => {
    const t = { 'sat-a': ['satellite-2026'], 'biz-idea': ['ichibiz-2026-idea', 'ichibiz-2026-business'] }
    expect(selectedCount(t, null)).toBe(3)
    expect(selectedCount(t, 'satellite-2026')).toBe(1)
    expect(selectedCount(t, 'ichibiz-2026')).toBe(2)
    expect(selectedCount(t, 'udc-2026')).toBe(0)
  })
  it('イチBiz は3部門のうち最大の score で並べる', () => {
    expect(contestScore('biz-realestate', 'ichibiz-2026')).toBe(3)
    expect(contestScore('sat-b', 'ichibiz-2026')).toBe(2)
  })
})

describe('提出先の選択', () => {
  it('× は選べず、◎○△ と ？ は選べる', () => {
    expect(isSelectable(cellOf('sat-b', 'udc-2026'))).toBe(false)
    expect(isSelectable(cellOf('sat-b', 'satellite-2026'))).toBe(true)
    expect(isSelectable(cellOf('sat-b', 'ichibiz-2026-realestate'))).toBe(true) // ？
    expect(toggleTarget({}, 'sat-b', 'udc-2026')).toEqual({})
  })
  it('外から来た値は、選べない組を落とす', () => {
    expect(sanitizeTargets({ 'sat-b': ['udc-2026', 'satellite-2026', 'nothing'], x: 3 })).toEqual({ 'sat-b': ['satellite-2026'] })
  })
  it('B と α を衛星に両方選ぶと注意 C3 が出る。UDC に3件以上、solar-guard のビジネス部門も注意が出る', () => {
    let t = toggleTarget({}, 'sat-b', 'satellite-2026')
    expect(activeCautions(t)).toHaveLength(0)
    t = toggleTarget(t, 'sat-alpha', 'satellite-2026')
    const ids = activeCautions(t).map((c) => c.caution.id)
    expect(ids).toContain('C3')
    expect(activeCautions(t).find((c) => c.caution.id === 'C3')!.why).toContain('失格級')
    const u = toggleTarget(toggleTarget(toggleTarget({}, 'odpt', 'udc-2026'), 'udc-moritsuchi', 'udc-2026'), 'odpt-teiji', 'udc-2026')
    expect(activeCautions(u).map((c) => c.caution.id)).toEqual(expect.arrayContaining(['C1', 'C2']))
    expect(activeCautions(toggleTarget({}, 'biz-solar-guard', 'ichibiz-2026-business')).map((c) => c.caution.id)).toContain('C7')
  })
  it('コンペごとの件数（イチBiz は3部門まとめ）', () => {
    const t = toggleTarget(toggleTarget({}, 'biz-idea', 'ichibiz-2026-idea'), 'biz-idea', 'ichibiz-2026-business')
    expect(appsForContest(t, 'ichibiz-2026')).toEqual(['biz-idea'])
  })
})

describe('トップ画面の操作', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(cleanup)
  // 提出先の選択は、カードの「提出先を選ぶ」で開くポップオーバーの中にある
  const openPick = (id: string) => fireEvent.click(screen.getByTestId(`pick-targets-${id}`))
  const order = () => [...document.querySelectorAll('[data-testid="app-row"] > li')].map((e) => e.getAttribute('data-app-card'))

  it('コンペ4枚とアプリ19枚。コンペを選ぶと並び替わり、関連の行が強調される', () => {
    render(<Portal />)
    expect(document.querySelectorAll('[data-contest-card]')).toHaveLength(4)
    expect(order()).toHaveLength(20)
    const before = order()
    fireEvent.click(screen.getByTestId('pick-satellite-2026'))
    expect(order()).not.toEqual(before)
    expect(order().slice(0, 2)).toEqual(['sat-a', 'sat-b'])
    expect(document.querySelector('[data-contest-card="satellite-2026"]')!.getAttribute('data-selected')).toBe('true')
    expect(document.querySelector('[data-app-card="sat-a"] [data-fit-mini="satellite-2026"]')!.getAttribute('data-emph')).toBe('true')
    openPick('sat-a')
    expect(document.querySelector('[data-fit-row="satellite-2026"]')!.getAttribute('data-emph')).toBe('true')
    fireEvent.click(screen.getByTestId('pick-satellite-2026'))
    expect(order()).toEqual(before)
  })
  it('カードの本体を押しても選べる（リンクは除く）', () => {
    render(<Portal />)
    fireEvent.click(screen.getByTestId('facts-udc-2026'))
    expect(document.querySelector('[data-contest-card="udc-2026"]')!.getAttribute('data-selected')).toBe('false')
    fireEvent.click(within(screen.getByTestId('contest-udc-2026')).getByText('総司令官の判断待ち 1件'))
    expect(document.querySelector('[data-contest-card="udc-2026"]')!.getAttribute('data-selected')).toBe('true')
  })
  it('× は選べず理由が出る。選ぶとコンペ側に「このコンペに出すアプリ n件」が出て、localStorage に保存される', () => {
    render(<Portal />)
    openPick('sat-b')
    const x = screen.getByTestId('t-sat-b-udc-2026') as HTMLInputElement
    expect(x.disabled).toBe(true)
    expect(screen.getByTestId('why-sat-b-udc-2026').textContent).toContain('選べません')
    fireEvent.click(screen.getByTestId('t-sat-b-satellite-2026'))
    expect(screen.getByTestId('targets-satellite-2026').textContent).toContain('このコンペに出すアプリ 1件')
    expect(loadTargets()).toEqual({ 'sat-b': ['satellite-2026'] })
    expect(window.localStorage.getItem(TARGETS_KEY)).toContain('satellite-2026')
    openPick('sat-alpha')
    fireEvent.click(screen.getByTestId('t-sat-alpha-satellite-2026'))
    expect(within(document.querySelector('[data-app-card="sat-b"]') as HTMLElement).getByTestId('caution-tag-sat-b').textContent).toContain('注意')
    openPick('sat-b')
    expect(within(screen.getByTestId('popover-sat-b')).getByTestId('card-cautions').textContent).toContain('失格級')
    expect(screen.getByTestId('cautions').textContent).toContain('該当するカードの中')
    // 注意はアプリの行の上に差し込まない（押したカードの位置がずれない）
    expect(document.querySelector('[data-testid="app-section"]')!.innerHTML.indexOf('data-testid="cautions"')).toBeGreaterThan(document.querySelector('[data-testid="app-section"]')!.innerHTML.indexOf('data-testid="app-row"'))
    expect(screen.getByTestId('draft-note').textContent).toContain('このブラウザだけの下書きです。正式な提出先は総司令官が参謀長に指示してください')
  })
  it('選んだ提出先は、カードの小さな表に ✓ で出る。記号の凡例は常に出ている', () => {
    render(<Portal />)
    expect(screen.getByTestId('mark-legend').textContent).toContain('◎ このコンペ向け')
    const mini = () => document.querySelector('[data-app-card="sat-b"] [data-fit-mini="satellite-2026"]')!.textContent
    expect(mini()).not.toContain('✓')
    openPick('sat-b')
    fireEvent.click(screen.getByTestId('t-sat-b-satellite-2026'))
    expect(mini()).toContain('✓')
    expect(mini()).toContain('選択済み')
  })
  it('M3: 提出先を選んでも、ポップオーバーを開いている間は並べ替えず、閉じたときに並べ替える', () => {
    render(<Portal />)
    const before = order()
    openPick('sat-b')
    fireEvent.click(screen.getByTestId('t-sat-b-satellite-2026'))
    expect(order()).toEqual(before) // 選んだ瞬間は動かない
    expect(within(document.querySelector('[data-app-card="sat-b"]') as HTMLElement).getByTestId('chosen-sat-b').textContent).toContain('1件') // 件数・✓ はすぐ反映
    fireEvent.click(within(screen.getByTestId('popover-sat-b')).getByText('閉じる'))
    expect(order()[0]).toBe('sat-b')
  })
  it('M4: 並びの番号は「N番目」で、評価の順位に見えない', () => {
    render(<Portal />)
    const badge = document.querySelector('[data-app-card]')!.querySelector('[title*="評価の順位ではありません"]')!
    expect(badge.textContent).toBe('1番目')
  })
  it('M5: イチBiz の部門を選ぶと、カードにはその部門の判定が出る（部門名つき）', () => {
    window.localStorage.setItem(TARGETS_KEY, JSON.stringify({ version: 1, targets: { 'biz-business': ['ichibiz-2026-idea'] } }))
    render(<Portal />)
    const mini = document.querySelector('[data-app-card="biz-business"] [data-fit-mini="ichibiz-2026"]')!.textContent!
    expect(mini).toContain('✓')
    expect(mini).toContain('アイデア')
  })
  it('M7: コンペ未選択のとき、判定が大半「？」の新しい案は並びの最後に埋もれない', () => {
    render(<Portal />)
    expect(order().indexOf('biz-realestate-timeline')).toBeLessThan(3)
  })
  it('localStorage が使えなくても画面は動く', () => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('denied') }
    try {
      render(<Portal />)
      openPick('sat-b')
      fireEvent.click(screen.getByTestId('t-sat-b-satellite-2026'))
      expect(screen.getByTestId('targets-satellite-2026').textContent).toContain('1件')
      expect(screen.getByTestId('draft-note').textContent).toContain('保存できず')
    } finally {
      Storage.prototype.setItem = orig
    }
  })
  it('絞り込み・位置表示・Tab の止まり方・◎の言葉', () => {
    render(<Portal />)
    expect(screen.getByTestId('row-position').textContent).toContain('20件中')
    fireEvent.change(screen.getByTestId('top-app-filter'), { target: { value: '盛土' } })
    expect(order().length).toBeLessThan(20)
    expect(order()).toContain('sat-b')
    fireEvent.change(screen.getByTestId('top-app-filter'), { target: { value: '' } })
    for (const id of ['odpt', 'sat-b']) {
      openPick(id)
      const stops = [...screen.getByTestId(`popover-${id}`).querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter((i) => !i.disabled && i.tabIndex === 0)
      expect(stops).toHaveLength(1)
    }
    // カードには提出先の選択欄を置かない
    expect(document.querySelector('[data-testid="app-row"] input[type=checkbox]')).toBeNull()
    if (!screen.queryByTestId('mark-odpt-udc-2026')) openPick('odpt')
    expect(screen.getByTestId('mark-odpt-udc-2026').textContent).toContain('このコンペ向けに作った')
    expect(document.body.textContent).not.toContain('今の応募先')
    // × の理由は折りたたみの中（既定で閉じている）
    if (!screen.queryByTestId('why-sat-b-udc-2026')) openPick('sat-b')
    expect(screen.getByTestId('why-sat-b-udc-2026').closest('details')!.hasAttribute('open')).toBe(false)
  })
  it('契約: 全コンペ名が registry にある', () => {
    expect(CONTESTS).toHaveLength(4)
  })
})
