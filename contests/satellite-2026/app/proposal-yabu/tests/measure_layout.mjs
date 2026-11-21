// usage: node tests/measure_layout.mjs <out_dir> [base_url]   （要: google-chrome、静的サーバー起動済み）
// 1513x784（デスクトップ）と 390x844（スマホ）で、地図が画面に占める割合を測り、最初の画面のスクリーンショットを残す。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = process.argv[2];
const base = process.argv[3] || 'http://127.0.0.1:8877/';
fs.mkdirSync(out, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 200);
const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${fs.mkdtempSync('/tmp/yabu-m-')}`, 'about:blank'], { stdio: 'ignore' });
let t; for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (t.length) break; } catch { /* retry */ } await sleep(200); }
const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const p = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
for (const [n, w, h, mob] of [['desktop', 1513, 784, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
  await send('Page.navigate', { url: base }); await sleep(4000);
  const r = (await send('Runtime.evaluate', { expression: `(()=>{const r=document.querySelector('#map').getBoundingClientRect();const vis=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));return JSON.stringify({mapW:Math.round(r.width),mapH:Math.round(r.height),top:Math.round(r.top),viewW:innerWidth,viewH:innerHeight,widthFrac:+(r.width/innerWidth).toFixed(2),heightFrac:+(r.height/innerHeight).toFixed(2),visibleHeightFrac:+(vis/innerHeight).toFixed(2),visibleAreaFrac:+((vis*r.width)/(innerHeight*innerWidth)).toFixed(2)})})()`, returnByValue: true })).result.result.value;
  console.log(n, r);
  const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${out}/first_${n}.png`, Buffer.from(s.result.data, 'base64'));
}
ch.kill(); process.exit(0);
