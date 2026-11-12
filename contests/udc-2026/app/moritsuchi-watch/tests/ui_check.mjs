// 画面の通し確認。usage: node tests/ui_check.mjs <base_url> <out_dir>
// 要: google-chrome, node 22+, ネットワーク（CDN と地理院タイル）。コンソールエラーがあれば exit 1。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-'));
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
    // 地理院タイルは範囲外（海上など）で 404 を返すのは仕様。アプリのエラーではないので除外する
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/cyberjapandata\.gsi\.go\.jp\/xyz\/.*404|404.*cyberjapandata/.test(d.params.entry.text + ' ' + (d.params.entry.url || ''))) logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, 'base64'));
  };
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, shot, close };
}

async function load(c, url) {
  await c.send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    if (await c.ev('!!(window.App && App.ready && App.getMap().loaded())')) break;
  }
  await sleep(2500); // タイル描画待ち
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' ' + detail : '')); };
const click = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

async function scenario(w, h, tag) {
  const c = await openChrome();
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
  await load(c, base + '#z=14&lat=35.1054&lng=139.0600&base=std&old=none&op=60');
  check(`${tag} 起動と盛土データ27件`, await c.ev('document.getElementById("n-fills").textContent') === '27');
  check(`${tag} 盛土ポリゴンが描画されている`, await c.ev('App.getMap().queryRenderedFeatures({layers:["fills-fill"]}).length') > 0);
  await c.shot(`${tag}-1-look.png`);

  // 昔の写真で見比べ
  await click(c, '#ctl-old button[data-id="gazo1"]');
  await sleep(2500);
  check(`${tag} 昔の写真が有効でハッシュに反映`, (await c.ev('location.hash')).includes('old=gazo1'));
  await c.ev('(function(){var o=document.getElementById("op");o.value=50;o.dispatchEvent(new Event("input"))})()');
  await sleep(1500);
  await c.shot(`${tag}-2-old.png`);

  // 盛土をタップして情報
  const pt = await c.ev('(function(){var m=App.getMap();var f=m.queryRenderedFeatures({layers:["fills-fill"]})[0];if(!f)return null;var c=f.geometry.coordinates[0][0];var p=m.project(c);return {x:p.x+4,y:p.y+4,id:f.properties.id}})()');
  check(`${tag} 盛土ポリゴンの座標取得`, pt && pt.id);

  // 記録フロー
  await click(c, '#tab-rec');
  await c.ev('App.setPick(139.0573, 35.1054)');
  check(`${tag} 位置を選ぶと保存ボタンが有効`, await c.ev('!document.getElementById("btn-save").disabled'));
  check(`${tag} 最寄り盛土の案内が出る`, (await c.ev('document.getElementById("pick-hint").textContent')).includes('熱海市'));
  await c.ev('(function(){document.getElementById("f-kind").value="water";document.getElementById("f-memo").value="のり面から水がしみ出している";})()');
  await c.shot(`${tag}-3-rec.png`);
  await c.ev('document.getElementById("btn-save").click()');
  await sleep(500);
  check(`${tag} 保存されlocalStorageに1件`, await c.ev('JSON.parse(localStorage.getItem("mw.records.v1")).length') === 1);
  await click(c, '#tab-out');
  check(`${tag} 一覧に1件`, await c.ev('document.querySelectorAll("#rec-list li").length') === 1);
  await c.ev('document.querySelector("#rec-list .acts button").click()');
  await sleep(700);
  const rep = await c.ev('document.getElementById("report-text").value');
  check(`${tag} 通報文に位置・内容・注意`, rep.includes('35.1054,139.0573') && rep.includes('湧水') && rep.includes('直ちに危険'));
  await c.shot(`${tag}-4-out.png`);

  // 範囲外の記録
  await click(c, '#tab-rec');
  await c.ev('App.setPick(139.76, 35.68)');
  check(`${tag} 範囲外の警告`, (await c.ev('document.getElementById("pick-hint").textContent')).includes('対象範囲'));

  // 再読込で永続
  await load(c, base);
  check(`${tag} 再読込後も記録が残る`, await c.ev('JSON.parse(localStorage.getItem("mw.records.v1")).length') === 1 && await c.ev('App.S.records.length') === 1);
  // ハッシュ復元
  await load(c, base + '#z=15&lat=35.0&lng=139.1&base=photo&old=ort_old10&op=30');
  check(`${tag} ハッシュから状態復元`, await c.ev('App.S.view.base') === 'photo' && await c.ev('App.S.view.old') === 'ort_old10' && await c.ev('Math.round(App.getMap().getZoom())') === 15);
  await c.shot(`${tag}-5-photo-old.png`);

  check(`${tag} コンソールエラーなし`, c.logs.length === 0, c.logs.join(' | '));
  c.close();
}

await scenario(1280, 800, 'desktop');
await scenario(390, 844, 'mobile');
fs.writeFileSync(path.join(outDir, 'ui_check_result.json'), JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
