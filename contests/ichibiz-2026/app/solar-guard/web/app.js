/* 太陽光発電所の盗難対策マップ（デモ）: 画面制御。計算は lib.js（Sg）、データは data/（build_data.py の生成物と、出典付きの手書き json）。
   通信は静的ファイルの取得（data/）と地図タイル・MapLibre の取得だけ。利用者の入力（位置・回答）は送信も保存もしない。 */
(function () {
  'use strict';
  var G = window.Sg;
  var BAND_COLORS = ['#f1eef6', '#d7b5d8', '#dd1c77', '#980043'];   // 低・中・やや高・高（リスクの4段階。仮の規則）
  var BAND_LABELS = G.LEVELS;
  var MAX_ZOOM = 10;      // 地図の拡大の上限（MapLibre の拡大率10は、256px の地理院タイルでは縮尺11のタイルを取得する）。これより細かい縮尺にすると、見ている範囲の細かい地図画像を地理院が受け取り、位置が伝わりうる
  var S = { meta: null, cells: [], pops: null, munis: [], items: [], classes: [], reality: null, ck: null, land: null, regions: null,
    risk: null, areaNames: [], tiers: [], d711: null, d89: null, sc: [], bd: [], ms: [], sort: 'name', tab: 'map',
    diag: { lon: null, lat: null, muni: null, cls: 'unknown', answers: {}, cond: {} }, res: null };
  var map = null, mapReady = false, marker = null, popup = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function n0(x) { return Math.round(x).toLocaleString('ja-JP'); }
  function n1(x) { return x.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function mw(kw) { return n1(kw / 1000); }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function link(u, t) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t) + '</a>'; }

  /* ---------- 起動 ---------- */
  function init() {
    Promise.all([getJSON('data/cells.json'), getJSON('data/pops.json'), getJSON('data/munis.json'), getJSON('data/checklist.json'), getJSON('data/reality.json'), getJSON('data/land.json'), getJSON('data/districts.json'), getJSON('data/risk.json')]).then(function (r) {
      S.meta = r[0].meta; S.cells = r[0].rows; S.pops = G.popGrid(r[1].rows); S.munis = r[2].rows; S.ck = r[3]; S.items = r[3].items; S.classes = r[3].classes; S.reality = r[4]; S.land = G.landSet(r[5].rows); S.regions = r[6].regions; S.risk = r[7]; S.areaNames = r[0].regions;
      $('kmin').textContent = S.meta.k_min;
      buildClass(); buildConds(); buildChecklist(); buildTrend(); buildReality(); buildAbout();
      recompute(); buildMuniSelect(); buildRules(); initMap(); renderDiag();
    }).catch(function (e) {
      $('pane-map').insertAdjacentHTML('afterbegin', '<p class="warn">データを読み込めませんでした: ' + esc(e.message) + '（file:// ではなく http で開いてください）</p>');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
    $('btn-csv').addEventListener('click', downloadCsv);
    $('btn-set').addEventListener('click', function () { setPoint($('in-lon').value, $('in-lat').value); });
    $('btn-reset').addEventListener('click', resetDiag);
    $('go-diag').addEventListener('click', function () { setTab('diag'); });
    $('go-diag2').addEventListener('click', function () { setTab('diag'); window.scrollTo(0, 0); });
    /* 「このアプリについて」: 閉じるボタンと、外側を押したら閉じる（評価ループ第5回） */
    $('about-close').addEventListener('click', function () { $('aboutapp').open = false; });
    document.addEventListener('click', function (e) { var d = $('aboutapp'); if (d.open && !d.contains(e.target)) d.open = false; });
    $('btn-mapsel').addEventListener('click', function () { toggleMapSel(); });
    $('in-muni').addEventListener('change', function () { setMuni($('in-muni').value); });
    initMini();
  }

  function setTab(t) {
    S.tab = t; document.body.setAttribute('data-tab', t);
    closePopup();
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-tab') === t)); });
    ['map', 'diag', 'reality', 'about'].forEach(function (k) { $('pane-' + k).hidden = k !== t; });
    if (map && (t === 'map' || t === 'diag')) setTimeout(function () { map.resize(); }, 50);
  }
  /* スマホの診断タブ: 小さな地図を開いて、その場で場所を押せるようにする（タブを切り替えずに済む） */
  function toggleMapSel(on) {
    on = on == null ? !document.body.classList.contains('mapsel') : on;
    document.body.classList.toggle('mapsel', on);
    $('btn-mapsel').textContent = on ? '地図を閉じる' : '地図で場所を選ぶ';
    if (map) setTimeout(function () { map.resize(); }, 50);
  }

  /* ---------- 上部: 盗難の件数・推移 ---------- */
  function buildTrend() {
    var y = S.reality.yearly.rows, pick = function (yr) { return y.filter(function (r) { return r.year === yr; })[0]; };
    var a = pick(2023), b = pick(2024), c = pick(2025), nat = S.reality.nation;
    $('trend').innerHTML = '<b>茨城県の金属盗</b>: 令和5年 ' + n0(a.ibaraki) + '件 → 6年 ' + n0(b.ibaraki) + '件 → 7年 ' + n0(c.ibaraki) + '件。太陽光のケーブル窃盗は関東に集中（令和5年は全国の91.8%）。金属盗対策法・県条例が施行済み。' +
      '<br><span class="src">出典: ' + link(S.reality.yearly.url, '茨城県警察') + '、' + link(nat.url, '警察庁 検討会資料 p.5') + '、' + link(S.reality.law.url, '警察庁「金属盗対策」') + '</span>';
  }

  /* ---------- 色分けの規則と、県警の実績との照合 ---------- */
  function areaOf(d, name) { return d.rows.filter(function (r) { return r.area === name; })[0]; }
  function buildRules() {
    var d = S.d711, p = S.reality.areas711, sc = S.risk.scale;
    $('rules').innerHTML = '<p class="note dark"><b>点数 ＝ 2 × 地区の段階（0〜2） ＋ 人目の少なさ（0か1）</b>。0点＝低、1〜2点＝中、3〜4点＝やや高、5点＝高（すべて仮の規則）。</p>' +
      '<ul class="note dark">' +
      '<li><b>地区の段階</b>: 県警の県内5地区の件数（' + link(p.url, '令和7年11月末') + '）÷地区の設備数。設備1,000件あたり、県全体（' + n1(d.avg) + '）以上で2、' + G.TIER_MID + '以上で1、他は0。メッシュは中の設備が最も多い市町村の地区（' + n0(S.meta.stats.cells_visible_mixed_region) + 'メッシュは複数の地区にまたがる）。</li>' +
      '<li><b>人目の少なさ</b>: 国勢調査2020の人口密度が県内の低い方から1/3なら1（切り方は仮。夜間・見通しは見ない）。</li>' +
      '<li><b>使わないもの</b>: 規模（出力）は資料で向きが食い違うので使わない（両論は下）。逃げやすさは距離の根拠がなく使わない。防犯設備などは公開データにないので診断でだけ扱う。</li></ul>' +
      '<p class="note"><b>規模について（両論）</b>: ' + esc(sc.note) + '（' + link(sc.url, 'JPEA・REASP') + '）</p>';
  }

  /* 県警の地区別の実績（設備1,000件あたり）と、メッシュの色の分布を並べる。色の地区の段階は令和7年11月末の件数から作っているので、同じ期間との並びが合うのは当然（独立の検証ではない） */
  function renderDist() {
    var a = S.d711, b = S.d89, lv = {};
    S.areaNames.forEach(function (nm) { lv[nm] = { cnt: [0, 0, 0, 0], quiet: 0, tot: 0, sum: 0 }; });
    S.sc.forEach(function (c) { if (c.level == null) return; var o = lv[S.areaNames[c.region]]; o.cnt[c.level]++; o.tot++; o.sum += c.level; if (c.quiet) o.quiet++; });
    var rows = a.rows.map(function (r) {
      var o = lv[r.area], r2 = areaOf(b, r.area);
      return { area: r.area, theft: r.theft, plants: r.plants, rate: r.rate, tier: r.tier, rate89: r2.rate, cnt: o.cnt, tot: o.tot, mean: o.tot ? o.sum / o.tot : null, quiet: o.tot ? o.quiet / o.tot : null };
    });
    var col = function (k) { return rows.map(function (r) { return r[k]; }); };
    var rho1 = G.rankCorr(col('rate'), col('mean')), rho2 = G.rankCorr(col('rate89'), col('mean')), rho3 = G.rankCorr(col('rate'), col('quiet'));
    S.check = { rho1: rho1, rho2: rho2, rho3: rho3, rows: rows };
    var f2 = function (x) { return x == null ? '—' : (x > 0 ? '+' : '') + x.toFixed(2); };
    var h = '<div class="scroll"><table class="dist cards"><tr><th class="l">地区（県の区分で推測）</th><th>設備数</th><th>県警の件数 令和7年11月末</th><th>設備1,000件あたり 令和7年11月末（色の根拠）</th><th>地区の段階</th><th>設備1,000件あたり 令和8年9月末（別の期間）</th><th>メッシュの色の数（低／中／やや高／高）</th><th>人目が少ないメッシュの割合</th></tr>';
    rows.slice().sort(function (x, y) { return (y.rate || 0) - (x.rate || 0); }).forEach(function (r) {
      h += '<tr><td class="l" data-label="地区（県の区分で推測）">' + esc(r.area) + '</td><td data-label="設備数">' + n0(r.plants) + '</td><td data-label="県警の件数 令和7年11月末">' + n0(r.theft) + '</td><td data-label="設備1,000件あたり 令和7年11月末">' + n1(r.rate) + '</td><td data-label="地区の段階">' + r.tier + '</td><td data-label="設備1,000件あたり 令和8年9月末">' + n1(r.rate89) + '</td><td data-label="メッシュの色の数">' + r.cnt.join('／') + '（計' + r.tot + '）</td><td data-label="人目が少ないメッシュの割合">' + (r.quiet == null ? '—' : n0(r.quiet * 100) + '%') + '</td></tr>';
    });
    h += '</table></div>';
    var html = '<p class="note dark">①令和7年11月末の実績との順位相関 ' + f2(rho1) + ' は、その実績から段階を作ったので<b>独立の検証ではありません</b>。②別の期間（令和8年9月末）との順位相関 ' + f2(rho2) + ' も、切り方を両期間を見て決めたので検証ではありません。③人目の少なさは、地区どうしでは被害率と' + (rho3 != null && rho3 < 0 ? '<b>逆向き</b>（順位相関 ' + f2(rho3) + '。県西は被害率が最も高いのに人目が少ないメッシュの割合は最も低い）で、色では1点の小さな補正にとどめています' : '同じ向き（順位相関 ' + f2(rho3) + '。5点だけで裏づけとは言えません）') + '。④地区の中のメッシュごとの実績は公開されておらず、確かめられません。</p>' + h +
      '<p class="note">設備1,000件あたりの件数は、分子（県警の件数。20kW未満を含みうる）と分母（認定情報の20kW以上）の定義が違う参考値。県警の5地区が県の区分（県北・県央・鹿行・県南・県西）と同じ範囲かは記載がなく<b>推測</b>。両期間とも暫定値。</p>';
    ['dist-compare', 'dist-compare2'].forEach(function (id) { if ($(id)) $(id).innerHTML = html; });
  }

  function recompute() {
    var R = S.reality;
    S.d711 = G.districtStats(S.regions, R.areas711.rows, S.munis);
    S.d89 = G.districtStats(S.regions, R.areas.rows, S.munis);
    S.tiers = S.areaNames.map(function (nm) { var r = areaOf(S.d711, nm); return r ? r.tier : null; });
    var sc = G.meshLevels(S.cells, S.tiers), ms = G.muniLevels(S.munis, S.regions, S.tiers, S.areaNames);
    sc.forEach(function (c) { c.band = c.level; });
    ms.forEach(function (m) { m.band = m.level; });
    S.sc = sc; S.bd = sc.map(function (c) { return c.level; }); S.ms = ms;
    var st = S.meta.stats;
    $('map-summary').textContent = '認定情報の太陽光（運転開始報告済み・出力20kW以上）' + n0(st.counted) + '件のうち、集計メッシュに入れたのは' + n0(st.placed) + '件（町字が地図の名称と一致しなかった' + n0(st.unplaced) + '件は市町村の集計だけ）。設備のあるメッシュ' + n0(st.cells_all) + 'のうち、' + n0(st.cells_hidden) + 'メッシュ（設備' + S.meta.k_min + '件未満の' + n0(st.cells_hidden_small_n) + '、設備' + S.meta.dom_n + '件未満で50kW以上が1件以下の' + n0(st.cells_hidden_dominant) + '）は隠しています。';
    buildLegend();
    renderDist();
    renderMunis();
  }

  function bandChip(b) {
    if (b == null) return '<span class="band" style="background:#fff">—</span>';
    return '<span class="band" style="background:' + BAND_COLORS[b] + ';color:' + (b >= 2 ? '#fff' : '#222') + '">' + BAND_LABELS[b] + '</span>';
  }

  function renderMunis() {
    var key = S.sort, rows = S.ms.slice();
    var cmp = { name: function (a, b) { return a.name.localeCompare(b.name, 'ja'); },
      n: function (a, b) { return (b.n || 0) - (a.n || 0); }, kw: function (a, b) { return (b.kw || 0) - (a.kw || 0); },
      dens: function (a, b) { return a.dens - b.dens; }, risk: function (a, b) { return (b.band == null ? -1 : b.band) - (a.band == null ? -1 : a.band) || a.name.localeCompare(b.name, 'ja'); } };
    rows.sort(cmp[key]);
    var th = function (k, t) { return '<th><button type="button" data-sort="' + k + '"' + (key === k ? ' aria-pressed="true"' : '') + '>' + t + (key === k ? ' ▼' : '') + '</button></th>'; };
    var h = '<table><tr>' + th('name', '市町村') + '<th>地区（推測）</th>' + th('n', '設備数') + th('kw', '出力計(MW)') + '<th>50kW未満の割合</th>' + th('dens', '人口密度(人/km²)') + th('risk', 'リスク（仮）') + '</tr>';
    rows.forEach(function (m) {
      h += '<tr><td class="l">' + esc(m.name) + '</td><td class="l">' + (m.region >= 0 ? esc(S.areaNames[m.region]) : '—') + '</td>' + (m.hidden ? '<td colspan="3">' + S.meta.k_min + '件未満のため非表示</td>' : '<td>' + n0(m.n) + '</td><td>' + mw(m.kw) + '</td><td>' + n1(m.share * 100) + '%</td>') +
        '<td>' + n0(m.dens) + '</td><td>' + bandChip(m.band) + '</td></tr>';
    });
    $('muni-table').innerHTML = h + '</table>';
    Array.prototype.forEach.call($('muni-table').querySelectorAll('th button'), function (b) { b.addEventListener('click', function () { S.sort = b.getAttribute('data-sort'); renderMunis(); }); });
  }

  function buildLegend() {
    var el = $('legend');
    el.className = '';
    var h = '<span class="lgt">実績に基づく地区の目安（仮・被害の予測ではありません）</span><br class="sp"> ';
    BAND_COLORS.forEach(function (c, i) { h += '<span class="sw" style="background:' + c + '"></span>' + BAND_LABELS[i]; });
    h += '<span class="sw" style="background:#fff"></span>色なし';
    el.innerHTML = h;
  }

  /* ---------- 地図 ---------- */
  function cellFeatures() {
    return S.sc.map(function (c, i) {
      var b = G.cellBounds(c.cx, c.cy);
      return { type: 'Feature', properties: { i: i, band: S.bd[i] == null ? -1 : S.bd[i], region: c.region },
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
      center: [140.3, 36.3], zoom: window.innerWidth <= 720 ? 7.7 : 8.2, maxZoom: MAX_ZOOM, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: cellFeatures() } });
      map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', filter: ['>=', ['get', 'band'], 0], paint: { 'fill-opacity': 0.62, 'fill-color': ['match', ['get', 'band'], 0, BAND_COLORS[0], 1, BAND_COLORS[1], 2, BAND_COLORS[2], 3, BAND_COLORS[3], '#cccccc'] } });
      map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', filter: ['>=', ['get', 'band'], 0], paint: { 'line-color': '#555', 'line-width': 0.4, 'line-opacity': 0.6 } });
      /* 評価ループ第5回: 地区の境目を太線で引き、色が地区単位の目安だと見た目でも分かるようにする */
      map.addSource('borders', { type: 'geojson', data: { type: 'FeatureCollection', features: regionEdges() } });
      map.addLayer({ id: 'border-line', type: 'line', source: 'borders', paint: { 'line-color': '#14365d', 'line-width': 2.5, 'line-opacity': 0.85 } });
      map.addLayer({ id: 'area-line', type: 'line', source: 'cells', filter: ['==', ['get', 'region'], -9], paint: { 'line-color': '#0072B2', 'line-width': 2 } });
      addAreaLabels();
      map.addSource('mine', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'mine-line', type: 'line', source: 'mine', paint: { 'line-color': '#0072B2', 'line-width': 3, 'line-dasharray': [2, 1] } });
      mapReady = true;
      var at = document.querySelector('.maplibregl-ctrl-attrib');
      if (at && window.innerWidth <= 720) at.classList.remove('maplibregl-compact-show');   // 帰属表示は「i」で開く（出典は画面下にも常に表示）
      if (S.diag.lon != null) showPoint();
      showArea();
    });
    map.on('click', function (e) {
      if (S.tab === 'diag') { setPoint(String(e.lngLat.lng), String(e.lngLat.lat)); return; }
      if (S.tab === 'map') cellPopup(e.lngLat);
    });
  }
  /* 色を付けたメッシュのうち、隣のメッシュと地区が違う辺だけを線にする（地区の境目） */
  function regionEdges() {
    var at = {}, out = [];
    S.sc.forEach(function (c) { if (c.level != null) at[c.cx + ',' + c.cy] = c.region; });
    S.sc.forEach(function (c) {
      if (c.level == null) return;
      var b = G.cellBounds(c.cx, c.cy);
      [[1, 0, [[b[2], b[1]], [b[2], b[3]]]], [0, 1, [[b[0], b[3]], [b[2], b[3]]]]].forEach(function (d) {
        var o = at[(c.cx + d[0]) + ',' + (c.cy + d[1])];
        if (o != null && o !== c.region) out.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: d[2] } });
      });
    });
    return out;
  }
  /* 地図に地区名と、県警の被害実績（設備1,000件あたり）の順位を重ねる（評価ループ第4回: 色の意味をひと目で）。位置は地区の公開メッシュの中心 */
  function addAreaLabels() {
    var ranked = S.d711.rows.filter(function (r) { return r.rate != null; }).sort(function (a, b) { return b.rate - a.rate; }).map(function (r) { return r.area; });
    S.areaNames.forEach(function (nm, k) {
      var cs = S.sc.filter(function (c) { return c.region === k && c.level != null; });
      if (!cs.length) return;
      var x = cs.reduce(function (a, c) { return a + c.cx; }, 0) / cs.length + 0.5, y = cs.reduce(function (a, c) { return a + c.cy; }, 0) / cs.length + 0.5;
      var b = G.cellBounds(Math.floor(x), Math.floor(y)), fx = x - Math.floor(x), fy = y - Math.floor(y);
      var el = document.createElement('div');
      el.className = 'dlabel';
      el.innerHTML = esc(nm) + ' <small>実績' + (ranked.indexOf(nm) + 1) + '位</small>';
      el.title = '県警の被害実績（設備1,000件あたり、令和7年11月末）の5地区での順位';
      new maplibregl.Marker({ element: el }).setLngLat([b[0] + (b[2] - b[0]) * fx, b[1] + (b[3] - b[1]) * fy]).addTo(map);
    });
  }
  /* 診断で選んだ場所の地区を、地図で枠線で囲む（市町村の境界は持たないので地区の単位） */
  function showArea() {
    if (!mapReady) return;
    var reg = S.res && S.res.region;
    map.setFilter('area-line', ['all', ['>=', ['get', 'band'], 0], ['==', ['get', 'region'], reg ? reg.idx : -9]]);
  }
  function renderMap() {
    if (!mapReady) return;
    map.getSource('cells').setData({ type: 'FeatureCollection', features: cellFeatures() });
  }
  function cellPopup(ll) {
    var m = G.toMesh(ll.lng, ll.lat), idx = -1;
    S.sc.forEach(function (c, i) { if (c.cx === m.cx && c.cy === m.cy) idx = i; });
    var h;
    if (idx < 0) h = '<b>このメッシュは色を付けていません</b><br>設備が少ない（' + S.meta.k_min + '件未満など）か、ないためです。';
    else {
      var c = S.sc[idx], t = c.region >= 0 ? areaOf(S.d711, S.areaNames[c.region]) : null;
      /* 評価ループ第4回: 地区の実績が県平均より上か下かを先に言葉で示し、人の少なさで足した段階は別の行に分ける */
      /* 評価ループ第5回: 「地区の色 → 人口密度で上げた色」を1本の流れで見せる（診断の「地図の色」と同じ値） */
      h = '<b>地区の目安（仮）</b><br>' +
        (t ? '<b>' + esc(t.area) + '</b> ' + bandChip(G.MAP_LEVEL[G.W_REGION * t.tier]) + (c.quiet ? ' → 人が少ない（約' + n0(c.dens) + '人/km²）ので ' + bandChip(c.level) : '') +
          '<br><span class="src">県警の実績 5地区中' + districtRank(t.area) + '位（設備1,000件あたり' + n1(t.rate) + '件、県平均 ' + n1(S.d711.avg) + '）。地区単位の実績で、このメッシュの実績ではない</span>' : '地区 — ' + bandChip(c.level)) +
        '<br><span class="src">設備 ' + n0(c.n) + '件・出力計 約' + mw(c.kw) + ' MW</span>';
    }
    h += '<br><button type="button" class="primary pop-diag">この場所で診断する</button>';
    closePopup();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', offset: 8 }).setLngLat(ll).setHTML(h).addTo(map);
    popup.getElement().querySelector('.pop-diag').addEventListener('click', function () {
      setTab('diag'); setPoint(String(ll.lng), String(ll.lat));
    });
  }
  function closePopup() { if (popup) { popup.remove(); popup = null; } }

  /* ---------- 自己診断 ---------- */
  function segHtml(id, a, opts) {
    return '<div class="seg" role="radiogroup" aria-labelledby="t-' + id + '" data-id="' + id + '">' +
      opts.map(function (o) { return '<button type="button" role="radio" data-v="' + o[0] + '" aria-checked="' + (a === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function bindSeg(root, store) {
    Array.prototype.forEach.call(root.querySelectorAll('.seg'), function (seg) {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.addEventListener('click', function () {
          var on = b.getAttribute('aria-checked') !== 'true';   // 選んでいる方をもう一度押すと「不明」に戻す
          store[seg.getAttribute('data-id')] = on ? b.getAttribute('data-v') : 'unknown';
          Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-checked', String(on && x === b)); });
          renderDiag();
        });
      });
    });
  }
  function clsLabel(id) { var c = S.classes.filter(function (x) { return x.id === id; })[0]; return c ? c.label.replace(/（.*$/, '') : ''; }
  function buildClass() {
    var el = $('ctl-class'); el.innerHTML = '';
    S.classes.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(S.diag.clsPicked && c.id === S.diag.cls)); b.title = c.label;
      var kw = (c.label.match(/（(.*)）/) || [])[1] || '';   // 例: 10〜50kW未満
      b.innerHTML = c.id === 'unknown' ? 'わからない' : esc(clsLabel(c.id)) + '<small>' + esc(kw.replace(/^10〜/, '〜').replace(/未満$/, '')) + '</small>';
      b.addEventListener('click', function () {
        S.diag.cls = c.id; S.diag.clsPicked = true; buildClass(); buildChecklist(); renderDiag();
      });
      el.appendChild(b);
    });
    var sp = S.items.filter(function (it) { return S.diag.cls !== 'unknown' && it.cls.indexOf(S.diag.cls) >= 0; })[0];
    $('cls-note').textContent = sp ? '対策の1件目を' + clsLabel(S.diag.cls) + 'の重点に（色は変わりません）' : '';
  }
  /* 診断の「現場の条件」の質問（本人の回答で決まるもの。対策の回答から導く条件は、対策の回答で決まる） */
  var YN = [['yes', 'はい'], ['no', 'いいえ']];   // どちらも押していなければ「不明」
  function buildConds() {
    var h = '';
    S.risk.conds.filter(function (c) { return c.ask; }).forEach(function (c) {
      var a = S.diag.cond[c.id] || 'unknown';
      h += '<div class="q cd-item"><div class="lab" id="t-' + c.id + '" title="' + esc(c.ask) + '（もう一度押すと「不明」）"><span class="star" title="色に影響">★</span><b>' + esc(c.label) + '</b>' + (c.auto ? '<span class="ask">不明なら人口密度で自動判定</span>' : '') + '</div>' + segHtml(c.id, a, YN) + '</div>';
    });
    $('conds').innerHTML = h;
    bindSeg($('conds'), S.diag.cond);
  }
  function srcLinksRisk(keys) {
    return keys.map(function (k) { var s = S.risk.sources[k]; return s ? link(s.url, s.short || s.name) : esc(k); }).join('、');
  }
  function visibleItems() {
    return S.items.filter(function (it) { return S.diag.cls === 'unknown' || it.cls.indexOf('all') >= 0 || it.cls.indexOf(S.diag.cls) >= 0; });
  }
  function srcLink1(k) { var s = S.ck.sources[k]; return s ? link(s.url, s.short || s.name) : esc(k); }
  function affects() {
    var o = {};
    S.risk.conds.forEach(function (c) { if (c.derive) c.derive.items.forEach(function (id) { o[id] = c.label; }); });
    return o;
  }
  var DONE = [['yes', '実施'], ['no', '未実施']];   // どちらも押していなければ「不明」
  /* 対策: 色に影響する★の項目だけを最初に出し、残りは折りたたむ（評価ループ第2回: 入力を短く） */
  function buildChecklist() {
    var af = affects(), star = '', rest = '', nRest = 0;
    var row = function (it) {
      var a = S.diag.answers[it.id] || 'unknown';
      return '<div class="q cl-item"><div class="lab" id="t-' + it.id + '" title="' + esc(it.text) + '">' + (af[it.id] ? '<span class="star" title="色に影響（' + esc(af[it.id]) + '）">★</span>' : '') + esc(it.short) + '</div>' + segHtml(it.id, a, DONE) + '</div>';
    };
    var vis = visibleItems();
    /* ★の対策は、色に効く条件ごとにまとめる（結果の「あと N 項目で確定」の項目＝条件と対応させる） */
    S.risk.conds.forEach(function (c) {
      if (!c.derive) return;
      var its = vis.filter(function (it) { return c.derive.items.indexOf(it.id) >= 0; });
      if (its.length) star += '<div class="cl-cond">★' + esc(c.label) + '</div>' + its.map(row).join('');
    });
    vis.forEach(function (it) { if (!af[it.id]) { rest += row(it); nRest++; } });
    var open = $('det-rest') && $('det-rest').open;
    $('checklist').innerHTML = '<button type="button" id="btn-allno" class="small">表示中の対策をすべて「未実施」にする</button>' + star +
      '<details id="det-rest"' + (open ? ' open' : '') + '><summary>ほかの対策 ' + nRest + '件（色には影響しません）</summary>' + rest + '</details>' +
      '<p class="note">項目は茨城県警・JPEA（太陽光発電協会）・REASP（再生可能エネルギー長期安定電源推進協会）の資料から。</p>';
    bindSeg($('checklist'), S.diag.answers);
    $('btn-allno').addEventListener('click', function () {
      visibleItems().forEach(function (it) { S.diag.answers[it.id] = 'no'; });
      buildChecklist(); renderDiag();
    });
    clSummary();
  }

  function clSummary() {
    var af = affects(), n = 0, d = 0, g = {};
    visibleItems().forEach(function (it) { if (!af[it.id]) return; n++; g[af[it.id]] = 1; if ((S.diag.answers[it.id] || 'unknown') !== 'unknown') d++; });
    $('cl-sum').textContent = '防犯対策（★' + Object.keys(g).length + '項目に答えると判定が絞られます・回答 ' + d + '/' + n + '）';
  }
  /* 市町村の選択肢（地区のない市町村は無い。県の区分ごと） */
  var KANA = { '日立市': 'ひたち', '常陸太田市': 'ひたちおおた', '高萩市': 'たかはぎ', '北茨城市': 'きたいばらき', '常陸大宮市': 'ひたちおおみや', '大子町': 'だいご',
    '水戸市': 'みと', '笠間市': 'かさま', 'ひたちなか市': 'ひたちなか', '那珂市': 'なか', '小美玉市': 'おみたま', '茨城町': 'いばらき', '大洗町': 'おおあらい', '城里町': 'しろさと', '東海村': 'とうかい',
    '鹿嶋市': 'かしま', '潮来市': 'いたこ', '神栖市': 'かみす', '行方市': 'なめがた', '鉾田市': 'ほこた',
    '土浦市': 'つちうら', '石岡市': 'いしおか', '龍ケ崎市': 'りゅうがさき', '取手市': 'とりで', '牛久市': 'うしく', 'つくば市': 'つくば', '守谷市': 'もりや', '稲敷市': 'いなしき', 'かすみがうら市': 'かすみがうら', 'つくばみらい市': 'つくばみらい', '美浦村': 'みほ', '阿見町': 'あみ', '河内町': 'かわち', '利根町': 'とね',
    '古河市': 'こが', '結城市': 'ゆうき', '下妻市': 'しもつま', '常総市': 'じょうそう', '筑西市': 'ちくせい', '坂東市': 'ばんどう', '桜川市': 'さくらがわ', '八千代町': 'やちよ', '五霞町': 'ごか', '境町': 'さかい' };
  /* 市町村の選択肢（五十音順。読みの頭の行で区切る） */
  function buildMuniSelect() {
    var sel = $('in-muni'), names = [], g = null, last = '';
    S.areaNames.forEach(function (a) { names = names.concat(S.regions[a] || []); });
    var kana = function (nm) { return KANA[nm] || nm; };
    var ROWS = 'あかさたなはまやらわ', BASE = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ';
    var rowOf = function (k) { var c = k.charAt(0).normalize('NFD').charAt(0), i = BASE.indexOf(c); return i < 0 ? '他' : (i < 35 ? ROWS.charAt(Math.floor(i / 5)) : i < 38 ? 'や' : i < 43 ? 'ら' : 'わ'); };
    names.sort(function (x, y) { return kana(x).localeCompare(kana(y), 'ja'); }).forEach(function (nm) {
      var r = rowOf(kana(nm));
      if (r !== last) { g = document.createElement('optgroup'); g.label = r + '行'; sel.appendChild(g); last = r; }
      var o = document.createElement('option'); o.value = nm; o.textContent = nm; g.appendChild(o);
    });
  }
  function setMuni(name) {
    var m = S.ms.filter(function (x) { return x.name === name; })[0];
    if (!m) return;
    S.diag.lon = null; S.diag.lat = null; S.diag.muni = name;
    $('in-lat').value = ''; $('in-lon').value = '';
    if (marker) { marker.remove(); marker = null; }
    if (mapReady) map.getSource('mine').setData({ type: 'FeatureCollection', features: [] });
    closePopup();
    $('pos-msg').textContent = name + 'で診断します（市町村の単位）。'; $('pos-msg').className = 'note';
    renderDiag();
  }

  /* lonS, latS: 文字列（入力欄の値、または地図クリックの数値を文字列にしたもの）。入力しても地図は動かさない（表示範囲が地理院に伝わるため） */
  function setPoint(lonS, latS) {
    var msg = $('pos-msg'), lon = G.parseCoord(lonS), lat = G.parseCoord(latS);
    if (lon == null || lat == null) { msg.textContent = '緯度・経度を数字で入れてください（例: 緯度36.34、経度140.45。「36,34」のカンマは使えません）。'; msg.className = 'note warn'; return; }
    var m = G.toMesh(lon, lat);
    if (!S.land || !S.land(m.ix, m.iy)) {
      msg.textContent = 'この位置は茨城県の範囲の外です（海上・他県を含む）。茨城県内の位置を入れてください。'; msg.className = 'note warn'; return;
    }
    S.diag.lon = lon; S.diag.lat = lat; S.diag.muni = null; $('in-muni').value = '';
    $('in-lat').value = lat.toFixed(4); $('in-lon').value = lon.toFixed(4);
    msg.textContent = '地図の位置で診断します（約5km四方の単位。この端末の中だけで使用）'; msg.className = 'note';
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
    S.diag = { lon: null, lat: null, muni: null, cls: 'unknown', clsPicked: false, answers: {}, cond: {} };
    $('in-lat').value = ''; $('in-lon').value = ''; $('in-muni').value = ''; $('pos-msg').textContent = ''; $('pos-msg').className = 'note';
    if (marker) { marker.remove(); marker = null; }
    if (mapReady) map.getSource('mine').setData({ type: 'FeatureCollection', features: [] });
    buildClass(); buildConds(); buildChecklist(); renderDiag();
  }

  /* スマホ: 結果のカードが画面の外にある間、上端に色とまず取る対策1つを出す */
  function initMini() {
    var el = document.createElement('div');
    el.id = 'diag-mini'; el.setAttribute('aria-hidden', 'true');
    $('pane-diag').insertBefore(el, $('pane-diag').firstChild);
    el.addEventListener('click', function () { $('box-result').scrollIntoView({ block: 'start' }); });
    if (typeof IntersectionObserver === 'undefined') return;
    /* 結果のカードの上端が画面の外に出たら帯を出す（カードを最初に置いたので、少しでも上に流れたら出す） */
    new IntersectionObserver(function (es) { var e = es[0]; document.body.classList.toggle('res-off', !e.isIntersecting || e.boundingClientRect.top < -20); }, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }).observe($('box-result'));
  }

  var STATE_TXT = { risk: '当てはまる', ok: '当てはまらない', unknown: 'わからない' };
  var BY_TXT = { answer: '回答', derived: '対策の回答から', auto: '人口密度から自動', none: '' };
  var WHY_TXT = { flyer: '県警チラシの3つの対策の1つ', other: '資料が挙げる対策' };
  /* 対策ごとの手口・ねらい（1行）。checklist.json の項目説明と risk.json の条件の説明（いずれも出典付き）から短くしたもの */
  var HOW = { pipes_buried: '転がし配線は盗難リスクが高い（県警）', collector_cover: '露出したケーブルはそこから切断される（県警）', fix_cable: 'ケーブルを引き抜かれにくくする',
    aluminum: 'アルミの価値は銅の1/4程度（県警）', fence_sensor: '犯人は防犯対策のないケーブルを狙う（県警）', machine_security: '犯人は防犯対策のないケーブルを狙う（県警）',
    camera: '下見で防犯の弱さを確かめる例が増えた（JPEA・REASP）', alarm: '犯人を威嚇し、周囲に異常を知らせる', light: '夜間の犯行（JPEA・REASP）に照明で備える',
    weed_fence: '手入れが悪いと管理されていないように見える（県警）', patrol: '保守点検が不十分に見える設備が狙われる（JPEA・REASP）', notice: '防犯していることを外に示す',
    tel110: '不審者を見かけたら110番（県警）', pole_barrier: '低圧の分割設置では大量盗難の例（JPEA・REASP）', pcs_conduit: '犯行に時間をかけさせ、駆けつける（JPEA・REASP）', hotspot: 'エリアが広く、重点の見極めが要る（JPEA・REASP）' };
  function prioReason(p, prev) {
    if (p.why === 'hit') return prev && prev.why === 'hit' && prev.cond === p.cond ? '同上' : 'あなたの条件「' + esc(p.cond) + '」への対策';
    if (p.why === 'class') return esc(clsLabel(S.diag.cls)) + 'の重点箇所';
    if (p.why === 'unknown') return '色に効く「' + esc(p.cond) + '」に関わる';
    return WHY_TXT[p.why];
  }
  /* 出典は1項目に1つ（資料の短い名前をリンクにする。正式名は title） */
  var SRC_SHORT = { IBF: '県警チラシ「3つの対策」', JPEA: 'JPEA・REASP 2024年資料', KM4: '県警 Metal News 令和8年第4号', KM10: '県警 Metal News 令和8年第10号', IBP: '県警「金属盗難に注意！」' };
  function prioSrc(p) {
    var k = p.why === 'flyer' ? 'IBF' : (p.why === 'class' || p.why === 'hit') && p.item.src.indexOf('JPEA') >= 0 ? 'JPEA' : p.item.src[0], s = S.ck.sources[k];
    return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="' + esc(s.name) + '">' + esc(SRC_SHORT[k] || s.short) + '</a>';
  }
  /* 県警の被害実績（設備1,000件あたり、令和7年11月末）の5地区での順位 */
  function districtRank(name) {
    var ranked = S.d711.rows.filter(function (r) { return r.rate != null; }).sort(function (a, b) { return b.rate - a.rate; }).map(function (r) { return r.area; });
    return ranked.indexOf(name) + 1;
  }
  /* 結果のカードのリンク: 押すと該当の欄を開いて、そこへ移る（タブは切り替えない） */
  function bindOpeners(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () {
        var t = $(b.getAttribute('data-open'));
        if (!t) return;
        if (t.tagName === 'DETAILS') t.open = true;
        if (t.id === 'det-cl') $('box-cond').open = true;
        t.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }
  function answered() {
    var a = S.diag.answers, c = S.diag.cond, k;
    for (k in a) if (a[k] !== 'unknown') return true;
    for (k in c) if (c[k] !== 'unknown') return true;
    return false;
  }
  /* 結果のカード: 色1つ（大きく）・場所と理由1行・まず取る対策3件。地図の色との違いと優先の基準は「？」の中（評価ループ第3回: 文字量を減らす） */
  function renderDiag() {
    var el = $('diag-result');
    if (!S.items.length) return;
    var items = visibleItems();
    var hasLoc = S.diag.lon != null || S.diag.muni;
    var mu = S.diag.muni ? S.ms.filter(function (x) { return x.name === S.diag.muni; })[0] : null;
    var r = null;
    if (hasLoc) r = G.diagnose({ lon: S.diag.lon, lat: S.diag.lat, muni: mu ? { region: mu.region, quiet: mu.quiet } : null, cls: S.diag.cls, answers: S.diag.answers, cond: S.diag.cond }, { cells: S.cells, pops: S.pops, items: S.items, conds: S.risk.conds, tiers: S.tiers, regionNames: S.areaNames });
    S.res = r;
    showArea();
    var cres = r ? r.conds : G.evalConds(S.risk.conds, S.diag.cond, S.diag.answers, null);
    var pr = G.priorities(items, S.diag.answers, S.risk.conds, cres, S.diag.cls);
    var reg = r && r.region, rt = reg ? areaOf(S.d711, reg.name) : null;
    var h = '', mini = '';
    var mapLv = null;
    if (!r) {
      h += '<p class="lv">あなたの設備: <span class="band" style="background:#fff">？</span> <span class="lvsub">市町村か地図で場所を選ぶと色と理由が出ます</span></p>';
      mini = '場所を選ぶと色が出ます';
    } else {
      var hits = S.risk.conds.filter(function (c, i) { return r.conds[i].state === 'risk'; }).map(function (c) { return c.label; });
      var unk = S.risk.conds.filter(function (c, i) { return r.conds[i].state === 'unknown'; }).map(function (c) { return c.label; });
      mapLv = mu ? mu.band : (function () { var x = S.sc.filter(function (c) { return c.cx === r.mesh.cx && c.cy === r.mesh.cy; })[0]; return x ? x.level : null; })();
      var fixed = r.levelMax === r.levelMin;
      /* 評価ループ第5回: 未確定の間は常に幅（下限〜上限）で出し、「未回答のため幅あり」と添える */
      var lv = fixed ? bandChip(r.levelMin) : bandChip(r.levelMin) + '〜' + bandChip(r.levelMax);
      var left = fixed ? '<span class="lvsub"><b>確定</b></span>' : '<span class="left">' + (reg ? '未回答のため幅あり' : '地区が不明のため幅あり') + '</span>';
      h += '<p class="lv">あなたの設備: ' + lv + ' ' + left + '</p>';
      mini = 'あなたの設備: ' + lv + (fixed ? ' 確定' : reg ? ' あと' + unk.length + '項目' : '');
      /* 理由は1行: 地区の実績の順位（短い事実）＋当てはまる条件（2件まで名前） */
      var regTxt = reg ? esc(reg.name) + '（県警の実績 5地区中' + districtRank(reg.name) + '位' + (reg.near ? '・近くで代用' : '') + '）' : '地区不明';
      var hitTxt = hits.length ? '＋「' + esc(hits.slice(0, 2).join('」「')) + '」' + (hits.length > 2 ? 'ほか' + (hits.length - 2) + '件' : '') : '';
      h += '<p class="why1"><b>理由</b>: ' + regTxt + hitTxt + ' <button type="button" class="linkbtn" data-open="box-detail">内訳</button></p>';
      if (!fixed && reg) {
        var uA = S.risk.conds.filter(function (c, i) { return !c.derive && r.conds[i].state === 'unknown'; }).length, uD = unk.length - uA;
        /* 何に答えると何が変わるかを1文で（評価ループ第5回） */
        h += '<p class="next">あと' + unk.length + '項目で確定: ' +
          (uA ? '<button type="button" class="linkbtn" data-open="box-cond">立地★' + uA + '問</button>' : '') + (uA && uD ? '・' : '') +
          (uD ? '<button type="button" class="linkbtn" data-open="det-cl">防犯対策★' + uD + '項目</button>' : '') +
          'に答えると「' + BAND_LABELS[r.levelMax] + '」まで判定</p>';
      }
    }
    h += '<h3>まず取る対策' + (S.diag.cls === 'unknown' ? ' <span class="lvsub">（区分を選ぶと順番が変わります）</span>' : '') + '</h3>';
    if (!pr.length) h += '<p class="note dark">挙げた対策はすべて「実施」です。ただし資料は「完全に防ぐ方法があるわけではない」としています（JPEA・REASP p.9）。</p>';
    else {
      var pick = pr.slice(0, 3);
      h += '<ol class="top3">' + pick.map(function (p, i) {
        var why = p.why === 'flyer' && HOW[p.item.id] ? esc(HOW[p.item.id]) : prioReason(p, pick[i - 1]);
        return '<li><b>' + esc(p.item.short) + '</b>' + (p.answer === 'no' ? '<span class="tagno">未実施</span>' : '') + ' <span class="why">— ' + why + '［' + prioSrc(p) + '］</span></li>';
      }).join('') + '</ol>';
      mini += '｜まず: ' + esc(pr[0].item.short);
    }
    /* 注記は1つの折りたたみにまとめる（地図の色との違い・推測・優先の基準） */
    h += '<details class="more"><summary>この判定の前提（仮・予測ではない）</summary>' +
      (r ? '<p>地図の色 ' + bandChip(mapLv) + ' は地区の目安（県警の地区単位の実績を市町村に当てはめた推測＋人口密度）。判定は、それにあなたの設備の条件を足したもの。</p>' : '') +
      '<p>優先の基準: 当てはまる条件→区分の重点→県警チラシ（仮。効果の比較ではない）。</p></details>';
    el.innerHTML = h;
    bindOpeners(el);
    $('diag-mini').innerHTML = mini;
    clSummary();
    renderDetail(r, rt);
  }
  /* 折りたたみの中身: 点数の内訳・条件ごとの理由と出典・周囲の目安 */
  function renderDetail(r, rt) {
    var el = $('diag-detail');
    if (!r) { el.innerHTML = '<p class="note">場所を選ぶと、色の内訳が出ます。</p>'; return; }
    var reg = r.region;
    /* 評価ループ第5回: 内訳は1行（地区の点＋条件の点＝点数（色））。切り方・地区の根拠は下の折りたたみ */
    var h = '<p class="sum1"><b>この設備のリスク（仮）</b>: 地区 ' + (reg ? G.W_REGION * reg.tier : 0) + '点＋条件 ' + r.riskCount + '点＝' + r.scoreMin + '点（' + BAND_LABELS[r.levelMin] + '）' + (r.unknownCount ? '<span class="lvsub">　わからない' + r.unknownCount + '件が当てはまると' + r.scoreMax + '点</span>' : '') + '</p>' +
      '<details class="more"><summary>切り方と地区の根拠</summary><p class="note dark">0〜3点＝低、4〜6点＝中、7〜8点＝やや高、9点以上＝高（仮の切り方）。</p>' +
      '<p class="note dark"><b>地区</b>: ' + (reg ? esc(reg.name) + (reg.near ? '（近くの公開メッシュの地区で代用。推測）' : '（県の区分で推測）') + '。県警の令和7年11月末の件数は設備1,000件あたり' + n1(rt.rate) + '件（県全体 ' + n1(S.d711.avg) + '件）で段階' + reg.tier + '（' + link(S.reality.areas711.url, 'Metal News 令和7年第12号') + '）' : '近くに公開メッシュがなく不明（下限は0点、上限は4点を足す）') + '</p></details>';
    /* 評価ループ第4回: 当てはまる条件だけを表に（「詳しく」は閉じる）。わからない・当てはまらない条件は1行ずつにまとめ、条件名を出典へのリンクにする */
    var idx = S.risk.conds.map(function (c, i) { return i; });
    var of = function (st) { return idx.filter(function (i) { return r.conds[i].state === st; }); };
    var srcA = function (i) { var c = S.risk.conds[i], s = S.risk.sources[c.src[0]]; return s ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="出典: ' + esc(s.name) + '">' + esc(c.label) + '</a>' : esc(c.label); };
    var line = function (st, t) { var v = of(st); return v.length ? '<p class="cond1"><span class="st st-' + st + '">' + t + '</span>: ' + v.map(srcA).join('・') + '</p>' : ''; };
    var hit = of('risk');
    h += hit.length ? '<div class="scroll"><table class="cards cond"><tr><th class="l">当てはまる条件</th><th class="l">なぜ・出典</th></tr>' + hit.map(function (i) {
      var c = S.risk.conds[i], e = r.conds[i];
      return '<tr><td class="l" data-label="条件">' + esc(c.label) + (BY_TXT[e.by] ? '<div class="by">' + BY_TXT[e.by] + '</div>' : '') + '</td><td class="l why" data-label="なぜ・出典">' + esc(c.short) + '［' + srcLinksRisk(c.src) + '］<details><summary>詳しく</summary>' + esc(c.why) + '</details></td></tr>';
    }).join('') + '</table></div>' : '<p class="cond1">当てはまる条件はありません。</p>';
    h += line('unknown', 'わからない') + line('ok', '当てはまらない');
    h += '<h3>周囲の目安（公開データの集計。被害の予測ではありません）</h3><ul class="note dark">';
    if (r.byMuni) h += '<li>市町村の単位で診断（位置は使いません）。周囲の人の少なさ: 市町村の人口密度が県内の低い方から1/3' + (r.autoQuiet ? 'に入る（人目が少ない側）' : 'には入らない') + '。</li>';
    else h += '<li>約5kmメッシュ（基準メッシュ ' + esc(r.code) + '）の人口 約' + n0(r.cellPopulation) + '人（約' + n0(r.cellDensity) + '人/km²、2020年国勢調査）。周囲の人の少なさ: 県内の低い方から1/3' + (r.autoQuiet ? 'に入る（人目が少ない側）' : 'には入らない') + '。</li>' +
      '<li>このメッシュの認定設備: ' + (r.cellVisible ? r.cell.n + '件・出力計約' + mw(r.cell.kw) + ' MW' : '少ないか無いため表示しません') + '。</li>';
    h += '</ul><p class="note">規模（出力）は点数に使いません（資料で向きが食い違うため。両論は地図の「色の根拠」）。不審者を見かけた・被害に遭ったときは110番または最寄りの警察署へ。</p>';
    el.innerHTML = h;
    labelCells(el);
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
    /* 最初は推移の図だけ。ほかの件数・照合・法令は折りたたむ（評価ループ第2回: 文字量を減らす） */
    h += '<details class="box" id="det-reality"><summary>詳しい件数（太陽光・県内5地区）・リスクの色との照合・法令</summary>';
    var mxs = Math.max.apply(null, so.rows.map(function (r) { return r.metal; }));
    h += '<div class="box"><h2>' + esc(so.title) + '</h2><h3>金属盗の件数</h3>' + bars(so.rows.map(function (r) { return { label: r.label, v: r.metal }; }), 'v', 'b', mxs) +
      '<h3>うち太陽光発電施設</h3>' + bars(so.rows.map(function (r) { return { label: r.label, v: r.solar }; }), 'v', '', mxs) +
      '<p class="note">' + esc(so.note) + '<br>出典: ' + link(so.url, so.source) + '</p></div>';
    var a7 = R.areas711, mx7 = Math.max.apply(null, a7.rows.map(function (r) { return r.n; }));
    h += '<div class="box"><h2>' + esc(a7.title) + '（リスクの色の主な根拠）</h2>' + bars(a7.rows.map(function (r) { return { label: r.area, v: r.n }; }), 'v', '', mx7) +
      '<p class="note">' + esc(a7.note) + '<br>出典: ' + link(a7.url, a7.source) + '</p></div>';
    h += '<div class="box"><h2>' + esc(R.nation.title) + '</h2><p style="font-size:13px;margin:6px 0">' + esc(R.nation.text) + '<br><span class="src">出典: ' + link(R.nation.url, R.nation.source) + '</span></p>' +
      '<h3 style="margin-top:10px">法・条例</h3><p style="font-size:13px;margin:6px 0">' + esc(R.law.text) + '<br><span class="src">出典: ' + link(R.law.url, R.law.source) + '</span></p></div>';
    var mxa = Math.max.apply(null, ar.rows.map(function (r) { return r.n; }));
    h += '<div class="box"><h2>' + esc(ar.title) + '</h2>' + bars(ar.rows.map(function (r) { return { label: r.area + '（' + r.example + '）', v: r.n }; }), 'v', '', mxa) +
      '<p class="note">' + esc(ar.note) + '<br>出典: ' + link(ar.url, ar.source) + '</p></div>';
    h += '<div class="box"><h2>県警の被害実績と、リスクの色の照合</h2><div id="dist-compare2"></div></div>';
    h += '<div class="box"><h2>なぜ個別の設備を公開しないのか、被害の影響</h2>' + R.why.map(function (w) { return '<p style="font-size:13px;margin:6px 0">' + esc(w.text) + '<br><span class="src">出典: ' + link(w.url, w.src) + '</span></p>'; }).join('') + '</div></details>';
    $('reality').innerHTML = h;
  }

  /* ---------- 出典・前提・限界 ---------- */
  function buildAbout() {
    var m = S.meta, st = m.stats;
    var h = '<div class="about box">' +
      '<h2>このアプリが何で、何でないか</h2><ul>' +
      '<li>茨城県の太陽光発電設備の<b>集計</b>（約5kmメッシュ・市町村）と、県警の地区別の被害実績から、リスクの色（仮の規則）を出す静的Webアプリ（デモ）。サーバーは使いません。</li>' +
      '<li>被害の予測、個別設備の順位・一覧、「狙われやすい設備」の特定はしません。認定情報には防犯設備も被害の履歴もありません。</li>' +
      '<li><b>リスクの色（低・中・やや高・高）は、地区の実績（県警の設備あたり件数）を主な根拠にした仮の規則</b>で、被害の予測ではありません。地区の段階は令和7年11月末の実績から作ったため、同じ期間との並びが合うのは当然で、独立の検証ではありません。別の期間（令和8年9月末）との並び、人目の少なさが地区間で実績と逆向きであることは「公開の集計地図」の照合表に出しています。5地区の対応づけは推測で、比べられるのは5点だけです。</li>' +
      '<li>個々の発電所の色分けは、公開の地図には出さず、事業者が自分の設備を入れる自己診断の中で、その端末のブラウザ内だけで行います。</li></ul>' +
      '<h2>使ったデータ</h2><table><tr><th class="l">データ</th><th class="l">提供者・時点</th><th class="l">使い方・件数</th><th class="l">利用条件</th></tr>' +
      '<tr><td class="l">事業計画認定情報（茨城県ファイル）</td><td class="l">資源エネルギー庁 再エネ電子申請サイト、' + esc(m.as_of) + '時点、取得 ' + esc(m.retrieved) + '<br>' + link(m.plants_url, m.plants_url) + '</td><td class="l">太陽光 ' + n0(st.rows) + '件のうち、運転開始報告済みの' + n0(st.counted) + '件（運転開始前' + n0(st.not_started) + '件を除く）を、町字名で小地域に対応づけて集計。出力は「発電出力（kW）」を使用。' + n0(st.placed) + '件を集計メッシュに入れ、' + n0(st.unplaced) + '件は市町村の集計のみ。事業者名・代表者名・事業者住所・電話・設備IDは取り込まない。</td><td class="l">' + link(m.terms_url, '利用ルール') + '（商用可、出典記載・加工の明記、国が作成したかのような公表の禁止）。禁止事項（イ）に「国家・国民の安全に脅威を与える利用」があるが定義・例示はなく、この用途が当たるかは<b>未確認</b>（管理者は資源エネルギー庁。確認は未実施）。</td></tr>' +
      '<tr><td class="l">小地域（町丁・字等）境界の属性表</td><td class="l">総務省統計局 e-Stat、国勢調査2020</td><td class="l">町字名と代表点・人口・面積。住所の町字名との照合に使う（' + n0(st.placed_exact) + '件は町字名が一致、' + n0(st.placed_ohaza) + '件は大字名で始まる小地域の代表点の平均）。町字の面積は中央値' + st.town_area_km2_median + 'km²、90%点' + st.town_area_km2_p90 + 'km²で、1kmより粗い。</td><td class="l">' + link(m.estat_terms, 'e-Stat 利用規約') + '（出典の表示、加工の明記。政府標準利用規約2.0準拠と情報部が確認）</td></tr>' +
      '<tr><td class="l">地域メッシュ統計（人口）</td><td class="l">総務省統計局 e-Stat、国勢調査2020、基準地域メッシュ（約1km）</td><td class="l">人口密度の計算と、診断の周囲の人口。人数が少ないメッシュは「*」で近隣に合算されるため、0として扱う（合算先に含まれる）。</td><td class="l">同上</td></tr>' +
      '<tr><td class="l">対策の項目・盗難の実態</td><td class="l">茨城県警察、JPEA・REASP（画面の各項目に出典）</td><td class="l">チェックリストと実態の件数。令和8年は暫定値。</td><td class="l">各サイトの利用条件に従い、数値と短い要約のみ掲載</td></tr>' +
      '<tr><td class="l">背景地図</td><td class="l">地理院タイル（淡色地図）</td><td class="l">地図の背景のみ。地理院の住所検索APIは使っていない</td><td class="l">国土地理院の利用規約</td></tr>' +
      '<tr><td class="l">描画</td><td class="l">MapLibre GL JS 4.7.1</td><td class="l"></td><td class="l">BSD-3-Clause</td></tr></table>' +
      '<p class="note">本アプリは、再エネ電子申請サイトの認定情報と、総務省統計局 e-Stat の国勢調査データを加工して作成した。国（資源エネルギー庁・総務省統計局）が作成したものではない。</p>' +
      '<h2>色分けの規則と、前回までの指標の見直し</h2><ul><li>点数 ＝ 2 × 地区の段階（0〜2） ＋ 人目の少なさ（0か1）。0＝低、1〜2＝中、3〜4＝やや高、5＝高。地区の段階は、県警の令和7年11月末の太陽光の件数を設備数で割った値が、県全体の値以上なら2、' + G.TIER_MID + '以上なら1、未満は0。人目の少なさは、2020年国勢調査の人口密度が県内の同じ単位の低い方から1/3なら1。<b>切り方・点数の配分に公的な根拠はなく、すべて仮</b>です。定義と根拠は「公開の集計地図」の「色分けの規則」。</li>' +
      '<li><b>前回までの版</b>は、設備1件あたりの出力・低圧割合・人の少なさを、利用者が重みを変えられる3つの指標にしていました。県警の5地区別の被害（設備1,000件あたり）と並べると逆向き（順位相関−0.60、最初の版は−0.90）で、「目安は実績と逆」と開示していました。2026-11-21 に、盗難の統計と盗まれやすい条件を情報部が調べ直した結果（reports/intel/ichibiz-2026-solar-theft-risk-factors-20261121.md）に基づき、実績を主な根拠にする規則に作り直しました。重みの調整は廃止しました（実績に合わせて重みを選ぶことになるため）。</li>' +
      '<li>規模（出力）は、JPEA・REASPのアンケートと茨城県警で向きが食い違うため点数に使わず、両論を載せています。「逃げやすさ」（IC・幹線道路）は距離の根拠がなく、国土数値情報の道路データの利用条件も確認していないので使っていません。防犯設備・ケーブルの種類・巡回は公開データで再現できないので、自己診断で本人に尋ねます。</li>' +
      '<li>相対位置ではなく実績の地区差が主なので、「県内が全体として安全・危険」という意味はありません。的中率などの検証はしていません。</li></ul>' +
      '<h2>悪用を防ぐ設計</h2><ul>' +
      '<li>犯人は事前に下見をする（JPEA・REASP p.9、茨城県警）。そのため、個別設備の位置・順位・一覧は作らない。公開データから取り込む設備の行は、ビルド時に集計して捨て、画面・書き出しのデータには残らない。</li>' +
      '<li>公開は約5kmメッシュと市町村の集計のみ。メッシュ・市町村のリスクの色は4段階（低・中・やや高・高）で、地区の段階と人口密度だけから決まる単純な規則なので、元の公開データから誰でも再現できる（新しい手がかりは足さない）。連続のスコアや順位の列は出さない。個々の発電所のリスクの色は、公開の地図・CSV・公開データには出さず、事業者が自分の設備を入れる自己診断の結果としてだけ、その端末のブラウザの中で出す。公開する集計値の粒度は、今の形で決定済み。資源エネルギー庁が条件を付ければ従う。</li>' +
      '<li>設備が' + m.k_min + '件未満のメッシュ・市町村は、件数・容量・指標を出力しない。さらに、設備が' + m.dom_n + '件未満のメッシュは、50kW以上の設備が1件以下なら隠す（件数・出力計・50kW未満の件数から、その1件の出力が狭い幅で割り出せるため）。設備が'+m.dom_n+'件以上でも1件の大きな設備が出力計の大半を占めるメッシュは残る（対策していない。元の認定情報が出力まで公開しているため新たに漏れる情報はほぼないが、しきい値に統計的な根拠はない）。出力計は' + m.kw_round + 'kW単位に丸めて出す。' + n0(st.cells_hidden) + 'メッシュ（設備計' + n0(st.plants_in_hidden_cells) + '件）を隠している。しきい値は小さい集計を隠すための最小限の目安で、統計的な匿名性を保証するものではない。市町村の合計とメッシュの合計の差から、隠したメッシュの合計は推定できる。</li>' +
      '<li>事業者の自己診断は、入力をブラウザの中で計算し、送信も保存もしない。診断の位置は約5kmメッシュの単位でだけ使う（人口もこの単位）。座標を入力しても地図は動かさず、地図の拡大も縮尺11（約16km四方のタイル）までに制限する。ただし地図を動かして見ている範囲の地図画像は、地理院が受け取るので、見ている範囲は地理院に伝わる。茨城県の外・海上の座標は受け付けない。</li>' +
      '<li>盗難の実態は、警察が公表している粒度（全国・県・県内5地区）にとどめた。</li>' +
      '<li>国は盗難防止の情報を、太陽光発電設備を設置する者など盗難に遭うおそれが大きい者に周知する形（盗難特定金属製物品の処分の防止等に関する法律 第16条。情報部の確認）を取っている。当事者が自分で使う診断はこの趣旨に沿う、というのが設計の考え方である（推測）。ただし元データの認定情報は地番まで公開されており、このアプリの秘匿は「他人に見つけられなくする」ものではなく、「元データ以上の手がかり（手薄さの順位）を足さない」ためのもの。</li></ul>' +
      '<h2>限界・要確認</h2><ul>' +
      '<li><b>認定情報の利用ルールの禁止事項（イ）「国家・国民の安全に脅威を与える利用」に、この用途が当たるかは未確認。</b>利用ルール（再エネ電子申請サイト「ご利用上の注意」）の管理者は資源エネルギー庁で、禁止事項に定義・例示はない。資源エネルギー庁への確認は未実施（同庁への問い合わせは電話のみ、期限 12/02）。リポジトリは公開済みで集計データは閲覧できるが、確認が取れるまで、既定ブランチへの統合・デモ公開・応募はしない。出すならアイデア部門（12/10）のみ。</li>' +
      '<li>県警の5地区が茨城県の地域区分（県北・県央・鹿行・県南・県西）と同じ市町村の範囲かは誌面に記載がなく、地区別の設備数との対応は推測。被害は令和7年11月末・令和8年9月末の暫定値（期間は1年に満たない）で、累計かは誌面に明記がない（5地区の合計が県の太陽光の件数に一致するので、累計と読める。推測）。</li>' +
      '<li>県南・県西は千葉・埼玉に近く、アクセスや逃げやすさが効いている可能性があるが、検証していない（推測）。人目の少なさ（人口密度）は、地区どうしでは県警の被害率と逆向きだった。</li>' +
      '<li>出力20kW未満の太陽光は元データに含まれない。JPEA・REASPの資料では事業用の認定件数の94.6%が10〜50kW未満（2024年3月末）なので、小規模設備の一部は集計に入らない。</li>' +
      '<li>認定情報には失効した認定を含みうる。複数地番の設備は代表地番のみ。</li>' +
      '<li>位置は町字の代表点。町字の面積の中央値は' + st.town_area_km2_median + 'km²で、広い大字の設備は実際と別のメッシュに数えられることがある。約5kmメッシュにしたのはこのため。住所の町字が小地域名と一致しない' + n0(st.unplaced) + '件（' + n1(st.unplaced / st.counted * 100) + '%）は市町村の集計のみ。</li>' +
      '<li>人口は常住人口（2020年）で、夜間・休日の人通り、見通し、道路・側道の有無、防犯設備は反映しない。海に面したメッシュは海の面積を含むため人口密度が低く出る。県境のメッシュは隣の県の人口を含み、設備は茨城県だけを数える。</li>' +
      '<li>全国・県の件数と、本アプリの設備数は別の粒度で、設備単位・メッシュ単位の被害実績との突き合わせはしていない（公開データにその粒度がない）。</li>' +
      '<li>e-Statの利用条件は情報部の確認（政府標準利用規約2.0準拠）による。公開前に最新の条件を確認すること。</li></ul>';
    /* 評価ループ第5回: 最初は結論3行だけ。各見出しは折りたたみにする（本文は変えない） */
    var parts = h.split('<h2>');
    h = parts[0] + '<ul class="concl"><li><b>何か</b>: 認定情報の集計と県警の地区別の被害件数から作った盗難リスクの目安（仮）。被害の予測ではありません。</li>' +
      '<li><b>出典</b>: 資源エネルギー庁 再エネ認定情報・e-Stat 国勢調査2020・茨城県警察・地理院タイルを編集・加工して作成（国の作成ではありません）。</li>' +
      '<li><b>限界</b>: 切り方に公的な根拠はなく未検証。5地区と市町村の対応は推測。認定情報の利用ルール禁止事項（イ）に当たるかは未確認。</li></ul>' +
      parts.slice(1).map(function (p) { var i = p.indexOf('</h2>'); return '<details class="sec"><summary>' + p.slice(0, i) + '</summary>' + p.slice(i + 5) + '</details>'; }).join('') + '</div>';
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
    var m = S.meta, rows = [];
    rows.push(['# 太陽光発電所の盗難対策マップ（デモ・茨城県）の集計。個別設備は含みません。被害の予測ではなく、公開情報から作ったリスクの色（仮の規則）です。']);
    rows.push(['# 出典', m.plants_source + '（' + m.as_of + '時点、取得' + m.retrieved + '）を加工して作成。' + m.boundary_source + '。' + m.mesh_source + '。国が作成したものではありません。']);
    rows.push(['# 前提', '約5kmメッシュ（1kmメッシュ×5）。設備が' + m.k_min + '件未満のメッシュ・市町村は出力しません。位置は町字の代表点（広い大字ではずれます）。出力20kW未満は元データにありません。']);
    rows.push(['# 色の規則（仮）', '点数＝2×地区の段階（0〜2）＋人目の少なさ（0か1）。0＝低、1〜2＝中、3〜4＝やや高、5＝高。地区の段階は、県警の令和7年11月末の太陽光の件数÷地区の設備数（設備1,000件あたり）が、県全体の値以上なら2、' + G.TIER_MID + '以上なら1、未満は0。人目の少なさは、人口密度が県内の同じ単位の低い方から1/3なら1。連続のスコア・順位の列は出しません（元の集計値は含むので、並べ替えれば同じような並びは作れます）']);
    rows.push(['# 注意', '色の主な根拠は県警の5地区別の件数で、5地区と市町村の対応は推測です。地区の段階は令和7年11月末の実績から作ったので、同じ期間と合うのは当然で、独立の検証ではありません。人目の少なさは地区どうしでは実績と逆向きでした。規模（出力）は色に使っていません。出力計は' + m.kw_round + 'kW単位に丸めています。設備が少なく大きな設備の出力が推測できるメッシュも出力しません。']);
    rows.push([]);
    rows.push(['メッシュ別']);
    rows.push(['南西角の基準メッシュコード', '設備数', '出力計(kW、丸め)', '50kW未満の設備数', '人口(2020国勢調査)', '人口密度(人/km2)', '地区（推測）', 'リスクの色（仮）']);
    S.sc.forEach(function (c) {
      rows.push([G.meshCode(c.cx * G.CELL, c.cy * G.CELL), c.n, c.kw, c.small, c.pop, Math.round(c.dens), c.region >= 0 ? S.areaNames[c.region] : '', c.level == null ? '' : BAND_LABELS[c.level]]);
    });
    rows.push([]);
    rows.push(['市町村別']);
    rows.push(['市町村', '設備数', '出力計(kW)', '50kW未満の設備数', '人口(2020国勢調査)', '面積(km2)', '人口密度(人/km2)', '地区（推測）', 'リスクの色（仮）']);
    S.ms.forEach(function (x) {
      rows.push([x.name, x.hidden ? '' : x.n, x.hidden ? '' : x.kw, x.hidden ? '' : x.small, x.pop, x.area, Math.round(x.dens), x.region >= 0 ? S.areaNames[x.region] : '', x.level == null ? '' : BAND_LABELS[x.level]]);
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
