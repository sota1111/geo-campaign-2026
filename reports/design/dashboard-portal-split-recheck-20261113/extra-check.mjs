// ポータルの確認（2026-11-13: 詳細を「右から重ねるパネル」から「一覧の下の固定の詳細欄」に変更）。
// 1280×765 と 390×844 で、第一画面（4行・ページが画面に収まる）、各行の選択・切り替え・詳細欄の深部スクロール後の切り替えでの
// scrollY・行 top・scrollHeight の不変、詳細欄が見える範囲に出ること、ホイール、第3回ジャンプ、キーボード、ハッシュ復元、
// スマホの縮んだ一覧、横溢れ、評価レーダー・評価ダイアログ、アプリからの戻り、コンソールエラーを数値で出し、スクリーンショットを保存する。
// usage: node scripts/portal-check.mjs <base_url> <out_dir>   （要 preview 起動・google-chrome）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [base, outDir] = process.argv.slice(2)
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const port = 9351
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
  if (!['1280-01-first.png','390-01-first.png','1280-04-keyboard.png','390-04-keyboard.png','1280-m7-jump-ichibiz-2026.png','390-m7-jump-ichibiz-2026.png','1280-m8-ichibiz-six-table.png','390-m8-ichibiz-six-table.png','1280-m9-dialog-top.png','390-m9-dialog-top.png','390-m10-dialog-past.png','1280-07-back-from-app.png'].includes(name)) return
  const h = await ev('document.documentElement.scrollHeight')
  const params = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: Math.min(h, 6000), scale: 1 } } : { format: 'png' }
  fs.writeFileSync(path.join(outDir, name), Buffer.from((await send('Page.captureScreenshot', params)).result.data, 'base64'))
}
const J = async (e) => { const v = await ev(`JSON.stringify(${e})`); if (v === undefined) { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); console.error('EVAL FAIL', JSON.stringify(r.result?.exceptionDetails?.exception?.description ?? r).slice(0, 300), e.slice(0, 120)) } return JSON.parse(v) }
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
const clickScrolled = async (sel) => { await ev(`document.querySelector('${sel}').scrollIntoView({ block: 'center' })`); await sleep(150); await clickSel(sel) }
const row = (id) => `[data-testid=row-${id}]`
const pressed = (id) => ev(`document.querySelector('${row(id)}')?.getAttribute('aria-pressed') === 'true'`)
// 選ぶ（すでに選んでいる行は押さない。スマホでは同じ行をもう一度押すと一覧が戻るため）
const pick = async (id) => { if (!(await pressed(id))) await clickSel(row(id)) }
const snapAll = () => J(`({ scrollY: Math.round(scrollY), tops: ${JSON.stringify(ids)}.map((id) => Math.round(document.querySelector('[data-testid=row-' + id + ']').getBoundingClientRect().top)), docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth })`)
const paneInfo = (id, vh) => J(`(() => { const b = document.querySelector('[data-testid=detail-${id}]'); if (!b) return null; const r = b.getBoundingClientRect(); const p = document.querySelector('[data-testid=detail-pane]').getBoundingClientRect(); return { inner: Math.round(b.scrollTop), innerMax: b.scrollHeight - b.clientHeight, boxTop: Math.round(r.top), boxBottom: Math.round(r.bottom), paneTop: Math.round(p.top), paneH: Math.round(p.height), paneHalf: p.height >= ${vh} / 2, visible: r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 100, overlay: !!document.querySelector('[role=dialog]'), title: document.querySelector('[data-testid=detail-title]').textContent } })()`)
const wheel = async (mobile, dy) => { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mobile ? 200 : 640, y: 600, deltaX: 0, deltaY: dy }); await sleep(300) }
const keyPress = async (key, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); await sleep(250) }


const out=[];
for (const [label,width,height,mobile] of [['1280',1280,765,false],['390',390,844,true]]) {
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); await load();
 await clickSel('[data-testid=open-eval]');
 const focus=[];for(let i=0;i<12;i++){await keyPress('Tab','Tab',9);focus.push(await ev("!!document.activeElement.closest('[role=dialog]')"));}
 await keyPress('Escape','Escape',27);
 out.push({label,dialogTabs:focus,afterEscape:await ev("({dialog:!!document.querySelector('[role=dialog]'),focus:document.activeElement.dataset.testid,tag:document.activeElement.tagName})")});
 for(const app of ['sat-a','odpt']){
 await send('Page.navigate',{url:`${base}apps/${app}/index.html?from=satellite-2026`});await sleep(2000);
 const link=await ev(`document.querySelector('header a[href*="index.html"]').textContent`);
 await ev(`document.querySelector('header a[href*="index.html"]').click()`);await sleep(1800);
 out.push({label,app,link,snap:await snapAll(),selected:await ev("document.querySelector('[aria-pressed=true][data-testid^=row-]').dataset.testid")});
 if(label==='390'&&app==='sat-a')fs.writeFileSync(path.join(outDir,'390-back-from-app.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).result.data,'base64'));
 }
}
console.log(JSON.stringify({out,errs},null,2));ws.close();chrome.kill();
try{fs.rmSync(prof,{recursive:true,force:true,maxRetries:5,retryDelay:200})}catch{}
