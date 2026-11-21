import { rank, selectByBudget, totalKm, satNorm, ageNorm, calibrate, exclusionAccuracy, aucAt, topShift, parseOutcomes, scannedFrom, adoptWeight, clusterCount, CLUSTER_GAP_M, MIN_AUC, MIN_GAIN, LINK_MAX_M, NOW_YEAR } from './logic.js';
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
  results: new Map(), srcSample: false, srcUser: false, demo: false, demoData: null, loadInfo: null, ranked: [], focus: null, msg: '', verify: null, appliedW: null, calibNote: '', exportMsg: '' };
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
  $('#round').textContent = `第${STATE.round}回${STATE.results.size > (STATE.appliedN || 0) ? '（結果入力中）' : ''}`;
  ['1', '2', '3', '4'].forEach((k) => { $('#tab-' + k).setAttribute('aria-selected', String(+k === STATE.step)); $('#s' + k).hidden = +k !== STATE.step; });
  if (STATE.step === 1) renderS1(); else if (STATE.step === 2) renderS2(); else if (STATE.step === 3) renderS3(); else renderS4();
  renderLegend(); updateBadge();
  refreshMap(); syncDetail();
}

const s1Row = (s) => `<tr data-id="${s.id}" tabindex="0" class="rowlink"><td>${s.id}</td><td class="n">${yearTxt(s.year)}</td><td class="n">${((1 - STATE.w) * ageNorm(s.year)).toFixed(2)}</td><td class="n">${(STATE.w * STATE.cellSat[s.cell]).toFixed(2)}</td><td class="n"><b>${s.score.toFixed(2)}</b></td></tr>`;
/** 1位と同点の区間数。 */
const tieCount = () => { const c = candidates(), t = c.length ? c[0].score.toFixed(2) : null; return { n: c.filter((x) => x.score.toFixed(2) === t).length, t }; };
/** 結論を先に1文、続けて同点と衛星の効き（台帳のみの上位20からの入れ替わり数）と、衛星が効いている区間の例。 */
function tieLine() {
  const c = candidates(), shift = topShift(STATE.segs, STATE.cellSat, STATE.w, 20), { n: ties, t } = tieCount();
  const concl = shift === 0 ? 'この地区は衛星の差が小さく、台帳の古さで順位が決まっています。' : `衛星で上位20のうち ${shift} 区間が入れ替わっています。`;
  const ex = c.findIndex((x) => STATE.w * STATE.cellSat[x.cell] > 0.005);
  const tie = ties > S1_ROWS ? `上位${ties}区間が同点（${t}。表外にも${ties - S1_ROWS}件）。` : '';
  const exTxt = ex >= 0 ? `衛星が効く例: ${c[ex].id}（衛星分 ${(STATE.w * STATE.cellSat[c[ex].cell]).toFixed(2)}・${ex + 1}位）` : '';
  return `<b>${concl}</b><br><span class="note">${tie}<span id="w-shift">衛星で入れ替わり 上位20のうち ${shift}</span>。${exTxt}</span>`;
}
/** 重みの説明（今の状態に合わせて作る）。 */
function wNote() {
  const base = '0%＝台帳だけ／100%＝衛星だけ。';
  if (STATE.round > 1 && STATE.calibNote) return base + STATE.calibNote;
  return base + '初期値10%。';
}
const S1_ROWS = 3;

function renderS1() {
  const c = candidates(), km = c.reduce((a, s) => a + s.lenM, 0) / 1000;
  const top = c.slice(0, S1_ROWS);
  const cc = STATE.data.stats.cell_with_roads_class_counts, k7 = cc['7'] || 0, k8 = cc['8'] || 0;
  const fakeR2 = STATE.round > 1 && isFake();
  const tc = tieCount();
  const tieR2 = tc.n > S1_ROWS ? `<br><span class="note" data-testid="r2-ties">同点 ${tc.n} 区間（${tc.t}）。上位は竣工の古い順。</span>` : '';
  const box = STATE.round > 1 ? `<div class="r2box${fakeR2 ? ' fake' : ''}" data-testid="${STATE.srcSample && !STATE.demo ? 'round2-fake' : 'round2-box'}" role="status">
      <b>第${STATE.round}回</b>：${STATE.msg}${tieR2}
      <div class="r2row"><button class="btn pri" id="r2-to2" type="button">この順位で選び直す</button>${STATE.cmp ? `<details class="more"><summary>上位5の変化</summary><span class="cmp" data-testid="cmp">${STATE.cmp}</span></details>` : ''}</div></div>` : (STATE.msg ? `<p class="note"><b>${STATE.msg}</b></p>` : '');
  $('#s1').innerHTML = `
    <h2>第1段階：点数で候補区間を絞る</h2>
    ${box}
    <p><span class="big">${c.length}</span> 区間（${fmt1(km)} km）が未調査の生活道路。</p>
    ${STATE.round > 1 ? '' : `<p class="warnbox" id="ties">${tieLine()}</p>`}
    <div class="wrow"><label for="w">衛星の重み</label><input id="w" type="range" min="0" max="100" step="10" value="${pct(STATE.w)}" aria-describedby="w-note"><span id="w-out">${pct(STATE.w)}%</span></div>
    <p id="w-note" class="note">${wNote()}</p>
    <table class="rank"><thead><tr><th>区間</th><th class="n">竣工</th><th class="n">台帳分</th><th class="n">衛星分</th><th class="n">点数</th></tr></thead><tbody>
    ${top.map(s1Row).join('')}
    </tbody></table>
    <p class="note">点数＝台帳（管の古さ）＋衛星（地表の沈下）。行か道路を押すと内訳。</p>
    <details><summary>この地区の衛星の値</summary>
      <p class="note">2階級（沈下側 -3.75〜0 mm/年が ${k7} 区画、隆起側 0〜+3.75 mm/年が ${k8} 区画）の差は階級幅以内で、沈下の兆候とは言えません。衛星の値は最大 ${satNorm(STATE.data.cells.reduce((m, x) => Math.min(m, x.disp), 0)).toFixed(2)}（隆起側は 0）。</p></details>
    <div class="stickybar"><button class="btn pri" id="to2" type="button">次へ：調査区間を選ぶ（第2段階）</button></div>`;
  $('#w').oninput = (e) => { STATE.w = +e.target.value / 100; recompute(); $('#w-out').textContent = pct(STATE.w) + '%'; refreshMap(); renderS1Table(); };
  $('#to2').onclick = () => setStep(2);
  if ($('#r2-to2')) $('#r2-to2').onclick = () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); STATE.autoInit = true; STATE.exportMsg = ''; setStep(2); };
  bindRows('#s1');
}
function renderS1Table() { // スライダー操作中はフォーカスを保つため表だけ更新
  $('#s1 tbody').innerHTML = candidates().slice(0, S1_ROWS).map(s1Row).join('');
  if ($('#ties')) $('#ties').innerHTML = tieLine();
  bindRows('#s1'); syncDetail();
}
function bindRows(root) {
  document.querySelectorAll(root + ' tr[data-id]').forEach((tr) => {
    const go = () => { focusSeg(tr.dataset.id); const d = document.querySelector('tr.drow'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' }); };
    tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}

const S2_ROWS = 3;
const s2Row = (s) => `<tr data-id="${s.id}" tabindex="0" class="pick rowlink"><td>${s.id}</td><td>${yearTxt(s.year)}</td><td class="n">${s.lenM} m</td><td class="n">${s.score.toFixed(2)}</td></tr>`;
function renderS2() {
  const sel = STATE.selected, km = totalKm(STATE.segs, sel), over = km > STATE.budgetKm + 1e-9;
  const rows = STATE.ranked.filter((s) => sel.has(s.id));
  const nc = rows.length ? clusterCount(STATE.segs, sel) : 0;
  const thead = '<thead><tr><th>区間</th><th>竣工年</th><th class="n">長さ</th><th class="n">点数</th></tr></thead>';
  $('#s2').innerHTML = `
    <h2>第2段階：予算内で調査区間を選ぶ</h2>
    <div class="lbl"><label for="bud">走らせられる延長（仮の値）</label><span id="bud-out">${STATE.budgetKm.toFixed(1)} km</span></div>
    <input id="bud" type="range" min="1" max="8" step="0.5" value="${STATE.budgetKm}" aria-describedby="bud-note">
    <p>選択中: <span class="big">${sel.size}</span> 区間 / <span id="sel-km" class="${over ? 'over' : ''}">${fmt1(km)} km</span>${over ? ' <span class="over">（上限を超えています）</span>' : ''}${nc ? `・まとまり <b data-testid="clusters">${nc}</b> か所<span class="note">（${CLUSTER_GAP_M} m 以内を1つ）</span>` : ''}</p>
    ${STATE.exportMsg ? `<p class="okmsg" role="status" data-testid="export-msg">✓ ${STATE.exportMsg}</p>` : ''}
    ${rows.length ? `<p class="note" data-testid="sel-ties">予算内で点数の高い順に選んでいます（同点は竣工の古い順）。</p>
    <table>${thead}<tbody>${rows.slice(0, S2_ROWS).map(s2Row).join('')}</tbody></table>${rows.length > S2_ROWS ? `<details class="more"><summary>ほか ${rows.length - S2_ROWS} 区間</summary><table><tbody>${rows.slice(S2_ROWS).map(s2Row).join('')}</tbody></table></details>` : ''}` : '<p class="note">「自動で選ぶ」を押すか、地図の道路を押して選びます。</p>'}
    <p class="note" id="bud-note">${sel.size ? '' : '<b>CSV 書き出しは、先に区間を選んでから。</b>'}道路を押すと選択／解除。延長は予算・車両の制約を置き換えた仮の値です。${sel.size ? ' <button class="linkbtn" id="clear" type="button">選択をクリア</button>' : ''}</p>
    <div class="stickybar row3"><button class="btn ${sel.size ? '' : 'pri'}" id="auto" type="button">自動で選ぶ</button><button class="btn ${sel.size && !over && !STATE.exportMsg ? 'pri' : ''}" id="export" type="button" ${sel.size ? '' : 'disabled'}>CSV 書き出し</button><button class="btn ${STATE.exportMsg ? 'pri' : ''}" id="to3" type="button" ${sel.size && !over ? '' : 'disabled'}>次へ：結果を入れる →</button></div>`;
  $('#bud').oninput = (e) => { STATE.budgetKm = +e.target.value; $('#bud-out').textContent = STATE.budgetKm.toFixed(1) + ' km'; const k = totalKm(STATE.segs, STATE.selected); $('#sel-km').className = k > STATE.budgetKm + 1e-9 ? 'over' : ''; $('#to3').disabled = !(STATE.selected.size && k <= STATE.budgetKm + 1e-9); };
  $('#bud').onchange = () => render();
  $('#auto').onclick = () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); STATE.autoInit = true; STATE.exportMsg = ''; render(); fitSelected(); };
  if ($('#clear')) $('#clear').onclick = () => { STATE.selected = new Set(); STATE.autoInit = true; STATE.exportMsg = ''; render(); };
  $('#export').onclick = exportSelected;
  $('#to3').onclick = () => setStep(3);
  bindRows('#s2');
}
/** 選んだ区間の全体が入るように地図を合わせる（パネルに隠れない余白をとる）。 */
function fitSelected() {
  if (!map || !STATE.selected.size) return;
  const pts = STATE.segs.filter((s) => STATE.selected.has(s.id)).flatMap((s) => s.coords);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: mapPad(), duration: 400, maxZoom: 15 });
}
const mapPad = () => (innerWidth < 720 ? { top: 46, left: 8, right: 8, bottom: 8 } : { top: 40, bottom: 30, right: 30, left: 430 });

/** 選んだ区間の一覧（区間ID・中点の緯度経度・長さ・点数）を CSV で書き出す。調査の依頼や、結果 CSV の区間IDとの突き合わせ用。 */
function exportSelected() {
  const rows = STATE.ranked.filter((s) => STATE.selected.has(s.id));
  const mid = (s, k) => ((s.coords[0][k] + s.coords[1][k]) / 2).toFixed(6);
  // cavity 列は空欄。調査後に あり／なし を書いて、そのまま第3段階で入れられる（空欄の行は読み飛ばす）
  const csv = 'segment_id,lat,lon,length_m,score,cavity\n' + rows.map((s) => `${s.id},${mid(s, 1)},${mid(s, 0)},${s.lenM},${s.score.toFixed(3)},`).join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'survey-targets.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  STATE.exportMsg = `survey-targets.csv（${rows.length} 区間）をダウンロードフォルダに保存。調査後、空欄の cavity 列に あり／なし を書いて第3段階で入れます`;
  if (STATE.step === 2) render();
}
/** 重み w で並べ直したとき、今の並び（調査済みを含む生活道路）の上位20から何区間入れ替わるか。第3段階の予告と第2回の通知で同じ値を使う。 */
function shiftAfter(w) {
  const life = (arr) => arr.filter((s) => s.cls === 'life');
  const beforeAll = life(rank(STATE.segs, STATE.cellSat, STATE.w)), before20 = new Set(beforeAll.slice(0, 20).map((s) => s.id));
  const after = rank(STATE.segs, STATE.cellSat, w).filter((s) => s.cls === 'life' && !STATE.results.has(s.id));
  return { moved: after.slice(0, 20).filter((s) => !before20.has(s.id)).length, before5: beforeAll.slice(0, 5).map((s) => s.id), after5: after.slice(0, 5).map((s) => s.id) };
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
  return `<p class="okmsg" data-testid="load-ok">✓ 「${i.name}」: <b>${sm.segments} 区間</b>（空洞あり ${sm.hit}・なし ${sm.none}）。区間IDで ${sm.byId} 行、緯度・経度の点で ${sm.byPoint} 行を結び付け。${sm.blank ? `空欄 ${sm.blank} 行は未記入として読み飛ばし。` : ''}${sm.merged ? `同じ区間の複数行 ${sm.merged} 行は「1つでもあり」ならあり。` : ''}${bad.length ? `<br><span class="over">使えなかった行: ${bad.join('、')}。</span>` : ''}</p>`;
};

const FORMAT_HTML = `<ul class="tight note"><li>1行目は見出し。区切りはカンマかタブ。処理はブラウザの中だけで、外へは送りません。</li>
      <li>A. 区間ID: <code>segment_id,cavity</code>（第2段階の CSV がこの形）</li>
      <li>B. 緯度・経度: <code>lat,lon,cavity</code>（${LINK_MAX_M} m 以内で最も近い区間に結び付け）</li>
      <li>空洞の値: あり／なし、1／0、疑い／異常なし など。空欄は読み飛ばし</li>
      <li>説明用デモ: 実データに空洞の結果が無いため、動きを見せるだけ。オンの間は結果が乱数になり、切り替えると結果と較正は初めから</li>
      <li>GMS3 等の地中レーダの結果を入れる想定です（GMS3 の出力書式は未確認）</li></ul>`;
const REASON = { short: '結果が足りない', low: 'あり・なしの差が点数に表れていない', small: '別の重みにしても当たりやすさがほとんど上がらない', same: '今の重みが最も当たりやすい' };
const AUC_TH = '当たりやすさ（AUC。0.5＝当てずっぽう）';

function renderS3() {
  const sel = STATE.selected, km = totalKm(STATE.segs, sel), demo = STATE.demo;
  const c = calibNow(), n = STATE.results.size;
  const pastN = demo && STATE.pastSet ? [...STATE.results.keys()].filter((id) => STATE.pastSet.has(id)).length : 0, nScan = demo ? n - pastN : 0;
  const ad = adoptWeight(c, surveyedSet(), STATE.cellSat, STATE.w);
  let h = `<h2>第3段階：調査結果を入れて重みを較正</h2>
    <ol class="tight3"><li>第2段階の CSV の cavity 列に あり／なし を書く</li><li>下でその CSV を選ぶ</li><li>第${STATE.round + 1}回へ進む</li></ol>`;
  if (demo) {
    h += `<p class="note" data-testid="demo-on">過去の調査（架空）が入っています。</p>
      ${sel.size ? `<p>今回の走査: 第2段階で選んだ <b>${sel.size}</b> 区間（${fmt1(km)} km）。</p>` : nScan > 0 ? '<p class="note" data-testid="scan-done">今回の走査 ' + nScan + ' 区間を入れました。下のボタンで第' + (STATE.round + 1) + '回へ。</p>' : '<p class="note" data-testid="scan-hint">区間を選んでいないので、走査できません。<button class="linkbtn" id="go2" type="button">第2段階で区間を選ぶ</button></p>'}`;
  } else {
    h += `<p class="note need3">あり・なし 各3件以上で較正します。</p><div class="filebox"><span class="btn pri filebtn" aria-hidden="true">調査結果の CSV を選ぶ</span><span class="fname">${STATE.loadInfo ? STATE.loadInfo.name : '未選択'}</span>
      <input id="csv-file" type="file" accept=".csv,.tsv,.txt,text/csv" aria-label="調査結果の CSV を選ぶ（累計で入ります）"></div>
      <p class="note">書式の見本: <a href="data/format_sample_by_segment.csv" download>区間ID</a>・<a href="data/format_sample_by_point.csv" download>緯度・経度</a></p>
      <div id="load-msg" aria-live="polite">${loadMsg()}</div>`;
  }
  const resTotal = `<p data-testid="res-total">調査結果が入った区間: <b>${n}</b>${demo ? `（架空。過去 ${pastN}＋今回 ${n - pastN}）` : ''}${n ? `　<button class="linkbtn" id="clear-res" type="button">結果を消す</button>` : ''}</p>`;
  const pv = c.w !== null ? shiftAfter(ad.w) : null;
  const pvTxt = pv ? `第${STATE.round + 1}回は調査した区間を除き、上位20のうち <b data-testid="preview-moved">${pv.moved}</b> 区間が入れ替わります。` : '';
  if (n > 0 && c.w === null) {
    h += `<p class="over" data-testid="calib-short">較正に使える結果が不足しています（空洞あり ${c.pos} 件・なし ${c.neg} 件。各3件以上で較正）。重みは変えません。</p>`;
  } else if (c.w !== null) {
    const fin = ad.w;
    const a0 = ad.cur.toFixed(2), a1 = aucAt(surveyedSet(), STATE.cellSat, fin).toFixed(2);
    const concl = ad.adopt ? `<p class="okmsg" data-testid="adopt"><b>重み ${pct(STATE.w)}% → ${pct(fin)}%</b>（当たりやすさ ${a0} → ${a1}）。${pvTxt}</p>`
      : ad.reason === 'same' ? `<p class="okmsg" data-testid="no-change"><b>今の重み ${pct(fin)}% が最も当たりやすい重みでした</b>（当たりやすさ ${a1}）。${pvTxt}</p>`
        : `<p class="warnbox" data-testid="no-change"><b>この結果では重みを変えられません（${pct(fin)}% のまま）</b>：${REASON[ad.reason]}（当たりやすさ ${a0}、0.5＝当てずっぽう）。${pvTxt}</p>`;
    h += `${concl}<details><summary>詳しく（${AUC_TH}）</summary><table><thead><tr><th>点数のつけ方${demo ? '（架空の結果）' : ''}</th><th class="n">当たりやすさ</th></tr></thead><tbody>
        <tr><td>台帳のみ（衛星0%）</td><td class="n">${c.ledgerOnly.toFixed(2)}</td></tr>
        <tr><td>衛星のみ（100%）</td><td class="n">${c.satOnly.toFixed(2)}</td></tr>
        ${ad.adopt || ad.reason === 'same' ? '' : `<tr><td>最良: 衛星 ${pct(c.w)}%</td><td class="n">${ad.best.toFixed(2)}</td></tr>`}
        <tr class="pick"><td>採用: 衛星 ${pct(fin)}%${ad.adopt ? `（${pct(STATE.w)}% から更新）` : '（今のまま）'}</td><td class="n" data-testid="auc-adopted">${aucAt(surveyedSet(), STATE.cellSat, fin).toFixed(2)}</td></tr></tbody></table>
      <p class="note">重みを変える条件（仮の基準）: 当たりやすさ ${MIN_AUC.toFixed(2)} 以上かつ今の重みより ${MIN_GAIN.toFixed(2)} 以上高い。当たりやすさ＝空洞のあった区間が高い点数になる確率。${demo ? '空洞の有無は架空で、精度や効果を示しません。' : '調査した区間の中での比較で、実際の精度・効果ではありません。'}</p></details>`;
  }
  h += resTotal;
  const why = c.w !== null || demo ? '' : (n === 0
    ? '<p class="why" data-testid="apply-why">まだ結果がないので進めません。<button class="linkbtn" id="demo-go" type="button">説明用デモで動きを見る（架空の結果）</button></p>'
    : '<p class="why" data-testid="apply-why">結果が足りないので進めません（各3件以上）。<button class="linkbtn" id="demo-go" type="button">説明用デモで動きを見る（架空の結果）</button></p>');
  const scanned = demo ? n - pastN : 0;
  const scanBtn = demo && (sel.size || !scanned) ? `<button class="btn ${sel.size && !scanned ? 'pri' : ''}" id="scan" type="button" ${sel.size ? '' : 'disabled'}>走査結果を入れる（架空）</button> ` : '';
  const applyLabel = c.w !== null && !ad.adopt ? `重みを変えずに第${STATE.round + 1}回へ` : `較正を反映して第${STATE.round + 1}回へ`;
  h += `<div class="stickybar">${why}${scanBtn}<button class="btn ${demo && !scanned ? '' : 'pri'}" id="apply" type="button" ${c.w === null ? 'disabled' : ''}>${applyLabel}</button></div>
    <details id="fmt-box"><summary>CSV の書式・GMS3・説明用デモについて</summary>${FORMAT_HTML}</details>`;
  $('#s3').innerHTML = h;
  $('#apply').onclick = applyCalib;
  if ($('#scan')) $('#scan').onclick = demoScan;
  if ($('#go2')) $('#go2').onclick = () => setStep(2);
  if ($('#demo-go')) $('#demo-go').onclick = () => setDemo(true);
  if ($('#clear-res')) $('#clear-res').onclick = () => { clearResults(); render(); };
  if ($('#csv-file')) $('#csv-file').onchange = onFile;
}

function clearResults() { STATE.results = new Map(); STATE.loadInfo = null; STATE.srcSample = false; STATE.srcUser = false;
  // 結果を消したら、その結果で決めた重み・回も初めに戻す（結果が無いのに較正済みの表示が残らないように）
  if (STATE.round > 1) { STATE.w = 0.1; STATE.round = 1; STATE.msg = ''; STATE.cmp = ''; STATE.calibNote = ''; STATE.appliedW = null; recompute(); }
  STATE.appliedN = 0; markSurveyed(); }
/** 架空の値を含むか（説明用デモ、または同梱の見本 CSV を入れた時）。 */
const isFake = () => STATE.demo || STATE.srcSample;
/** 同梱の見本 CSV か。note 列の「架空の見本」で判定する。 */
const isSampleCsv = (text) => /架空の見本/.test(text);
function updateBadge() {
  const n = STATE.results.size;
  let t = BADGE_DEFAULT, fake = false;
  const sm = innerWidth < 720;
  if (sm && !STATE.demo && !STATE.srcSample && !n) t = '実データ／レーダ結果は未入力';
  if (STATE.demo) { t = sm ? 'デモ：レーダ結果は架空' : '説明用デモ：レーダ結果は架空'; fake = true; }
  else if (STATE.srcSample) { t = `架空を含む（見本 CSV）：レーダ結果 ${n} 区間は架空の値${STATE.srcUser ? '・利用者の CSV を含む' : ''}`; fake = true; }
  else if (n > 0) t = sm ? `実データ＋あなたの結果 ${n} 区間` : `実データ＋あなたが入れた調査結果 ${n} 区間（出所はあなたが確認）`;
  $('#badge').textContent = t;
  // パネル内は状態の短い語だけ（詳しい表示は地図上のバッジ）
  const st = $('#status'); st.textContent = fake ? '架空を含む' : n > 0 ? 'あなたの結果入り' : '実データ'; st.hidden = STATE.demo; st.classList.toggle('fake', fake);
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
  const m = $('#load-msg'); if (m && m.scrollIntoView) m.scrollIntoView({ block: 'start' }); // 読み込み結果の直後に較正の結論が続く
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
  STATE.w = 0.1; STATE.round = 1; STATE.msg = ''; STATE.cmp = ''; STATE.calibNote = ''; STATE.appliedW = null;
  STATE.pastSet = on ? new Set(STATE.demoData.past) : null; STATE.appliedN = on ? STATE.demoData.past.length : 0;
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
  const ad = adoptWeight(c, surveyedSet(), STATE.cellSat, STATE.w);
  const oldW = STATE.w;
  // 比べる元: 今の重みで、調査結果を入れる前の並び（調査済みも含む生活道路）
  const { moved, before5, after5 } = shiftAfter(ad.w);
  const nDone = STATE.segs.filter((s) => s.cls === 'life' && STATE.results.has(s.id)).length;
  STATE.w = ad.w;
  STATE.appliedW = c.w === null ? null : ad.w;
  recompute(); markSurveyed();
  const fk = STATE.demo ? '（架空の結果による）' : STATE.srcSample ? '（見本 CSV＝架空の値による）' : '';
  STATE.calibNote = ad.adopt ? `較正で ${pct(oldW)}% → ${pct(STATE.w)}% に更新。` : `較正の結果、${pct(STATE.w)}% のまま（${REASON[ad.reason]}）。`;
  const head = ad.adopt ? `重み ${pct(oldW)}% → <b>${pct(STATE.w)}%</b>。` : `重みは ${pct(STATE.w)}% のまま。`;
  STATE.msg = `${fk}${head}調査済み ${nDone} 区間を除き、上位20のうち <b>${moved}</b> 区間が入れ替わり。`;
  STATE.cmp = `${before5.join('・')} → <b>${after5.join('・')}</b>`;
  STATE.round += 1; STATE.appliedN = STATE.results.size; STATE.autoInit = false;
  setStep(1);
}

function renderS4() {
  $('#s4').innerHTML = `<h2>実データで確かめる（参考）</h2><p class="note">町単位・全国の集計で、地図には出ません。</p>${verifyHtml(STATE.verify)}`;
}

function toTop() { const b = $('#panel-body'); if (b) b.scrollTop = 0; }
function setStep(n) {
  // 第2段階に初めて入った時は、予算内で自動選択した状態から始める（「自動で選ぶ」を押す手間を省く）
  if (n === 2 && !STATE.selected.size && !STATE.autoInit) { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); STATE.autoInit = true; STATE.exportMsg = ''; }
  STATE.step = n; STATE.focus = null; STATE.focusCell = null; render(); syncDetail(); toTop();
  if (map) requestAnimationFrame(fit);
}

function renderLegend() {
  const pal = STATE.data.satellite.palette, used = [...new Set(STATE.data.cells.map((c) => c.k))].sort((x, y) => x - y);
  const chips = used.map((k) => { const c = STATE.data.cells.find((x) => x.k === k), neg = c.range[1] <= 0; return `<div class="lg"><span class="sw sq" style="background:${pal[k]};${neg ? 'background-image:repeating-linear-gradient(45deg,#4d5c64 0 1px,transparent 1px 5px)' : ''}"></span>${neg ? '地表がやや沈下側（斜線）' : '地表がやや隆起側'} ${fmtRange(c.range)} mm/年</div>`; }).join('');
  const fk = isFake() ? '（架空）' : '';
  $('#legend').innerHTML = `${chips}
    <div class="note">衛星の区画（2つの差は誤差の幅以内）</div>
    <div>道路の点数</div><div class="grad"></div><div class="lg" style="justify-content:space-between"><span>低</span><span>高</span></div>
    <div class="lg"><span class="sw" style="border-color:#1a237e;border-top-width:6px"></span>選択した区間</div>
    <div class="lg"><span class="sw" style="border-color:#59656d;border-top-style:dashed"></span>結果が入った区間${fk}</div>
    <div class="lg"><span class="sw" style="border-color:#9aa5ab;border-top-width:2px"></span>幹線（対象外）</div>
    <div class="lg"><span class="sw" style="border-color:#8a969d;border-top-width:2px;border-top-style:dotted"></span>台帳なし（対象外）</div>
    <div class="lg"><span class="dot" style="background:#d55e00;border:3px solid #fff;outline:1px solid #555"></span>空洞あり${fk}　<span class="dot" style="background:#fff;border:2px solid #0072b2"></span>なし${fk}</div>`;
}

function segDetail(id) {
  const s = STATE.ranked.find((x) => x.id === id); if (!s) return '';
  const a = ageNorm(s.year), sat = STATE.cellSat[s.cell], c = cellOf(s.cell);
  const done = STATE.results.has(id) ? STATE.results.get(id) : null;
  const fake = isFake() ? '（架空）' : '';
  const kind = s.cls === 'arterial' ? '幹線（対象外）' : s.cls === 'noledger' ? '台帳に管渠が紐づかない道路' : '生活道路';
  const ledger = s.cls === 'noledger' ? '台帳: 15m以内に豊中市の管渠なし（理由は未特定）'
    : `台帳: 竣工 ${yearTxt(s.year)}${s.year == null ? '（不明。古さは中立の0.5）' : `（経過 ${NOW_YEAR - s.year}年）`}${s.dia ? `／管径 ${s.dia} mm` : ''}`;
  const satWhy = sat === 0 ? '（隆起側は沈下なしで 0）' : '';
  return `<h3>区間 ${s.id}${s.name ? `（${s.name}）` : ''}：${kind}・${s.lenM} m</h3>
    <p>${ledger}<br>
    衛星: 区画 ${s.cell} の階級 ${fmtRange(c.range)} mm/年 → 値 ${sat.toFixed(2)}${satWhy}<br>
    ${s.cls === 'noledger' ? '' : `点数 <b>${s.score.toFixed(2)}</b> ＝ 台帳 ${pct(1 - STATE.w)}% × 古さ ${a.toFixed(2)} ＋ 衛星 ${pct(STATE.w)}% × ${sat.toFixed(2)}<br>`}
    ${done !== null ? `調査結果${fake}: <span class="chip ${done ? 'hit' : 'ok'}">${done ? '空洞あり' : '空洞なし'}</span>` : s.cls === 'arterial' ? '点数の対象外（生活道路が対象）。' : s.cls === 'noledger' ? '' : STATE.selected.has(id) ? '選択中。' : '結果は未入力。'}</p>`;
}
function cellDetail(id) {
  const c = cellOf(id); if (!c) return '';
  return `<h3>衛星の区画 ${c.id}</h3><p>変位速度（準上下方向）の階級 <b>${fmtRange(c.range)} mm/年</b>（約90m、幅 ${c.dispW} mm/年）。国土地理院は「数百m四方より狭い変動の把握は困難」としており、生活道路単位の値ではありません。</p>`;
}
/** 内訳を出す。表に行があればその行の直下に、無ければパネル上部（#detail）に出す。 */
function syncDetail() {
  const body = STATE.focusCell ? cellDetail(STATE.focusCell) : STATE.focus ? segDetail(STATE.focus) : '';
  document.querySelectorAll('tr.drow').forEach((r) => r.remove());
  document.querySelectorAll('tr.on').forEach((r) => r.classList.remove('on'));
  const html = body ? body.replace('</h3>', ' <button class="linkbtn dclose" id="detail-close" type="button">閉じる</button></h3>') : '';
  const row = !STATE.focusCell && STATE.focus ? document.querySelector(`#s${STATE.step} tr[data-id="${STATE.focus}"]`) : null;
  if (row) {
    row.classList.add('on');
    const tr = document.createElement('tr'); tr.className = 'drow';
    tr.innerHTML = `<td colspan="${row.children.length}"><div class="dbox" aria-live="polite">${html}</div></td>`;
    row.after(tr); $('#detail').innerHTML = '';
  } else $('#detail').innerHTML = html;
  const dc = $('#detail-close'); if (dc) dc.onclick = () => { STATE.focus = null; STATE.focusCell = null; syncDetail(); };
  if (map && map.getLayer('seg-focus')) map.setFilter('seg-focus', ['==', ['get', 'id'], STATE.focusCell ? '' : STATE.focus || '']);
  return !!row;
}
function focusSeg(id) {
  STATE.focus = id; STATE.focusCell = null; syncDetail();
  const s = STATE.segs.find((x) => x.id === id);
  if (map && s) map.easeTo({ center: [(s.coords[0][0] + s.coords[1][0]) / 2, (s.coords[0][1] + s.coords[1][1]) / 2], offset: innerWidth < 720 ? [0, 0] : [200, 0], duration: 400 });
}
function toggleSeg(id) {
  const s = STATE.segs.find((x) => x.id === id);
  if (STATE.step !== 2 || !s || s.cls !== 'life' || s.surveyed) return;
  if (STATE.selected.has(id)) STATE.selected.delete(id); else STATE.selected.add(id);
  STATE.exportMsg = '';
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
  <li>較正: これまでの調査結果に対し、重み（0〜100%）ごとの当たりやすさ（AUC）を比べ、最大の重みの AUC が 0.60 以上かつ今の重みより 0.05 以上高いときだけ重みを更新します（仮の基準。満たさなければ重みは変えず、調査した区間を除いて順位だけ作り直す）。空洞あり／なしが各3件未満なら較正しません。表と自動選定で点数が同じ区間は、竣工年の古い順→区間番号順に並べます。調査した区間は点数の高い所に偏りやすく、AUC は調査した区間の中での比較です。実際の精度・効果を示すものではありません。</li>
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
  if ((STATE.step === 2 || STATE.step === 3) && STATE.selected.size) fitSelected();
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
    map.addLayer({ id: 'res-ok', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 0], paint: { 'circle-radius': ['case', ['==', ['get', 'past'], 1], 2, 4], 'circle-color': '#fff', 'circle-stroke-color': '#0072b2', 'circle-stroke-width': ['case', ['==', ['get', 'past'], 1], 1, 2.5], 'circle-opacity': ['case', ['==', ['get', 'past'], 1], 0.5, 1], 'circle-stroke-opacity': ['case', ['==', ['get', 'past'], 1], 0.5, 1] } });
    map.addLayer({ id: 'res-hit', type: 'circle', source: 'res', filter: ['==', ['get', 'hit'], 1], paint: { 'circle-radius': ['case', ['==', ['get', 'past'], 1], 3, 7], 'circle-color': '#d55e00', 'circle-stroke-color': '#fff', 'circle-stroke-width': ['case', ['==', ['get', 'past'], 1], 1, 2], 'circle-opacity': ['case', ['==', ['get', 'past'], 1], 0.55, 1], 'circle-stroke-opacity': ['case', ['==', ['get', 'past'], 1], 0.55, 1] } });
    const roadLayers = ['seg-todo', 'seg-done', 'seg-none', 'seg-art'];
    map.on('click', (e) => {
      const r = 9, f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: roadLayers });
      if (!f.length) {
        const cf = map.queryRenderedFeatures(e.point, { layers: ['cells-fill'] });
        if (cf.length) { STATE.focusCell = cf[0].properties.id; syncDetail(); toTop(); }
        return;
      }
      const id = f[0].properties.id; STATE.focus = id; STATE.focusCell = null; toggleSeg(id); if (syncDetail()) { const d = document.querySelector('tr.drow'); if (d && d.scrollIntoView) d.scrollIntoView({ block: 'nearest' }); } else toTop();
    });
    map.on('mousemove', (e) => { const r = 6; map.getCanvas().style.cursor = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: roadLayers }).length ? 'pointer' : ''; });
    syncDetail();
    refreshMap();
    window.__ready = true;
  });
}

document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
$('#sheet-toggle').onclick = () => { const p = $('#panel'); p.classList.toggle('closed'); const closed = p.classList.contains('closed'); document.body.classList.toggle('sheet-closed', closed); $('#sheet-toggle').setAttribute('aria-expanded', String(!closed)); $('#sheet-toggle').textContent = closed ? '▲ パネルを開く' : '▼ 地図を広く見る'; setTimeout(fit, 260); };
window.addEventListener('resize', () => fit());
const openAbout = () => { $('#modal').hidden = false; const box = $('.modal-box'); box.scrollTop = 0; box.focus({ preventScroll: true }); };
$('#btn-about').onclick = openAbout;
$('#demo-off').onclick = () => setDemo(false);
$('#btn-close').onclick = () => { $('#modal').hidden = true; };
$('#btn-close2').onclick = () => { $('#modal').hidden = true; };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

window.App = { STATE, getMap: () => map, setStep, toggleSeg, loadCsvText, setDemo, demoScan, applyCalib, render, focusSeg, exportSelected,
  autoSelect: () => { STATE.selected = new Set(selectByBudget(STATE.ranked, STATE.budgetKm)); render(); } };
init();
