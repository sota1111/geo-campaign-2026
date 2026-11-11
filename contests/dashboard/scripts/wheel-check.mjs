// 地図の上でホイールを回した時、地図が拡大されずページがスクロールするかを確認する。
// usage: node scripts/wheel-check.mjs <base_url> [path]   既定 path は apps/sat-a/
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, route = 'apps/sat-a/'] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } }
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${base}${route}` })
await sleep(3500)
const [x, y] = await ev(`(() => { const e = document.querySelector('.maplibregl-canvas'); e.scrollIntoView({block:'start'}); const r = e.getBoundingClientRect(); return [r.x + r.width/2, Math.min(r.y + 100, 700)] })()`)
await sleep(300)
const before = await ev('window.scrollY')
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: 300 })
await sleep(800)
const after = await ev('window.scrollY')
const max = await ev('document.documentElement.scrollHeight - innerHeight')
console.log(JSON.stringify({ scrollBefore: before, scrollAfter: after, maxScroll: max, ok: after > before || before >= max - 1 }))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
