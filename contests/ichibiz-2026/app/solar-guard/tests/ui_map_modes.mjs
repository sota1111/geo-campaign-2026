// 地図の表示切り替えの確認（四角／散布図、地図／空中写真、県警の件数の表）。ui_check.mjs と同じ方式。
// usage: node tests/ui_map_modes.mjs <base_url> <out_dir>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const baseHost = new URL(base).host;
const ALLOWED = [baseHost, 'unpkg.com', 'cyberjapandata.gsi.go.jp'];

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
  const args = ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`];
  if (proxy) args.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost');
  args.push('about:blank');
  const chrome = spawn('google-chrome', args, { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ }
    await sleep(200);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = []; const reqs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
    if (d.method === 'Network.requestWillBeSent') reqs.push({ url: d.params.request.url, method: d.params.request.method, post: d.params.request.postData || null });
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, reqs, close };
}

async function shot(c, name) {
  await sleep(2500);
  const s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
}
const problems = [];
const click = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);
const vis = (c, id) => c.ev(`SgApp.map().getLayoutProperty(${JSON.stringify(id)}, 'visibility')`);

async function run(label, w, h, mobile) {
  const c = await openChrome();
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('!!(window.SgApp && SgApp.mapReady && SgApp.mapReady())')) break; }
  const ready = await c.ev('SgApp.mapReady()');
  if (!ready) { problems.push(label + ': 地図が準備できない（ネットワーク制限の可能性）'); c.close(); return; }
  const st = await c.ev('({cells: SgApp.STATE.sc.length, towns: SgApp.STATE.tw.length, view: SgApp.STATE.view, base: SgApp.STATE.base, theft: document.getElementById("theft").innerText, ctl: !!document.getElementById("ctl-view") && !!document.getElementById("ctl-base"), overflowX: document.documentElement.scrollWidth > window.innerWidth + 2})');
  console.log(label, JSON.stringify({ cells: st.cells, towns: st.towns, view: st.view, base: st.base }));
  if (st.cells < 600) problems.push(label + ': 四角が細かくなっていない ' + st.cells);
  if (st.towns < 500) problems.push(label + ': 町字の円のデータがない ' + st.towns);
  if (st.view !== 'mesh' || st.base !== 'pale') problems.push(label + ': 最初の表示が四角・地図でない');
  for (const wd of ['373', '342', '152', '93', '49', '109', '164', '84', '38', '39', '転記', '割り振りません', 'Metal News']) if (!st.theft.includes(wd)) problems.push(label + ': 県警の件数の表に「' + wd + '」がない');
  if (st.overflowX) problems.push(label + ': 横スクロール');
  if (await vis(c, 'cells-fill') !== 'visible' || await vis(c, 'dots') !== 'none') problems.push(label + ': 最初は四角だけが見えるはず');
  await shot(c, `${label}-m1-mesh.png`);

  // 散布図
  await click(c, '#ctl-view button[data-v=dots]');
  await sleep(500);
  if (await vis(c, 'dots') !== 'visible' || await vis(c, 'cells-fill') !== 'none' || await vis(c, 'cells-line') !== 'none') problems.push(label + ': 散布図に切り替わらない');
  const lg = await c.ev('document.getElementById("legend").innerText');
  for (const wd of ['円の色', '盗難リスク', '予測ではありません', '円の大きさ', '設備数', '外枠', '代表点', '低', '中', 'やや高', '高']) if (!lg.includes(wd)) problems.push(label + ': 散布図の凡例に「' + wd + '」がない');
  const nd = await c.ev('SgApp.map().getSource("dots")._data.features.length');
  const lvs = await c.ev('Array.from(new Set(SgApp.STATE.tw.map(t=>t.level)))');
  console.log(label, 'dots', nd, 'levels', JSON.stringify(lvs));
  if (nd < 500) problems.push(label + ': 円が少ない ' + nd);
  if (lvs.length < 3) problems.push(label + ': 円の色の段階が3種未満 ' + lvs);
  await shot(c, `${label}-m2-dots.png`);

  // 円を押す（町字の集計・代表点・被害の予測でない旨）
  const pt = await c.ev('(function(){var t=SgApp.STATE.tw.filter(function(x){return x.n>=100})[0]||SgApp.STATE.tw[0];var m=SgApp.map();var p=m.project([t.lon,t.lat]);m.fire("click",{lngLat:{lng:t.lon,lat:t.lat},point:p,originalEvent:{}});return t.city+t.name})()');
  await sleep(600);
  const pop = await c.ev('(document.querySelector(".maplibregl-popup")||{}).innerText||""');
  console.log(label, 'popup', pop.replace(/\n/g, ' / ').slice(0, 160));
  for (const wd of ['町字の集計', '盗難リスクの目安（仮）', '設備', '点数', '設備の位置ではありません', 'この町字の被害ではありません']) if (!pop.includes(wd)) problems.push(label + ': 円のポップアップに「' + wd + '」がない（' + pt + '）');
  if (/事業者|電話|設備ID/.test(pop)) problems.push(label + ': 円のポップアップに個人・事業者を示す語');
  await shot(c, `${label}-m2b-dots-popup.png`);

  // 空中写真
  await click(c, '#ctl-base button[data-v=photo]');
  await sleep(500);
  if (await vis(c, 'photo') !== 'visible' || await vis(c, 'gsi') !== 'none') problems.push(label + ': 空中写真に切り替わらない');
  const lg2 = await c.ev('document.getElementById("legend").innerText');
  if (!lg2.includes('シームレス空中写真')) problems.push(label + ': 空中写真の出典が凡例にない');
  await shot(c, `${label}-m3-dots-photo.png`);
  const photoReqs = c.reqs.filter((r) => r.url.includes('/seamlessphoto/'));
  console.log(label, 'photo tile requests', photoReqs.length);
  if (!photoReqs.length) problems.push(label + ': 空中写真のタイルを取得していない');
  for (const r of photoReqs) {
    const z = Number(r.url.split('/seamlessphoto/')[1].split('/')[0]);
    if (z > 11) problems.push(label + ': 縮尺12以上の空中写真を要求 ' + r.url);
    if (r.method !== 'GET') problems.push(label + ': 空中写真の取得がGETでない');
  }

  // 四角＋空中写真
  await click(c, '#ctl-view button[data-v=mesh]');
  await sleep(500);
  if (await vis(c, 'cells-fill') !== 'visible' || await vis(c, 'dots') !== 'none') problems.push(label + ': 四角に戻らない');
  await shot(c, `${label}-m4-mesh-photo.png`);
  for (const r of c.reqs) if (r.method !== 'GET' || r.post) problems.push(label + ': GET以外の通信 ' + r.method + ' ' + r.url);
  for (const r of c.reqs) { const hst = new URL(r.url).host; if (r.url.startsWith('http') && !ALLOWED.includes(hst)) problems.push(label + ': 想定外の通信先 ' + hst); }
  if (c.logs.length) problems.push(label + ': コンソールエラー ' + c.logs.slice(0, 3).join(' | '));
  c.close();
}

await run('1513', 1513, 784, false);
await run('390', 390, 844, true);
if (problems.length) { console.log('問題:\n' + problems.join('\n')); process.exit(1); }
console.log('OK');
