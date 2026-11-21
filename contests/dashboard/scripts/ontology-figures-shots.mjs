// 図解ページ（ontology-figures/）の全体スクリーンショットと確認（1280×800・390×844）。横スクロール・図ごとの実効文字サイズ・コンソールエラーも見る。
// usage: node scripts/ontology-figures-shots.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'oshots-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') errs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const shot = async (name) => fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`)
const result = []
for (const [label, w, h, mobile] of [['desktop', 1280, 800, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: base + 'ontology-figures/' })
  await sleep(2500)
  const r = { viewport: label }
  r.hscroll = await ev('document.documentElement.scrollWidth > window.innerWidth')
  // SVG 内の最小の実効文字サイズ（px）= font-size × 表示倍率
  r.minFontPx = await ev(`Math.min(...[...document.querySelectorAll('svg')].map(s => { const k = s.getBoundingClientRect().width / s.viewBox.baseVal.width; return Math.min(...[...s.querySelectorAll('text')].map(t => parseFloat(t.getAttribute('font-size')) * k)) }).filter(Number.isFinite))`)
  r.sections = await ev(`document.querySelectorAll('section.fig').length`)
  const hgt = await ev('document.documentElement.scrollHeight')
  const data = (await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: hgt, scale: 1 } })).result.data
  fs.writeFileSync(path.join(outDir, `${label}-full.png`), Buffer.from(data, 'base64'))
  r.height = hgt
  result.push(r)
}
console.log(JSON.stringify(result, null, 1))
console.log('console errors:', errs.length ? errs : 'none')
ws.close(); chrome.kill()
