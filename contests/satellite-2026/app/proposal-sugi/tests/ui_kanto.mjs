// 関東全域マップの画面確認（ヘッドレスChrome + CDP）。node --test には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8823 --bind 127.0.0.1 &) ; node tests/ui_kanto.mjs http://127.0.0.1:8823/ <出力ディレクトリ>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'kg-'));
  const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  return { send, ev, logs, close: () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } } };
}
async function shot(c, name) { await sleep(900); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); }

const report = {};
for (const [label, w, h] of [['desktop', 1513, 784], ['mobile', 390, 844]]) {
  const c = await openChrome(); const r = { fail: [], info: {} };
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
    await c.send('Page.navigate', { url: base });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('document.body.dataset.mapReady === "1"')) break; }
    if (!(await c.ev('document.body.dataset.mapReady === "1"'))) r.fail.push('地図が初期化されない');
    await sleep(2500);
    r.info.map = await c.ev('(()=>{const m=document.getElementById("map").getBoundingClientRect();return {w:Math.round(m.width),h:Math.round(m.height),ratioW:+(m.width/innerWidth).toFixed(2),ratioH:+(m.height/innerHeight).toFixed(2)}})()');
    const want = w >= 900 ? r.info.map.ratioW : r.info.map.ratioH;
    if (want < 0.6 || want > 0.7) r.fail.push('地図の割合が6〜7割でない: ' + want);
    const sw = await c.ev('Math.max(document.documentElement.scrollWidth, document.getElementById("panel-body").scrollWidth)');
    if (sw > w) r.fail.push('横スクロール ' + sw);
    await shot(c, `${label}_1_overview.png`);
    // 凡例（パネル）を見せる
    await c.ev('document.getElementById("panel-body").scrollTop=0');
    await shot(c, `${label}_2_legend.png`);
    // 地図の実クリック: 区分1のメッシュを中央へ寄せてクリック
    const pick = await c.ev(`(()=>{const S=window.__kanto,m=window.__kantoMap;const want=${JSON.stringify([1, 3, 4, 2])};const res={};
      const D=window.SUGI_KANTO;for(const k of want){for(let i=0;i<S.cls.length;i++){if(S.cls[i]===k&&D.cells.n[i]*0.04>=12){res[k]=i;break}}}return res})()`);
    r.info.pick = pick;
    const tx = w >= 900 ? 500 : 195, ty = w >= 900 ? 380 : 230;
    for (const k of [1, 3, 4]) {
      if (pick[k] == null) { r.fail.push('区分' + k + 'のメッシュが無い'); continue; }
      await c.ev(`(()=>{const D=window.SUGI_KANTO,m=window.__kantoMap,i=${pick[k]};const lon=(D.cells.ix[i]+.5)/160,lat=(D.cells.iy[i]+.5)/240;m.jumpTo({center:[lon,lat],zoom:11.5});const p=m.project([lon,lat]);m.panBy([p.x-${tx},p.y-${ty}],{animate:false});})()`);
      await sleep(1500);
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
      await sleep(600);
      const got = await c.ev('window.__kanto.sel');
      if (got !== pick[k]) r.fail.push('地図クリックで選択されない 区分' + k + ' want ' + pick[k] + ' got ' + got);
      if (k === 1 || k === 3) await shot(c, `${label}_3_click_class${k}.png`);
    }
    r.info.selHtml = (await c.ev('document.getElementById("sel-body").innerText')).slice(0, 300);
    // 仮の基準を動かす: 傾斜しきい値を下げると区分3が増える
    const before = await c.ev('Math.round(window.__kanto.sum.tot[3])');
    await c.ev('(()=>{const e=document.getElementById("p-slope");e.value=18;e.dispatchEvent(new Event("input"))})()');
    await sleep(800);
    const after = await c.ev('Math.round(window.__kanto.sum.tot[3])');
    r.info.slope = { before, after };
    if (!(after > before)) r.fail.push('傾斜しきい値を下げても区分3が増えない');
    await c.ev('document.getElementById("p-reset").click()');
    // 市町村一覧から移動
    await c.ev('(()=>{const e=document.getElementById("f-q");e.value="青梅";e.dispatchEvent(new Event("input"))})()');
    await sleep(300);
    await c.ev('document.querySelector("#places-body tr[data-m]").click()');
    await sleep(1800);
    r.info.muniSel = await c.ev('window.__kanto.muni');
    await shot(c, `${label}_4_muni.png`);
    // 下の方（面積・検証）
    await c.ev('document.getElementById("totals").scrollIntoView()');
    await shot(c, `${label}_5_totals.png`);
    await c.ev('document.getElementById("verify").scrollIntoView()');
    await shot(c, `${label}_6_verify.png`);
    r.info.errors = c.logs.slice(0, 5);
    if (c.logs.length) r.fail.push('コンソールエラー ' + c.logs.length);
  } catch (e) { r.fail.push('例外 ' + e.message); } finally { c.close(); }
  report[label] = r;
}
console.log(JSON.stringify(report, null, 1));
process.exit(Object.values(report).some((r) => r.fail.length) ? 1 : 0);
