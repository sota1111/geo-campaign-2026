// usage: node tests/ui_shot.mjs <base_url> <out_dir>   （要: google-chrome, node 22+、静的サーバー起動済み）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9600 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-'));
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
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + d.params.exceptionDetails.text + ' ' + JSON.stringify(d.params.exceptionDetails.exception?.description || ''));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + JSON.stringify(d.params.args.map((a) => a.value || a.description)));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') (/cyberjapandata\.gsi\.go\.jp/.test(d.params.entry.url || '') ? tileErrs : logs).push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const shot = async (name) => { await sleep(300); const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); };
const checks = [];
const ok = (name, cond) => { checks.push([name, !!cond]); console.log(cond ? 'ok  ' : 'FAIL', name); };
const clickAt = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };

for (const [label, w, h, mobile] of [['desktop', 1280, 900, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: base }); await sleep(1500);
  await ev('localStorage.clear(); location.reload()'); await sleep(2000);
  if (logs.length) console.log('起動時のログ', logs);
  // ① 台帳
  ok(label + ': バナーに架空と実データの区別', (await ev('(t=>t.includes("架空")&&t.includes("実データ"))(document.querySelector("#banner").textContent)')));
  ok(label + ': 言えること／言えないことの表示', (await ev('(t=>t.includes("離隔距離")&&t.includes("倒木の予知"))(document.querySelector(".can").textContent)')));
  ok(label + ': 台帳14行・1位は F1-03', (await ev('document.querySelectorAll("#ledger tbody tr[data-id]").length')) === 14 && (await ev('document.querySelector("#ledger tbody tr").dataset.id')) === 'F1-03');
  ok(label + ': 地図に14区間', (await ev('document.querySelectorAll("#map .mk").length')) === 14);
  ok(label + ': ページ全体の横スクロールなし', (await ev('document.documentElement.scrollWidth <= window.innerWidth + 1')));
  await ev('document.querySelector("#ledger tbody tr").click()');
  ok(label + ': 詳細に内訳（衛星・公開／事業者）と離隔距離の注意', (await ev('(t=>t.includes("点数の内訳")&&t.includes("[衛星・公開]")&&t.includes("[事業者等]")&&t.includes("離隔距離ではありません"))(document.querySelector("#detail").textContent)')));
  await shot(`${label}-1-ledger.png`);
  const topSat = await ev('(()=>{document.querySelector("#f-sat").click();return document.querySelector("#ledger tbody tr").dataset.id+"|"+document.querySelector("#count").textContent})()');
  ok(label + ': 衛星のみ並べ替えで表示が切り替わる', topSat.includes('衛星・公開データ由来の点数だけ'));
  await ev('document.querySelector("#f-sat").click()');
  // ② 計画
  await ev('App.show("plan")');
  ok(label + ': 計画4区間と協議用の表（費用負担は空欄の注記）', (await ev('document.querySelectorAll("#plan-list li").length')) === 4 && (await ev('(t=>t.includes("協議で決める")&&t.includes("個別協議"))(document.querySelector("#share-box").textContent)')));
  await shot(`${label}-2-plan.png`);
  // ③ 記録
  await ev('App.show("record")');
  const sid = await ev('document.querySelector("#r-site").value');
  await ev('document.querySelector("#r-who").value="確認者A"; document.querySelector("#r-result").value="要伐採"; document.querySelector("#rec-form").requestSubmit()');
  ok(label + ': 記録が localStorage に保存', (await ev('JSON.parse(localStorage.getItem("alpha-results-v1")).length')) === 1);
  await shot(`${label}-3-record.png`);
  await ev('App.show("ledger")');
  ok(label + ': 台帳に結果が戻る', (await ev(`(()=>{const r=App.state.ranked.find(s=>s.id===${JSON.stringify(sid)});return !!r.latest&&r.latest.result==='要伐採'})()`)));
  // ④ 見直し
  await ev('App.show("tune")');
  ok(label + ': 集計に変化の区分', (await ev('document.querySelector("#hit-table tbody").textContent.includes("倒木・裸地化の疑い")')));
  await ev('(()=>{const i=document.querySelector("#hit-table input");i.value="0";i.dispatchEvent(new Event("change"))})()');
  ok(label + ': 重みの変更が順位に反映・保存', (await ev('!!localStorage.getItem("alpha-weights-v1")')));
  await shot(`${label}-4-tune.png`);
  // ⑤ 実データ
  await ev('App.show("real")'); await sleep(2500);
  ok(label + ': 実データ画面に「実データ」「仮の線」「実在の配電線ではありません」', (await ev('(t=>t.includes("これは実データです")&&t.includes("仮の線")&&t.includes("実在の配電線ではありません"))(document.querySelector("#v-real").textContent)')));
  ok(label + ': 樹高の凡例と出典・撮影日', (await ev('(t=>t.includes("樹高の凡例"))(document.querySelector("#x-legend").textContent)')) && (await ev('(t=>t.includes("CC BY 4.0")&&t.includes("2020-02-09"))(document.querySelector("#footer").textContent)')));
  // 実際のクリックで2点を置く
  const box = await ev('(()=>{const r=document.querySelector("#xmap").getBoundingClientRect();return [r.left,r.top,r.width,r.height,window.scrollX,window.scrollY]})()');
  await ev('document.querySelector("#xmap").scrollIntoView({block:"start"})');
  const box2 = await ev('(()=>{const r=document.querySelector("#xmap").getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()');
  await clickAt(box2[0] + box2[2] * 0.35, box2[1] + box2[3] * 0.7);
  await clickAt(box2[0] + box2[2] * 0.5, box2[1] + box2[3] * 0.45);
  ok(label + ': クリックで頂点が2点置かれ集計が出る', (await ev('App.state.line.length')) === 2 && (await ev('document.querySelectorAll("#x-result tbody tr").length')) >= 3);
  await ev('document.querySelector("#x-clear").click()');
  ok(label + ': 線を消すと案内に戻る', (await ev('App.state.line.length')) === 0 && (await ev('document.querySelector("#x-result").textContent.includes("クリック")')));
  await ev('document.querySelector("#x-preset").click()');
  ok(label + ': 例の線で100m区間の表（8行以上）と離隔距離の注意', (await ev('document.querySelectorAll("#x-result tbody tr").length')) >= 8 && (await ev('document.querySelector("#x-result").textContent.includes("離隔距離でも倒木の予測でもありません")')));
  await ev('(()=>{const s=document.querySelector("#x-tall");s.value="20";s.dispatchEvent(new Event("change"))})()');
  ok(label + ': しきい値の変更が集計に反映', (await ev('document.querySelector("#x-result").textContent.includes("20 m以上")')));
  ok(label + ': ⑤でも横スクロールなし', (await ev('document.documentElement.scrollWidth <= window.innerWidth + 1')));
  await shot(`${label}-5-real.png`);
}
ok('コンソールエラーなし ' + JSON.stringify(logs), logs.length === 0);
console.log('（情報）地理院タイルの読み込み失敗: ' + tileErrs.length + ' 件（背景なしで表示される）');
ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(checks.every((c) => c[1]) ? 0 : 1);
