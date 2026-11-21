// UI確認（手動）。ヘッドレス Chrome で画面を開き、建物の実クリック・条件と見積の入力・タブの切り替え・見本点群・口コミを操作して、
// 地図の面積比・スクロール・位置の文言・架空の表示・コンソールエラーを調べ、スクリーンショットを撮る。1つでも外れたら終了コード 1。
// usage: node tests/ui_check.mjs <url> <outdir>   例: url=http://127.0.0.1:8883/index.html
// 要: google-chrome, node 22+。地図タイルの取得にネット接続が必要（無くても確認自体は進む）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [url, outdir] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'rpshot-'));
const chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch { /* retry */ } await sleep(200); }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + JSON.stringify(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') logs.push('ERR ' + d.params.args.map((a) => a.value || a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name, full = false) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  fs.writeFileSync(path.join(outdir, name), Buffer.from(r.data ?? r.result.data, 'base64'));
};
const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
await send('Runtime.enable'); await send('Page.enable');
const report = {}; const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };
const metrics = `JSON.stringify({
  vw: innerWidth, vh: innerHeight,
  hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  docH: document.documentElement.scrollHeight,
  vscroll: document.documentElement.scrollHeight > innerHeight + 1,
  mapW: Math.round(document.getElementById('map').getBoundingClientRect().width), mapH: Math.round(document.getElementById('map').getBoundingClientRect().height),
  mapShare: +(document.getElementById('map').getBoundingClientRect().width * document.getElementById('map').getBoundingClientRect().height / (innerWidth * innerHeight)).toFixed(3),
  mapTop: Math.round(document.getElementById('map').getBoundingClientRect().top), sideTop: Math.round(document.getElementById('side').getBoundingClientRect().top),
  sideBottom: Math.round(document.getElementById('side').getBoundingClientRect().bottom),
  loaderr: !document.getElementById('loaderr').hidden })`;
const clickPoint = `(() => { const S = window.__rp.state, b = S.sel; const r = document.getElementById('map').getBoundingClientRect();
  const wd = (lon, lat) => { const s = Math.sin(lat * Math.PI / 180); return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }; };
  const k = 256 * 2 ** S.view.z, c = wd(S.view.lon, S.view.lat), p = wd(S.tgt.lon, S.tgt.lat);
  return JSON.stringify({ x: r.left + r.width / 2 + (p.x - c.x) * k, y: r.top + r.height / 2 + (p.y - c.y) * k }); })()`;
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`);
for (const [name, w, h] of [['1513', 1513, 784], ['390', 390, 844]]) {
  const desktop = w > 900;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await send('Page.navigate', { url });
  await sleep(3000);
  const m0 = JSON.parse(await ev(metrics));
  report[name + '-load'] = m0;
  check(!m0.loaderr, name + ': データ読み込みエラー');
  check(!m0.hscroll, name + ': 横スクロールがある');
  if (desktop) { check(!m0.vscroll, name + ': 縦スクロールがある（docH ' + m0.docH + ' > ' + m0.vh + '）'); check(m0.mapW / m0.vw >= 0.6 && m0.mapW / m0.vw <= 0.75 && m0.mapH / m0.vh >= 0.75, name + ': 地図が画面の6〜7割（幅）・高さ7.5割以上でない ' + m0.mapW + 'x' + m0.mapH); }
  else check(m0.mapTop < m0.sideTop, name + ': 地図が操作パネルより上でない');
  check((await ev("document.getElementById('mapNote').innerText")).includes('用途の属性は入っていない'), name + ': 地図の注記がない');
  await shot(`${name}-1-load.png`);

  // 建物を実クリックで選ぶ: 推定10階前後の建物に寄せてから、その中心を押す
  await ev(`(() => { const S = window.__rp.state; const b = S.vis.filter((x) => x.floors >= 8 && x.floors <= 14).sort((a, c) => (c.area - a.area))[40]; S.tgt = b; S.view = { lon: b.lon, lat: b.lat, z: 17 }; window.__rp.draw(); })()`);
  await sleep(1200);
  const p = JSON.parse(await ev(clickPoint));
  await click(p.x, p.y);
  await sleep(500);
  const selId = await ev('window.__rp.state.sel && window.__rp.state.sel.id');
  const tgtId = await ev('window.__rp.state.tgt.id');
  check(selId && selId === tgtId, name + ': 実クリックで建物が選べない sel=' + selId + ' tgt=' + tgtId);
  if (!desktop) {
    await sleep(600);
    const st = JSON.parse(await ev("JSON.stringify({ side: Math.round(document.getElementById('side').getBoundingClientRect().top), mapTop: Math.round(document.getElementById('map').getBoundingClientRect().top), mapBottom: Math.round(document.getElementById('mapcol').getBoundingClientRect().bottom), vh: innerHeight })"));
    report[name + '-sideTopAfterPick'] = st;
    check(st.side <= st.mapBottom + 20 && st.side < st.vh * 0.6, name + ': 建物を選んでも操作パネルが地図のすぐ下に来ない ' + JSON.stringify(st));
    check(st.mapTop >= 0, name + ': 建物を選ぶと地図が隠れる ' + JSON.stringify(st));
  }
  const card = await text('#selCard');
  report[name + '-card'] = card.slice(0, 200).replace(/\n/g, ' / ');
  check(card.includes('外壁面積の概算') && card.includes('推定階数') && card.includes('推定延床'), name + ': 選んだ建物のカードが足りない');
  check(!!(await ev("document.getElementById('inFloors').value")) && !!(await ev("document.getElementById('inTfa').value")) && !!(await ev("document.getElementById('inUnits').value")), name + ': 階数・延床・戸数（推定）が入らない');
  // 目標1: 建物を押しただけで目安の範囲が出る
  const est0 = await text('#estOut');
  report[name + '-est0'] = est0.slice(0, 200).replace(/\n/g, ' / ');
  check(/修繕費の目安 [\d,]+万円〜[\d,]+万円/.test(est0), name + ': 建物を押しただけで目安の範囲が出ない');
  // 例の建物ボタン
  await ev("document.getElementById('pickExample').click()");
  await sleep(300);
  check(!!(await ev('window.__rp.state.sel && window.__rp.state.sel.id')) && /修繕費の目安/.test(await text('#estOut')), name + ': 例の建物を選ぶで目安が出ない');
  // 超高層・大規模は目安を出さない
  await ev(`(() => { const S = window.__rp.state; const b = S.list.slice().sort((a, c) => c.h - a.h)[0]; window.__rp.selectBuilding(b, false); })()`);
  await sleep(300);
  check((await text('#estOut')).includes('目安は出しません') && !(await text('#estOut')).includes('修繕費の目安'), name + ': 超高層で目安を止めない');
  await ev(`(() => { const S = window.__rp.state; window.__rp.selectBuilding(S.tgt, false); })()`);
  await sleep(300);

  // 条件と見積: 戸数60、見積は戸あたりが上位25%値を超える額
  const tfa = Number(await ev("document.getElementById('inTfa').value"));
  await ev(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('inUnits', 60); set('inAge', 15); set('inQuote', 9500); })()`);
  await sleep(300);
  const est = await text('#estOut');
  if (desktop) report[name + '-estTabScroll'] = await ev("(() => { const p = document.getElementById('p-est'); return [p.scrollHeight, p.clientHeight]; })()");
  report[name + '-est'] = est.slice(0, 600).replace(/\n/g, ' / ');
  check(est.includes('中位50%') && est.includes('修繕費の目安'), name + ': 目安の範囲が出ない');
  check(!(est.includes('戸数と延床が合っていません') && /延床あたりでは/.test(est)), name + ': 食い違いなのに延床あたりを出している');
  check((await ev("document.querySelectorAll('#estOut .rangebar .you').length")) === 1, name + ': 範囲バーに見積の印がない');
  check((await ev("document.querySelectorAll('#simMini li').length")) === 0 && !!(await ev("document.getElementById('toSim')")), name + ': 目安タブは似た建物への案内1行だけにする');
  check(!est.includes('延床あたりでは'), name + ': 判定が2つ並んでいる（延床あたりは折りたたみに）');
  check(/中央値より[\d.]+%高い/.test(est) && est.includes('上位25%に入る'), name + ': 見積の位置の文言が出ない（9500万円/60戸=158万円/戸）');
  check((await ev("document.body.innerText")).includes('適正な金額であることを保証しません'), name + ': 免責がない');
  if (desktop) check(await ev("(() => { const p = document.getElementById('p-est'); return p.scrollHeight <= p.clientHeight + 2; })()"), name + ': 目安タブにパネル内スクロールがある');
  else check(!!(await text('#selLine')).match(/目安 [\d,]+〜/), name + ': スマホの要約バーに目安が出ない');
  check(!(await ev("document.body.innerText")).includes('査定'), name + ': 「査定」がある');
  // 桁違いの戸数（推定値の後ろに打ち足した 4760 戸など）は範囲を出さず警告だけ
  await ev(`(() => { const e = document.getElementById('inUnits'); e.value = 4760; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  const bad = await text('#estOut');
  check(bad.includes('桁が違う') && !bad.includes('修繕費の目安'), name + ': 桁違いの戸数でも範囲を出している');
  await ev(`(() => { const e = document.getElementById('inUnits'); e.value = 60; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  await shot(`${name}-2-estimate.png`);
  if (!desktop) { await ev("document.getElementById('side').scrollIntoView()"); await sleep(200); await shot(`${name}-2-estimate-panel.png`); }

  // 似た建物
  await ev("document.getElementById('t-sim').click()");
  await sleep(500);
  const sim = await text('#simOut');
  const nsim = await ev("document.querySelectorAll('#simOut tbody tr').length");
  check(nsim >= 3 && sim.includes('修繕実績・築年は未収録') && sim.includes('機械計算'), name + ': 似た建物が出ない/実績・築年の限界の表示なし ' + nsim);
  await ev("document.querySelector('#simOut [data-sort=floors]').click()");
  const fl = await ev("[...document.querySelectorAll('#simOut tbody tr')].map((r) => +r.cells[1].innerText)");
  check(fl.join() === fl.slice().sort((a, b) => b - a).join(), name + ': 階数で並べ替えできない ' + fl);
  await ev("document.querySelector('#caseOut details.cases').open = true");
  const cases = await text('#caseOut');
  check((cases.match(/架空/g) || []).length >= 4 && cases.includes('公開されている個別の修繕事例はありません'), name + ': 事例の架空表示がない');
  check((await ev("document.querySelectorAll('#caseOut .list li.fakeitem').length")) === 3, name + ': 架空事例3件の印がない');
  await shot(`${name}-3-similar.png`);

  // 点群: 見本（合成）→ 概算 → 反映
  await ev("document.getElementById('t-slam').click()");
  await sleep(300);
  const lim = await text('#slamOut');
  check(lim.includes('高層の外壁全体は測れません') && lim.includes('1〜5m'), name + ': 点群の限界の表示がない');
  await ev("document.getElementById('cloudSample').click()");
  await sleep(600);
  const slam = await text('#slamOut');
  report[name + '-slam'] = slam.slice(slam.indexOf('合成データ'), slam.indexOf('合成データ') + 260).replace(/\n/g, ' / ');
  const ratio = await ev('window.__rp.state.cloudInfo.wallLen / window.__rp.state.sel.per');
  report[name + '-slamRatio'] = ratio;
  check(ratio > 0.8 && ratio < 1.1, name + ': 見本の外周が選んだ建物の外周と合わない ' + ratio);
  check(slam.includes('操作の練習用') && slam.includes('建物全体') && slam.includes('測れた範囲') && slam.includes('実測ではありません') && slam.includes('見積書と照らす'), name + ': 見本の表示（練習用・測れた範囲／建物全体・見積書との照合）がない');
  await ev(`(() => { const S = window.__rp.state, e = document.getElementById('wQty'); e.value = Math.round(S.wallRef * 1.1); e.dispatchEvent(new Event('input', { bubbles: true })); const u = document.getElementById('wUnit'); u.value = 5000; u.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const wo = await text('#wOut');
  report[name + '-wallCheck'] = wo.replace(/\n/g, ' / ');
  check(/\+10%/.test(wo) && /万円/.test(wo), name + ': 見積書の外壁数量との差・単価の計算が出ない');
  await shot(`${name}-4-slam.png`);
  await ev("document.getElementById('cloudApply').click()");
  await sleep(400);
  check((await text('#selCard')).includes('点群からの概算') && (await text('#selCard')).includes('合成'), name + ': 点群の概算が建物の欄に出ない');

  // 発注先
  await ev("document.getElementById('t-vendor').click()");
  await sleep(300);
  const nlinks = await ev("document.querySelectorAll('#vendorOut .links a').length");
  const nrev = await ev("document.querySelectorAll('#vendorOut .list li.fakeitem').length");
  const vendor = await text('#vendorOut');
  check(nlinks === 4 && nrev === 4, name + ': 公的リンク4件・架空の口コミ4件でない ' + nlinks + '/' + nrev);
  check(vendor.includes('新しい順') && vendor.includes('実データなし') && vendor.includes('架空です'), name + ': 口コミの規則・架空の表示がない');
  check((await ev("document.querySelectorAll('#vendorOut .rangebar .you').length")) === 3 && /\d件/.test(await text('#vendorOut table.qt')), name + ': 見本の3社が最初から帯に並ばない／口コミ数が出ない');
  const order = await ev("[...document.querySelectorAll('#vendorOut .list li.fakeitem')].map((l) => (l.textContent.match(/\\d{4}-\\d{2}-\\d{2}/) || [''])[0]).join(',')");
  report[name + '-reviewOrder'] = order;
  check(order === order.split(',').sort().reverse().join(','), name + ': 口コミが新しい順でない');
  // 複数社の見積を入れて、同じ帯に並べる
  await ev(`(() => { const set = (sel, v) => { const e = document.querySelector(sel); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('.qname[data-i="0"]', '架空会社A'); set('.qamt[data-i="0"]', 8000); set('.qamt[data-i="1"]', 9500); set('.qamt[data-i="2"]', 7000); })()`);
  await sleep(300);
  const nmark = await ev("document.querySelectorAll('#vendorOut .rangebar .you').length");
  const qt = await text('#vendorOut table.qt');
  report[name + '-quotes'] = qt.replace(/\n/g, ' / ').slice(0, 300);
  check(nmark === 3 && /上位25%|中央値と|下位25%/.test(qt), name + ': 複数社の見積が帯に並ばない ' + nmark);
  await shot(`${name}-5-vendor.png`);

  // 口コミを1件投稿（端末内のみ）→ 先頭に出る・並びは日付順
  await ev(`(() => { const f = document.getElementById('revForm'); document.querySelectorAll('#vendorOut details').forEach((d) => (d.open = true)); f.company.value = '試験会社'; f.year.value = 2025; f.stake.value = 'none'; f.text.value = '試験の投稿'; f.requestSubmit(); })()`);
  await sleep(400);
  check((await ev("document.querySelectorAll('#vendorOut ul.list:not(.links) li').length")) === 5, name + ': 投稿が増えない');
  await ev("localStorage.clear()");

  // 出典・限界
  await ev("document.getElementById('t-src').click()");
  await sleep(300);
  check((await text('#srcOut')).includes('PLATEAU Site Policy') && (await text('#srcOut')).includes('用途は0%'), name + ': 出典・付与率の見出しがない');
  await ev("document.querySelectorAll('#srcOut details').forEach((d) => (d.open = true))");
  const src = await text('#srcOut');
  check(src.includes('46,386') && src.includes('建築年0%') && src.includes('要確認') && src.includes('PLATEAU Site Policy'), name + ': 出典・付与率の表示が足りない');
  await shot(`${name}-6-sources.png`);
  const mEnd = JSON.parse(await ev(metrics));
  check(!mEnd.hscroll, name + ': 最後に横スクロール');
  if (desktop) check(!mEnd.vscroll, name + ': 最後に縦スクロール');
  report[name + '-end'] = mEnd;
  await ev("document.getElementById('t-est').click()");
}
report.consoleLogs = logs;
check(logs.filter((l) => !/Failed to load resource|ERR_/.test(l)).length === 0, 'コンソールにエラー: ' + logs.join(' | '));
report.fails = fails;
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(fails.length ? 1 : 0);
