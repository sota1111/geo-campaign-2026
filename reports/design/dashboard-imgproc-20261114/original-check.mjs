// 新旧写真比較（地名の記憶マップ／盛土ウォッチ）の画面確認とスクリーンショット（要 vite preview）。
// usage: node scripts/imgproc-shots.mjs http://127.0.0.1:8861/ screenshots
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(outDir, 'chrome-profile-'))
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
const shot = async (name) => { if (/biz-2|biz-5-channel|biz-6-orig|udc-3-hill|udc-5-other74/.test(name)) return; console.log('STATE', name, JSON.stringify(await ev(`({text:document.body.innerText, scrollY, vh:innerHeight, rects:[...document.querySelectorAll('[data-testid], [role=slider]')].map(e=>({test:e.getAttribute('data-testid')||e.getAttribute('role'),rect:(()=>{let r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()}))})`))); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')) }
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return 'NOTFOUND';e.scrollIntoView({block:'center'});e.click();return 'ok'})()`)
const body = () => ev('document.body.innerText')


const checks = []
const check = (name, ok, extra = '') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const stepClick = async (id) => ev(`(()=>{
  const vis=()=>[...document.querySelectorAll('[data-step="${id}"]')].find(b=>b.offsetParent!==null);
  let b=vis();
  if(!b){const t=document.querySelector('[data-testid=steps-topbar] button[aria-expanded]');if(t&&t.getAttribute('aria-expanded')==='false')t.click()}
  return new Promise(res=>setTimeout(()=>{b=vis();if(!b){res('NOTFOUND');return}b.click();res('ok')},250))})()`)
const key = async (k, shift = false) => {
  const code = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35 }[k]
  for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 })
}
const scrollPanel = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(e)e.scrollIntoView({block:'start'});return !!e})()`)
const noHScroll = () => ev('document.documentElement.scrollWidth<=window.innerWidth')
const sliderNow = () => ev(`+document.querySelector('[data-testid=photo-compare-swipe] [role=slider]').getAttribute('aria-valuenow')`)
const sleep2 = sleep


await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:base+'apps/biz-idea/'});await sleep(2000);await stepClick('place');await clickText('button','ぬま田');await stepClick('overlay');await sleep(800);
await clickText('button','旧河道の輪郭を重ねる');await sleep(300);await clickText('button','原図に戻す');await sleep(800);await shot('supp-original-mobile');
await ev('scrollTo(0,0)');await sleep(300);await shot('supp-original-map');
console.log('METRICS', await ev(`({scroll:scrollY,buttons:[...document.querySelectorAll('[data-testid=chimei-compare] button')].map(e=>({text:e.textContent,rect:[e.offsetWidth,e.offsetHeight]})),notes:[...document.querySelectorAll('[data-testid=chimei-compare] p')].map(e=>({text:e.textContent,color:getComputedStyle(e).color,size:getComputedStyle(e).fontSize}))})`));
chrome.kill();ws.close();await sleep(300);fs.rmSync(prof,{recursive:true,force:true});process.exit(0);
