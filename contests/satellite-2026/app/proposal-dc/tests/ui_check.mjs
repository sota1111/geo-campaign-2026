// usage: node tests/ui_check.mjs <base_url> <out_dir>   （要: google-chrome、node 22+、静的サーバー起動済み）
// 1513x784 と 390x844 で、候補地の選択・地図のクリック・層の切り替え・データの表示を実際に操作して確かめ、スクリーンショットを残す。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 空いている番号を OS に選ばせる（他の検査の Chrome と取り違えないように）
const port = await new Promise((r) => { const srv = net.createServer(); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => r(p)); }); });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-'));
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const cargs = ['--headless=new', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`];
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
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + JSON.stringify(d.params.args.map((a) => a.value || a.description)));
  // 背景タイル（外部）の取得失敗はネットワーク環境の問題として数えない
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/cyberjapandata\.gsi\.go\.jp/.test(d.params.entry.url || '') && !/Failed to load resource/.test(d.params.entry.text || '')) logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const shot = async (name) => { await sleep(700); const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); };
let fails = 0;
const ok = (name, cond) => { if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name); };

for (const [label, w, h, mobile] of [['desktop', 1513, 784, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: base }); await sleep(4500);
  console.log('--', label);
  ok(label + ': 起動時にエラーなし', logs.length === 0); if (logs.length) console.log(logs.splice(0));
  ok(label + ': 地図のキャンバスがあり、地図が使える状態', await ev(`(async()=>{for(let i=0;i<40&&!DCApp.state.mapReady;i++)await new Promise(r=>setTimeout(r,200));return !!document.querySelector('#map canvas')&&DCApp.state.mapReady})()`));
  ok(label + ': 地図が画面の6〜7割（デスクトップは幅、スマホは高さ）', await ev(`(()=>{const r=document.querySelector('#map').getBoundingClientRect();return ${mobile} ? (r.height/innerHeight>=0.5 && r.height/innerHeight<=0.7 && r.width/innerWidth>0.95) : (r.width/innerWidth>=0.60 && r.width/innerWidth<=0.70 && r.height/innerHeight>=0.8)})()`));
  if (!mobile) ok(label + ': 縦スクロールなし（ページ全体）', await ev(`document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight`));
  else ok(label + ': スマホは縦に積む（地図の下に一覧がある）', await ev(`document.querySelector('.side').getBoundingClientRect().top >= document.querySelector('#map').getBoundingClientRect().bottom - 2`));
  ok(label + ': 横スクロールなし', await ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  ok(label + ': 確認項目が8つあり、どれにも出典リンクがある', await ev(`(()=>{const r=document.querySelectorAll('#rows .row');return r.length===8&&[...r].every(x=>x.querySelector('.src a'))})()`));
  ok(label + ': 項目に 浸水・土砂・津波・高潮・沈下・地表面温度・変電所・土地の状態', await ev(`(()=>{const t=document.querySelector('#rows').textContent;return ['洪水','土砂','津波','高潮','地盤の変動','地表面温度','変電所','土地の状態'].every(k=>t.includes(k))})()`));
  ok(label + ': 「最適地」「適地」の語が画面にない・点数や順位の表がない', await ev(`(()=>{const t=document.body.innerText;return !/適地/.test(t)&&!/\\d+\\s*位/.test(t)&&!/スコア|総合点/.test(t)&&!document.querySelector('table:not(dialog table):not(table.cmp)')&&!/順位|点数/.test(document.querySelector('#cmp').textContent.replace('順位は付けない',''))})()`));
  ok(label + ': 「一次スクリーニング」「確認項目」の語がある', await ev(`/一次スクリーニング/.test(document.body.innerText)&&/確認項目/.test(document.body.innerText)`));
  ok(label + ': 限界（位置誤差）が読める（国土数値情報・干渉SAR）', await ev(`(()=>{const d=document.querySelector('#limits');d.open=true;const t=d.textContent;const r=/誤差は数百 m/.test(t)&&/3\\.75 mm\\/年|数百 m より狭い/.test(t);return r})()`));
  ok(label + ': 防災・都市課題の観点がある（浸水しない場所・排熱）', await ev(`(()=>{const d=document.querySelector('#why');d.open=true;const t=d.textContent;return /防災/.test(t)&&/排熱/.test(t)})()`));
  ok(label + ': 衛星の出典表記（Copernicus・USGS・国土地理院/JAXA）が画面にある', await ev(`(()=>{const t=document.querySelector('#credit').textContent;return /Copernicus Sentinel/.test(t)&&/U\\.S\\. Geological Survey/.test(t)&&/原初データ所有：JAXA/.test(t)&&/ODbL/.test(t)&&/CC BY 4\\.0/.test(t)})()`));
  ok(label + ': 出典・注意は既定で畳まれ、ⓘで開く', await ev(`(()=>{const b=document.querySelector('#rows .row button.info');const d=document.getElementById(b.getAttribute('aria-controls'));const was=d.hidden;b.click();const r=was&&!d.hidden;b.click();return r})()`));
  ok(label + ': 防災・都市課題の観点が畳まれずに見える', await ev(`(()=>{const w=document.querySelector('#why');return w.tagName!=='DETAILS'&&w.getBoundingClientRect().height>40&&/防災/.test(w.textContent)})()`));
  ok(label + ': 防災への一言が結果の上に常に出る', await ev(`/→/.test(document.querySelector('#impact').textContent)`));
  ok(label + ': 比べる表が最初から 2 件並び、既定は差のある行・地盤・温度だけ、「全項目」で 8 行', await ev(`(()=>{const q=()=>document.querySelector('#cmp table.cmp');const t=q();const n=t.querySelectorAll('tbody tr').length;const ok1=t.querySelectorAll('thead th').length===3&&n>=2&&n<8&&/地盤の変動/.test(t.textContent)&&/地表面温度/.test(t.textContent);document.querySelector('#cmp .cmp-all').click();const ok2=q().querySelectorAll('tbody tr').length===8;document.querySelector('#cmp .cmp-all').click();return ok1&&ok2&&q().querySelectorAll('tbody tr').length===n})()`));
  ok(label + ': 衛星で見ることが平易な一言で並び、押すと地図の層が切り替わる', await ev(`(()=>{const b=document.querySelector('.satline button[data-sat="sub"]');b.click();const m=DCApp.state.map;const r=m.getLayoutProperty('img-sub','visibility')==='visible'&&m.getLayoutProperty('img-lst','visibility')==='none'&&document.querySelector('#layers input[data-layer="sub"]').checked&&/目立つ動き/.test(document.querySelector('#legend').textContent);document.querySelector('.satline button[data-sat="lst"]').click();return r&&/年に何mm上下/.test(document.querySelector('.satline').textContent)})()`));
  ok(label + ': 衛星の層の切替が地図の上に常に見える', await ev(`(()=>{const r=document.querySelector('.satbar').getBoundingClientRect();return r.height>0&&r.width>0&&document.querySelectorAll('.satbar input').length===5})()`));
  ok(label + ': 例として表示中であることが分かる', await ev(`/例として/.test(document.querySelector('#target-sub').textContent)`));
  ok(label + ': 候補地の名前の意味（造＝造成地・遊＝遊休地）と該当数の凡例がある', await ev(`/造成地の候補/.test(document.querySelector('#legend').textContent)&&/遊休地の候補/.test(document.querySelector('#legend').textContent)&&!!document.querySelector('.cand-mk .hzd')`));
  if (!mobile) ok(label + ': 限界・出典のボタンがパネル内に見える', await ev(`(()=>{const s=document.querySelector('.side').getBoundingClientRect();const b=document.querySelector('#btn-data').getBoundingClientRect();return b.bottom<=s.bottom+1&&b.top>=s.top})()`));
  if (!mobile) ok(label + ': 確認項目 8 つがパネル内でスクロールなしに見える', await ev(`(()=>{const s=document.querySelector('.side').getBoundingClientRect();const r=[...document.querySelectorAll('#rows .row')];return r[r.length-1].getBoundingClientRect().bottom<=s.bottom})()`));
  await shot(label + '_1_first.png');
  // 候補地を選ぶ
  const first = await ev(`document.querySelector('#target-title').textContent`);
  const opts = await ev(`[...document.querySelectorAll('#pick option')].filter(o=>!o.disabled).map(o=>o.value)`);
  await ev(`(()=>{const s=document.querySelector('#pick');s.value=${JSON.stringify(opts[Math.min(opts.length - 1, 30)])};s.dispatchEvent(new Event('change'))})()`); await sleep(900);
  ok(label + ': 選んだ候補地が比べる表に「選択中」の列として自動で入る', await ev(`(()=>{const c=document.querySelector('#cmp thead th.cur');return !!c&&/選択中/.test(c.textContent)&&c.textContent.includes(DCApp.state.target.id)&&document.querySelectorAll('#cmp thead th').length===4})()`));
  ok(label + ': 土砂に重なる所の助言に「かさ上げ」が出ない（災害の種類ごとの助言）', await ev(`(()=>{const L=DCApp.L,D=DCApp.DATA;const c=D.candidates.find(c=>{const r=L.buildChecks(D,DCApp.LAYERS,{lon:c.lon,lat:c.lat,cells:L.cellsInRing(D.grid,c.ring)});return r.find(x=>x.key==='slide').status==='hit'&&r.find(x=>x.key==='flood').status!=='hit'});if(!c)return true;const s=document.querySelector('#pick');const v=s.value;s.value=c.id;s.dispatchEvent(new Event('change'));const t=document.querySelector('#impact').textContent;s.value=v;s.dispatchEvent(new Event('change'));return /斜面/.test(t)&&!/かさ上げ/.test(t)})()`)); await sleep(500);
  ok(label + ': 選択中の列は（仮）と示し、ボタンは「固定」', await ev(`/（仮）/.test(document.querySelector('#cmp thead th.cur').textContent)&&/固定/.test(document.querySelector('#btn-pin').textContent)`));
  await ev(`document.querySelector('#btn-pin').click()`);
  ok(label + ': ＋比べるで 3 件目が並ぶ', await ev(`document.querySelectorAll('#cmp thead th').length===4`));
  ok(label + ': 候補地を選ぶと見出しと確認項目が変わる', (await ev(`document.querySelector('#target-title').textContent`)) !== first && (await ev(`document.querySelectorAll('#rows .row').length`)) === 8);
  ok(label + ': 選んだ候補地の輪郭が地図にある', await ev(`DCApp.state.map.getSource('sel')._data.geometry?.type==='Polygon'`));
  // 地図をクリックして地点を指す
  await ev(`window.scrollTo(0,0)`); await sleep(500); // スマホは選択後に結果へ寄せるので、地図の位置に戻してから指す
  if (mobile) ok(label + ': スマホは結果が画面外の時、下端に選んだ所と災害の該当の帯が出る', await ev(`(()=>{const b=document.querySelector('#jump');return !b.hidden&&b.textContent.includes(DCApp.state.target.id)&&b.getBoundingClientRect().height>=44})()`));
  const pt = await ev(`(()=>{const m=DCApp.state.map;const p=m.project(m.getCenter());const r=m.getContainer().getBoundingClientRect();return {x:r.left+p.x+(r.width>600?110:70),y:r.top+p.y-70}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }); await sleep(700);
  ok(label + ': 地図をクリックすると「地図で指した地点」の確認項目が出る', await ev(`document.querySelector('#target-title').textContent==='地図で指した地点'&&document.querySelectorAll('#rows .row').length===8&&!!document.querySelector('.pt-mk')`));
  ok(label + ': 指した地点の周囲の範囲が書いてある', await ev(`/75 m/.test(document.querySelector('#target-sub').textContent)`));
  await shot(label + '_2_point.png');
  // 層の切り替え（衛星は 1 つだけ。災害・電力は重ねられる）
  for (const k of ['flood', 'slide', 'tsunami', 'surge', 'power']) {
    await ev(`(()=>{const l=document.querySelector('#layers');l.open=true;const c=document.querySelector('#layers input[data-layer="${k}"]');c.checked=true;c.dispatchEvent(new Event('change'))})()`);
  }
  for (const k of ['land', 'sub']) await ev(`(()=>{const c=document.querySelector('#layers input[data-layer="${k}"]');c.checked=true;c.dispatchEvent(new Event('change'))})()`);
  await sleep(900);
  ok(label + ': 衛星の層は 1 つだけ（地盤を選ぶと温度・土地は消える）、災害の層は重ねられ、凡例が出る', await ev(`(()=>{const m=DCApp.state.map;const v=(k)=>m.getLayoutProperty('img-'+k,'visibility');return v('sub')==='visible'&&v('lst')==='none'&&v('land')==='none'&&['flood','slide','tsunami','surge'].every(k=>v(k)==='visible')&&document.querySelectorAll('#legend .lg').length>=7})()`));
  await ev(`document.querySelector('#layers').open=${mobile ? 'false' : 'true'}`);
  await shot(label + '_3_layers.png');
  await ev(`(()=>{const c=document.querySelector('#layers input[data-layer="none"]');c.checked=true;c.dispatchEvent(new Event('change'))})()`);
  ok(label + ': 「重ねない」で衛星の層が隠れる', await ev(`['lst','sub','land','chg'].every(k=>DCApp.state.map.getLayoutProperty('img-'+k,'visibility')==='none')`));
  await ev(`document.querySelector('#btn-home').click()`);
  // データと場面
  await ev(`document.querySelector('#btn-data').click()`); await sleep(400);
  ok(label + ': 「使っているデータと場面」に場面のID・日付・利用条件が出る', await ev(`(()=>{const t=document.querySelector('#datadlg').textContent;return document.querySelector('#datadlg').open&&/S2B_52SFC_20260823_0_L2A/.test(t)&&/LC09_L2SP_113036_20260822/.test(t)&&/2020-08-24/.test(t)&&/ODbL/.test(t)&&/CC BY 4\\.0/.test(t)&&/USGS/.test(t)&&/Copernicus/.test(t)&&/P03/.test(t)})()`));
  await shot(label + '_4_data.png');
  await ev(`document.querySelector('#datadlg').close()`);
  ok(label + ': 操作後もエラーなし', logs.length === 0); if (logs.length) console.log(logs.splice(0));
}
chrome.kill();
console.log(fails ? `${fails} 件失敗` : 'ui_check: すべて通過');
process.exit(fails ? 1 : 0);
