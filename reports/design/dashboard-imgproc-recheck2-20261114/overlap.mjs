// 再審査2: R1（スマホ原図⇔比較の移動位置・戻るボタン）と L1（並列の上下配置）。usage: node recheck2.mjs <base> <outDir> <mobile|desktop> <profileParent>
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
const [base, outDir, label, profParent] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(profParent, 'chrome-profile-'))
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY
const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`]
if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost')
args.push('about:blank')
const chrome = spawn('google-chrome', args, { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch {} await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map(); const logs = []
ws.onmessage = (m) => { const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0])
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200)) }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value }
const MEASURE = `(()=>{const rc=e=>{if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]};
 let hb=0;for(const e of document.querySelectorAll('body *')){const s=getComputedStyle(e);if((s.position==='fixed'||s.position==='sticky')&&e.getBoundingClientRect().top<=1&&e.offsetHeight<400){hb=Math.max(hb,e.getBoundingClientRect().bottom)}}
 const byText=(t)=>rc([...document.querySelectorAll('button,p,div,span,figcaption')].filter(e=>e.children.length<3&&e.textContent.trim().startsWith(t)).pop());
 return {scrollY:Math.round(scrollY),sw:document.documentElement.scrollWidth,vw:innerWidth,headerBottom:Math.round(hb),
  map:rc(document.getElementById('biz-map')),mapReturn:rc(document.querySelector('[data-testid=map-return]')),compare:rc(document.querySelector('[data-testid=chimei-compare]')),
  pcSwipe:rc(document.querySelector('[data-testid$=-swipe]')),pcSide:rc(document.querySelector('[data-testid$=-side]')),figs:[...document.querySelectorAll('[data-testid$=-side] figure')].map(rc),
  correction:byText('コントラスト補正'),hill:byText('現在の陰影起伏'),eraBtn:byText('1945〜50年'),siteCompare:rc(document.querySelector('[data-testid=site-compare]')),
  ctrls:[...document.querySelectorAll('.maplibregl-ctrl')].map(rc)}})()`
const shot = async (name) => { console.log('STATE', label + '-' + name, JSON.stringify(await ev(MEASURE))); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, label + '-' + name + '.png'), Buffer.from(r.result.data, 'base64')) }
const fullshot = async (name) => { const h = await ev('document.documentElement.scrollHeight'); const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: label === 'mobile' ? 390 : 1280, height: Math.min(h, 4000), scale: 1 } }); fs.writeFileSync(path.join(outDir, label + '-' + name + '.png'), Buffer.from(r.result.data, 'base64')) }
const mouse = async (p) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p[0], y: p[1], button: 'left', clickCount: 1 }) }
const click = async (sel, text, noScroll = false) => { const p = await ev(`(()=>{let e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)})&&x.offsetParent!==null);if(!e)return null;${noScroll ? '' : "e.scrollIntoView({block:'center'});"}let r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`); if (!p) { console.log('NOTFOUND', text); return false } await sleep(300); await mouse(p); console.log('CLICK', text, p.map(Math.round)); await sleep(1200); return true }
const step = async (id) => { await ev(`(()=>{if(![...document.querySelectorAll('[data-step="${id}"]')].some(e=>e.offsetParent!==null))document.querySelector('[data-testid=steps-topbar] button[aria-expanded=false]')?.click()})()`); await sleep(300); await ev(`[...document.querySelectorAll('[data-step="${id}"]')].find(e=>e.offsetParent!==null)?.click()`); await sleep(1500) }
const scroll = async (sel) => { await ev(`document.querySelector(${JSON.stringify(sel)})?.scrollIntoView({block:'start'})`); await sleep(500) }
const mobile = label === 'mobile'
await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1280, height: mobile ? 844 : 765, deviceScaleFactor: 1, mobile })
// 原図表示中の背景切替と map-return の重なり、Tab フォーカス表示
await send('Page.navigate', { url: base + 'apps/biz-idea/' }); await sleep(3500); await step('place'); await click('button', 'ぬま田'); await step('overlay')
const probe = () => ev(`(()=>{const g=[...document.querySelectorAll('#biz-map [role=group], #biz-map [role=radiogroup]')].find(e=>e.textContent.includes('淡色'));const r=g?.getBoundingClientRect();const pts=g?[...g.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();const hit=document.elementFromPoint(q.x+q.width/2,q.y+q.height/2);return b.textContent+':'+(hit===b||b.contains(hit)?'reachable':'covered by '+(hit?.dataset?.testid||hit?.textContent?.slice(0,12)))}):null;return {sw:r&&[r.x,r.y,r.width,r.height].map(Math.round),pts}})()`)
await ev(`document.getElementById('biz-map').scrollIntoView({block:'center'})`); await sleep(500); console.log('BEFORE', JSON.stringify(await probe()))
await click('button', '上（右）の地図で原図を見る'); await click('button', '地図の原図を見る'); await sleep(2000)
console.log('ORIG', JSON.stringify(await probe())); await shot('orig-map-topleft')
// Tab で map-return へ
await ev(`document.querySelector('[data-testid=map-return]').previousElementSibling?.focus?.(); document.body.focus()`)
let found = false
for (let i = 0; i < 120 && !found; i++) { for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); found = await ev(`document.activeElement?.dataset?.testid==='map-return'`) }
console.log('TABFOUND', found, await ev(`(()=>{const b=document.activeElement;const s=getComputedStyle(b);return b.matches(':focus-visible')+' outline='+s.outlineStyle+' '+s.outlineWidth+' '+s.outlineColor+' shadow='+s.boxShadow})()`))
if (found) await shot('map-return-focus')
console.log('ERRORS', logs); ws.close(); chrome.kill(); await sleep(500); fs.rmSync(prof, { recursive: true, force: true })
