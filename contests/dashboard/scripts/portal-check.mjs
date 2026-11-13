// ポータル一覧の確認（2026-11-13 デザイン審査の対応）。
// 1280×765 と 390×844 で、各行のクリック前・開いた後・閉じた後の行の top と scrollY、390 で4行が第一画面に収まるか、
// スマホ幅のシート（閉じるボタン・中だけスクロール・ページ固定）、詳細の末尾の「閉じる」、sticky の見出し、横スクロール、
// アプリからの戻り（全行が閉じた一覧）、コンソールエラーを数値で出し、スクリーンショットを保存する。
// usage: node scripts/portal-check.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pcheck-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
const errs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
const save = async (name, full) => {
  const h = await ev('document.documentElement.scrollHeight')
  const params = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: Math.min(h, 6000), scale: 1 } } : { format: 'png' }
  fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', params)).result.data, 'base64'))
}
const J = async (e) => { const v = await ev(`JSON.stringify(${e})`); if (v === undefined) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); console.error('EVAL FAIL', JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r).slice(0, 300), e.slice(0, 120)) } return JSON.parse(v) }
const rect = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, width: r.width, height: Math.round(r.height) } })()`
const ids = ['satellite-2026', 'ichibiz-2026', 'udc-2026', 'odpt-2026']
const load = async (hash = '') => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: `${base}index.html${hash}` }); await sleep(2200)
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(500)
}
const clickSel = async (sel) => { const r = await J(rect(sel)); await clickAt(r.left + Math.min(r.width / 2, 120), r.top + Math.min(r.height / 2, 25)) }
const row = (id) => `[data-testid=row-${id}]`
const state = (id) => J(`({ top: ${rect(row(id))}.top, scrollY: Math.round(scrollY), expanded: document.querySelector('${row(id)}').getAttribute('aria-expanded'), sw: document.documentElement.scrollWidth })`)

const out = []
for (const [label, w, h0, mobile] of [['1280', 1280, 765, false], ['390', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: 1, mobile })
  await load()
  // 4行が第一画面に収まるか（行の bottom <= 画面の高さ）
  const bottoms = await J(`${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=contest-' + id + ']').getBoundingClientRect().bottom))`)
  const heights = await J(`${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=contest-' + id + ']').getBoundingClientRect().height))`)
  out.push({ label, firstScreen: { viewportH: h0, bottoms, heights, fit: bottoms.every((b) => b <= h0), scrollWidth: await ev('document.documentElement.scrollWidth'), scrollHeight: await ev('document.documentElement.scrollHeight'), sidebarOrder: await J(`[...document.querySelectorAll('[data-sidebar=group-label]')].map((e) => e.textContent.slice(0, 8))`) } })
  await save(`${label}-01-first.png`)

  // 全行: 開く前 → 開いた後 → 閉じた後
  for (const id of ids) {
    await load()
    const before = await state(id)
    await clickSel(row(id))
    const opened = await state(id)
    const sheet = await J(`({ sheet: !!document.querySelector('[data-testid=detail-sheet]'), detail: !!document.querySelector('[data-testid=detail-${id}]'), hash: location.hash, bodyOverflow: getComputedStyle(document.body).overflow })`)
    await save(`${label}-02-open-${id}.png`)
    {
      const sh = await J(`(() => { const b = document.querySelector('[data-testid=detail-${id}]'); const c = document.querySelector('[data-testid=detail-sheet]').getBoundingClientRect(); return { sheetLeft: Math.round(c.left), sheetW: Math.round(c.width), docH: document.documentElement.scrollHeight, sheetTop: Math.round(c.top), sheetBottom: Math.round(c.bottom), bodyClient: b.clientHeight, bodyScroll: b.scrollHeight, closeBtn: !!document.querySelector('[data-testid=sheet-close]') } })()`)
      // シートの中をスクロールし、ページが動かないこと
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mobile ? 200 : 1000, y: 600, deltaX: 0, deltaY: 400 })
      await sleep(300)
      const after = await J(`({ inner: Math.round(document.querySelector('[data-testid=detail-${id}]').scrollTop), pageY: Math.round(scrollY) })`)
      await save(`${label}-03-sheet-scrolled-${id}.png`)
      await clickSel('[data-testid=sheet-close]')
      const closed = await state(id)
      out.push({ label, id, before, opened, sheet, sheetInfo: sh, afterWheel: after, closed, sheetGone: await ev(`!document.querySelector('[data-testid=detail-sheet]')`) })
    }
  }
  {
    // M6: 詳細を開いたまま、ヘッダーの切り替えで別コンペの詳細へ移る。一覧の scrollY・行 top・scrollHeight は不変、ハッシュも更新、閉じたら最後の行へフォーカス
    await load()
    const snap = () => J(`({ scrollY: Math.round(scrollY), tops: ${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().top)), docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
    const pre = await snap()
    await clickSel(row('ichibiz-2026'))
    const steps = []
    for (const id of ['udc-2026', 'satellite-2026', 'odpt-2026']) {
      await ev(`document.querySelector('[data-testid=detail-sheet] [data-testid^=detail-]').scrollTop = 200`)
      await clickSel(`[data-testid=switch-${id}]`)
      steps.push({ to: id, shown: await ev(`!!document.querySelector('[data-testid=detail-${id}]')`), hash: await ev('location.hash'), pressed: await ev(`document.querySelector('[data-testid=switch-${id}]').getAttribute('aria-pressed')`), innerTop: await ev(`document.querySelector('[data-testid=detail-${id}]').scrollTop`), snap: await snap(), switchRect: await J(rect('[data-testid=sheet-switch]')) })
    }
    if (mobile === false) await save(`${label}-08-switched.png`)
    await clickSel('[data-testid=sheet-close]')
    const post = await snap()
    out.push({ label, switchCheck: steps, closedFocus: await ev('document.activeElement?.dataset?.testid'), unchanged: steps.every((s) => JSON.stringify(s.snap) === JSON.stringify(pre)) && JSON.stringify(post) === JSON.stringify(pre), allShown: steps.every((s) => s.shown && s.pressed === 'true') })
  }
  if (!mobile) {
    // 深部から閉じる: イチBizを開き、パネル内を最下部までスクロールして閉じる。背景の scrollY・行 top・scrollHeight が変わらないこと
    for (const how of ['button', 'esc', 'backdrop']) {
      await load()
      const pre = await J(`({ scrollY: Math.round(scrollY), udcTop: ${rect(row('udc-2026'))}.top, ichiTop: ${rect(row('ichibiz-2026'))}.top, docH: document.documentElement.scrollHeight })`)
      await clickSel(row('ichibiz-2026'))
      await ev(`(() => { const b = document.querySelector('[data-testid=detail-ichibiz-2026]'); b.scrollTop = b.scrollHeight })()`)
      await sleep(300)
      const deep = await J(`(() => { const b = document.querySelector('[data-testid=detail-ichibiz-2026]'); const c = document.querySelector('[data-testid=detail-sheet]').getBoundingClientRect(); return { inner: Math.round(b.scrollTop), innerMax: b.scrollHeight - b.clientHeight, scrollY: Math.round(scrollY), docH: document.documentElement.scrollHeight, sheetW: Math.round(c.width), sheetLeft: Math.round(c.left), closeBtn: ${rect('[data-testid=sheet-close]')}, rowHighlight: document.querySelector('${row('ichibiz-2026')}').className.includes('ring-2'), sw: document.documentElement.scrollWidth } })()`)
      if (how === 'button') await save(`${label}-05-deep-open.png`)
      if (how === 'button') await clickSel('[data-testid=sheet-close]')
      else if (how === 'esc') { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) }
      else await clickAt(150, 700)
      const post = await J(`({ scrollY: Math.round(scrollY), udcTop: ${rect(row('udc-2026'))}.top, ichiTop: ${rect(row('ichibiz-2026'))}.top, docH: document.documentElement.scrollHeight, expanded: document.querySelector('${row('ichibiz-2026')}').getAttribute('aria-expanded'), focus: document.activeElement?.dataset?.testid ?? null, sheetGone: !document.querySelector('[data-testid=detail-sheet]') })`)
      if (how === 'button') await save(`${label}-06-deep-closed.png`)
      out.push({ label, deepClose: how, pre, deep, post, unchanged: pre.scrollY === post.scrollY && pre.ichiTop === post.ichiTop && pre.docH === post.docH && deep.docH === pre.docH })
    }
    // 背景ページが縦にスクロールできる高さ（1280×500）で、scrollY>0 のまま深部から開閉しても動かない
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 500, deviceScaleFactor: 1, mobile: false })
    for (const how of ['button', 'esc']) {
      await load()
      await ev('window.scrollTo(0, 120)'); await sleep(200)
      const snap = () => J(`({ scrollY: Math.round(scrollY), ichiTop: ${rect(row('ichibiz-2026'))}.top, udcTop: ${rect(row('udc-2026'))}.top, docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
      const pre = await snap()
      await clickSel(row('ichibiz-2026'))
      await ev(`(() => { const b = document.querySelector('[data-testid=detail-ichibiz-2026]'); b.scrollTop = b.scrollHeight })()`)
      await sleep(900)
      const deep = await snap()
      if (how === 'button') await clickSel('[data-testid=sheet-close]')
      else { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) }
      const post = await snap()
      out.push({ label: '1280x500', shortViewport: how, pre, deep, post, focus: (await ev('document.activeElement?.dataset?.testid')) ?? null, unchanged: JSON.stringify(pre) === JSON.stringify(post) && pre.docH === deep.docH })
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
  } else {
    // 開いた詳細の先頭がそのまま見えること、横スクロールなし
    await load()
    await clickSel(row('odpt-2026'))
    out.push({ label, sheetHtmlOverflowX: await ev('document.documentElement.scrollWidth'), sheetScrollY: await ev('scrollY') })
    await save(`${label}-04-odpt-sheet.png`)
  }
}
// 第3回評価レーダー（2026-11-13 デザイン審査 M7〜M10 の対応）: 詳細パネル内・評価ダイアログ内の横溢れ、全系列選択、ジャンプ、背景の不変
const OVER = (rootSel) => `(() => {
  const root = document.querySelector('${rootSel}'); if (!root) return null
  const rr = root.getBoundingClientRect()
  const inFrame = (e) => { for (let a = e.parentElement; a && a !== root; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o === 'auto' || o === 'scroll') return true } return false }
  const all = [root, ...root.querySelectorAll('*')].filter((e) => e.clientWidth > 2 && !(e instanceof SVGElement))
  const scrollOver = all.filter((e) => e.scrollWidth > e.clientWidth + 1 && !(e !== root && getComputedStyle(e).overflowX !== 'visible' && e.hasAttribute('data-scroll-frame')) && !(e !== root && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX)) && !inFrame(e)).map((e) => (e.dataset.testid || e.tagName) + ':' + e.scrollWidth + '/' + e.clientWidth)
  const rightOver = [...root.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > rr.right + 1 && !inFrame(e) && !(e.hasAttribute('data-scroll-frame')) }).slice(0, 6).map((e) => (e.dataset.testid || e.tagName) + ' right=' + Math.round(e.getBoundingClientRect().right) + ' > ' + Math.round(rr.right))
  const frames = [...root.querySelectorAll('[data-scroll-frame], .overflow-x-auto')].map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  return { root: { sw: root.scrollWidth, cw: root.clientWidth, equal: root.scrollWidth <= root.clientWidth }, scrollOver, rightOver, frames }
})()`
for (const [label, w, h0, mobile] of [['1280', 1280, 765, false], ['390', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: 1, mobile })
  const bg = () => J(`({ scrollY: Math.round(scrollY), tops: ${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().top)), docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
  const box = (id) => `document.querySelector('[data-testid=detail-${id}]')`
  // M7: 4コンペでジャンプ。背景は不変、節の先頭に B 図全体（svg）が収まる
  await load()
  const bg0 = await bg()
  await clickSel(row('ichibiz-2026'))
  const m7 = []
  for (const id of ids) {
    await clickSel(`[data-testid=switch-${id}]`)
    const pre = await J(`({ top: ${box(id)}.scrollTop, hasBtn: !!document.querySelector('[data-testid=jump-eval3]'), btn: ${rect('[data-testid=jump-eval3]')}, header: ${rect('[data-testid=sheet-switch]')}, secTopBefore: ${box(id)}.querySelector('[data-testid=eval3-contest]').offsetTop })`)
    await clickSel('[data-testid=jump-eval3]')
    await sleep(200)
    const post = await J(`(() => { const b = ${box(id)}; const br = b.getBoundingClientRect(); const s = b.querySelector('[data-testid=eval3-contest]').getBoundingClientRect(); const svg = b.querySelector('[data-testid=eval3-contest] svg[data-testid=radar]').getBoundingClientRect(); return { scrollTop: Math.round(b.scrollTop), secTopInBox: Math.round(s.top - br.top), svgTopInBox: Math.round(svg.top - br.top), svgBottomInBox: Math.round(svg.bottom - br.bottom), boxH: Math.round(br.height), svgFits: svg.top >= br.top && svg.bottom <= br.bottom, focus: document.activeElement?.dataset?.testid ?? null } })()`)
    await save(`${label}-m7-jump-${id}.png`)
    m7.push({ id, pre, post, bg: JSON.stringify(await bg()) === JSON.stringify(bg0) })
  }
  out.push({ label, M7_jump: m7, allSvgFit: m7.every((x) => x.post.svgFits), bgUnchanged: m7.every((x) => x.bg), fromTop: m7.every((x) => x.pre.top === 0) })
  // M8: イチBiz 全6系列（「全6案」ボタン）。図の右端・表のスクロール枠・パネル内の横溢れ
  await clickSel('[data-testid=switch-ichibiz-2026]')
  await clickSel('[data-testid=jump-eval3]')
  const presetsTxt = await J(`[...document.querySelectorAll('[data-testid^=eval3-preset-]')].map((b) => b.textContent + ':' + b.getAttribute('aria-pressed'))`)
  await clickSel('[data-testid=eval3-preset-all]')
  await sleep(300)
  const six = await J(`(() => { const b = ${box('ichibiz-2026')}; const br = b.getBoundingClientRect(); const svgs = [...b.querySelectorAll('svg[data-testid=radar]')].map((s) => { const r = s.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), inside: r.left >= br.left - 1 && r.right <= br.right + 1 } }); const legends = [...b.querySelectorAll('[data-testid=radar-legend]')].map((e) => { const r = e.getBoundingClientRect(); return Math.round(r.right) <= Math.round(br.right) + 1 }); const frames = [...b.querySelectorAll('[data-scroll-frame]')].map((f) => ({ sw: f.scrollWidth, cw: f.clientWidth, within: f.getBoundingClientRect().right <= br.right + 1, hint: !!f.parentElement.querySelector('[data-testid=scroll-hint]') })); const ths = [...b.querySelectorAll('[data-testid=radar-table] thead th')].slice(1).map((t) => Math.round(t.getBoundingClientRect().width)); return { series: b.querySelectorAll('[data-testid=eval3-contest] svg[data-testid=radar]:first-of-type [data-testid^=radar-series-]').length, boxRight: Math.round(br.right), svgs, legends, frames, thMinWidths: ths, docSw: document.documentElement.scrollWidth } })()`)
  const sixOver = await J(OVER('[data-testid=detail-ichibiz-2026]'))
  await save(`${label}-m8-ichibiz-six.png`)
  // 縦に動いて表の部分も撮る
  await ev(`(() => { const t = ${box('ichibiz-2026')}.querySelector('[data-testid=radar-table]'); t.scrollIntoView({ block: 'start' }) })()`)
  await sleep(200)
  await save(`${label}-m8-ichibiz-six-table.png`)
  const bgAfter = await bg()
  // ペア選択: ビジネス部門の2案 → 2系列
  await clickSel('[data-testid=jump-eval3]')
  await clickSel('[data-testid=eval3-preset-biz-business]')
  const pair = await J(`({ pressed: document.querySelector('[data-testid=eval3-preset-biz-business]').getAttribute('aria-pressed'), n: ${box('ichibiz-2026')}.querySelectorAll('[data-testid=eval3-contest] svg[data-testid=radar]')[0].querySelectorAll('[data-testid^=radar-series-]').length })`)
  // 全コンペで初期・全選択のパネル内横溢れ
  const overAll = []
  for (const id of ids) {
    await clickSel(`[data-testid=switch-${id}]`)
    overAll.push({ id, over: await J(OVER(`[data-testid=detail-${id}]`)) })
  }
  out.push({ label, M8_six: { presetsTxt, six, sixOver, pair, bgSame: JSON.stringify(bgAfter) === JSON.stringify(bg0), overAllContests: overAll } })
  await clickSel('[data-testid=sheet-close]')
  // M9/M10: ポータルの評価ダイアログ
  await load()
  const entry = await J(`({ text: document.querySelector('[data-testid=open-eval]').textContent })`)
  const bgD0 = await bg()
  await clickSel('[data-testid=open-eval]')
  await sleep(500)
  const dlg = await J(`(() => { const d = document.querySelector('[data-testid=eval-dialog]'); const r = d.getBoundingClientRect(); const h = [...d.querySelectorAll('h2')].map((e) => e.textContent.replace(/\\s+/g, ' ')); return { title: d.querySelector('[role=dialog] h2, h2')?.textContent ?? null, headings: h, desc: d.querySelector('[id*=description], p')?.textContent.slice(0, 160), round3First: d.querySelector('[data-testid=eval-round3]').getBoundingClientRect().top < d.querySelector('[data-testid=eval-rounds-past]').getBoundingClientRect().top, sonnetOnlyInPast: !d.querySelector('[data-testid=eval-round3]').textContent.includes('Sonnet'), pastHasSonnet: d.querySelector('[data-testid=eval-rounds-past]').textContent.includes('Sonnet 4名'), w: Math.round(r.width) } })()`)
  await save(`${label}-m9-dialog-top.png`)
  const dOver = await J(OVER('[data-testid=eval-dialog]'))
  // 下までスクロールして撮影、スクロール後も溢れが無いこと
  await ev(`(() => { const d = document.querySelector('[data-testid=eval-dialog]'); d.scrollTop = d.querySelector('[data-testid=eval-rounds-past]').offsetTop - 60 })()`)
  await sleep(200)
  await save(`${label}-m10-dialog-past.png`)
  const dOver2 = await J(OVER('[data-testid=eval-dialog]'))
  out.push({ label, M9_M10: { entry, dlg, dialogOverflowTop: dOver, dialogOverflowAfterScroll: dOver2, bgSame: JSON.stringify(await bg()) === JSON.stringify(bgD0) } })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400)
}
// アプリから戻る: 全行が閉じた一覧、ハッシュなし
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
for (const app of ['sat-a', 'odpt']) {
  await load('#open=satellite-2026')
  await send('Page.navigate', { url: `${base}apps/${app}/index.html?from=satellite-2026` }); await sleep(2500)
  const link = await ev(`document.querySelector('header a[href*="index.html"]').getAttribute('href')`)
  await ev(`document.querySelector('header a[href*="index.html"]').click()`); await sleep(2000)
  out.push({ back: app, link, url: await ev('location.pathname + location.hash'), openRows: await ev(`document.querySelectorAll('[data-testid^=row-][aria-expanded=true]').length`), scrollY: await ev('scrollY') })
  if (app === 'sat-a') await save('1280-07-back-from-app.png')
}
// 古い形式 #<コンペid> は無視される
await load('#satellite-2026')
out.push({ legacyHash: '#satellite-2026', openRows: await ev(`document.querySelectorAll('[data-testid^=row-][aria-expanded=true]').length`), scrollY: await ev('scrollY') })
console.log(JSON.stringify({ out, errs }, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
