// 手順サイドバーの通し確認（/apps/sat-b/）。要 preview 起動(8844)。
// usage: node src/apps/sat-b/steps-e2e.mjs <out_dir>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const base = 'http://127.0.0.1:8844/apps/sat-b/', out = process.argv[2]
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
const setSel = (v) => ev(`(()=>{const e=document.querySelector('#sat-b-result');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,${JSON.stringify(v)});e.dispatchEvent(new Event('change',{bubbles:true}));return e.value})()`)
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const statuses = () => ev('[...document.querySelectorAll("[data-step]")].filter((e,i,a)=>a.findIndex(x=>x.dataset.step===e.dataset.step)===i).map(e=>e.dataset.step+":"+e.dataset.status).join(" ")')
const esc = async () => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) }
const res = {}
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: base }); await sleep(500)
  await ev('localStorage.clear()'); await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: base }); await sleep(4000)
  const R = { log: [] }
  const step = async (sid) => {
    if (mobile) {
      const open = await ev('document.querySelector("[data-testid=steps-topbar] button")?.getAttribute("aria-expanded")')
      if (open !== 'true') { await ev('document.querySelector("[data-testid=steps-topbar] button").click()'); await sleep(300) }
    }
    R.log.push(sid + ':' + await click(`[data-step=${sid}]`)); await sleep(900)
  }
  if (mobile) await ev('document.querySelector("[data-testid=steps-topbar] button").click()')
  R.initial = await statuses()
  await shot(`steps-${label}-0.png`)
  if (mobile) await ev('document.querySelector("[data-testid=steps-topbar] button").click()')
  await step('data'); R.confirm = await click('button[aria-pressed]', '確認した'); await sleep(300)
  await step('ledger'); await click('tbody tr[data-id]'); await sleep(1200)
  if (mobile) await esc()
  await step('plan'); R.cap = await ev('document.querySelector("#sat-b-cap")?.value')
  await ev('window.__dlname=[];HTMLAnchorElement.prototype.click=function(){window.__dlname.push(this.download)}')
  await step('csv'); await click('#sat-b-tabs button', '計画をCSVで書き出す'); await sleep(500)
  R.dl = await ev('JSON.stringify(window.__dlname)')
  await step('record'); await setInput('#sat-b-who', '盛土班'); await setSel('是正対象'); await click('button[type=submit]', '記録する'); await sleep(700)
  R.mid = await (async () => { if (mobile) { await ev('document.querySelector("[data-testid=steps-topbar] button").click()'); await sleep(300) } const s = await statuses(); if (mobile) await ev('document.querySelector("[data-testid=steps-topbar] button").click()'); return s })()
  await step('check'); await sleep(800)
  R.ledgerRow = await ev('[...document.querySelectorAll("tbody tr[data-id]")].filter(r=>!r.innerText.includes("未巡視")).map(r=>r.innerText.replace(/\\s+/g," ")).join(" | ")')
  if (mobile) { await ev('document.querySelector("[data-testid=steps-topbar] button").click()'); await sleep(300) }
  R.final = await statuses()
  await shot(`steps-${label}-final.png`)
  R.topbar = await ev('document.querySelector("[data-testid=steps-topbar]")?.innerText.slice(0,80)')
  R.allDoneText = await ev('document.body.innerText.includes("すべて完了")')
  R.overflow = await ev('document.documentElement.scrollWidth - window.innerWidth')
  R.errors = [...logs]; res[label] = R; logs.length = 0
}
console.log(JSON.stringify(res, null, 1))
ws.close(); chrome.kill()
