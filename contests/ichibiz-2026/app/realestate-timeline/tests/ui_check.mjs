// UI確認（手動）。ヘッドレスChromeで画面を開き、区を押す・再生・家賃への切り替えを実際に操作して、
// 地図の高さの割合・横スクロール・再生で年が進むか・コンソールエラーを調べ、スクリーンショットを撮る。
// usage: node tests/ui_check.mjs <url> <outdir>   例: url=http://127.0.0.1:8851/index.html
// 要: google-chrome, node 22+。地図タイルの取得にネット接続が必要（無くても確認自体は進む）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tlshot-'));
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
const shot = async (name, full = false) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  fs.writeFileSync(path.join(outdir, name), Buffer.from(r.data ?? r.result.data, 'base64'));
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
await send('Runtime.enable'); await send('Page.enable');
const report = {};
const metrics = `JSON.stringify({
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  vh: innerHeight, mapH: Math.round(document.getElementById('map').getBoundingClientRect().height), mapTop: Math.round(document.getElementById('map').getBoundingClientRect().top),
  mapShare: +(document.getElementById('map').getBoundingClientRect().height / innerHeight).toFixed(2),
  docH: document.documentElement.scrollHeight,
  when: document.getElementById('when').textContent, period: document.getElementById('period').textContent,
  detail: document.getElementById('detailBody').innerText.slice(0, 160).replace(/\\n/g, ' / ') })`;
const pt = (code, name) => `(() => { const S = window.__tl, d = S.data.byKey.get('${code}|${name}'); const lp = d.lp; const r = document.getElementById('map').getBoundingClientRect();
    const wd = (lon, lat) => { const s = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }; };
    const k = 256 * 2 ** S.view.z, c = wd(S.view.lon, S.view.lat), p = wd(lp.lon, lp.lat);
    return JSON.stringify({ x: r.left + r.width / 2 + (p.x - c.x) * k, y: r.top + r.height / 2 + (p.y - c.y) * k }); })()`;
for (const [name, w, h] of [['1513', 1513, 784], ['390', 390, 844]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url });
  await sleep(2500);
  report[name + '-load'] = JSON.parse(await ev(metrics));
  await shot(`${name}-1-load.png`);
  // 地区を押す: 地図を西新宿に寄せてから、その地区の中心を実クリック（寄せた後は別の地区を選んだ状態になるので、いったん選択を外す）
  await ev("(() => { const S = window.__tl; const d = S.data.byKey.get('13104|西新宿'); document.getElementById('find') && 0; })()");
  await ev("document.querySelector('.rk') && document.querySelector('.rk').click()"); // 順位表の先頭（地図が寄る）
  await sleep(500);
  await ev("document.getElementById('clr') && document.getElementById('clr').click()");
  await ev("(() => { const S = window.__tl; const d = S.data.byKey.get('13104|西新宿'); const f = document.getElementById('find'); f.value = '西新宿（新宿区）'; f.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await sleep(500);
  await ev("document.getElementById('clr') && document.getElementById('clr').click()");
  await sleep(300);
  const p0 = JSON.parse(await ev(pt('13104', '西新宿')));
  await click(p0.x, p0.y);
  await sleep(700);
  report[name + '-selected'] = JSON.parse(await ev(metrics));
  report[name + '-selected'].sel = await ev('window.__tl.sel');
  await shot(`${name}-2-selected.png`);
  await shot(`${name}-2-selected-full.png`, true);
  // 間取りを切り替える（3LDK以上）
  await ev("document.querySelectorAll('#planbar button')[4].click()");
  await sleep(500);
  report[name + '-plan'] = JSON.parse(await ev(metrics));
  await shot(`${name}-3-plan.png`);
  // 全体に戻して、再生: 先頭へ戻して再生し、年が進むか
  await ev("document.getElementById('zfit').click()");
  await ev("(() => { const s = document.getElementById('slider'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('play').click(); })()");
  const q0 = await ev('window.__tl.yi'); await sleep(2300); const q1 = await ev('window.__tl.yi');
  report[name + '-play'] = { from: q0, to: q1, advanced: q1 > q0, when: await ev("document.getElementById('when').textContent") };
  await shot(`${name}-4-playing.png`);
  await ev("window.__tl.timer && document.getElementById('play').click()");
  // 家賃へ（区の地図。間取りは選べない）
  await ev("document.getElementById('modeRent').click()");
  await sleep(500);
  report[name + '-rent'] = JSON.parse(await ev(metrics));
  report[name + '-rent'].planDisabled = await ev("[...document.querySelectorAll('#planbar button')].every((b) => b.disabled)");
  await shot(`${name}-5-rent.png`);
  await shot(`${name}-5-rent-full.png`, true);
  // 価格に戻し、最新の年・1R〜1K（件数が少ない地区が多い）で全体
  await ev("document.getElementById('modePrice').click()");
  await ev("document.querySelectorAll('#planbar button')[2].click()");
  await ev("(() => { const s = document.getElementById('slider'); s.value = s.max; s.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(400);
  report[name + '-latest'] = { count: await ev("document.getElementById('legCount').textContent") };
  await shot(`${name}-6-latest.png`);
}
console.log(JSON.stringify(report, null, 1));
console.log('console errors:', logs.length ? logs : 'なし');
ws.close(); chrome.kill();
