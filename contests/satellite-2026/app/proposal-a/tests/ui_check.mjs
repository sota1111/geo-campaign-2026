// 画面の通し確認（ヘッドレスChrome + CDP）。unittest には含めない（Chrome が必要）。
// usage: (python3 -m http.server 8861 --bind 127.0.0.1 &) ; node tests/ui_check.mjs http://127.0.0.1:8861/ <out_dir>
// 確かめること: 既定の画面に架空のデータが出ない／CSV（区間ID・緯度経度）で較正できる／説明用デモはオンの間ずっと「架空」と出る／検証タブ
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openChrome() {
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-'));
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
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') logs.push('LOG ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { __error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  return { send, ev, logs, close: () => { ws.close(); chrome.kill(); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } } };
}
async function shot(c, name) { await sleep(700); const s = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name), Buffer.from(s.result.data, 'base64')); }

// ページ内で、検査用の CSV を作る式。台帳の竣工年が 1975 年以前の区間を「あり」にした検査用の値（実際の調査結果ではない）。
const MK_ID = `(()=>{const S=App.STATE;const cand=S.ranked.filter(s=>s.cls==='life'&&!s.surveyed).filter((_,i)=>i%50===0).slice(0,40);
  return 'segment_id,cavity\\n'+cand.map(s=>s.id+','+(s.year!=null&&s.year<=1975?'あり':'なし')).join('\\n')+'\\n';})()`;
const MK_PT = `(()=>{const S=App.STATE;const rows=[...S.results].map(([id,h])=>{const s=S.segs.find(x=>x.id===id);
  return ((s.coords[0][1]+s.coords[1][1])/2+0.00002).toFixed(6)+','+((s.coords[0][0]+s.coords[1][0])/2).toFixed(6)+','+(h?'あり':'なし')});
  return '緯度,経度,空洞\\n'+rows.join('\\n')+'\\n'})()`;
const W_OF = `(()=>{const t=document.getElementById("s3").textContent.match(/採用: 衛星 (\\d+)%/);return t&&+t[1]})()`;

const report = {};
for (const [label, w, h] of [['desktop', 1366, 800], ['mobile', 390, 844]]) {
  const c = await openChrome(); const r = { fail: [], info: {} };
  const need = (cond, msg) => { if (!cond) r.fail.push(msg); };
  try {
    await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 720 });
    await c.send('Page.navigate', { url: base });
    for (let i = 0; i < 80; i++) { await sleep(250); if (await c.ev('window.__ready === true')) break; }
    need(await c.ev('window.__ready === true'), '地図が初期化されない');
    await sleep(500);
    await shot(c, `${label}_1_score.png`);
    r.info.scrollW = await c.ev('document.documentElement.scrollWidth');
    need(r.info.scrollW <= w, '横スクロール発生 ' + r.info.scrollW);

    // ---- 既定の状態に架空のデータが出ないこと
    r.info.badge = await c.ev('document.getElementById("badge").innerText');
    need(await c.ev('document.getElementById("demo-banner").hidden'), '既定でデモ表示が出ている');
    need(await c.ev('App.STATE.results.size === 0 && App.STATE.demo === false'), '既定で結果がある');
    need(await c.ev('App.STATE.segs.every(s=>!("sim_cavity" in s) && !s.surveyed)'), '区間に架空の項目や調査済みが残っている');
    r.info.resources = await c.ev('performance.getEntriesByType("resource").map(e=>e.name.split("/").slice(-1)[0]).join(",")');
    need(!r.info.resources.includes('demo_sim'), '既定で demo_sim.json を読み込んでいる');
    const noFake = async (tag) => {
      const t = await c.ev('document.body.innerText.replace(/説明用デモ（架空の結果で動きを見る）。既定はオフ|説明用デモで動きを見る（架空の結果）/g,"")');
      need(!t.includes('架空'), `既定の画面(${tag})に「架空」が出ている`);
    };
    await noFake('第1');
    need(await c.ev('App.getMap().getSource("res")._data.features.length === 0'), '既定で地図に結果の印がある');
    r.info.w_shift_0 = await c.ev('document.getElementById("w-shift").innerText');
    await c.ev('(()=>{const e=document.getElementById("w");e.value=100;e.dispatchEvent(new Event("input"))})()');
    r.info.w_shift_100 = await c.ev('document.getElementById("w-shift").innerText');
    await c.ev('(()=>{const e=document.getElementById("w");e.value=10;e.dispatchEvent(new Event("input"))})()');

    // ---- 第2段階
    await c.ev('document.getElementById("to2").click()');
    await c.ev('document.getElementById("auto").click()');
    r.info.selected = await c.ev('App.STATE.selected.size');
    need(r.info.selected > 0, '自動選定が空');
    const first = await c.ev('[...App.STATE.selected][0]');
    await c.ev(`App.toggleSeg("${first}")`);
    await c.ev(`App.toggleSeg("${first}")`);
    await c.ev('(()=>{const e=document.getElementById("bud");e.value=1;e.dispatchEvent(new Event("input"))})()');
    need(await c.ev('document.getElementById("to3").disabled'), '予算超過でも「次へ」が有効');
    await c.ev('(()=>{const e=document.getElementById("bud");e.value=3;e.dispatchEvent(new Event("input"));e.dispatchEvent(new Event("change"))})()');
    await shot(c, `${label}_2_select.png`);
    const pt = await c.ev(`(()=>{const m=App.getMap();const rc=m.getCanvas().getBoundingClientRect();const vis=(s)=>{const p=m.project([(s.coords[0][0]+s.coords[1][0])/2,(s.coords[0][1]+s.coords[1][1])/2]);return p.x>rc.width*0.45&&p.y>60&&p.x<rc.width-20&&p.y<rc.height*0.5};const s=App.STATE.segs.find(x=>x.cls==="life"&&!x.surveyed&&!App.STATE.selected.has(x.id)&&vis(x))||App.STATE.segs.find(x=>x.cls==="life"&&!x.surveyed&&!App.STATE.selected.has(x.id));const p=m.project([(s.coords[0][0]+s.coords[1][0])/2,(s.coords[0][1]+s.coords[1][1])/2]);return {x:p.x+rc.left,y:p.y+rc.top,id:s.id,inView:p.x>0&&p.y>0&&p.x<rc.width&&p.y<rc.height}})()`);
    r.info.sel_before_click = await c.ev('App.STATE.selected.size');
    if (pt.inView) {
      await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
      await sleep(400);
      r.info.sel_after_click = await c.ev('App.STATE.selected.size');
    }
    await c.ev('document.getElementById("auto").click()');
    await noFake('第2');

    // ---- 第3段階: CSV（区間IDの書き方）
    await c.ev('document.getElementById("to3").click()');
    await noFake('第3');
    r.info.s3_default = (await c.ev('document.getElementById("s3").innerText')).slice(0, 300);
    const t3 = await c.ev('document.getElementById("s3").innerText');
    need(t3.includes('一次審査を通った後') && t3.includes('GMS3'), 'GMS3 の受け皿の説明がない');
    need(t3.includes('未確認'), 'GMS3 書式未確認の明記がない');
    await shot(c, `${label}_3a_empty.png`);
    const csvId = await c.ev(MK_ID);
    await c.ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(csvId)}],'by_id.csv',{type:'text/csv'}));const i=document.getElementById('csv-file');i.files=dt.files;i.dispatchEvent(new Event('change'))})()`);
    await sleep(600);
    r.info.load_ok = await c.ev('document.querySelector("[data-testid=load-ok]")?.innerText');
    need(r.info.load_ok && r.info.load_ok.includes('40 区間'), 'CSV(区間ID)の取り込み結果が出ない');
    r.info.w_id = await c.ev(W_OF);
    need(r.info.w_id !== null && r.info.w_id !== undefined, '較正の結果が出ない');
    await shot(c, `${label}_3b_loaded.png`);
    await c.ev('document.getElementById("apply").click()');
    r.info.round = await c.ev('document.getElementById("round").innerText');
    r.info.w_after = await c.ev('App.STATE.w');
    need(r.info.round === '第2回', '第2回へ進まない');
    need(await c.ev('App.getMap().getSource("res")._data.features.length === 40'), '地図に結果の印が出ない');
    await shot(c, `${label}_4_round2.png`);

    // ---- 同じ結果を緯度・経度の書き方で入れ直して、同じ較正になること
    await c.ev('App.setStep(3)');
    const pts = await c.ev(MK_PT);
    await c.ev('document.getElementById("clear-res").click()');
    await c.ev(`App.loadCsvText(${JSON.stringify(pts)},'by_point.csv')`);
    r.info.load_pt = await c.ev('document.querySelector("[data-testid=load-ok]")?.innerText');
    need(r.info.load_pt && r.info.load_pt.includes('40 区間') && r.info.load_pt.includes('緯度・経度の点で 40 行'), 'CSV(緯度・経度)の取り込み結果が違う');
    r.info.w_pt = await c.ev(W_OF);
    need(r.info.w_pt === r.info.w_id, '2つの書き方で較正が違う ' + r.info.w_id + ' / ' + r.info.w_pt);
    await c.ev(`App.loadCsvText('foo,bar\\n1,2\\n','bad.csv')`);
    need(await c.ev('!!document.querySelector("[data-testid=load-error]")'), '不正なCSVでエラーが出ない');
    await c.ev('document.getElementById("clear-res").click()');

    // ---- 説明用デモ: オンの間ずっと「架空」、オフで消える
    await c.ev(`document.getElementById("demo-go").click()`);
    await sleep(800);
    need(await c.ev('!document.getElementById("demo-banner").hidden'), 'デモ中なのにバナーが出ない');
    for (const stp of [1, 2, 3, 4]) {
      await c.ev(`App.setStep(${stp})`);
      need(await c.ev('!document.getElementById("demo-banner").hidden && document.getElementById("demo-banner").innerText.includes("架空") && document.getElementById("badge").innerText.includes("架空")'), `デモ中の第${stp}段階で「架空」表示が消えている`);
    }
    await c.ev('App.setStep(2)');
    await c.ev('document.getElementById("auto").click()');
    await c.ev('App.setStep(3)');
    await c.ev('document.getElementById("scan").click()');
    r.info.demo_s3 = (await c.ev('document.getElementById("s3").innerText')).slice(0, 700);
    need(await c.ev('document.getElementById("s3").innerText.includes("架空")'), 'デモの第3段階に「架空」がない');
    await shot(c, `${label}_5_demo.png`);
    await c.ev(`document.getElementById("demo-off").click()`);
    await sleep(500);
    need(await c.ev('document.getElementById("demo-banner").hidden && App.STATE.results.size===0 && App.STATE.segs.every(s=>!s.surveyed)'), 'デモをオフにしても架空の結果が残る');
    await noFake('デモ後の第3');

    // ---- 検証タブ
    await c.ev('App.setStep(4)');
    await sleep(300);
    r.info.s4 = (await c.ev('document.getElementById("s4").innerText')).slice(0, 500);
    need(await c.ev('["座標はありません","全国特別重点調査","空洞調査の実施済み延長も 0 km","原因を示すものではありません"].every(t=>document.getElementById("s4").innerText.includes(t))'), '検証タブの要点が揃っていない');
    await shot(c, `${label}_6_verify.png`);

    await c.ev('document.getElementById("btn-about").click()');
    r.info.about_has_sentinel_note = await c.ev('document.getElementById("about-body").innerText.includes("Sentinel-1 の解析を主に想定")');
    need(r.info.about_has_sentinel_note, '出典モーダルに Sentinel-1 の説明がない');
    need(await c.ev('["解析：国土地理院 原初データ所有：JAXA","© OpenStreetMap contributors","CC BY 4.0","政府標準利用規約","要確認"].every(t=>document.getElementById("about-body").innerText.includes(t))'), '出典モーダルにクレジット・利用条件の食い違いが揃っていない');
    r.info.modal_overflow = await c.ev('(()=>{const b=document.querySelector(".modal-box");return b.scrollWidth-b.clientWidth})()');
    await shot(c, `${label}_7_about.png`);
    r.info.small_targets = await c.ev(`[...document.querySelectorAll('#panel button, #panel input')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&b.height<32&&e.id!=="sheet-toggle"}).map(e=>(e.id||e.tagName)+':'+Math.round(e.getBoundingClientRect().height))`);
  } catch (e) { r.fail.push('例外: ' + e.message); }
  r.logs = c.logs; if (c.logs.length) r.fail.push('コンソールエラー ' + c.logs.length + ' 件');
  c.close(); report[label] = r;
}
console.log(JSON.stringify(report, null, 1));
process.exit(Object.values(report).some((x) => x.fail.length) ? 1 : 0);
