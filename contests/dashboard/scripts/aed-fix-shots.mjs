// AED 診断マップの修正確認用スクリーンショット（点の見分け方＝色覚の模擬、スマホのタップ結果のポップアップ）。
// usage: node scripts/aed-fix-shots.mjs <base_url> <out_dir>   例: http://127.0.0.1:4181/ docs/screenshots/newplans/fix-20261113
// 要: google-chrome, node 22+
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'aedfix-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
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
let n = 0
const pend = new Map()
const errs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + d.params.exceptionDetails.text)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64'))
}
await send('Runtime.enable'); await send('Page.enable')
const url = `${base}embedded/udc-aed/index.html`

// 1. デスクトップ: 町田市の午前3時を大きく拡大し、通常・2型・1型の色覚の模擬で点を見比べる
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 765, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(4000)
// 「いま使える」AED の1つを中心にする（その近くの時間不明・使えない点も一緒に写る）
console.log(await ev('(function(){var a=App.S.cov.usable[0];App.getMap().jumpTo({center:[a[2],a[1]],zoom:15.2});return 1})()'))
await sleep(2500)
await shot('aed-dots-normal.png')
for (const [type, name] of [['deuteranopia', 'aed-dots-deuteranopia.png'], ['protanopia', 'aed-dots-protanopia.png']]) {
  await send('Emulation.setEmulatedVisionDeficiency', { type })
  await sleep(500)
  await shot(name)
}
await send('Emulation.setEmulatedVisionDeficiency', { type: 'none' })

// 2. スマホ: 地図の空いているところをタップ → 地点の上にポップアップで結果が出る
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 616, deviceScaleFactor: 2, mobile: true })
await send('Emulation.setTouchEmulationEnabled', { enabled: true })
await send('Page.navigate', { url })
await sleep(4000)
const pt = await ev('(function(){var m=App.getMap();var f=m.queryRenderedFeatures({layers:["cells-fill"]}).filter(function(x){return x.properties.g===1})[0];if(!f)return null;var c=f.geometry.coordinates[0][0];var p=m.project([c[0]+0.0006,c[1]+0.0006]);return {x:p.x,y:p.y}})()')
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] })
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(800)
const popup = await ev('(document.querySelector(".maplibregl-popup-content")||{}).textContent')
console.log(JSON.stringify({ popup, errs }))
await shot('aed-mobile-tap-popup.png')
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
