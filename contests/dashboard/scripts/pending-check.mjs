// 「まだ済んでいない手順」が、初期表示では出ず、手順を飛ばした時だけ出ることを確認する。
// usage: node scripts/pending-check.mjs <base_url> [path]   既定 path は apps/sat-b/
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, route = 'apps/sat-b/'] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'))
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
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${base}${route}` })
await sleep(3500)
const initial = await ev(`document.querySelector('[data-testid=steps-pending]')?.textContent ?? null`)
await ev(`document.querySelectorAll('[data-step]')[2].click()`)
await sleep(600)
const skipped = await ev(`document.querySelector('[data-testid=steps-pending]')?.textContent ?? null`)
await ev(`document.querySelector('[data-testid=steps-pending]')?.click()`)
await sleep(600)
const afterClick = await ev(`({ pending: document.querySelector('[data-testid=steps-pending]')?.textContent ?? null, active: document.querySelector('[data-active=true]')?.getAttribute('data-step') })`)
console.log(JSON.stringify({ initial, skipped, afterClick, errs }, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
