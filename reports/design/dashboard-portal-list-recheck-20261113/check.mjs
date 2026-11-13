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
const prof = fs.mkdtempSync(path.join(outDir, '.chrome-'))
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
  if (name.includes('-03-sheet') && !name.includes('ichibiz')) return;
  if (name === '390-04-odpt-sheet.png') return;
  const h = await ev('document.documentElement.scrollHeight')
  const params = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: Math.min(h, 6000), scale: 1 } } : { format: 'png' }
  fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', params)).result.data, 'base64'))
}
const J = async (e) => JSON.parse(await ev(`JSON.stringify(${e})`))
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
    if (mobile) {
      const sh = await J(`(() => { const b = document.querySelector('[data-testid=detail-${id}]'); const c = document.querySelector('[data-testid=detail-sheet]').getBoundingClientRect(); return { sheetTop: Math.round(c.top), sheetBottom: Math.round(c.bottom), bodyClient: b.clientHeight, bodyScroll: b.scrollHeight, closeBtn: !!document.querySelector('[data-testid=sheet-close]') } })()`)
      // シートの中をスクロールし、ページが動かないこと
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 600, deltaX: 0, deltaY: 400 })
      await sleep(300)
      const after = await J(`({ inner: Math.round(document.querySelector('[data-testid=detail-${id}]').scrollTop), pageY: Math.round(scrollY) })`)
      await save(`${label}-03-sheet-scrolled-${id}.png`)
      await clickSel('[data-testid=sheet-close]')
      const closed = await state(id)
      out.push({ label, id, before, opened, sheet, sheetInfo: sh, afterWheel: after, closed, sheetGone: await ev(`!document.querySelector('[data-testid=detail-sheet]')`) })
    } else {
      await clickSel(row(id))
      const closed = await state(id)
      out.push({ label, id, before, opened, sheet, closed })
    }
  }
  if (!mobile) {
    // 長い詳細（イチBiz）: 下へスクロールしても、開いた行の見出しが上（top=48）に貼り付く。末尾の「閉じる」で閉じる
    await load()
    await clickSel(row('ichibiz-2026'))
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 700, y: 400, deltaX: 0, deltaY: 900 })
    await sleep(300)
    const stuck = await J(`({ rowTop: ${rect(row('ichibiz-2026'))}.top, scrollY: Math.round(scrollY) })`)
    await save(`${label}-04-sticky.png`)
    // 末尾の閉じるボタンが見える位置までスクロールして押す
    await ev(`window.scrollTo(0, document.querySelector('[data-testid=close-ichibiz-2026]').getBoundingClientRect().bottom + scrollY - innerHeight + 60)`)
    await sleep(300)
    const pre = await J(`({ scrollY: Math.round(scrollY), udcTop: ${rect(row('udc-2026'))}.top, closeBtn: ${rect('[data-testid=close-ichibiz-2026]')}, docH: document.documentElement.scrollHeight })`)
    await save(`${label}-05-bottom-close-before.png`)
    await clickSel('[data-testid=close-ichibiz-2026]')
    const post = await J(`({ scrollY: Math.round(scrollY), udcTop: ${rect(row('udc-2026'))}.top, ichiTop: ${rect(row('ichibiz-2026'))}.top, docH: document.documentElement.scrollHeight, expanded: document.querySelector('${row('ichibiz-2026')}').getAttribute('aria-expanded'), focus: document.activeElement?.dataset?.testid })`)
    await save(`${label}-06-bottom-close-after.png`)
    out.push({ label, stickyCheck: { stuck, bottomClose: { pre, post } } })
    // 下へスクロールした状態で別の行を開閉しても動かない
    await load()
    await ev('window.scrollTo(0, 0)')
    await clickSel(row('satellite-2026'))
    await ev(`window.scrollTo(0, document.querySelector('${row('udc-2026')}').getBoundingClientRect().top + scrollY - 200)`); await sleep(200)
    const a = await state('udc-2026'); await clickSel(row('udc-2026')); const b = await state('udc-2026'); await clickSel(row('udc-2026')); const c = await state('udc-2026')
    out.push({ label, scrolledToggle: { before: a, open: b, closed: c } })
  } else {
    // 開いた詳細の先頭がそのまま見えること、横スクロールなし
    await load()
    await clickSel(row('odpt-2026'))
    out.push({ label, sheetHtmlOverflowX: await ev('document.documentElement.scrollWidth'), sheetScrollY: await ev('scrollY') })
    await save(`${label}-04-odpt-sheet.png`)
  }
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
