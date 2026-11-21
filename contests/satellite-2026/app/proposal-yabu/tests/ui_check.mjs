// usage: node tests/ui_check.mjs <base_url> <out_dir>   （要: google-chrome, node 22+、静的サーバー起動済み）
// デスクトップ幅と390px幅で、順位表・地図・根拠・記録・計画・CSV を実際に操作して確かめ、スクリーンショットを残す。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'yabu-'));
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
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/cyberjapandata\.gsi\.go\.jp/.test(d.params.entry.url || '')) logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const shot = async (name) => { await sleep(500); const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); };
let fails = 0, total = 0;
const ok = (name, cond) => { total++; if (!cond) fails++; console.log(cond ? 'ok  ' : 'FAIL', name); };

for (const [label, w, h, mobile] of [['desktop', 1513, 784, false], ['mobile', 390, 844, true]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: base }); await sleep(1500);
  await ev('localStorage.clear(); location.reload()'); await sleep(2500);
  console.log('--', label);
  ok(label + ': 起動時にエラーなし', logs.length === 0); if (logs.length) console.log(logs.splice(0));
  ok(label + ': バナーに「架空のデータは使っていません」と「最新ではありません」', await ev(`(()=>{const t=document.querySelector('#banner').textContent;return t.includes('架空のデータは使っていません')&&t.includes('最新ではありません')&&t.includes('仮置き')})()`));
  ok(label + ': 地図のキャンバスがある', await ev(`!!document.querySelector('#map canvas')`));
  ok(label + ': 地図が画面の6〜7割（デスクトップは幅、スマホは高さ）', await ev(`(()=>{const r=document.querySelector('#map').getBoundingClientRect();return ${mobile} ? (r.height/innerHeight>=0.55 && r.height/innerHeight<=0.72 && r.width/innerWidth>0.9) : (r.width/innerWidth>=0.58 && r.width/innerWidth<=0.70 && r.height/innerHeight>=0.55)})()`));
  ok(label + ': 出没しやすい範囲（高・中）の層が地図にある', await ev(`(async()=>{for(let i=0;i<30&&!(YabuApp.state.mapReady&&YabuApp.state.map.getLayer('hab-high'));i++)await new Promise(r=>setTimeout(r,200));const m=YabuApp.state.map;return !!m.getLayer('hab-high')&&!!m.getLayer('hab-mid')&&m.getLayer('hab-high').visibility!=='none'})()`));
  ok(label + ': 凡例に高・中・低と根拠（Takahata）がある', await ev(`(()=>{const t=document.querySelector('#hab-legend').textContent;return t.includes('高')&&t.includes('中')&&t.includes('低')&&t.includes('3.74')&&t.includes('Takahata')&&t.includes('偏ります')})()`));
  ok(label + ': 「この判定の確かさ」は初期は閉じていて、開くと表が5つ以上・AUCと基準の比較が出る', await ev(`(()=>{const d=document.querySelector('#validation');const closed=!d.open;d.open=true;const n=d.querySelectorAll('table').length;const t=d.textContent;const r=closed&&n>=5&&/AUC/.test(t)&&t.includes('人家からの距離だけ（基準）')&&t.includes('2010年度を除く')&&t.includes('人の多い所');d.open=false;return r})()`));
  ok(label + ': 順位表に出没しやすさの列がある', await ev(`document.querySelector('#ranktable thead').textContent.includes('クマの出没しやすさ')`));
  ok(label + ': 順位表は初期20行（「表示」で増やせる）', (await ev(`document.querySelectorAll('#ranktable tbody tr[data-id]').length`)) === 20);
  ok(label + ': 最初の画面に優先上位5（区画・点数・理由の一言）が見える', await ev(`(()=>{const b=[...document.querySelectorAll('#top5 [data-top]')];if(b.length!==5)return false;const r=b[4].getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&/目撃\\d+件|建物\\d+m|林縁\\d+%/.test(b[0].textContent)})()`));
  ok(label + ': 最初の画面に衛星の絞り込み（11,312→605）の一行がある', await ev(`(()=>{const e=document.querySelector('#satline');const r=e.getBoundingClientRect();return e.textContent.includes('11,312区画')&&e.textContent.includes('605')&&r.top>=0&&r.bottom<=innerHeight})()`));
  ok(label + ': 地図に凡例（高・中・優先上位20・学校）が重ねてある', await ev(`(()=>{const t=document.querySelector('.minileg').textContent;return t.includes('高')&&t.includes('優先上位20')&&t.includes('学校')})()`));
  ok(label + ': 衛星のNDVI層がある', await ev(`(async()=>{document.getElementById('l-ndvi').click();await new Promise(r=>setTimeout(r,300));const v=YabuApp.state.map.getLayoutProperty('cells-ndvi','visibility')==='visible';document.getElementById('l-ndvi').click();return v})()`));
  ok(label + ': 上位20の番号札が地図にある', (await ev(`document.querySelectorAll('#map .mk').length`)) === 20);
  ok(label + ': 最初の画面に衛星の点の割合（上位5）が出る', await ev(`/上位5の点数の約\\d+%が衛星/.test(document.querySelector('#satline').textContent)`));
  ok(label + ': 「同じ地区は1件に」で上位5の地区が重複しない', await ev(`(()=>{const g=document.querySelector('#f-group');g.click();const t=[...document.querySelectorAll('#top5 .tid small')].map(e=>e.textContent);const ok=t.length===5&&new Set(t).size===5;document.querySelector('#f-group').click();return ok})()`));
  ok(label + ': 横スクロールなし', await ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  await shot(label + '_1_rank.png');
  // 行を選ぶ → 根拠
  await ev(`document.querySelector('#ranktable tbody tr[data-id]').click()`); await sleep(500);
  ok(label + ': 行を選ぶと根拠（7項目）が出る', (await ev(`document.querySelectorAll('#detail .src').length`)) === 7);
  ok(label + ': 根拠に実数値（目撃件数・距離）がある', await ev(`/500m以内で 2009〜2018年度に \\d+ 件/.test(document.querySelector('#detail').textContent) && /約\\d+ m/.test(document.querySelector('#detail').textContent)`));
  ok(label + ': 選択行が強調される', await ev(`!!document.querySelector('#ranktable tr.sel')`));
  ok(label + ': 表の行を選ぶと根拠が画面内に出る（スクロールし直し不要）', await ev(`(()=>{const r=document.querySelector('#detail').getBoundingClientRect();return r.height>50&&r.top>=-1&&r.top<innerHeight-100})()`));
  if (mobile) ok(label + ': スマホは根拠が下からのシートで出て、閉じられる', await ev(`(()=>{const d=document.querySelector('#detail');const s=d.classList.contains('sheet')&&getComputedStyle(d).position==='fixed';document.querySelector('#btn-sheet-close').click();const closed=!d.classList.contains('sheet');document.querySelector('#ranktable tbody tr[data-id]').click();return s&&closed&&d.classList.contains('sheet')})()`));
  // 上位5から選ぶと根拠が出る
  await ev(`window.scrollTo(0,0); document.querySelectorAll('#top5 [data-top]')[1].click()`); await sleep(300);
  ok(label + ': 上位5の2番目を押すと、その区画の根拠が画面内に出る', await ev(`(()=>{const id=YabuApp.state.ranked[1].id;const d=document.querySelector('#detail');const r=d.getBoundingClientRect();return d.querySelector('h2').textContent.startsWith(id)&&r.top<innerHeight-100&&d.textContent.includes('衛星だけなら')})()`));
  // 根拠パネルの中で記録できる（タブを切り替えない）
  ok(label + ': 根拠パネルで日付・メモも入れられる', await ev(`(()=>{const d=document.querySelector('#detail .qmore');d.open=true;document.querySelector('#q-memo').value='ササ';return !!document.querySelector('#q-date').value})()`));
  await ev(`document.querySelector('#q-result').value='すでに管理されている'; document.querySelector('#q-who').value='鳥獣係'; document.querySelector('#q-form').requestSubmit()`); await sleep(300);
  ok(label + ': 根拠パネルの中で現地確認を記録できる', (await ev(`JSON.parse(localStorage.getItem('yabu-results-v1')||'[]').length`)) === 1 && (await ev(`JSON.parse(localStorage.getItem('yabu-results-v1'))[0].memo==='ササ'`)) && (await ev(`document.querySelector('#q-msg').textContent.includes('記録しました')`)) && (await ev(`!document.querySelector('#v-rank').hidden`)));
  await ev(`localStorage.setItem('yabu-results-v1','[]'); YabuApp.state.results.length=0`);
  await shot(label + '_2_detail.png');
  // 衛星のみ
  const top1 = await ev(`document.querySelector('#ranktable tbody tr td:nth-child(2)').textContent`);
  await ev(`document.querySelector('#f-sat').click()`); await sleep(300);
  ok(label + ': 衛星だけで並べると説明文が変わる', await ev(`document.querySelector('#count').textContent.includes('衛星だけの点数')`));
  ok(label + ': 衛星だけで並べると1位が変わる（重ねたデータの効果が見える）', (await ev(`document.querySelector('#ranktable tbody tr td:nth-child(2)').textContent`)) !== top1);
  await ev(`document.querySelector('#f-sat').click()`); await sleep(300);
  // 重み
  await ev(`(()=>{const i=document.querySelector('#weights input[data-k=sight]');i.value=0;i.dispatchEvent(new Event('input'))})()`); await sleep(300);
  ok(label + ': 目撃の重みを0にすると1位が変わる', (await ev(`document.querySelector('#ranktable tbody tr td:nth-child(2)').textContent`)) !== top1);
  await ev(`document.querySelector('#btn-w-reset').click()`); await sleep(300);
  ok(label + ': 重みを戻すと1位が元に戻る', (await ev(`document.querySelector('#ranktable tbody tr td:nth-child(2)').textContent`)) === top1);
  // 地図レイヤー切替
  await ev(`['l-sights','l-houses'].forEach(i=>document.getElementById(i).click())`); await sleep(800);
  await shot(label + '_3_layers.png');
  await ev(`['l-sights','l-houses'].forEach(i=>document.getElementById(i).click())`);
  // 記録
  await ev(`document.querySelector('#ranktable tbody tr[data-id]').click(); document.querySelector('[data-view=record]').click()`); await sleep(300);
  const cid = await ev(`document.querySelector('#r-cell').value`);
  ok(label + ': 「記録する」で区画IDが入る', /^Y\d{3}$/.test(cid));
  await ev(`document.querySelector('#r-who').value='テスト'; document.querySelector('#r-memo').value='=cmd,"引用"'; document.querySelector('#r-result').value='藪ではない（農地・建物など）'; document.querySelector('#rec-form').requestSubmit()`); await sleep(300);
  ok(label + ': 記録が表に出る', (await ev(`document.querySelectorAll('#rec-table tbody tr').length`)) === 1 && (await ev(`document.querySelector('#rec-table').textContent.includes('テスト')`)));
  ok(label + ': 記録が localStorage に保存される', (await ev(`JSON.parse(localStorage.getItem('yabu-results-v1')).length`)) === 1);
  await ev(`document.querySelector('#r-cell').value='Y999'; document.querySelector('#r-result').value='藪・要刈り払い'; document.querySelector('#rec-form').requestSubmit()`); await sleep(200);
  ok(label + ': 存在しない区画IDは拒否される', (await ev(`document.querySelector('#rec-msg-text').textContent`)).includes('候補にありません') && (await ev(`JSON.parse(localStorage.getItem('yabu-results-v1')).length`)) === 1);
  await ev(`document.querySelector('#r-cell').value=YabuApp.state.ranked[0].id; document.querySelector('#r-result').value=''; document.querySelector('#rec-form').requestSubmit()`); await sleep(200);
  ok(label + ': 結果を選ばないと記録されない', (await ev(`JSON.parse(localStorage.getItem('yabu-results-v1')).length`)) === 1);
  // CSV（Blob を捕まえる）
  await ev(`window.__csv=[]; const o=URL.createObjectURL; URL.createObjectURL=(b)=>{b.text().then(t=>window.__csv.push(t)); return o.call(URL,b)}; HTMLAnchorElement.prototype.click=function(){}`);
  await ev(`document.querySelector('#btn-rec-csv').click()`); await sleep(300);
  const rcsv = await ev(`window.__csv[0]`);
  if (process.env.DEBUG_CSV) console.log(JSON.stringify(rcsv));
  ok(label + ': 記録CSV: 式が無効化され引用される', rcsv.includes('"\'=cmd,""引用"""') && rcsv.startsWith('確認日'));
  await ev(`document.querySelector('[data-view=record]').click()`); await sleep(300);
  ok(label + ': 計画に10区画が出る', (await ev(`document.querySelectorAll('#plan-table tbody tr').length`)) === 10);
  ok(label + ': 計画の表に「藪ではない」の区画が入らない', !(await ev(`[...document.querySelectorAll('#plan-table tbody tr td:nth-child(2)')].map(t=>t.textContent).includes('${cid}')`)));
  ok(label + ': 計画の注記に除外件数1が出る', (await ev(`document.querySelector('#plan-note').textContent`)).includes('1 区画は除いて'));
  await shot(label + '_4_plan.png');
  await ev(`document.querySelector('#btn-plan-csv').click()`); await sleep(300);
  const pcsv = await ev(`window.__csv[1]`);
  const lines = pcsv.trim().split('\r\n');
  ok(label + ': 計画CSV: ヘッダ+10行・空欄の記入列あり', lines.length === 11 && lines[0].includes('刈り払い実施主体(記入)') && lines[1].split(',').length >= 18);
  ok(label + ': 計画CSVに地理院地図のリンクがあり、固定値の面積列はない', lines[1].includes('https://maps.gsi.go.jp/#17/') && !lines[0].includes('面積'));
  ok(label + ': 計画CSVに「藪ではない」区画が入っていない', !lines.slice(1).some((l) => l.split(',')[1] === cid));
  ok(label + ': 記録タブ・計画タブで横スクロールなし', await ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  await ev(`document.querySelector('[data-view=record]').click()`); await sleep(200);
  ok(label + ': 記録タブも横スクロールなし', await ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  // 地図上の区画をクリックして選べる（区画の中心を画面座標に投影してクリック）
  await ev(`document.querySelector('[data-view=rank]').click()`); await sleep(800);
  const pt = await ev(`(()=>{const a=window.YabuApp;const c=a.state.byId['Y050'];a.state.map.jumpTo({center:[c.lon,c.lat],zoom:16});return null})()`); await sleep(1200);
  const xy = await ev(`(()=>{const a=window.YabuApp;const c=a.state.byId['Y050'];const p=a.state.map.project([c.lon,c.lat]);const r=document.querySelector('#map canvas').getBoundingClientRect();return [r.left+p.x,r.top+p.y]})()`);
  await ev(`document.querySelector('#map').scrollIntoView({block:'center'})`); await sleep(300);
  const xy2 = await ev(`(()=>{const a=window.YabuApp;const c=a.state.byId['Y050'];const p=a.state.map.project([c.lon,c.lat]);const r=document.querySelector('#map canvas').getBoundingClientRect();return [r.left+p.x,r.top+p.y]})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xy2[0], y: xy2[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xy2[0], y: xy2[1], button: 'left', clickCount: 1 });
  await sleep(500);
  ok(label + ': 地図の区画をクリックすると根拠が出る', (await ev(`document.querySelector('#detail h2').textContent`)).startsWith('Y050'));
  await shot(label + '_5_mapclick.png');
  ok(label + ': 通常操作でコンソールエラーなし', logs.length === 0); if (logs.length) console.log(logs.splice(0));
}
console.log(`\n${total - fails}/${total} 件 通過`);
chrome.kill(); await sleep(800);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* 一時ディレクトリの後始末に失敗しても結果には影響しない */ }
process.exit(fails ? 1 : 0);
