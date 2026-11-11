// ヘッドレスChromeでスクリーンショットとコンソールエラーを確認する簡易スモークテスト。
// usage: node scripts/smoke.mjs <base_url> <out_dir> [path ...]   path は '' (ポータル) / 'apps/odpt/' など
//   例: npx vite preview --port 8840 --host 127.0.0.1 &
//       node scripts/smoke.mjs http://127.0.0.1:8840/ /tmp/shots / /apps/odpt
// 要: google-chrome, node 22+
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir, ...routesArg] = process.argv.slice(2)
const routes = routesArg.length ? routesArg : ['', 'apps/odpt/']
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })

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
const logs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')

const result = []
for (const [label, w, h, mobile] of [['desktop', 1280, 800, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  for (const route of routes) {
    logs.length = 0
    await send('Page.navigate', { url: 'about:blank' })
    await sleep(300)
    logs.length = 0
    await send('Page.navigate', { url: `${base}${route}` })
    await sleep(4000)
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const name = `${label}-${route === '' ? 'portal' : route.replace(/^apps\//, '').replace(/\/$/, '')}.png`
    fs.writeFileSync(path.join(outDir, name), Buffer.from(shot.result.data, 'base64'))
    const title = (await send('Runtime.evaluate', { expression: 'document.querySelector("h1")?.textContent', returnByValue: true })).result?.result?.value
    const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
    const canvas = await ev('!!document.querySelector(".maplibregl-canvas")')
    const back = await ev('document.querySelector("header a[href$=\\"index.html\\"]")?.getAttribute("href") ?? null')
    result.push({ viewport: label, route, canvas, back, h1: title, shot: name, consoleErrors: [...logs] })
  }
}
console.log(JSON.stringify(result, null, 2))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
const bad = result.filter((r) => r.consoleErrors.length)
process.exit(bad.length ? 1 : 0)
