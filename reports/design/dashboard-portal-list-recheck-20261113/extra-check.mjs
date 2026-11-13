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
const prof = fs.mkdtempSync(path.join(outDir, '.chrome-'))
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
  if (name.includes('-03-sheet') && !name.includes('ichibiz')) return;
  if (name === '390-04-odpt-sheet.png') return;
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
for (const [width,height,mobile] of [[1280,765,false],[390,844,true]]) {
await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); await load();
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9}); await ev(`document.querySelector('[data-testid=row-udc-2026]').focus()`);
const focus=await ev(`getComputedStyle(document.activeElement).outlineStyle + ' ' + getComputedStyle(document.activeElement).outlineWidth`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'}); await sleep(400);
const opened=await state('udc-2026');
await ev(`document.querySelectorAll('[data-testid=detail-udc-2026] details').forEach(e=>e.open=true)`);
const text=await ev(`document.querySelector('[data-testid=detail-udc-2026]').innerText`);
const folds=await ev(`JSON.stringify([...document.querySelectorAll('[data-testid=detail-udc-2026] details')].map(e=>({summary:e.querySelector('summary')?.innerText,open:e.open})))`);
if(mobile){await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await sleep(400)} else {await send('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32}); await sleep(400)}
const closed=await state('udc-2026');
await ev(`[...document.querySelectorAll('button')].find(e=>e.innerText.includes('AI評価')).click()`); await sleep(400);
const evalInfo=await ev(`JSON.stringify({dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.innerText.slice(0,500)),scrollY,sw:document.documentElement.scrollWidth})`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27}); await sleep(300);
await send('Page.navigate',{url:base+'apps/sat-a/index.html'}); await sleep(2000); await ev(`document.querySelector('header a[href*="index.html"]').click()`); await sleep(1600);
out.push({width,focus,opened,closed,text,folds:JSON.parse(folds),evalInfo:JSON.parse(evalInfo),back:{url:await ev('location.href'),openRows:await ev(`document.querySelectorAll('[aria-expanded=true][data-testid^=row-]').length`),scrollY:await ev('scrollY')}});
}
console.log(JSON.stringify({out,errs},null,2)); ws.close();chrome.kill();try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
