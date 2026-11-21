// UI確認（手動）。ヘッドレスChromeで画面を開き、例の場所を押して、カード数・横スクロール・コンソールエラーを調べ、スクリーンショットを撮る。
// usage: node tests/ui_check.mjs <url> <outdir>   例: url=http://127.0.0.1:8830/web/index.html?data=../tests/fixtures/sample.json
// 要: google-chrome, node 22+。地図タイルの取得にネット接続が必要（無くても確認自体は進む）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'a4shot-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, full = true) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  fs.writeFileSync(path.join(outdir, name), Buffer.from(r.data ?? r.result.data, 'base64'));
};
await send('Runtime.enable'); await send('Page.enable');
const report = {};
for (const [name, w, h] of [['1280', 1280, 900], ['390', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url });
  await sleep(1500);
  await ev("document.querySelector('#exButtons button').click()");
  await sleep(1500);
  report[name] = await ev(`JSON.stringify({
    cards: document.querySelectorAll('.card').length,
    scrollY: window.scrollY,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    status: document.getElementById('status').textContent,
    summary: document.getElementById('summary').textContent,
    prov: !document.getElementById('provisional').hidden,
    mapVisible: (() => { const r = document.getElementById('map').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })(),
    rows: document.querySelectorAll('.card')[0]?.querySelectorAll('.pr').length })`);
  await shot(`shot-${name}-view.png`, false);   // 地点を選んだ直後の第一画面（自動スクロールしないこと）
  await ev("window.scrollTo(0,0)");
  await shot(`shot-${name}.png`);
  // 住所検索: 案内と印が第一画面にあるか
  await send('Page.navigate', { url });
  await sleep(1200);
  await ev("(() => { const q = document.getElementById('q'); q.value = '久留米市役所'; document.getElementById('search').requestSubmit(); })()");
  await sleep(2500);
  report[name + '-search'] = await ev("document.getElementById('status').textContent");
  await shot(`shot-${name}-search.png`, false);
  await ev("document.getElementById('map').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
  await sleep(500);
  await shot(`shot-${name}-focus.png`, false);
}
console.log(JSON.stringify(report, null, 1));
console.log('console errors:', logs.length ? logs : 'なし');
ws.close(); chrome.kill();
