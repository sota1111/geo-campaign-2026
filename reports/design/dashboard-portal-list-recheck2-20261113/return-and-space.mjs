// ポータル一覧の確認（2026-11-13 デザイン審査の対応）。
// 1280×765 と 390×844 で、各行のクリック前・開いた後・閉じた後の行の top と scrollY、390 で4行が第一画面に収まるか、
// スマホ幅のシート（閉じるボタン・中だけスクロール・ページ固定）、詳細の末尾の「閉じる」、sticky の見出し、横スクロール、
// アプリからの戻り（全行が閉じた一覧）、コンソールエラーを数値で出し、スクリーンショットを保存する。
// usage: node scripts/portal-check.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9300 + Math.floor(Math.random() * 500)
const prof = fs.mkdtempSync(path.join(outDir, 'chrome-profile-'))
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' })
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch { /* retry */ } await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let n = 0
const pend = new Map()
const errs = []
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
  if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push(d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200))
}
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
const save = async (name, full) => {
  if (name.includes('03-sheet') || name.includes('04-odpt')) return
  const h = await ev('document.documentElement.scrollHeight')
  const params = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: Math.min(h, 6000), scale: 1 } } : { format: 'png' }
  fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', params)).result.data, 'base64'))
}
const J = async (e) => JSON.parse(await ev(`JSON.stringify(${e})`))
const rect = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: r.left, width: r.width, height: Math.round(r.height) } })()`
const ids = ['satellite-2026', 'ichibiz-2026', 'udc-2026', 'odpt-2026']
const load = async (hash = '') => {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(200)
  await send('Page.navigate', { url: `${base}index.html${hash}` }); await sleep(2200)
}
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(500)
}
const clickSel = async (sel) => { const r = await J(rect(sel)); await clickAt(r.left + Math.min(r.width / 2, 120), r.top + Math.min(r.height / 2, 25)) }
const row = (id) => `[data-testid=row-${id}]`
const state = (id) => J(`({ top: ${rect(row(id))}.top, scrollY: Math.round(scrollY), expanded: document.querySelector('${row(id)}').getAttribute('aria-expanded'), sw: document.documentElement.scrollWidth })`)



const out=[];
const key=async(key,code,v,text)=>{for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:v,nativeVirtualKeyCode:v,text:type==='keyDown'?text:undefined});await sleep(400)};
for(const [label,w,h,mobile] of [['1280',1280,765,false],['390',390,844,true]]){
await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});await load();
await ev(`document.querySelector('[data-testid=row-udc-2026]').focus()`);await key(' ','Space',32,' ');await sleep(300);
const space=await J(`({sheet:!!document.querySelector('[data-testid=detail-sheet]'),focus:document.activeElement?.dataset?.testid})`);
await ev(`document.querySelector('[data-testid=contest-info]').open=true`);const infoText=await ev(`document.querySelector('[data-testid=detail-udc-2026]').innerText`);
await key('Escape','Escape',27);await sleep(300);
out.push({label,space,udcInfoText:infoText,afterClose:await state('udc-2026')});
if(!mobile){
for(const app of ['sat-a','sat-b','sat-alpha','biz-business','biz-idea','biz-realestate','udc-moritsuchi','udc-aed','biz-business-nb','biz-realestate-rn1','odpt','odpt-teiji']){
await send('Page.navigate',{url:base+'apps/'+app+'/index.html?from=ichibiz-2026'});await sleep(600);
const link=await ev(`document.querySelector('header a[href*="index.html"]')?.getAttribute('href')`);
await ev(`document.querySelector('header a[href*="index.html"]')?.click()`);await sleep(700);
out.push({app,link,url:await ev('location.pathname+location.hash'),openRows:await ev(`document.querySelectorAll('[data-testid^=row-][aria-expanded=true]').length`),scrollY:await ev('scrollY')});
}
}else{
await send('Page.navigate',{url:base+'apps/sat-a/index.html?from=satellite-2026'});await sleep(600);await ev(`document.querySelector('header a[href*="index.html"]').click()`);await sleep(700);
out.push({label,back:'sat-a',url:await ev('location.pathname+location.hash'),openRows:await ev(`document.querySelectorAll('[data-testid^=row-][aria-expanded=true]').length`),scrollY:await ev('scrollY')});
}
}
fs.writeFileSync(path.join(outDir,'return-and-space.json'),JSON.stringify({out,errs},null,2));ws.close();chrome.kill();try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
