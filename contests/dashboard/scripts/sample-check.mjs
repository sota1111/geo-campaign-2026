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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
const apps = ['odpt','udc-moritsuchi','sat-a','sat-b','biz-business','biz-idea','biz-realestate']
for (const a of apps) for (const q of ['', '?sample=1']) {
  await send('Page.navigate', { url: `${base}apps/${a}/index.html${q}#/` }); await sleep(3000)
  const r = await ev(`({over: document.documentElement.scrollHeight - innerHeight, bar: !!document.querySelector('[data-testid=sample-bar]'), open: !!document.querySelector('[data-testid=sample-open]'), ls: (localStorage.clear(), 0), prog: document.querySelector('aside')?.innerText.match(/[0-9]+ のうち [0-9]+ 完了|すべて完了/)?.[0], note: !!document.querySelector('[data-testid=sample-step-note]')})`)
  console.log(a, q || 'normal', JSON.stringify(r))
  if (a === 'sat-a' && q) { const s = await send('Page.captureScreenshot'); fs.writeFileSync(process.env.OUT, Buffer.from(s.result.data, 'base64')) }
}
await send('Page.navigate', { url: `${base}index.html` }); await sleep(1500)
console.log('portal sample links', await ev(`[...document.querySelectorAll('a')].filter(x=>x.href.includes('sample=1')).length`))
ws.close(); chrome.kill()
