// 進捗表示の全面スクリーンショット（デスクトップ 1280・スマホ 390）と、横スクロール・コンソールエラーの確認。
// usage: node scripts/progress-shots.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pshots-'))
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

const out = []
for (const [label, w, mobile] of [['desktop', 1280, false], ['mobile', 390, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile })
  for (const tab of ['', 'udc-2026', 'satellite-2026', 'ichibiz-2026', 'odpt-2026']) {
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(200)
    await send('Page.navigate', { url: `${base}index.html${tab ? '#' + tab : ''}` })
    await sleep(2500)
    // スマホでは「総司令官の作業」を開いた状態も撮る
    if (mobile && tab === '') await ev(`document.querySelector('[data-testid=progress-tasks]').open = true`)
    const h = await ev('document.documentElement.scrollHeight')
    const sw = await ev('document.documentElement.scrollWidth')
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 } })
    const name = `${label}-${tab || 'portal'}-full.png`
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.result.data, 'base64'))
    out.push({ name, scrollWidth: sw, innerWidth: w, overflowX: sw > w, height: h })
  }
}
console.log(JSON.stringify({ out, errs }, null, 1))
ws.close(); chrome.kill()
