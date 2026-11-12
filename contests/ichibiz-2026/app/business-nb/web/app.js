/* 回収圏計画（デモ）: 画面制御。計算は lib.js（Nb）、データは data/（build_data.py の生成物）。 */
(function () {
  'use strict';
  var N = window.Nb;
  var BASES = [
    { id: 'fit', label: '調達期間の終了時（最も早い置き方）', basis: { type: 'fit' }, text: '調達期間（FIT）の終了年月はデータの列にある。終了時点で撤去する最も早い場合を置く。実際に撤去するとは限らない。' },
    { id: 'l25', label: '運転開始＋25年', basis: { type: 'life', years: 25 }, text: '運転開始年に25年を足した仮の値。京都府ページの「2030年代後半以降に顕著に増加」と大きくは食い違わない置き方として選んだ説明用の仮置きで、25年の公的根拠は確認していない。' },
    { id: 'l30', label: '運転開始＋30年', basis: { type: 'life', years: 30 }, text: '運転開始年に30年を足した仮の値。公的根拠は確認していない。' },
    { id: 'l35', label: '運転開始＋35年', basis: { type: 'life', years: 35 }, text: '運転開始年に35年を足した仮の値。公的根拠は確認していない。' }
  ];
  var CUTS = [2035, 2040, 2045, 2050, 2060];
  var RADII = [10, 20, 30, 50];
  var SITE_COLORS = ['#0072B2', '#E69F00', '#009E73', '#CC79A7'];
  var S = { meta: null, munis: [], rows: [], facs: [], basis: 1, cut: 2045, radius: 20, cand: null, placing: false, res: null, base: null, sug: null };
  var map = null, mapReady = false, markers = [];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function n(x) { return Math.round(x).toLocaleString('ja-JP'); }
  function mw(kw) { return (kw / 1000).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function pct(a, b) { return b ? Math.round(a * 1000 / b) / 10 : 0; }
  function km1(x) { return x.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }); }
  function curBasis() { return BASES[S.basis]; }
  function opts() { return { basis: curBasis().basis, cutoff: S.cut, radiusKm: S.radius }; }
  function sites(withCand) {
    var s = S.facs.map(function (f, i) { return { lat: f.lat, lon: f.lon, name: f.name, label: String(i + 1) }; });
    if (withCand && S.cand) s.push({ lat: S.cand.lat, lon: S.cand.lon, name: '候補拠点（試算）', label: '候' });
    return s;
  }

  function seg(el, options, value, onChange) {
    el.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(o.value === value)); b.textContent = o.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.children, function (c) { c.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true'); onChange(o.value);
      });
      el.appendChild(b);
    });
  }

  function init() {
    Promise.all([getJSON('data/plants.json'), getJSON('data/facilities.json')]).then(function (rs) {
      S.meta = rs[0].meta; S.munis = rs[0].munis; S.rows = rs[0].rows; S.facs = rs[1];
      if (!S.meta.real_data) {
        var d = document.createElement('div'); d.className = 'fake'; d.textContent = 'このデータは架空のサンプルです。実在の設備・事業者ではありません。';
        $('panel').insertBefore(d, $('panel').firstChild);
      }
      seg($('ctl-basis'), BASES.map(function (b, i) { return { value: i, label: b.label }; }), S.basis, function (v) { S.basis = v; update(); });
      seg($('ctl-cut'), CUTS.map(function (y) { return { value: y, label: y + '年まで' }; }), S.cut, function (v) { S.cut = v; update(); });
      seg($('ctl-radius'), RADII.map(function (r) { return { value: r, label: r + ' km' }; }), S.radius, function (v) { S.radius = v; update(); });
      initMap();
      update();
    }).catch(function (e) {
      $('summary').innerHTML = '<p class="warn">データを読み込めませんでした: ' + esc(e.message) + '（file:// ではなく http で開いてください）</p>';
    });
    $('btn-about').addEventListener('click', openAbout);
    $('modal-close').addEventListener('click', function () { $('modal').hidden = true; });
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('modal').hidden = true; });
    $('btn-csv').addEventListener('click', downloadCsv);
    $('btn-place').addEventListener('click', function () {
      S.placing = !S.placing; $('btn-place').setAttribute('aria-pressed', String(S.placing));
      $('btn-place').textContent = S.placing ? '地図をクリックしてください（もう一度押すと解除）' : '地図をクリックして置く';
    });
    $('btn-suggest').addEventListener('click', function () {
      var s = N.suggestSite(S.rows, sites(false), opts());
      if (s) { S.cand = { lat: s.lat, lon: s.lon }; S.sug = s; update(); }
    });
    $('btn-clear').addEventListener('click', function () { S.cand = null; S.sug = null; update(); });
  }

  function update() {
    if (!S.rows.length) return;
    S.base = N.analyze(S.rows, S.munis, sites(false), opts());
    S.res = S.cand ? N.analyze(S.rows, S.munis, sites(true), opts()) : S.base;
    $('basis-note').textContent = '仮説: ' + curBasis().text;
    if (S.meta) $('asof').textContent = S.meta.as_of.replace(/^(\d+)-(\d+)-(\d+)$/, function (_m, y, mo, d) { return y + '年' + +mo + '月' + +d + '日'; }) + '時点';
    renderSummary(); renderChart(); renderCand(); renderMunis(); renderMap();
  }

  function siteName(i) { return i < S.facs.length ? S.facs[i].name : '候補拠点（試算）'; }

  function renderSummary() {
    var t = S.res.total, o = opts();
    var h = '<div class="sent">仮説「' + esc(curBasis().label) + '」では、' + S.cut + '年までに出ると推定した設備は<b>' + n(t.plants) + '件・' + mw(t.kw) + ' MW</b>（京都府の認定設備 ' + n(t.allPlants) + '件・' + mw(t.allKw) + ' MW のうち）。' +
      'このうち、最寄りの施設まで直線で<b>' + o.radiusKm + ' kmより遠い</b>のは<b class="big">' + n(t.outPlants) + '件・' + mw(t.outKw) + ' MW（' + pct(t.outKw, t.kw) + '%）</b>。' +
      '出力で重み付けした最寄り施設までの平均距離は' + km1(t.kw ? t.kmKw / t.kw : 0) + ' km（直線）。</div>';
    $('summary').innerHTML = h;
    var th = '<table><tr><th class="l">リサイクル施設（京都府の公表）</th><th>最寄りとなる設備</th><th>出力(MW)</th><th>うち圏外(MW)</th><th>平均距離(km)</th></tr>';
    S.res.bySite.forEach(function (b, i) {
      var f = i < S.facs.length ? S.facs[i] : null;
      th += '<tr><td class="l"><span class="sw" style="background:' + SITE_COLORS[i] + '"></span>' + (f ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.name) + '</a>' : esc(siteName(i))) + '</td><td>' + n(b.plants) + '件</td><td>' + mw(b.kw) + '</td><td>' + mw(b.outKw) + '</td><td>' + km1(b.kw ? b.kmKw / b.kw : 0) + '</td></tr>';
    });
    th += '</table><p class="note">「最寄り」は直線距離で最も近い施設。施設の処理能力・受入可否は見ていません。</p>';
    $('fac-table').innerHTML = th;
  }

  function renderChart() {
    var ys = S.res.yearly;
    if (!ys.length) { $('chart').innerHTML = ''; return; }
    var W = 520, H = 190, L = 38, B = 22, T = 8, max = 0;
    ys.forEach(function (y) { if (y.kw > max) max = y.kw; });
    var bw = (W - L - 4) / ys.length;
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="推定の廃棄年ごとの出力合計（積み上げは最寄り施設別）">';
    [0, 0.5, 1].forEach(function (f) {
      var yy = H - B - (H - B - T) * f;
      svg += '<line x1="' + L + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#ddd"/><text x="2" y="' + (yy + 3) + '">' + mw(max * f) + '</text>';
    });
    svg += '<text x="2" y="' + (T + 2) + '" style="font-size:9px"></text>';
    ys.forEach(function (y, i) {
      var x = L + i * bw, acc = 0, dim = y.year > S.cut;
      y.bySite.forEach(function (kw, s) {
        if (!kw) return;
        var h = (H - B - T) * kw / max;
        svg += '<rect x="' + (x + 1) + '" y="' + (H - B - (acc + kw) / max * (H - B - T)) + '" width="' + Math.max(1, bw - 2) + '" height="' + h + '" fill="' + SITE_COLORS[s] + '" opacity="' + (dim ? 0.3 : 0.95) + '"><title>' + y.year + '年 ' + esc(siteName(s)) + ' ' + mw(kw) + ' MW</title></rect>';
        acc += kw;
      });
      if (i % 3 === 0 || ys.length < 12) svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + y.year + '</text>';
    });
    svg += '</svg><p class="note">縦軸: MW（出力の合計）。薄い棒は対象年（' + S.cut + '年）より後。</p>';
    $('chart').innerHTML = svg;
    $('chart-legend').innerHTML = S.res.bySite.map(function (_b, i) { return '<span class="sw" style="background:' + SITE_COLORS[i] + '"></span>' + esc(siteName(i)) + '　'; }).join('');
  }

  function renderCand() {
    var el = $('cand-result');
    if (!S.cand) { el.innerHTML = ''; return; }
    var a = S.base.total, b = S.res.total;
    el.innerHTML = '<div class="sent">候補拠点（試算）を置くと、回収圏（' + S.radius + ' km）の外は<b>' + mw(a.outKw) + ' MW（' + pct(a.outKw, a.kw) + '%）→ ' + mw(b.outKw) + ' MW（' + pct(b.outKw, b.kw) + '%）</b>、' +
      '平均距離は' + km1(a.kw ? a.kmKw / a.kw : 0) + ' km → ' + km1(b.kw ? b.kmKw / b.kw : 0) + ' km（いずれも直線・' + S.cut + '年までに出る推定分）。候補は緯度' + S.cand.lat.toFixed(3) + '・経度' + S.cand.lon.toFixed(3) + '付近。' +
      '<br><span class="warn">用地・許可・道路・受入能力は未検討。実在の土地や事業者を指すものではありません。</span></div>';
  }

  function renderMunis() {
    var ms = S.res.munis.slice(0, 15);
    var h = '<table><tr><th class="l">市区町村</th><th>設備</th><th>出力(MW)</th><th>圏外(MW)</th><th>平均距離(km)</th></tr>';
    ms.forEach(function (m) { h += '<tr><td class="l">' + esc(m.name) + '</td><td>' + n(m.plants) + '</td><td>' + mw(m.kw) + '</td><td>' + mw(m.outKw) + '</td><td>' + km1(m.avgKm) + '</td></tr>'; });
    h += '</table><p class="note">出力の大きい上位15市区町村（全' + S.res.munis.length + '）。CSVには全件を入れます。</p>';
    $('muni-table').innerHTML = h;
  }

  /* ---------- 地図 ---------- */
  function circlePoly(lat, lon, km) {
    var pts = [], k = 64;
    for (var i = 0; i <= k; i++) {
      var a = 2 * Math.PI * i / k;
      pts.push([lon + (km / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(a), lat + (km / 110.57) * Math.cos(a)]);
    }
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [pts] } };
  }

  function initMap() {
    if (typeof maplibregl === 'undefined') { $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした。表と書き出しは使えます。</p>'; return; }
    map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } }, layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: [135.55, 35.15], zoom: 8.3, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      var empty = { type: 'FeatureCollection', features: [] };
      ['zones', 'plants'].forEach(function (s) { map.addSource(s, { type: 'geojson', data: empty }); });
      map.addLayer({ id: 'zones', type: 'fill', source: 'zones', paint: { 'fill-color': '#14365d', 'fill-opacity': 0.06 } });
      map.addLayer({ id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#14365d', 'line-width': 1.2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'plants', type: 'circle', source: 'plants', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'kw'], 50, 2.5, 500, 4.5, 2000, 8, 20000, 14],
        'circle-color': ['case', ['!', ['get', 'cut']], '#bbb', ['get', 'out'], '#D55E00', '#0072B2'],
        'circle-opacity': ['case', ['get', 'cut'], 0.7, 0.35], 'circle-stroke-width': 0.4, 'circle-stroke-color': '#fff' } });
      map.on('click', function (e) {
        if (S.placing) {
          S.cand = { lat: e.lngLat.lat, lon: e.lngLat.lng }; S.sug = null; S.placing = false;
          $('btn-place').setAttribute('aria-pressed', 'false'); $('btn-place').textContent = '地図をクリックして置く'; update(); return;
        }
        var fs = map.queryRenderedFeatures(e.point, { layers: ['plants'] });
        if (fs.length) {
          var p = fs[0].properties;
          new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML(
            '<div style="font-size:12px">出力 ' + n(p.kw) + ' kW<br>運転開始 ' + p.start + '年<br>廃棄時期（仮説） ' + p.year + '年<br>最寄り施設 ' + esc(p.site) + '（直線 ' + km1(+p.km) + ' km）<br>位置の精度: ' + esc(p.prec) + '</div>').addTo(map);
        }
      });
      mapReady = true; renderMap();
    });
  }

  function renderMap() {
    if (!mapReady || !S.res) return;
    var ss = sites(!!S.cand), it = S.res.items;
    var feats = S.rows.map(function (r, i) {
      var x = it[i];
      return { type: 'Feature', properties: { kw: r[2], cut: x.inCut, out: x.out, start: Math.floor(r[3] / 100), year: x.year, km: x.km, site: ss[x.site].name, prec: r[6] === 0 ? '町字' : '市区町村' }, geometry: { type: 'Point', coordinates: [r[1], r[0]] } };
    });
    map.getSource('plants').setData({ type: 'FeatureCollection', features: feats });
    map.getSource('zones').setData({ type: 'FeatureCollection', features: ss.map(function (s) { return circlePoly(s.lat, s.lon, S.radius); }) });
    markers.forEach(function (m) { m.remove(); }); markers = [];
    ss.forEach(function (s, i) {
      var el = document.createElement('div');
      el.className = 'facmark' + (i >= S.facs.length ? ' cand' : '');
      el.textContent = s.label; el.title = s.name;
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map));
    });
  }

  /* ---------- 書き出し ---------- */
  function buildCsvRows() {
    var m = S.meta, t = S.res.total, rows = [];
    rows.push(['使用済み太陽光パネルの回収圏計画（デモ・' + m.prefecture + '）']);
    rows.push(['データ区分', m.real_data ? '実データ（公表データを加工）' : '架空サンプル']);
    rows.push(['廃棄時期の置き方（仮説）', curBasis().label, curBasis().text]);
    rows.push(['対象年', S.cut + '年までに出ると推定した設備', '回収圏の半径(直線km)', S.radius]);
    rows.push(['候補拠点（試算）', S.cand ? '緯度' + S.cand.lat.toFixed(4) + ' 経度' + S.cand.lon.toFixed(4) : 'なし']);
    rows.push([]);
    rows.push(['【全体】', '設備(件)', '出力(kW)', '圏外の設備(件)', '圏外の出力(kW)', '圏外の割合(%)', '出力重み付き平均距離(直線km)']);
    rows.push(['対象年までに出ると推定', t.plants, Math.round(t.kw), t.outPlants, Math.round(t.outKw), pct(t.outKw, t.kw), t.kw ? (t.kmKw / t.kw).toFixed(1) : 0]);
    rows.push(['（参考）府内の認定設備すべて', t.allPlants, Math.round(t.allKw)]);
    rows.push([]);
    rows.push(['【施設別】', '最寄りとなる設備(件)', '出力(kW)', '圏外の出力(kW)', '平均距離(直線km)']);
    S.res.bySite.forEach(function (b, i) { rows.push([siteName(i), b.plants, Math.round(b.kw), Math.round(b.outKw), b.kw ? (b.kmKw / b.kw).toFixed(1) : 0]); });
    rows.push([]);
    rows.push(['【年別（推定）】', '設備(件)', '出力(kW)', '圏外の出力(kW)']);
    S.res.yearly.forEach(function (y) { rows.push([y.year, y.plants, Math.round(y.kw), Math.round(y.outKw)]); });
    rows.push([]);
    rows.push(['【市区町村別（対象年まで）】', '設備(件)', '出力(kW)', '圏外の出力(kW)', '平均距離(直線km)']);
    S.res.munis.forEach(function (x) { rows.push([x.name, x.plants, Math.round(x.kw), Math.round(x.outKw), x.avgKm.toFixed(1)]); });
    rows.push([]);
    rows.push(['【前提と限界】']);
    limits().forEach(function (l) { rows.push([l]); });
    rows.push([]);
    rows.push(['【出典】']);
    sources().forEach(function (l) { rows.push([l]); });
    return rows;
  }

  function downloadCsv() {
    if (!S.res) return;
    var blob = new Blob(['﻿' + N.toCsv(buildCsvRows())], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'recovery-zone-kyoto-' + curBasis().id + '-' + S.cut + '-' + S.radius + 'km.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function limits() {
    var st = S.meta.stats;
    return [
      '廃棄時期は仮説。運転開始年（運転開始報告年月の年）に年数を足す、または調達期間終了年を使った推定で、実際の撤去時期ではない。年数に公的な根拠は確認していない。',
      '元データは出力20kW未満の太陽光を含まない。運転開始前の設備（' + st.not_started + '件）は推定の対象外。位置を特定できなかった設備は除いている（' + st.unplaced + '件）。',
      '位置は設備所在地の町字の代表点（' + st.town + '件）、町字が引けなかったものは市区町村の代表点（' + st.muni + '件）。同じ町字の設備は同じ点に重なる。複数地番の設備は代表地番のみを使用。',
      '距離は直線。道路距離・運搬費・施設の受入能力・許可の範囲・処理できるパネルの種類は見ていない。リサイクル施設は京都府が公表する3社のみで、府外・他の処分業者は含まない。',
      '出力（kW）のまま扱い、パネルの重量には換算していない。認定情報は最新状況を反映しておらず、失効した認定を含む場合がある（公表サイトの注意書き）。',
      '候補拠点の試算は距離だけの目安。用地・許可・道路は未検討。',
      '個人・事業者を特定する項目（事業者名・代表者・住所・電話・設備ID）は取り込んでいない。'
    ];
  }
  function sources() {
    var m = S.meta;
    return [
      '出典: 再生可能エネルギー電子申請サイト「事業計画認定情報 公表用ウェブサイト」京都府ファイル（' + m.as_of + '時点、' + m.published + '公表） ' + m.plants_url + ' を加工して作成（加工: 太陽光のみ抽出、住所を位置に変換、廃棄時期を仮説で推定、距離を計算）。国が作成したものではない。利用ルール ' + m.terms_url,
      '位置の変換: ' + m.geocoder + ' https://msearch.gsi.go.jp/',
      'リサイクル施設: ' + m.facilities_source + ' ' + m.facilities_url,
      '背景地図: 地理院タイル（淡色地図）（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）'
    ];
  }

  function openAbout() {
    var h = '<h2 id="about-title" style="margin-top:0">出典・前提・限界</h2><h2>出典</h2><ul>' +
      sources().map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    h += '<h2>リサイクル施設（京都府の公表）</h2><ul>' + S.facs.map(function (f) {
      return '<li>' + esc(f.name) + '（' + esc(f.address) + '）' + (f.note ? '：' + esc(f.note) : '') + '</li>'; }).join('') + '</ul>';
    h += '<h2>前提と限界</h2><ul>' + limits().map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    $('about').innerHTML = h; $('modal').hidden = false; $('modal-close').focus();
  }

  window.NbApp = { STATE: S, update: update, buildCsvRows: buildCsvRows, getMap: function () { return map; }, mapReady: function () { return mapReady; } };
  init();
})();
