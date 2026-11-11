// 操作確認（ヘッドレスChrome, CDP）。usage: node src/apps/biz-business/e2e.mjs <base_url> <out_dir>
// 独立ページ apps/biz-business/ で、(A) デスクトップ1280x765のbodyスクロール高さ、全手順を表示、サイドバーを上から順に押して全必須手順が済／(B) 逆転する2案・複数路線・390px を確認する。
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
const scrollH = () => ev('[document.documentElement.scrollHeight, window.innerHeight, document.body.scrollHeight].join("/")')
const setSel = (plan, val) => ev(`(()=>{const s=document.querySelector('select[aria-label="案${plan}に止める路線を追加"]');if(!s)return 'noselect';const o=[...s.options].find(o=>o.value==='${val}');if(!o)return 'nooption';const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'${val}');s.dispatchEvent(new Event('change',{bubbles:true}));return 'set '+o.textContent.slice(0,24)})()`)
const open = async (mobile) => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  await send('Page.navigate', { url: `${base}apps/biz-business/` }); await sleep(5000)
  await ev(`(()=>{window.__csv=[];const o=URL.createObjectURL;URL.createObjectURL=(b)=>{b.text().then(t=>window.__csv.push(t));return o(b)}})()`)
}
const STEPS = ['cond', 'planA', 'planB', 'verdict', 'export']
for (const [label, w, h, mobile] of [['desktop', 1280, 765, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await open(mobile)
  console.log(label, 'initial', await ev(status))
  // (A) 全手順を表示してbodyスクロール高さを測る → 上から順に押す
  for (const id of STEPS) {
    if (mobile) { await click('完了'); await sleep(300) }
    const r = await pick(id); await sleep(900)
    if (id === 'cond') { console.log(label, 'cond opened only ->', await ev(status)); console.log(label, 'confirm cond', await ev(`(()=>{const b=document.querySelector('[data-testid=confirm-cond] button');if(!b)return 'nf';b.click();return 'ok'})()`)); await sleep(400) }
    if (id === 'verdict') { console.log(label, 'verdict opened only ->', await ev(status)); console.log(label, 'both legend', await ev(`[...document.querySelectorAll('[data-testid^=compare-]')].map(e=>e.innerText.replace(/\\n/g,' ')).join(' | ')`)); console.log(label, 'ack', await ev(`(()=>{const b=document.querySelector('[data-testid=verdict-ack]');if(!b)return 'nf';b.click();return 'ok'})()`)); await sleep(400) }
    if (id === 'planA' || id === 'planB') { console.log(label, 'confirm', id, await click('例の路線のままで確定')); await sleep(500) }
    if (id === 'export') {
      console.log(label, 'sustain', await ev(`(document.querySelector('[data-testid=sustain-note]')||{innerText:'none'}).innerText.slice(0,40)`))
      await ev(`window.__copied='';navigator.clipboard.writeText=(t)=>{window.__copied=t;return Promise.resolve()}`)
      console.log(label, 'copy', await click('文章だけをコピー')); await sleep(600)
      console.log(label, 'copied', await ev('window.__copied'))
      console.log(label, 'lastAction', await ev(`(document.querySelector('[role=status].border-l-4')||{innerText:''}).innerText`))
      console.log(label, 'csv', await click('CSVで書き出す')); await sleep(600)
    }
    console.log(label, id, r, 'scrollH/innerH/body', await scrollH(), '->', await ev(status))
    console.log(label, '  legend:', await ev(`(document.querySelector('[data-testid=map-legend]')||{innerText:''}).innerText.slice(0,30)`), '| details open:', await ev(`[...document.querySelectorAll('details')].map(d=>d.open).join(',')`))
    if (id === 'verdict' || id === 'export') {
      await ev(`document.querySelectorAll('details').forEach(d=>d.open=true)`); await sleep(500)
      console.log(label, '  nested vertical scrollers (details open):', await ev(`(()=>{const body=document.querySelector('[data-testid=step-panel-body]');const out=[];body.querySelectorAll('*').forEach(e=>{const cs=getComputedStyle(e);if((cs.overflowY==='auto'||cs.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+1)out.push(e.tagName+':'+e.scrollHeight+'/'+e.clientHeight)});return 'panel '+body.scrollHeight+'/'+body.clientHeight+' nested='+JSON.stringify(out)})()`))
    }
    await shot(`${label}-step-${id}.png`)
  }
  console.log(label, 'overflowX', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  console.log(label, 'mapcanvas', await ev(`!!document.querySelector('canvas.maplibregl-canvas')`))
  console.log(label, 'errors', JSON.stringify(logs)); logs.length = 0
  // (B) 逆転する2案（案A=和田島線 / 案B=橘線 + 路線追加）
  await open(mobile)
  if (mobile) { await click('完了'); await sleep(300) }
  await pick('planA'); await sleep(600)
  await ev(`document.querySelectorAll('[aria-label$="を外す"]').forEach(b=>b.click())`); await sleep(500)
  console.log(label, 'B A', await setSel('A', '59')); await sleep(500)
  if (mobile) { await click('完了'); await sleep(300) }
  await pick('planB'); await sleep(600)
  await ev(`document.querySelectorAll('[aria-label$="を外す"]').forEach(b=>b.click())`); await sleep(500)
  console.log(label, 'B B', await setSel('B', '37')); await sleep(500)
  console.log(label, 'B optgroup', await ev(`(()=>{const g=document.querySelector('select optgroup');return g?g.label.slice(0,40)+' n='+g.children.length:'none'})()`))
  console.log(label, 'B B result', await ev(`(document.querySelector('[data-testid=plan-result-1]')||{innerText:'none'}).innerText.replace(/\\n/g,' ')`))
  if (mobile) { await click('完了'); await sleep(300) }
  await pick('verdict'); await sleep(800)
  console.log(label, 'B verdict', await ev(`(document.querySelector('[data-testid=verdict-main]')||{innerText:'none'}).innerText.replace(/\\n/g,' ')`))
  console.log(label, 'B reversal', await ev(`(document.querySelector('[role=alert]')||{innerText:'none'}).innerText.replace(/\\n/g,' ')`))
  console.log(label, 'B scrollH', await scrollH())
  console.log(label, 'B headline', await ev(`document.querySelector('[data-testid=verdict-main] span').innerText`))
  console.log(label, 'B legend(default)', await ev(`document.querySelector('[data-testid=map-legend]').innerText.slice(0,12)`))
  console.log(label, 'B toggle->B', await ev(`(()=>{const b=[...document.querySelectorAll('[data-testid=map-plan-toggle] button')].find(x=>x.textContent.trim()==='案B');b.click();return 'ok'})()`)); await sleep(500)
  console.log(label, 'B legend(after toggle)', await ev(`document.querySelector('[data-testid=map-legend]').innerText.slice(0,12)`))
  await shot(`${label}-B-reversal.png`)
  if (mobile) { await click('完了'); await sleep(300) }
  await pick('export'); await sleep(600)
  await click('CSVで書き出す'); await sleep(700)
  const csv = await ev('window.__csv[0]||""')
  console.log(label, 'B csv', csv.split('\r\n').filter((l) => l.startsWith('注意（65歳以上）')).join('').slice(0, 120))
  console.log(label, 'B lastAction', await ev(`(document.querySelector('[role=status]')||{innerText:''}).innerText.slice(0,100)`))
  console.log(label, 'B errors', JSON.stringify(logs), 'overflowX', await ev('document.documentElement.scrollWidth - window.innerWidth')); logs.length = 0
}
ws.close(); chrome.kill()
