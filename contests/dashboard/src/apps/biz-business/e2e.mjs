// 操作確認（ヘッドレスChrome, CDP）。usage: node src/apps/biz-business/e2e.mjs <base_url> <out_dir>
// 独立ページ apps/biz-business/ で、(A) 例のまま、サイドバーの手順を上から順に押すだけ／(B) 路線を足す・逆転する案を作る、の2通りを、デスクトップと390pxで確認する。
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
const setSel = (plan, val) => ev(`(()=>{const s=document.querySelector('select[aria-label="案${plan}に止める路線を追加"]');const o=[...s.options].find(o=>o.value==='${val}');if(!o)return 'nooption';const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'${val}');s.dispatchEvent(new Event('change',{bubbles:true}));return 'set '+o.textContent.slice(0,30)})()`)
const open = async (mobile) => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}apps/biz-business/` }); await sleep(5000)
  await ev(`(()=>{window.__csv=[];const o=URL.createObjectURL;URL.createObjectURL=(b)=>{b.text().then(t=>window.__csv.push(t));return o(b)}})()`)
  if (mobile) { await click('完了'); await sleep(500) }
}
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  // (A) 例のまま、サイドバーを上から順に押すだけ
  await open(mobile)
  console.log(label, 'A initial', await ev(status), 'overflow', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  for (const id of ['cond', 'planA', 'planB', 'verdict', 'export']) {
    if (mobile) { await click('完了'); await sleep(300) }
    const r = await pick(id); await sleep(1300)
    if (id === 'export') { console.log(label, 'A csv', await click('会議資料用にCSVで書き出す')); await sleep(800) }
    console.log(label, 'A', id, r, '->', await ev(status))
  }
  await shot(`${label}-A-done.png`)
  // (B) 逆転する2案（案A=和田島線 / 案B=橘線）を、絞り込みと標準selectで作る
  await open(mobile)
  await ev(`document.querySelectorAll('[aria-label$="を外す"]').forEach(b=>b.click())`); await sleep(600)
  console.log(label, 'B select A', await setSel('A', '59')); await sleep(500)
  console.log(label, 'B select B', await setSel('B', '37')); await sleep(800)
  console.log(label, 'B filter', await ev(`(()=>{const i=document.querySelector('input[aria-label="案Cの路線を絞り込み"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'鳴門');i.dispatchEvent(new Event('input',{bubbles:true}));return 'typed'})()`)); await sleep(500)
  console.log(label, 'B filtered options', await ev(`[...document.querySelector('select[aria-label="案Cに止める路線を追加"]').options].map(o=>o.textContent.slice(0,14)).slice(0,4).join(' | ')+' n='+document.querySelector('select[aria-label="案Cに止める路線を追加"]').options.length`))
  console.log(label, 'B reversal', await ev(`(document.querySelector('[role=alert]')||{innerText:'none'}).innerText.replace(/\\n/g,' ')`))
  console.log(label, 'B csv', await click('会議資料用にCSVで書き出す')); await sleep(800)
  const csv = await ev('window.__csv[0]||""')
  console.log(label, 'B csv row', csv.split('\r\n').filter((l) => l.startsWith('注意（65歳以上）') || l.startsWith('影響が小さい案')).join(' // ').slice(0, 300))
  console.log(label, 'B sentences has note', await ev(`document.body.innerText.includes('65歳以上では')`))
  await shot(`${label}-B-reversal.png`)
  console.log(label, 'overflow2', await ev('document.documentElement.scrollWidth - window.innerWidth'), 'errors', JSON.stringify(logs)); logs.length = 0
}
ws.close(); chrome.kill()
