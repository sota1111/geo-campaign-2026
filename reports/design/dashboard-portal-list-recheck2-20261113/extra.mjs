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
const key=async(key,code,v,shift=false)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:v,nativeVirtualKeyCode:v,text:key==='Enter'?'\r':undefined,modifiers:shift?8:0});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:v,modifiers:shift?8:0});await sleep(100)};
const focus=()=>J(`({id:document.activeElement?.dataset?.testid,text:document.activeElement?.textContent?.slice(0,70),inside:!!document.activeElement?.closest('[data-testid=detail-sheet]'),outline:getComputedStyle(document.activeElement).outline})`);
for(const [label,w,h,mobile] of [['1280',1280,765,false],['390',390,844,true]]){
 await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile});await load();
 await ev(`document.querySelector('[data-testid=row-ichibiz-2026]').focus({preventScroll:true})`);await key('Tab','Tab',9,true);await key('Tab','Tab',9);
 const rowFocus=await focus();await key('Enter','Enter',13);await sleep(650);const openFocus=await focus();if(!await ev("!!document.querySelector('[data-testid=detail-sheet]')"))throw Error('keyboard did not open');
 const f=[];for(let i=0;i<45;i++){await key('Tab','Tab',9);f.push(await focus())}
 await key('Escape','Escape',27);await sleep(600);const closeFocus=await focus();await save(label+'-08-keyboard.png');
 await clickSel(row('ichibiz-2026'));
 const r=await J(rect(row('udc-2026')));const hit=await ev(`document.elementFromPoint(${r.left+80},${r.top+20})?.getAttribute('data-slot')`);
 if(mobile){await clickSel('[data-testid=sheet-close]');await clickSel(row('ichibiz-2026'));}
 const pre=await state('udc-2026');await clickAt(r.left+80,r.top+20);
 const switchAttempt=await J(`({sheet:!!document.querySelector('[data-testid=detail-sheet]'),expanded:[...document.querySelectorAll('[data-testid^=row-][aria-expanded=true]')].map(e=>e.dataset.testid),focus:document.activeElement?.dataset?.testid})`);
 await clickSel(row('udc-2026'));const switched=await state('udc-2026');const overlay=await J(`({background:getComputedStyle(document.querySelector('[data-slot=sheet-overlay]')).backgroundColor,rowClass:document.querySelector('[data-testid=row-udc-2026]').className,sheet:${rect('[data-testid=detail-sheet]')},focus:document.activeElement?.dataset?.testid})`);
 await key('Escape','Escape',27);await sleep(500);
 out.push({label,rowFocus,openFocus,tabCount:f.length,escapedFocus:f.filter(x=>!x.inside),closeFocus,pre,hit,switchAttempt,switched,overlay});
}
// All actual app header return links, no app operations.
for(const app of ['sat-a','sat-b','sat-alpha','biz-business','biz-idea','biz-realestate','udc-moritsuchi','udc-aed','biz-business-nb','biz-idea-in1','biz-realestate-rn1','odpt','odpt-teiji']){
 await send('Page.navigate',{url:base+'apps/'+app+'/index.html'});await sleep(800);
 const links=await J(`[...document.querySelectorAll('a')].filter(e=>e.textContent.includes('統合ダッシュボード')).map(e=>({text:e.textContent,href:e.getAttribute('href')}))`);out.push({app,links});
}
fs.writeFileSync(path.join(outDir,'extra-measurements.json'),JSON.stringify({out,errs},null,2));ws.close();chrome.kill();try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
