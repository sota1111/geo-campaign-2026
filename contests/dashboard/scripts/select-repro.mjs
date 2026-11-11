// shadcn Select（Radix）を閉じた直後の最初のクリックが届くかの再現スクリプト。
// usage: node scripts/select-repro.mjs <base_url>   （要 preview 起動, google-chrome, node 22+）
// 盛土巡視台帳で「巡視の結果」Select を開いて選択 → 直後（0/30/100/300ms 後）に「記録する」を実マウスでクリックし、
// click イベントが届いたかを数える。届かなければ NG。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const center = (sel) => ev(`(() => { const e = ${sel}; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()`)
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

const results = []
for (const delay of [0, 30, 100, 300]) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}apps/sat-b/#/?tab=record` }); await sleep(3000)
  const trig = `document.querySelector('[aria-label="巡視の結果"]')`
  const btn = `[...document.querySelectorAll('button[type=submit]')].find(b => b.textContent.includes('記録する'))`
  await ev(`window.__clicks = 0; (${btn}).addEventListener('click', (e) => { window.__clicks++; e.preventDefault() })`)
  const [tx, ty] = await center(trig)
  await click(tx, ty); await sleep(500)
  const [ox, oy] = await ev(`(() => { const o = [...document.querySelectorAll('[role=option]')].pop(); const r = o.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()`)
  // 選択肢をクリック（位置はスクロールで変わらないよう、先にボタン位置を計算し直す）
  const [ox2, oy2] = await ev(`(() => { const o = [...document.querySelectorAll('[role=option]')].pop(); const r = o.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()`)
  await click(ox2 ?? ox, oy2 ?? oy)
  await sleep(delay)
  const bodyPE = await ev('document.body.style.pointerEvents || "(none)"')
  const [bx2, by2] = await ev(`(() => { const e = ${btn}; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2] })()`)
  await click(bx2, by2); await sleep(200)
  const clicks = await ev('window.__clicks')
  results.push({ delayMs: delay, bodyPointerEventsAtClick: bodyPE, buttonClicks: clicks, ok: clicks === 1 })
}
console.log(JSON.stringify(results, null, 2))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
process.exit(results.every((r) => r.ok) ? 0 : 1)
