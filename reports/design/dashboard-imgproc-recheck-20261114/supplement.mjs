// 新旧写真比較（地名の記憶マップ／盛土ウォッチ）の画面確認とスクリーンショット（要 vite preview）。
// usage: node scripts/imgproc-shots.mjs http://127.0.0.1:8861/ screenshots
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir, label] = process.argv.slice(2)
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

const shot=async(name)=>{console.log('STATE',label+'-'+name,JSON.stringify(await ev(`({text:document.body.innerText,scrollY,vh:innerHeight,sw:document.documentElement.scrollWidth,rects:[...document.querySelectorAll('[data-testid], [role=slider],canvas')].map(e=>({test:e.getAttribute('data-testid')||e.getAttribute('role')||'canvas',text:e.matches('[data-testid^=label]')?e.innerText:undefined,rect:(()=>{let r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()}))})`)));const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(outDir,label+'-'+name+'.png'),Buffer.from(r.result.data,'base64'))}
const click=async(sel,text)=>{const p=await ev(`(()=>{let e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)return null;e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);if(!p){console.log('NOTFOUND',text);return}await sleep(300);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:p[0],y:p[1],button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p[0],y:p[1],button:'left',clickCount:1});console.log('CLICK',text,p);await sleep(800)}
const step=async(id)=>{await ev(`(()=>{if(![...document.querySelectorAll('[data-step="${id}"]')].some(e=>e.offsetParent!==null))document.querySelector('[data-testid=steps-topbar] button[aria-expanded=false]')?.click()})()`);await sleep(300);await ev(`[...document.querySelectorAll('[data-step="${id}"]')].find(e=>e.offsetParent!==null)?.click()`);await sleep(1500)}
const scroll=async(sel)=>{await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'start'})`);await sleep(400)}
const key=async(k,shift=false)=>{for(const type of ['rawKeyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:{Home:36,End:35,ArrowRight:39,ArrowLeft:37}[k],modifiers:shift?8:0})}
const focus=()=>ev(`document.querySelector('[data-testid=photo-compare-swipe] [role=slider]').focus()`)

await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:base+'apps/biz-idea/'});await sleep(3500);await step('place');await click('button','ぬま田');await step('overlay');await click('button','上（右）の地図で原図を見る');await shot('orig-controls');await click('button','地図の原図を見る');console.log('AFTER_MAP',await ev(`JSON.stringify([...document.querySelectorAll('canvas,#biz-map')].map(e=>({tag:e.tagName,rect:e.getBoundingClientRect().toJSON()})))`));await ev('window.scrollTo(0,0)');await sleep(1500);await shot('map-manual-top');console.log('ERRORS',logs);ws.close();chrome.kill();await sleep(500);fs.rmSync(prof,{recursive:true,force:true});
