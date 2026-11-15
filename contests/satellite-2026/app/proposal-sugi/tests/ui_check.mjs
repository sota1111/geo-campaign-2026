// 画面の通し確認（ヘッドレスChrome + CDP）。node --test には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8823 --bind 127.0.0.1 &) ; node tests/ui_check.mjs http://127.0.0.1:8823/ <out_dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
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
    for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('document.body.dataset.mapReady === "1"')) break; }
    if (!(await c.ev('document.body.dataset.mapReady === "1"'))) r.fail.push('地図が初期化されない');
    await sleep(1200);
    await shot(c, `${label}_1_grasp.png`);
    const noScroll = async (tag) => { const sw = await c.ev('Math.max(document.documentElement.scrollWidth, document.getElementById("panel-body").scrollWidth)'); if (sw > w) r.fail.push('横スクロール(' + tag + ') ' + sw); };
    await noScroll('1');
    // 地図の実クリック（区画の中心を、パネルに隠れない位置へ動かしてクリック）
    const tx = w >= 720 ? 900 : 195, ty = w >= 720 ? 400 : 200;
    const t = await c.ev(`(()=>{const S=window.__sugi,m=window.__sugiMap;const rr=S.res.ranked[3];m.jumpTo({center:[rr.lon,rr.lat],zoom:13});const p=m.project([rr.lon,rr.lat]);m.panBy([p.x-${tx},p.y-${ty}],{animate:false});return rr.code})()`);
    await sleep(800);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
    await sleep(500);
    r.info.map_click = { want: t, got: await c.ev('window.__sugi.sel'), step: await c.ev('window.__sugi.step') };
    if (r.info.map_click.got !== t || r.info.map_click.step !== 3) r.fail.push('地図クリックで根拠画面に移らない');
    await shot(c, `${label}_3_evidence_from_map.png`);
    // 2: 順位
    await c.ev('document.getElementById("tab-2").click()');
    r.info.rows_step2 = await c.ev('document.querySelectorAll("#rank tbody tr").length');
    if (r.info.rows_step2 !== 20) r.fail.push('順位表の行数 ' + r.info.rows_step2);
    r.info.top_wind = await c.ev('[...document.querySelectorAll("#rank tbody tr td:nth-child(2)")].slice(0,5).map(e=>e.innerText).join(",")');
    await c.ev('(()=>{const e=document.getElementById("p-wind");e.checked=false;e.dispatchEvent(new Event("change"))})()');
    r.info.top_nowind = await c.ev('[...document.querySelectorAll("#rank tbody tr td:nth-child(2)")].slice(0,5).map(e=>e.innerText).join(",")');
    if (r.info.top_wind === r.info.top_nowind) r.fail.push('風向の有無で順位が変わらない');
    await c.ev('(()=>{const e=document.getElementById("p-wind");e.checked=true;e.dispatchEvent(new Event("change"))})()');
    await c.ev('document.getElementById("more").click()');
    r.info.rows_more = await c.ev('document.querySelectorAll("#rank tbody tr").length');
    await noScroll('2');
    await shot(c, `${label}_2_rank.png`);
    // 3: 表の行 → 根拠 → 候補
    await c.ev('document.querySelector("#rank tbody tr").click()');
    if (!(await c.ev('document.getElementById("s3").innerText.includes("1 位")'))) r.fail.push('根拠画面に順位が出ない');
    await sleep(900);
    await noScroll('3');
    await shot(c, `${label}_3_evidence.png`);
    await c.ev('document.getElementById("b-cand").click()');
    r.info.cand1 = await c.ev('window.__sugi.cand.size');
    if (r.info.cand1 !== 1) r.fail.push('候補に入らない');
    // 4: 出力
    await c.ev('document.getElementById("tab-4").click()');
    await c.ev('document.getElementById("topn").value=5');
    await c.ev('document.getElementById("b-top").click()');
    r.info.cand_after_top = await c.ev('window.__sugi.cand.size');
    if (!(r.info.cand_after_top >= 5)) r.fail.push('上位から候補に入らない');
    r.info.csv = await c.ev('(()=>{const S=window.__sugi;const rows=S.res.rows.filter(x=>S.cand.has(x.code)).sort((a,b)=>(a.rank||1e9)-(b.rank||1e9));return window.SugiLib.toCsv(rows,S.params,window.SUGI.meta).split("\\r\\n").slice(0,3)})()');
    r.info.csv_button_enabled = await c.ev('!document.getElementById("b-csv").disabled');
    await noScroll('4');
    await shot(c, `${label}_4_output.png`);
    await c.ev('document.getElementById("btn-about").click()');
    r.info.modal_overflow = await c.ev('(()=>{const b=document.querySelector(".modal-box");return b.scrollWidth-b.clientWidth})()');
    await shot(c, `${label}_5_about.png`);
    r.info.small_targets = await c.ev(`[...document.querySelectorAll('#panel button, #panel input, #panel select')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<32&&e.id!=="sheet-toggle"}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height))`);
  } catch (e) { r.fail.push('例外: ' + e.message); }
  r.logs = c.logs.filter((l) => !/cyberjapandata|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|Failed to load resource/.test(l));
  if (r.logs.length) r.fail.push('コンソールエラー ' + r.logs.length + ' 件');
  c.close(); report[label] = r;
}
console.log(JSON.stringify(report, null, 1));
