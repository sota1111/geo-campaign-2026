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

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  logs.length = 0
  await send('Page.navigate', { url: base + '#/apps/biz-idea' })
  await sleep(2000)
  await ev('localStorage.clear()')
  await send('Page.reload')
  await sleep(2500)
  await shot(`${label}-1-initial`)
  console.log(label, 'no horizontal overflow:', await ev('document.documentElement.scrollWidth<=window.innerWidth'), await ev('document.documentElement.scrollWidth'))
  console.log(label, 'select place', await clickText('button', 'ぬま田'))
  await sleep(1500)
  let t = await body()
  console.log(label, '手がかりあり:', /手がかりあり/.test(t), '架空表示:', /（架空）/.test(t))
  await shot(`${label}-2-check`)
  console.log(label, 'overlay', await clickText('button[role=radio]', '空中写真 1945'))
  await sleep(2500)
  t = await body()
  console.log(label, (t.match(/表示される縮尺[^。]*。/) || [])[0])
  await shot(`${label}-3-overlay`)
  console.log(label, 'basemap photo', await clickText('button', '写真'))
  await sleep(1500)
  await clickText('button', '標準')
  await sleep(800)
  console.log(label, 'tab rec', await ev(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.includes('3 記録'));e.focus();e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));return 'ok'})()`))
  await sleep(500)
  console.log(label, await clickText('button', '記録して地図に残す'))
  await sleep(300)
  t = await body()
  console.log(label, 'validation error shown:', /記録できません/.test(t))
  await shot(`${label}-4-rec-error`)
  console.log(label, await clickText('button', 'サンプルの語り'))
  await sleep(300)
  console.log(label, await clickText('button[type=submit]', '記録して地図に残す'))
  await sleep(1000)
  t = await body()
  console.log(label, '未確認:', /未確認/.test(t), /「ぬま田（架空）」を「未確認」/.test(t))
  await shot(`${label}-5-list`)
  console.log(label, await clickText('button', '公開分を書き出し'))
  await sleep(300)
  t = await body()
  console.log(label, (t.match(/公開分がありません[^。]*。/) || [])[0])
  console.log(label, await clickText('button', '確認済みにする'))
  await sleep(300)
  console.log(label, await clickText('button', '公開分を書き出し'))
  await sleep(500)
  t = await body()
  console.log(label, (t.match(/\d件を書き出しました/) || [])[0], '公開分に含む:', /公開分に含む/.test(t))
  await shot(`${label}-6-export`)
  console.log(label, await clickText('button', '非公開にする'))
  await sleep(300)
  t = await body()
  console.log(label, 'private:', /地図に出ません/.test(t), JSON.parse(await ev('localStorage.getItem("biz-idea:records")'))[0].visibility)
  console.log(label, 'console errors (tile fetch除く):', JSON.stringify(logs.filter((l) => !/cyberjapandata|ERR_|Failed to load resource/.test(l))), 'raw count', logs.length)
}
ws.close(); chrome.kill()
