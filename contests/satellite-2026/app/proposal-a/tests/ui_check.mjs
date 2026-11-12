// 画面の通し確認（ヘッドレスChrome + CDP）。unittest には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8822 --bind 127.0.0.1 &) ; node tests/ui_check.mjs http://127.0.0.1:8822/ <out_dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  return { send, ev, logs, close: () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } } };
}
async function shot(c, name) { await sleep(700); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); }

const report = {};
for (const [label, w, h] of [['desktop', 1366, 800], ['mobile', 390, 844]]) {
  const c = await openChrome(); const r = { fail: [], info: {} };
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
    await c.send('Page.navigate', { url: base });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('window.__ready === true')) break; }
    if (!(await c.ev('window.__ready === true'))) r.fail.push('地図が初期化されない');
    await sleep(500);
    await shot(c, `${label}_1_score.png`);
    r.info.scrollW = await c.ev('document.documentElement.scrollWidth');
    if (r.info.scrollW > w) r.fail.push('横スクロール発生 ' + r.info.scrollW);
    r.info.top_before = await c.ev('[...document.querySelectorAll("#s1 tbody tr td:first-child")].map(e=>e.innerText).join(",")');
    await c.ev('(()=>{const e=document.getElementById("w");e.value=100;e.dispatchEvent(new Event("input"))})()');
    r.info.top_sat_only = await c.ev('[...document.querySelectorAll("#s1 tbody tr td:first-child")].map(e=>e.innerText).join(",")');
    await c.ev('(()=>{const e=document.getElementById("w");e.value=50;e.dispatchEvent(new Event("input"))})()');
    await c.ev('document.getElementById("to2").click()');
    await c.ev('document.getElementById("auto").click()');
    r.info.selected = await c.ev('App.STATE.selected.size');
    if (!(r.info.selected > 0)) r.fail.push('自動選定が空');
    // 手動: 選択解除→再選択（地図クリックの経路は toggleSeg 経由）
    const first = await c.ev('[...App.STATE.selected][0]');
    await c.ev(`App.toggleSeg("${first}")`);
    r.info.after_toggle = await c.ev('App.STATE.selected.size');
    await c.ev(`App.toggleSeg("${first}")`);
    // 予算超過で次へが無効になる
    await c.ev('(()=>{const e=document.getElementById("bud");e.value=1;e.dispatchEvent(new Event("input"))})()');
    r.info.to3_disabled_when_over = await c.ev('document.getElementById("to3").disabled');
    if (!r.info.to3_disabled_when_over) r.fail.push('予算超過でも「次へ」が有効');
    await c.ev('(()=>{const e=document.getElementById("bud");e.value=3;e.dispatchEvent(new Event("input"));e.dispatchEvent(new Event("change"))})()');
    await shot(c, `${label}_2_select.png`);
    // 地図上の実クリック（座標から）で選択が切り替わるか
    const pt = await c.ev(`(()=>{const s=App.STATE.segs.find(x=>x.cls==="life"&&!x.surveyed&&!App.STATE.selected.has(x.id));const m=App.getMap();const p=m.project([(s.coords[0][0]+s.coords[1][0])/2,(s.coords[0][1]+s.coords[1][1])/2]);const rc=m.getCanvas().getBoundingClientRect();return {x:p.x+rc.left,y:p.y+rc.top,id:s.id,inView:p.x>0&&p.y>0&&p.x<rc.width&&p.y<rc.height}})()`);
    r.info.click_target = pt;
    r.info.sel_before_click = await c.ev('App.STATE.selected.size');
    if (pt.inView) {
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await sleep(400);
      r.info.sel_after_click = await c.ev('App.STATE.selected.size');
    }
    await c.ev('document.getElementById("auto").click()');
    await c.ev('document.getElementById("to3").click()');
    await shot(c, `${label}_3a_before_scan.png`);
    await c.ev('document.getElementById("scan").click()');
    await sleep(400);
    r.info.s3_text = (await c.ev('document.getElementById("s3").innerText')).slice(0, 400);
    r.info.result_features = await c.ev('App.getMap().getSource("res")._data.features.length');
    await shot(c, `${label}_3b_result.png`);
    await c.ev('document.getElementById("apply").click()');
    r.info.round = await c.ev('document.getElementById("round").innerText');
    r.info.w_after = await c.ev('App.STATE.w');
    r.info.top_after = await c.ev('[...document.querySelectorAll("#s1 tbody tr td:first-child")].map(e=>e.innerText).join(",")');
    await shot(c, `${label}_4_round2.png`);
    await c.ev('document.getElementById("btn-about").click()');
    r.info.modal_overflow = await c.ev('(()=>{const b=document.querySelector(".modal-box");return b.scrollWidth-b.clientWidth})()');
    await shot(c, `${label}_5_about.png`);
    r.info.small_targets = await c.ev(`[...document.querySelectorAll('#panel button, #panel input')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<32&&e.id!=="sheet-toggle"}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height))`);
  } catch (e) { r.fail.push('例外: ' + e.message); }
  r.logs = c.logs; if (c.logs.length) r.fail.push('コンソールエラー ' + c.logs.length + ' 件');
  c.close(); report[label] = r;
}
console.log(JSON.stringify(report, null, 1));
