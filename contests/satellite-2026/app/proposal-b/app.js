(function () {
  'use strict';
  const L = window.MorLib, SAMPLE = window.SAMPLE, REAL = window.REAL;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const PAGE = 25;
  const CITY_HALL = { lon: 139.6722, lat: 35.2814, name: '市役所付近（概略位置・出発地の仮置き）' };

  // ---- データセットの用意 ----
  function buildReal() {
    const lat0 = REAL.sites.reduce((a, s) => a + s.lat, 0) / REAL.sites.length, lon0 = REAL.sites.reduce((a, s) => a + s.lon, 0) / REAL.sites.length;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    const proj = (lon, lat) => ({ x: (lon - lon0) * kx, y: -(lat - lat0) * ky });
    const sites = REAL.sites.map((s) => Object.assign({}, s, proj(s.lon, s.lat), { name: s.id, zone: s.zone }));
    const o = proj(CITY_HALL.lon, CITY_HALL.lat);
    const zones = REAL.zones.map((z) => ({ type: z.type, points: z.ring.map((c) => { const p = proj(c[0], c[1]); return p.x.toFixed(0) + ',' + p.y.toFixed(0); }).join(' ') }));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    sites.forEach((s) => { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); });
    const pad = 600;
    return { kind: 'real', sites, zones, origin: { x: o.x, y: o.y, name: '市役所付近' }, proj,
      view: [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad], unit: 'm', refDate: REAL.fetched, mr: (x1 - x0) / 110 };
  }
  const DS = { real: buildReal(), sample: Object.assign({ kind: 'sample', view: [0, 0, 600, 400], unit: '（模式図の単位）', mr: 11 }, clone(SAMPLE)) };

  // ---- 状態 ----
  const KEYS = (m) => ({ r: 'morido-b-results-v2-' + m, w: 'morido-b-weights-v2-' + m });
  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  const urlMode = new URLSearchParams(location.search).get('mode');
  const state = { mode: urlMode === 'sample' || urlMode === 'real' ? urlMode : (load('morido-b-mode', 'real') === 'sample' ? 'sample' : 'real'), sel: null, ranked: [], shown: PAGE, results: [], weights: null };
  const D = () => DS[state.mode];
  const isReal = () => state.mode === 'real';
  const defW = () => (isReal() ? L.DEFAULT_WEIGHTS_REAL : L.DEFAULT_WEIGHTS);
  const resClass = (r) => 'r' + Math.max(0, L.RESULTS.indexOf(r));

  function loadMode() {
    const k = KEYS(state.mode);
    state.results = load(k.r, []); if (!Array.isArray(state.results)) state.results = [];
    state.weights = load(k.w, null) || clone(defW());
    state.sel = null; state.shown = PAGE;
  }
  function recompute() { state.ranked = L.rank(D().sites, state.weights, D().refDate, state.results, state.mode); }
  const saveResults = () => localStorage.setItem(KEYS(state.mode).r, JSON.stringify(state.results));
  const typeKey = () => (isReal() ? 'type' : 'change');

  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  function filtered() {
    const z = $('#f-zone').value, p = $('#f-second').value, u = $('#f-unvisited').checked;
    const key = isReal() ? 'type' : 'permit';
    return state.ranked.filter((s) => (!z || s.zone === z) && (!p || s[key] === p) && (!u || !s.latest));
  }
  function color(s) { const t = Math.min(1, s.score / (isReal() ? 75 : 90)); return 'rgb(' + Math.round(225 - 57 * t) + ',' + Math.round(150 - 100 * t) + ',' + Math.round(110 - 78 * t) + ')'; }

  // ---- 地理院タイルの写真（前: 年代別 1974〜78年 / 現在: シームレス空中写真） ----
  const PHOTO = { before: { path: 'gazo1', ext: 'jpg', label: '1974〜78年' }, now: { path: 'seamlessphoto', ext: 'jpg', label: '現在' } };
  function photoSvg(s, which, crop) {
    const t = L.tileOf(s.lon, s.lat, 17), ph = PHOTO[which];
    const url = TILE + ph.path + '/17/' + t.x + '/' + t.y + '.' + ph.ext;
    let vb = '0 0 256 256';
    if (crop) { const ox = Math.max(0, Math.min(256 - crop, t.px - crop / 2)), oy = Math.max(0, Math.min(256 - crop, t.py - crop / 2)); vb = ox.toFixed(0) + ' ' + oy.toFixed(0) + ' ' + crop + ' ' + crop; }
    let poly = '';
    if (!crop) {
      const pts = s.ring.map((c) => { const q = L.tileOf(c[0], c[1], 17); return ((q.wx - t.x * 256)).toFixed(1) + ',' + ((q.wy - t.y * 256)).toFixed(1); }).join(' ');
      poly = '<polygon points="' + pts + '" fill="none" stroke="#ffd400" stroke-width="2"/>';
    }
    return '<svg viewBox="' + vb + '" role="img" aria-label="' + ph.label + 'の空中写真（国土地理院）"><rect width="256" height="256" fill="#d9d4c5"/><text x="128" y="128" font-size="14" text-anchor="middle" fill="#666">写真なし</text><image href="' + url + '" width="256" height="256"/>' + poly + '</svg>';
  }

  // ---- 描画 ----
  function renderHead() {
    const real = isReal();
    $('#ledger thead').innerHTML = real
      ? '<tr><th>順位</th><th>点数</th><th>ID</th><th>前（1974〜78年）</th><th>現在</th><th>型</th><th>面積(m²)</th><th>標高差(m)</th><th>傾斜(°)</th><th>最新の巡視</th></tr>'
      : '<tr><th>順位</th><th>点数</th><th>ID</th><th>名称</th><th>変化</th><th>区域</th><th>許可・届出</th><th>最新の巡視</th></tr>';
    $('#f2-label').textContent = real ? '型' : '許可・届出';
    const zs = real ? ['宅地造成等工事規制区域', '特定盛土等規制区域', '区域外'] : ['特定盛土等規制区域', '宅地造成等工事規制区域', '区域外'];
    const ps = real ? ['谷埋め型', '腹付け型', '区分なし'] : ['許可・届出なし', '確認中', '許可・届出あり'];
    $('#f-zone').innerHTML = '<option value="">すべて</option>' + zs.map((z) => '<option>' + z + '</option>').join('');
    $('#f-second').innerHTML = '<option value="">すべて</option>' + ps.map((z) => '<option>' + z + '</option>').join('');
    $('#banner').innerHTML = real
      ? '<b>実データ版（神奈川県横須賀市）</b>: 造成地の位置・型・規制区域は国土数値情報、標高差と傾斜は地理院DEM、写真は地理院タイルの実データです。<b>衛星由来の変化量は未接続</b>（実運用では Sentinel-1/2 で算出）で、点数は実指標のみの暫定です。巡視結果は利用者の入力です。衛星は「どこを先に見るか」を示すだけで、違反の判断は職員が現地で行います。'
      : '<b>架空サンプル</b>: 地点・区域・変化量・許可届出・巡視結果はすべて架空で、実在の盛土や衛星解析結果ではありません。';
    $('#legend').textContent = real ? '造成地の位置（国土数値情報 A54）と規制区域（A56）の概略図。数字は順位（上位のみ）。濃い赤ほど優先度が高い。北が上。' : '模式図（実在の地図ではありません）。濃い赤ほど優先度が高い。数字は順位。';
    $('#plan-help').textContent = real ? '点数の高い順に上位N件を選び、市役所付近からの回り順（地図上の直線距離の最近傍法）で並べます。道路事情・立入可否は考慮しません。' : '点数の高い順に上位N件を選び、役所からの回り順（地図上の直線距離の最近傍法）で並べます。実際の道路事情・立入可否は考慮しません。';
    $('#m-real').setAttribute('aria-pressed', real); $('#m-sample').setAttribute('aria-pressed', !real);
    renderFooter();
  }
  function renderFooter() {
    $('#footer').innerHTML = isReal()
      ? '<p><b>データ出典</b>（取得日 ' + esc(REAL.fetched) + '、いずれも GET で取得）: ① 国土交通省 国土数値情報「大規模盛土造成地」A54（2023年版、神奈川県）CC BY 4.0。② 国土交通省 国土数値情報「宅地造成等工事規制区域・特定盛土等規制区域」A56（2025年版、データ基準日 2025年7月18日、神奈川県）CC BY 4.0。<b>概略的な位置を示す資料で法的図書ではなく、申請・根拠資料には使えません。正確な区域は指定権者に確認してください。</b>③ 国土地理院 地理院タイル（標高タイル DEM5A、シームレス空中写真、年代別の空中写真 1974〜78年）。<a href="https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html" target="_blank" rel="noopener">国土地理院コンテンツ利用規約</a>に従う。ブラウザが写真タイルを直接取得します。</p><p>加工: 面積・標高差・平均傾斜・区域内外は本デモ用に算出（標高差は造成地ポリゴン内の最大−最小で、盛土の高さそのものではありません）。A54 は自治体が公表した大規模盛土造成地の位置で、規制区域外の造成地も含みます。写真は撮影年代が異なるため、衛星で検出する直近の変化を示すものではありません。</p>'
      : '<p>架空サンプルです。区域名は宅地造成及び特定盛土等規制法の区分名称。第三者データを含みません。</p>';
  }

  function ledgerRow(s) {
    const latest = s.latest ? '<span class="tag ' + resClass(s.latest.result) + '">' + esc(s.latest.result) + '</span> ' + esc(s.latest.date) : '未巡視';
    const sel = s.id === state.sel ? ' class="sel"' : '';
    if (!isReal()) return '<tr data-id="' + s.id + '"' + sel + '><td>' + s.rank + '</td><td>' + s.score + '</td><td>' + s.id + '</td><td>' + esc(s.name) + '</td><td>' + s.change + '</td><td>' + esc(s.zone) + '</td><td>' + s.permit + '</td><td>' + latest + '</td></tr>';
    const num = (v) => (v == null ? '算出不可' : v);
    return '<tr data-id="' + esc(s.id) + '"' + sel + '><td>' + s.rank + '</td><td>' + s.score + '</td><td>' + esc(s.id) + '</td><td class="ph">' + photoSvg(s, 'before', 96) + '</td><td class="ph">' + photoSvg(s, 'now', 96) + '</td><td>' + s.type + '</td><td>' + s.areaM2 + '</td><td>' + num(s.reliefM) + '</td><td>' + num(s.slopeDeg) + '</td><td>' + latest + '</td></tr>';
  }
  function renderLedger() {
    const rows = filtered();
    const cols = isReal() ? 10 : 8;
    $('#ledger tbody').innerHTML = rows.slice(0, state.shown).map(ledgerRow).join('') || '<tr><td colspan="' + cols + '">該当なし</td></tr>';
    $('#count').textContent = rows.length + '件中 ' + Math.min(rows.length, state.shown) + '件を表示（点数の高い順）';
    $('#btn-more').hidden = rows.length <= state.shown;
    renderMap(rows); renderDetail();
  }
  function renderMap(rows) {
    const d = D(), v = d.view;
    $('#map').setAttribute('viewBox', v.join(' '));
    const ids = new Set(rows.map((s) => s.id));
    let h = d.zones.map((z) => '<polygon points="' + z.points + '" fill="' + (z.type.indexOf('特定') === 0 ? '#e8d3b0' : '#dde6cf') + '" stroke="#8a7a55" stroke-width="' + (d.mr / 5) + '" stroke-dasharray="' + (d.mr * 1.5) + ' ' + d.mr + '"/>').join('');
    if (d.river) h += '<polyline points="' + d.river + '" fill="none" stroke="#8fb8d8" stroke-width="5"/>';
    (d.roads || []).forEach((r) => (h += '<polyline points="' + r + '" fill="none" stroke="#b5ad9a" stroke-width="2"/>'));
    const fs = isReal() ? d.mr * 1.4 : 11;
    h += '<text x="' + (v[0] + v[2] * 0.02) + '" y="' + (v[1] + v[3] - fs) + '" font-size="' + fs + '" fill="#777">' + (isReal() ? '規制区域（国土数値情報 A56）' : 'サンプル（架空）・模式図') + '</text>';
    h += '<rect x="' + (d.origin.x - d.mr / 2) + '" y="' + (d.origin.y - d.mr / 2) + '" width="' + d.mr + '" height="' + d.mr + '" fill="#2b2a27"/><text x="' + (d.origin.x + d.mr) + '" y="' + (d.origin.y + d.mr / 3) + '" font-size="' + fs + '">' + d.origin.name + '</text>';
    const top = isReal() ? 20 : 99;
    const list = state.ranked.filter((s) => ids.has(s.id));
    list.slice().reverse().forEach((s, i, arr) => {
      const big = s.rank <= top || s.id === state.sel || !isReal();
      const r = isReal() ? (big ? d.mr * 1.5 : d.mr * 0.55) : (s.id === state.sel ? 14 : 11);
      h += '<g class="mk" data-id="' + esc(s.id) + '"><circle cx="' + s.x.toFixed(0) + '" cy="' + s.y.toFixed(0) + '" r="' + r + '" fill="' + color(s) + '" stroke="' + (s.id === state.sel ? '#000' : '#fff') + '" stroke-width="' + (isReal() ? d.mr / 6 : 2) + '"/>' +
        (big ? '<text x="' + s.x.toFixed(0) + '" y="' + (s.y + (isReal() ? d.mr * 0.5 : 4)).toFixed(0) + '"' + (isReal() ? ' style="font-size:' + (d.mr * 1.4) + 'px"' : '') + '>' + s.rank + '</text>' : '') + '</g>';
    });
    $('#map').innerHTML = h;
  }
  function parts(s) { return s.parts.map((p) => esc(p[0]) + ' ' + (p[1] == null ? '—（点数に含めない）' : (p[1] >= 0 ? '+' : '') + p[1])).join('<br>'); }
  function renderDetail() {
    const s = state.ranked.find((x) => x.id === state.sel), el = $('#detail');
    if (!s) { el.innerHTML = '<p>左の表か地図で地点を選ぶと、点数の内訳と巡視記録が見られます。</p>'; return; }
    const hist = state.results.filter((r) => r.siteId === s.id).reverse();
    const histH = hist.length ? hist.map((r) => esc(r.date) + ' ' + esc(r.result) + (r.memo ? '（' + esc(r.memo) + '）' : '')).join('<br>') : 'なし';
    let body;
    if (isReal()) {
      body = '<div class="imgs"><figure>' + photoSvg(s, 'before') + '<figcaption>前: 1974〜78年（地理院）</figcaption></figure><figure>' + photoSvg(s, 'now') + '<figcaption>現在（地理院シームレス写真）</figcaption></figure></div>' +
        '<dl><dt>型</dt><dd>' + s.type + '（A54）</dd><dt>面積</dt><dd>約' + s.areaM2 + ' m²</dd><dt>標高</dt><dd>' + (s.reliefM == null ? '算出不可（小規模でDEMの画素が少ない）' : '区域内の標高差 ' + s.reliefM + ' m／平均傾斜 ' + s.slopeDeg + '°／平均標高 ' + s.elevM + ' m（DEM' + s.demRes + '、' + s.demPx + '画素）') + '</dd>' +
        '<dt>区域</dt><dd>' + esc(s.zone) + '（A56。概略）</dd><dt>衛星由来の変化</dt><dd>未接続（実運用では Sentinel-1/2 で算出）</dd><dt>点数の内訳</dt><dd>' + parts(s) + '</dd><dt>巡視履歴</dt><dd>' + histH + '</dd>' +
        '<dt>地図</dt><dd><a href="https://maps.gsi.go.jp/#17/' + s.lat + '/' + s.lon + '/" target="_blank" rel="noopener">地理院地図で開く</a></dd></dl>';
    } else {
      const fr = (after) => '<svg viewBox="0 0 120 80" role="img" aria-label="' + (after ? '変化後' : '変化前') + 'の模式図（サンプル）"><rect width="120" height="80" fill="' + (after ? '#cdbb96' : '#a9c48f') + '"/><polygon points="25,60 55,20 95,35 85,65" fill="' + (after ? '#b08a55' : '#8fb070') + '"/><text x="4" y="12" font-size="8" fill="#222">' + (after ? '変化後（模式）' : '変化前（模式）') + '</text></svg>';
      body = '<div class="imgs">' + fr(false) + fr(true) + '</div><dl><dt>検出日</dt><dd>' + s.detected + '（サンプル）</dd><dt>面積</dt><dd>約' + s.areaM2 + ' m²（サンプル）</dd><dt>点数の内訳</dt><dd>' + parts(s) + '</dd><dt>メモ</dt><dd>' + esc(s.note) + '</dd><dt>巡視履歴</dt><dd>' + histH + '</dd></dl>';
    }
    el.innerHTML = '<h2>' + esc(s.id) + '（順位 ' + s.rank + '／点数 ' + s.score + '）</h2>' + body + '<p><button id="btn-goto-rec">この地点の結果を記録する</button></p>';
    $('#btn-goto-rec').onclick = () => { show('record'); $('#r-site').value = s.id; };
  }
  function planData() { return L.planRoute(state.ranked, D().origin, +$('#cap').value || 0); }
  function renderPlan() {
    const p = planData();
    $('#plan-list').innerHTML = p.route.map((s) => '<li>' + esc(s.id) + '（点数' + s.score + '・' + (isReal() ? s.type + '・' + s.areaM2 + ' m²' : s.change + '・' + s.permit) + '・' + esc(s.zone) + '）</li>').join('');
    $('#plan-total').textContent = isReal() ? '地図上の周回距離の目安: 約' + (p.total / 1000).toFixed(1) + ' km（直線距離の合計。道路距離ではありません）' : '地図上の周回距離の目安: ' + Math.round(p.total) + '（模式図の単位。実距離ではありません）';
  }
  function renderRecord() {
    $('#r-site').innerHTML = D().sites.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.id) + (isReal() ? ' ' + s.type : ' ' + esc(s.name)) + '</option>').join('');
    $('#r-result').innerHTML = L.RESULTS.map((r) => '<option>' + r + '</option>').join('');
    renderRecTable();
  }
  function renderRecTable() {
    $('#rec-table tbody').innerHTML = state.results.slice().reverse().map((r) => '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.siteId) + '</td><td>' + esc(r.who) + '</td><td><span class="tag ' + resClass(r.result) + '">' + esc(r.result) + '</span></td><td>' + esc(r.memo) + '</td></tr>').join('') || '<tr><td colspan="5">記録なし</td></tr>';
  }
  function renderTune() {
    const key = typeKey(), st = L.hitStats(D().sites, state.results, key), dw = defW()[key];
    $('#hit-table tbody').innerHTML = Object.keys(dw).map((c) => {
      const o = st[c] || { n: 0, hit: 0 };
      return '<tr><td>' + c + '</td><td>' + o.n + '</td><td>' + o.hit + (o.n >= 5 ? '（' + Math.round(100 * o.hit / o.n) + '%）' : '（件数が少なく率は出しません）') + '</td><td>' + dw[c] + '</td><td><input type="number" min="0" max="50" data-c="' + c + '" value="' + state.weights[key][c] + '"></td></tr>';
    }).join('');
    document.querySelectorAll('#hit-table input').forEach((i) => (i.onchange = () => {
      state.weights[key][i.dataset.c] = Math.max(0, Math.min(50, +i.value || 0));
      localStorage.setItem(KEYS(state.mode).w, JSON.stringify(state.weights)); recompute(); renderLedger();
    }));
  }
  function show(v) {
    document.querySelectorAll('.view').forEach((e) => (e.hidden = e.id !== 'v-' + v));
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v));
    if (v === 'plan') renderPlan();
    if (v === 'tune') renderTune();
    if (v === 'ledger') renderLedger();
  }
  function setMode(m) {
    state.mode = m; localStorage.setItem('morido-b-mode', m);
    loadMode(); recompute(); renderHead(); renderRecord(); show('ledger');
  }

  function init() {
    ['#f-zone', '#f-second', '#f-unvisited'].forEach((s) => ($(s).onchange = () => { state.shown = PAGE; renderLedger(); }));
    $('#btn-more').onclick = () => { state.shown += PAGE; renderLedger(); };
    $('#tabs').onclick = (e) => { if (e.target.dataset.view) show(e.target.dataset.view); };
    document.querySelector('.modebar').onclick = (e) => { if (e.target.dataset.mode && e.target.dataset.mode !== state.mode) setMode(e.target.dataset.mode); };
    const pick = (e) => { const t = e.target.closest('[data-id]'); if (t) { state.sel = t.dataset.id; if (!filtered().slice(0, state.shown).some((s) => s.id === state.sel)) state.shown = 1e9; renderLedger(); } };
    $('#ledger tbody').onclick = pick; $('#map').onclick = pick;
    $('#cap').onchange = renderPlan;
    $('#rec-form').onsubmit = (e) => {
      e.preventDefault();
      state.results.push({ siteId: $('#r-site').value, date: $('#r-date').value, who: $('#r-who').value.trim(), result: $('#r-result').value, memo: $('#r-memo').value.trim() });
      saveResults(); $('#r-memo').value = ''; recompute(); renderRecTable();
    };
    $('#btn-reset').onclick = () => { if (confirm('記録を全て消しますか')) { state.results = []; localStorage.removeItem(KEYS(state.mode).r); recompute(); renderRecTable(); } };
    $('#btn-weights-reset').onclick = () => { state.weights = clone(defW()); localStorage.removeItem(KEYS(state.mode).w); recompute(); renderTune(); renderLedger(); };
    const note = () => (isReal() ? '実データ: 国土数値情報A54/A56・地理院DEM。衛星由来の変化は未接続' : 'サンプル（架空）');
    $('#btn-rec-csv').onclick = () => download('patrol-records.csv', L.toCSV(['site_id', 'patrol_date', 'patroller', 'result', 'memo'], state.results.map((r) => [r.siteId, r.date, r.who, r.result, r.memo])));
    $('#btn-ledger-csv').onclick = () => download('ledger.csv', isReal()
      ? L.toCSV(['rank', 'score', 'id', 'type', 'area_m2', 'relief_m', 'slope_deg', 'zone', 'lat', 'lon', 'latest_result', 'data_note'], state.ranked.map((s) => [s.rank, s.score, s.id, s.type, s.areaM2, s.reliefM, s.slopeDeg, s.zone, s.lat, s.lon, s.latest ? s.latest.result : '', note()]))
      : L.toCSV(['rank', 'score', 'id', 'name', 'change', 'zone', 'permit', 'detected', 'latest_result', 'data_note'], state.ranked.map((s) => [s.rank, s.score, s.id, s.name, s.change, s.zone, s.permit, s.detected, s.latest ? s.latest.result : '', note()])));
    $('#btn-plan-csv').onclick = () => download('patrol-plan.csv', L.toCSV(['order', 'id', 'score', 'type_or_change', 'zone', 'data_note'], planData().route.map((s, i) => [i + 1, s.id, s.score, isReal() ? s.type : s.change, s.zone, note()])));
    loadMode(); recompute(); renderHead(); renderRecord();
    $('#r-date').value = new Date().toISOString().slice(0, 10);
    renderLedger();
  }
  window.App = { state, show, setMode, recompute, renderLedger, renderPlan, renderRecTable, DS };
  init();
})();
