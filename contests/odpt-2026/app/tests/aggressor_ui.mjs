// アグレッサー（2026-11-09）: 画面の失敗テスト。ヘッドレスChromeで複数のシナリオを実行し、JSONで結果を出す。
// usage: node tests/aggressor_ui.mjs <base_url> <out_dir>
//   例: (cd web && python3 -m http.server 8765) & node tests/aggressor_ui.mjs http://127.0.0.1:8765/ /tmp/shots
// 要: google-chrome, node 22+。unittest には含めない（ネットワークと Chrome が必要なため）。
// 各シナリオの "fail" に、審査で問題になりうる観察を入れる（空なら合格）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'aggr-'));
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
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, close };
}

async function setViewport(c, w, h) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
  if (w < 720) await c.send('Emulation.setTouchEmulationEnabled', { enabled: true });
}
async function load(c, url, waitReady = true) {
  const t0 = Date.now();
  await c.send('Page.navigate', { url });
  if (!waitReady) { await sleep(6000); return Date.now() - t0; }
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    if (await c.ev('!!(window.App && App.STATE.data && App.getMap() && App.getMap().loaded() && document.querySelector("#summary .big"))')) break;
  }
  return Date.now() - t0;
}
async function shot(c, name) {
  for (let i = 0; i < 30; i++) { if (await c.ev('!window.App || !App.getMap() || App.getMap().areTilesLoaded()')) break; await sleep(300); }
  await sleep(800);
  const s = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64'));
}

const results = {};
async function scenario(name, fn) {
  const c = await openChrome();
  const r = { fail: [], info: {} };
  try { await fn(c, r); } catch (e) { r.fail.push('例外: ' + e.message); }
  r.logs = c.logs.slice(0, 10);
  c.close();
  results[name] = r;
}

// A. デスクトップ初見: 何秒で結論の数字が出るか、最初の画面に何が見えるか
await scenario('desktop_first_view', async (c, r) => {
  await setViewport(c, 1366, 768);
  r.info.ms_to_summary = await load(c, base);
  r.info.headline = await c.ev('document.querySelector("#summary .big")?.innerText');
  r.info.region = await c.ev('App.STATE.data.name');
  r.info.summary_top = await c.ev('Math.round(document.querySelector("#summary").getBoundingClientRect().top)');
  r.info.summary_bottom = await c.ev('Math.round(document.querySelector("#summary").getBoundingClientRect().bottom)');
  r.info.whatif_top = await c.ev('Math.round(document.querySelector("#whatif").getBoundingClientRect().top)');
  r.info.mentions_unlisted_on_main = await c.ev('/JR|鉄道|未収録/.test(document.querySelector("#panel-body").innerText)');
  r.info.legend_cells = await c.ev('/到達できない|行けない/.test(document.querySelector("#legend").innerText)');
  // 2026-11-11: 初見ユーザー試験を受け、見出し直下のショートカット（#nav）から1タップで行けることを条件にした
  r.info.nav_whatif_top = await c.ev('Math.round(document.querySelector("#nav button[data-go=whatif]")?.getBoundingClientRect().top ?? 99999)');
  r.info.region_seg_top = await c.ev('Math.round(document.querySelector("#region-seg")?.getBoundingClientRect().top ?? 99999)');
  if (r.info.nav_whatif_top > 768) r.fail.push(`看板機能「路線を止めたら？」へのショートカットが初期画面の外（top=${r.info.nav_whatif_top}px, 画面高768）`);
  if (r.info.region_seg_top > 768) r.fail.push('地域選択ボタンが初期画面の外');
  if (!r.info.legend_cells) r.fail.push('地図の凡例に「メッシュの色（青/緑/赤）」の説明が無い（凡例は停留所の色のみ。メッシュ色はサマリーの帯でしか分からない）');
  await shot(c, 'A_desktop.png');
});

// B. スマホ（390x844）: 横はみ出し・タップ領域・結論の見え方
await scenario('mobile_390', async (c, r) => {
  await setViewport(c, 390, 844);
  r.info.ms_to_summary = await load(c, base);
  r.info.scrollW = await c.ev('document.documentElement.scrollWidth');
  r.info.panel_h = await c.ev('Math.round(document.querySelector("#panel").getBoundingClientRect().height)');
  r.info.summary_top_in_panel = await c.ev('(()=>{const hl=document.querySelector("#headline");const e=hl&&getComputedStyle(hl).display!=="none"&&hl.textContent.trim()?hl:document.querySelector("#summary");return Math.round(e.getBoundingClientRect().top)})()');   // 結論の固定表示（#headline）があればその位置
  r.info.small_targets = await c.ev(`[...document.querySelectorAll('#panel button, #panel select, #panel input, #panel label')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<32}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height)).slice(0,10)`);
  if (r.info.scrollW > 390) r.fail.push(`横スクロールが発生（scrollWidth=${r.info.scrollW}）`);
  if (r.info.summary_top_in_panel > 844) r.fail.push(`結論（到達率）がスマホ初期表示で見えない（top=${r.info.summary_top_in_panel}px）`);
  if (r.info.small_targets.length) r.fail.push('高さ32px未満の操作要素: ' + r.info.small_targets.join(', '));
  await shot(c, 'B_mobile.png');
  // 出典モーダルの表は横に収まるか
  await c.ev('document.getElementById("btn-about").click()');
  await sleep(400);
  r.info.modal_overflow = await c.ev('(()=>{const b=document.querySelector(".modal-box");return b.scrollWidth-b.clientWidth})()');
  if (r.info.modal_overflow > 4) r.fail.push(`出典表がスマホで横にはみ出す（${r.info.modal_overflow}px）`);
  await shot(c, 'B_mobile_about.png');
});

// C. 地点タップ（スマホ）: 富山の中心付近をタップして診断表と停留所が出るか
await scenario('mobile_tap_detail', async (c, r) => {
  await setViewport(c, 390, 844);
  await load(c, base + '#region=toyama');
  await c.ev('App.getMap().fire("click", {lngLat: {lng: 137.2137, lat: 36.7016}, point: {x:0,y:0}})');
  await sleep(1200);
  const full = await c.ev('document.getElementById("detail").innerText');
  r.info.detail = full?.slice(0, 400);
  r.info.detail_top = await c.ev('Math.round(document.getElementById("detail").getBoundingClientRect().top)');
  if (!/行けます|行けません/.test(r.info.detail || '')) r.fail.push('タップ後に結論の一言が出ない');
  if (!/停留所/.test(full || '')) r.fail.push('タップ後に停留所情報が出ない');
  await shot(c, 'C_mobile_tap.png');
});

// D. 「路線を止めたら？」: 上位路線を押して紫が出るか・ドロップダウンの重複表示
await scenario('whatif_toyama', async (c, r) => {
  await setViewport(c, 1366, 900);
  await load(c, base + '#region=toyama');
  for (let i = 0; i < 20; i++) { if (await c.ev('!!document.querySelector("#wi-top button")')) break; await sleep(300); }
  r.info.top_buttons = await c.ev('[...document.querySelectorAll("#wi-top button")].map(b=>b.innerText)');
  r.info.options = await c.ev('document.querySelectorAll("#wi-route option").length');
  r.info.dup_labels = await c.ev(`(()=>{const m={};[...document.querySelectorAll('#wi-route option')].forEach(o=>{const k=o.innerText.replace(/｜−[\\d,]+人$/,'');m[k]=(m[k]||0)+1});return Object.entries(m).filter(([k,v])=>v>1).slice(0,5)})()`);
  await c.ev('document.querySelector("#wi-top button")?.click()');
  await sleep(800);
  r.info.result = (await c.ev('document.getElementById("wi-result").innerText'))?.slice(0, 300);
  r.info.lost_cells = await c.ev('App.STATE.lost ? Object.keys(App.STATE.lost).length : 0');
  if (r.info.dup_labels.length) r.fail.push('路線の選択肢に同じ表示名が複数（区別できない）: ' + JSON.stringify(r.info.dup_labels));
  if (new Set(r.info.top_buttons).size < r.info.top_buttons.length) r.fail.push('「影響が大きい路線」ボタンに同名が並ぶ: ' + r.info.top_buttons.join(' / '));
  await shot(c, 'D_whatif.png');
});

// E. 地域を素早く切り替える（先に要求した熊本の応答が後から届く）: 表示とセレクトが食い違わないか
await scenario('region_switch_race', async (c, r) => {
  await setViewport(c, 1366, 768);
  await load(c, base + '#region=iida');
  await c.ev(`(()=>{const f=window.fetch;window.fetch=function(u){const p=f.apply(this,arguments);return /kumamoto\\.json$/.test(u)?p.then(x=>new Promise(res=>setTimeout(()=>res(x),1500))):p;};})()`);
  await c.ev('(()=>{const s=document.getElementById("region");s.value="kumamoto";s.dispatchEvent(new Event("change"));setTimeout(()=>{s.value="tokushima";s.dispatchEvent(new Event("change"));},100)})()');
  await sleep(3500);
  r.info.select = await c.ev('document.getElementById("region").value');
  r.info.shown = await c.ev('App.STATE.data.id');
  r.info.hash = await c.ev('location.hash');
  if (r.info.select !== r.info.shown) r.fail.push(`セレクトは ${r.info.select} なのに表示データは ${r.info.shown}（後着の応答で上書き）`);
});

// F. 操作の重さ（CPU 4倍遅延=中級スマホ相当の目安）: 条件ボタン1回あたりの再計算時間
await scenario('refresh_cost_kumamoto', async (c, r) => {
  await setViewport(c, 390, 844);
  await load(c, base + '#region=kumamoto');
  for (let i = 0; i < 20; i++) { if (await c.ev('!!document.querySelector("#wi-route")')) break; await sleep(300); }
  await c.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  r.info.refresh_ms = await c.ev('(()=>{const t=performance.now();for(let i=0;i<3;i++)App.refresh();return Math.round((performance.now()-t)/3)})()');
  await c.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (r.info.refresh_ms > 300) r.fail.push(`条件を1回切り替えるごとに約${r.info.refresh_ms}ms（CPU 4倍遅延）。全路線の影響を毎回再集計している`);
});

// G. CDN（unpkg）が落ちた／ブロックされた場合
await scenario('cdn_blocked', async (c, r) => {
  await setViewport(c, 1366, 768);
  await c.send('Network.setBlockedURLs', { urls: ['*unpkg.com*'] });
  await load(c, base, false);
  r.info.summary = await c.ev('document.getElementById("summary").innerText');
  r.info.region_options = await c.ev('document.getElementById("region").options.length');
  if (!/読み込め|表示できません|失敗/.test(r.info.summary || '')) r.fail.push('MapLibre が読めないと画面が無言で空になる（エラー表示なし）。会場・自治体ネットワークでCDN遮断時に何も出ない');
  await shot(c, 'G_cdn_blocked.png');
});

// H. 地理院タイルが読めない場合（データ自体は出るか）
await scenario('tiles_blocked', async (c, r) => {
  await setViewport(c, 1366, 768);
  await c.send('Network.setBlockedURLs', { urls: ['*cyberjapandata.gsi.go.jp*'] });
  r.info.ms = await load(c, base);
  r.info.headline = await c.ev('document.querySelector("#summary .big")?.innerText');
  if (!r.info.headline) r.fail.push('背景地図が読めないと診断も出ない');
});

// I. 不正な hash / 存在しない地域
await scenario('bad_hash', async (c, r) => {
  await setViewport(c, 1366, 768);
  await load(c, base + '#region=<script>');
  r.info.shown = await c.ev('App.STATE.data && App.STATE.data.id');
  if (!r.info.shown) r.fail.push('不正な hash で何も表示されない');
});

// J. 横向きスマホ（844x390）: パネル56vhで地図がほぼ見えないか
await scenario('mobile_landscape', async (c, r) => {
  await setViewport(c, 844, 390);
  await load(c, base);
  r.info.panel = await c.ev('(()=>{const b=document.querySelector("#panel").getBoundingClientRect();return [Math.round(b.width),Math.round(b.height)]})()');
  await shot(c, 'J_landscape.png');
});

// K. 共有リンク: 条件・路線・地点がハッシュで復元され、地点クリックで結論の一言とポップアップが出る
await scenario('share_link_and_verdict', async (c, r) => {
  await setViewport(c, 1366, 768);
  await load(c, base + '#region=toyama&f=0&d=hol&p=e&w=45&pt=137.21370,36.70160');
  for (let i = 0; i < 20; i++) { if (await c.ev('!!document.querySelector("#wi-top button")')) break; await sleep(300); }
  r.info.state = await c.ev('JSON.stringify({d:App.STATE.day,p:App.STATE.per,w:App.STATE.w,pt:App.STATE.pt})');
  r.info.verdict = await c.ev('document.querySelector("#detail .v-main")?.innerText');
  r.info.popup = await c.ev('document.querySelector(".maplibregl-popup-content")?.innerText');
  if (!/"d":"hol","p":"e","w":45/.test(r.info.state)) r.fail.push('ハッシュの条件が復元されない: ' + r.info.state);
  if (!r.info.verdict) r.fail.push('復元した地点の結論の一言が出ない');
  if (!r.info.popup) r.fail.push('地図上のポップアップが出ない');
  await c.ev('document.querySelector("#wi-top button")?.click()');
  await sleep(500);
  r.info.hash = await c.ev('location.hash');
  if (!/&r=\d+/.test(r.info.hash) || !/pt=/.test(r.info.hash)) r.fail.push('路線・地点がハッシュに入らない: ' + r.info.hash);
  r.info.pressed = await c.ev('!!document.querySelector("#wi-top button[aria-pressed=true]")');
  if (!r.info.pressed) r.fail.push('選択した路線ボタンの選択状態が分からない');
  await shot(c, 'K_share.png');
});

// L. 開始地域（ハッシュなし）で地図の初期位置と地域の表示が一致する
await scenario('initial_region_matches_map', async (c, r) => {
  await setViewport(c, 1366, 768);
  await load(c, base);
  await sleep(1500);
  r.info.now = await c.ev('document.getElementById("region-now").textContent');
  r.info.center = await c.ev('JSON.stringify(App.getMap().getCenter())');
  r.info.bbox = await c.ev('JSON.stringify(App.STATE.data.bbox)');
  const ctr = JSON.parse(r.info.center), bb = JSON.parse(r.info.bbox);
  if (ctr.lng < bb[0] || ctr.lng > bb[2] || ctr.lat < bb[1] || ctr.lat > bb[3]) r.fail.push('地図の中心が開始地域の範囲外');
  if (!r.info.now) r.fail.push('いまの地域名が表示されない');
  r.info.seg = await c.ev('document.querySelectorAll("#region-seg button").length');
  if (r.info.seg !== 5) r.fail.push('地域ボタンが5つ並んでいない');
});

// M. 地域比較と住所検索（国土地理院APIは fetch を差し替えて応答を模擬。実APIには送らない）
await scenario('compare_and_search', async (c, r) => {
  await setViewport(c, 1366, 768);
  await load(c, base + '#region=kumamoto');
  await c.ev('document.getElementById("btn-compare").click()');
  for (let i = 0; i < 30; i++) { if (await c.ev('document.querySelectorAll("#compare-result tr").length>5')) break; await sleep(300); }
  r.info.rows = await c.ev('document.querySelectorAll("#compare-result tr").length');
  r.info.note = await c.ev('/収録/.test(document.getElementById("compare-result").innerText) && /東京/.test(document.getElementById("compare-result").innerText)');
  if (r.info.rows !== 6) r.fail.push('比較表が6行（見出し+5地域）にならない: ' + r.info.rows);
  if (!r.info.note) r.fail.push('比較の注意書きが無い');
  await c.ev(`(()=>{const f=window.fetch;window.fetch=function(u){if(/msearch\\.gsi\\.go\\.jp/.test(u)){window.__gsi=u;return Promise.resolve(new Response(JSON.stringify([{geometry:{coordinates:[137.2137,36.7016]},properties:{title:'富山駅'}}]),{status:200}));}return f.apply(this,arguments);};})()`);
  await c.ev('document.getElementById("search-q").value="富山駅";document.getElementById("search-btn").click()');
  for (let i = 0; i < 30; i++) { if (await c.ev('App.STATE.data.id==="toyama" && !!document.querySelector("#detail .v-main")')) break; await sleep(300); }
  r.info.region = await c.ev('App.STATE.data.id');
  r.info.gsi = await c.ev('window.__gsi');
  r.info.verdict = await c.ev('document.querySelector("#detail .v-main")?.innerText');
  if (r.info.region !== 'toyama' || !r.info.verdict) r.fail.push('検索で地域が自動切替され地点の診断が出る流れが動かない');
  await c.ev(`(()=>{const f=window.fetch;window.fetch=function(u){if(/msearch\\.gsi/.test(u))return Promise.resolve(new Response(JSON.stringify([{geometry:{coordinates:[139.9,43.0]},properties:{title:'札幌'}}]),{status:200}));return f.apply(this,arguments);};})()`);
  await c.ev('document.getElementById("search-q").value="札幌";document.getElementById("search-btn").click()');
  await sleep(800);
  r.info.outside = await c.ev('document.getElementById("search-result").innerText');
  if (!/範囲外/.test(r.info.outside || '')) r.fail.push('範囲外の検索結果で範囲外と表示されない');
});

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(0);
