// ポータル一覧（アコーディオン）の確認: 最初の画面・衛星を開いた状態・UDC を開いた状態のスクリーンショットと、
// クリック前後の行の top（getBoundingClientRect）、スクロール位置、横スクロール、コンソールエラー。
// usage: node scripts/portal-shots.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-'))
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
const save = (name, b64) => fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'))
const rect = (id) => `(() => { const r = document.querySelector('[data-testid=row-${id}]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height } })()`
const ids = ['satellite-2026', 'ichibiz-2026', 'udc-2026', 'odpt-2026']
const out = []
const load = async () => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: `${base}index.html` }); await sleep(2500)
}
const click = async (id) => {
  const r = JSON.parse(await ev(`JSON.stringify(${rect(id)})`))
  const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 30)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(500)
}
for (const [label, w, h0, mobile] of [['1280', 1280, 765, false], ['390', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h0, deviceScaleFactor: 1, mobile })
  await load()
  const first = {
    order: JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-testid^=row-]')].map((e) => e.dataset.testid))`)),
    rowBottoms: JSON.parse(await ev(`JSON.stringify(${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().bottom)))`)),
    scrollWidth: await ev('document.documentElement.scrollWidth'), innerWidth: w, scrollHeight: await ev('document.documentElement.scrollHeight'), viewportH: h0,
  }
  save(`${label}-1-first.png`, (await send('Page.captureScreenshot', { format: 'png' })).result.data)
  out.push({ label, first })
  for (const [id, shot] of [['satellite-2026', '2-satellite-open'], ['udc-2026', '3-udc-open'], ['ichibiz-2026'], ['odpt-2026']]) {
    await load()
    const before = JSON.parse(await ev(`JSON.stringify(${rect(id)})`))
    await click(id)
    const opened = JSON.parse(await ev(`JSON.stringify({ top: ${rect(id)}.top, scrollY: window.scrollY, expanded: document.querySelector('[data-testid=row-${id}]').getAttribute('aria-expanded'), hash: location.hash, detail: !!document.querySelector('[data-testid=detail-${id}]'), sw: document.documentElement.scrollWidth })`))
    if (shot) {
      save(`${label}-${shot}.png`, (await send('Page.captureScreenshot', { format: 'png' })).result.data)
      const h = await ev('document.documentElement.scrollHeight')
      save(`${label}-${shot}-full.png`, (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 8000), scale: 1 } })).result.data)
    }
    await click(id)
    const closed = JSON.parse(await ev(`JSON.stringify({ top: ${rect(id)}.top, scrollY: window.scrollY, expanded: document.querySelector('[data-testid=row-${id}]').getAttribute('aria-expanded'), detail: !!document.querySelector('[data-testid=detail-${id}]') })`))
    out.push({ label, id, topBefore: before.top, topAfterOpen: opened.top, topAfterClose: closed.top, scrollYAfterOpen: opened.scrollY, scrollYAfterClose: closed.scrollY, expanded: opened.expanded, detailShown: opened.detail, hash: opened.hash, closedExpanded: closed.expanded, detailAfterClose: closed.detail, scrollWidthOpen: opened.sw })
  }
  // ハッシュで開いて読み込む: スクロールしないこと
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: `${base}index.html#open=udc-2026` }); await sleep(2500)
  out.push({ label, hashLoad: JSON.parse(await ev(`JSON.stringify({ scrollY: window.scrollY, open: !!document.querySelector('[data-testid=detail-udc-2026]') })`)) })
}
console.log(JSON.stringify({ out, errs }, null, 1))
ws.close(); chrome.kill()
