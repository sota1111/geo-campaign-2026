// AI評価の表示（全体タブ・コンペ別の枠）のスクリーンショットを、デスクトップとスマホ幅で撮る。
// usage: node scripts/eval-shots.mjs <base_url> <out_dir>   要 google-chrome, node 22+
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'evshot-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ }
  await sleep(200)
}
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value

// [幅ラベル, 幅, 高さ, mobile, ハッシュ, 枠を開く, 全ページ撮影]
const jobs = [
  ['desktop', 1280, 800, false, 'eval', false, true],
  ['desktop', 1280, 800, false, 'udc-2026', false, false],
  ['desktop', 1280, 800, false, 'satellite-2026', true, true],
  ['mobile', 390, 844, true, 'eval', false, true],
  ['mobile', 390, 844, true, 'ichibiz-2026', true, true],
]
for (const [label, w, h, mobile, hash, open, full] of jobs) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(200)
  await send('Page.navigate', { url: `${base}#${hash}` })
  await sleep(2500)
  if (open) await ev("document.querySelectorAll('details[data-testid^=eval-]').forEach(d=>{d.open=true})")
  const m = JSON.parse(await ev('JSON.stringify({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight})'))
  console.log(label, hash, open ? 'open' : 'closed', m, m.sw > m.cw ? 'HORIZONTAL OVERFLOW' : 'ok')
  const opts = { format: 'png' }
  if (full) Object.assign(opts, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(m.sh, 4000), scale: 1 } })
  const shot = await send('Page.captureScreenshot', opts)
  fs.writeFileSync(path.join(outDir, `${label}-${hash}${open ? '-open' : ''}.png`), Buffer.from(shot.result.data, 'base64'))
}
chrome.kill()
process.exit(0)
