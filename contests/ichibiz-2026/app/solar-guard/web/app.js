/* 太陽光発電所の盗難対策マップ（デモ）: 画面制御。計算は lib.js（Sg）、データは data/（build_data.py の生成物と、出典付きの手書き json）。
   通信は静的ファイルの取得（data/）と地図タイル・MapLibre の取得だけ。利用者の入力（位置・回答）は送信も保存もしない。 */
(function () {
  'use strict';
  var G = window.Sg;
  var BAND_COLORS = ['#f1eef6', '#d7b5d8', '#df65b0', '#dd1c77', '#980043'];
  var BAND_LABELS = ['低', 'やや低', '中', 'やや高', '高'];
  var MAX_ZOOM = 10;      // 地図の拡大の上限（MapLibre の拡大率10は、256px の地理院タイルでは縮尺11のタイルを取得する）。これより細かい縮尺にすると、見ている範囲の細かい地図画像を地理院が受け取り、位置が伝わりうる
  var S = { meta: null, cells: [], pops: null, munis: [], items: [], classes: [], reality: null, ck: null, land: null, regions: null,
    weights: G.defaultWeights(), sc: [], bd: [], ms: [], dist: null, sort: 'name', tab: 'map',
    diag: { lon: null, lat: null, cls: 'unknown', answers: {} }, res: null };
  var map = null, mapReady = false, marker = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(x) { return Math.round(x).toLocaleString('ja-JP'); }
  function n1(x) { return x.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function mw(kw) { return n1(kw / 1000); }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function link(u, t) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>'; }

  /* ---------- 起動 ---------- */
  function init() {
    Promise.all([getJSON('data/cells.json'), getJSON('data/pops.json'), getJSON('data/munis.json'), getJSON('data/checklist.json'), getJSON('data/reality.json'), getJSON('data/land.json'), getJSON('data/districts.json')]).then(function (r) {
      S.meta = r[0].meta; S.cells = r[0].rows; S.pops = G.popGrid(r[1].rows); S.munis = r[2].rows; S.ck = r[3]; S.items = r[3].items; S.classes = r[3].classes; S.reality = r[4]; S.land = G.landSet(r[5].rows); S.regions = r[6].regions;
      $('kmin').textContent = S.meta.k_min;
      buildWeights(); buildDefs(); buildClass(); buildChecklist(); buildReality(); buildAbout();
      recompute(); initMap(); renderDiag();
    }).catch(function (e) {
      $('pane-map').insertAdjacentHTML('afterbegin', '<p class="warn">データを読み込めませんでした: ' + esc(e.message) + '（file:// ではなく http で開いてください）</p>');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    $('btn-csv').addEventListener('click', downloadCsv);
    $('btn-set').addEventListener('click', function () { setPoint($('in-lon').value, $('in-lat').value); });
    $('btn-reset').addEventListener('click', resetDiag);
  }

  function setTab(t) {
    S.tab = t; document.body.setAttribute('data-tab', t);
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === t)); });
    ['map', 'diag', 'reality', 'about'].forEach(function (k) { $('pane-' + k).hidden = k !== t; });
    if (map && (t === 'map' || t === 'diag')) setTimeout(function () { map.resize(); }, 50);
  }

  /* ---------- 目安の重み・指標の定義 ---------- */
  function buildWeights() {
    var h = '';
    G.IND.forEach(function (d) {
      h += '<div class="wrow"><label for="w-' + d.id + '">' + esc(d.label) + '</label><input id="w-' + d.id + '" type="range" min="0" max="5" step="1" value="' + S.weights[d.id] + '" aria-describedby="wh-' + d.id + '"><output id="wo-' + d.id + '">' + S.weights[d.id] + '</output></div>' +
        '<div class="note" id="wh-' + d.id + '" style="margin:-2px 0 4px 0">' + esc(d.hint) + '</div>';
    });
    h += '<div id="w-warn" class="note warn" role="status"></div>';
    $('weights').innerHTML = h;
    G.IND.forEach(function (d) {
      $('w-' + d.id).addEventListener('input', function (e) { S.weights[d.id] = +e.target.value; $('wo-' + d.id).textContent = e.target.value; recompute(); renderMap(); renderDiag(); });
    });
  }
  function buildDefs() {
    $('ind-defs').innerHTML = '<ul class="note" style="font-size:12.5px;padding-left:18px">' +
      '<li><b>設備1件あたりの出力</b>: メッシュ内の認定設備（運転開始報告済み）の出力合計kW÷設備数。大きいほど高い。根拠: JPEA・REASPの資料は、高圧設備は被害額が最大と想定され、特別高圧でも1件1億円以上の例があるとする。<b>被害額の大きさの目安であって、被害の起きやすさの証拠ではない</b>。出力合計そのものは設備数とほぼ同じ並びになるため、1件あたりに直した。</li>' +
      '<li><b>低圧（50kW未満）の割合</b>: メッシュ内の設備のうち出力50kW未満の件数の割合。高いほど高い。根拠: 同資料は「警備体制の弱い低圧事業用設備も短時間犯行の被害が増えている」とし、茨城県警も小規模太陽光での発生が多いとする。警備の強さそのものは測っていない。県内ではどの地区でも低圧が約9割（88〜93%）で、地区のあいだの差は小さい。</li>' +
      '<li><b>周囲の人の少なさ（参考。初期値0）</b>: 集計メッシュの2020年国勢調査人口÷(25×約1.04km²)＝常住人口密度。低いほど高い。JPEA・REASPの資料や茨城県警は「人目につきにくい立地」を挙げるが、県警の5地区別の被害と照らすと対応せず（下の「県警の被害実績との食い違い」）、常住人口は夜間・休日の人通りや見通しの代理として弱いため、初期は目安に使わない。海に面したメッシュは海の面積も含むため人口密度が低く出る。</li>' +
      '<li>3つとも「公開データから作れる代理指標」で、防犯設備・被害の履歴・実際の見通しは含まない。重みに公的な根拠はなく、初期値は「出力1・低圧割合1・人の少なさ0」。県警の被害実績に合わせて決めたものではなく、実績に合わせて重みを変えて「当たる」ことを示す使い方はしない（5地区の5点だけで検証できない）。</li></ul>';
  }

  function recompute() {
    var tw = G.IND.reduce(function (a, d) { return a + S.weights[d.id]; }, 0);
    S.zero = tw === 0;
    $('w-warn').textContent = S.zero ? '重みがすべて0です。1つ以上を1以上にしてください（色分けと「目安」を停止中です）。' : '';
    var sc = G.scoreCells(S.cells, S.weights), bd = G.bands(sc.map(function (c) { return c.score; }));
    var ms = G.scoreMunis(S.munis, S.weights), mb = G.bands(ms.map(function (m) { return m.score; }));
    S.dist = G.districtCompare(S.regions, S.reality.areas.rows, ms);   // 連続値は地区平均の計算にだけ使い、保持しない
    sc.forEach(function (c, i) { c.band = bd[i]; delete c.score; delete c.parts; });
    ms.forEach(function (m, i) { m.band = mb[i]; delete m.score; delete m.parts; });
    S.sc = sc; S.bd = bd; S.ms = ms;
    var st = S.meta.stats;
    $('map-summary').textContent = '認定情報の太陽光（運転開始報告済み・出力20kW以上）' + n0(st.counted) + '件のうち、集計メッシュに入れたのは' + n0(st.placed) + '件（町字が地図の名称と一致しなかった' + n0(st.unplaced) + '件は市町村の集計だけ）。設備のあるメッシュ' + n0(st.cells_all) + 'のうち、' + n0(st.cells_hidden) + 'メッシュ（設備' + S.meta.k_min + '件未満の' + n0(st.cells_hidden_small_n) + '、設備' + S.meta.dom_n + '件未満で50kW以上が1件以下の' + n0(st.cells_hidden_dominant) + '）は隠しています。';
    buildLegend();
    renderDist();
    renderMunis();
  }

  /* 目安と県警の5地区別の被害実績の並置（重みを変えると目安の側が変わる。実績に合わせて重みを選ぶためのものではない） */
  function renderDist() {
    if (!S.dist) return;
    var d = S.dist, n = d.rows.length;
    var h = '<div class="scroll"><table class="dist cards"><tr><th class="l">地区（県の区分で推測）</th><th>県警の被害（件）</th><th>設備数</th><th>設備1,000件あたりの被害</th><th>被害率の順</th><th>目安の地区平均の順</th></tr>';
    d.rows.slice().sort(function (a, b) { return (b.rate || 0) - (a.rate || 0); }).forEach(function (r) {
      h += '<tr><td class="l" data-label="地区">' + esc(r.area) + '</td><td data-label="県警の被害（件）">' + n0(r.theft) + '</td><td data-label="設備数">' + n0(r.plants) + '</td><td data-label="設備1,000件あたりの被害">' + (r.rate == null ? '—' : n1(r.rate)) + '</td><td data-label="被害率の順">' + (r.rankRate == null ? '—' : r.rankRate + '位／' + n) + '</td><td data-label="目安の地区平均の順">' + (r.rankScore == null ? '—' : r.rankScore + '位／' + n) + '</td></tr>';
    });
    h += '</table></div>';
    var msg = S.zero || d.rho == null ? '重みがすべて0のため、目安の側は出ません。' :
      '現在の重みでは、被害率の順と目安の地区平均の順の順位相関は <b>' + d.rho.toFixed(2) + '</b>（+1で一致、−1で逆）。' + (d.rho > 0 ? '' : '<b>目安は県警の地区別の被害と逆向きか、対応していません。</b>') + '5点だけの比較で、有意とは言えません。';
    var html = '<p class="note">' + msg + '（順は、被害率が高い・目安が高い地区ほど上位。被害は県警が公表している地区別の件数）</p>' + h +
      '<p class="note">地区ごとの設備数は、県の地域区分の市町村の設備数を足したもの。県警の5地区が県の区分と同じ市町村の範囲かは誌面に記載がなく、<b>この対応は推測</b>です。令和8年9月末の暫定値で、期間は1年に満たない。</p>';
    ['dist-compare', 'dist-compare2'].forEach(function (id) { if ($(id)) $(id).innerHTML = html; });
  }

  function bandChip(b) {
    if (b == null) return '<span class="band" style="background:#fff">—</span>';
    return '<span class="band" style="background:' + BAND_COLORS[b] + ';color:' + (b >= 3 ? '#fff' : '#222') + '">' + BAND_LABELS[b] + '</span>';
  }

  function renderMunis() {
    var key = S.sort, rows = S.ms.slice();
    var cmp = { name: function (a, b) { return a.name.localeCompare(b.name, 'ja'); },
      n: function (a, b) { return (b.n || 0) - (a.n || 0); }, kw: function (a, b) { return (b.kw || 0) - (a.kw || 0); },
      dens: function (a, b) { return a.dens - b.dens; }, score: function (a, b) { return (b.band == null ? -1 : b.band) - (a.band == null ? -1 : a.band) || a.name.localeCompare(b.name, 'ja'); } };
    rows.sort(cmp[key]);
    var th = function (k, t) { return '<th><button type="button" data-sort="' + k + '"' + (key === k ? ' aria-pressed="true"' : '') + '>' + t + (key === k ? ' ▼' : '') + '</button></th>'; };
    var h = '<table><tr>' + th('name', '市町村') + th('n', '設備数') + th('kw', '出力計(MW)') + '<th>50kW未満の割合</th>' + th('dens', '人口密度(人/km²)') + th('score', '目安') + '</tr>';
    rows.forEach(function (m) {
      h += '<tr><td class="l">' + esc(m.name) + '</td>' + (m.hidden ? '<td colspan="3">' + S.meta.k_min + '件未満のため非表示</td>' : '<td>' + n0(m.n) + '</td><td>' + mw(m.kw) + '</td><td>' + n1(m.share * 100) + '%</td>') +
        '<td>' + n0(m.dens) + '</td><td>' + (S.zero ? '—' : bandChip(m.band)) + '</td></tr>';
    });
    $('muni-table').innerHTML = h + '</table>';
    Array.prototype.forEach.call($('muni-table').querySelectorAll('th button'), function (b) { b.addEventListener('click', function () { S.sort = b.getAttribute('data-sort'); renderMunis(); }); });
  }

  function buildLegend() {
    var el = $('legend');
    if (S.zero) {
      el.className = 'off';
      el.innerHTML = '<b>色分けを停止中</b>（重みがすべて0）。地図の色は出ません。<br><span class="sw" style="background:#fff"></span>色なし＝いまは全メッシュ。重みを1以上にすると再開します。';
      return;
    }
    el.className = '';
    var h = '目安（相対・5段階）: ';
    BAND_COLORS.forEach(function (c, i) { h += '<span class="sw" style="background:' + c + '"></span>' + BAND_LABELS[i]; });
    h += '　<span class="sw" style="background:#fff"></span>色なし＝隠したメッシュまたは設備なし（区別しない）<br>約5kmメッシュ。被害の予測ではありません。県警の被害実績とは一致していません。';
    el.innerHTML = h;
  }

  /* ---------- 地図 ---------- */
  function cellFeatures() {
    return S.sc.map(function (c, i) {
      var b = G.cellBounds(c.cx, c.cy);
      return { type: 'Feature', properties: { i: i, band: S.bd[i] == null ? -1 : S.bd[i] },
        geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
    });
  }
  function initMap() {
    if (typeof maplibregl === 'undefined') {
      $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした（ネットワークの制限など）。市町村の表・CSV・診断（座標を入力）は使えます。</p>';
      return;
    }
    map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } }, layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: [140.3, 36.3], zoom: 8.2, maxZoom: MAX_ZOOM, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: cellFeatures() } });
      map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', filter: ['>=', ['get', 'band'], 0], paint: { 'fill-opacity': 0.62, 'fill-color': ['match', ['get', 'band'], 0, BAND_COLORS[0], 1, BAND_COLORS[1], 2, BAND_COLORS[2], 3, BAND_COLORS[3], 4, BAND_COLORS[4], '#cccccc'] } });
      map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', filter: ['>=', ['get', 'band'], 0], paint: { 'line-color': '#555', 'line-width': 0.4, 'line-opacity': 0.6 } });
      map.addSource('mine', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'mine-line', type: 'line', source: 'mine', paint: { 'line-color': '#0072B2', 'line-width': 3, 'line-dasharray': [2, 1] } });
      mapReady = true;
      if (S.diag.lon != null) showPoint();
    });
    map.on('click', function (e) {
      if (S.tab === 'diag') { setPoint(String(e.lngLat.lng), String(e.lngLat.lat)); return; }
      if (S.tab === 'map') cellPopup(e.lngLat);
    });
  }
  function renderMap() {
    if (!mapReady) return;
    map.getSource('cells').setData({ type: 'FeatureCollection', features: cellFeatures() });
  }
  function cellPopup(ll) {
    var m = G.toMesh(ll.lng, ll.lat), idx = -1;
    S.sc.forEach(function (c, i) { if (c.cx === m.cx && c.cy === m.cy) idx = i; });
    var h;
    if (idx < 0) h = '<b>このメッシュは表示しません</b><br>設備が' + S.meta.k_min + '件未満、設備が少なくて大きな設備の出力が推測できる、または設備がないためです（どれかは区別しません）。';
    else {
      var c = S.sc[idx], b = S.bd[idx];
      h = '<b>約5kmメッシュの集計</b>（南西角の基準メッシュ ' + G.meshCode(c.cx * G.CELL, c.cy * G.CELL) + '）<br>設備 ' + n0(c.n) + '件・出力計 約' + mw(c.kw) + ' MW・うち50kW未満 ' + n1(c.share * 100) + '%<br>人口密度 約' + n0(c.dens) + '人/km²（2020年国勢調査）<br>' +
        (S.zero ? '目安: 重みがすべて0のため出ません' : '目安（5段階）: ' + bandChip(b)) +
        '<br><span style="font-size:11px;color:#555">被害の予測ではありません。県警の5地区別の被害実績とは一致していません。町字の代表点で数えているため、実際の位置とずれることがあります。</span>';
    }
    new maplibregl.Popup({ closeButton: true }).setLngLat(ll).setHTML(h).addTo(map);
  }

  /* ---------- 自己診断 ---------- */
  function buildClass() {
    var el = $('ctl-class'); el.innerHTML = '';
    S.classes.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(c.id === S.diag.cls)); b.textContent = c.label;
      b.addEventListener('click', function () {
        S.diag.cls = c.id; buildClass(); buildChecklist(); renderDiag();
      });
      el.appendChild(b);
    });
  }
  function visibleItems() {
    return S.items.filter(function (it) { return S.diag.cls === 'unknown' || it.cls.indexOf('all') >= 0 || it.cls.indexOf(S.diag.cls) >= 0; });
  }
  function srcLinks(keys) {
    return keys.map(function (k) { var s = S.ck.sources[k]; return s ? link(s.url, s.name) : esc(k); }).join('、');
  }
  function buildChecklist() {
    var h = '', last = '';
    visibleItems().forEach(function (it) {
      if (it.group !== last) { h += '<div class="cl-group">' + esc(it.group) + '</div>'; last = it.group; }
      var a = S.diag.answers[it.id] || 'unknown';
      h += '<div class="cl-item"><div class="t" id="t-' + it.id + '">' + esc(it.text) + '</div><div class="seg" role="radiogroup" aria-labelledby="t-' + it.id + '" data-id="' + it.id + '">' +
        [['yes', '実施している'], ['no', '実施していない'], ['unknown', 'わからない']].map(function (o) { return '<button type="button" role="radio" data-v="' + o[0] + '" aria-checked="' + (a === o[0]) + '">' + o[1] + '</button>'; }).join('') +
        '</div><div class="src">出典: ' + srcLinks(it.src) + '</div></div>';
    });
    $('checklist').innerHTML = h;
    Array.prototype.forEach.call($('checklist').querySelectorAll('.seg'), function (seg) {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.addEventListener('click', function () {
          S.diag.answers[seg.getAttribute('data-id')] = b.getAttribute('data-v');
          Array.prototype.forEach.call(seg.children, function (c) { c.setAttribute('aria-checked', String(c === b)); });
          renderDiag();
        });
      });
    });
  }

  /* lonS, latS: 文字列（入力欄の値、または地図クリックの数値を文字列にしたもの）。入力しても地図は動かさない（表示範囲が地理院に伝わるため） */
  function setPoint(lonS, latS) {
    var msg = $('pos-msg'), lon = G.parseCoord(lonS), lat = G.parseCoord(latS);
    if (lon == null || lat == null) { msg.textContent = '緯度・経度を数字で入れてください（半角・全角の数字と小数点だけ。例: 緯度36.34、経度140.45。「36,34」のようなカンマは使えません）。'; msg.className = 'note warn'; return; }
    var m = G.toMesh(lon, lat);
    if (!S.land || !S.land(m.ix, m.iy)) {
      msg.textContent = 'この位置は茨城県の範囲の外です（海上・他県を含む）。茨城県内の位置を入れてください。'; msg.className = 'note warn'; return;
    }
    S.diag.lon = lon; S.diag.lat = lat;
    $('in-lat').value = lat.toFixed(4); $('in-lon').value = lon.toFixed(4);
    msg.textContent = '位置を受け取りました（この端末の中だけで使います。地図は動かしません）。'; msg.className = 'note';
    showPoint(); renderDiag();
  }
  function showPoint() {
    if (!map || !mapReady || S.diag.lon == null) return;
    if (!marker) marker = new maplibregl.Marker({ color: '#0072B2' });
    marker.setLngLat([S.diag.lon, S.diag.lat]).addTo(map);
    var m = G.toMesh(S.diag.lon, S.diag.lat), b = G.cellBounds(m.cx, m.cy);
    map.getSource('mine').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } }] });
  }
  function resetDiag() {
    S.diag = { lon: null, lat: null, cls: 'unknown', answers: {} };
    $('in-lat').value = ''; $('in-lon').value = ''; $('pos-msg').textContent = ''; $('pos-msg').className = 'note';
    if (marker) { marker.remove(); marker = null; }
    if (mapReady) map.getSource('mine').setData({ type: 'FeatureCollection', features: [] });
    buildClass(); buildChecklist(); renderDiag();
  }

  function renderDiag() {
    var el = $('diag-result');
    if (!S.items.length) return;
    if (S.diag.lon == null) { el.innerHTML = '<p class="note">位置を指すと、周囲の目安と、未実施の対策が出ます。</p>'; S.res = null; return; }
    var r = G.diagnose({ lon: S.diag.lon, lat: S.diag.lat, cls: S.diag.cls, answers: S.diag.answers }, { cells: S.cells, pops: S.pops, items: S.items, weights: S.weights });
    S.res = r;
    var cellBand = null;
    S.sc.forEach(function (c, i) { if (c.cx === r.mesh.cx && c.cy === r.mesh.cy) cellBand = S.bd[i]; });
    var h = '<div class="sent"><b>対策の状況（対象' + r.total + '項目）</b>: 実施している <b>' + r.done + '</b> ／ 実施していない <b>' + r.notDone.length + '</b> ／ わからない <b>' + r.unknown.length + '</b></div>' +
      '<h3>周囲の目安（公開データの集計から。被害の予測ではありません）</h3><ul class="note" style="font-size:13px;padding-left:18px;color:#222">' +
      '<li>この位置を含む約5kmメッシュ（南西角の基準メッシュ ' + esc(r.code) + '）の人口は約' + n0(r.cellPopulation) + '人（人口密度 約' + n0(r.cellDensity) + '人/km²、2020年国勢調査の常住人口）。診断は約5kmメッシュの単位でしか位置を使いません。</li>' +
      '<li>このメッシュの目安: ' + (S.zero ? '重みがすべて0のため出ません' : cellBand == null ? '設備が少ないか無いため出しません' : bandChip(cellBand) + '（県内の設備のあるメッシュの中での相対位置。5段階）') + '。</li>' +
      '<li>このメッシュの認定設備の集計: ' + (r.cellVisible ? r.cell.n + '件・出力計約' + mw(r.cell.kw) + ' MW・うち50kW未満' + r.cell.small + '件' : '設備が少ないか無いため表示しません') + '。</li>' +
      '<li>周囲の人の少なさ（参考）: 県内のメッシュの中で5段階の<b>' + BAND_LABELS[r.quietBand] + '</b>（高いほど人が少ない側）。</li></ul>';
    if (r.quietBand >= 4) h += '<div class="sent">常住人口が少ない側です。JPEA・REASPの資料は「人目につきにくい立地」を挙げています。ただし県警の5地区別の被害（設備1,000件あたり）は、人口密度の低い地区ほど多いという関係になっていませんでした（「盗難の実態」）。人の目の代わりになる検知・通報・夜間監視の対策を、先に確認する価値があります（被害が起きるかどうかを示すものではありません）。</div>';
    else if (r.quietBand <= 1) h += '<div class="sent">常住人口が多い側です。ただし資料は、人目があっても下見のうえで短時間に行われる犯行があるとしており、対策の確認が不要になるわけではありません。</div>';
    h += '<h3>未実施・不明の対策</h3>';
    var list = function (title, arr, cls) {
      if (!arr.length) return '';
      var s = '<div class="' + cls + '"><b>' + title + '（' + arr.length + '）</b><ul style="margin:4px 0 0;padding-left:18px">';
      arr.forEach(function (it) { s += '<li>' + esc(it.text) + '<div class="src">出典: ' + srcLinks(it.src) + '</div></li>'; });
      return s + '</ul></div>';
    };
    h += list('実施していない対策', r.notDone, 'todo') + list('実施の有無を確認したい対策', r.unknown, 'sent');
    if (!r.notDone.length && !r.unknown.length) h += '<p class="note">挙げた項目はすべて「実施している」です。ただしJPEA・REASPの資料は「完全に防ぐ方法があるわけではない」としています。</p>';
    h += '<p class="note">不審者を見かけたとき・被害に遭ったときは、110番または最寄りの警察署へ（茨城県警の案内）。盗難防止情報は、警察が太陽光発電設備の設置者などに周知することになっています（盗難特定金属製物品の処分の防止等に関する法律 第16条）。</p>';
    el.innerHTML = h;
  }

  /* ---------- 盗難の実態 ---------- */
  function bars(rows, key, cls, maxv) {
    return '<div class="bars">' + rows.map(function (r) {
      return '<div class="bar"><span>' + esc(r.label) + '</span><span class="track"><span class="fill ' + cls + '" style="display:block;width:' + (r[key] / maxv * 100).toFixed(1) + '%"></span></span><span class="v">' + n0(r[key]) + '件</span></div>';
    }).join('') + '</div>';
  }
  function buildReality() {
    var R = S.reality, y = R.yearly, so = R.solar, ar = R.areas;
    var mx = Math.max.apply(null, y.rows.map(function (r) { return r.japan; }));
    var h = '<div class="box"><h2>' + esc(y.title) + '</h2><h3>茨城県</h3>' + bars(y.rows.map(function (r) { return { label: r.label, v: r.ibaraki }; }), 'v', 'b', Math.max.apply(null, y.rows.map(function (r) { return r.ibaraki; }))) +
      '<h3>全国</h3>' + bars(y.rows.map(function (r) { return { label: r.label, v: r.japan }; }), 'v', '', mx) +
      '<p class="note">' + esc(y.note) + '<br>出典: ' + link(y.url, y.source) + '（取得 2026-11-13）</p></div>';
    var mxs = Math.max.apply(null, so.rows.map(function (r) { return r.metal; }));
    h += '<div class="box"><h2>' + esc(so.title) + '</h2><h3>金属盗の件数</h3>' + bars(so.rows.map(function (r) { return { label: r.label, v: r.metal }; }), 'v', 'b', mxs) +
      '<h3>うち太陽光発電施設</h3>' + bars(so.rows.map(function (r) { return { label: r.label, v: r.solar }; }), 'v', '', mxs) +
      '<p class="note">' + esc(so.note) + '<br>出典: ' + link(so.url, so.source) + '</p></div>';
    var mxa = Math.max.apply(null, ar.rows.map(function (r) { return r.n; }));
    h += '<div class="box"><h2>' + esc(ar.title) + '</h2>' + bars(ar.rows.map(function (r) { return { label: r.area + '（' + r.example + '）', v: r.n }; }), 'v', '', mxa) +
      '<p class="note">' + esc(ar.note) + '<br>出典: ' + link(ar.url, ar.source) + '</p></div>';
    h += '<div class="box"><h2>県警の被害実績と、このアプリの目安の食い違い</h2><div id="dist-compare2"></div></div>';
    h += '<div class="box"><h2>なぜ個別の設備を公開しないのか、被害の影響</h2>' + R.why.map(function (w) { return '<p style="font-size:13px;margin:6px 0">' + esc(w.text) + '<br><span class="src">出典: ' + link(w.url, w.src) + '</span></p>'; }).join('') + '</div>';
    $('reality').innerHTML = h;
  }

  /* ---------- 出典・前提・限界 ---------- */
  function buildAbout() {
    var m = S.meta, st = m.stats;
    var h = '<div class="about box">' +
      '<h2>このアプリが何で、何でないか</h2><ul>' +
      '<li>茨城県の太陽光発電設備の<b>集計</b>（約5kmメッシュ・市町村）から、盗難対策の優先順位を考えるための<b>目安</b>を出す静的Webアプリ（デモ）。サーバーは使いません。</li>' +
      '<li>被害の予測、個別設備の順位・一覧、「狙われやすい設備」の特定はしません。認定情報には防犯設備も被害の履歴もありません。</li>' +
      '<li><b>目安は、県警が公表する5地区別の被害実績とは一致していません</b>（実績は設備1,000件あたり県南が最も多く鹿行が最も少ないのに対し、目安の地区平均は別の並びになる。現在の重みでの順位相関は「盗難の実態」「公開の集計地図」に出る。5地区の対応づけは推測で、比べられるのは5点だけ）。目安は「被害の起きやすさ」ではなく、被害額の大きさ（1件あたりの出力）と低圧設備の多さの目安として読む。</li></ul>' +
      '<h2>使ったデータ</h2><table><tr><th class="l">データ</th><th class="l">提供者・時点</th><th class="l">使い方・件数</th><th class="l">利用条件</th></tr>' +
      '<tr><td class="l">事業計画認定情報（茨城県ファイル）</td><td class="l">資源エネルギー庁 再エネ電子申請サイト、' + esc(m.as_of) + '時点、取得 ' + esc(m.retrieved) + '<br>' + link(m.plants_url, m.plants_url) + '</td><td class="l">太陽光 ' + n0(st.rows) + '件のうち、運転開始報告済みの' + n0(st.counted) + '件（運転開始前' + n0(st.not_started) + '件を除く）を、町字名で小地域に対応づけて集計。出力は「発電出力（kW）」を使用。' + n0(st.placed) + '件を集計メッシュに入れ、' + n0(st.unplaced) + '件は市町村の集計のみ。事業者名・代表者名・事業者住所・電話・設備IDは取り込まない。</td><td class="l">' + link(m.terms_url, '利用ルール') + '（商用可、出典記載・加工の明記、国が作成したかのような公表の禁止）。禁止事項に「国家・国民の安全に脅威を与える利用」があり、この用途がそれに当たらないか<b>未確認（事務局への確認待ち）</b>。</td></tr>' +
      '<tr><td class="l">小地域（町丁・字等）境界の属性表</td><td class="l">総務省統計局 e-Stat、国勢調査2020</td><td class="l">町字名と代表点・人口・面積。住所の町字名との照合に使う（' + n0(st.placed_exact) + '件は町字名が一致、' + n0(st.placed_ohaza) + '件は大字名で始まる小地域の代表点の平均）。町字の面積は中央値' + st.town_area_km2_median + 'km²、90%点' + st.town_area_km2_p90 + 'km²で、1kmより粗い。</td><td class="l">' + link(m.estat_terms, 'e-Stat 利用規約') + '（出典の表示、加工の明記。政府標準利用規約2.0準拠と情報部が確認）</td></tr>' +
      '<tr><td class="l">地域メッシュ統計（人口）</td><td class="l">総務省統計局 e-Stat、国勢調査2020、基準地域メッシュ（約1km）</td><td class="l">人口密度の計算と、診断の周囲の人口。人数が少ないメッシュは「*」で近隣に合算されるため、0として扱う（合算先に含まれる）。</td><td class="l">同上</td></tr>' +
      '<tr><td class="l">対策の項目・盗難の実態</td><td class="l">茨城県警察、JPEA・REASP（画面の各項目に出典）</td><td class="l">チェックリストと実態の件数。令和8年は暫定値。</td><td class="l">各サイトの利用条件に従い、数値と短い要約のみ掲載</td></tr>' +
      '<tr><td class="l">背景地図</td><td class="l">地理院タイル（淡色地図）</td><td class="l">地図の背景のみ。地理院の住所検索APIは使っていない</td><td class="l">国土地理院の利用規約</td></tr>' +
      '<tr><td class="l">描画</td><td class="l">MapLibre GL JS 4.7.1</td><td class="l"></td><td class="l">BSD-3-Clause</td></tr></table>' +
      '<p class="note">本アプリは、再エネ電子申請サイトの認定情報と、総務省統計局 e-Stat の国勢調査データを加工して作成した。国（資源エネルギー庁・総務省統計局）が作成したものではない。</p>' +
      '<h2>目安の定義と、県警の被害実績との食い違い</h2><ul><li>3つの指標（設備1件あたりの出力・低圧の割合・周囲の人の少なさ）を、県内の集計メッシュ' + n0(S.cells.length) + '個の中での相対位置に直し、利用者が決める重みで平均。画面と書き出しに出すのは5段階の帯だけで、連続のスコアや各指標の順位に当たる値は出さない。初期の重みは「出力1・低圧割合1・人の少なさ0」。定義と根拠は「公開の集計地図」の「3つの指標の定義と根拠」。</li>' +
      '<li><b>見直しの経緯</b>: 最初の版は「人の少なさ・出力合計・低圧割合」を等しい重みで平均していた。県警の5地区別の被害（設備1,000件あたり）と市町村の目安の地区平均を並べると逆向き（順位相関−0.90）だった。そこで、被害の実績に合わせるのではなく、指標そのものの妥当性から (1) 常住人口の少なさを初期値0の参考にする（人目の代理として弱く、海面を含むメッシュで高く出る）、(2) 出力合計は設備数とほぼ同じ並びなので1件あたりの出力に直す、の2点を直した。見直しの際に実績の並びを見ているので、独立の検証ではない。見直し後も実績とは一致せず（初期の重みで順位相関−0.60）、一致するとは主張しない。</li>' +
      '<li>相対位置なので、県全体が安全・危険という意味はない。指標の選び方と重みに公的な根拠はなく、的中率などの検証はしていない。</li></ul>' +
      '<h2>悪用を防ぐ設計</h2><ul>' +
      '<li>犯人は事前に下見をする（JPEA・REASP p.9、茨城県警）。そのため、個別設備の位置・順位・一覧は作らない。公開データから取り込む設備の行は、ビルド時に集計して捨て、画面・書き出しのデータには残らない。</li>' +
      '<li>公開は約5kmメッシュと市町村の集計のみ。メッシュの順位が作れないよう、画面・書き出し・公開のデータに、メッシュの連続スコアや各指標の順位に当たる値は出さず、5段階の帯（同じ帯に多数のメッシュが入る）にとどめる。出すのは件数・出力計・50kW未満の件数・人口など、元の公開データから集計できる値。</li>' +
      '<li>設備が' + m.k_min + '件未満のメッシュ・市町村は、件数・容量・指標を出力しない。さらに、設備が' + m.dom_n + '件未満のメッシュは、50kW以上の設備が1件以下なら隠す（件数・出力計・50kW未満の件数から、その1件の出力が狭い幅で割り出せるため）。出力計は' + m.kw_round + 'kW単位に丸めて出す。' + n0(st.cells_hidden) + 'メッシュ（設備計' + n0(st.plants_in_hidden_cells) + '件）を隠している。しきい値は小さい集計を隠すための最小限の目安で、統計的な匿名性を保証するものではない。市町村の合計とメッシュの合計の差から、隠したメッシュの合計は推定できる。</li>' +
      '<li>事業者の自己診断は、入力をブラウザの中で計算し、送信も保存もしない。診断の位置は約5kmメッシュの単位でだけ使う（人口もこの単位）。座標を入力しても地図は動かさず、地図の拡大も縮尺11（約16km四方のタイル）までに制限する。ただし地図を動かして見ている範囲の地図画像は、地理院が受け取るので、見ている範囲は地理院に伝わる。茨城県の外・海上の座標は受け付けない。</li>' +
      '<li>盗難の実態は、警察が公表している粒度（全国・県・県内5地区）にとどめた。</li>' +
      '<li>国は盗難防止の情報を、太陽光発電設備を設置する者など盗難に遭うおそれが大きい者に周知する形（盗難特定金属製物品の処分の防止等に関する法律 第16条。情報部の確認）を取っている。当事者が自分で使う診断はこの趣旨に沿う、というのが設計の考え方である（推測）。ただし元データの認定情報は地番まで公開されており、このアプリの秘匿は「他人に見つけられなくする」ものではなく、「元データ以上の手がかり（手薄さの順位）を足さない」ためのもの。</li></ul>' +
      '<h2>限界・要確認</h2><ul>' +
      '<li><b>認定情報の利用ルールの禁止事項「国家・国民の安全に脅威を与える利用」に、この用途が当たらないかは未確認（事務局への確認待ち）。公開前に確認が要る。</b></li>' +
      '<li>県警の5地区が茨城県の地域区分（県北・県央・鹿行・県南・県西）と同じ市町村の範囲かは誌面に記載がなく、地区別の設備数との対応は推測。被害は令和8年9月末の暫定値（期間は1年に満たない）で、「9月末」が累計かは誌面に明記がない。</li>' +
      '<li>目安と県警の地区別の被害は一致していない（上記）。県南・県西は千葉・埼玉に近く、アクセスや逃げやすさが効いている可能性があるが、検証していない（推測）。</li>' +
      '<li>出力20kW未満の太陽光は元データに含まれない。JPEA・REASPの資料では事業用の認定件数の94.6%が10〜50kW未満（2024年3月末）なので、小規模設備の一部は集計に入らない。</li>' +
      '<li>認定情報には失効した認定を含みうる。複数地番の設備は代表地番のみ。</li>' +
      '<li>位置は町字の代表点。町字の面積の中央値は' + st.town_area_km2_median + 'km²で、広い大字の設備は実際と別のメッシュに数えられることがある。約5kmメッシュにしたのはこのため。住所の町字が小地域名と一致しない' + n0(st.unplaced) + '件（' + n1(st.unplaced / st.counted * 100) + '%）は市町村の集計のみ。</li>' +
      '<li>人口は常住人口（2020年）で、夜間・休日の人通り、見通し、道路・側道の有無、防犯設備は反映しない。海に面したメッシュは海の面積を含むため人口密度が低く出る。県境のメッシュは隣の県の人口を含み、設備は茨城県だけを数える。</li>' +
      '<li>全国・県の件数と、本アプリの設備数は別の粒度で、設備単位・メッシュ単位の被害実績との突き合わせはしていない（公開データにその粒度がない）。</li>' +
      '<li>e-Statの利用条件は情報部の確認（政府標準利用規約2.0準拠）による。公開前に最新の条件を確認すること。</li></ul></div>';
    $('about').innerHTML = h;
    labelCells($('about'));
  }
  /* スマホ幅で表をカードにするため、各セルに見出し（data-label）を付ける */
  function labelCells(root) {
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (t) {
      var hs = Array.prototype.map.call(t.rows[0].cells, function (c) { return c.textContent; });
      Array.prototype.forEach.call(t.rows, function (r, i) { if (i) Array.prototype.forEach.call(r.cells, function (c, j) { c.setAttribute('data-label', hs[j] || ''); }); });
      t.classList.add('cards');
    });
  }

  /* ---------- CSV（集計のみ） ---------- */
  function buildCsvRows() {
    var m = S.meta, w = S.weights, rows = [];
    rows.push(['# 太陽光発電所の盗難対策マップ（デモ・茨城県）の集計。個別設備は含みません。被害の予測ではなく、公開情報から作った目安です。']);
    rows.push(['# 出典', m.plants_source + '（' + m.as_of + '時点、取得' + m.retrieved + '）を加工して作成。' + m.boundary_source + '。' + m.mesh_source + '。国が作成したものではありません。']);
    rows.push(['# 前提', '約5kmメッシュ（1kmメッシュ×5）。設備が' + m.k_min + '件未満のメッシュ・市町村は出力しません。位置は町字の代表点（広い大字ではずれます）。出力20kW未満は元データにありません。']);
    rows.push(['# 重み', '設備1件あたりの出力=' + w.kw + ' 低圧割合=' + w.small + ' 人の少なさ=' + w.quiet + '（指標は県内の集計メッシュ／市町村の中での相対位置。目安は5段階の帯だけを出し、連続のスコア・順位は出しません）']);
    rows.push(['# 注意', '目安は県警の5地区別の被害実績とは一致していません（5地区と市町村の対応は推測）。出力計は' + m.kw_round + 'kW単位に丸めています。設備が少なく大きな設備の出力が推測できるメッシュも出力しません。']);
    rows.push([]);
    rows.push(['メッシュ別']);
    rows.push(['南西角の基準メッシュコード', '設備数', '出力計(kW、丸め)', '50kW未満の設備数', '人口(2020国勢調査)', '人口密度(人/km2)', '目安の帯']);
    S.sc.forEach(function (c, i) {
      rows.push([G.meshCode(c.cx * G.CELL, c.cy * G.CELL), c.n, c.kw, c.small, c.pop, Math.round(c.dens), S.bd[i] == null ? '' : BAND_LABELS[S.bd[i]]]);
    });
    rows.push([]);
    rows.push(['市町村別']);
    rows.push(['市町村', '設備数', '出力計(kW)', '50kW未満の設備数', '人口(2020国勢調査)', '面積(km2)', '人口密度(人/km2)', '目安の帯']);
    S.ms.forEach(function (x) {
      rows.push([x.name, x.hidden ? '' : x.n, x.hidden ? '' : x.kw, x.hidden ? '' : x.small, x.pop, x.area, Math.round(x.dens), x.band == null ? '' : BAND_LABELS[x.band]]);
      if (x.hidden) rows[rows.length - 1].push('※' + m.k_min + '件未満のため設備の値は非表示');
    });
    return rows;
  }
  function downloadCsv() {
    var blob = new Blob(['﻿' + G.toCsv(buildCsvRows())], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'solar-guard-ibaraki-aggregate.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  window.SgApp = { STATE: S, mapReady: function () { return mapReady; }, buildCsvRows: buildCsvRows, setPoint: setPoint };
  init();
})();
