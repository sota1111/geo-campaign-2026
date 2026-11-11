// 手動確認用: preview（http://127.0.0.1:8847/）に対し、ヘッドレスChromeで実操作→スクリーンショット・PDF・コンソールエラー確認。
// usage: node src/apps/biz-realestate/e2e-check.mjs <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9700 + Math.floor(Math.random() * 200)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value
const shot = async (name, full = false) => {
  let clip
  if (full) {
    const h = await ev('document.documentElement.scrollHeight'); const w = await ev('window.innerWidth')
    clip = { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 }
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
  fs.writeFileSync(path.join(out, name), Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const click = async (x, y) => { for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const pages = (b) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
// usage: node src/apps/biz-realestate/steps-check.mjs <out_dir>   （要: vite preview --port 8847。独立ページ /apps/biz-realestate/）
const statuses = () => ev(`JSON.stringify([...document.querySelectorAll('[data-step]')].filter(b=>b.offsetParent!==null).map(b=>b.dataset.step+':'+b.dataset.status))`)
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  logs.length = 0
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'http://127.0.0.1:8847/apps/biz-realestate/' })
  await sleep(3000)
  const openList = async () => { if (mobile && !(await ev(`!!document.querySelector('[data-step]')?.offsetParent`))) { await ev(`document.querySelector('[data-testid=steps-topbar] button').click()`); await sleep(300) } }
  const pick = async (id) => { await openList(); await ev(`document.querySelector('[data-step=${id}]').click()`); await sleep(1200) }
  await openList(); console.log(label, 'initial', await statuses())
  await shot(`${label}-steps-0-initial.png`)
  await pick('place')
  await ev(`document.querySelector('#rs-q').focus(); document.querySelector('#rs-q').select()`)
  await send('Input.insertText', { text: '徳島駅' })
  await ev(`document.querySelector('form[role=search] button[type=submit]').click()`)
  await sleep(3000)
  await ev(`document.querySelector('[data-testid=use-hit] button').click()`)
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('[data-testid=digest]')`)); i++) await sleep(500)
  await sleep(2500)
  await openList(); console.log(label, 'after place', await statuses())
  await pick('answers')
  await ev(`[...document.querySelectorAll('[role=radio]')].find(b=>b.textContent.trim()==='ある').click()`)
  await sleep(500)
  await pick('conditions'); await openList(); console.log(label, 'after conditions', await statuses())
  await pick('exits')
  await pick('print')
  await ev(`[...document.querySelectorAll('#rs-s5 button')].find(b=>b.textContent.includes('印刷・PDFで保存する')).click()`)
  await sleep(1500)
  await openList(); console.log(label, 'final', await statuses())
  console.log(label, 'progress', await ev(`document.querySelector('[data-testid=steps-progress]')?.innerText ?? document.body.innerText.match(/\\d\\/\\d 完了/)?.[0]`))
  await shot(`${label}-steps-9-final.png`)
  if (!mobile) {
    await ev(`document.querySelector('[data-testid=sheet]').scrollIntoView()`)
    await send('Emulation.setEmulatedMedia', { media: 'print' })
    await sleep(500)
    const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, preferCSSPageSize: true, printBackground: true })
    const buf = Buffer.from(pdf.result.data, 'base64')
    fs.writeFileSync(path.join(out, 'print-with-steps.pdf'), buf)
    console.log('print pdf pages:', pages(buf), 'aside display in print:', await ev(`getComputedStyle(document.querySelector('aside')).display`))
    await send('Emulation.setEmulatedMedia', { media: '' })
  }
  console.log(label, 'console errors:', JSON.stringify(logs.filter((l) => !l.includes('status of 404'))))
}
ws.close(); chrome.kill()

