// トップ画面（コンペのカード4枚の横一列＋アプリのカード18枚の横一列）を、1280×800・1024×768・390×844 で、
// 未選択・コンペ選択時・提出先を選んだとき の3状態で撮り、ページ全体の横スクロール・行の数・コンソールエラーを数値で出す。
// usage: node scripts/allapps-rows-shots.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-'))
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
  if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + d.params.exceptionDetails.text)
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('LOG ' + d.params.entry.text)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => { const r = (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result; if (r?.exceptionDetails) console.error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r?.result?.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')

const out = []
const clicks = {
  none: '',
  contest: "document.querySelector('[data-testid=pick-satellite-2026]').click()",
  targets: "document.querySelector('[data-testid=pick-satellite-2026]').click(); for (const id of ['t-sat-b-satellite-2026','t-sat-alpha-satellite-2026','t-sat-b-ichibiz-2026-idea']) document.querySelector('[data-testid=' + id + ']').click()",
}
for (const [w, h] of [[1280, 800], [1024, 768], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  for (const [name, js] of Object.entries(clicks)) {
    await send('Page.navigate', { url: base })
    await sleep(1200)
    await ev('localStorage.clear()')
    await send('Page.navigate', { url: base })
    await sleep(1500)
    if (js) { await ev(js); await sleep(500) }
    const m = await ev(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const ul = document.querySelector('[data-testid=app-row]'); const cr = document.querySelector('[data-testid=contest-row]'); return { sw: document.documentElement.scrollWidth, iw: innerWidth, contestTops: [...document.querySelectorAll('[data-contest-card]')].map((e) => Math.round(e.getBoundingClientRect().top)), contestW: [...document.querySelectorAll('[data-contest-card]')].map((e) => Math.round(e.getBoundingClientRect().width)), appRowScrollW: ul.scrollWidth, appRowClientW: ul.clientWidth, appTops: [...new Set([...ul.children].map((e) => Math.round(e.getBoundingClientRect().top)))], order: [...ul.children].slice(0, 5).map((e) => e.dataset.appCard), contestRowScrolls: cr.scrollWidth > cr.clientWidth } })()`)
    // 画面全体（ページ最下部まで）を撮る
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    fs.writeFileSync(path.join(outDir, `${w}x${h}-${name}.png`), Buffer.from(shot.result.data, 'base64'))
    const y = await ev(`({ appsHeadingY: Math.round(document.getElementById('h-apps').getBoundingClientRect().top + scrollY), firstCardTop: Math.round(document.querySelector('[data-testid=app-row] > li').getBoundingClientRect().top + scrollY), tabStopsPerCard: document.querySelectorAll('[data-testid=app-row] > li:first-child a, [data-testid=app-row] > li:first-child input:not(:disabled), [data-testid=app-row] > li:first-child summary').length })`)
    out.push({ size: `${w}x${h}`, state: name, ...m, ...y })
  }
}
// M2: 提出先を選んだとき、押したカードの位置がずれないか（文書内の y）
const shift = []
for (const [w, h] of [[1280, 800], [1024, 768], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  await send('Page.navigate', { url: base }); await sleep(1200); await ev('localStorage.clear()'); await send('Page.navigate', { url: base }); await sleep(1500)
  await ev("document.querySelector('[data-testid=pick-satellite-2026]').click()"); await sleep(300)
  const pos = `(() => { const e = document.querySelector('[data-testid=t-sat-alpha-satellite-2026]'); const c = document.querySelector('[data-app-card=sat-alpha]'); return { box: Math.round(e.getBoundingClientRect().top + scrollY), card: Math.round(c.getBoundingClientRect().top + scrollY) } })()`
  const before = []
  await ev("document.querySelector('[data-testid=t-sat-b-satellite-2026]').click()"); await sleep(300)
  const b = await ev(pos)
  await ev("document.querySelector('[data-testid=t-sat-alpha-satellite-2026]').click()"); await sleep(300)
  const a = await ev(pos)
  shift.push({ size: `${w}x${h}`, before: b, after: a, shiftPx: a.box - b.box })
}
console.log(JSON.stringify({ out, shift, errs }, null, 1))
ws.close(); chrome.kill()
