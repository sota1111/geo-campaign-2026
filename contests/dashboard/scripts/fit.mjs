// トップ画面が縦スクロールなしで画面に収まるかを、複数の画面サイズで測る（要 preview 起動・google-chrome・node 22+）。
// usage: node scripts/fit.mjs <base_url> <out_dir>
// 出力: 各サイズの scrollHeight / innerHeight / scrollWidth、同時に全部見えているアプリカードの枚数、スクリーンショット。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ }
  await sleep(200)
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))

const sizes = [[1513, 784], [1280, 800], [1440, 900], [1920, 1080], [1024, 768], [390, 844]]
const out = []
for (const [w, h] of sizes) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 })
  await send('Page.navigate', { url: 'about:blank' })
  await sleep(200)
  await send('Page.navigate', { url: base })
  await sleep(2500)
  const m = await ev(`(() => {
    const row = document.querySelector('[data-testid=app-row]')
    const box = row.getBoundingClientRect()
    const cards = [...row.children]
    const full = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= box.left - 1 && r.right <= box.right + 1 }).length
    const rowBottom = box.bottom
    return { scrollHeight: document.documentElement.scrollHeight, innerHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth, innerWidth: innerWidth, fullCards: full, rowBottom: Math.round(rowBottom), cards: cards.length }
  })()`)
  out.push({ size: `${w}x${h}`, ...m, fits: m.scrollHeight <= m.innerHeight })
  await shot(`top-${w}x${h}.png`)
  // コンペカードの折りたたみを全部開いた状態（カードの中だけでスクロールし、アプリの行を押し出さない）
  const open = await ev(`(() => { const row = document.querySelector('[data-testid=app-row]'); const before = row.getBoundingClientRect().top; document.querySelectorAll('[data-testid^=facts-]').forEach((d) => { d.open = true }); return new Promise((r) => setTimeout(() => r({ scrollHeight: document.documentElement.scrollHeight, innerHeight, rowTopBefore: Math.round(before), rowTopAfter: Math.round(row.getBoundingClientRect().top) }), 300)) })()`)
  out[out.length - 1].factsOpen = open
  await shot(`top-${w}x${h}-facts-open.png`)
  if (w === 1513) {
    console.log('popover opened:', await ev(`(() => { document.querySelector('[data-testid=pick-targets-biz-realestate]').click(); return new Promise((r) => setTimeout(() => r(!!document.querySelector('[data-testid=popover-biz-realestate]')), 400)) })()`))
    await sleep(500)
    await shot(`top-${w}x${h}-popover.png`)
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await ev(`document.querySelector('[data-testid=pick-satellite-2026]').click()`)
    await sleep(500)
    await shot(`top-${w}x${h}-selected.png`)
  }
}
console.log(JSON.stringify(out, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
