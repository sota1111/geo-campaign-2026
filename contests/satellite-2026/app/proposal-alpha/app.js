(function () {
  'use strict';
  const L = window.TreeLib, SAMPLE = window.SAMPLE, CHM = window.CHM;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const KEY_R = 'alpha-results-v1', KEY_W = 'alpha-weights-v1';
  const TUNE_KEYS = { change: '台風・豪雨前後の変化', terrain: '地形', facility: '重要施設', road: '道路との関係' };

  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  // 保存データは古い形式・空・壊れていることがあるので、読み込み時に必ず整えてから使う
  const loadResults = () => L.sanitizeResults(load(KEY_R, []));
  const loadWeights = () => L.normalizeWeights(load(KEY_W, null));
  const state = { results: loadResults(), weights: loadWeights(), sel: null, satOnly: false, tuneKey: 'change', line: [], cur: null };
  const D = SAMPLE;
  // 基準年は開いた年（サンプルの伐採年は固定値なので、年が進めば経過年数も進む）。日付は日本時間で扱う
  const REF_YEAR = +new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 4) || new Date().getFullYear();

  function recompute() {
    state.ranked = L.rank(D.sections, state.weights, REF_YEAR, state.results, state.satOnly);
    const sat = L.rank(D.sections, state.weights, REF_YEAR, state.results, true);
    state.satRank = {}; sat.forEach((s) => (state.satRank[s.id] = s.rank));
    const both = state.satOnly ? L.rank(D.sections, state.weights, REF_YEAR, state.results, false) : state.ranked;
    state.fullRank = {}; both.forEach((s) => (state.fullRank[s.id] = s.rank));
  }
  const saveResults = () => localStorage.setItem(KEY_R, JSON.stringify(state.results));
  const resClass = (r) => 'r' + Math.max(0, L.RESULTS.indexOf(r));

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function color(s) { const t = Math.min(1, s.score / (state.satOnly ? 70 : 110)); return 'rgb(' + Math.round(230 - 60 * t) + ',' + Math.round(170 - 125 * t) + ',' + Math.round(110 - 80 * t) + ')'; }
  const facs = (s) => s.customers + '戸' + (s.facility !== 'なし' ? '・' + s.facility : '');

  // ---- ① 台帳と地図 ----
  function filtered() {
    const f = $('#f-feeder').value, u = $('#f-unvisited').checked;
    return state.ranked.filter((s) => (!f || s.feeder === f) && (!u || !s.latest));
  }
  function renderLedger() {
    const rows = filtered();
    $('#ledger thead').innerHTML = '<tr><th>順位</th><th>点数<br><small>衛星・公開 / 事業者データ</small></th><th>区間</th><th>樹高(m)</th><th>高木率</th><th>変化</th><th>地形</th><th>停電想定</th><th>衛星のみなら</th><th>最新の確認</th></tr>';
    $('#ledger tbody').innerHTML = rows.map((s) => {
      const latest = s.latest ? '<span class="tag ' + resClass(s.latest.result) + '">' + esc(s.latest.result) + '</span> ' + esc(s.latest.date) : '未確認';
      const sel = s.id === state.sel ? ' class="sel"' : '';
      return '<tr data-id="' + s.id + '"' + sel + '><td>' + s.rank + '</td><td>' + s.score + '（' + s.satScore + ' / ' + s.opScore + '）' + (s.missing && s.missing.length ? ' <span class="tag r1" title="' + esc(s.missing.join('・')) + 'が欠損">欠損あり</span>' : '') + '</td><td>' + s.id + '</td><td>' + (s.p90 == null ? '不明' : s.p90) + '</td><td>' + (s.tallPct == null ? '不明' : s.tallPct + '%') + '</td><td>' + esc(s.change) + '</td><td>' + esc(s.terrain) + '</td><td>' + esc(facs(s)) + '</td><td>' + state.satRank[s.id] + '位</td><td>' + latest + '</td></tr>';
    }).join('') || '<tr><td colspan="10">該当なし</td></tr>';
    $('#count').textContent = rows.length + '区間（架空）を、' + (state.satOnly ? '衛星・公開データ由来の点数だけ' : '事業者データを重ねた点数') + 'の高い順に表示。「衛星のみなら」は事業者データを重ねない場合の順位。';
    renderMap(rows); renderDetail();
  }
  function renderMap(rows) {
    const v = D.view; $('#map').setAttribute('viewBox', v.join(' '));
    const ids = new Set(rows.map((s) => s.id));
    let h = D.forests.map((p) => '<polygon points="' + p + '" fill="#d3e5c6" stroke="none"/>').join('');
    h += '<polyline points="' + D.river + '" fill="none" stroke="#8fb8d8" stroke-width="6"/>';
    D.roads.forEach((r, i) => (h += '<polyline points="' + r + '" fill="none" stroke="' + (i === 0 ? '#9a9382' : '#b9b3a2') + '" stroke-width="' + (i === 0 ? 3 : 2) + '"/>'));
    h += '<text x="8" y="392" font-size="11" fill="#555">架空の模式図（実在の地図ではありません）　灰=道路　青=川　緑=森林</text>';
    h += '<rect x="' + (D.depot.x - 6) + '" y="' + (D.depot.y - 6) + '" width="12" height="12" fill="#222"/><text x="' + (D.depot.x + 10) + '" y="' + (D.depot.y + 4) + '" font-size="11">' + esc(D.depot.name) + '</text>';
    state.ranked.filter((s) => ids.has(s.id)).slice().reverse().forEach((s) => {
      const pts = s.pts.map((p) => p.join(',')).join(' '), m = L.mid(s), on = s.id === state.sel;
      h += '<g class="mk" data-id="' + s.id + '"><polyline points="' + pts + '" fill="none" stroke="transparent" stroke-width="16"/><polyline points="' + pts + '" fill="none" stroke="' + color(s) + '" stroke-width="' + (on ? 8 : 6) + '" stroke-linecap="round"/>' +
        '<circle cx="' + m[0] + '" cy="' + m[1] + '" r="11" fill="' + color(s) + '" stroke="' + (on ? '#000' : '#fff') + '" stroke-width="2"/><text x="' + m[0] + '" y="' + (m[1] + 4) + '">' + s.rank + '</text></g>';
    });
    $('#map').innerHTML = h;
    $('#legend').textContent = '線の太い部分が配電線の区間（架空）、丸の数字は順位。濃い赤ほど優先度が高い。';
  }
  function partsHtml(s) {
    return s.parts.map((p) => '<span class="src-' + p[2] + '">' + (p[2] === 'sat' ? '[衛星・公開] ' : '[事業者等] ') + '</span>' + esc(p[0]) + ' ' + (p[1] >= 0 ? '+' : '') + p[1]).join('<br>');
  }
  function renderDetail() {
    const s = state.ranked.find((x) => x.id === state.sel), el = $('#detail');
    if (!s) { el.innerHTML = '<p>左の表か地図で区間を選ぶと、点数の内訳と確認の記録が見られます。</p>'; return; }
    const hist = state.results.filter((r) => r.siteId === s.id).reverse();
    const histH = hist.length ? hist.map((r) => esc(r.date) + ' ' + esc(r.result) + (r.memo ? '（' + esc(r.memo) + '）' : '')).join('<br>') : 'なし';
    el.innerHTML = '<h2>' + esc(s.id) + '（順位 ' + s.rank + '／点数 ' + s.score + '）</h2><dl>' +
      '<dt>区間</dt><dd>' + esc(s.name) + '（延長 約' + s.lenM + ' m。すべて架空）</dd>' +
      '<dt>点数の内訳</dt><dd>' + partsHtml(s) + '</dd>' +
      '<dt>見方</dt><dd>衛星・公開データ由来 ' + s.satScore + ' 点、事業者・自治体のデータ由来 ' + s.opScore + ' 点。樹高の値は区間の相対比較用で、<b>電線との離隔距離ではありません</b>。</dd>' +
      '<dt>現地確認</dt><dd>' + histH + '</dd></dl><p><button id="btn-goto-rec">この区間の結果を記録する</button></p>';
    $('#btn-goto-rec').onclick = () => { show('record'); $('#r-site').value = s.id; };
  }

  // ---- ② 計画と協議用の表 ----
  function planData() { return L.planRoute(state.ranked, D.depot, +$('#cap').value || 0); }
  function renderPlan() {
    const p = planData();
    $('#plan-help').textContent = '点数の高い順に上位N区間を選び、航空LiDAR・ドローン等の高精度測定と現地確認に回す対象にします（衛星は「どこを先に測るか」を決める入口）。回る順は営業所（架空）から近い順（地図上の直線距離の最近傍法）で、道路事情・立入可否は考慮しません。';
    $('#plan-list').innerHTML = p.route.map((s) => '<li>' + esc(s.id) + '（点数' + s.score + '・' + esc(s.change) + '・' + esc(facs(s)) + '・約' + s.lenM + ' m）</li>').join('');
    const len = p.route.reduce((a, s) => a + s.lenM, 0);
    $('#plan-total').textContent = '高精度測定の対象延長: 約' + (len / 1000).toFixed(1) + ' km（全' + D.sections.reduce((a, s) => a + s.lenM, 0) / 1000 + ' km（架空）のうち）／地図上の周回距離の目安: ' + Math.round(p.total) + '（模式図の単位。道路距離ではありません）';
    $('#share-box').innerHTML = '<b>協議用の区間表（事業者・市町村・府県が共有する）</b><div class="tablewrap"><table><thead><tr><th>順位</th><th>区間</th><th>衛星・公開データ由来</th><th>事業者データ由来</th><th>停電想定・施設</th><th>実施主体・費用負担</th></tr></thead><tbody>' +
      p.route.map((s) => '<tr><td>' + s.rank + '</td><td>' + esc(s.id) + '</td><td>' + s.satScore + '点</td><td>' + s.opScore + '点</td><td>' + esc(facs(s)) + '</td><td><span class="hand">協議で決める（空欄）</span></td></tr>').join('') +
      '</tbody></table></div><p class="note">費用負担は法令に定めがなく、事業者と自治体の個別協議で決まります（総務省調査）。この欄は協議の記録用の空欄で、本デモは値を入れません。</p>';
  }

  // ---- ③ 記録 ----
  function renderRecord() {
    $('#r-site').innerHTML = D.sections.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.id) + ' ' + esc(s.name) + '</option>').join('');
    $('#r-result').innerHTML = L.RESULTS.map((r) => '<option>' + r + '</option>').join('');
    renderRecTable();
  }
  function renderRecTable() {
    $('#rec-table tbody').innerHTML = state.results.slice().reverse().map((r) => '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.siteId) + '</td><td>' + esc(r.who) + '</td><td><span class="tag ' + resClass(r.result) + '">' + esc(r.result) + '</span></td><td>' + esc(r.memo) + '</td></tr>').join('') || '<tr><td colspan="5">記録なし</td></tr>';
  }

  // ---- ④ 見直し ----
  function renderTune() {
    const key = state.tuneKey, st = L.hitStats(D.sections, state.results, key), dw = L.DEFAULT_WEIGHTS[key];
    $('#t-key').innerHTML = Object.keys(TUNE_KEYS).map((k) => '<option value="' + k + '"' + (k === key ? ' selected' : '') + '>' + TUNE_KEYS[k] + '</option>').join('');
    $('#hit-table tbody').innerHTML = Object.keys(dw).map((c) => {
      const o = st[c] || { n: 0, hit: 0 };
      return '<tr><td>' + esc(c) + '</td><td>' + o.n + '</td><td>' + o.hit + (o.n >= 5 ? '（' + Math.round(100 * o.hit / o.n) + '%）' : '（件数が少なく率は出しません）') + '</td><td>' + dw[c] + '</td><td><input type="number" min="0" max="50" data-c="' + esc(c) + '" value="' + state.weights[key][c] + '" aria-label="' + esc(c) + 'の重み"></td></tr>';
    }).join('');
    document.querySelectorAll('#hit-table input').forEach((i) => (i.onchange = () => {
      state.weights[key][i.dataset.c] = Math.max(0, Math.min(50, +i.value || 0));
      localStorage.setItem(KEY_W, JSON.stringify(state.weights)); recompute(); renderLedger();
    }));
  }

  // ---- ⑤ 実データ（樹高マップ） ----
  const Z = 16;
  const RX = {};
  function heatColor(h) {
    if (h <= 0) return [0, 0, 0, 0];
    const t = Math.min(1, h / 28);
    return [Math.round(60 + 195 * t), Math.round(190 - 130 * t), Math.round(70 - 40 * t), 200];
  }
  function buildReal() {
    const a = L.tileOf(CHM.nw[0], CHM.nw[1], Z), b = L.tileOf(CHM.se[0], CHM.se[1], Z);
    RX.x0 = a.wx; RX.y0 = a.wy; RX.w = b.wx - a.wx; RX.h = b.wy - a.wy; RX.cw = RX.w / CHM.n;
    const midLat = (CHM.nw[1] + CHM.se[1]) / 2;
    RX.cellM = 156543.03392 * Math.cos(midLat * Math.PI / 180) / Math.pow(2, Z) * RX.cw;
    const cv = document.createElement('canvas'); cv.width = cv.height = CHM.n;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(CHM.n, CHM.n);
    for (let r = 0; r < CHM.n; r++) for (let c = 0; c < CHM.n; c++) { const p = heatColor(CHM.h[r][c]), i = (r * CHM.n + c) * 4; img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = p[3]; }
    ctx.putImageData(img, 0, 0);
    RX.url = cv.toDataURL('image/png');
    // 線の両側の幅は、集約セル（約12m）の整数倍だけを選べる（10m・15m のような1セル未満の差は格子では区別できないため）
    $('#x-buf').innerHTML = [[0, '線が通るセルだけ'], [1, '線から1セル以内'], [2, '線から2セル以内']].map((o) => '<option value="' + (o[0] * RX.cellM) + '"' + (o[0] === 1 ? ' selected' : '') + '>' + o[1] + '（両側 約' + Math.round(o[0] * RX.cellM) + ' m）</option>').join('');
    let tiles = '';
    for (let tx = Math.floor(RX.x0 / 256); tx <= Math.floor((RX.x0 + RX.w) / 256); tx++)
      for (let ty = Math.floor(RX.y0 / 256); ty <= Math.floor((RX.y0 + RX.h) / 256); ty++)
        tiles += '<image href="' + TILE + 'std/' + Z + '/' + tx + '/' + ty + '.png" x="' + tx * 256 + '" y="' + ty * 256 + '" width="256" height="256"/>';
    RX.tiles = tiles;
  }
  function renderReal() {
    if (!RX.url) buildReal();
    const svg = $('#xmap');
    svg.setAttribute('viewBox', RX.x0 + ' ' + RX.y0 + ' ' + RX.w + ' ' + RX.h);
    const sw = RX.w / 260;
    let h = '<rect x="' + RX.x0 + '" y="' + RX.y0 + '" width="' + RX.w + '" height="' + RX.h + '" fill="#e8ebe3"/>' + RX.tiles +
      '<image href="' + RX.url + '" x="' + RX.x0 + '" y="' + RX.y0 + '" width="' + RX.w + '" height="' + RX.h + '" opacity="0.62" style="image-rendering:pixelated"/>';
    const pts = state.line.map((p) => [RX.x0 + p[0] * RX.cw, RX.y0 + p[1] * RX.cw]);
    if (pts.length > 1) h += '<polyline points="' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ') + '" fill="none" stroke="#1a1a8c" stroke-width="' + sw * 1.6 + '" stroke-linejoin="round"/>';
    if (state.cur) { const cx = RX.x0 + (state.cur[0] + 0.5) * RX.cw, cy = RX.y0 + (state.cur[1] + 0.5) * RX.cw; h += '<path d="M' + (cx - sw * 5) + ' ' + cy + 'H' + (cx + sw * 5) + 'M' + cx + ' ' + (cy - sw * 5) + 'V' + (cy + sw * 5) + '" stroke="#c00" stroke-width="' + sw * 0.8 + '" fill="none" style="pointer-events:none"/>'; }
    pts.forEach((p, i) => (h += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + sw * 2.2 + '" fill="#fff" stroke="#1a1a8c" stroke-width="' + sw + '"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] + sw * 0.9).toFixed(1) + '" font-size="' + sw * 2.4 + '" text-anchor="middle" fill="#1a1a8c" style="pointer-events:none">' + (i + 1) + '</text>'));
    svg.innerHTML = h;
    $('#x-legend').innerHTML = '樹高の凡例: <svg width="150" height="10" role="img" aria-label="樹高の凡例（低い=緑、高い=赤）"><defs><linearGradient id="lg"><stop offset="0" stop-color="rgb(60,190,70)"/><stop offset="1" stop-color="rgb(255,60,30)"/></linearGradient></defs><rect width="150" height="10" fill="url(#lg)"/></svg> 0 m〜28 m以上（色なし=樹木なし、または元データが0m）。1セル=約' + RX.cellM.toFixed(0) + ' m（元の約1m格子を12画素ごとに集約した90パーセンタイル）。背景は地理院地図（標準）。';
    const rs = $('#x-result');
    if (state.line.length < 2) { rs.innerHTML = '<p>地図をクリックして線の頂点を置いてください（2点以上で集計します）。「例の線を引く」でも試せます。</p>'; return; }
    const buf = +$('#x-buf').value, tall = +$('#x-tall').value;
    const r = L.alongLine(CHM, RX.cellM, state.line, buf, tall, 100);
    state.xr = r;
    if (r.outside) { rs.innerHTML = '<p><b>この線は樹高マップの範囲外です。</b>データがないため、樹高は集計できません（「0 m＝樹木なし」ではありません）。</p>'; return; }
    const val = (c, v, unit) => (c.outside ? '範囲外' : v + (unit || ''));
    const inChunks = r.chunks.map((c, i) => i).filter((i) => !r.chunks[i].outside);
    const worst = inChunks.reduce((a, i) => { const c = r.chunks[i], b = r.chunks[a]; return c.p90 > b.p90 || (c.p90 === b.p90 && c.tallShare > b.tallShare) ? i : a; }, inChunks[0]);
    const partial = r.chunks.some((c) => c.outside) || r.insideShare < 1;
    rs.innerHTML = '<h2 style="font-size:16px;margin:0 0 4px">仮の線の周囲の樹高（実データ）</h2>' +
      '<p>線の長さ 約' + Math.round(r.lengthM) + ' m／線から ' + r.bufferCells + ' セル以内（両側 約' + Math.round(r.bufferUsedM) + ' m）に入るセル ' + r.cells + '個。' + (partial ? '<b>線の一部は樹高マップの範囲外で、その部分は集計に入っていません（0 m ではなく「範囲外」）。</b>' : '') + '樹高（セルの値）の最大 ' + r.max + ' m、90%値 ' + r.p90 + ' m、' + tall + ' m以上のセルの割合 ' + Math.round(r.tallShare * 100) + '%。</p>' +
      '<div class="tablewrap"><table><thead><tr><th>区間（線に沿った距離）</th><th>セル数</th><th>最大(m)</th><th>90%値(m)</th><th>' + tall + 'm以上</th><th></th></tr></thead><tbody>' +
      r.chunks.map((c, i) => '<tr' + (i === worst ? ' class="sel"' : '') + '><td>' + Math.round(c.fromM) + '〜' + Math.round(c.toM) + ' m</td><td>' + c.cells + '</td><td>' + val(c, c.max) + '</td><td>' + val(c, c.p90) + '</td><td>' + val(c, c.outside ? 0 : Math.round(c.tallShare * 100), '%') + '</td><td>' + (c.outside ? '' : '<span class="bar" style="width:' + Math.round(c.tallShare * 80) + 'px"></span>') + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="note">黄色の行は、この線の中で相対的に高木が多い100m区間（90%値、同じなら高木の割合）。<b>これは電線との離隔距離でも倒木の予測でもありません</b>。樹高マップの元画像は ' + esc(CHM.acq) + ' の撮影（冬季）で現在の樹高ではなく、論文が報告する平均絶対誤差は3つの検証データの平均で2.8 m（米国NEON 2.7 m・カリフォルニア州 0.6 m・サンパウロ州 5.1 m。日本での検証値は未確認）です。実運用では、こうして絞った区間にだけ航空LiDARやドローンを当てます。</p>';
  }
  function svgPoint(ev) {
    const svg = $('#xmap'), pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [(q.x - RX.x0) / RX.cw, (q.y - RX.y0) / RX.cw];
  }
  const PRESET = [[110, 150], [80, 135], [55, 125], [40, 110]];

  // ---- 共通 ----
  function renderFooter() {
    $('#footer').innerHTML = '<p><b>データの区別</b>: ①〜④は<b>架空サンプル</b>（data/sample.js）。実在の配電線・停電・衛星解析結果ではありません。点数のしきい値と重みは仮置きで根拠のある値ではありません。</p>' +
      '<p><b>⑤の実データ</b>（取得日 ' + esc(CHM.fetched) + '、GET のみ）: ' + esc(CHM.source) + '。この窓の元画像の撮影日は ' + esc(CHM.acq) + '（タイルの撮影日メタデータによる）。背景: 地理院タイル（標準地図、ブラウザが国土地理院から直接取得。国土地理院コンテンツ利用規約）。</p>' +
      '<p>衛星は「どこから先に高精度で測り、現地で確かめるか」を決める入口で、確認と伐採の判断は事業者と自治体が行います。</p>';
  }
  function show(v) {
    document.querySelectorAll('.view').forEach((e) => (e.hidden = e.id !== 'v-' + v));
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v));
    if (v === 'plan') renderPlan();
    if (v === 'tune') renderTune();
    if (v === 'ledger') renderLedger();
    if (v === 'real') renderReal();
  }

  function init() {
    $('#f-feeder').innerHTML = '<option value="">すべて</option>' + Array.from(new Set(D.sections.map((s) => s.feeder))).map((f) => '<option>' + f + '</option>').join('');
    $('#f-feeder').onchange = renderLedger; $('#f-unvisited').onchange = renderLedger;
    $('#f-sat').onchange = () => { state.satOnly = $('#f-sat').checked; recompute(); renderLedger(); };
    $('#tabs').onclick = (e) => { if (e.target.dataset.view) show(e.target.dataset.view); };
    const pick = (e) => { const t = e.target.closest('[data-id]'); if (t) { state.sel = t.dataset.id; renderLedger(); } };
    $('#ledger tbody').onclick = pick; $('#map').onclick = pick;
    $('#cap').onchange = renderPlan;
    $('#rec-form').onsubmit = (e) => {
      e.preventDefault();
      // 別タブで追加された記録を消さないよう、保存済みを読み直してから追加する
      const cur = loadResults();
      cur.push({ siteId: $('#r-site').value, date: $('#r-date').value, who: $('#r-who').value.trim(), result: $('#r-result').value, memo: $('#r-memo').value.trim() });
      state.results = cur; saveResults(); $('#r-memo').value = ''; recompute(); renderRecTable();
    };
    $('#btn-reset').onclick = () => { if (confirm('記録を全て消しますか')) { state.results = []; localStorage.removeItem(KEY_R); recompute(); renderRecTable(); } };
    $('#t-key').onchange = () => { state.tuneKey = $('#t-key').value; renderTune(); };
    $('#btn-weights-reset').onclick = () => { state.weights = clone(L.DEFAULT_WEIGHTS); localStorage.removeItem(KEY_W); recompute(); renderTune(); renderLedger(); };
    const note = '架空サンプル（実在の配電線・解析結果ではありません）';
    $('#btn-rec-csv').onclick = () => download('field-check-records.csv', L.toCSV(['section_id', 'check_date', 'checker', 'result', 'memo', 'data_note'], state.results.map((r) => [r.siteId, r.date, r.who, r.result, r.memo, note])));
    $('#btn-ledger-csv').onclick = () => download('ledger.csv', L.toCSV(['rank', 'score', 'sat_score', 'operator_score', 'id', 'p90_m', 'tall_pct', 'change', 'terrain', 'customers', 'facility', 'road', 'latest_result', 'data_note'], state.ranked.map((s) => [s.rank, s.score, s.satScore, s.opScore, s.id, s.p90, s.tallPct, s.change, s.terrain, s.customers, s.facility, s.road, s.latest ? s.latest.result : '', note])));
    $('#btn-plan-csv').onclick = () => download('field-check-plan.csv', L.toCSV(['order', 'id', 'score', 'len_m', 'change', 'data_note'], planData().route.map((s, i) => [i + 1, s.id, s.score, s.lenM, s.change, note])));
    $('#btn-share-csv').onclick = () => download('shared-section-table.csv', L.toCSV(['rank', 'id', 'sat_score', 'operator_score', 'customers', 'facility', 'cost_sharing', 'data_note'], planData().route.map((s) => [s.rank, s.id, s.satScore, s.opScore, s.customers, s.facility, '', note])));
    // ⑤
    $('#xmap').onclick = (e) => { if (!RX.url) return; if (state.line.length >= 12) return; state.line.push(svgPoint(e)); renderReal(); };
    // キーボードでも線を引ける: 矢印で十字を動かし（Shift で5セル）、Enter / Space で頂点を追加、Backspace で1点戻す
    $('#xmap').onkeydown = (e) => {
      if (!RX.url) return;
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key], n = CHM.n;
      if (mv) { const k = e.shiftKey ? 5 : 1; state.cur = state.cur || [n >> 1, n >> 1]; state.cur = [Math.max(0, Math.min(n - 1, state.cur[0] + mv[0] * k)), Math.max(0, Math.min(n - 1, state.cur[1] + mv[1] * k))]; e.preventDefault(); renderReal(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.cur = state.cur || [n >> 1, n >> 1]; if (state.line.length < 12) state.line.push([state.cur[0] + 0.5, state.cur[1] + 0.5]); renderReal(); }
      else if (e.key === 'Backspace') { e.preventDefault(); state.line.pop(); renderReal(); }
    };
    $('#x-preset').onclick = () => { state.line = clone(PRESET); renderReal(); };
    $('#x-undo').onclick = () => { state.line.pop(); renderReal(); };
    $('#x-clear').onclick = () => { state.line = []; state.xr = null; renderReal(); };
    $('#x-buf').onchange = renderReal; $('#x-tall').onchange = renderReal;
    recompute(); renderFooter(); renderRecord();
    $('#r-date').value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    window.addEventListener('storage', (e) => { if (e.key === KEY_R || e.key === null) { state.results = loadResults(); recompute(); renderRecTable(); renderLedger(); } });
    renderLedger();
  }
  window.App = { state, show, recompute, renderLedger, renderPlan, renderRecTable, renderReal, DS: { sample: D, real: CHM }, RX, PRESET };
  init();
})();
