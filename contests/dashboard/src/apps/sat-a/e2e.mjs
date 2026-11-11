// sat-a の通し確認（ヘッドレスChrome）。目標の成果を操作で達成し、スクリーンショットを撮る。
// usage: npx vite preview --port 8843 --host 127.0.0.1 &
//        node src/apps/sat-a/e2e.mjs http://127.0.0.1:8843/ src/apps/sat-a/screenshots
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')

const mouse = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const find = (sel, text) => `(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; return ${text ? `els.find(e=>e.textContent.includes(${JSON.stringify(text)}))` : 'els[0]'} })()`
const clickSel = async (sel, text) => {
  const ok = await ev(`(() => { const el=${find(sel, text)}; if(!el) return false; el.scrollIntoView({block:'center'}); return true })()`)
  if (!ok) throw new Error('not found ' + sel + ' ' + text)
  await sleep(150)
  const r = await ev(`(() => { const b=${find(sel, text)}.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2] })()`)
  await mouse(r[0], r[1]); await sleep(400)
}
const key = async (k) => { for (const t of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type: t, key: k, code: k, windowsVirtualKeyCode: k === 'ArrowRight' ? 39 : 37 }); await sleep(100) }
const txt = (tid) => ev(`document.querySelector('[data-testid=${tid}]')?.innerText`)
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')) }
const fullshot = async (name) => {
  const h = await ev('document.documentElement.scrollHeight')
  const w = await ev('innerWidth')
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'))
}
const out = {}
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  const r = (out[label] = {})
  logs.length = 0
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}apps/sat-a/` }); await sleep(3500)
  r.top1 = await txt('m-top'); r.count = await txt('m-count'); r.w0 = await txt('w-out')
  await fullshot(`${label}-1-step1.png`)
  await ev(`document.querySelector('[role=slider]').focus()`)
  await key('ArrowRight'); await key('ArrowRight')
  r.w1 = await txt('w-out'); r.top1_w70 = await txt('m-top')
  await ev(`document.querySelector('[role=slider]').focus()`)
  await key('ArrowLeft'); await key('ArrowLeft')
  r.w_back = await txt('w-out')
  await clickSel('[data-testid=to2]')
  r.tab2 = await ev(`document.querySelector('[role=tab][aria-selected=true]')?.textContent`)
  await clickSel('[data-testid=auto]')
  r.auto = [await txt('sel-count'), await txt('sel-km')]
  await fullshot(`${label}-2-step2-auto.png`)
  await clickSel('[role=checkbox]')
  r.afterUncheck = [await txt('sel-count'), await txt('sel-km')]
  await clickSel('[role=checkbox]')
  r.afterRecheck = [await txt('sel-count'), await txt('sel-km')]
  await ev(`document.querySelectorAll('[role=slider]')[0].focus()`)
  for (let i = 0; i < 8; i++) await key('ArrowLeft')
  r.overBudget = [await txt('bud-out'), await txt('sel-km'), await ev(`document.querySelector('[data-testid=to3]').disabled`)]
  await fullshot(`${label}-3-step2-over.png`)
  for (let i = 0; i < 8; i++) await key('ArrowRight')
  await clickSel('[data-testid=clear]')
  await ev(`document.querySelector('[role=region]').scrollIntoView({block:'center'})`); await sleep(300)
  const mr = await ev(`(() => { const b=document.querySelector('[role=region]').getBoundingClientRect(); return [b.x,b.y,b.width,b.height] })()`)
  let hit = null
  outer: for (let yy = 0.1; yy < 0.95; yy += 0.04) for (let xx = 0.1; xx < 0.95; xx += 0.04) {
    await mouse(mr[0] + mr[2] * xx, mr[1] + mr[3] * yy)
    await sleep(60)
    const c = await txt('sel-count')
    if (c && c.trim() !== '0') { hit = [xx.toFixed(2), yy.toFixed(2), c]; break outer }
  }
  r.mapClick = hit
  await shot(`${label}-4-map-click.png`)
  await clickSel('[data-testid=auto]')
  await ev('window.scrollTo(0, 900)'); await sleep(400)
  r.stickyTop = await ev(`Math.round(document.querySelector('[data-testid=sticky-bar]').getBoundingClientRect().top)`)
  await shot(`${label}-4b-sticky.png`)
  await clickSel('[data-testid=sticky-next]')
  r.stickyWorks = await ev(`document.querySelector('[role=tab][aria-selected=true]')?.textContent`)
  await clickSel('[role=tab]', '選ぶ')
  await clickSel('[data-testid=to3]')
  r.s3count = await txt('s3-count')
  await fullshot(`${label}-5-step3-before.png`)
  await clickSel('[data-testid=scan]')
  r.s3hit = await txt('s3-hit'); r.auc = await txt('auc-adopted')
  await fullshot(`${label}-6-step3-result.png`)
  await clickSel('[data-testid=apply]')
  r.round = await txt('round'); r.msg = await txt('calib-msg'); r.top2 = await txt('m-top'); r.w2 = await txt('w-out')
  await fullshot(`${label}-7-round2.png`)
  r.scrollW = await ev('[document.documentElement.scrollWidth, innerWidth]')
  r.errors = [...logs]
}
console.log(JSON.stringify(out, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
