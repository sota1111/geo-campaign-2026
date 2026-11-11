// UI通し確認（手動確認ツール。ヘッドレスChrome + CDP）。サーバーは別に起動しておく。
// usage: node tests/ui_flow.mjs <baseUrl> <outDir>
// 要: google-chrome, node 22+。デスクトップ(1280x800)とスマホ(390x844)で、地名選択→突き合わせ→記録→確認→書き出しを通し、
//     コンソールエラーが無いことと各段階のスクリーンショットを残す。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' ' + extra : '')); if (!ok) failures++; };

async function run(label, w, h, mobile) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-ui-'));
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
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
  const shot = async (name) => {
    for (let i = 0; i < 40; i++) { if (await ev('App.getMap().areTilesLoaded()')) break; await sleep(300); }
    await sleep(500);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `${label}-${name}.png`), Buffer.from(s.result.data, 'base64'));
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: base });
  for (let i = 0; i < 100; i++) { await sleep(300); if (await ev('!!(window.App && App.STATE.mapReady)')) break; }
  check(`[${label}] 地図とデータが読み込まれる`, await ev('!!App.STATE.mapReady && App.STATE.lore.items.length > 0'));
  check(`[${label}] 地名ピンが5件`, (await ev('document.querySelectorAll(".pin:not(.rec):not(.new)").length')) === 5);
  if (mobile) await ev('document.getElementById("panel").classList.contains("closed")');
  await shot('1-start');

  await ev('document.querySelector("#place-list button.item").click()');
  await sleep(1200);
  check(`[${label}] 地名選択で手順2・3が開く`, await ev('!document.getElementById("s-check").hidden && !document.getElementById("s-rec").hidden'));
  const cross = await ev('document.getElementById("cross").textContent');
  check(`[${label}] 突き合わせ: 手がかりあり表示（s1）`, /手がかりあり/.test(cross), cross.slice(0, 60));
  check(`[${label}] 危険度の語を出さない`, !/危険度は(高|低)|安全|危険です/.test(await ev('document.body.innerText')));
  await ev('App.setOverlay("ort_USA10")');
  await sleep(1500);
  await shot('2-check-overlay');

  await ev('document.getElementById("chk0").click(); document.getElementById("chk1").click()');
  await ev('document.querySelectorAll(".pin:not(.rec):not(.new)")[3].click()');
  await sleep(600);
  check(`[${label}] s4 選択で「公開データでは見つからず」`, /公開データでは見つからず/.test(await ev('document.getElementById("cross").textContent')));
  await ev('document.querySelector("#place-list button.item").click()'); await sleep(600);

  // 空欄のまま送信 → エラー
  await ev('document.getElementById("rec-form").requestSubmit()');
  check(`[${label}] 出典が空だと記録できない`, /出典/.test(await ev('document.getElementById("f-err").textContent')) && (await ev('App.STATE.records.length')) === 0);
  await ev(`(function(){
    document.getElementById('f-teller').value='語り手F（架空）';
    document.getElementById('f-story').value='デモ用の入力（架空）。実在の話ではない。';
    document.getElementById('f-basis').value='（架空）デモ入力';
    document.getElementById('f-vis').value='public';
    document.getElementById('chk0').checked=true;
    document.getElementById('rec-form').requestSubmit();
  })()`);
  await sleep(500);
  check(`[${label}] 記録が保存される（localStorage）`, (await ev('JSON.parse(localStorage.getItem("chimei-kioku-demo-v1")).length')) === 1);
  check(`[${label}] 地図に記録ピンが出る`, (await ev('document.querySelectorAll(".pin.rec").length')) === 1);
  check(`[${label}] 公開分は未確認のうち書き出せない`, await (async () => { await ev('document.getElementById("ex-pub").click()'); return /公開分がありません/.test(await ev('document.getElementById("ex-note").textContent')); })());
  await ev('Array.from(document.querySelectorAll("#rec-list .mini")).find(b=>/確認済みにする/.test(b.textContent)).click()');
  await sleep(300);
  check(`[${label}] 確認済みになる`, (await ev('App.STATE.records[0].verified')) === true && (await ev('document.querySelectorAll(".pin.rec.verified").length')) === 1);
  await ev('document.getElementById("ex-pub").click()');
  await sleep(300);
  const ex = await ev('JSON.stringify(App.STATE.lastExport)');
  check(`[${label}] 公開分GeoJSONが書き出される`, !!ex && JSON.parse(ex).features.length === 1 && JSON.parse(ex).features[0].properties.sample === false);
  await ev('document.getElementById("s-list").scrollIntoView()');
  await shot('3-recorded');
  await ev('Array.from(document.querySelectorAll("#rec-list .mini")).find(b=>/非公開/.test(b.textContent)).click()');
  await sleep(300);
  check(`[${label}] 非公開にすると地図から消え、公開分に入らない`, (await ev('document.querySelectorAll(".pin.rec").length')) === 0);
  await ev('document.getElementById("btn-about").click()'); await sleep(300);
  check(`[${label}] 出典ダイアログに架空の明記`, /サンプル（架空）/.test(await ev('document.getElementById("about").textContent')));
  await shot('4-about');
  await ev('document.getElementById("modal-close").click()');
  const scrollW = await ev('document.documentElement.scrollWidth');
  check(`[${label}] 横スクロールなし`, scrollW <= w, String(scrollW));
  check(`[${label}] コンソールエラーなし`, logs.length === 0, JSON.stringify(logs.slice(0, 5)));
  ws.close(); chrome.kill();
  try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 無視 */ }
}
await run('desktop', 1280, 800, false);
await run('mobile', 390, 844, true);
console.log(failures ? `FAILED ${failures}` : 'ALL PASS');
process.exit(failures ? 1 : 0);
