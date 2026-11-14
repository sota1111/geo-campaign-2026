// アグレッサーの失敗テスト（画面）: 悪用・入力の境界・スマホ表示。既存の ui_check.mjs とは別。
// usage: node reports/aggressor/ichibiz-2026-solar-guard-tests/aggressor_ui.mjs <base_url>   （要 google-chrome、サーバー起動後）
// 置き場所: 交戦規定の hook により solar-guard/tests/ へは書けないため reports/aggressor/ に置く。工兵が tests/ へ移してよい。
// 既定では見つけた弱点を表示して終了コード0。AGGRESSOR_STRICT=1 のとき弱点があれば終了コード1。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base] = process.argv.slice(2);
const STRICT = process.env.AGGRESSOR_STRICT === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-'));
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
  let id = 0; const pending = new Map(); const logs = []; const reqs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0]);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' ').slice(0, 200));
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
    if (d.method === 'Network.requestWillBeSent') reqs.push({ url: d.params.request.url, method: d.params.request.method, post: d.params.request.postData || null });
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
  const close = () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* ignore */ } };
  return { send, ev, logs, reqs, close };
}

const findings = [];
const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
const tileReqs = (reqs) => reqs.map((r) => r.url.match(/cyberjapandata\.gsi\.go\.jp\/xyz\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.png/)).filter(Boolean).map((m) => ({ z: +m[1], x: +m[2], y: +m[3] }));
// 取得したタイル群の中心から、入力点までの距離（km）を推定する（タイル要求を見られる第三者の推定）
function estimate(tiles, lat, lon) {
  if (!tiles.length) return null;
  const zmax = Math.max(...tiles.map((t) => t.z));
  const ts = tiles.filter((t) => t.z === zmax);
  const cx = ts.reduce((a, t) => a + t.x + 0.5, 0) / ts.length, cy = ts.reduce((a, t) => a + t.y + 0.5, 0) / ts.length;
  const elon = cx / 2 ** zmax * 360 - 180;
  const n = Math.PI - 2 * Math.PI * cy / 2 ** zmax, elat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  const dkm = Math.hypot((elon - lon) * 90.2, (elat - lat) * 111);
  const containing = ts.some((t) => t.x === Math.floor(lon2x(lon, zmax)) && t.y === Math.floor(lat2y(lat, zmax)));
  return { zmax, n: ts.length, dkm: Math.round(dkm * 10) / 10, containing };
}

async function open(c, w, h, mobile) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await c.send('Page.navigate', { url: base });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('!!(window.SgApp && SgApp.STATE.sc && SgApp.STATE.sc.length && SgApp.mapReady())')) break; }
}
const setXY = (c, lat, lon) => c.ev(`document.getElementById("tab-diag").click();document.getElementById("in-lat").value=${JSON.stringify(lat)};document.getElementById("in-lon").value=${JSON.stringify(lon)};document.getElementById("btn-set").click();document.getElementById("pos-msg").innerText`);

// A. 座標入力（地図を拡大していない利用者）: flyTo で入力点が地図の中心になり、タイル要求から位置が推定できるか
{
  const c = await openChrome();
  await open(c, 1360, 860, false);
  const ready = await c.ev('SgApp.mapReady()');
  if (!ready) console.log('A: 地図が使えない環境のため省略');
  else {
    const LAT = 36.2913, LON = 140.1517; // 県西の農地（例）
    c.reqs.length = 0;
    await setXY(c, String(LAT), String(LON));
    await sleep(4000);
    const e = estimate(tileReqs(c.reqs), LAT, LON);
    console.log('A: 座標入力後のタイル要求', JSON.stringify(e));
    if (e && e.containing && e.zmax >= 10) findings.push(`A[軽微] 座標を入力しただけで、入力点を含む z${e.zmax} のタイル（一辺 約${Math.round(40075 * Math.cos(LAT * Math.PI / 180) / 2 ** e.zmax)}km）を中心に${e.n}枚を地理院に要求し、要求群の中心から入力点が約${e.dkm}kmで推定できる（flyTo で入力点が地図の中心になるため。画面の「座標を入力して使えば、地図を拡大せずに診断できます」は位置が外に出ないことまでは意味しない）`);
    // A2. 座標入力後に「＋」で拡大する利用者
    // 入力後、利用者がマーカーを確かめようと「＋」で拡大する（地図の中心＝入力点のまま拡大される）
    c.reqs.length = 0;
    for (let i = 0; i < 5; i++) { await c.ev('document.querySelector(".maplibregl-ctrl-zoom-in").click()'); await sleep(600); }
    await sleep(4000);
    const e2 = estimate(tileReqs(c.reqs), LAT, LON);
    console.log('A2: 座標入力後に拡大', JSON.stringify(e2));
    if (e2 && e2.zmax >= 13 && e2.containing) findings.push(`A2[重要] 座標を入れた後に「＋」で拡大するだけで、入力点を含む z${e2.zmax} のタイル（一辺 約${Math.round(40075 * Math.cos(LAT * Math.PI / 180) / 2 ** e2.zmax * 1000)}m）を地理院に要求する（中心の推定誤差 約${e2.dkm}km）。flyTo で入力点が地図の中心になるので、ふつうの拡大操作で発電所の位置が数百m単位で外に出る`);
  }
  c.close();
}

// B. 範囲・入力の境界（地図なしでも検査できる）
{
  const c = await openChrome();
  await open(c, 1360, 860, false);
  const cases = [
    { lat: '36.00', lon: '140.85', name: '鹿島灘の海上', expectReject: true },
    { lat: '35.75', lon: '140.00', name: '千葉県（印西市付近）', expectReject: true },
    { lat: '36.95', lon: '139.70', name: '栃木県（日光市付近）', expectReject: true },
    { lat: '36,34', lon: '140,45', name: '小数点にカンマ（36,34 / 140,45）', expectReject: true },
    { lat: '36.34abc', lon: '140.45', name: '数字の後に文字', expectReject: true },
    { lat: '３６．３４', lon: '１４０．４５', name: '全角数字', expectAccept: true },
  ];
  for (const k of cases) {
    await c.ev('document.getElementById("btn-reset").click()');
    const msg = await setXY(c, k.lat, k.lon);
    const res = await c.ev('document.getElementById("diag-result").innerText');
    const accepted = !/範囲の外|数字で/.test(msg) && res.includes('周囲の目安');
    console.log('B:', k.name, accepted ? '受理' : '拒否', '|', msg.slice(0, 40), '|', (res.match(/位置は(\d+)/) || [])[0] || '');
    if (k.expectReject && accepted) findings.push(`B[${/海上|千葉|栃木/.test(k.name) ? '重要' : '軽微'}] ${k.name} を受理して診断を出す（${(res.match(/位置は\S+/) || [''])[0]}、「人が少ない側（上位2割）」=${res.includes('上位2割')}）。画面は「茨城県内のみ」と案内`);
    if (k.expectAccept && !accepted) findings.push(`B[軽微] ${k.name} を受け付けない（日本語入力の利用者は全角で入れやすい）`);
  }
  // quietPos が 0〜100 を超えないこと
  const qp = await c.ev(`(function(){var r=Sg.diagnose({lon:140.85,lat:36.0,cls:'unknown',answers:{}},{cells:SgApp.STATE.cells,pops:SgApp.STATE.pops,items:SgApp.STATE.items,weights:SgApp.STATE.weights});return r.quietPos;})()`);
  console.log('B: 人口0のメッシュの quietPos', qp);
  if (qp > 100) findings.push(`B[軽微] 人口0のメッシュで「人の少なさの位置」が ${qp.toFixed(2)}（0〜100の範囲外。画面では丸めて100と表示）`);

  // C. 「順位は出さない」の検査: ポップアップ・CSV にメッシュ単位の連続値（順位に直せる値）があるか
  const csv = await c.ev('SgApp.buildCsvRows()');
  const hdr = csv.find((r) => r[0] === '南西角の基準メッシュコード');
  const hasScore = hdr && hdr.includes('目安スコア');
  const meshRows = csv.filter((r) => /^\d{8}$/.test(String(r[0])));
  const scores = meshRows.map((r) => r[hdr.indexOf('目安スコア')]).filter((v) => v !== '');
  console.log('C: CSV メッシュ行', meshRows.length, '目安スコア列', hasScore, '異なる値', new Set(scores).size);
  if (hasScore && new Set(scores).size > 20) findings.push(`C[重要] CSV にメッシュ別の「目安スコア」（整数、${new Set(scores).size}種類）と3指標の位置0〜100が出ており、並べ替えればメッシュの順位表になる。README・画面の「順位は出さない」「色は五分位の5段階」と矛盾`);
  const parts = await c.ev('new Set(SgApp.STATE.sc.map(function(c){return Math.round(c.parts.kw)})).size');
  if (parts > 50) findings.push(`C[重要] 地図のポップアップに各メッシュの「指標の位置（0〜100）」が出る（容量の位置は${parts}種類）。位置×(235-1)/100 で県内順位がそのまま復元できる`);
  c.close();
}

// D. スマホ幅: 地図の高さ、位置入力から結果までの距離
{
  const c = await openChrome();
  await open(c, 390, 800, true);
  const m = await c.ev(`(function(){document.getElementById("tab-diag").click();var r=document.getElementById("map").getBoundingClientRect();var a=document.getElementById("btn-set").getBoundingClientRect().top+scrollY, b=document.getElementById("diag-result").getBoundingClientRect().top+scrollY;return {mapH:Math.round(r.height), gap:Math.round(b-a), docH:document.documentElement.scrollHeight};})()`);
  console.log('D: スマホ', JSON.stringify(m));
  if (m.mapH < 250) findings.push(`D[軽微] スマホ幅で地図の高さが${m.mapH}px。地図クリックで自分の発電所を指すには小さい`);
  if (m.gap > 2400) findings.push(`D[軽微] スマホ幅で「この座標で診断」ボタンから結果欄まで約${m.gap}px（チェックリスト全項目の下）。座標を入れても結果が画面外で、変化に気づきにくい`);
  c.close();
}

console.log(findings.length ? 'FINDINGS\n' + findings.join('\n') : 'aggressor_ui: 弱点なし');
process.exit(STRICT && findings.length ? 1 : 0);
