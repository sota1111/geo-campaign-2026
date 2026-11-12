// usage: node tests/ui_shot.mjs <base_url> <out_dir>   （要: google-chrome, node 22+、静的サーバー起動済み）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'morib-'));
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const cargs = ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`];
if (proxy) cargs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost');
const chrome = spawn('google-chrome', [...cargs, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = []; const tileErrs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.text);
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + JSON.stringify(d.params.args.map((a) => a.value || a.description)));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') (/cyberjapandata\.gsi\.go\.jp/.test(d.params.entry.url || '') ? tileErrs : logs).push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const shot = async (name) => { await sleep(300); const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); };
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? 'ok  ' : 'FAIL', name); };

const tileInfo = async () => ev(`(async()=>{const imgs=[...document.querySelectorAll('#ledger tbody image')];return imgs.length})()`);
for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: base }); await sleep(1500);
  await ev('localStorage.clear(); location.reload()'); await sleep(2500);
  // --- 実データ（既定） ---
  ok(label + ': 既定は実データ', (await ev('App.state.mode')) === 'real');
  ok(label + ': バナーに未接続と実データの明示', (await ev('document.querySelector("#banner").textContent.includes("衛星由来の変化量は未接続")')));
  ok(label + ': 台帳25行（全716件中）', (await ev('document.querySelectorAll("#ledger tbody tr[data-id]").length')) === 25 && (await ev('document.querySelector("#count").textContent.includes("716件中")')));
  ok(label + ': 行に前後の写真（各行2枚）', (await ev('document.querySelectorAll("#ledger tbody tr[data-id]")[0].querySelectorAll("image").length')) === 2);
  ok(label + ': ページ全体の横スクロールなし', (await ev('document.documentElement.scrollWidth <= window.innerWidth + 1')));
  ok(label + ': 出典・ライセンス表示', (await ev('(t=>t.includes("CC BY 4.0")&&t.includes("国土数値情報")&&t.includes("取得日"))(document.querySelector("#footer").textContent)')));
  await ev('document.querySelector("#ledger tbody tr").click()'); await sleep(2500);
  ok(label + ': 詳細に点数内訳と未接続', (await ev('(t=>t.includes("点数の内訳")&&t.includes("未接続"))(document.querySelector("#detail").textContent)')));
  ok(label + ': 詳細に前後の写真2枚', (await ev('document.querySelectorAll("#detail .imgs svg").length')) === 2);
  await shot(`${label}-1-ledger-real.png`);
  await ev('App.show("plan")'); ok(label + ': 計画6件', (await ev('document.querySelectorAll("#plan-list li").length')) === 6);
  await shot(`${label}-2-plan-real.png`);
  await ev('App.show("record")');
  const sid = await ev('document.querySelector("#r-site").value');
  await ev('document.querySelector("#r-who").value="巡視員A"; document.querySelector("#r-result").value="是正対象"; document.querySelector("#rec-form").requestSubmit()');
  ok(label + ': 記録が実データ用キーに保存', (await ev('JSON.parse(localStorage.getItem("morido-b-results-v2-real")).length')) === 1);
  await shot(`${label}-3-record-real.png`);
  await ev('App.show("ledger")');
  ok(label + ': 台帳に結果が戻る', (await ev(`(()=>{const r=App.state.ranked.find(s=>s.id===${JSON.stringify(sid)});return !!r.latest&&r.latest.result==='是正対象'})()`)));
  await ev('App.show("tune")'); ok(label + ': 集計に型', (await ev('document.querySelector("#hit-table tbody").textContent.includes("谷埋め型")')));
  await shot(`${label}-4-tune-real.png`);
  // --- 架空サンプルへ切り替え ---
  await ev('document.querySelector("#m-sample").click()'); await sleep(300);
  ok(label + ': 切替で架空と明示・12件・記録は別', (await ev('(App.state.mode==="sample")&&document.querySelectorAll("#ledger tbody tr[data-id]").length===12&&document.querySelector("#banner").textContent.includes("架空サンプル")&&App.state.results.length===0')));
  await shot(`${label}-5-ledger-sample.png`);
  await ev('document.querySelector("#m-real").click()'); await sleep(300);
  ok(label + ': 実データへ戻せる・記録が残っている', (await ev('App.state.mode==="real"&&App.state.results.length===1')));
}
ok('コンソールエラーなし ' + JSON.stringify(logs), logs.length === 0);
console.log('（情報）地理院タイルの読み込み失敗: ' + tileErrs.length + ' 件（写真なしの地点）');
ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(checks.every((c) => c[1]) ? 0 : 1);
