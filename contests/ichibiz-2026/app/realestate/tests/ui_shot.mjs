// UI確認用（手動。ヘッドレスChromeで実際にクリックして1枚シートを出し、スクリーンショットを撮る）
// usage: node tests/ui_shot.mjs <url> <outdir>   要: google-chrome, node 22+
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'reshot-'));
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
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');

async function run(tag, w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!(window.App && App.ready)')) break; }
  await sleep(1500);
  await ev('App.state.view = {lon:134.5548, lat:34.0703, z:16}; App.render(); true');
  await sleep(1500);
  await shot(`${tag}-1-map.png`);
  // 実クリック（地図中央）
  const rect = await ev('(() => { const r = document.getElementById("map").getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()');
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await ev('!!App.last')) break; }
  await sleep(500);
  console.log(tag, 'facts', await ev('JSON.stringify({zone: App.last && App.last.zone && App.last.zone.name, flood: App.last && App.last.flood, hightide: App.last && App.last.hightide, tsunami: App.last && App.last.tsunami, sed: App.last && App.last.sediment, elev: App.last && App.last.elevation, bus: App.last && App.last.transit && App.last.transit.bus})'));
  await ev('document.getElementById("overlay").value="01_flood_l2_shinsuishin_data"; document.getElementById("overlay").dispatchEvent(new Event("change")); true');
  await sleep(2000);
  await shot(`${tag}-2-after-click.png`);
  await ev('document.getElementById("sheet").scrollIntoView(); true');
  await sleep(500);
  await shot(`${tag}-3-sheet.png`);
  console.log(tag, 'sheet chars', await ev('document.getElementById("sheet").innerText.length'));
  if (tag === 'desktop') {
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await shot('print-real-location.png');
    // 見本（架空）
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await ev('document.getElementById("sampleBtn").click(); true');
    await sleep(500);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await shot('print-sample.png');
    // PDF（1枚に収まるか）
    const pdf = await send('Page.printToPDF', { paperWidth: 8.27, paperHeight: 11.69, printBackground: true, preferCSSPageSize: true });
    fs.writeFileSync(path.join(outdir, 'sample-sheet.pdf'), Buffer.from(pdf.result.data, 'base64'));
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
  }
}
await run('desktop', 1280, 900, false);
await run('mobile', 390, 844, true);
console.log('logs', logs);
ws.close(); chrome.kill();
try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ }
process.exit(0);
