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

const IDS = ['place', 'cross', 'overlay', 'record', 'confirm', 'export']
const statuses = () => ev(`[...document.querySelectorAll('aside [data-step]')].map(b=>b.dataset.step+':'+b.dataset.status).join(' ')`)
const activeTab = () => ev(`document.querySelector('[role=tab][data-state=active]').textContent`)
// サイドバー（スマホは上部ステッパーを開いて）の手順を押す
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
const URL0 = base + 'apps/biz-idea/'

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  logs.length = 0
  await send('Page.navigate', { url: URL0 })
  await sleep(2500)
  await ev('localStorage.clear()')
  await send('Page.reload')
  await sleep(2500)
  await shot(`${label}-1-initial`)
  console.log(label, 'overflow ok:', await ev('document.documentElement.scrollWidth<=window.innerWidth'), 'sidebar visible:', await ev(`(()=>{const a=document.querySelector('aside[aria-label=進め方]');return !!a&&a.offsetParent!==null})()`), 'topbar visible:', await ev(`(()=>{const a=document.querySelector('[data-testid=steps-topbar]');return !!a&&a.offsetParent!==null})()`))
  console.log(label, 'initial', await statuses())

  // 1 地名
  console.log(label, 'step place', await stepClick('place'), await activeTab())
  console.log(label, await clickText('button', 'ぬま田'))
  await sleep(1200)
  console.log(label, await statuses())
  // 2 突き合わせ
  console.log(label, 'step cross', await stepClick('cross'), await activeTab())
  let t = await body()
  console.log(label, '手がかりあり:', /手がかりあり/.test(t))
  console.log(label, await statuses())
  await shot(`${label}-2-cross`)
  // 3 重ねる
  console.log(label, 'step overlay', await stepClick('overlay'))
  console.log(label, await clickText('button', '明治期の低湿地（洪水の話なら）'))
  await sleep(1800)
  console.log(label, await statuses())
  await shot(`${label}-3-overlay`)
  // 4 記録
  console.log(label, 'step record', await stepClick('record'), await activeTab())
  console.log(label, await clickText('button', 'サンプルの語り'))
  await sleep(300)
  console.log(label, await clickText('button[type=submit]', '記録して地図に残す'))
  await sleep(1000)
  t = await body()
  console.log(label, '未確認:', /「未確認」の記録として保存しました/.test(t))
  console.log(label, await statuses())
  await shot(`${label}-4-saved`)
  // 5 確認して公開範囲
  console.log(label, 'step confirm', await stepClick('confirm'))
  console.log(label, 'dialog open:', await ev(`!!document.querySelector('[role=dialog]')`))
  await shot(`${label}-5-dialog`)
  await setSelect('dlg-vis', 'public')
  await sleep(300)
  console.log(label, await ev(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='確認済みにする');b.click();return 'ok'})()`))
  await sleep(700)
  console.log(label, await statuses())
  // 6 書き出し
  console.log(label, 'step export', await stepClick('export'), await activeTab())
  console.log(label, await clickText('button', '公開分を書き出し'))
  await sleep(700)
  t = await body()
  console.log(label, (t.match(/\d件を GeoJSON で書き出しました（[^）]*）/) || [])[0])
  console.log(label, 'FINAL', await statuses())
  console.log(label, 'progress text:', await ev(`document.body.innerText.match(/\\d+\\/\\d+ 完了|目的に必要な手順はすべて完了しました/g)?.join(' | ')`))
  await shot(`${label}-6-all-done`)
  console.log(label, 'console errors (tile fetch除く):', JSON.stringify(logs.filter((l) => !/cyberjapandata|ERR_|Failed to load resource/.test(l))), 'raw count', logs.length)
}
ws.close(); chrome.kill()
