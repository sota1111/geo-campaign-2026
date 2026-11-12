// アグレッサー失敗テスト（画面, 2026-11-13）。usage: node tests/aggressor_ui.mjs <base_url>  （要: google-chrome, node 22+、静的サーバー起動済み）
// 「本来こうあるべき」を断言する。FAIL が弱点。本体は修正しない。報告: reports/aggressor/satellite-2026-alpha-20261113.md
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [base] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9900 + Math.floor(Math.random() * 90);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-ag-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { } await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const exc = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === 'Runtime.exceptionThrown') exc.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable');
let pass = 0, fail = 0; const ok = (n, c, info = '') => { c ? pass++ : fail++; console.log(c ? 'ok  ' : 'FAIL', n, c ? '' : info); };
const open = async () => { await send('Page.navigate', { url: base }); await sleep(1500); };

await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await open(); await ev('localStorage.clear()');

// UI-1 古い・壊れた重みが保存されていても画面が出る
await ev('localStorage.setItem("alpha-weights-v1", JSON.stringify({change:{"倒木・裸地化の疑い":25}}))');
exc.length = 0; await open();
const rows = await ev('document.querySelectorAll("#ledger tbody tr[data-id]").length');
ok('UI-1 キー欠落の重みが保存済みでも台帳14行が出る', rows === 14, `行数=${rows} 例外=${exc[0] ? exc[0].split('\n')[0] : 'なし'}`);
await ev('localStorage.clear()'); await open();

// UI-2 別タブでの記録が、このタブの記録で消えない（同時アクセス）
await ev('App.show("record")');
await ev('localStorage.setItem("alpha-results-v1", JSON.stringify([{siteId:"F2-01",date:"2026-11-12",who:"別タブ",result:"問題なし",memo:""}]))');
await ev('document.querySelector("#r-who").value="このタブ"; document.querySelector("#rec-form").requestSubmit()');
const n = await ev('JSON.parse(localStorage.getItem("alpha-results-v1")).length');
ok('UI-2 別タブで追加された記録が残る（後勝ちで消えない）', n === 2, `保存件数=${n}`);
await ev('localStorage.clear()');

// UI-3 早朝（JST 07:30）に開くと確認日の初期値が当日
await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'const __D=Date;Date=class extends __D{constructor(...a){super(...(a.length?a:["2026-11-13T07:30:00+09:00"]))}static now(){return new __D("2026-11-13T07:30:00+09:00").getTime()}};' });
await open();
const d = await ev('document.querySelector("#r-date").value');
ok('UI-3 07:30 JST の確認日の初期値が 2026-11-13', d === '2026-11-13', `初期値=${d}`);

// UI-4 スマホ幅 390px で ⑤ の地図がクリックしやすい大きさか（1セル=約12mが指で選べるか）
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await open(); await ev('App.show("real")'); await sleep(1500);
const w = await ev('document.querySelector("#xmap").getBoundingClientRect().width');
ok('UI-4 390pxで⑤の1セルが指で狙える（>=4px）', w / 200 >= 4, `地図幅=${Math.round(w)}px → 1セル=${(w / 200).toFixed(1)}px`);
// UI-5 ⑤の地図はキーボードだけで線を引けない（クリック専用）
const kb = await ev('(()=>{const s=document.querySelector("#xmap");return s.tabIndex>=0||!!s.onkeydown})()');
ok('UI-5 ⑤の線をキーボードでも引ける', kb, 'クリック以外の入力手段なし（例の線ボタンのみ）');

console.log(`\n${pass} ok / ${fail} FAIL`);
chrome.kill(); process.exitCode = fail ? 1 : 0; setTimeout(() => process.exit(), 300);
