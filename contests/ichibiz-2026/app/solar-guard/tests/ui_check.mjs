// 画面の確認: ヘッドレスChromeで主要操作を行い、スクリーンショット・コンソールエラー・通信の中身を調べる。
// usage: node tests/ui_check.mjs <base_url> <out_dir>   （要 google-chrome, node 22+。サーバー起動後に実行）
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

async function shot(c, name, full = false) {
  await sleep(1200);
  let params = { format: 'png' };
  if (full) {
    const h = await c.ev('document.documentElement.scrollHeight');
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await c.ev('window.innerWidth'), height: Math.min(h, 5000), scale: 1 } };
  }
  const s = await c.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
}

const problems = [];
const click = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

async function run(label, w, h, mobile) {
  const c = await openChrome();
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('!!(window.SgApp && SgApp.STATE.sc && SgApp.STATE.sc.length)')) break; }
  const st = await c.ev('({cells: SgApp.STATE.sc.length, munis: document.querySelectorAll("#muni-table tr").length, mapReady: SgApp.mapReady(), overflowX: document.documentElement.scrollWidth > window.innerWidth + 2, purpose: document.body.innerText.includes("使う人") && document.body.innerText.includes("しないこと"), est: document.body.innerText.includes("被害の予測ではなく")})');
  console.log(label, 'initial', JSON.stringify(st));
  if (st.cells < 150) problems.push(label + ': 集計メッシュが出ていない');
  if (st.munis < 45) problems.push(label + ': 市町村の表が出ていない');
  if (!st.purpose || !st.est) problems.push(label + ': 目的・目安の表示がない');
  if (st.overflowX) problems.push(label + ': 横スクロールが発生');
  await shot(c, `${label}-1-map.png`, mobile);

  // 重みを変える → 目安が変わる、全0で警告
  const before = await c.ev('SgApp.STATE.sc.map(c=>Math.round(c.score)).join(",")');
  await c.ev(`(function(){var e=document.getElementById("w-quiet");e.value="5";e.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  const after = await c.ev('SgApp.STATE.sc.map(c=>Math.round(c.score)).join(",")');
  if (before === after) problems.push(label + ': 重みを変えても目安が変わらない');
  await c.ev(`["quiet","kw","small"].forEach(function(k){var e=document.getElementById("w-"+k);e.value="0";e.dispatchEvent(new Event("input",{bubbles:true}));})`);
  const warn = await c.ev('document.getElementById("w-warn").innerText');
  if (!warn.includes('0')) problems.push(label + ': 重み全0の警告が出ない');
  await c.ev(`["quiet","kw","small"].forEach(function(k){var e=document.getElementById("w-"+k);e.value="1";e.dispatchEvent(new Event("input",{bubbles:true}));})`);

  // 個別設備・順位の表示が無い: 表は市町村のみ、メッシュ別の一覧ボタンなし
  const tables = await c.ev('document.querySelectorAll("#pane-map table").length');
  if (tables !== 1) problems.push(label + ': 表が市町村の1つ以外にある ' + tables);

  // CSV（集計のみ）
  const csv = await c.ev('SgApp.buildCsvRows().length');
  const csvText = await c.ev('SgApp.buildCsvRows().map(r=>r.join(",")).join("\\n")');
  console.log(label, 'csv rows', csv);
  if (csv < 280) problems.push(label + ': CSVの行が少ない ' + csv);
  if (/設備ID|代表者|電話|株式会社/.test(csvText)) problems.push(label + ': CSVに個人・事業者を示す語がある');
  if (!csvText.includes('国が作成したものではありません')) problems.push(label + ': CSVに出典・加工の明記がない');
  const dl = await c.ev('(function(){try{document.getElementById("btn-csv").click();return "ok"}catch(e){return String(e)}})()');
  if (dl !== 'ok') problems.push(label + ': CSV ' + dl);

  // 市町村表の並べ替え
  await click(c, '#muni-table th button[data-sort="score"]');
  const first = await c.ev('document.querySelector("#muni-table tr:nth-child(2) td").innerText');
  if (!first) problems.push(label + ': 並べ替え後の表が空');

  // 診断
  await click(c, '#tab-diag');
  await c.ev(`document.getElementById("in-lat").value="36.75";document.getElementById("in-lon").value="140.35";`);
  await click(c, '#btn-set');
  await sleep(300);
  let res = await c.ev('document.getElementById("diag-result").innerText');
  if (!res.includes('周囲の目安') || !res.includes('人の少なさ')) problems.push(label + ': 診断の周囲の目安が出ない');
  await click(c, '#ctl-class button:nth-child(1)'); // 低圧
  await click(c, '.cl-item .seg button[data-v="yes"]');
  await click(c, '.cl-group + .cl-item + .cl-item .seg button[data-v="no"]');
  await sleep(200);
  res = await c.ev('document.getElementById("diag-result").innerText');
  if (!/実施している\s*1/.test(res) || !/実施していない\s*1/.test(res)) problems.push(label + ': 回答が結果に反映されない: ' + res.slice(0, 200));
  if (!res.includes('出典')) problems.push(label + ': 未実施の対策に出典がない');
  // 範囲外・不正入力
  await c.ev(`document.getElementById("in-lat").value="34.0";document.getElementById("in-lon").value="135.0";`);
  await click(c, '#btn-set');
  const msg = await c.ev('document.getElementById("pos-msg").innerText');
  if (!msg.includes('範囲の外')) problems.push(label + ': 県外の座標で警告が出ない');
  await c.ev(`document.getElementById("in-lat").value="abc";`);
  await click(c, '#btn-set');
  if (!(await c.ev('document.getElementById("pos-msg").innerText')).includes('数字')) problems.push(label + ': 不正入力で警告が出ない');
  // 地図クリックで指す（地図が使える時）
  const mapOk = await c.ev('SgApp.mapReady()');
  await shot(c, `${label}-2-diag.png`, mobile);

  // 通信・保存の検査: 診断の座標が外に出ていない／POSTがない／保存がない
  await click(c, '#btn-reset');
  await c.ev(`document.getElementById("in-lat").value="36.7512";document.getElementById("in-lon").value="140.3487";`);
  await click(c, '#btn-set');
  await sleep(1500);
  const leaked = c.reqs.filter((r) => r.url.includes('36.7512') || r.url.includes('140.3487') || (r.post && /36\.7512|140\.3487/.test(r.post)));
  if (leaked.length) problems.push(label + ': 入力した座標を含む通信がある ' + leaked[0].url);
  const posts = c.reqs.filter((r) => r.method !== 'GET' && !r.url.startsWith('data:'));
  if (posts.length) problems.push(label + ': GET以外の通信 ' + posts.map((r) => r.method + ' ' + r.url).join(' | '));
  const hosts = [...new Set(c.reqs.filter((r) => /^https?:/.test(r.url)).map((r) => new URL(r.url).host))];
  console.log(label, 'hosts', hosts.join(','), 'map', mapOk);
  const odd = hosts.filter((x) => !ALLOWED.includes(x));
  if (odd.length) problems.push(label + ': 想定外の通信先 ' + odd.join(','));
  const store = await c.ev('({ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie})');
  if (store.ls || store.ss || store.ck) problems.push(label + ': 保存がある ' + JSON.stringify(store));

  // 盗難の実態・出典
  await click(c, '#tab-reality');
  const rl = await c.ev('({bars: document.querySelectorAll("#reality .bar").length, txt: document.getElementById("reality").innerText})');
  if (rl.bars < 20 || !rl.txt.includes('茨城県警察')) problems.push(label + ': 盗難の実態の図・出典がない');
  await shot(c, `${label}-3-reality.png`, mobile);
  await click(c, '#tab-about');
  const ab = await c.ev('document.getElementById("about").innerText');
  for (const wd of ['加工して作成', '悪用を防ぐ設計', '限界・未確認', '利用ルール', '3件未満']) if (!ab.includes(wd)) problems.push(label + ': 出典・限界に「' + wd + '」がない');
  await shot(c, `${label}-4-about.png`, mobile);
  if (await c.ev('document.documentElement.scrollWidth > window.innerWidth + 2')) problems.push(label + ': 横スクロール（出典タブ）');

  const logs = c.logs.filter((l) => !/Failed to load resource.*(unpkg|gsi\.go\.jp)|ERR_(PROXY|NAME|INTERNET|TUNNEL|CONNECTION)/.test(l));
  console.log(label, 'console errors', JSON.stringify(c.logs));
  if (logs.length) problems.push(label + ': コンソールエラー ' + logs.join(' / '));
  c.close();
}

await run('desktop', 1360, 860, false);
await run('mobile390', 390, 800, true);
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'ui_check OK');
process.exit(problems.length ? 1 : 0);
