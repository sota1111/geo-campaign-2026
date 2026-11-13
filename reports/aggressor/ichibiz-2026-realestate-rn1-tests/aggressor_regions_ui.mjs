// アグレッサーの失敗テスト（ichibiz-2026 新案 RN1・3地域版の画面・印刷）。2026-11-14
// usage:
//   cd contests/ichibiz-2026/app/realestate-rn1/web && python3 -m http.server <ポート> --bind 127.0.0.1
//   node reports/aggressor/ichibiz-2026-realestate-rn1-tests/aggressor_regions_ui.mjs http://127.0.0.1:<ポート>/ <出力先>
// 要: google-chrome, node 22+。NG は弱点が残っていることを示す。
//   V1 地域を切り替えた直後（読み込み中）の「取得データの状況」が前の地域のまま残らない
//   V2 「データ無し」の重ね表示（東京の津波・大阪の土砂）のチェックボックスが、押せるのに何も出ない状態になっていない
//   V3 低速回線（約190KB/秒）で東京23区を選び、読み込み中に例の場所を押す → 自動でシートが出るまでの秒数（30秒以内）
//   V4 東京23区→大阪市→東京23区を素早く切り替えても、東京の大きいファイル（zoning.json 4.2MB）を2回読まない
//   V5 東京23区・大阪市の最長のシートが A4・1ページ、印刷の本文の文字が 8pt 以上
//   V6 幅320pxで東京23区のシートに横スクロールが出ない
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
if (!url || !outdir) { console.error('usage: node aggressor_regions_ui.mjs <url> <outdir>'); process.exit(2); }
fs.mkdirSync(outdir, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rn1aggr-'));
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
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
const waitReady = async (max = 120) => { for (let i = 0; i < max; i++) { await sleep(250); if (await ev('!!(window.App && App.ready)')) return true; } return false; };
async function open(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  await sleep(500); await waitReady(); await sleep(300);
}
const pick = (rid) => ev(`(() => { const r = document.querySelector('input[name=region][value=${rid}]'); r.click(); return true; })()`);

// V1・V2
await open(1280, 900, false);
await pick('tokyo23');
const st = await ev('document.getElementById("dataStatus").innerText');
check('V1 東京23区に切り替えた直後、状況一覧に徳島市の内容（用途地域なし・立地適正化計画「取得済み」）が残らない', !/XKT003[^\n]*取得済み/.test(st), `（直後の表示: ${st.split('\n').find((l) => l.includes('XKT003'))}）`);
await waitReady(); await sleep(300);
const ts = await ev('(() => { const c = document.getElementById("tgTsunami"); return { visible: !!c.offsetParent || c.closest("label").offsetParent !== null, disabled: c.disabled, hidden: c.closest("label").hidden }; })()');
check('V2 東京23区（津波はデータ無し）で「津波浸水想定」のチェックボックスが押せる状態のまま残らない', ts.disabled || ts.hidden, `（${JSON.stringify(ts)}）`);
await pick('osaka'); await waitReady(); await sleep(300);
const sd = await ev('(() => { const c = document.getElementById("tgSediment"); return { disabled: c.disabled, hidden: c.closest("label").hidden }; })()');
check('V2 大阪市（土砂はデータ無し）で「土砂災害警戒区域」のチェックボックスが押せる状態のまま残らない', sd.disabled || sd.hidden, `（${JSON.stringify(sd)}）`);

// V4 素早い切り替え
await open(1280, 900, false);
await ev('performance.clearResourceTimings(); true');
await pick('tokyo23'); await sleep(150); await pick('osaka'); await sleep(150); await pick('tokyo23');
await waitReady(); await sleep(1500);
const nz = await ev('performance.getEntriesByType("resource").filter((e) => e.name.includes("tokyo23/zoning.json")).length');
check('V4 東京23区→大阪市→東京23区を素早く切り替えても、東京の zoning.json（4.2MB）を2回以上読まない', nz <= 1, `（${nz}回）`);

// V3 低速回線
await send('Network.setCacheDisabled', { cacheDisabled: true });
await open(390, 844, true);
await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 190 * 1024, uploadThroughput: 64 * 1024 });
await pick('tokyo23'); await sleep(800);
const t0 = Date.now();
const msg = await ev('(() => { document.querySelector("button.ex").click(); return document.getElementById("status").textContent; })()');
let sec = null;
for (let i = 0; i < 240; i++) { await sleep(500); if (await ev('!!document.querySelector("#sheet .secs")')) { sec = (Date.now() - t0) / 1000; break; } }
check('V3 低速回線（約190KB/秒）で東京23区の読み込み中に例の場所を押すと、30秒以内に自動でシートが出る', sec != null && sec <= 30, `（${sec == null ? '120秒で出ず' : sec.toFixed(1) + '秒'}。押した直後の案内: ${msg.slice(0, 40)}…。進捗の表示はない）`);
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Network.setCacheDisabled', { cacheDisabled: false });

// V5 印刷
for (const [rid, lon, lat] of [['tokyo23', 139.75, 35.702], ['osaka', 135.472, 34.602]]) {
  await open(1280, 900, false);
  await pick(rid); await waitReady(); await sleep(300);
  await ev(`App.state.view = {lon:${lon}, lat:${lat}, z:15}; App.choose(${lon}, ${lat}); true`); await sleep(600);
  const chars = await ev('document.getElementById("sheet").innerText.length');
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const fz = await ev('(() => { const px = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize); return { li: px(".sec li"), fine: px(".sheet .fine"), tag: px(".tag") }; })()');
  const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(path.join(outdir, `longest-${rid}.pdf`), Buffer.from(pdf.result.data, 'base64'));
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  const pt = (v) => (v * 0.75).toFixed(1) + 'pt';
  check(`V5 ${rid} 最長のシート（${lon},${lat}・${chars}字）が A4・1ページ`, pages(pdf.result.data) === 1, `（${pages(pdf.result.data)}ページ）`);
  check(`V5 ${rid} 印刷の本文が8pt以上（注記・タグも7pt以上）`, fz.li * 0.75 >= 8 && fz.fine * 0.75 >= 7 && fz.tag * 0.75 >= 7, `（本文 ${pt(fz.li)}・注記 ${pt(fz.fine)}・タグ ${pt(fz.tag)}）`);
}

// V6 幅320px
await open(320, 640, true);
await pick('tokyo23'); await waitReady(); await sleep(300);
await ev('document.querySelector("button.ex").click(); true'); await sleep(800);
check('V6 幅320pxで東京23区のシートに横スクロールなし', await ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'), `（scrollWidth=${await ev('document.documentElement.scrollWidth')}）`);

ws.close(); chrome.kill();
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ }
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
