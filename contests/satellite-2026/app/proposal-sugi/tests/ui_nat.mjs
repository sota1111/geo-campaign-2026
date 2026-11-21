// 全国版（市町村・資金配分）の画面確認（ヘッドレスChrome + CDP）。node --test には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8823 --bind 127.0.0.1 &) ; node tests/ui_nat.mjs http://127.0.0.1:8823/ <出力ディレクトリ>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-'));
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
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  return { send, ev, logs, close: () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } } };
}
async function shot(c, name) { await sleep(900); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); }


const report = {};
for (const [label, w, h] of [['desktop', 1513, 784], ['mobile', 390, 844]]) {
  const c = await openChrome(); const r = { fail: [], info: {} };
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
    await c.send('Page.navigate', { url: base });
    for (let i = 0; i < 120; i++) { await sleep(250); if (await c.ev('document.body.dataset.mapReady === "1"')) break; }
    if (!(await c.ev('document.body.dataset.mapReady === "1"'))) r.fail.push('地図が初期化されない');
    await sleep(2500);
    r.info.map = await c.ev('(()=>{const m=document.getElementById("map").getBoundingClientRect();return {w:Math.round(m.width),h:Math.round(m.height),ratioW:+(m.width/innerWidth).toFixed(2),ratioH:+(m.height/innerHeight).toFixed(2)}})()');
    const want = w >= 900 ? r.info.map.ratioW : r.info.map.ratioH;
    if (want < 0.45 || want > 0.62) r.fail.push('地図の割合が想定外: ' + want);
    const sw = await c.ev('Math.max(document.documentElement.scrollWidth, document.getElementById("panel-body").scrollWidth)');
    if (sw > w) r.fail.push('横スクロール ' + sw);
    r.info.panel = await c.ev('(()=>{const p=document.getElementById("panel-body");return {scrollH:p.scrollHeight,clientH:p.clientHeight}})()');
    r.info.rows = await c.ev('document.querySelectorAll("#tbl tbody tr[data-j]").length');
    if (r.info.rows !== 8) r.fail.push('結果の表が8行でない: ' + r.info.rows);
    await shot(c, `${label}_1_default.png`);
    // 色の切り替え（凡例が変わる）
    const legends = {};
    for (const m of ['src', 'cur', 'sat', 'alloc']) {
      await c.ev(`(()=>{const e=document.querySelector('input[name=mode][value=${m}]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      await sleep(900);
      legends[m] = await c.ev('document.getElementById("legend").innerText.slice(0,30)');
      if (m !== 'alloc') await shot(c, `${label}_2_mode_${m}.png`);
    }
    r.info.legend = legends;
    if (new Set(Object.values(legends)).size !== 4) r.fail.push('色の切り替えで凡例が変わらない');
    // 配分ルールの切り替え
    const before = await c.ev('document.querySelector("#tbl tbody tr[data-j] td").innerText');
    await c.ev('(()=>{const e=document.querySelector("input[name=rule][value=cur]");e.checked=true;e.dispatchEvent(new Event("change",{bubbles:true}))})()');
    await sleep(900);
    const after = await c.ev('document.querySelector("#tbl tbody tr[data-j] td").innerText');
    r.info.firstRow = { A: before, D: after };
    await shot(c, `${label}_3_ruleD.png`);
    // 予算を変える（有効な列＝最後の列ではなく、強調列のセルを読む）
    const cell = 'document.querySelector("#tbl tbody tr[data-j] td.act").innerText';
    const b0 = await c.ev(cell);
    await c.ev('(()=>{const e=document.getElementById("budget");e.value=20000;e.dispatchEvent(new Event("input"))})()');
    await sleep(300);
    const b1 = await c.ev(cell);
    r.info.budget = { b0, b1 };
    if (b0 === b1) r.fail.push('予算を変えても金額が変わらない');
    // 都市を選び直す（プルダウン）と、半径を変える
    await c.ev('(()=>{const e=document.getElementById("city");const o=[...e.options].find(x=>x.textContent.includes("名古屋市"));e.value=o.value;e.dispatchEvent(new Event("change"))})()');
    await sleep(1500);
    r.info.city2 = await c.ev('window.SUGI_NAT.u.name[window.__nat.city]');
    r.info.cand50 = await c.ev('window.__nat.cand.length');
    await c.ev("document.querySelector('input[name=rad][value=\"100\"]').click()");
    await sleep(1500);
    r.info.cand100 = await c.ev('window.__nat.cand.length');
    if (!(r.info.cand100 >= r.info.cand50)) r.fail.push('半径を広げても候補が増えない');
    await shot(c, `${label}_4_nagoya100.png`);
    // 地図の実クリック: 市町村を画面の決まった位置に寄せてクリックすると都市として選ばれる
    const tgt = await c.ev('window.SUGI_NAT.u.name.indexOf("高崎市")');
    const tx = w >= 900 ? 400 : 195, ty = w >= 900 ? 380 : 120;
    await c.ev(`(()=>{const U=window.SUGI_NAT.u,m=window.__natMap,j=${tgt};m.jumpTo({center:[U.lon[j],U.lat[j]],zoom:9.5});const p=m.project([U.lon[j],U.lat[j]]);m.panBy([p.x-${tx},p.y-${ty}],{animate:false});})()`);
    await sleep(1500);
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
    await sleep(1800);
    const got = await c.ev('window.SUGI_NAT.u.name[window.__nat.city]');
    r.info.clicked = got;
    if (got !== '高崎市') r.fail.push('地図クリックで選べない: ' + got);
    await shot(c, `${label}_5_click.png`);
    await c.ev('document.getElementById("btn-about").click()');
    await sleep(300);
    await shot(c, `${label}_6_about.png`);
    r.info.errors = c.logs.slice(0, 5);
    if (c.logs.length) r.fail.push('コンソールエラー ' + c.logs.length);
  } catch (e) { r.fail.push('例外 ' + e.message); } finally { c.close(); }
  report[label] = r;
}
console.log(JSON.stringify(report, null, 1));
process.exit(Object.values(report).some((r) => r.fail.length) ? 1 : 0);
