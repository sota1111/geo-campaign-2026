import { rank, selectByBudget, totalKm, satNorm, ageNorm, calibrate, exclusionAccuracy, aucAt, topShift, parseOutcomes, scannedFrom, LINK_MAX_M, NOW_YEAR } from './logic.js';
import { verifyHtml } from './verify.js';

const $ = (s) => document.querySelector(s);
const BADGE_DEFAULT = '実データ（衛星・道路・台帳）／レーダ結果は未入力';
const pct = (x) => Math.round(x * 100);
const fmt1 = (x) => x.toFixed(1);
const fmtRange = (r) => `${r[0].toFixed(2).replace(/\.?0+$/, '')}〜${r[1] > 0 ? '+' : ''}${r[1].toFixed(2).replace(/\.?0+$/, '')}`;
const yearTxt = (y) => (y == null ? '不明' : `${y}年`);
const cellOf = (id) => STATE.cellById[id];
const rangeOf = (id) => fmtRange(cellOf(id).range);
// results: 区間ID -> 空洞あり(true)/なし(false)。既定では空（実データには空洞の結果が無い）。利用者の CSV か、説明用デモ（架空）でだけ入る。
const STATE = { data: null, cellById: {}, segs: [], cellSat: {}, w: 0.1, budgetKm: 3, step: 1, round: 1, selected: new Set(),
  results: new Map(), srcSample: false, srcUser: false, demo: false, demoData: null, loadInfo: null, ranked: [], focus: null, msg: '', verify: null, appliedW: null };
let map = null;

const SCORE_COLOR = ['interpolate', ['linear'], ['get', 'score'], 0, '#3f6e9e', 0.5, '#e89200', 1, '#7a0f5c'];
const segFC = () => ({ type: 'FeatureCollection', features: STATE.ranked.map((s) => ({ type: 'Feature',
  properties: { id: s.id, score: s.score, cls: s.cls, none: s.cls === 'noledger' ? 1 : 0, art: s.cls === 'arterial' && !s.surveyed ? 1 : 0, done: s.surveyed ? 1 : 0, sel: STATE.selected.has(s.id) ? 1 : 0 },
  geometry: { type: 'LineString', coordinates: s.coords } })) });
const resFC = () => ({ type: 'FeatureCollection', features: [...STATE.results].map(([id, hit]) => {
  const s = STATE.segs.find((x) => x.id === id); const [a, b] = s.coords;
  return { type: 'Feature', properties: { id, hit: hit ? 1 : 0, past: STATE.demo && STATE.pastSet && STATE.pastSet.has(id) ? 1 : 0 }, geometry: { type: 'Point', coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] } }; }) });

function recompute() {
  STATE.ranked = rank(STATE.segs, STATE.cellSat, STATE.w);
}
const candidates = () => STATE.ranked.filter((s) => s.cls === 'life' && !s.surveyed);
const surveyedSet = () => scannedFrom(STATE.segs, STATE.results);
const markSurveyed = () => STATE.segs.forEach((s) => { s.surveyed = STATE.results.has(s.id); });

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
  ['1', '2', '3', '4'].forEach((k) => { $('#tab-' + k).setAttribute('aria-selected', String(+k === STATE.step)); $('#s' + k).hidden = +k !== STATE.step; });
  if (STATE.step === 1) renderS1(); else if (STATE.step === 2) renderS2(); else if (STATE.step === 3) renderS3(); else renderS4();
  renderLegend(); updateBadge();
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
    ${STATE.round > 1 && STATE.srcSample && !STATE.demo ? '<div class="demo-on" data-testid="round2-fake"><b>見本 CSV（架空の値）による第' + STATE.round + '回です。</b>実際の調査結果ではありません。</div>' : ''}
    ${STATE.msg ? `<p class="note"><b>${STATE.msg}</b></p>` : ''}
    <div class="lbl"><label for="w">衛星指標の重み</label><span id="w-out">${pct(STATE.w)}%</span></div>
    <input id="w" type="range" min="0" max="100" step="10" value="${pct(STATE.w)}" aria-describedby="w-note">
    <p id="w-note" class="note">0% = 台帳（竣工年）だけ ／ 100% = 衛星の階級だけ（階級が同じ区間は同点）。第3段階で調査結果（CSV）を入れると、較正で更新されます。この地区では台帳中心（衛星10%）から始めます。</p>
    <p class="note" id="w-shift">${satEffect()}</p>
    <p><span class="big">${c.length}</span> 区間（${fmt1(km)} km）が未調査の生活道路。点数の高い順:</p>
    <table><thead><tr><th>区間</th><th>衛星の階級(mm/年)</th><th class="n">竣工年</th><th class="n">点数</th></tr></thead><tbody>
    ${top.map(s1Row).join('')}
    </tbody></table>
    <p class="note">実データでできる検証（豊中市の陥没の件数との照合など）は、上の「4 検証」にあります。</p>
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
    <p class="note">地図の道路をクリック（タップ）すると選択／解除できます（結果が未入力の生活道路のみ。幹線・結果が入った区間・台帳に管渠が紐づかない道路は対象外）。</p>
    <div class="lbl"><label for="bud">走らせられる延長（仮の値）</label><span id="bud-out">${STATE.budgetKm.toFixed(1)} km</span></div>
    <input id="bud" type="range" min="1" max="8" step="0.5" value="${STATE.budgetKm}">
    <p class="note">予算・車両台数などの制約を延長で置き換えた仮の値で、実際の調査能力を表すものではありません。</p>
    <button class="btn pri" id="auto" type="button">点数の上位から自動で選ぶ</button><button class="btn" id="clear" type="button">選択をクリア</button><button class="btn" id="export" type="button" ${sel.size ? '' : 'disabled'}>選んだ区間を CSV で書き出す</button>
    <p>選択中: <span class="big">${sel.size}</span> 区間 / <span id="sel-km" class="${over ? 'over' : ''}">${fmt1(km)} km</span>${over ? ' <span class="over">（上限を超えています）</span>' : ''}</p>
    ${rows.length ? `<table><thead><tr><th>区間</th><th>竣工年</th><th class="n">長さ</th><th class="n">点数</th></tr></thead><tbody>${rows.slice(0, 8).map((s) => `<tr data-id="${s.id}" tabindex="0" class="pick"><td>${s.id}</td><td>${yearTxt(s.year)}</td><td class="n">${s.lenM} m</td><td class="n">${s.score.toFixed(2)}</td></tr>`).join('')}</tbody></table>${rows.length > 8 ? `<p class="note">ほか ${rows.length - 8} 区間</p>` : ''}` : '<p class="note">まだ選んでいません。</p>'}
    <div class="stickybar"><button class="btn" id="back1" type="button">戻る</button><button class="btn pri" id="to3" type="button" ${sel.size && !over ? '' : 'disabled'}>次へ：調査結果を入れる</button></div>`;
  $('#bud').oninput = (e) => { STATE.budgetKm = +e.target.value; $('#bud-out').textContent = STATE.budgetKm.toFixed(1) + ' km'; const k = totalKm(STATE.segs, STATE.selected); $('#sel-km').className = k > STATE.budgetKm + 1e-9 ? 'over' : ''; $('#to3').disabled = !(STATE.selected.size && k <= STATE.budgetKm + 1e-9); };
  $('#bud').onchange = () => render();
  $('#auto').onclick = () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); };
  $('#clear').onclick = () => { STATE.selected = new Set(); render(); };
  $('#export').onclick = exportSelected;
  $('#back1').onclick = () => setStep(1);
  $('#to3').onclick = () => setStep(3);
  bindRows('#s2');
}

/** 選んだ区間の一覧（区間ID・中点の緯度経度・長さ・点数）を CSV で書き出す。調査の依頼や、結果 CSV の区間IDとの突き合わせ用。 */
function exportSelected() {
  const rows = STATE.ranked.filter((s) => STATE.selected.has(s.id));
  const mid = (s, k) => ((s.coords[0][k] + s.coords[1][k]) / 2).toFixed(6);
  const csv = 'segment_id,lat,lon,length_m,score\n' + rows.map((s) => `${s.id},${mid(s, 1)},${mid(s, 0)},${s.lenM},${s.score.toFixed(3)}`).join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'survey-targets.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const calibNow = () => {
  const data = surveyedSet();
  const c = calibrate(data, STATE.cellSat);
  c.n = data.length;
  c.ex0 = exclusionAccuracy(data, STATE.cellSat, STATE.w);
  c.ex1 = c.w === null ? null : exclusionAccuracy(data, STATE.cellSat, c.w);
  return c;
};
const loadMsg = () => {
  const i = STATE.loadInfo; if (!i) return '';
  if (i.error) return `<p class="err" role="alert" data-testid="load-error">読み込めませんでした: ${i.error}</p>`;
  const sm = i.summary, bad = [];
  if (!sm.segments) return `<p class="err" role="alert" data-testid="load-error">読み込めませんでした: 使える行がありません（${sm.rows} 行のうち、空洞の有無・区間・座標が読めない行 ${sm.invalid}、存在しない区間ID ${sm.unknownId}、${LINK_MAX_M} m 以内に区間が無い点 ${sm.unmatched}）。</p>`;
  if (sm.invalid) bad.push(`空洞の有無や座標が読めない行 ${sm.invalid}`);
  if (sm.unknownId) bad.push(`存在しない区間ID ${sm.unknownId}`);
  if (sm.unmatched) bad.push(`${LINK_MAX_M} m 以内に区間が無い点 ${sm.unmatched}`);
  return `<p data-testid="load-ok">「${i.name}」を読み込みました（${sm.rows} 行）: 区間IDで ${sm.byId} 行、緯度・経度の点で ${sm.byPoint} 行を区間に結び付け、<b>${sm.segments} 区間</b>の結果（空洞あり ${sm.hit}・なし ${sm.none}）。${sm.merged ? `同じ区間への複数行 ${sm.merged} 行は「1つでもあり」ならありにまとめました${sm.conflicts ? `（あり・なしが食い違った区間 ${sm.conflicts}）` : ''}。` : ''}${bad.length ? `<br><span class="over">使えなかった行: ${bad.join('、')}。</span>` : ''}</p>`;
};

const FORMAT_HTML = `<p class="note">GMS3 の出力の書式は<b>未確認</b>です。そこで次の<b>2つの書き方のどちらの CSV でも</b>受け付け、同じように較正します（1行目は見出し。区切りはカンマかタブ。処理はこのブラウザの中だけで、外へは送りません）。</p>
    <table><thead><tr><th>書き方</th><th>見出しの例</th><th>内容</th></tr></thead><tbody>
      <tr><td>A. 区間ID</td><td><code>segment_id,cavity</code></td><td>この画面の区間ID（例 S0312）と、空洞あり／なし</td></tr>
      <tr><td>B. 緯度・経度の点</td><td><code>lat,lon,cavity</code></td><td>点から ${LINK_MAX_M} m 以内で最も近い区間に結び付け（台帳なしの道路は除く）。同じ区間に複数点あれば「1つでもあり」ならあり</td></tr></tbody></table>
    <p class="note">空洞の列の値は「あり／なし」「1／0」「true／false」「空洞あり／空洞なし」「疑い／異常なし」を読めます。見本: <a href="data/format_sample_by_segment.csv" download>区間IDの見本</a>・<a href="data/format_sample_by_point.csv" download>緯度・経度の見本</a>（書式を示すだけの仮の値で、調査結果ではありません）。</p>`;

function renderS3() {
  const sel = STATE.selected, km = totalKm(STATE.segs, sel), demo = STATE.demo;
  const c = calibNow(), n = STATE.results.size;
  let h = `<h2>第3段階：調査結果を入れて、重みを較正する</h2>
    <p><b>一次審査を通った後、地中レーダ探査車（GMS3）のデータで較正します。</b><span class="long">この画面はその結果を受け取る枠です。GMS3 のデータは現時点で手元になく、このアプリは使っていません。同梱している実データに空洞の結果はありません。</span></p>`;
  if (demo) {
    h += `<div class="demo-on" data-testid="demo-on"><b>説明用デモ中（結果は架空）</b>。デモをオフにするまで、CSV は入れられません。</div>
      <p><b>過去の調査</b>（設定: 幹線すべてと生活道路の約6%を調査済みとした架空の結果）が最初から入っています。今回の走査は、第2段階で選んだ <b>${sel.size}</b> 区間（${fmt1(km)} km）が対象です。</p>
      ${sel.size ? '' : '<p class="note" data-testid="scan-hint">区間を選んでいないので、走査できません。<button class="linkbtn" id="go2" type="button">第2段階で区間を選ぶ</button></p>'}`;
  } else {
    h += `<div class="filebox"><label for="csv-file"><b>調査結果の CSV を選ぶ</b><span class="long">（累計で入ります。入れ直しで同じ区間は上書き）</span></label>
      <input id="csv-file" type="file" accept=".csv,.tsv,.txt,text/csv"></div>
      <div id="load-msg" aria-live="polite">${loadMsg()}</div>`;
  }
  h += demo ? `<details id="fmt-box"><summary>CSV の書式と見本（デモ中は入れられません）</summary>${FORMAT_HTML}</details>` : FORMAT_HTML;
  const pastN = demo && STATE.pastSet ? [...STATE.results.keys()].filter((id) => STATE.pastSet.has(id)).length : 0;
  h += `<p data-testid="res-total">調査結果が入った区間: <b>${n}</b>${demo ? `（架空。過去の調査 ${pastN} 区間＋今回の走査 ${n - pastN} 区間）` : ''}${n ? `　<button class="btn" id="clear-res" type="button">結果を消す</button>` : ''}</p>`;
  if (n === 0) {
    h += `<p class="note">まだ結果がないので、較正はしません（重みは ${pct(STATE.w)}% のまま）。結果が入ると、重み（0〜100%）ごとの当たりやすさ（AUC）を比べます。</p>`;
  } else if (c.w === null) {
    h += `<p class="over" data-testid="calib-short">較正に使える結果が不足しています（空洞あり ${c.pos} 件・なし ${c.neg} 件。各3件以上で較正）。重みは変えません。</p>`;
  } else {
    h += `<p>入った結果（${c.n} 区間）に照らして、重みを探しました。${demo ? '<b>空洞の有無はすべて架空です。</b>' : ''}</p>
      <table><thead><tr><th>点数のつけ方</th><th class="n">当たりやすさ(AUC)</th></tr></thead><tbody>
        <tr><td>台帳のみ（衛星0%）</td><td class="n">${c.ledgerOnly.toFixed(2)}</td></tr>
        <tr><td>衛星のみ（100%）</td><td class="n">${c.satOnly.toFixed(2)}</td></tr>
        <tr class="pick"><td>採用: 衛星 ${pct(c.w)}%</td><td class="n" data-testid="auc-adopted">${aucAt(surveyedSet(), STATE.cellSat, c.w).toFixed(2)}</td></tr></tbody></table>
      <p class="note">AUC: 空洞のあった区間が、なかった区間より高い点数になる確率（0.5=当てずっぽう、1=完全）。${c.ex1 ? `点数が下位の半分とした区間（${c.ex1.n}区間）のうち異常なしだった割合は ${pct(c.ex1.rate)}%${c.ex0 ? `（現在の重みでは ${pct(c.ex0.rate)}%）` : ''}。` : ''}${demo ? '空洞の有無が架空のため、仕組みを見せる数字であり、実際の精度や提案の効果を示しません。' : '調査した区間は点数の高い所に偏って選ばれやすく、この数字は調査した区間の中での比較です。実際の精度・効果を示すものではありません。'}</p>`;
  }
  const why = c.w !== null ? '' : (n === 0
    ? '<p class="why" data-testid="apply-why">まだ調査結果がないので反映できません。<span class="long">CSV を入れるか、</span><button class="linkbtn" id="demo-go" type="button">説明用デモで動きを見る（架空の結果）</button>。</p>'
    : '<p class="why" data-testid="apply-why">結果が足りないので、反映できません（各3件以上）。CSV を足すか、<button class="linkbtn" id="demo-go" type="button">説明用デモで動きを見る（架空の結果）</button>。</p>');
  const scanned = demo ? n - pastN : 0;
  const scanBtn = demo ? `<button class="btn ${sel.size && !scanned ? 'pri' : ''}" id="scan" type="button" ${sel.size ? '' : 'disabled'}>走査結果を入れる（架空）</button> ` : '';
  h += `<div class="stickybar">${demo ? '' : why}<button class="btn" id="back2" type="button">戻る</button>
    ${scanBtn}<button class="btn ${demo && !scanned ? '' : 'pri'}" id="apply" type="button" ${c.w === null ? 'disabled' : ''}>較正を反映して第${STATE.round + 1}回へ</button></div>
    <details id="demo-box"><summary>説明用デモ（架空の結果で動きを見る）。既定はオフ</summary>
      <p class="note">実データには空洞の結果が無いため、動きを見せるためだけの機能です。オンにすると<b>地中レーダの結果が乱数（架空）</b>になり、オンの間は画面上部に「架空」と出し続けます。オン・オフを切り替えると、入れた結果と較正は初めからになります。</p>
      <label><input type="checkbox" id="demo-toggle" ${demo ? 'checked' : ''}> 説明用デモをオンにする（架空の結果）</label></details>`;
  $('#s3').innerHTML = h;
  $('#back2').onclick = () => setStep(2);
  $('#apply').onclick = applyCalib;
  $('#demo-toggle').onchange = (e) => setDemo(e.target.checked);
  if ($('#scan')) $('#scan').onclick = demoScan;
  if ($('#go2')) $('#go2').onclick = () => setStep(2);
  if ($('#demo-go')) $('#demo-go').onclick = () => setDemo(true);
  if ($('#clear-res')) $('#clear-res').onclick = () => { clearResults(); render(); };
  if ($('#csv-file')) $('#csv-file').onchange = onFile;
  if (demo) $('#demo-box').open = true;
}

function clearResults() { STATE.results = new Map(); STATE.loadInfo = null; STATE.srcSample = false; STATE.srcUser = false; markSurveyed(); }
/** 架空の値を含むか（説明用デモ、または同梱の見本 CSV を入れた時）。 */
const isFake = () => STATE.demo || STATE.srcSample;
/** 同梱の見本 CSV か。note 列の「架空の見本」で判定する。 */
const isSampleCsv = (text) => /架空の見本/.test(text);
function updateBadge() {
  const n = STATE.results.size;
  let t = BADGE_DEFAULT, fake = false;
  if (STATE.demo) { t = '説明用デモ：レーダ結果は架空'; fake = true; }
  else if (STATE.srcSample) { t = `架空を含む（見本 CSV）：レーダ結果 ${n} 区間は架空の値${STATE.srcUser ? '・利用者の CSV を含む' : ''}`; fake = true; }
  else if (n > 0) t = `実データ（衛星・道路・台帳）／レーダ結果: 利用者の調査結果 ${n} 区間（実データかは利用者の責任）`;
  $('#badge').textContent = t;
  document.body.classList.toggle('fake', fake);
}

async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('shift_jis').decode(buf); }
}
async function onFile(e) {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  loadCsvText(await readFileText(f), f.name);
}
/** 調査結果の CSV（テキスト）を取り込む。結果は累計に入り、調査済みの区間は候補から外れる。 */
function loadCsvText(text, name = '貼り付け') {
  if (STATE.demo) return { error: '説明用デモ中は CSV を入れられません。' };
  const r = parseOutcomes(text, STATE.segs);
  STATE.loadInfo = { name, error: r.error, summary: r.summary };
  if (!r.error) {
    if (isSampleCsv(text)) STATE.srcSample = true; else STATE.srcUser = true;
    STATE.results = new Map([...STATE.results, ...r.results]);
    for (const id of r.results.keys()) STATE.selected.delete(id);
    markSurveyed();
  }
  render();
  const m = $('#load-msg'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' });
  return r;
}

async function ensureDemo() {
  if (!STATE.demoData) STATE.demoData = await (await fetch('data/demo_sim.json')).json();
  STATE.demoHit = new Set(STATE.demoData.hit);
}
/** 説明用デモの切替。入れた結果・較正・回は初めからにする（実の結果と架空を混ぜない）。 */
async function setDemo(on) {
  if (on) await ensureDemo();
  STATE.demo = on; STATE.results = new Map(); STATE.loadInfo = null; STATE.srcSample = false; STATE.srcUser = false;
  STATE.w = 0.1; STATE.round = 1; STATE.msg = ''; STATE.appliedW = null;
  STATE.pastSet = on ? new Set(STATE.demoData.past) : null;
  if (on) for (const id of STATE.demoData.past) STATE.results.set(id, STATE.demoHit.has(id));
  for (const id of [...STATE.selected]) if (STATE.results.has(id)) STATE.selected.delete(id); // 選択は残す（過去の調査済みになった区間だけ外す）
  markSurveyed();
  document.body.classList.toggle('demo', on);
  $('#demo-banner').hidden = !on;
  render(); syncDetail(); toTop();
}
function demoScan() {
  if (!STATE.demo) return;
  for (const id of STATE.selected) STATE.results.set(id, STATE.demoHit.has(id));
  STATE.selected = new Set(); markSurveyed(); render();
}

function applyCalib() {
  const c = calibNow();
  const oldW = STATE.w, before = new Set(candidates().slice(0, 20).map((s) => s.id));
  if (c.w !== null) STATE.w = c.w;
  STATE.appliedW = c.w;
  recompute(); markSurveyed();
  const moved = candidates().slice(0, 20).filter((s) => !before.has(s.id)).length;
  const fk = STATE.demo ? '（架空の結果による）' : STATE.srcSample ? '（見本 CSV＝架空の値による）' : '';
  STATE.msg = c.w !== null ? (c.w === oldW ? `${fk}較正の結果、重みは ${pct(STATE.w)}% のままです（台帳のみ ${c.ledgerOnly.toFixed(2)}／採用 ${aucAt(surveyedSet(), STATE.cellSat, c.w).toFixed(2)}）。調査した区間を除いて順位を作り直しました（上位20区間のうち第1回の上位20に無かった区間: ${moved}）。` : `${fk}較正済み: 衛星指標の重みを ${pct(oldW)}% から ${pct(STATE.w)}% に更新しました。調査した区間を除いて順位を作り直しました（上位20区間のうち第1回の上位20に無かった区間: ${moved}）。`) : '較正に使える結果が不足していたため、重みは変えていません。';
  STATE.round += 1;
  setStep(1);
}

function renderS4() {
  $('#s4').innerHTML = `<h2>実データで確かめる</h2><p class="note">この表は町単位・全国の集計で、地図には出ません（地図は第1段階の表示のままです）。</p>${verifyHtml(STATE.verify)}`;
}

function toTop() { const b = $('#panel-body'); if (b) b.scrollTop = 0; }
function setStep(n) { STATE.step = n; STATE.focus = null; STATE.focusCell = null; render(); syncDetail(); toTop(); }

function renderLegend() {
  const pal = STATE.data.satellite.palette, used = [...new Set(STATE.data.cells.map((c) => c.k))].sort((x, y) => x - y);
  const chips = used.map((k) => { const c = STATE.data.cells.find((x) => x.k === k); return `<div class="lg"><span class="sw sq" style="background:${pal[k]};${STATE.data.cells.find((x) => x.k === k).range[1] <= 0 ? 'background-image:repeating-linear-gradient(45deg,#4d5c64 0 1px,transparent 1px 5px)' : ''}"></span>区画の${STATE.data.cells.find((x) => x.k === k).range[1] <= 0 ? '斜線' : '色'} ${fmtRange(c.range)} mm/年（階級の幅 ${c.dispW} mm/年）</div>`; }).join('');
  $('#legend').innerHTML = `<div><b>凡例</b></div>
    ${chips}
    <div class="note">この地区の2階級の差は沈下の兆候ではありません（階級幅 3.75 mm/年以内）。</div>
    <div class="lg"><span class="sw" style="border-color:#59656d;border-top-style:dashed"></span>${isFake() ? '結果が入った区間（架空を含む）' : '調査結果が入った区間（利用者の CSV）'}</div>
    <div class="lg"><span class="sw" style="border-color:#9aa5ab;border-top-width:2px"></span>幹線（この調査の対象外。生活道路が対象）</div>
    <div class="lg"><span class="sw" style="border-color:#8a969d;border-top-width:2px;border-top-style:dotted"></span>台帳に管渠が紐づかない道路（点数の対象外）</div>
    <div>道路の点数（高いほど先に確かめたい）</div><div class="grad"></div><div class="lg" style="justify-content:space-between"><span>低</span><span>高</span></div>
    <div class="lg"><span class="sw" style="border-color:#1a237e;border-top-width:6px"></span>選択した区間</div>
    <div class="lg"><span class="dot" style="background:#d55e00;border:3px solid #fff;outline:1px solid #555"></span>空洞あり（大・濃い色）　<span class="dot" style="background:#fff;border:2px solid #0072b2"></span>空洞なし（小・白抜き）${isFake() ? '　※架空の結果' : '（調査結果を入れた区間にだけ出ます）'}</div>`;
}

function segDetail(id) {
  const s = STATE.ranked.find((x) => x.id === id); if (!s) return '';
  const a = ageNorm(s.year), sat = STATE.cellSat[s.cell], c = cellOf(s.cell);
  const done = STATE.results.has(id) ? STATE.results.get(id) : null;
  const fake = isFake() ? '（架空）' : '';
  const kind = s.cls === 'arterial' ? '幹線（この調査の対象外）' : s.cls === 'noledger' ? '台帳に管渠が紐づかない道路' : '生活道路';
  const ledger = s.cls === 'noledger' ? '台帳: 15m以内に豊中市の管渠なし（市外・私道・未整備・位置のずれ等。理由は未特定）'
    : `台帳: 竣工 ${yearTxt(s.year)}${s.year == null ? '（台帳で不明。古さは中立の0.5で扱う）' : `（経過 ${NOW_YEAR - s.year}年）`}${s.dia ? `／管径 ${s.dia} mm` : ''}`;
  return `<h3>区間 ${s.id}${s.name ? `（${s.name}）` : ''}：${kind}</h3>
    <p>長さ ${s.lenM} m／OSM道路種別 ${s.hw}<br>
    衛星: 区画 ${s.cell} の階級 ${fmtRange(c.range)} mm/年（約90m・幅 ${c.dispW} mm/年。中央値 ${c.disp} で計算）<br>
    ${ledger}<br>
    ${s.cls === 'noledger' ? '' : `点数 <b>${s.score.toFixed(2)}</b> ＝ 衛星 ${pct(STATE.w)}% × 衛星の値 ${sat.toFixed(2)} ＋ 台帳 ${pct(1 - STATE.w)}% × 古さ ${a.toFixed(2)}<br>`}
    ${done !== null ? `調査結果${fake}: <span class="chip ${done ? 'hit' : 'ok'}">${done ? '空洞あり' : '空洞なし'}</span>` : s.cls === 'arterial' ? '本アプリでは点数の対象外です（生活道路が対象）。' : s.cls === 'noledger' ? '' : STATE.selected.has(id) ? '選択中。' : '結果は未入力。'}</p>`;
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
  <li><b>空洞の結果は同梱していません</b>（公開された位置つきの空洞・陥没の実データは見つかっていません）。自治体が自分の調査結果（CSV）を入れて較正する枠です。一次審査を通った後、GMS3 のデータで較正する想定で、GMS3 のデータは手元になく使っていません（出力書式は未確認）</li>
  <li><b>架空</b>は、既定ではオフの「説明用デモ」を選んだときだけ（オンの間は常に表示）</li>
  <li><b>Sentinel-1 ではありません</b>。提案書は Sentinel-1 の解析を主に想定（ALOS-4 は比較検証）。このデモは国土地理院の公開成果（だいち2号・4号）で代用</li></ul></div>
  <h3>このデモは何か</h3>
  <p>「衛星で絞り、地中レーダで確かめる 路面下リスクの二段階調査」（衛星データ活用アワード2026–2027 応募提案）の流れを、<b>実在の地域（${STATE.data.area.name}）の実データ</b>で一通り体験するための最小限の試作です。衛星の解析（InSAR処理）とレーダの解析は実装していません。立場は「衛星は空洞を直接見つけず、地上調査の投入先を選ぶ」です。</p>
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
  <li><b>衛星</b>: 解析：国土地理院 原初データ所有：JAXA。階級に戻して区画に集計するなど加工して作成しています。<b>利用条件は要確認</b>: 同じ成果のデータ登録（data.e-gov.go.jp）は「政府標準利用規約」、国土地理院のページ・README は測量法上の承認の要否を明記していません（地理院コンテンツ利用規約の適用は未確認）。食い違いがあるため、どちらも採用せず、公開・応募への添付の前に確認します。</li>
  <li><b>道路</b>: © OpenStreetMap contributors。車道（幹線〜生活道路）を、交差点・長さ（150m）・曲がりで区間に分割し、加工して作成。取得日 2026-11-21。<b>この道路データ（data/toyonaka.json の道路形状）は Open Database License（ODbL）で提供します。</b>著作権とライセンス: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">https://www.openstreetmap.org/copyright</a></li>
  <li><b>下水道の台帳</b>: 豊中市「下水道（管渠）」（<a href="https://creativecommons.org/licenses/by/4.0/deed.ja" target="_blank" rel="noopener">CC BY 4.0</a>、BODIK オープンデータ <a href="https://data.bodik.jp/dataset/272035_gesuido" target="_blank" rel="noopener">data.bodik.jp/dataset/272035_gesuido</a>）。竣工日と管径を使用し、加工して作成。竣工日が不明（9999）の管渠は市全体で ${st.sewer_unknown_year_all} / ${st.sewer_total_records} 本。</li>
  <li><b>地中レーダの結果</b>: 同梱していません。利用者が CSV（区間ID または緯度・経度の点 ＋ 空洞あり/なし）で入れます。処理はこのブラウザの中だけ。「説明用デモ」（既定オフ）の結果は乱数（data/demo_sim.json、架空）で、特定企業の製品画面・データでもありません。</li>
  <li><b>陥没の件数との照合</b>: 国交省「道路陥没発生箇所の詳細」（令和6年度）、全国特別重点調査（別紙2）、e-Stat の町丁境界。第4タブの「検証」に出典とライセンス（要確認の点を含む）を載せています。</li>
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
  <li>較正: これまでの調査結果に対し、重み（0〜100%）ごとの当たりやすさ（AUC）を比べて最大の重みを採用します。空洞あり／なしが各3件未満なら較正しません。調査した区間は点数の高い所に偏りやすく、AUC は調査した区間の中での比較です。実際の精度・効果を示すものではありません。</li>
  </ul>
  <h3>限界</h3>
  <ul>
  <li>画面の AUC・除外精度は、入れた調査結果（説明用デモなら架空の結果）に対する計算で、実際の精度・効果・費用を示しません。</li>
  <li>位置つきの空洞・陥没の実データは見つかっていません。国交省の陥没の表には座標がなく、地名は町名までです。豊中市の全国特別重点調査（大口径管）での空洞は 0 箇所ですが、空洞調査の実施済み延長も 0 km で、「ない」ことを示すものではありません。</li>
  <li>衛星は空洞を直接検出しません。生活道路の幅に対する衛星画素の粗さ、反射点の偏りは、本デモでも解消していません。</li>
  <li>この地区は衛星の階級がほぼ一様で、「衛星で絞る」効果は見えず、台帳の古さが主に順位を決めます。沈下の大きい地域では異なる可能性がありますが、そのような地域の下水道台帳の公開データは確認できていません。</li>
  <li>国土地理院成果の静的な派生データ（階級の区画値）の公開・応募添付は、利用条件（上記の食い違い）の確認が済むまで<b>要確認</b>です。</li>
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
  fetch('data/verify.json').then((r) => r.json()).then((v) => { STATE.verify = v; if (STATE.step === 4) render(); }).catch(() => {});
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
    map.addLayer({ id: 'seg-art', type: 'line', source: 'segs', filter: ['==', ['get', 'art'], 1], paint: { 'line-color': '#9aa5ab', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 14, 1.2, 17, 3] } });
    map.addLayer({ id: 'seg-case', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 0], ['==', ['get', 'none'], 0], ['==', ['get', 'art'], 0]], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 14, 4.5, 17, 8.5], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'seg-sel', type: 'line', source: 'segs', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1a237e', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 14, 9, 17, 18], 'line-opacity': 0.85 } });
    map.addLayer({ id: 'seg-done', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 1], ['==', ['get', 'none'], 0]], paint: { 'line-color': '#59656d', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 14, 1.2, 17, 3], 'line-dasharray': [2, 1.5] } });
    map.addLayer({ id: 'seg-todo', type: 'line', source: 'segs', filter: ['all', ['==', ['get', 'done'], 0], ['==', ['get', 'none'], 0], ['==', ['get', 'art'], 0]], layout: { 'line-cap': 'round' }, paint: { 'line-color': SCORE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 14, 2.5, 17, 6] } });
    map.addSource('res', { type: 'geojson', data: resFC() });
    map.addLayer({ id: 'res-ok', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 0], paint: { 'circle-radius': ['case', ['==', ['get', 'past'], 1], 2.5, 5], 'circle-color': '#fff', 'circle-stroke-color': '#0072b2', 'circle-stroke-width': ['case', ['==', ['get', 'past'], 1], 1, 2.5], 'circle-opacity': ['case', ['==', ['get', 'past'], 1], 0.5, 1], 'circle-stroke-opacity': ['case', ['==', ['get', 'past'], 1], 0.5, 1] } });
    map.addLayer({ id: 'res-hit', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 1], paint: { 'circle-radius': ['case', ['==', ['get', 'past'], 1], 4, 10], 'circle-color': '#d55e00', 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['==', ['get', 'past'], 1], 1, 3], 'circle-opacity': ['case', ['==', ['get', 'past'], 1], 0.55, 1], 'circle-stroke-opacity': ['case', ['==', ['get', 'past'], 1], 0.55, 1] } });
    const roadLayers = ['seg-todo', 'seg-done', 'seg-none', 'seg-art'];
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

window.App = { STATE, getMap: () => map, setStep, toggleSeg, loadCsvText, setDemo, demoScan, applyCalib, render, focusSeg, exportSelected,
  autoSelect: () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); } };
init();
