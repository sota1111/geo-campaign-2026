// UI確認（手動。ヘッドレスChromeで実際にクリックし、シート・印刷（A4で何ページか）・横スクロール・コンソールエラー・「未取得」表示を調べ、スクリーンショットを撮る）
// usage: node tests/ui_check.mjs <url> <outdir>   要: google-chrome, node 22+。地理院タイルの取得にネット接続が必要（無くても画面の確認自体は進む）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rn1shot-'));
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
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, full) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!full });
  fs.writeFileSync(path.join(outdir, name), Buffer.from(r.result.data, 'base64'));
};
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
const results = {};
const check = (name, ok, extra = '') => { results[name] = ok; console.log((ok ? 'OK  ' : 'NG  ') + name + (extra ? ' ' + extra : '')); };
const pages = (b64) => (Buffer.from(b64, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function open(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!(window.App && App.ready)')) break; }
  await sleep(1200);
}
async function run(tag, w, h, mobile) {
  await open(w, h, mobile);
  await shot(`${tag}-1-top.png`);
  check(`${tag}: 横スクロールなし`, await ev('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'));
  check(`${tag}: データ9項目が取得済み表示`, (await ev('document.querySelectorAll("#dataStatus .st-ok").length')) === 9);
  check(`${tag}: クレジット・出典・加工・責任・推計の表示（フッター）`, await ev('["attribution","processed","credit","resp","popnote"].every((i) => document.getElementById(i).textContent.length > 20)'));
  // 例の場所 → 実クリック（地図中央）
  await ev('document.querySelector("button.ex").click(); true');
  await sleep(1500);
  await shot(`${tag}-2-station.png`);
  check(`${tag}: 徳島駅の例で5節が出る`, (await ev('document.querySelectorAll("#sheet .sec").length')) === 5);
  check(`${tag}: 居住誘導区域の中と表示`, await ev('document.getElementById("sheet").innerText.includes("居住誘導区域の中にある")'));
  await ev('document.getElementById("map").scrollIntoView({block:"center"}); App.state.view = {lon:134.4845, lat:34.0540, z:15}; App.render(); true');
  await sleep(800);
  const rect = await ev('(() => { const r = document.getElementById("map").getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()');
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await sleep(800);
  check(`${tag}: 地図の実クリックで国府町付近のシートが出る（居住誘導区域の外）`, await ev('document.getElementById("sheet").innerText.includes("居住誘導区域（居住促進区域）の外")'));
  await ev('for (const id of ["tgFlood","tgSediment"]) { const c = document.getElementById(id); c.checked = true; c.dispatchEvent(new Event("change")); } true');
  await ev('App.state.view = {lon:134.5513, lat:34.0745, z:14}; App.choose(134.5513, 34.0745); document.getElementById("map").scrollIntoView({block:"center"}); true');
  await sleep(1800);
  await shot(`${tag}-3-overlay.png`);
  await ev('document.getElementById("sheet").scrollIntoView(); true');
  await sleep(400);
  await shot(`${tag}-4-sheet.png`);
  console.log(tag, 'シート文字数', await ev('document.getElementById("sheet").innerText.length'));
  if (tag === 'desktop') {
    await ev('document.querySelector("button.ex").click(); true');
    await sleep(800);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await shot('print-station.png');
    const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(outdir, 'station-sheet.pdf'), Buffer.from(pdf.result.data, 'base64'));
    check('印刷: 徳島駅のシートがA4・1ページ', pages(pdf.result.data) === 1, `（${pages(pdf.result.data)}ページ）`);
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    // 郊外（届出の注記が加わり長くなる）
    await ev('document.querySelectorAll("button.ex")[1].click(); true');
    await sleep(800);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    const pdf2 = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(outdir, 'kokufu-sheet.pdf'), Buffer.from(pdf2.result.data, 'base64'));
    await shot('print-kokufu.png');
    check('印刷: 国府町のシートがA4・1ページ', pages(pdf2.result.data) === 1, `（${pages(pdf2.result.data)}ページ）`);
    check('印刷: 出典・クレジットがシートに入る', await ev('document.querySelector("#sheet .fine").innerText.includes("このサービスは、国土交通省の不動産情報ライブラリ")'));
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
  }
}
await run('desktop', 1280, 900, false);
await run('mobile', 390, 844, true);

// 未取得の表示: 洪水（hazards.json）を読み込めなくして開き直す
await send('Network.setBlockedURLs', { urls: ['*hazards.json'] });
await open(1280, 900, false);
await ev('document.querySelector("button.ex").click(); true');
await sleep(1000);
check('未取得: 取得データの状況に「未取得」と理由が出る', await ev('document.getElementById("dataStatus").innerText.includes("未取得") && document.getElementById("dataStatus").innerText.includes("読み込めませんでした")'));
check('未取得: 災害の節に「未取得」が出て、洪水の行は出ない', await ev('(() => { const t = document.querySelector("#sheet [data-sec=hazard]").innerText; return t.includes("未取得") && t.includes("XKT026") && !t.includes("洪水浸水想定区域（想定最大規模）: "); })()'));
await shot('unfetched-hazard.png');
await send('Network.setBlockedURLs', { urls: ['*population.json'] });
await open(1280, 900, false);
await ev('document.querySelector("button.ex").click(); true');
await sleep(1000);
check('未取得: 将来人口が無い時は、市内か判定できない旨と「未取得」が出る', await ev('document.querySelector("#sheet .oos") && document.querySelector("#sheet .oos").innerText.includes("未取得")'));
await send('Network.setBlockedURLs', { urls: [] });

const bad = logs.filter((l) => !/cyberjapandata|msearch\.gsi|ERR_BLOCKED_BY_CLIENT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(l));
check('コンソールエラーなし（ブロックした読み込み・外部タイルの失敗を除く）', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 5)) : '');
console.log('logs', logs.length, 'うち除外外', bad.length);
ws.close(); chrome.kill();
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ }
process.exit(Object.values(results).every(Boolean) ? 0 : 1);
