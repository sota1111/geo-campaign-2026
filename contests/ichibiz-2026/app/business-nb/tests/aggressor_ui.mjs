// アグレッサーの失敗テスト（ichibiz-2026 新案NB: 画面）。2026-11-13
// usage:
//   python3 -m http.server 8831 --bind 127.0.0.1 --directory web &
//   node tests/aggressor_ui.mjs http://127.0.0.1:8831/
// 要 google-chrome・node 22+。外部への送信はしない（地図タイルと MapLibre の GET のみ。U4 ではそれも遮断する）。
// 本来の置き場所は app/business-nb/tests/ だが、書き込み範囲の hook で拒否されたためここに置く。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = process.argv[2] || 'http://127.0.0.1:8831/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9300 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-agg-'));
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
  let id = 0; const pending = new Map(); const logs = []; const handlers = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    handlers.forEach((h) => h(d));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, handlers, close };
}

const results = [];
const rec = (id, ok, title, msg = '') => results.push([id, ok ? 'PASS' : 'FAIL', title, msg]);

async function load(c, w = 1280, h = 860, mobile = false) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await c.ev('!!(window.NbApp && NbApp.STATE.res)')) break; }
  await sleep(500);
}
// seg ボタンを、ラベルの文字で押す
const clickSeg = (c, ctl, label) => c.ev(`(function(){var b=[...document.querySelectorAll('#${ctl} button')].find(x=>x.textContent.indexOf(${JSON.stringify(label)})>=0); if(!b) return false; b.click(); return true;})()`);

async function scenarioMain() {
  const c = await openChrome();
  try {
    await load(c);
    // U1: 対象0件の組（運転開始＋35年・2035年まで）
    await clickSeg(c, 'ctl-basis', '＋35年'); await clickSeg(c, 'ctl-cut', '2035');
    await sleep(300);
    const sum = await c.ev("document.getElementById('summary').innerText");
    const zero = /0件・0\.0 MW/.test(sum);
    const explained = /(推定される設備はありません|まだ出ない|対象.*ありません|0件のため)/.test(sum);
    rec('U1', !zero || explained, '対象0件の組で「0件だから圏外0%」と読める表示にならない（理由を出す）', zero && !explained ? sum.replace(/\s+/g, ' ').slice(0, 160) : '');

    // U2: 対象0件のまま「距離が最も減る町字を探す」
    await c.ev("document.getElementById('btn-suggest').click()");
    await sleep(300);
    const cand = await c.ev("JSON.stringify(NbApp.STATE.cand)");
    const candTxt = await c.ev("document.getElementById('cand-result').innerText");
    rec('U2', cand === 'null', '対象0件なら候補拠点を置かない', cand !== 'null' ? 'cand=' + cand + ' / ' + candTxt.replace(/\s+/g, ' ').slice(0, 120) : '');

    // U8: 対象0件で CSV を作っても NaN・Infinity が出ない
    const csv = await c.ev("JSON.stringify(NbApp.buildCsvRows())");
    rec('U8', !/NaN|Infinity/.test(csv), '対象0件のCSVに NaN/Infinity が出ない', /NaN|Infinity/.test(csv) ? 'CSVに NaN/Infinity' : '');

    // U7: 連打（条件ボタンを200回切り替え）で例外が出ず、1回あたりの再計算が重すぎない
    await c.ev("document.getElementById('btn-clear').click()");
    const t = await c.ev(`(async function(){var bs=[...document.querySelectorAll('#ctl-radius button, #ctl-cut button, #ctl-basis button')];var t0=performance.now();for(var i=0;i<200;i++){bs[i%bs.length].click();}return performance.now()-t0;})()`);
    const before = c.logs.length;
    await sleep(800);
    rec('U7', typeof t === 'number' && t / 200 < 100 && c.logs.filter((l) => l.startsWith('EXC')).length === 0,
      '条件ボタンの200回連打で例外なし・1回100ms未満', 'avg ' + (typeof t === 'number' ? (t / 200).toFixed(1) : JSON.stringify(t)) + ' ms; logs+' + (c.logs.length - before));

    // U3: 320px 幅（小型スマホ）で横スクロールが出ない
    await load(c, 320, 640, true);
    const sw = await c.ev('document.documentElement.scrollWidth');
    const iw = await c.ev('window.innerWidth');
    rec('U3', sw <= iw + 1, '320px 幅で横スクロールなし', `scrollWidth=${sw} innerWidth=${iw}`);
    // U3b: スマホで地図が最初の画面に入っているか（判断材料の地図まで何画面スクロールするか）
    const mapTop = await c.ev("Math.round(document.getElementById('map').getBoundingClientRect().top)");
    rec('U3b', mapTop < 640 * 3, '320px 幅で地図が3画面以内に出る', `map top=${mapTop}px（画面高640）`);

    const exc = c.logs.filter((l) => l.startsWith('EXC'));
    rec('U0', exc.length === 0, '主シナリオでコンソール例外なし', exc.slice(0, 3).join(' | '));
  } finally { c.close(); }
}

// U4: MapLibre（unpkg）と地図タイルが取れない環境（会場のネットワーク制限など）
async function scenarioNoMap() {
  const c = await openChrome();
  try {
    await c.send('Network.enable');
    await c.send('Network.setBlockedURLs', { urls: ['*unpkg.com*', '*cyberjapandata.gsi.go.jp*'] });
    await load(c);
    const sum = await c.ev("document.getElementById('summary').innerText");
    const mapMsg = await c.ev("document.getElementById('map').innerText");
    rec('U4', /件/.test(sum) && /読み込めません/.test(mapMsg), '地図部品が取れなくても表は出て、地図欄に理由が出る', 'summary=' + sum.slice(0, 40) + ' map=' + mapMsg.slice(0, 40));
    // U4b: 地図なしで「地図をクリックして置く」を押すと、押せない理由が出るか
    await c.ev("document.getElementById('btn-place').click()");
    const btn = await c.ev("document.getElementById('btn-place').textContent");
    rec('U4b', !/クリックしてください/.test(btn), '地図が無いとき「地図をクリックしてください」の状態にならない', 'button=' + btn);
  } finally { c.close(); }
}

// U5/U6: データ欠損（plants.json が404・facilities.json が空配列）
async function scenarioBrokenData(kind) {
  const c = await openChrome();
  try {
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*data/' + (kind === 'U5' ? 'plants' : 'facilities') + '.json*' }] });
    c.handlers.push((d) => {
      if (d.method !== 'Fetch.requestPaused') return;
      if (kind === 'U5') c.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 404, body: Buffer.from('not found').toString('base64') });
      else c.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from('[]').toString('base64') });
    });
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: base });
    await sleep(3000);
    const sum = await c.ev("document.getElementById('summary').innerText");
    const exc = c.logs.filter((l) => l.startsWith('EXC'));
    if (kind === 'U5') rec('U5', /読み込めませんでした/.test(sum) && exc.length === 0, 'plants.json が404なら理由を表示（例外なし）', sum.slice(0, 80) + ' ' + exc.join('|'));
    else rec('U6', exc.length === 0 && sum.trim().length > 0 && !/Cannot read|undefined/.test(sum), '施設リストが空でも、JSの内部エラー文ではなく利用者向けの説明を出す', 'summary="' + sum.slice(0, 60) + '" ' + exc.slice(0, 2).join('|'));
  } finally { c.close(); }
}

await scenarioMain();
await scenarioNoMap();
await scenarioBrokenData('U5');
await scenarioBrokenData('U6');

let fail = 0;
for (const [id, st, title, msg] of results) {
  if (st === 'FAIL') fail++;
  console.log(st.padEnd(4), id.padEnd(4), title + (msg ? '\n          -> ' + msg : ''));
}
console.log(`aggressor_ui: ${results.length - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
