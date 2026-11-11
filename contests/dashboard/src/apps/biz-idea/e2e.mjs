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

const checked = () => ev(`[...document.querySelectorAll('[aria-label=達成状況] li')].map(li=>li.textContent.replace(/（(完了|未完了)）/,'')+(li.textContent.includes('（完了）')?':済':':未')).join(' / ')`)
const scrollY = () => ev('Math.round(window.scrollY)')
const activeTab = () => ev(`document.querySelector('[role=tab][data-state=active]').textContent`)
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  logs.length = 0
  await send('Page.navigate', { url: base + '#/apps/biz-idea' })
  await sleep(2000)
  await ev('localStorage.clear()')
  await send('Page.reload')
  await sleep(2500)
  await shot(`${label}-1-initial`)
  console.log(label, 'no horizontal overflow:', await ev('document.documentElement.scrollWidth<=window.innerWidth'))
  console.log(label, 'checklist:', await checked())
  // 地名を選ぶ: タブもスクロールも動かない
  const y0 = await scrollY()
  console.log(label, 'select place', await clickText('button', 'ぬま田'))
  await sleep(1200)
  console.log(label, 'tab:', await activeTab(), 'scroll moved by click-into-view only:', (await scrollY()) - y0)
  console.log(label, 'checklist:', await checked())
  await shot(`${label}-2-picked`)
  // 次にやること → 2-1
  console.log(label, await clickText('button', '近くの伝承碑と突き合わせる'))
  await sleep(800)
  let t = await body()
  console.log(label, '手がかりあり:', /手がかりあり/.test(t), '2-1/2-2 見出し:', /2-1 伝承碑と突き合わせる（/.test(t), /2-2 昔の地図・写真と重ねる（/.test(t))
  console.log(label, 'checklist:', await checked())
  await shot(`${label}-3-check`)
  // 次にやること → 2-2 おすすめ
  console.log(label, await clickText('button', '昔の地図・写真を重ねて見る'))
  await sleep(800)
  t = await body()
  console.log(label, 'おすすめ洪水:', /明治期の低湿地（洪水の話なら）/.test(t) && /治水地形分類図（洪水の話なら）/.test(t))
  console.log(label, 'rec btn', await clickText('button', '明治期の低湿地（洪水の話なら）'))
  await sleep(1800)
  console.log(label, 'checklist:', await checked())
  await shot(`${label}-4-overlay`)
  // 記録
  console.log(label, await clickText('button', '聞き取りを記録する →'))
  await sleep(800)
  console.log(label, await clickText('button', '記録して地図に残す'))
  await sleep(300)
  console.log(label, 'validation error shown:', /記録できません/.test(await body()))
  console.log(label, await clickText('button', 'サンプルの語り'))
  await sleep(300)
  console.log(label, 'initial visibility:', await ev('document.getElementById("f-vis").value'))
  console.log(label, await clickText('button[type=submit]', '記録して地図に残す'))
  await sleep(1000)
  t = await body()
  console.log(label, 'tab:', await activeTab(), 'saved msg:', /を保存しました/.test(t), '未確認:', /未確認/.test(t), '未定の案内:', /公開範囲は未定のまま/.test(t))
  console.log(label, 'tab badge:', await ev(`[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.includes('一覧')).textContent`))
  await shot(`${label}-5-saved`)
  // 確認ダイアログ
  console.log(label, await clickText('button', '確認済みにする…（確認役を兼ねる）'))
  await sleep(600)
  console.log(label, 'dialog ok disabled until vis chosen:', await ev(`[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='確認済みにする').disabled`))
  await shot(`${label}-6-dialog`)
  await ev(`(()=>{const s=document.getElementById('dlg-vis');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'public');s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await sleep(300)
  console.log(label, await ev(`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent==='確認済みにする');const d=b.disabled;b.click();return 'clicked, was disabled='+d})()`))
  await sleep(600)
  console.log(label, 'checklist:', await checked())
  // 一覧・書出タブ（見出しを直接押す）→ 書き出しても留まる
  await ev(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.includes('一覧'));e.focus();e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))})()`)
  await sleep(600)
  await ev(`document.getElementById('step-publish').scrollIntoView({block:'center'})`)
  await sleep(500)
  const yb = await scrollY()
  console.log(label, await clickText('button', '公開分を書き出し'))
  await sleep(700)
  t = await body()
  console.log(label, (t.match(/\d件を GeoJSON で書き出しました（[^）]*）/) || [])[0], 'tab:', await activeTab(), 'scroll delta:', (await scrollY()) - yb)
  console.log(label, 'result visible in viewport:', await ev(`(()=>{const e=[...document.querySelectorAll('[role=status]')].find(x=>x.textContent.includes('GeoJSON で書き出しました'));if(!e)return 'none';const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight})()`))
  console.log(label, 'checklist:', await checked())
  await shot(`${label}-7-exported`)
  console.log(label, await clickText('button', '非公開にする'))
  await sleep(300)
  console.log(label, 'private:', JSON.parse(await ev('localStorage.getItem("biz-idea:records")'))[0].visibility)
  console.log(label, 'console errors (tile fetch除く):', JSON.stringify(logs.filter((l) => !/cyberjapandata|ERR_|Failed to load resource/.test(l))), 'raw count', logs.length)
}
ws.close(); chrome.kill()
