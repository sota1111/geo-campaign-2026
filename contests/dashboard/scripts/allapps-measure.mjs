// トップ画面（コンペの大カード＋アプリの小カード）とコンペ概要ページを、1280×800・1024×768・390×844 で撮り、
// 横スクロール・小カードの最小幅・コンソールエラーを数値で出す。
// usage: node scripts/allapps-measure.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
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
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')

const out = []
for (const [w, h] of [[1280, 800], [1024, 768], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 })
  for (const [name, route] of [['top', ''], ['contest-ichibiz', 'contest/ichibiz-2026/'], ['contest-satellite', 'contest/satellite-2026/']]) {
    await send('Page.navigate', { url: base + route })
    await sleep(2500)
    const m = await ev(`(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, minMini: Math.min(...[...document.querySelectorAll('[data-app-card]')].map((e) => Math.round(e.getBoundingClientRect().width))), bigCards: document.querySelectorAll('[data-contest-card]').length, miniCards: document.querySelectorAll('a[data-app-card]').length }))()`)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    fs.writeFileSync(path.join(outDir, `${w}x${h}-${name}.png`), Buffer.from(shot.result.data, 'base64'))
    out.push({ size: `${w}x${h}`, page: name, ...m })
  }
}
console.log(JSON.stringify({ out, errs }))
ws.close(); chrome.kill()
