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
// 地名の記憶マップ
await send('Page.navigate', { url: base + 'apps/biz-idea/' }); await sleep(3500); await step('place'); await click('button', 'ぬま田'); await step('overlay')
await shot('biz-entry')
await click('button', '左右に並べる'); await scroll('[data-testid=chimei-compare]'); await shot('biz-side-top')
await scroll('[data-testid$=-side] figure:last-child'); await shot('biz-side-second')
if (mobile) { await click('button', 'コントラスト補正'); await shot('biz-side-after') ; await click('button', 'コントラスト補正'); await fullshot('biz-side-full') }
await click('button', '境界を動かす')
await click('button', '上（右）の地図で原図を見る'); await shot('biz-orig-controls')
await click('button', '地図の原図を見る'); await sleep(2500); await shot('biz-to-map')
const ok = await click('[data-testid=map-return]', '写真の比較へ戻る', true); await sleep(800); await shot('biz-map-return')
// 操作欄の戻るボタンも
await click('button', '地図の原図を見る'); await sleep(1500); await click('div:not([id=biz-map]) > button:not([data-testid])', '写真の比較へ戻る'); await shot('biz-panel-return')
// キーボードで map-return
await click('button', '地図の原図を見る'); await sleep(1500); console.log('KBD', await ev(`(()=>{const b=document.querySelector('[data-testid=map-return]');if(!b)return 'none';b.focus();const s=getComputedStyle(b);return {focused:document.activeElement===b,outline:s.outlineStyle+' '+s.outlineWidth,boxShadow:s.boxShadow.slice(0,80)}})()`))
// 盛土ウォッチ
await send('Page.navigate', { url: base + 'apps/udc-moritsuchi/' }); await sleep(4000); await step('look'); await click('ul[aria-label="近い盛土造成地"] button', '熱海市0001'); await step('compare'); await sleep(2500)
await shot('udc-entry'); await click('button', '左右に並べる'); await sleep(1500); await scroll('[data-testid=site-compare]'); await shot('udc-side-top')
await scroll('[data-testid$=-side] figure:last-child'); await shot('udc-side-second')
console.log('ERRORS', logs); ws.close(); chrome.kill(); await sleep(500); fs.rmSync(prof, { recursive: true, force: true })
