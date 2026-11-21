// 配置・物件10件・勤務先2件の確認（手動。ヘッドレスChromeで実際に操作し、地図の割合・縦スクロール・スクリーンショットを調べる）
// usage: node tests/layout_check.mjs <url> <outdir>   要: google-chrome, node 22+。住所検索（国土地理院）にネット接続が必要
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rn1lay-'));
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
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => fs.writeFileSync(path.join(outdir, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
await send('Runtime.enable');
const out = {};
const MEASURE = `(() => { const m = document.getElementById('map').getBoundingClientRect(), W = innerWidth, H = innerHeight, de = document.documentElement;
  return JSON.stringify({ W, H, mapW: Math.round(m.width), mapH: Math.round(m.height), widthRatio: +(m.width / W).toFixed(3), areaRatio: +(m.width * m.height / (W * H)).toFixed(3), heightRatio: +(m.height / H).toFixed(3), pageScrollH: de.scrollHeight, bodyScrollH: document.body.scrollHeight, hScroll: de.scrollWidth > W }); })()`;
for (const [w, h] of [[1513, 784], [1280, 800], [1920, 1080], [390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  await send('Page.navigate', { url });
  await sleep(2500);
  await ev("localStorage.clear()");
  out[w + 'x' + h] = JSON.parse(await ev(MEASURE));
  await shot(`blank-${w}x${h}.png`);
}
// 物件10件・勤務先2件を入れる（徳島市の住所。住所検索は実際に国土地理院へ問い合わせる）
await send('Emulation.setDeviceMetricsOverride', { width: 1513, height: 784, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url }); await sleep(2500);
await ev(`document.getElementById('t-props').click()`);
const addrs = ['徳島県徳島市幸町2丁目', '徳島県徳島市南昭和町1丁目', '徳島県徳島市国府町府中', '徳島県徳島市八万町大野', '徳島県徳島市沖浜東3丁目', '徳島県徳島市富田橋', '徳島県徳島市新浜町', '徳島県徳島市佐古三番町', '徳島県徳島市末広2丁目', '徳島県徳島市応神町古川', '徳島県徳島市中央通'];
const log = [];
for (const a of addrs) {
  await ev(`(async () => { const q = document.getElementById('propQ'); q.value = ${JSON.stringify(a)}; document.getElementById('propForm').requestSubmit(); })()`);
  await sleep(1800);
  // 候補が複数なら先頭を選ぶ
  await ev(`(() => { const b = document.querySelector('#tab-props .cands button'); if (b) b.click(); })()`);
  await sleep(300);
  log.push(await ev(`document.getElementById('propMsg').textContent + ' / ' + App.state.places.props.length`));
}
out.addLog = log;
for (const [i, a] of ['徳島県庁', '徳島駅'].entries()) {
  await ev(`(async () => { const q = document.getElementById('wq${i}'); q.value = ${JSON.stringify(a)}; q.form.requestSubmit(); })()`);
  await sleep(1800);
  await ev(`(() => { const b = document.querySelector('#tab-props .cands button'); if (b) b.click(); })()`);
  await sleep(500);
}
out.props = await ev('App.state.places.props.length'); out.works = await ev('App.state.places.works.filter(Boolean).length');
out.propAddDisabled = await ev(`document.getElementById('propAdd').disabled`);
out.stored = await ev(`!!localStorage.getItem('rn1.places.v1')`);
await ev(`document.querySelectorAll('#propList details').forEach((d) => (d.open = false)); document.getElementById('t-props').click()`);
await shot('props-1513x784.png');
await ev(`document.querySelector('#tab-props').scrollTop = 600`); await sleep(200);
await shot('props-scrolled-1513x784.png');
await ev(`document.querySelector('.mk.prop').click()`); await sleep(400);
await shot('popup-1513x784.png');
out.after = JSON.parse(await ev(MEASURE));
await ev(`document.getElementById('t-place').click(); document.querySelectorAll('#lifeToggles input').forEach((c) => { if (!c.checked && !c.disabled) c.click(); })`); await sleep(1200);
await shot('life-all-1513x784.png');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url }); await sleep(2500);
out.mobile = JSON.parse(await ev(MEASURE));
await shot('props-390x844.png');
console.log(JSON.stringify(out, null, 1));
console.log('logs', logs);
ws.close(); chrome.kill();
