// 画面操作の確認スクリプト（ヘッドレスChrome）。使い方:
//   npx vite preview --port 8841 --host 127.0.0.1 &
//   node src/apps/odpt/verify.mjs http://127.0.0.1:8841/ src/apps/odpt/screenshots
// 「富山市大町」を検索 → 平日朝30分病院の結論 → 休日との違い → 最終便 → コピー → 各タブ、をデスクトップと390pxで確認する。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const base = process.argv[2] ?? 'http://127.0.0.1:8841/'
const out = process.argv[3] ?? 'src/apps/odpt/screenshots'
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'drv-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 300))
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return 'EVALERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description)
  return r.result?.result?.value
}
await send('Emulation.setFocusEmulationEnabled', { enabled: true })
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable')
await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: new URL(base).origin }).catch(() => {})
const shot = async (name) => {
  const m = await send('Page.getLayoutMetrics')
  const h = Math.min(Math.ceil(m.result.cssContentSize.height), 6000)
  const w = m.result.cssContentSize.width
  const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } })
  fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(s.result.data, 'base64'))
}
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim().includes(${JSON.stringify(text)}));if(!e)return 'notfound';e.click();return 'ok'})()`)
const concl = () => ev(`document.querySelector('[data-testid=conclusion]')?.innerText`)

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile })
  await send('Page.navigate', { url: 'about:blank' }); await sleep(300)
  logs.length = 0
  await send('Page.navigate', { url: base + '#/apps/odpt' })
  await sleep(4000)
  await shot(`${label}-1-initial`)
  console.log(`== ${label}`)
  console.log('example-button-present:', await ev(`document.body.innerText.includes('で試す')`))
  console.log('search', await ev(`(()=>{const i=document.getElementById('odpt-q');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'富山市大町');i.dispatchEvent(new Event('input',{bubbles:true}));i.form.requestSubmit();return 'sent'})()`))
  await sleep(4500)
  console.log('msg:', await ev(`document.querySelector('[data-testid=search-msg]').innerText`))
  console.log('CONCLUSION(平日・朝・30分・病院):\n' + await concl())
  console.log('hash:', await ev('location.hash'))
  await shot(`${label}-2-weekday`)
  console.log('click 休日', await clickText('button[role=radio]', '休日（日曜ダイヤ）'))
  await sleep(1500)
  console.log('休日 conclusion:\n' + (await concl()).split('\n').slice(0, 14).join('\n'))
  console.log('click 平日', await clickText('button[role=radio]', '平日'))
  await sleep(800)
  await ev(`document.querySelector('[data-testid=copy-conclusion]').scrollIntoView({block:'center'})`)
  await sleep(300)
  const rc = await ev(`(()=>{const r=document.querySelector('[data-testid=copy-conclusion]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rc[0], y: rc[1], button: 'left', clickCount: 1 })
  console.log('copy (real mouse click)', rc)
  await sleep(1000)
  console.log('toast:', await ev(`[...document.querySelectorAll('[data-sonner-toast]')].map(e=>e.innerText).join(' / ')`))
  console.log('copy button now:', await ev(`document.querySelector('[data-testid=copy-conclusion]').innerText`))
  console.log('clipboard:', await ev(`navigator.clipboard.readText().catch(e=>'ERR '+e.message)`))
  console.log('preview:\n' + await ev(`document.getElementById('odpt-copy-preview').value`))
  for (const t of ['地域全体', '路線を止めたら？', '5地域比較', '出典・前提']) {
    console.log('tab', t, await ev(`(()=>{const e=[...document.querySelectorAll('[role=tab]')].find(x=>x.textContent.includes(${JSON.stringify(t)}));e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));e.click();return 'ok'})()`))
    await sleep(t === '5地域比較' ? 3000 : 800)
    if (t === '路線を止めたら？') {
      console.log('whatif top btn', await ev(`(()=>{const p=document.querySelector('[role=tabpanel][data-state=active]');const b=[...p.querySelectorAll('button[aria-pressed]')][0];if(!b)return 'none';b.click();return b.textContent})()`))
      await sleep(1500)
    }
    console.log((await ev(`document.querySelector('[role=tabpanel][data-state=active]')?.innerText`)).slice(0, 600).replace(/\n+/g, ' | '))
    await shot(`${label}-3-tab-${t.slice(0, 3)}`)
  }
  console.log('overflowX:', await ev('document.documentElement.scrollWidth - window.innerWidth'))
  console.log('console errors:', JSON.stringify(logs))
}
ws.close(); chrome.kill()
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* ignore */ }
