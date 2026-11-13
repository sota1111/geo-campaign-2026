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
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'an-'));
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
  await c.send('Page.navigate', { url: 'about:blank' });
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
const popOut = (c) => c.ev('App.S.cov.popOut');

async function scenario(w, h, tag) {
  const c = await openChrome();
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
  await load(c, base + '#m=machida&d=0&t=180&r=500&mode=strict');
  check(`${tag} 起動して4自治体のボタン`, await c.ev('document.querySelectorAll("#ctl-muni button").length') === 4);
  check(`${tag} 町田市・平日3時: 使えるAEDは確認できた分だけ(14台)`, await c.ev('App.S.cov.usable.length') === 14);
  check(`${tag} 圏外メッシュが描画されている`, await c.ev('App.getMap().queryRenderedFeatures({layers:["cells-fill"]}).length') > 0);
  check(`${tag} 見出しに圏外の人数と割合`, /約[\d,]+人（\d+(\.\d)?%）/.test(await c.ev('document.getElementById("headline").textContent')));
  check(`${tag} 空白の意味（民間の24時間AEDは載らない）を常時表示`, (await c.ev('document.querySelector(".notice.warn").textContent')).includes('民間の24時間AED'));
  await c.shot(`${tag}-1-night.png`);
  const night = await popOut(c);

  await click(c, '#presets button:nth-child(2)'); // 平日14時
  await sleep(800);
  const day = await popOut(c);
  check(`${tag} 14時は3時より圏外が少ない`, day < night, `3時=${night} 14時=${day}`);
  check(`${tag} プリセットがハッシュに反映`, (await c.ev('location.hash')).includes('t=840'));
  await c.shot(`${tag}-2-day.png`);

  await click(c, '#ctl-r button[data-id="300"]'); await sleep(600);
  check(`${tag} 半径300mは500mより圏外が多い`, await popOut(c) > day);
  await click(c, '#ctl-mode button[data-id="max"]'); await sleep(600);
  check(`${tag} 不明も使える(最大見積)は圏外が増えない`, await popOut(c) <= await c.ev('App.S.covOther.popOut'));
  await click(c, '#ctl-mode button[data-id="strict"]'); await click(c, '#ctl-r button[data-id="500"]');
  await c.ev('App.set(0, 180, 500, "strict")'); await sleep(500);

  // 地図クリックで「1台足すと」
  const pt = await c.ev('(function(){var m=App.getMap();var f=m.queryRenderedFeatures({layers:["cells-fill"]}).filter(function(x){return x.properties.g===1})[0];if(!f)return null;var c=f.geometry.coordinates[0][0];var p=m.project([c[0]+0.0006,c[1]+0.0006]);return {x:p.x,y:p.y}})()');
  check(`${tag} 圏外メッシュの座標取得`, pt && pt.x > 0);
  await c.ev('App.showGain(35.55, 139.44)');
  check(`${tag} 1台足すと の試算が出る`, (await c.ev('document.getElementById("gain-card").textContent')).includes('新たに徒歩圏'));

  await click(c, '#tab-area'); await sleep(300);
  check(`${tag} 地区別一覧が出る`, await c.ev('document.querySelectorAll("#area-list li").length') > 3);
  await c.shot(`${tag}-3-area.png`);
  await click(c, '#tab-out'); await sleep(800);
  check(`${tag} 設置先候補が10件`, await c.ev('document.querySelectorAll("#cand-list li").length') === 10);
  await c.shot(`${tag}-4-cand.png`);
  await click(c, '#tab-data'); await sleep(300);
  check(`${tag} データ一覧に4自治体と時間表記の割合`, await c.ev('document.querySelectorAll("#data-table table tr").length') === 5);
  check(`${tag} 出典にライセンス表記`, (await c.ev('document.getElementById("credits").textContent')).includes('CC BY'));

  await click(c, '#tab-map');
  await click(c, '#ctl-muni button[data-id="fukuoka"]'); await sleep(2500);
  check(`${tag} 福岡市に切替`, await c.ev('App.S.data.munis[App.S.mi].id') === 'fukuoka' && (await c.ev('location.hash')).includes('m=fukuoka'));
  check(`${tag} 福岡市のメッシュが描画`, await c.ev('App.getMap().queryRenderedFeatures({layers:["cells-fill"]}).length') > 0);
  await c.shot(`${tag}-5-fukuoka.png`);

  await load(c, base + '#m=ibara&d=6&t=1320&r=800&mode=max');
  check(`${tag} ハッシュから状態復元`, await c.ev('App.S.data.munis[App.S.mi].id') === 'ibara' && await c.ev('App.S.view.d') === 6 && await c.ev('App.S.view.r') === 800 && await c.ev('App.S.view.mode') === 'max');

  check(`${tag} コンソールエラーなし`, c.logs.length === 0, c.logs.join(' | '));
  c.close();
}

await scenario(1280, 800, 'desktop');
await scenario(390, 844, 'mobile');
fs.writeFileSync(path.join(outDir, 'ui_check_result.json'), JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok);
console.log(`${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
