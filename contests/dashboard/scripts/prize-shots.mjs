// トップの賞金「内訳」ポップオーバーを開いてスクリーンショットを撮る（要 preview 起動・google-chrome・node 22+）。
// usage: node scripts/prize-shots.mjs <base_url> <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'prize-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let t
for (let i = 0; i < 50; i++) {
  try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (t.length) break } catch { /* retry */ }
  await sleep(200)
}
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const p = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = (e) => send('Runtime.evaluate', { expression: e })
await send('Emulation.setDeviceMetricsOverride', { width: 1513, height: 784, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: base })
await sleep(2500)
for (const [i, name] of [[0, 'satellite'], [1, 'ichibiz'], [2, 'udc'], [3, 'odpt']]) {
  await ev(`document.querySelectorAll('[data-testid=prize-open]')[${i}].click()`)
  await sleep(500)
  fs.writeFileSync(path.join(outDir, `prize-${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await sleep(300)
}
chrome.kill()
process.exit(0)
