// 第3段階の流れの確認（ヘッドレスChrome + CDP）。unittest には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8881 --bind 127.0.0.1 &) ; node tests/flow_check.mjs http://127.0.0.1:8881/ <out_dir> <data_dir>
// 確かめること（1513×784 と 390×844）: 未入力で無効ボタンの理由とデモの導線が画面内にある／デモで過去の調査と今回の走査が分かれ、選択が残る／
//   較正→第2回／同梱の見本 CSV（区間ID・緯度経度）だけで較正まで進める／段階を移るとパネルが先頭に戻る／CSV の結果が画面内に出る
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir, csvDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open() {
  const port = 9900 + Math.floor(Math.random() * 90);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-'));
  const ch = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let t;
  for (let i = 0; i < 50; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (t.length) break; } catch { /* retry */ } await sleep(200); }
  const ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const p = new Map(); const errs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') errs.push(d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 150));
  };
  const send = (m, pa = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: pa })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __err: r.result.exceptionDetails.exception?.description?.slice(0, 200) } : r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable');
  return { send, ev, errs, close: () => { ws.close(); ch.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } } };
}
const shot = async (c, n) => { await sleep(600); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, n + '.png'), Buffer.from(s.result.data, 'base64')); };
// 実ファイルの中身を、ファイル入力の change イベントで渡す（画面の操作と同じ経路）
const setFile = async (c, sel, file) => {
  const body = JSON.stringify(fs.readFileSync(file, 'utf8'));
  await c.ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${body}],${JSON.stringify(path.basename(file))},{type:'text/csv'}));const i=document.querySelector('${sel}');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
};
// 要素が画面内（固定バーより上）にあるか。固定バーの上端を基準にする
const vis = (sel) => `(()=>{const e=document.querySelector('${sel}'); if(!e) return 'none'; const r=e.getBoundingClientRect(); const sb=document.querySelector('#s3 .stickybar'); const lim=sb?sb.getBoundingClientRect().top:innerHeight; return JSON.stringify({top:Math.round(r.top),bottom:Math.round(r.bottom),limit:Math.round(lim),inView:r.top>=0&&r.bottom<=innerHeight+1,disabled:!!e.disabled})})()`;

let bad = 0;
for (const [lab, w, h] of [['d', 1513, 784], ['m', 390, 844]]) {
  const c = await open();
  const log = (k, v) => console.log(lab, k, typeof v === 'string' ? v : JSON.stringify(v));
  const need = (cond, msg) => { if (!cond) { bad++; console.log(lab, 'NG', msg); } };
  console.log('opened');
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('window.__ready === true')) break; }
  // 流れ1: 未入力 → デモ → 較正 → 第2回
  await c.ev('App.setStep(3)'); await shot(c, lab + '-1-empty');
  const why = JSON.parse(await c.ev(vis('[data-testid=apply-why]'))); log('why', why); need(why.inView, '未入力: 理由が画面内に無い');
  const wbtn = JSON.parse(await c.ev(vis('#demo-go'))); log('demo-go', wbtn); need(wbtn.inView, '未入力: デモのボタンが画面内に無い');
  await c.ev(`document.getElementById('panel-body').scrollTop=300`); await c.ev('App.setStep(2)');
  need((await c.ev(`document.getElementById('panel-body').scrollTop`)) === 0, '段階を移ってもパネルが先頭に戻らない');
  await c.ev(`(()=>{const b=[...document.querySelectorAll('#s2 button')].find(x=>x.textContent.includes('自動'));b&&b.click()})()`);
  const selBefore = await c.ev('App.STATE.selected.size'); need(selBefore > 0, '自動選定で選べていない');
  await c.ev('App.setStep(3)'); await c.ev(`document.getElementById('demo-go').click()`); await sleep(1000);
  // デモはタブを移らずに完結: オンにしただけで、選んでいた区間の走査（架空）まで入る
  need((await c.ev(`!!document.querySelector('[data-testid=scan-done]')`)) === true, 'デモをオンにしても走査結果が入らない');
  log('demo s3', (await c.ev(`document.getElementById('s3').innerText`)).slice(0, 300)); await shot(c, lab + '-2-demo');
  need((await c.ev(`document.getElementById('s3').innerText`)).includes('過去の調査'), 'デモ中に「過去の調査」の説明が無い');
  need((await c.ev(`document.getElementById('panel-body').scrollTop`)) === 0, 'デモ切替後にパネルが先頭に戻らない');
  await c.ev(`document.getElementById('scan')&&document.getElementById('scan').click()`); await shot(c, lab + '-3-scanned');
  need((await c.ev(`!!document.querySelector('[data-testid=scan-done]') && !document.querySelector('[data-testid=scan-hint]')`)) === true, 'R5: 走査直後に成功の文が出ない／失敗のような文が残る');
  await c.ev(`document.getElementById('apply').click()`); await sleep(500); await shot(c, lab + '-4-round2');
  const r2 = await c.ev(`document.getElementById('round').textContent+' | '+App.STATE.msg`); log('round2', r2); need(r2.startsWith('第2回'), '第2回に進まない');
  need(r2.includes('架空'), '第2回の注記に「架空」が無い');
  // 流れ2: 見本 CSV → 較正
  for (const f of ['format_sample_by_segment.csv', 'format_sample_by_point.csv']) {
    await c.ev('App.setDemo(false)'); await sleep(300); await c.ev('App.STATE.round=1; App.STATE.w=0.1; App.setStep(3)'); await sleep(300);
    await setFile(c, '#csv-file', path.join(csvDir, f)); await sleep(800);
    log(f, await c.ev(`document.getElementById('load-msg').innerText`));
    const mv = JSON.parse(await c.ev(vis('#load-msg'))); need(mv.inView, f + ': 読み込みの結果が画面内に無い ' + JSON.stringify(mv));
    const ap = JSON.parse(await c.ev(vis('#apply'))); need(!ap.disabled, f + ': 見本だけでは較正に進めない');
    await shot(c, lab + '-5-' + f.slice(14, 20));
    await c.ev(`document.getElementById('apply').click()`); await sleep(400);
    const af = await c.ev(`document.getElementById('round').textContent+' | '+App.STATE.msg`); log('after', af); need(af.startsWith('第2回'), f + ': 第2回に進まない');
  }
  // R3: 第2回の帯と較正の文が、第1段階の固定バーに隠れない（見本 CSV で較正した直後）
  await c.ev('App.setStep(1)'); await sleep(300);
  const band = JSON.parse(await c.ev(`(()=>{const e=document.querySelector('[data-testid=round2-fake]'); const sb=document.querySelector('#s1 .stickybar'); if(!e) return JSON.stringify({none:true}); const r=e.getBoundingClientRect(); return JSON.stringify({bottom:r.bottom, lim: sb?sb.getBoundingClientRect().top:innerHeight})})()`));
  await shot(c, lab + '-7-r3'); log('r3 band', band); need(!band.none && band.bottom <= band.lim, 'R3: 第2回の帯が固定バーに隠れる');
  // R2: 結果を消したら、重み・回も初めに戻る
  await c.ev('App.setStep(3)'); await c.ev(`document.getElementById('clear-res').click()`); await sleep(300);
  need((await c.ev('App.STATE.round')) === 1 && (await c.ev('App.STATE.w')) === 0.1 && (await c.ev('App.STATE.results.size')) === 0, 'R2: 結果を消しても重み・回が残る');
  await c.ev('App.setStep(4)'); need((await c.ev(`document.getElementById('panel-body').scrollTop`)) === 0, '検証タブがパネル先頭から始まらない'); await shot(c, lab + '-6-verify');
  need((await c.ev('document.documentElement.scrollWidth')) <= w, '横スクロール');
  log('errs', c.errs); need(c.errs.length === 0, 'コンソールエラー');
  c.close();
}
console.log(bad ? `NG ${bad}` : 'OK');
process.exit(bad ? 1 : 0);
