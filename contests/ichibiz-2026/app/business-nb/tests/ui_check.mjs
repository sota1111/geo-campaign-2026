// 画面の確認: ヘッドレスChromeで一通りの流れを操作し、スクリーンショットとコンソールエラーを調べる。
// usage: node tests/ui_check.mjs <base_url> <out_dir>   （要 google-chrome, node 22+。unittest には含めない）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
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
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, close };
}

async function shot(c, name, full = false) {
  await sleep(1500);
  let params = { format: 'png' };
  if (full) {
    const h = await c.ev('document.documentElement.scrollHeight');
    params = { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await c.ev('window.innerWidth'), height: Math.min(h, 6000), scale: 1 } };
  }
  const s = await c.send('Page.captureScreenshot', params);
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
}

const problems = [];
async function run(label, w, h, mobile) {
  const c = await openChrome();
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('!!(window.NbApp && NbApp.STATE.res)')) break; }
  const st = await c.ev('({res: !!NbApp.STATE.res, rows: document.querySelectorAll("#fac-table tr").length, munis: document.querySelectorAll("#muni-table tr").length, bars: document.querySelectorAll("#chart rect").length, mapReady: NbApp.mapReady(), overflowX: document.documentElement.scrollWidth > window.innerWidth + 2, hyp: document.body.innerText.includes("廃棄時期は仮説")})');
  console.log(label, 'initial', JSON.stringify(st));
  if (!st.res || st.rows < 4) problems.push(label + ': 施設別の表が出ていない');
  if (st.munis < 5 || st.bars < 5) problems.push(label + ': 市区町村表か年別の図が出ていない');
  if (!st.hyp) problems.push(label + ': 「廃棄時期は仮説」の表示がない');
  if (st.overflowX) problems.push(label + ': 横スクロールが発生');
  await shot(c, `${label}-1-initial.png`, mobile);
  // 回収圏を広げる → 圏外は増えない
  const out0 = await c.ev('NbApp.STATE.res.total.outKw');
  await c.ev(`document.querySelectorAll('#ctl-radius button')[3].click()`);
  const out1 = await c.ev('NbApp.STATE.res.total.outKw');
  if (!(out1 <= out0)) problems.push(label + ': 回収圏を広げても圏外が減らない ' + out0 + ' -> ' + out1);
  await c.ev(`document.querySelectorAll('#ctl-radius button')[1].click()`);
  await c.ev(`document.querySelectorAll('#ctl-basis button')[0].click()`);
  await c.ev(`document.querySelectorAll('#ctl-cut button')[0].click()`);
  await sleep(300);
  // 候補拠点: 探す → 圏外が増えない
  const before = await c.ev('NbApp.STATE.res.total.outKw');
  await c.ev('document.getElementById("btn-suggest").click()');
  await sleep(500);
  const after = await c.ev('({out: NbApp.STATE.res.total.outKw, cand: !!NbApp.STATE.cand, txt: document.getElementById("cand-result").innerText})');
  console.log(label, 'suggest', before, '->', after.out);
  if (!after.cand || after.out > before) problems.push(label + ': 候補拠点で圏外が増えた/置けない');
  if (!after.txt.includes('未検討')) problems.push(label + ': 候補拠点の注意書きがない');
  await shot(c, `${label}-2-candidate.png`, mobile);
  const csv = await c.ev('NbApp.buildCsvRows().length');
  const head = await c.ev('NbApp.buildCsvRows().slice(0,3).map(r=>r.join(" ")).join(" | ")');
  console.log(label, 'csv rows', csv, head);
  if (csv < 30) problems.push(label + ': CSVの行が少ない');
  const dl = await c.ev('(function(){try{document.getElementById("btn-csv").click();return "ok"}catch(e){return String(e)}})()');
  if (dl !== 'ok') problems.push(label + ': CSV ' + dl);
  await c.ev('document.getElementById("btn-clear").click()');
  await c.ev('document.getElementById("btn-about").click()');
  await sleep(400);
  const about = await c.ev('document.getElementById("about").innerText');
  if (!about.includes('加工して作成') || !about.includes('京都府')) problems.push(label + ': 出典の表示が足りない');
  await shot(c, `${label}-3-about.png`);
  const logs = c.logs.filter((l) => !/Failed to load resource.*(unpkg|gsi\.go\.jp)|ERR_(PROXY|NAME|INTERNET|TUNNEL|CONNECTION)/.test(l));
  console.log(label, 'console errors', JSON.stringify(c.logs));
  if (logs.length) problems.push(label + ': コンソールエラー ' + logs.join(' / '));
  c.close();
}

await run('desktop', 1360, 860, false);
await run('mobile390', 390, 800, true);
console.log(problems.length ? 'PROBLEMS\n' + problems.join('\n') : 'ui_check OK');
process.exit(problems.length ? 1 : 0);

