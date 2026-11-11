// 操作確認（ヘッドレスChrome, CDP）。usage: node src/apps/biz-business/e2e.mjs <base_url> <out_dir>
// 独立ページ apps/biz-business/ で、サイドバーの手順を上から順に押し、各手順の操作を行って全手順が「済」になることを、デスクトップと390pxで確認する。
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
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch {} await sleep(200) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (m) => { const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || '')) }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails.exception?.description); return r.result.result.value }
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
async function shot(name) {
  const h = await ev('document.documentElement.scrollHeight')
  const w = await ev('window.innerWidth')
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: Math.min(h, 6000), scale: 1 } })
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'))
}
const click = (txt, sel = 'button') => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().includes(${JSON.stringify(txt)}));if(!b)return 'nf';b.click();return 'ok'})()`)
const alerts = `[...document.querySelectorAll('[role=alert],[role=status]')].map(a=>a.innerText.replace(/\\n/g,' ')).join(' || ').slice(0,900)`
const status = `[...document.querySelectorAll('button[data-step]')].map(b=>b.dataset.step+':'+b.dataset.status).filter((v,i,a)=>a.indexOf(v)===i).join(' ')`
const pick = (id) => ev(`(()=>{const bs=[...document.querySelectorAll('button[data-step="${id}"]')];if(!bs.length)return 'nf';(bs.find(b=>b.offsetParent)||bs[0]).click();return 'ok'})()`)
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}apps/biz-business/` }); await sleep(5000)
  await ev(`(()=>{window.__csv=[];const o=URL.createObjectURL;URL.createObjectURL=(b)=>{b.text().then(t=>window.__csv.push(t));return o(b)}})()`)
  if (mobile) { console.log(label, 'toggle', await click('完了')); await sleep(500) }
  console.log(label, 'overflow', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  console.log(label, 'initial', await ev(status))
  await shot(`${label}-1-initial.png`)
  const ops = [
    ['cond', () => click('この条件でよい（初期値')],
    ['planA', () => click('例のままこの案でよい')],
    ['planB', async () => {
      await ev(`document.querySelectorAll('[aria-label="案Bに止める路線を追加"]')[0].click()`); await sleep(400)
      await ev(`document.querySelectorAll('[role=option]')[0].click()`); await sleep(500)
      return click('を確認済み') && 'multi-route added'
    }],
    ['verdict', async () => { await sleep(1200); return 'viewed' }],
    ['export', () => click('会議資料用にCSVで書き出す')],
  ]
  for (const [id, op] of ops) {
    if (mobile) { await click('完了').catch(() => {}); await sleep(300) }
    console.log(label, 'step', id, 'pick', await pick(id)); await sleep(1000)
    console.log(label, '  op', await op()); await sleep(900)
    console.log(label, '  ->', await ev(status))
  }
  console.log(label, 'csv rows', (await ev('(window.__csv[0]||"").split("\\n").length')))
  await shot(`${label}-2-done.png`)
  console.log(label, 'overflow2', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  console.log(label, 'mapcanvas', await ev(`!!document.querySelector('canvas.maplibregl-canvas')`))
  console.log(label, 'errors', JSON.stringify(logs)); logs.length = 0
}
ws.close(); chrome.kill()
