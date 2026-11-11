// 手順サイドバーの確認スクリプト（verify.mjs の兄弟）。画面操作の確認スクリプト（ヘッドレスChrome）。使い方:
//   npx vite preview --port 8841 --host 127.0.0.1 &
//   node src/apps/odpt/verify.mjs http://127.0.0.1:8841/ src/apps/odpt/screenshots
// 「富山市大町」を検索 → 平日朝30分病院の結論 → 休日との違い → 最終便 → コピー → 各タブ、をデスクトップと390pxで確認する。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:8841/'
const out = process.argv[3] ?? 'src/apps/odpt/screenshots'
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'EVALERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(base).origin }).catch(() => {})
const shot = async (name) => {
  const m = await send('Page.getLayoutMetrics')
  const h = Math.min(Math.ceil(m.result.cssContentSize.height), 6000)
  const w = m.result.cssContentSize.width
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(s.result.data, 'base64'))
}
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(!e)return 'notfound';e.click();return 'ok'})()`)
const concl = () => ev(`document.querySelector('[data-testid=conclusion]')?.innerText`)


const realClick = async (sel) => {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
  if (!r) return 'notfound'
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r[0], y: r[1], button: 'left', clickCount: 1 })
  return 'ok'
}
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  logs.length = 0
  await send('Page.navigate', { url: base + 'apps/odpt/' })
  await sleep(4500)
  console.log(`== ${label}`)
  const openTop = async () => { if (mobile) { const open = await ev(`document.querySelector('[data-testid=steps-topbar] button[aria-expanded]')?.getAttribute('aria-expanded')`); if (open !== 'true') await realClick('[data-testid=steps-topbar] button[aria-expanded]'); await sleep(300) } }
  const statuses = async () => { await openTop(); const r = await ev(`[...document.querySelectorAll('[data-step]')].map(e=>e.dataset.step+':'+e.dataset.status).join(' ')`); if (mobile) await realClick('[data-testid=steps-topbar] button[aria-expanded]'); await sleep(200); return r }
  const pick = async (id) => { await openTop(); const r = await realClick(`[data-step=${id}]`); await sleep(900); return r }
  console.log('initial:', await statuses())
  await shot(`${label}-steps-0`)
  console.log('step place:', await pick('place'), 'focused=', await ev(`document.activeElement?.id`))
  await send('Input.insertText', { text: process.env.Q || '富山市大町' })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(4500)
  console.log('after search:', await statuses())
  for (const id of ['cond', 'verdict', 'hol', 'last', 'copy']) {
    console.log('step', id, await pick(id), '->', await statuses())
    if (id === 'copy') {
      console.log('focused:', await ev(`document.activeElement?.dataset?.testid`))
      await sleep(1200)
      console.log('copy btn rect:', await ev(`JSON.stringify(document.querySelector('[data-testid=copy-conclusion]').getBoundingClientRect())`), 'innerHeight', await ev('innerHeight'))
      await realClick('[data-testid=copy-conclusion]'); await sleep(1000)
      console.log('after copy click:', await statuses())
    }
  }
  console.log('progress:', await ev(`document.querySelector('[data-testid=steps-progress]')?.innerText ?? '(閉じている)'`))
  await shot(`${label}-steps-done`)
  console.log('overflowX:', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  console.log('console errors:', JSON.stringify(logs))
}
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
