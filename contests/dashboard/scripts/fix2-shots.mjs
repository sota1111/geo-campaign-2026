// 2回目のデザイン再審査（N1〜N3）の確認。usage: node scripts/fix2-shots.mjs <base_url> <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fx2-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
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
  if (d.method === 'Runtime.exceptionThrown') errs.push('EXC ' + d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error')
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64')) }
await send('Runtime.enable'); await send('Page.enable')
const out = {}
const go = async (url) => { await send('Page.navigate', { url }); await sleep(3500) }

for (const [label, w, h, mobile] of [['d', 1280, 765, false], ['m', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  // N1: IN1 カードのボタンがカードに収まるか
  await go(`${base}index.html#ichibiz-2026`)
  out[`${label}-N1`] = await ev(`(function(){var b=document.querySelector('[data-testid^="card-only-demo"]');var card=b.closest('[data-slot="card"]');b.scrollIntoView({block:'center'});var r=b.getBoundingClientRect(),c=card.getBoundingClientRect();return {sw:document.documentElement.scrollWidth,btnRight:Math.round(r.right),cardRight:Math.round(c.right),inside:r.right<=c.right+1}})()`)
  await sleep(300); await shot(`${label}-N1-ichibiz-in1.png`)
  // N2: 作品①ヘッダーの「出典・ライセンス」が見えるか
  await go(`${base}apps/odpt/index.html`)
  out[`${label}-N2`] = await ev(`(function(){var h=document.querySelector('header');var s=[].slice.call(document.querySelectorAll('header a,header button')).filter(function(e){return /出典/.test(e.textContent)})[0];var r=s&&s.getBoundingClientRect();return {headerScroll:h.scrollWidth,headerClient:h.clientWidth,srcVisible:!!r&&r.right<=window.innerWidth,srcRight:r&&Math.round(r.right),sw:document.documentElement.scrollWidth}})()`)
  await shot(`${label}-N2-odpt-header.png`)
}
// N3: 別々の2地点を続けてタップ（クリック）し、毎回ポップアップが出るか
for (const [label, w, h, mobile] of [['m', 390, 616, true], ['d', 1280, 765, false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  await go(`${base}embedded/udc-aed/index.html`)
  const pts = await ev(`(function(){var m=App.getMap();var fs=m.queryRenderedFeatures({layers:["cells-fill"]}).filter(function(x){return x.properties.g===1});var res=[];[0,Math.floor(fs.length/2)].forEach(function(k){var c=fs[k].geometry.coordinates[0][0];var p=m.project([c[0]+0.0006,c[1]+0.0006]);res.push({x:p.x,y:p.y})});return res})()`)
  const tap = async (p) => {
    if (mobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }) }
    await sleep(700)
    return ev('(document.querySelector(".maplibregl-popup-content")||{}).textContent||""')
  }
  const r = []
  for (const p of [pts[0], pts[1], pts[0]]) r.push(await tap(p))
  out[`${label}-N3`] = { popups: r, allShown: r.every((t) => t.includes('新たに徒歩圏')) }
  await shot(`${label}-N3-second-tap.png`)
}
out.errs = errs
console.log(JSON.stringify(out, null, 1))
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
