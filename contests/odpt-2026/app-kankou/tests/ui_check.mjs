// 画面の点検（ヘッドレスChrome）。unittest には含めない（Chrome とネットワークが必要）。
// usage: (cd web && python3 -m http.server 8791) & node tests/ui_check.mjs http://127.0.0.1:8791/ <out_dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-'));
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'];
  const chrome = spawn('google-chrome', args, { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, close };
}
async function viewport(c, w, h) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
}
async function load(c) {
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await c.ev('!!(window.KankouApp && KankouApp.STATE.data && KankouApp.getMap() && KankouApp.getMap().loaded() && document.querySelector("#result-body .card"))')) break;
  }
  await sleep(1500);
}
async function shot(c, name) {
  const s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
}

const out = {};
for (const [name, w, h] of [['desktop', 1366, 800], ['mobile', 390, 844]]) {
  const c = await openChrome();
  await viewport(c, w, h);
  await load(c);
  const r = {};
  r.scrollW = await c.ev('document.documentElement.scrollWidth');
  r.cards = await c.ev('document.querySelectorAll("#result-body .card").length');
  r.diff = await c.ev('document.querySelector("#result-body .diff")?.innerText');
  r.layers = await c.ev('KankouApp.getMap().getStyle().layers.map(l=>l.id).join(",")');
  r.lineFeatures = await c.ev('KankouApp.getMap().getSource("lines")._data.features.length');
  r.zoom = await c.ev('KankouApp.getMap().getZoom()');
  r.sweepRects = await c.ev('document.querySelectorAll("#sweep svg rect").length');
  r.tableRows = await c.ev('document.querySelectorAll("#table-table tbody tr").length');
  r.smallTargets = await c.ev(`[...document.querySelectorAll('#panel button, #panel select, #panel input')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<40}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height)).slice(0,10)`);
  await shot(c, name + '_top.png');
  for (const sec of ['result', 'sweep-sec', 'route-sec']) {
    await c.ev(`document.getElementById("${sec}").scrollIntoView()`);
    await sleep(600);
    await shot(c, `${name}_${sec}.png`);
  }
  r.logs = c.logs.slice(0, 10);
  c.close();
  out[name] = r;
}
{
  // 操作の点検: 休日・駅への切替、検索、地図で指す、CSV
  const c = await openChrome();
  await viewport(c, 1366, 800);
  await load(c);
  const r = {};
  await c.ev('document.querySelector("#dt button[data-v=hol]").click()'); await sleep(500);
  r.hol = await c.ev('document.querySelector("#result-body .diff, #result-body .msg")?.innerText.slice(0,80)');
  await c.ev('document.querySelector("#d-kind button[data-v=鉄道駅]").click()'); await sleep(300);
  r.stationList = await c.ev('[...document.querySelectorAll("#d-list .res")].slice(0,3).map(e=>e.innerText.replace(/\\n/g," ")).join(" | ")');
  await c.ev('(()=>{const q=document.getElementById("d-q");q.value="上野";q.dispatchEvent(new Event("input"))})()'); await sleep(300);
  r.ueno = await c.ev('[...document.querySelectorAll("#d-list .res")].slice(0,3).map(e=>e.innerText.replace(/\\n/g," ")).join(" | ")');
  await c.ev('document.querySelector("#d-list .res").click()'); await sleep(900);
  r.afterPick = await c.ev('document.getElementById("d-now").innerText + " / " + (document.querySelector("#result-body .diff, #result-body .msg")?.innerText.slice(0,90))');
  await c.ev('(()=>{const q=document.getElementById("o-q");q.value="浅草";q.dispatchEvent(new Event("input"))})()'); await sleep(300);
  r.oList = await c.ev('[...document.querySelectorAll("#o-list .res")].slice(0,3).map(e=>e.innerText.replace(/\\n/g," ")).join(" | ")');
  await c.ev('document.querySelector("#o-list .res").click()'); await sleep(900);
  r.afterO = await c.ev('document.getElementById("o-now").innerText');
  await c.ev('document.getElementById("o-map").click()'); await sleep(200);
  r.pickbar = await c.ev('document.getElementById("pickbar").hidden + ":" + document.getElementById("pickbar").innerText');
  await c.ev('(()=>{const m=KankouApp.getMap();const p=m.project([139.80,35.70]);m.fire("click",{point:p,lngLat:{lat:35.70,lng:139.80}})})()'); await sleep(900);
  r.afterMapPick = await c.ev('document.getElementById("o-now").innerText + " pickbar hidden=" + document.getElementById("pickbar").hidden');
  await c.ev('(()=>{const s=document.getElementById("share");s.value=30;s.dispatchEvent(new Event("input"))})()'); await sleep(600);
  r.share30 = await c.ev('document.getElementById("share-v").innerText + " rows=" + document.querySelectorAll("#routes-table tbody tr").length');
  r.csvHref = await c.ev('(()=>{let t="";const o=URL.createObjectURL;URL.createObjectURL=function(b){t=b.size;return o.call(URL,b)};document.getElementById("csv-table").click();return String(t)})()');
  r.logs = c.logs.slice(0, 10);
  await shot(c, 'interaction.png');
  c.close();
  out.interaction = r;
}
console.log(JSON.stringify(out, null, 1));
