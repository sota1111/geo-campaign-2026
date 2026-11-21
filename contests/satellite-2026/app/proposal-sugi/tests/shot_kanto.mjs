// 関東版の画面を指定の幅・高さで撮る補助（ヘッドレスChrome + CDP）。node --test には含めない。
// usage: node tests/shot_kanto.mjs <URL> <出力ディレクトリ> <幅> <高さ> '<[["実行するJS", 待ちms, "ファイル名.png"], ...]>'
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir, w0, h0, actions] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
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
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
const w = +w0, h = +h0;
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
await send('Page.navigate', { url: base });
for (let i = 0; i < 60; i++) { if (await ev('document.body.dataset.mapReady')) break; await sleep(500); }
for (const [js, wait, name] of JSON.parse(actions)) {
  const r = await ev(js); if (r && r.__error) console.log('ERR', r.__error);
  await sleep(wait || 800);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
  if (r !== undefined && r !== null && !r.__error) console.log(name, JSON.stringify(r).slice(0, 300));
}
console.log(logs.join('\n'));
ws.close(); chrome.kill();
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
