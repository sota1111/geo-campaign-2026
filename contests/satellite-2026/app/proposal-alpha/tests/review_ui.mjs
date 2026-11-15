// usage: node tests/review_ui.mjs <base_url>  記録→④で点数を見直す→前後表示までの導線（要: google-chrome, node 22+、静的サーバー起動済み）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [base] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-rv-'));
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const cargs = ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`];
if (proxy) cargs.push(`--proxy-server=${proxy}`, '--proxy-bypass-list=127.0.0.1;localhost');
const chrome = spawn('google-chrome', [...cargs, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.text + ' ' + JSON.stringify(d.params.exceptionDetails.exception?.description || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
let fail = 0; const ok = (m, c) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) fail++; };
await send('Page.navigate', { url: base }); await sleep(1500);
await ev('localStorage.clear()'); await send('Page.navigate', { url: base }); await sleep(1500);
const rec = (site, res) => ev(`(()=>{document.querySelector("#r-site").value=${JSON.stringify(site)};document.querySelector("#r-who").value="A";document.querySelector("#r-result").value=${JSON.stringify(res)};document.querySelector("#rec-form").requestSubmit()})()`);
const T = (sel) => `document.querySelector(${JSON.stringify(sel)}).textContent`;

await ev('App.show("tune"); document.querySelector("#btn-apply-review").click()');
ok('記録なし: 変わらない理由が出る', await ev(`${T('#review-result')}.includes("記録がまだありません")`));
await ev('App.show("record")');
await rec('F1-03', '要伐採');
ok('記録直後に④へのボタンが見える', await ev('(()=>{const b=document.querySelector("#btn-rec-to-tune");return !document.querySelector("#rec-msg").hidden&&b.textContent.includes("点数を見直す")})()'));
ok('1件の要伐採で点数が変わる', await ev(`(()=>{document.querySelector("#btn-rec-to-tune").click();return ${T('#review-result')}.includes("点数が変わった区間")})()`));
await ev('App.show("record")');
await rec('F2-04', '要伐採'); await rec('F1-02', '問題なし'); await rec('F2-03', '要伐採');
await ev('document.querySelector("#btn-rec-to-tune").click()');
ok('④の画面に切り替わっている', await ev('!document.querySelector("#v-tune").hidden'));
ok('点数の前後（区間・前 → 後）が出る', await ev(`(t=>t.includes("点数が変わった区間")&&t.includes("→"))(${T('#review-result')})`));
await ev('document.querySelector("#btn-review-to-ledger").click()');
ok('①に「見直し後」の表示（バナーと 初期 → 見直し後）', await ev(`(t=>t.includes("見直した後の点数")&&t.includes("初期"))(${T('#v-ledger')})`));
ok('架空の表示が残る', await ev(`${T('#banner')}.includes("架空")`));
await ev('App.show("tune"); document.querySelector("#btn-weights-reset").click(); App.show("ledger")');
ok('初期値に戻すとバナーが消える', await ev('document.querySelector("#review-banner").hidden'));
ok('例外なし', logs.length === 0);
console.log(fail ? fail + ' failed' : 'all passed', logs);
chrome.kill(); process.exit(fail ? 1 : 0);
