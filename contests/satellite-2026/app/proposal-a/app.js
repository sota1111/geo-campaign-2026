import { rank, selectByBudget, totalKm, satNorm, ageNorm, calibrate, exclusionAccuracy, aucAt, topShift, NOW_YEAR } from './logic.js';

const $ = (s) => document.querySelector(s);
const pct = (x) => Math.round(x * 100);
const fmt1 = (x) => x.toFixed(1);
const fmtRange = (r) => `${r[0].toFixed(2).replace(/\.?0+$/, '')}〜${r[1] > 0 ? '+' : ''}${r[1].toFixed(2).replace(/\.?0+$/, '')}`;
const yearTxt = (y) => (y == null ? '不明' : `${y}年`);
const cellOf = (id) => STATE.cellById[id];
const rangeOf = (id) => fmtRange(cellOf(id).range);
const STATE = { data: null, cellById: {}, segs: [], cellSat: {}, w: 0.1, budgetKm: 3, step: 1, round: 1, selected: new Set(),
  scannedNew: new Map(), revealed: false, calib: null, ranked: [], focus: null, msg: '' };
let map = null;

const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#3f6e9e', 0.5, '#e89200', 1, '#7a0f5c'];
const segFC = () => ({ type: 'FeatureCollection', features: STATE.ranked.map((s) => ({ type: 'Feature',
  properties: { id: s.id, score: s.score, cls: s.cls, none: s.cls === 'noledger' ? 1 : 0, done: s.surveyed ? 1 : 0, sel: STATE.selected.has(s.id) ? 1 : 0 },
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
  map.setPaintProperty('cells-fill', 'fill-opacity', STATE.step === 1 ? 0.28 : 0.1);
  map.setPaintProperty('cells-hatch', 'fill-opacity', STATE.step === 1 ? 0.8 : 0.25);
}

function render() {
  recompute();
  $('#round').textContent = `第${STATE.round}回`;
  ['1', '2', '3'].forEach((k) => { $('#tab-' + k).setAttribute('aria-selected', String(+k === STATE.step)); $('#s' + k).hidden = +k !== STATE.step; });
  if (STATE.step === 1) renderS1(); else if (STATE.step === 2) renderS2(); else renderS3();
  renderLegend();
  refreshMap();
}

const s1Row = (s) => `<tr data-id="${s.id}" tabindex="0"><td>${s.id}</td><td>${rangeOf(s.cell)}</td><td class="n">${yearTxt(s.year)}</td><td class="n">${s.score.toFixed(2)}</td></tr>`;
/** 衛星の点数がどれだけ順位を動かしているか（台帳のみの上位20区間からの入れ替わり数）。絞れない地域では小さいままになる。 */
function satEffect() {
  const n = 20, shift = topShift(STATE.segs, STATE.cellSat, STATE.w, n);
  const c = candidates(), t = c.length ? c[0].score.toFixed(2) : null;
  const ties = c.filter((x) => x.score.toFixed(2) === t).length;
  return `台帳のみ（0%）の上位${n}区間に無かった区間が上位${n}に入った数: <b>${shift}</b>（入れ替わりは階級幅以内の差によるもので、意味のある差ではありません）。1位と同点（小数2桁）の区間: <b>${ties}</b> 区間${ties >= 50 ? '。<b>表と自動選定は同点のとき区間番号の順</b>です' : ''}。`;
}

function renderS1() {
  const c = candidates(), km = c.reduce((a, s) => a + s.lenM, 0) / 1000;
  const top = c.slice(0, 8);
  const cc = STATE.data.stats.cell_with_roads_class_counts, k7 = cc['7'] || 0, k8 = cc['8'] || 0;
  $('#s1').innerHTML = `
    <h2>第1段階：衛星と台帳で区間に点数を付ける</h2>
    <p><b>衛星の変位と台帳を重ねて点数化します。この地区は変位がほぼ平坦なため、台帳の古さが主に順位を決めます。</b></p>
    <p class="note">区画（約90m）の色と斜線は衛星の階級（国土地理院の干渉SAR）、道路の色は点数。衛星は空洞を直接見つけず、調べる順番を決める入口です。道路をクリック（タップ）すると内訳が上に出ます。</p>
    <p class="note">この地区の2階級（-3.75〜0 mm/年が ${k7} 区画、0〜+3.75 mm/年が ${k8} 区画）の差は階級幅（3.75 mm/年）以内で、沈下の兆候とは言えません。衛星の点数は最大でも ${satNorm(STATE.data.cells.reduce((m, x) => Math.min(m, x.disp), 0)).toFixed(2)}。重みを上げて試すと、順位は2階級のどちらかで二分され、同点が増えます。</p>
    ${STATE.msg ? `<p class="note"><b>${STATE.msg}</b></p>` : ''}
    <div class="lbl"><label for="w">衛星指標の重み</label><span id="w-out">${pct(STATE.w)}%</span></div>
    <input id="w" type="range" min="0" max="100" step="10" value="${pct(STATE.w)}" aria-describedby="w-note">
    <p id="w-note" class="note">0% = 台帳（竣工年）だけ ／ 100% = 衛星の階級だけ（階級が同じ区間は同点）。第3段階の較正で自動的に更新されます。この地区では台帳中心（衛星10%）から始めます。</p>
    <p class="note" id="w-shift">${satEffect()}</p>
    <p><span class="big">${c.length}</span> 区間（${fmt1(km)} km）が未調査の生活道路。点数の高い順:</p>
    <table><thead><tr><th>区間</th><th>衛星の階級(mm/年)</th><th class="n">竣工年</th><th class="n">点数</th></tr></thead><tbody>
    ${top.map(s1Row).join('')}
    </tbody></table>
    <div class="stickybar"><button class="btn pri" id="to2" type="button">次へ：確かめる区間を選ぶ</button></div>`;
  $('#w').oninput = (e) => { STATE.w = +e.target.value / 100; STATE.msg = ''; recompute(); $('#w-out').textContent = pct(STATE.w) + '%'; $('#w-shift').innerHTML = satEffect(); refreshMap(); renderS1Table(); };
  $('#to2').onclick = () => setStep(2);
  bindRows('#s1');
}
function renderS1Table() { // スライダー操作中はフォーカスを保つため表だけ更新
  $('#s1 tbody').innerHTML = candidates().slice(0, 8).map(s1Row).join('');
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
    <p class="note">地図の道路をクリック（タップ）すると選択／解除できます（未調査の生活道路のみ。幹線・調査済み・台帳に管渠が紐づかない道路は対象外）。</p>
    <div class="lbl"><label for="bud">走らせられる延長（仮の値）</label><span id="bud-out">${STATE.budgetKm.toFixed(1)} km</span></div>
    <input id="bud" type="range" min="1" max="8" step="0.5" value="${STATE.budgetKm}">
    <p class="note">予算・車両台数などの制約を延長で置き換えた仮の値で、実際の調査能力を表すものではありません。</p>
    <button class="btn pri" id="auto" type="button">点数の上位から自動で選ぶ</button><button class="btn" id="clear" type="button">選択をクリア</button>
    <p>選択中: <span class="big">${sel.size}</span> 区間 / <span id="sel-km" class="${over ? 'over' : ''}">${fmt1(km)} km</span>${over ? ' <span class="over">（上限を超えています）</span>' : ''}</p>
    ${rows.length ? `<table><thead><tr><th>区間</th><th>竣工年</th><th class="n">長さ</th><th class="n">点数</th></tr></thead><tbody>${rows.slice(0, 8).map((s) => `<tr data-id="${s.id}" tabindex="0" class="pick"><td>${s.id}</td><td>${yearTxt(s.year)}</td><td class="n">${s.lenM} m</td><td class="n">${s.score.toFixed(2)}</td></tr>`).join('')}</tbody></table>${rows.length > 8 ? `<p class="note">ほか ${rows.length - 8} 区間</p>` : ''}` : '<p class="note">まだ選んでいません。</p>'}
    <div class="stickybar"><button class="btn" id="back1" type="button">戻る</button><button class="btn pri" id="to3" type="button" ${sel.size && !over ? '' : 'disabled'}>次へ：結果を戻す</button></div>`;
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
      <p class="note"><b>地中レーダの結果だけは架空</b>です。乱数で作ったシミュレーションで、実際の走査結果ではありません（衛星・道路・台帳は実データ）。</p>
      <div class="stickybar"><button class="btn pri" id="scan" type="button" ${sel.size ? '' : 'disabled'}>走査結果を見る（架空）</button>
      <button class="btn" id="back2" type="button">戻る</button></div>`;
  } else {
    const hit = res.filter(([, v]) => v).length;
    const c = STATE.calib;
    h += `<p>走査した <b>${res.length}</b> 区間のうち、空洞の疑いあり <span class="chip hit">疑い ${hit}</span>、異常なし <span class="chip ok">なし ${res.length - hit}</span>。</p>
      <p class="note">疑いありの区間は管内カメラ調査等の追加確認に回す想定です（このデモでは扱いません）。</p>`;
    if (c && c.w === null) {
      h += `<p class="over">較正に使える結果が不足しています（空洞あり ${c.pos} 件・なし ${c.neg} 件。各3件以上で較正）。重みは変えません。</p>`;
    } else if (c) {
      const ex0 = c.ex0, ex1 = c.ex1;
      h += `<p>これまでの調査結果（過去の調査${surveyedSet().length - STATE.scannedNew.size}区間＋今回までの走査${STATE.scannedNew.size}区間。空洞の有無はすべて架空）に照らして、重みを探しました。</p>
      <table><thead><tr><th>点数のつけ方</th><th class="n">当たりやすさ(AUC)</th></tr></thead><tbody>
        <tr><td>台帳のみ（衛星0%）</td><td class="n">${c.ledgerOnly.toFixed(2)}</td></tr>
        <tr><td>衛星のみ（100%）</td><td class="n">${c.satOnly.toFixed(2)}</td></tr>
        <tr class="pick"><td>採用: 衛星 ${pct(c.w)}%</td><td class="n">${aucAt(surveyedSet(), STATE.cellSat, c.w).toFixed(2)}</td></tr></tbody></table>
      <p class="note">AUC: 空洞のあった区間が、なかった区間より高い点数になる確率（0.5=当てずっぽう、1=完全）。${ex1 ? `点数が下位の半分とした区間（${ex1.n}区間）のうち異常なしだった割合は ${pct(ex1.rate)}%${ex0 ? `（較正前の重みでは ${pct(ex0.rate)}%）` : ''}。` : ''}空洞の有無が架空のため、これは仕組みを見せる数字であり、実際の精度や提案の効果を示すものではありません。</p>`;
    }
    h += `<div class="stickybar"><button class="btn pri" id="apply" type="button">較正を反映して第${STATE.round + 1}回へ</button></div>`;
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

function setStep(n) { STATE.step = n; STATE.focus = null; STATE.focusCell = null; render(); syncDetail(); }

function renderLegend() {
  const pal = STATE.data.satellite.palette, used = [...new Set(STATE.data.cells.map((c) => c.k))].sort((x, y) => x - y);
  const chips = used.map((k) => { const c = STATE.data.cells.find((x) => x.k === k); return `<div class="lg"><span class="sw sq" style="background:${pal[k]};${STATE.data.cells.find((x) => x.k === k).range[1] <= 0 ? 'background-image:repeating-linear-gradient(45deg,#4d5c64 0 1px,transparent 1px 5px)' : ''}"></span>区画の${STATE.data.cells.find((x) => x.k === k).range[1] <= 0 ? '斜線' : '色'} ${fmtRange(c.range)} mm/年（階級の幅 ${c.dispW} mm/年）</div>`; }).join('');
  $('#legend').innerHTML = `<div><b>凡例</b></div>
    ${chips}
    <div class="note">この地区の2階級の差は沈下の兆候ではありません（階級幅 3.75 mm/年以内）。</div>
    <div class="lg"><span class="sw" style="border-color:#59656d;border-top-style:dashed"></span>調査済み（幹線と一部の生活道路。架空）</div>
    <div class="lg"><span class="sw" style="border-color:#8a969d;border-top-width:2px;border-top-style:dotted"></span>台帳に管渠が紐づかない道路（点数の対象外）</div>
    <div>道路の点数（高いほど先に確かめたい）</div><div class="grad"></div><div class="lg" style="justify-content:space-between"><span>低</span><span>高</span></div>
    <div class="lg"><span class="sw" style="border-color:#1a237e;border-top-width:6px"></span>選択した区間</div>
    <div class="lg"><span class="dot" style="background:#d55e00;border:3px solid #fff;outline:1px solid #555"></span>空洞の疑い（大・濃い色）　<span class="dot" style="background:#fff;border:2px solid #0072b2"></span>異常なし（小・白抜き）　※レーダ結果は架空</div>`;
}

function segDetail(id) {
  const s = STATE.ranked.find((x) => x.id === id); if (!s) return '';
  const a = ageNorm(s.year), sat = STATE.cellSat[s.cell], c = cellOf(s.cell);
  const done = STATE.scannedNew.has(id) ? STATE.scannedNew.get(id) : null;
  const kind = s.cls === 'arterial' ? '幹線・調査済み（架空）' : s.cls === 'noledger' ? '台帳に管渠が紐づかない道路' : '生活道路';
  const ledger = s.cls === 'noledger' ? '台帳: 15m以内に豊中市の管渠なし（市外・私道・未整備・位置のずれ等。理由は未特定）'
    : `台帳: 竣工 ${yearTxt(s.year)}${s.year == null ? '（台帳で不明。古さは中立の0.5で扱う）' : `（経過 ${NOW_YEAR - s.year}年）`}${s.dia ? `／管径 ${s.dia} mm` : ''}`;
  return `<h3>区間 ${s.id}${s.name ? `（${s.name}）` : ''}：${kind}</h3>
    <p>長さ ${s.lenM} m／OSM道路種別 ${s.hw}<br>
    衛星: 区画 ${s.cell} の階級 ${fmtRange(c.range)} mm/年（約90m・幅 ${c.dispW} mm/年。中央値 ${c.disp} で計算）<br>
    ${ledger}<br>
    ${s.cls === 'noledger' ? '' : `点数 <b>${s.score.toFixed(2)}</b> ＝ 衛星 ${pct(STATE.w)}% × 衛星の値 ${sat.toFixed(2)} ＋ 台帳 ${pct(1 - STATE.w)}% × 古さ ${a.toFixed(2)}<br>`}
    ${s.cls === 'arterial' ? '過去に調査済み（架空）。' : s.cls === 'noledger' ? '' : s.surveyed ? (done === null ? '過去に調査済み（架空）。' : `今回の走査結果（架空）: <span class="chip ${done ? 'hit' : 'ok'}">${done ? '空洞の疑い' : '異常なし'}</span>`) : STATE.selected.has(id) ? '選択中。' : '未調査。'}</p>`;
}
function cellDetail(id) {
  const c = cellOf(id); if (!c) return '';
  return `<h3>衛星の区画 ${c.id}</h3><p>変位速度（準上下方向）の階級 <b>${fmtRange(c.range)} mm/年</b>（約90m、階級の幅 ${c.dispW} mm/年。小数の精度はありません）。国土地理院は「数百m四方より狭い変動の把握は困難」としており、生活道路単位の値ではありません。</p>`;
}
function syncDetail() {
  const body = STATE.focusCell ? cellDetail(STATE.focusCell) : STATE.focus ? segDetail(STATE.focus) : '';
  $('#detail').innerHTML = body ? body + '<button class="btn" id="detail-close" type="button">詳細を閉じる</button>' : '';
  const dc = $('#detail-close'); if (dc) dc.onclick = () => { STATE.focus = null; STATE.focusCell = null; syncDetail(); };
  if (map && map.getLayer('seg-focus')) map.setFilter('seg-focus', ['==', ['get', 'id'], STATE.focusCell ? '' : STATE.focus || '']);
}
function focusSeg(id) {
  STATE.focus = id; STATE.focusCell = null; syncDetail();
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
  const st = STATE.data.stats, r15 = st.match_rate_by_threshold['15m'], r10 = st.match_rate_by_threshold['10m'], r25 = st.match_rate_by_threshold['25m'];
  const pr = (r) => (r.rate * 100).toFixed(1) + '%';
  const bb = STATE.data.area.bbox;
  $('#about-body').innerHTML = `
  <div class="sum"><b>要点</b>
  <ul><li><b>実データ</b>: 衛星（国土地理院の干渉SAR）・道路（OpenStreetMap）・下水道台帳（豊中市）</li>
  <li><b>架空</b>: 地中レーダの結果（と過去の調査済み区分）だけ。乱数のシミュレーション</li>
  <li><b>Sentinel-1 ではありません</b>。提案書は Sentinel-1 の解析を主に想定（ALOS-4 は比較検証）。このデモは国土地理院の公開成果（だいち2号・4号）で代用</li></ul></div>
  <h3>このデモは何か</h3>
  <p>「衛星で絞り、地中レーダで確かめる 路面下リスクの二段階調査」（衛星データ活用アワード2026–2027 応募提案）の流れを、<b>実在の地域（${STATE.data.area.name}）の実データ</b>で一通り体験するための最小限のデモです。衛星の解析（InSAR処理）とレーダの解析は実装していません。立場は「衛星は空洞を直接見つけず、地上調査の投入先を選ぶ」です。</p>
  <h3>衛星データについて（提案書との関係）</h3>
  <p><b>提案書は Sentinel-1 の解析を主に想定しています（ALOS-4 は比較検証）。このデモは、公開済みの国土地理院の成果（だいち2号・4号）で代用しています。</b>Sentinel-1 の解析結果ではありません。</p>
  <ul>
  <li>使った値: 国土地理院「衛星SAR地盤変動測量成果」の変位速度（準上下方向）の地理院タイル（${STATE.data.satellite.layer}）。ALOS-2/4（Lバンド）、約90m、階級 ${STATE.data.satellite.class_width_mm_yr} mm/年幅（-30〜+30 mm/年を16階級）。</li>
  <li>タイルの色を凡例の16階級に戻し、90m程度の区画ごとに階級の中央値を取りました。値は<b>階級の幅でしか言えません</b>（小数の精度はありません）。区画の有効画素が半分未満の所は衛星データなしとして外しています。</li>
  <li>国土地理院は「数百m四方より狭い変動の把握は困難」としています。生活道路の幅に対して粗く、区間単位の値ではありません。</li>
  <li>この地区の階級は2種類だけで、その差は階級幅（3.75 mm/年）以内です。沈下の兆候とは言えません。豊中市のほとんどは地表変位がほぼ平坦で、衛星の点数ではほとんど絞れません。この地区は、豊中市周辺の矩形（経度135.43〜135.51、緯度34.74〜34.83）を調べたうえで、階級が複数に分かれて見えた北東部から選びました（調べた範囲の大半は 0〜+3.75 mm/年の1階級）。</li>
  </ul>
  <h3>データと出典</h3>
  <ul>
  <li><b>衛星</b>: 解析：国土地理院 原初データ所有：JAXA（地理院コンテンツ利用規約）。階級に戻して区画に集計するなど加工して作成しています。</li>
  <li><b>道路</b>: © OpenStreetMap contributors。車道（幹線〜生活道路）を、交差点・長さ（150m）・曲がりで区間に分割し、加工して作成。取得日 2026-11-21。<b>この道路データ（data/toyonaka.json の道路形状）は Open Database License（ODbL）で提供します。</b>著作権とライセンス: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">https://www.openstreetmap.org/copyright</a></li>
  <li><b>下水道の台帳</b>: 豊中市「下水道（管渠）」（<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener">CC BY 4.0</a>、BODIK オープンデータ <a href="https://data.bodik.jp/dataset/272035_gesuido" target="_blank" rel="noopener">data.bodik.jp/dataset/272035_gesuido</a>）。竣工日と管径を使用し、加工して作成。竣工日が不明（9999）の管渠は市全体で ${st.sewer_unknown_year_all} / ${st.sewer_total_records} 本。</li>
  <li><b>地中レーダの結果だけは架空</b>: 乱数によるシミュレーション（sim_cavity）。実際の走査結果ではなく、特定企業の製品画面・データでもありません。「過去に調査済み」の区間（幹線と一部の生活道路）の結果も架空です。</li>
  <li>底図は使っていません。生成: tools/ 以下のスクリプト（取得は GET のみ）。</li>
  </ul>
  <h3>道路と台帳の突き合わせ</h3>
  <ul>
  <li>対象範囲: 経度 ${bb[0]}〜${bb[2]}、緯度 ${bb[1]}〜${bb[3]} のうち、豊中市の管渠が100m以内にある道路区間 ${st.segments} 本（衛星の区画が無い ${st.osm_pieces_no_satellite_cell} 本を除く）。</li>
  <li>管渠を最近傍で紐づけ（区間上の約10mごとの点のうち半数以上が、15m以内に管渠のある区間）。紐づいた区間は ${r15.matched} / ${r15.of} ＝ <b>${pr(r15)}</b>（しきい値 10m で ${pr(r10)}、25m で ${pr(r25)}）。紐づかない区間は「台帳なし」として点数の対象外にし、地図に細い灰色で示します。</li>
  <li>区間の竣工年は、紐づいた管渠の竣工年（台帳の竣工日）の中央値。不明な管渠は除きます。紐づいた生活道路 ${st.life_year_known + st.life_year_unknown} 区間のうち竣工年が不明な区間 ${st.life_year_unknown} 本は「不明」と表示し、古さは中立の0.5で扱います。</li>
  <li>管渠の位置が道路の下とは限りません。これは竣工年の目安であり、実際に道路の下にある管の竣工年ではない場合があります。</li>
  </ul>
  <h3>点数・較正の計算</h3>
  <ul>
  <li>点数 ＝ 衛星の重み × 区画の階級の中央値から作る指標（-8mm/年以下で1） ＋ 台帳の重み × 管の古さ（60年で1）。上限値はいずれもデモ上の便宜的な正規化です。この地区の衛星の指標は最大でも 0.23（階級 -3.75〜0 の区画）で、0〜+3.75 は 0 です。</li>
  <li>較正: これまでの調査結果に対し、重み（0〜100%）ごとの当たりやすさ（AUC）を比べて最大の重みを採用します。空洞あり／なしが各3件未満なら較正しません。較正に使う結果は<b>架空</b>なので、数字は実際の精度ではありません。</li>
  </ul>
  <h3>限界</h3>
  <ul>
  <li>画面の AUC・除外精度は架空の空洞結果に対する計算で、実際の精度・効果・費用を示しません。</li>
  <li>衛星は空洞を直接検出しません。生活道路の幅に対する衛星画素の粗さ、反射点の偏りは、本デモでも解消していません。</li>
  <li>この地区は衛星の階級がほぼ一様で、「衛星で絞る」効果は見えず、台帳の古さが主に順位を決めます。沈下の大きい地域では異なる可能性がありますが、そのような地域の下水道台帳の公開データは確認できていません。</li>
  <li>国土地理院成果の静的な派生データ（階級の区画値）の公開可否は、地理院の利用条件に照らして要確認です。</li>
  </ul>
  <h3>ライブラリ・ライセンス</h3>
  <ul><li>MapLibre GL JS 4.7.1（BSD-3-Clause、vendor/ に同梱）</li></ul>`;
}

function fit() {
  if (!map) return;
  map.resize();
  const mobile = innerWidth < 720, bb = STATE.data.area.bbox;
  map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: mobile ? { top: 46, left: 8, right: 8, bottom: 8 } : { top: 30, bottom: 30, right: 30, left: 430 }, duration: 0 });
}

function hatchImage() {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.strokeStyle = '#3c4a52'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-1, 9); g.lineTo(9, -1); g.moveTo(-1, 1); g.lineTo(1, -1); g.moveTo(7, 9); g.lineTo(9, 7); g.stroke();
  return g.getImageData(0, 0, 8, 8);
}

async function init() {
  const data = await (await fetch('data/toyonaka.json')).json();
  STATE.data = data; STATE.segs = data.segments.map((s) => ({ ...s }));
  STATE.cellById = Object.fromEntries(data.cells.map((c) => [c.id, c]));
  STATE.cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]));
  recompute(); render(); syncDetail(); about();

  map = new maplibregl.Map({ container: 'map', style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eceae3' } }] },
    center: [(data.area.bbox[0] + data.area.bbox[2]) / 2, (data.area.bbox[1] + data.area.bbox[3]) / 2], zoom: 13, attributionControl: false, dragRotate: false });
  window.__fit = fit;
  map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '解析：国土地理院 原初データ所有：JAXA／© OpenStreetMap contributors／豊中市（CC BY 4.0）／加工して作成' }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  fit();
  map.on('load', () => {
    const pal = data.satellite.palette;
    const fillColor = ['match', ['get', 'k'], ...pal.flatMap((c, k) => [k, c]), '#cccccc'];
    map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: data.cells.map((c) => ({ type: 'Feature', properties: { id: c.id, k: c.k }, geometry: { type: 'Polygon', coordinates: [c.ring] } })) } });
    map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': fillColor, 'fill-opacity': 0.55 } });
    map.addImage('hatch', hatchImage());
    map.addLayer({ id: 'cells-hatch', type: 'fill', source: 'cells', filter: ['<', ['get', 'k'], 8], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.8 } });
    map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': '#7d8a82', 'line-width': 0.5, 'line-opacity': 0.6 } });
    map.addSource('segs', { type: 'geojson', data: segFC() });
    map.addLayer({ id: 'seg-none', type: 'line', source: 'segs', filter: ['==', ['get', 'none'], 1], paint: { 'line-color': '#8a969d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 14, 1, 17, 2], 'line-dasharray': [1.5, 2] } });
    map.addLayer({ id: 'seg-focus', type: 'line', source: 'segs', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#000', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 14, 9, 17, 18], 'line-opacity': 0.55 } });
    map.addLayer({ id: 'seg-case', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 0], ['==', ['get', 'none'], 0]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 14, 4.5, 17, 8.5], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'seg-sel', type: 'line', source: 'segs', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1a237e', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 14, 9, 17, 18], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'seg-done', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 1], ['==', ['get', 'none'], 0]], paint: { 'line-color': '#59656d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 14, 1.2, 17, 3], 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'seg-todo', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 0], ['==', ['get', 'none'], 0]], layout: { 'line-cap': 'round' }, paint: { 'line-color': SCORE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 14, 2.5, 17, 6] } });
    map.addSource('res', { type: 'geojson', data: resFC() });
    map.addLayer({ id: 'res-ok', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 0], paint: { 'circle-radius': 5, 'circle-color': '#fff', 'circle-stroke-color': '#0072b2', 'circle-stroke-width': 2.5 } });
    map.addLayer({ id: 'res-hit', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 1], paint: { 'circle-radius': 10, 'circle-color': '#d55e00', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    const roadLayers = ['seg-todo', 'seg-done', 'seg-none'];
    map.on('click', (e) => {
      const r = 9, f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: roadLayers });
      if (!f.length) {
        const cf = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] });
        if (cf.length) { STATE.focusCell = cf[0].properties.id; syncDetail(); $('#panel-body').scrollTop = 0; }
        return;
      }
      const id = f[0].properties.id; STATE.focus = id; STATE.focusCell = null; toggleSeg(id); syncDetail(); $('#panel-body').scrollTop = 0;
    });
    map.on('mousemove', (e) => { const r = 6; map.getCanvas().style.cursor = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: roadLayers }).length ? 'pointer' : ''; });
    syncDetail();
    refreshMap();
    window.__ready = true;
  });
}

document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
$('#sheet-toggle').onclick = () => { const p = $('#panel'); p.classList.toggle('closed'); const closed = p.classList.contains('closed'); document.body.classList.toggle('sheet-closed', closed); $('#sheet-toggle').setAttribute('aria-expanded', String(!closed)); setTimeout(fit, 260); };
window.addEventListener('resize', () => fit());
const openAbout = () => { $('#modal').hidden = false; const box = $('.modal-box'); box.scrollTop = 0; box.focus({ preventScroll: true }); };
$('#btn-about').onclick = openAbout;
$('#btn-close').onclick = () => { $('#modal').hidden = true; };
$('#btn-close2').onclick = () => { $('#modal').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

window.App = { STATE, getMap: () => map, setStep, toggleSeg, doScan, applyCalib, render, focusSeg,
  autoSelect: () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); } };
init();
