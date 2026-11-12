// アグレッサーの失敗テスト（ichibiz-2026 新案 RN1: 画面・印刷）。2026-11-13
// usage:
//   cd contests/ichibiz-2026/app/realestate-rn1/web && python3 -m http.server 8827 --bind 127.0.0.1
//   node contests/ichibiz-2026/app/realestate-rn1/tests/aggressor_ui.mjs http://127.0.0.1:8827/ <出力先>
// 要: google-chrome, node 22+。アグレッサー作成。工兵が tests/ へ移した。
// 工兵の ui_check.mjs は「徳島駅・国府町」の2地点だけを印刷検査する。ここでは、
//   U1 最も長いシートになる地点（lib の出力の文字数が最大。北緯34.105・東経134.550 付近）の印刷ページ数
//   U2 幅320px（小さいスマホ）で横スクロールが出ないか、シートの表が切れないか
//   U3 地図を最大ズーム（z17）で洪水の重ね表示を出した時の描画時間
//   U4 データ読み込み前に地図をクリックした時の案内
// を見る。FAIL は弱点が残っていることを示す。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
if (!url || !outdir) { console.error('usage: node aggressor_ui.mjs <url> <outdir>'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rn1agg-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const results = {};
const check = (name, ok, extra = '') => { results[name] = ok; console.log((ok ? 'OK  ' : 'NG  ') + name + (extra ? ' ' + extra : '')); };
const pages = (b64) => (Buffer.from(b64, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(outdir, name), Buffer.from(r.result.data, 'base64')); };
await send('Runtime.enable'); await send('Page.enable');

async function open(w, h, mobile, waitReady = true) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  if (!waitReady) return;
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!(window.App && App.ready)')) break; }
  await sleep(800);
}

// U1 最長のシート
await open(1280, 900, false);
const LONG = [134.55, 34.105];
await ev(`App.state.view = {lon:${LONG[0]}, lat:${LONG[1]}, z:15}; App.choose(${LONG[0]}, ${LONG[1]}); true`);
await sleep(800);
const chars = await ev('document.getElementById("sheet").innerText.length');
await send('Emulation.setEmulatedMedia', { media: 'print' });
const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true });
fs.writeFileSync(path.join(outdir, 'longest-sheet.pdf'), Buffer.from(pdf.result.data, 'base64'));
check('U1 最長のシート（' + LONG.join(',') + '）がA4・1ページ', pages(pdf.result.data) === 1, `（${pages(pdf.result.data)}ページ・シート${chars}字）`);
await send('Emulation.setEmulatedMedia', { media: 'screen' });

// U2 幅320px
await open(320, 640, true);
await ev('document.querySelector("button.ex").click(); true');
await sleep(1000);
check('U2 幅320pxで横スクロールなし', await ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), `（scrollWidth=${await ev('document.documentElement.scrollWidth')}）`);
check('U2 幅320pxでシートの要素が画面幅をはみ出さない', await ev('[...document.querySelectorAll("#sheet *")].every((e) => e.getBoundingClientRect().right <= document.documentElement.clientWidth + 1)'));
await shot('w320-sheet.png');

// U3 z17 で洪水の重ね表示
await open(1280, 900, false);
await ev('const c = document.getElementById("tgFlood"); c.checked = true; c.dispatchEvent(new Event("change")); true');
const ms = await ev('(() => { App.state.view = {lon:134.5513, lat:34.0745, z:17}; const t = performance.now(); for (let i = 0; i < 10; i++) App.render(); return (performance.now() - t) / 10; })()');
check('U3 z17・洪水の重ね表示で1回の描画が100ms未満（ドラッグ中に毎回描き直すため）', ms < 100, `（平均${Math.round(ms)}ms）`);

// U4 読み込み前のクリック
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: 200 * 1024, uploadThroughput: 200 * 1024 });
await open(390, 844, true, false);
await sleep(1500);
const early = await ev('(() => { if (!window.App) return "no App"; const r = document.getElementById("map").getBoundingClientRect(); document.querySelector("button.ex").click(); return document.getElementById("status").textContent; })()');
check('U4 低速回線（約200KB/秒。3.3MBの同梱データ）で、読み込み前に例の場所を押すと待つよう案内する', typeof early === 'string' && /読み込み中/.test(early), `（${early}）`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

ws.close(); chrome.kill();
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ }
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
