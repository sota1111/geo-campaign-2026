// 盛土巡視台帳の操作確認（ヘッドレスChrome、CDP）。要 preview 起動(8844)。
// usage: node src/apps/sat-b/e2e.mjs <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const base = 'http://127.0.0.1:8844/', out = process.argv[2]
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch {} await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (m) => { const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || '')) }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value }
const shot = async (n) => fs.writeFileSync(path.join(out, n), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'))
const click = (sel, text) => ev(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(sel)})];const e=els.find(x=>!${JSON.stringify(text)}||x.textContent.includes(${JSON.stringify(text)}));if(!e)return 'NOTFOUND ${sel} ${text}';if(e.getAttribute('role')==='tab'){e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))}else{e.click()};return 'ok'})()`)
const setInput = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('input',{bubbles:true}));return e.value})()`)
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const res = {}
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: base + '#/apps/sat-b' }); await sleep(500)
  await ev('localStorage.clear()'); await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: base + '#/apps/sat-b' }); await sleep(4000)
  const R = {}
  R.overflow = await ev('document.documentElement.scrollWidth - window.innerWidth')
  R.banner = await ev('document.body.innerText.includes("実データ版（神奈川県横須賀市") && document.body.innerText.includes("未接続")')
  await ev(`document.querySelector("[role=tablist]").scrollIntoView()`); await sleep(500); await shot(`${label}-1-ledger.png`)
  R.rowClick = await click('tbody tr[data-id]')
  await sleep(1500); await shot(`${label}-2-detail.png`)
  R.detailText = await ev('document.body.innerText.includes("点数に含めない")')
  if (mobile) { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }) }
  await sleep(600)
  R.plan = await click('[role=tab]', '巡視計画'); await sleep(2000)
  R.planRows = await ev('document.querySelectorAll("tbody tr").length')
  R.capVal = await ev('document.querySelector("#sat-b-cap").value')
  await ev(`document.querySelector("[role=tablist]").scrollIntoView()`); await sleep(1200); await shot(`${label}-3-plan.png`)
  await ev(`window.__dl=[];window.__dlname=[];const oc=URL.createObjectURL.bind(URL);URL.createObjectURL=(b)=>{b.text().then(t=>window.__dl.push(t));return oc(b)};HTMLAnchorElement.prototype.click=function(){window.__dlname.push(this.download)}`)
  R.csv = await click('button', '計画をCSVで書き出す'); await sleep(600)
  R.dl = await ev('JSON.stringify({names:window.__dlname,csv:(window.__dl||[])[0]?.slice(0,500)})')
  R.rec = await click('table button', '記録する'); await sleep(800)
  R.recTabActive = await ev('document.querySelector("[role=tab][data-state=active]").textContent')
  await setInput('#sat-b-who', '盛土班')
  R.submit = await click('button[type=submit]', '記録する'); await sleep(800)
  R.saved = await ev('document.body.innerText.includes("台帳の「最新の巡視」に反映")')
  await shot(`${label}-4-record.png`)
  R.recRows = await ev('[...document.querySelectorAll("tbody tr")].map(r=>r.innerText.replace(/\\s+/g," ")).join(" | ")')
  R.ledger = await click('button', '台帳で確認する'); await sleep(1500)
  R.ledgerHas = await ev('[...document.querySelectorAll("tbody tr[data-id]")].filter(r=>!r.innerText.includes("未巡視")).map(r=>r.innerText.replace(/\\s+/g," ")).join(" | ")')
  await shot(`${label}-5-ledger-after.png`)
  await click('[role=tab]', '検出条件'); await sleep(500); await shot(`${label}-6-tune.png`)
  await click('[role=tab]', '出典'); await sleep(500); await shot(`${label}-7-about.png`)
  await send('Page.navigate', { url: base + '#/apps/sat-b?mode=sample' }); await sleep(1000)
  await ev('location.reload()'); await sleep(3000)
  R.sampleBanner = await ev('document.body.innerText.includes("架空サンプル（実在の盛土ではありません）")')
  await shot(`${label}-8-sample.png`)
  R.overflow2 = await ev('document.documentElement.scrollWidth - window.innerWidth')
  R.errors = [...logs]; res[label] = R; logs.length = 0
}
console.log(JSON.stringify(res, null, 1))
ws.close(); chrome.kill()
