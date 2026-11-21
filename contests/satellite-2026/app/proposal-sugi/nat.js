(function () {
  'use strict';
  const L = window.NatLib, NAT = window.SUGI_NAT, GEO = window.SUGI_NAT_GEO;
  const U = NAT.u, META = NAT.meta, NU = U.code.length;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
  const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString('ja-JP');
  const pct = (x) => (x * 100 >= 10 ? Math.round(x * 100) : Math.round(x * 1000) / 10) + '%';
  const cells = L.decodeCells(NAT);
  const label = (j) => U.name[j] + '（' + META.prefs[U.pref[j]] + '）';
  const state = Object.assign({ city: -1, rule: 'in', mode: 'alloc', rr: null, cand: [], sh: null, sum: null, map: null, markers: [] }, L.DEFAULTS);
  window.__nat = state; // 画面確認・テスト用

  // 人口10万人以上の市区（人口の多い順）。初期選択は世田谷区（実在の連携事例の出典がある）。
  const BIG = []; for (let j = 0; j < NU; j++) if (U.pop[j] >= 100000) BIG.push(j);
  BIG.sort((a, b) => U.pop[b] - U.pop[a]);
  const DEFAULT_CITY = U.name.indexOf('世田谷区');

  // ---- 色（色だけに頼らない: 凡例に数値の区切りを書く） ----
  const SRC_BINS = [[1, '#f1efe6', '森林簿にスギ人工林なし〜1 ha未満'], [100, '#dcecd3', '1〜100 ha'], [500, '#b3d9a1', '100〜500 ha'], [2000, '#7bc27a', '500〜2,000 ha'], [5000, '#3c9a52', '2,000〜5,000 ha'], [Infinity, '#146b36', '5,000 ha以上']];
  const CUR_BINS = [[1, '#f1efe6', '譲与額なし'], [2000, '#e0e8f5', '〜200万円'], [5000, '#b4c8e8', '200〜500万円'], [10000, '#7fa3d9', '500万〜1,000万円'], [30000, '#4a76c0', '1,000万〜3,000万円'], [Infinity, '#1f4a94', '3,000万円以上']]; // 千円
  const SAT_BINS = [[0.2, '#f1efe6', '樹木被覆 20%未満'], [0.4, '#d3ece6', '20〜40%'], [0.6, '#9fd9cc', '40〜60%'], [0.8, '#4fb8a6', '60〜80%'], [Infinity, '#0d7e6f', '80%以上']];
  const ALLOC_BINS = [[0.005, '#fde0c5', '〜0.5%'], [0.01, '#fdbb84', '0.5〜1%'], [0.02, '#fc8d59', '1〜2%'], [0.05, '#e34a33', '2〜5%'], [Infinity, '#990000', '5%以上']];
  const binOf = (bins, v) => { for (const b of bins) if (v < b[0]) return b; return bins[bins.length - 1]; };
  const treeShare = (j) => (U.land[j] > 0 ? U.tree[j] / U.land[j] : -1);
  function colorOf(j) {
    const m = state.mode;
    if (m === 'src') return binOf(SRC_BINS, U.ha26[j])[1];
    if (m === 'cur') return binOf(CUR_BINS, Math.max(U.jouyo[j], 0))[1];
    if (m === 'sat') return treeShare(j) < 0 ? '#e8e8e8' : binOf(SAT_BINS, treeShare(j))[1];
    const k = state.candIdx && state.candIdx.get(j);
    if (j === state.city) return '#ffffff';
    if (k == null) return mute(binOf(SRC_BINS, U.ha26[j])[1]);
    return binOf(ALLOC_BINS, state.sh[state.rule][k])[1];
  }
  function mute(hex) { // 候補でない市町村は、スギ人工林の緑を薄めて見せる（発生源側は常に見える）
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.round(c * 0.55 + 250 * 0.45);
    return '#' + [mix(r), mix(g), mix(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
  }

  // ---- 計算 ----
  function recompute() {
    const c = state.city;
    if (c < 0) return;
    state.rr = L.reach(cells, NU, U.lat[c], U.lon[c], state.radiusKm, state.age);
    state.cand = L.candidates(state.rr, c, state.minHa);
    state.candIdx = new Map(state.cand.map((j, k) => [j, k]));
    state.sh = L.shares(U, state.cand, state.rr, state.age, state.mixAlpha);
    state.sum = L.summarize(state.sh);
  }
  const order = () => state.cand.map((j, k) => k).sort((a, b) => state.sh[state.rule][b] - state.sh[state.rule][a]);

  // ---- 地図 ----
  function circleGeo(lat, lon, R) {
    const pts = []; const cos = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i <= 72; i++) { const a = i / 72 * 2 * Math.PI; pts.push([lon + R * Math.sin(a) / (L.KM_DEG * cos), lat + R * Math.cos(a) / L.KM_DEG]); }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] };
  }
  const cityGeo = () => ({ type: 'FeatureCollection', features: BIG.map((j) => ({ type: 'Feature', id: j, properties: { j, pop: U.pop[j] }, geometry: { type: 'Point', coordinates: [U.lon[j], U.lat[j]] } })) });
  function initMap() {
    const map = state.map = new maplibregl.Map({
      container: 'map', attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'] } }, layers: [{ id: 'gsi', type: 'raster', source: 'gsi', paint: { 'raster-opacity': 0.55 } }] },
      bounds: [[122.9, 24.0], [146.0, 45.6]], fitBoundsOptions: { padding: 4 },
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '出典：林野庁 全国森林資源メッシュ・国土数値情報N03・e-Stat・総務省・ESA WorldCover 2021等を加工／地理院タイル／MapLibre' }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('muni', { type: 'geojson', data: GEO });
      map.addSource('ring', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('cities', { type: 'geojson', data: cityGeo() });
      map.addLayer({ id: 'muni-fill', type: 'fill', source: 'muni', paint: { 'fill-color': ['coalesce', ['feature-state', 'c'], '#f1efe6'], 'fill-opacity': 0.88 } });
      map.addLayer({ id: 'muni-line', type: 'line', source: 'muni', paint: { 'line-color': '#7b8790', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.2, 9, 0.8], 'line-opacity': 0.7 } });
      map.addLayer({ id: 'sel-line', type: 'line', source: 'muni', filter: ['==', ['id'], -1], paint: { 'line-color': '#000', 'line-width': 3 } });
      map.addLayer({ id: 'ring', type: 'line', source: 'ring', paint: { 'line-color': '#000', 'line-width': 2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'cities', type: 'circle', source: 'cities', paint: {
        'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'pop']], 316, 3, 1000, 6, 3000, 14],
        'circle-color': '#b0003a', 'circle-opacity': 0.55, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      map.on('click', (e) => {
        const c = map.queryRenderedFeatures(e.point, { layers: ['cities'] });
        const f = c.length ? c[0] : map.queryRenderedFeatures(e.point, { layers: ['muni-fill'] })[0];
        if (!f) return;
        const j = c.length ? c[0].properties.j : f.id;
        pick(j);
      });
      map.on('mousemove', 'muni-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'muni-fill', () => { map.getCanvas().style.cursor = ''; });
      state.mapReady = true;
      window.__natMap = map;
      paint();
      document.body.dataset.mapReady = '1';
    });
  }
  let painted = null;
  function paint() {
    const map = state.map;
    if (!state.mapReady) return;
    for (let j = 0; j < NU; j++) map.setFeatureState({ source: 'muni', id: j }, { c: colorOf(j) });
    map.setFilter('sel-line', ['==', ['id'], state.city]);
    const c = state.city;
    map.getSource('ring').setData(c >= 0 ? circleGeo(U.lat[c], U.lon[c], state.radiusKm) : { type: 'FeatureCollection', features: [] });
    state.markers.forEach((m) => m.remove()); state.markers = [];
    if (c >= 0) {
      const ord = order().slice(0, 8);
      ord.forEach((k, r) => {
        const j = state.cand[k];
        const el = document.createElement('div'); el.className = 'mk'; el.textContent = r + 1; el.title = label(j);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); showPopup(j); });
        state.markers.push(new maplibregl.Marker({ element: el }).setLngLat([U.lon[j], U.lat[j]]).addTo(map));
      });
      const el = document.createElement('div'); el.className = 'mk city'; el.textContent = '都'; el.title = label(c) + '（選んだ都市）';
      state.markers.push(new maplibregl.Marker({ element: el }).setLngLat([U.lon[c], U.lat[c]]).addTo(map));
    }
    painted = true;
  }
  let popup = null;
  function showPopup(j) {
    if (!state.mapReady) return;
    if (popup) popup.remove();
    const k = state.candIdx && state.candIdx.get(j);
    let h = '<b>' + esc(label(j)) + '</b><br>人口 ' + fmt(U.pop[j]) + ' 人／スギ人工林 ' + fmt(U.ha[j]) + ' ha（26年生以上 ' + fmt(U.ha26[j]) + ' ha）<br>現行の譲与額（令和6年度） ' + (U.jouyo[j] >= 0 ? fmt(U.jouyo[j] / 10) + ' 万円' : '不明');
    if (k != null) {
      h += '<br>圏内の26年生以上 ' + fmt(state.rr.inHa[j]) + ' ha／距離（人口の中心どうし）約 ' + fmt(L.distKm(U.lat[state.city], U.lon[state.city], U.lat[j], U.lon[j])) + ' km';
      h += '<br>配分（仮の予算 ' + fmt(state.budget) + ' 万円）: ' + L.RULES.map((r) => r.short.slice(0, 1) + ' ' + fmt(state.budget * state.sh[r.id][k]) + '万円').join('／');
    }
    const r = L.satRatio(U, j);
    h += '<br>衛星の樹木被覆 ' + (U.tree[j] > 0 ? fmt(U.tree[j]) + ' ha（森林簿のスギ人工林はその ' + pct(r) + '）' : 'なし／不明');
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '300px' }).setLngLat([U.lon[j], U.lat[j]]).setHTML(h).addTo(state.map);
  }

  // ---- 画面 ----
  function legend() {
    const m = state.mode;
    const sw = (c, t) => '<div><span class="sw" style="background:' + c + '"></span>' + esc(t) + '</div>';
    let h = '';
    if (m === 'src') h = '<b>26年生以上のスギ人工林の面積（市町村）</b>' + SRC_BINS.map((b) => sw(b[1], b[2])).join('') + '<div class="lg-note">出典: 林野庁 全国森林資源メッシュ（森林簿由来）</div>';
    if (m === 'cur') h = '<b>令和6年度の森林環境譲与額（市区町村）</b>' + CUR_BINS.map((b) => sw(b[1], b[2])).join('') + '<div class="lg-note">出典: 総務省（国から各市町村への譲与）</div>';
    if (m === 'sat') h = '<b>衛星で見た樹木被覆の割合（陸地に対して）</b>' + SAT_BINS.map((b) => sw(b[1], b[2])).join('') + '<div class="lg-note">ESA WorldCover 2021。樹木かどうかまで。スギか・林齢は分かりません</div>';
    if (m === 'alloc') h = '<b>配分先（' + esc(L.RULES.find((r) => r.id === state.rule).name) + '）：予算に占める割合</b>' + ALLOC_BINS.map((b) => sw(b[1], b[2])).join('') + sw(mute('#7bc27a'), '候補外（緑の濃さ＝スギ人工林）') + '<div class="lg-note">番号は割合の大きい順の上位8。点線は半径、赤い●は人口10万人以上の市区</div>';
    $('#legend').innerHTML = h;
  }
  function renderRules() {
    $('#rules').innerHTML = '<legend>配分ルール（5つを並べて比べます。地図は選んだルール）</legend>' + L.RULES.map((r) =>
      '<label title="' + esc(r.desc) + '"><input type="radio" name="rule" value="' + r.id + '"' + (r.id === state.rule ? ' checked' : '') + '> <b>' + esc(r.name) + '</b><span class="d">' + esc(r.desc) + '</span></label>').join('');
    $('#mixrow').hidden = state.rule !== 'mix';
    $('#o-mix').textContent = 'A ' + state.mixAlpha + '% ＋ D ' + (100 - state.mixAlpha) + '%';
    $('#mix').value = state.mixAlpha;
  }
  function renderRadii() {
    $('#radii').innerHTML = L.RADII.map((r) => '<label><input type="radio" name="rad" value="' + r + '"' + (r === state.radiusKm ? ' checked' : '') + '> ' + r + ' km' + (r === 50 ? '（国の目安）' : '') + '</label>').join('');
  }
  function renderResult() {
    const c = state.city;
    if (c < 0) { $('#res-sum').innerHTML = '<p class="note">都市を選ぶと結果が出ます。</p>'; $('#tbl thead').innerHTML = $('#tbl tbody').innerHTML = $('#tbl tfoot').innerHTML = ''; return; }
    const tbl = $('#tbl'); tbl.dataset.active = state.rule;
    const sumCur = state.cand.reduce((s, j) => s + Math.max(U.jouyo[j], 0), 0) / 10;
    const inTot = state.cand.reduce((s, j) => s + state.rr.inHa[j], 0);
    $('#res-sum').innerHTML = '<p><b>' + esc(label(c)) + '</b> 人口 ' + fmt(U.pop[c]) + ' 人／現行の譲与額 ' + (U.jouyo[c] >= 0 ? fmt(U.jouyo[c] / 10) + ' 万円' : '不明') +
      '<br>半径 ' + state.radiusKm + ' km の圏内：候補 <b>' + fmt(state.cand.length) + '</b> 市町村・26年生以上のスギ人工林 <b>' + fmt(inTot) + '</b> ha（候補は圏内10 ha以上<span class="chip prov">仮</span>）' +
      '<br>仮の予算 ' + L.fmtMan(state.budget) + ' は、候補の現行譲与額の合計 ' + L.fmtMan(sumCur) + ' の ' + (sumCur > 0 ? pct(state.budget / sumCur) : '—') + '</p>';
    const head = '<tr><th>市町村</th><th class="n">圏内<br>ha</th><th class="n">現行<br>譲与額</th>' + L.RULES.map((r) => '<th class="n r r-' + r.id + (r.id === state.rule ? ' act' : '') + '" title="' + esc(r.desc) + '">' + esc(r.short.slice(0, 1)) + '<br>' + esc(r.short.slice(2)) + '</th>').join('') + '</tr>';
    $('#tbl thead').innerHTML = head;
    const ord = order(), top = ord.slice(0, 8);
    const cellsR = (k) => L.RULES.map((r) => '<td class="n r r-' + r.id + (r.id === state.rule ? ' act' : '') + '">' + fmt(state.budget * state.sh[r.id][k]) + '</td>').join('');
    let body = top.map((k, r) => { const j = state.cand[k]; return '<tr data-j="' + j + '" tabindex="0"><td><span class="no">' + (r + 1) + '</span>' + esc(label(j)) + '</td><td class="n">' + fmt(state.rr.inHa[j]) + '</td><td class="n">' + (U.jouyo[j] >= 0 ? fmt(U.jouyo[j] / 10) : '—') + '</td>' + cellsR(k) + '</tr>'; }).join('');
    const rest = ord.slice(8);
    if (rest.length) {
      const sum = (f) => rest.reduce((s, k) => s + f(k), 0);
      body += '<tr class="rest"><td>他 ' + fmt(rest.length) + ' 市町村</td><td class="n">' + fmt(sum((k) => state.rr.inHa[state.cand[k]])) + '</td><td class="n">' + fmt(sum((k) => Math.max(U.jouyo[state.cand[k]], 0)) / 10) + '</td>' +
        L.RULES.map((r) => '<td class="n r r-' + r.id + (r.id === state.rule ? ' act' : '') + '">' + fmt(state.budget * sum((k) => state.sh[r.id][k])) + '</td>').join('') + '</tr>';
    }
    $('#tbl tbody').innerHTML = body;
    const S = state.sum;
    const row = (t, f) => '<tr><th colspan="3">' + t + '</th>' + L.RULES.map((r) => '<td class="n r r-' + r.id + (r.id === state.rule ? ' act' : '') + '">' + f(S[r.id]) + '</td>').join('') + '</tr>';
    $('#tbl tfoot').innerHTML = row('上位3つの割合', (s) => pct(s.top3)) + row('受け取る市町村数（1%以上）', (s) => s.n1) + row('D（現行比率）から動く割合', (s) => pct(s.shift));
  }
  function renderCity() {
    const el = $('#city');
    if (!el.options.length) el.innerHTML = BIG.map((j) => '<option value="' + j + '">' + esc(label(j)) + '　' + fmt(U.pop[j] / 10000) + '万人</option>').join('');
    if (!BIG.includes(state.city)) { if (!el.querySelector('option[data-x]')) { const o = document.createElement('option'); o.dataset.x = 1; el.insertBefore(o, el.firstChild); } const o = el.querySelector('option[data-x]'); o.value = state.city; o.textContent = state.city >= 0 ? label(state.city) + '（地図で選択）' : ''; el.value = state.city; } else { const o = el.querySelector('option[data-x]'); if (o) o.remove(); el.value = state.city; }
    $('#budget').value = state.budget;
  }
  function pick(j) {
    state.city = j;
    if (state.mode !== 'alloc') { state.mode = 'alloc'; document.querySelector('input[name=mode][value=alloc]').checked = true; }
    update(true);
  }
  function update(fly) {
    recompute(); legend(); renderCity(); renderRules(); renderRadii(); renderResult(); paint();
    if (fly && state.mapReady && state.city >= 0) {
      const c = state.city, R = state.radiusKm, cos = Math.cos(U.lat[c] * Math.PI / 180);
      state.map.fitBounds([[U.lon[c] - R * 1.1 / (L.KM_DEG * cos), U.lat[c] - R * 1.1 / L.KM_DEG], [U.lon[c] + R * 1.1 / (L.KM_DEG * cos), U.lat[c] + R * 1.1 / L.KM_DEG]], { padding: 20, duration: 500 });
    }
  }

  // ---- 説明（モーダル） ----
  function about() {
    const vint = Object.entries(META.mesh_vintage).slice(0, 5).map(([y, n]) => y + '年 ' + fmt(n * META.cell_ha / 1000) + '千ha').join('、');
    $('#about-body').innerHTML = [
      '<h3>この画面でできること</h3><p>都市（被害側）を選び、森から都市へ届く範囲の半径を決め、仮の予算を5つの配分ルールで分けたときの違いを、現行の森林環境譲与税の市町村別の実額と並べて比べます。<b>どのルールが適正・最適かは示しません。</b>花粉の量・健康への影響・「何%減る」といった効果の数値も示しません。</p>',
      '<h3>使ったデータ（すべて公開データの加工。架空のデータはありません）</h3><ul>' +
      '<li><b>スギ人工林の量・林齢</b>: 林野庁「全国森林資源メッシュ」（20mメッシュ、2026年2月16日公開、G空間情報センター mesh_1〜19、' + META.mesh_tiles + '図郭）。林種=人工林かつ森林簿の樹種1=スギのメッシュを、1kmの格子と市町村に集計（格子の中心点が入る市町村）。林齢は森林簿の値で、森林簿の年は地域で異なります（上位: ' + esc(vint) + '）。公共データ利用規約（第1.0版）と同メッシュの利用規約に従い、当方が加工したものです（林野庁が作成したものではありません）。樹種1がスギのメッシュだけで、ヒノキや混交林の2番目以下の樹種は数えていません。</li>' +
      '<li><b>市町村境界</b>: 国土数値情報 行政区域（N03-20250101、CC BY 4.0）を約300mに簡略化。政令指定都市は区をまとめて市1つ、東京23区は区ごと（譲与額の表に合わせています）。</li>' +
      '<li><b>人口</b>: 令和2年国勢調査 地域メッシュ統計 1kmメッシュ（e-Stat、統計表ID T001101、人口総数）を、中心点の入る市町村に集めた概数（市町村の公表値と一致しません）。都市の位置は人口の重心。</li>' +
      '<li><b>現行の譲与額</b>: 総務省「令和6年度 森林環境譲与税 譲与額（市区町村別）」（' + META.jouyo_matched + '市区町村を地図の市町村と照合。表の合計 ' + fmt(META.jouyo_total_k / 100000) + '億円）。配分基準は私有林人工林面積50%（林野率による補正あり）・林業就業者数20%・人口30%。</li>' +
      '<li><b>衛星</b>: ESA WorldCover 2021（v200、10m。Sentinel-1・Sentinel-2から作られた土地被覆図、CC BY 4.0）の「樹木被覆」を、約160mに間引いた標本から市町村ごとに集計。Contains modified Copernicus Sentinel data（2021）。</li>' +
      '<li>背景地図: 国土地理院 地理院タイル（淡色地図）。</li></ul>',
      '<h3>衛星で分かること・分からないこと</h3><ul><li>分かる: 樹木に覆われているか、その広がり（地図の「衛星の樹木被覆」）。森林簿のスギ人工林の面積が、衛星の樹木被覆の面積に収まるかの確認（市町村をクリックすると「その何%」と出ます。100%を超える所は森林簿と衛星が合っておらず、要確認）。</li><li><b>分からない</b>: 樹種（スギかヒノキか広葉樹か）、林齢（26年生以上か）、人工林か天然林か。そのため、スギ人工林の量と林齢は衛星ではなく林野庁の森林簿由来のデータを使っています。JAXAの高解像度土地利用土地被覆図は「常緑針葉樹」までしか分けられず、利用登録と規約の確認が要るため使っていません。</li><li>関東版（kanto.html）では、Sentinel-2の冬のNDVIで森林簿とのずれと伐採・植え替えの候補を確かめています（全国には広げていません）。</li></ul>',
      '<h3>仮置きの値（根拠のある数値ではありません）</h3><ul><li><b>半径</b>: 初期値50km。国の「花粉症対策の全体像」の伐採重点区域が都市から50km圏を目安にしている、という政策の線であり、花粉が届く距離の式ではありません（距離別の定量的な公的根拠は確認できていません）。20〜100kmで切り替えられます。風向は入れていません。</li><li><b>候補の条件</b>: 圏内の26年生以上のスギ人工林が10ha以上の市町村（都市自身は除く）。</li><li><b>B の重み</b>（1−距離÷半径）、<b>E の混合割合</b>、<b>予算</b>。距離は都市の人口の重心から、1kmの格子の中心までの直線距離。</li><li>26年生以上を発生源とみなすのは森林総研の整理に従う主流の見方（21年生以上とする資料もあります）。関東版で切り替えられます。</li></ul>',
      '<h3>制度の事実</h3><ul><li>森林環境譲与税は国が市町村・都道府県に配るもので、市町村どうしの資金移転ではありません。市町村が譲与額を他の市町村の森林整備に使えるかは、確認できていません（制度上の可否を断定しません）。使い道は法第34条で「森林の整備に関する施策、人材の育成及び確保、普及啓発、木材の利用促進その他の森林の整備の促進に関する施策」。</li><li>令和6年度は629億円（市町村分566億円）。出典: 総務省 <a href="https://www.soumu.go.jp/main_content/001001827.pdf" target="_blank" rel="noopener">譲与額（都道府県別・市区町村別）</a>、<a href="https://www.soumu.go.jp/main_content/000771161.pdf" target="_blank" rel="noopener">制度設計</a>。</li></ul>',
      '<h3>実在の連携事例（確認できたものだけ。この画面の配分ルールの根拠ではありません）</h3><ul>' +
      '<li><b>世田谷区と群馬県川場村</b>: 区は平成29年度に川場村と連携を開始。令和6年度決算で譲与額1億700万円のうち、川場移動教室に8,600万円、健康村里山自然学校等に900万円、気候危機対策基金に1,300万円。出典: <a href="https://www.city.setagaya.lg.jp/documents/6216/r6shinrinkannkyoujyouyozei.pdf" target="_blank" rel="noopener">世田谷区の資料</a>（検索の要旨で確認。本文は未読）。</li>' +
      '<li><b>港区「みなとモデル」</b>: 協定を結んだ自治体の木材を区内の建築物で使うと、使った量に相当するCO2固定量を区が認証する制度（平成23年施行）。<b>資金を直接渡す制度ではありません</b>。出典: <a href="https://www.city.minato.tokyo.jp/chikyuondanka/minatomodel.html" target="_blank" rel="noopener">港区</a>（検索の要旨で確認）。</li></ul>',
      '<h3>限界</h3><ul><li>被害側の指標は人口だけです。花粉の飛散・有病率・損失の市町村別の公的データは確認できていません。</li><li>市町村合併や名称の違いで、譲与額の表と地図が照合できない市町村があります（' + META.jouyo_unmatched_units.length + '件。表の側のみ未使用は件数に含めていません）。</li><li>森林簿は都道府県ごとに更新年が異なり、市町村間の比較に年次差が混ざります。</li></ul>',
    ].join('');
  }

  // ---- 入力 ----
  function bind() {
    $('#city').addEventListener('change', (e) => pick(+e.target.value));
    $('#budget').addEventListener('input', (e) => { const v = Math.max(0, +e.target.value || 0); state.budget = v; if (state.city >= 0) { renderResult(); showPopupIfOpen(); } });
    $('#b-same').addEventListener('click', () => { const c = state.city; if (c >= 0 && U.jouyo[c] >= 0) { state.budget = Math.round(U.jouyo[c] / 10); $('#budget').value = state.budget; renderResult(); } });
    document.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'rule') { state.rule = t.value; update(false); }
      if (t.name === 'rad') { state.radiusKm = +t.value; update(true); }
      if (t.name === 'mode') { state.mode = t.value; legend(); paint(); }
    });
    $('#mix').addEventListener('input', (e) => { state.mixAlpha = +e.target.value; $('#o-mix').textContent = 'A ' + state.mixAlpha + '% ＋ D ' + (100 - state.mixAlpha) + '%'; recompute(); renderResult(); paint(); });
    $('#tbl tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-j]'); if (tr) { const j = +tr.dataset.j; if (state.mapReady) state.map.easeTo({ center: [U.lon[j], U.lat[j]], duration: 400 }); showPopup(j); } });
    $('#tbl tbody').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const tr = e.target.closest('tr[data-j]'); if (tr) showPopup(+tr.dataset.j); } });
    $('#btn-about').addEventListener('click', () => { $('#modal').hidden = false; $('#btn-close').focus(); });
    $('#btn-close').addEventListener('click', () => { $('#modal').hidden = true; $('#btn-about').focus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });
  }
  function showPopupIfOpen() { /* 金額が変わったら閉じて古い値を残さない */ if (popup) { popup.remove(); popup = null; } }

  about();
  bind();
  state.city = DEFAULT_CITY;
  update(false);
  initMap();
})();
