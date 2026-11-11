// ヘッドレスChromeで目標の成果を操作して確認する（要 vite preview）。
// usage: node src/apps/biz-idea/e2e.mjs http://127.0.0.1:8846/ src/apps/biz-idea/screenshots
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
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ }
  await sleep(200)
}
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
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')) }
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return 'NOTFOUND';e.scrollIntoView({block:'center'});e.click();return 'ok'})()`)
const body = () => ev('document.body.innerText')

const statuses = () => ev(`[...document.querySelectorAll('aside [data-step]')].map(b=>b.dataset.step+':'+b.dataset.status).join(' ')`)
const stepClick = async (id) => {
  const r = await ev(`(()=>{
    const vis=()=>[...document.querySelectorAll('[data-step="${id}"]')].find(b=>b.offsetParent!==null);
    let b=vis();
    if(!b){const t=document.querySelector('[data-testid=steps-topbar] button[aria-expanded]');if(t&&t.getAttribute('aria-expanded')==='false')t.click()}
    return new Promise(res=>setTimeout(()=>{b=vis();if(!b){res('NOTFOUND');return}b.click();res('ok')},200))})()`)
  await sleep(700)
  return r
}
const setSelect = (id, v) => ev(`(()=>{const s=document.getElementById('${id}');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'${v}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
const heights = () => ev(`JSON.stringify({docScrollH:document.documentElement.scrollHeight,bodyScrollH:document.body.scrollHeight,innerH:innerHeight,scrollY:Math.round(scrollY),over:document.documentElement.scrollHeight>innerHeight?[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.bottom>innerHeight+1&&r.height>0&&!e.closest('[data-testid=step-panel-body]')&&getComputedStyle(e).position!=='fixed'}).slice(0,6).map(e=>e.tagName+'.'+String(e.className).slice(0,50)+' b='+Math.round(e.getBoundingClientRect().bottom)):[],panelScrollable:(()=>{const p=document.querySelector('[data-testid=step-panel-body]');return p?p.scrollHeight+'/'+p.clientHeight:null})()})`)
const panelTitle = () => ev(`document.querySelector('[data-testid=step-layout] h2').textContent`)
const URL0 = base + 'apps/biz-idea/'

for (const [label, w, h, mobile] of [['desktop', 1280, 765, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  logs.length = 0
  await send('Page.navigate', { url: URL0 })
  await sleep(2500)
  await ev('localStorage.clear()')
  await send('Page.reload')
  await sleep(2500)
  await shot(`${label}-1-initial`)
  console.log(label, 'overflow-x ok:', await ev('document.documentElement.scrollWidth<=window.innerWidth'), 'tabs in page:', await ev(`document.querySelectorAll('[role=tab]').length`), 'initial', await statuses())
  console.log(label, 'H place', await panelTitle(), await heights())

  console.log(label, 'step place', await stepClick('place'), await clickText('button', 'ぬま田'))
  await sleep(1200)
  console.log(label, await statuses(), '| auto-switch? title:', await panelTitle(), await heights())
  await shot(`${label}-2-place`)

  console.log(label, 'step cross', await stepClick('cross'), await panelTitle())
  let t = await body()
  console.log(label, '手がかりあり:', /手がかりあり/.test(t), await statuses(), await heights())
  await shot(`${label}-3-cross`)

  console.log(label, 'step overlay', await stepClick('overlay'), await panelTitle(), '(押しただけ:', await statuses(), ')')
  console.log(label, await clickText('button', '明治期の低湿地（洪水の話なら）'))
  await sleep(1800)
  console.log(label, await statuses(), await heights())
  await shot(`${label}-4-overlay`)

  console.log(label, 'step record', await stepClick('record'), await panelTitle(), 'H record(just opened)', await heights(), 'save button in viewport:', await ev(`(()=>{const b=document.querySelector('button[type=submit]');const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`))
  console.log(label, await clickText('button', 'サンプルの語り'))
  await sleep(300)
  console.log(label, 'H record(before save)', await heights(), 'save button in viewport:', await ev(`(()=>{const b=document.querySelector('button[type=submit]');const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`))
  await shot(`${label}-5-record`)
  console.log(label, await clickText('button[type=submit]', '記録して地図に残す'))
  await sleep(1000)
  t = await body()
  console.log(label, '未確認:', /「未確認」の記録として保存しました/.test(t), '地名保持:', await ev(`document.getElementById('f-name').value`), await statuses())

  console.log(label, 'step confirm', await stepClick('confirm'), await panelTitle(), await heights())
  console.log(label, await clickText('button', '確認済みにする…（確認役を兼ねる）'))
  await sleep(600)
  await shot(`${label}-6-confirm-dialog`)
  await setSelect('dlg-vis', 'public')
  await sleep(300)
  console.log(label, await ev(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='確認済みにする');b.click();return 'ok'})()`))
  await sleep(700)
  console.log(label, await statuses())
  await shot(`${label}-7-confirm`)

  console.log(label, 'step export', await stepClick('export'), await panelTitle())
  console.log(label, await clickText('button', '公開分を書き出し'))
  await sleep(700)
  t = await body()
  console.log(label, (t.match(/\d件を GeoJSON で書き出しました（[^）]*）/) || [])[0])
  console.log(label, 'FINAL', await statuses(), 'H export', await heights())
  console.log(label, 'progress text:', await ev(`document.body.innerText.match(/\\d+\\/\\d+ 完了|目的に必要な手順はすべて完了しました/g)?.join(' | ')`))
  await shot(`${label}-8-all-done`)
  console.log(label, 'console errors (tile fetch除く):', JSON.stringify(logs.filter((l) => !/cyberjapandata|ERR_|Failed to load resource/.test(l))), 'raw count', logs.length)
}
ws.close(); chrome.kill()
