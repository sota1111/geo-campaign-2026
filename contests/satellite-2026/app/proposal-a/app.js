import { rank, selectByBudget, totalKm, satNorm, ageNorm, calibrate, exclusionAccuracy, aucAt, NOW_YEAR } from './logic.js';

const $ = (s) => document.querySelector(s);
const pct = (x) => Math.round(x * 100);
const fmt1 = (x) => x.toFixed(1);
const STATE = { data: null, segs: [], cellSat: {}, w: 0.5, budgetKm: 3, step: 1, round: 1, selected: new Set(),
  scannedNew: new Map(), revealed: false, calib: null, ranked: [], focus: null, msg: '' };
let map = null;
const cellMarkers = [];

const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#dbe5ec', 0.5, '#f4b942', 1, '#8e1b6b'];
const segFC = () => ({ type: 'FeatureCollection', features: STATE.ranked.map((s) => ({ type: 'Feature',
  properties: { id: s.id, score: s.score, cls: s.cls, done: s.surveyed ? 1 : 0, sel: STATE.selected.has(s.id) ? 1 : 0 },
  geometry: { type: 'LineString', coordinates: s.coords } })) });
const resFC = () => ({ type: 'FeatureCollection', features: [...STATE.scannedNew].map(([id, hit]) => {
  const s = STATE.segs.find((x) => x.id === id); const [a, b] = s.coords;
  return { type: 'Feature', properties: { id, hit: hit ? 1 : 0 }, geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } }; }) });

function recompute() {
  STATE.ranked = rank(STATE.segs, STATE.cellSat, STATE.w);
}
const candidates = () => STATE.ranked.filter((s) => s.cls === 'life' && !s.surveyed);
const surveyedSet = () => STATE.segs.filter((s) => s.surveyed).map((s) => ({ ...s, hit: s.sim_cavity }));

function refreshMap() {
  if (!map || !map.getSource('segs')) return;
  map.getSource('segs').setData(segFC());
  map.getSource('res').setData(resFC());
  map.setPaintProperty('cells-fill', 'fill-opacity', STATE.step === 1 ? 0.5 : 0.12);
  cellMarkers.forEach((m) => { m.getElement().style.display = STATE.step === 1 ? '' : 'none'; });
}

function render() {
  recompute();
  $('#round').textContent = `第${STATE.round}回`;
  ['1', '2', '3'].forEach((k) => { $('#tab-' + k).setAttribute('aria-selected', String(+k === STATE.step)); $('#s' + k).hidden = +k !== STATE.step; });
  if (STATE.step === 1) renderS1(); else if (STATE.step === 2) renderS2(); else renderS3();
  renderLegend();
  refreshMap();
}

function renderS1() {
  const c = candidates(), km = c.reduce((a, s) => a + s.lenM, 0) / 1000;
  const top = c.slice(0, 8);
  $('#s1').innerHTML = `
    <h2>第1段階：衛星と台帳で区画・区間に点数を付ける</h2>
    <p class="note">地図の区画の色は、衛星由来の地表変位の指標（サンプル値）。道路の色は点数（衛星の区画値と、下水道台帳の布設年の古さの重み付き和）。衛星は空洞を直接見つけず、調べる順番を決める入口です。</p>
    ${STATE.msg ? `<p class="note"><b>${STATE.msg}</b></p>` : ''}
    <div class="lbl"><label for="w">衛星指標の重み</label><span id="w-out">${pct(STATE.w)}%</span></div>
    <input id="w" type="range" min="0" max="100" step="10" value="${pct(STATE.w)}" aria-describedby="w-note">
    <p id="w-note" class="note">0% = 台帳（管の古さ）だけ ／ 100% = 衛星指標だけ。第3段階の較正で自動的に更新されます。</p>
    <p><span class="big">${c.length}</span> 区間（${fmt1(km)} km）が未調査の生活道路。点数の高い順:</p>
    <table><thead><tr><th>区間</th><th>区画</th><th class="n">布設年</th><th class="n">点数</th></tr></thead><tbody>
    ${top.map((s) => `<tr data-id="${s.id}" tabindex="0"><td>${s.id}</td><td>${s.cell}</td><td class="n">${s.year}</td><td class="n">${s.score.toFixed(2)}</td></tr>`).join('')}
    </tbody></table>
    <button class="btn pri" id="to2" type="button">次へ：確かめる区間を選ぶ</button>`;
  $('#w').oninput = (e) => { STATE.w = +e.target.value / 100; STATE.msg = ''; recompute(); $('#w-out').textContent = pct(STATE.w) + '%'; refreshMap(); renderS1Table(); };
  $('#to2').onclick = () => setStep(2);
  bindRows('#s1');
}
function renderS1Table() { // スライダー操作中はフォーカスを保つため表だけ更新
  const top = candidates().slice(0, 8);
  $('#s1 tbody').innerHTML = top.map((s) => `<tr data-id="${s.id}" tabindex="0"><td>${s.id}</td><td>${s.cell}</td><td class="n">${s.year}</td><td class="n">${s.score.toFixed(2)}</td></tr>`).join('');
  bindRows('#s1');
}
function bindRows(root) {
  document.querySelectorAll(root + ' tr[data-id]').forEach((tr) => {
    const go = () => focusSeg(tr.dataset.id);
    tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}

function renderS2() {
  const sel = STATE.selected, km = totalKm(STATE.segs, sel), over = km > STATE.budgetKm + 1e-9;
  const rows = STATE.ranked.filter((s) => sel.has(s.id));
  $('#s2').innerHTML = `
    <h2>第2段階：地中レーダを走らせる区間を選ぶ</h2>
    <p class="note">地図の道路をタップすると選択／解除できます（未調査の生活道路のみ。幹線と調査済みは対象外）。</p>
    <div class="lbl"><label for="bud">走らせられる延長（仮の値）</label><span id="bud-out">${STATE.budgetKm.toFixed(1)} km</span></div>
    <input id="bud" type="range" min="1" max="8" step="0.5" value="${STATE.budgetKm}">
    <p class="note">予算・車両台数などの制約を延長で置き換えた仮の値で、実際の調査能力を表すものではありません。</p>
    <button class="btn pri" id="auto" type="button">点数の上位から自動で選ぶ</button><button class="btn" id="clear" type="button">選択をクリア</button>
    <p>選択中: <span class="big">${sel.size}</span> 区間 / <span id="sel-km" class="${over ? 'over' : ''}">${fmt1(km)} km</span>${over ? ' <span class="over">（上限を超えています）</span>' : ''}</p>
    ${rows.length ? `<table><thead><tr><th>区間</th><th>区画</th><th class="n">点数</th></tr></thead><tbody>${rows.slice(0, 8).map((s) => `<tr data-id="${s.id}" tabindex="0" class="pick"><td>${s.id}</td><td>${s.cell}</td><td class="n">${s.score.toFixed(2)}</td></tr>`).join('')}</tbody></table>${rows.length > 8 ? `<p class="note">ほか ${rows.length - 8} 区間</p>` : ''}` : '<p class="note">まだ選んでいません。</p>'}
    <button class="btn" id="back1" type="button">戻る</button><button class="btn pri" id="to3" type="button" ${sel.size && !over ? '' : 'disabled'}>次へ：結果を戻す</button>`;
  $('#bud').oninput = (e) => { STATE.budgetKm = +e.target.value; $('#bud-out').textContent = STATE.budgetKm.toFixed(1) + ' km'; const k = totalKm(STATE.segs, STATE.selected); $('#sel-km').className = k > STATE.budgetKm + 1e-9 ? 'over' : ''; $('#to3').disabled = !(STATE.selected.size && k <= STATE.budgetKm + 1e-9); };
  $('#bud').onchange = () => render();
  $('#auto').onclick = () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); };
  $('#clear').onclick = () => { STATE.selected = new Set(); render(); };
  $('#back1').onclick = () => setStep(1);
  $('#to3').onclick = () => setStep(3);
  bindRows('#s2');
}

function renderS3() {
  const sel = STATE.selected, km = totalKm(STATE.segs, sel);
  const res = [...STATE.scannedNew].filter(([id]) => STATE.lastBatch && STATE.lastBatch.includes(id));
  let h = `<h2>第3段階：確認結果を点数に戻して較正する</h2>`;
  if (!STATE.revealed) {
    h += `<p>選んだ <b>${sel.size}</b> 区間（${fmt1(km)} km）を地中レーダで走査した、と想定して結果を表示します。</p>
      <p class="note">結果は乱数で作ったシミュレーションで、実際の走査結果ではありません。</p>
      <button class="btn pri" id="scan" type="button" ${sel.size ? '' : 'disabled'}>走査結果を見る（サンプル）</button>
      <button class="btn" id="back2" type="button">戻る</button>`;
  } else {
    const hit = res.filter(([, v]) => v).length;
    const c = STATE.calib;
    h += `<p>走査した <b>${res.length}</b> 区間のうち、空洞の疑いあり <span class="chip hit">疑い ${hit}</span>、異常なし <span class="chip ok">なし ${res.length - hit}</span>。</p>
      <p class="note">疑いありの区間は管内カメラ調査等の追加確認に回す想定です（このデモでは扱いません）。</p>`;
    if (c && c.w === null) {
      h += `<p class="over">較正に使える結果が不足しています（空洞あり ${c.pos} 件・なし ${c.neg} 件。各3件以上で較正）。重みは変えません。</p>`;
    } else if (c) {
      const ex0 = c.ex0, ex1 = c.ex1;
      h += `<p>これまでの調査結果（過去の調査${surveyedSet().length - STATE.scannedNew.size}区間＋今回までの走査${STATE.scannedNew.size}区間、すべてサンプル）に照らして、重みを探しました。</p>
      <table><thead><tr><th>点数のつけ方</th><th class="n">当たりやすさ(AUC)</th></tr></thead><tbody>
        <tr><td>台帳のみ（衛星0%）</td><td class="n">${c.ledgerOnly.toFixed(2)}</td></tr>
        <tr><td>衛星のみ（100%）</td><td class="n">${c.satOnly.toFixed(2)}</td></tr>
        <tr class="pick"><td>採用: 衛星 ${pct(c.w)}%</td><td class="n">${aucAt(surveyedSet(), STATE.cellSat, c.w).toFixed(2)}</td></tr></tbody></table>
      <p class="note">AUC: 空洞のあった区間が、なかった区間より高い点数になる確率（0.5=当てずっぽう、1=完全）。${ex1 ? `点数が下位の半分とした区間（${ex1.n}区間）のうち異常なしだった割合は ${pct(ex1.rate)}%${ex0 ? `（較正前の重みでは ${pct(ex0.rate)}%）` : ''}。` : ''}サンプル上の数字であり、提案の効果を示すものではありません。</p>`;
    }
    h += `<button class="btn pri" id="apply" type="button">較正を反映して第${STATE.round + 1}回へ</button>`;
  }
  $('#s3').innerHTML = h;
  if (!STATE.revealed) {
    $('#scan') && ($('#scan').onclick = doScan);
    $('#back2') && ($('#back2').onclick = () => setStep(2));
  } else {
    $('#apply').onclick = applyCalib;
  }
}

function doScan() {
  const ids = [...STATE.selected];
  STATE.lastBatch = ids;
  const before = { w: STATE.w, ex0: null };
  for (const id of ids) { const s = STATE.segs.find((x) => x.id === id); STATE.scannedNew.set(id, s.sim_cavity); s.surveyed = true; }
  STATE.selected = new Set();
  const data = surveyedSet();
  const c = calibrate(data, STATE.cellSat);
  c.ex0 = exclusionAccuracy(data, STATE.cellSat, before.w);
  c.ex1 = c.w === null ? null : exclusionAccuracy(data, STATE.cellSat, c.w);
  STATE.calib = c; STATE.revealed = true;
  render();
}
function applyCalib() {
  if (STATE.calib && STATE.calib.w !== null) STATE.w = STATE.calib.w;
  STATE.msg = STATE.calib && STATE.calib.w !== null ? `較正済み: 衛星指標の重みを ${pct(STATE.w)}% に更新しました。順位が変わっています。` : '較正に使える結果が不足していたため、重みは変えていません。';
  STATE.round += 1; STATE.revealed = false; STATE.calib = null; STATE.lastBatch = null;
  setStep(1);
}

function setStep(n) { STATE.step = n; render(); syncDetail(); }

function renderLegend() {
  $('#legend').innerHTML = `<div><b>凡例</b></div>
    <div>道路の点数（高いほど先に確かめたい）</div><div class="grad"></div><div class="lg" style="justify-content:space-between"><span>低</span><span>高</span></div>
    <div class="lg"><span class="sw" style="border-color:#6f7d86;border-top-style:dashed"></span>調査済み・幹線（点数の対象外）</div>
    <div class="lg"><span class="sw" style="border-color:#00a3c4;border-top-width:6px"></span>選択した区間</div>
    <div class="lg"><span class="dot" style="background:#d55e00;border:3px solid #fff;outline:1px solid #555"></span>空洞の疑い（大・濃い色）　<span class="dot" style="background:#fff;border:2px solid #0072b2"></span>異常なし（小・白抜き）</div>
    <div class="lg"><span class="dot" style="background:#b9c9a8"></span>区画の色: 地表変位の指標（濃いほど沈下傾向が大きい・サンプル値）</div>`;
}

function segDetail(id) {
  const s = STATE.ranked.find((x) => x.id === id); if (!s) return '';
  const a = ageNorm(s.year), sat = STATE.cellSat[s.cell];
  const done = STATE.scannedNew.has(id) ? STATE.scannedNew.get(id) : null;
  return `<h3>区間 ${s.id}（${s.cls === 'arterial' ? '幹線・調査済み' : '生活道路'}）</h3>
    <p>区画 ${s.cell}／長さ ${s.lenM} m／布設 ${s.year}年（経過 ${NOW_YEAR - s.year}年）<br>
    点数 <b>${s.score.toFixed(2)}</b> ＝ 衛星 ${pct(STATE.w)}% × 区画値 ${sat.toFixed(2)} ＋ 台帳 ${pct(1 - STATE.w)}% × 古さ ${a.toFixed(2)}<br>
    ${s.cls === 'arterial' ? '過去に調査済み（サンプル）。' : s.surveyed ? (done === null ? '過去に調査済み（サンプル）。' : `今回の走査結果: <span class="chip ${done ? 'hit' : 'ok'}">${done ? '空洞の疑い' : '異常なし'}</span>`) : STATE.selected.has(id) ? '選択中。' : '未調査。'}</p>`;
}
function syncDetail() { $('#detail').innerHTML = STATE.focus ? segDetail(STATE.focus) : '<p class="note">地図の道路をタップすると、点数の内訳を表示します。</p>'; }
function focusSeg(id) {
  STATE.focus = id; syncDetail();
  const s = STATE.segs.find((x) => x.id === id);
  if (map && s) map.easeTo({ center: [(s.coords[0][0] + s.coords[1][0]) / 2, (s.coords[0][1] + s.coords[1][1]) / 2], duration: 400 });
}
function toggleSeg(id) {
  const s = STATE.segs.find((x) => x.id === id);
  if (STATE.step !== 2 || !s || s.cls !== 'life' || s.surveyed) return;
  if (STATE.selected.has(id)) STATE.selected.delete(id); else STATE.selected.add(id);
  render();
}

function about() {
  $('#about-body').innerHTML = `
  <h3>このデモは何か</h3>
  <p>「衛星で絞り、地中レーダで確かめる 路面下リスクの二段階調査」（衛星データ活用アワード2026–2027 応募提案）の流れを、地図上で一通り体験するための最小限のデモです。衛星の解析（InSAR処理）やレーダの解析は実装していません。</p>
  <h3>データ（すべてサンプル・架空）</h3>
  <ul>
  <li>道路網・区画: 乱数で作った架空の格子状の街（「サンプル市」）。座標は便宜上の位置で、実在の地点ではありません。</li>
  <li>衛星由来の指標: 区画ごとの地表変位（mm/年）を人が決めた式と乱数で作ったサンプル値。実際のSentinel-1の解析結果ではありません。</li>
  <li>下水道台帳の属性: 布設年を乱数で与えたもの。実在の台帳ではありません。</li>
  <li>地中レーダの結果: 乱数によるシミュレーション。実際のGMS3の走査結果ではなく、特定企業の製品画面・データでもありません。</li>
  <li>生成: tools/generate_sample.mjs（固定シード）。底図は使っていません（架空の街のため）。</li>
  </ul>
  <h3>点数・較正の計算</h3>
  <ul>
  <li>点数 ＝ 衛星の重み × 区画の沈下指標（−8mm/年以下で1）＋ 台帳の重み × 管の古さ（60年で1）。いずれの上限値もデモ上の便宜的な正規化です。</li>
  <li>較正: これまでの調査結果に対し、重み（0〜100%）ごとの当たりやすさ（AUC）を比べて最大の重みを採用します。空洞あり／なしが各3件未満なら較正しません。</li>
  </ul>
  <h3>限界</h3>
  <ul>
  <li>画面の数字は架空データ上の計算で、実際の精度・効果・費用を示しません。</li>
  <li>提案の趣旨どおり、衛星は空洞を直接検出しません。生活道路の幅に対する衛星画素の粗さなど、実データで確かめるべき課題は未検証です。</li>
  <li>過去の調査結果は幹線に偏る設定で、較正の母集団の偏りは扱っていません。</li>
  </ul>
  <h3>ライブラリ・ライセンス</h3>
  <ul><li>MapLibre GL JS 4.7.1（BSD-3-Clause、vendor/ に同梱）</li></ul>`;
}

async function init() {
  const data = await (await fetch('data/sample.json')).json();
  STATE.data = data; STATE.segs = data.segments.map((s) => ({ ...s }));
  STATE.cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]));
  recompute(); render(); syncDetail(); about();

  map = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eceae3' } }] },
    center: [0.0072, 0.0054], zoom: 14, attributionControl: false, dragRotate: false });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'サンプル（架空）データ ／ MapLibre GL JS' }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  const mobile = innerWidth < 720;
  map.fitBounds([[-0.0006, -0.0006], [0.015, 0.0114]], { padding: mobile ? { top: 40, left: 10, right: 10, bottom: innerHeight * 0.58 } : { top: 30, bottom: 30, right: 30, left: 430 }, duration: 0 });
  map.on('load', () => {
    map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: data.cells.map((c) => ({ type: 'Feature', properties: { id: c.id, sat: STATE.cellSat[c.id] }, geometry: { type: 'Polygon', coordinates: [c.ring] } })) } });
    map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'sat'], 0, '#f1efe6', 1, '#8aa07a'], 'fill-opacity': 0.5 } });
    map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': '#a9b39f', 'line-width': 1 } });
    map.addSource('segs', { type: 'geojson', data: segFC() });
    map.addLayer({ id: 'seg-sel', type: 'line', source: 'segs', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#00a3c4', 'line-width': 12, 'line-opacity': 0.85 } });
    map.addLayer({ id: 'seg-done', type: 'line', source: 'segs', filter: ['==', ['get', 'done'], 1], paint: { 'line-color': '#6f7d86', 'line-width': 4, 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'seg-todo', type: 'line', source: 'segs', filter: ['==', ['get', 'done'], 0], layout: { 'line-cap': 'round' }, paint: { 'line-color': SCORE_COLOR, 'line-width': ['case', ['==', ['get', 'cls'], 'arterial'], 3, 5] } });
    map.addSource('res', { type: 'geojson', data: resFC() });
    map.addLayer({ id: 'res-ok', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 0], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#0072b2', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'res-hit', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 1], paint: { 'circle-radius': 10, 'circle-color': '#d55e00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    for (const c of data.cells) {
      const el = document.createElement('div'); el.className = 'cell-label'; el.textContent = `${c.id} ${c.disp.toFixed(1)}mm/年`;
      const [x0, y0] = c.ring[0], [x1, y1] = c.ring[2];
      cellMarkers.push(new maplibregl.Marker({ element: el, anchor: 'top-left' }).setLngLat([x0 + 0.00015, y1 - 0.00012 > y0 ? y1 - 0.00012 : y0]).addTo(map));
    }
    map.on('click', (e) => {
      const r = 9, f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['seg-todo', 'seg-done'] });
      if (!f.length) return;
      const id = f[0].properties.id; STATE.focus = id; toggleSeg(id); syncDetail();
    });
    map.on('mousemove', (e) => { const r = 6; map.getCanvas().style.cursor = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['seg-todo', 'seg-done'] }).length ? 'pointer' : ''; });
    refreshMap();
    window.__ready = true;
  });
}

document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
$('#sheet-toggle').onclick = () => { const p = $('#panel'); p.classList.toggle('closed'); $('#sheet-toggle').setAttribute('aria-expanded', String(!p.classList.contains('closed'))); };
$('#btn-about').onclick = () => { $('#modal').hidden = false; $('#btn-close').focus(); };
$('#btn-close').onclick = () => { $('#modal').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

window.App = { STATE, getMap: () => map, setStep, toggleSeg, doScan, applyCalib, render, focusSeg,
  autoSelect: () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); } };
init();
