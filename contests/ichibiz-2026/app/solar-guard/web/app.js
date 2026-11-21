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
    diag: { lon: null, lat: null, cls: 'unknown', answers: {}, cond: {} }, res: null };
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
    Promise.all([getJSON('data/cells.json'), getJSON('data/pops.json'), getJSON('data/munis.json'), getJSON('data/checklist.json'), getJSON('data/reality.json'), getJSON('data/land.json'), getJSON('data/districts.json'), getJSON('data/risk.json')]).then(function (r) {
      S.meta = r[0].meta; S.cells = r[0].rows; S.pops = G.popGrid(r[1].rows); S.munis = r[2].rows; S.ck = r[3]; S.items = r[3].items; S.classes = r[3].classes; S.reality = r[4]; S.land = G.landSet(r[5].rows); S.regions = r[6].regions; S.risk = r[7]; S.areaNames = r[0].regions;
      $('kmin').textContent = S.meta.k_min;
      buildClass(); buildConds(); buildChecklist(); buildTrend(); buildReality(); buildAbout();
      recompute(); buildRules(); initMap(); renderDiag();
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

  /* ---------- 上部: 盗難の件数・推移 ---------- */
  function buildTrend() {
    var y = S.reality.yearly.rows, pick = function (yr) { return y.filter(function (r) { return r.year === yr; })[0]; };
    var a = pick(2023), b = pick(2024), c = pick(2025), nat = S.reality.nation;
    $('trend').innerHTML = '<b>金属盗は、茨城県で高い水準が続いています</b>（茨城県警の認知件数）。茨城県 令和5年 ' + n0(a.ibaraki) + '件 → 令和6年 ' + n0(b.ibaraki) + '件 → 令和7年 ' + n0(c.ibaraki) + '件（全国 ' + n0(a.japan) + ' → ' + n0(b.japan) + ' → ' + n0(c.japan) + '件）。' +
      '太陽光発電施設のケーブル窃盗は関東に集中し、令和5年は全国の91.8%（警察庁）。金属盗対策法（令和7年9月・令和8年6月に段階施行）と茨城県の条例（令和7年4月施行）が始まっています。' +
      '<br><span class="src">出典: ' + link(S.reality.yearly.url, '茨城県警察「金属盗難に注意！」') + '、' + link(nat.url, '警察庁 検討会資料 p.5') + '、' + link(S.reality.law.url, '警察庁「金属盗対策」') + '（取得 2026-11-21）</span>';
  }

  /* ---------- 色分けの規則と、県警の実績との照合 ---------- */
  function areaOf(d, name) { return d.rows.filter(function (r) { return r.area === name; })[0]; }
  function buildRules() {
    var d = S.d711, p = S.reality.areas711, sc = S.risk.scale;
    $('rules').innerHTML = '<p class="note" style="color:#222"><b>色は次の点数で決めます（すべて仮の規則で、公的な数値の根拠はありません）</b>: <b>点数 ＝ 2 × 地区の段階（0〜2） ＋ 人目の少なさ（0か1）</b>。0点＝低、1〜2点＝中、3〜4点＝やや高、5点＝高。</p>' +
      '<ul class="note" style="font-size:12.5px;padding-left:18px;color:#222">' +
      '<li><b>地区の段階（主な根拠）</b>: 県警が公表した県内5地区の太陽光の件数（' + link(p.url, p.title) + '）を、地区ごとの設備数で割った「設備1,000件あたりの件数」。県全体の値（' + n1(d.avg) + '）以上なら段階2、' + G.TIER_MID + '以上なら段階1、それ未満は0（切り方は仮）。市町村と約5kmメッシュは、いずれかの地区に入れて同じ段階にする（メッシュは、中の設備が最も多い市町村の地区。' + n0(S.meta.stats.cells_visible_mixed_region) + 'メッシュは複数の地区にまたがる）。県西・県南で約7割（令和7年11月末）。</li>' +
      '<li><b>人目の少なさ（近似）</b>: JPEA・REASPが挙げる「人目につきにくい立地」を、2020年国勢調査の人口密度で近似。県内の同じ単位（メッシュまたは市町村）の中で人口密度が低い方から1/3なら1、それ以外は0。<b>数値の根拠はなく、1/3という切り方は仮</b>。常住人口で、夜間・見通し・道路は見ない。</li>' +
      '<li><b>色に使わないもの</b>: 規模（出力）は、JPEA・REASPのアンケートと茨城県警で向きが食い違うので使わず、両論を載せる（下の注記）。「逃げやすさ」（IC・幹線道路からの距離）は、距離の根拠がなく、国土数値情報の道路データも利用条件を確認していないので使わない。防犯設備・ケーブルの種類・巡回は公開データで再現できないので、事業者が入れる「自分の設備を診断」でだけ扱う。</li></ul>' +
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
    var html = '<p class="note"><b>当たっているか・逆になっていないか</b>。①地区の段階は令和7年11月末の実績から作ったので、地区ごとの色の並びがその実績と合うのは当然で、<b>独立の検証ではありません</b>（順位相関 ' + f2(rho1) + '）。②別の期間（令和8年9月末の設備1,000件あたり）の実績との順位相関は <b>' + f2(rho2) + '</b>（' + (rho2 != null && rho2 > 0.8 ? '地区の色の平均の順は、令和8年9月末の実績の順とも合っています。ただし、令和8年9月末は県西と県北が近く、地区の段階や人目の切り方は両期間の数値を見たうえで決めたので、これも独立の検証ではありません' : '地区の順が別の期間の実績とずれています') + '）。③<b>人目の少なさ</b>は、地区どうしで見ると' + (rho3 != null && rho3 < 0 ? '<b>被害率と逆向き</b>です（人目が少ないメッシュの割合と、令和7年11月末の被害率の順位相関 ' + f2(rho3) + '。県西は被害率が最も高いのに、人目が少ないメッシュの割合は最も低い）。人目の少なさが実績に裏づけられたとは言えず、色では1点分の小さな補正にとどめています' : '被害率と同じ向きです（順位相関 ' + f2(rho3) + '）。ただし5点だけで、裏づけとは言えません') + '。④同じ地区の中で、メッシュごとの被害実績は公開されていないので、メッシュの色の違い（人目）が当たっているかは確かめられません。5点だけの比較で、有意とは言えません。</p>' + h +
      '<p class="note"><b>設備1,000件あたりの件数</b>は、分子が県警の「太陽光発電施設関係」の発生件数（出力20kW未満や認定外の設備の件数を含みうる）、分母が認定情報の運転開始報告済み・出力20kW以上の設備数で、定義が違うため参考値。県警の5地区が県の区分と同じ市町村の範囲かは誌面に記載がなく、<b>この対応は推測</b>です。令和7年11月末・令和8年9月末はどちらも暫定値の累計と読める（誌面に累計と明記はない）。色は「被害の予測」ではなく、実績の地区差と人目の近似から作った仮の目安です。</p>';
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
    var h = 'リスク（仮の規則・4段階）: ';
    BAND_COLORS.forEach(function (c, i) { h += '<span class="sw" style="background:' + c + '"></span>' + BAND_LABELS[i]; });
    h += '　<span class="sw" style="background:#fff"></span>色なし＝隠した・設備なし<br>約5kmメッシュ。主な根拠は県警の地区別件数。被害の予測ではありません。';
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
      map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', filter: ['>=', ['get', 'band'], 0], paint: { 'fill-opacity': 0.62, 'fill-color': ['match', ['get', 'band'], 0, BAND_COLORS[0], 1, BAND_COLORS[1], 2, BAND_COLORS[2], 3, BAND_COLORS[3], '#cccccc'] } });
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
      var c = S.sc[idx], t = c.region >= 0 ? areaOf(S.d711, S.areaNames[c.region]) : null;
      h = '<b>約5kmメッシュの集計</b>（南西角の基準メッシュ ' + G.meshCode(c.cx * G.CELL, c.cy * G.CELL) + '）<br>設備 ' + n0(c.n) + '件・出力計 約' + mw(c.kw) + ' MW・うち50kW未満 ' + n1(c.share * 100) + '%<br>人口密度 約' + n0(c.dens) + '人/km²（2020年国勢調査）' + (c.quiet ? '＝人目が少ない側（県内の低い方から1/3）' : '') + '<br>' +
        'リスク（仮）: ' + bandChip(c.level) +
        '<br><span style="font-size:11px;color:#555">色の根拠: 地区 ' + (t ? esc(t.area) + '（令和7年11月末 設備1,000件あたり' + n1(t.rate) + '件、段階' + t.tier + '）' : '—') + '＋人目の少なさ ' + (c.quiet ? '1' : '0') + '。被害の予測ではありません。町字の代表点で数えているため、実際の位置とずれることがあります。</span>';
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
  /* 診断の「現場の条件」の質問（本人の回答で決まるもの。対策の回答から導く条件・公開データで決まる条件は結果に出る） */
  function buildConds() {
    var h = '';
    S.risk.conds.filter(function (c) { return c.ask; }).forEach(function (c) {
      var a = S.diag.cond[c.id] || 'unknown';
      h += '<div class="cl-item cd-item"><div class="t" id="tc-' + c.id + '">' + esc(c.label) + '：' + esc(c.ask) + '</div><div class="seg" role="radiogroup" aria-labelledby="tc-' + c.id + '" data-id="' + c.id + '">' +
        [['yes', '当てはまる'], ['no', '当てはまらない'], ['unknown', 'わからない']].map(function (o) { return '<button type="button" role="radio" data-v="' + o[0] + '" aria-checked="' + (a === o[0]) + '">' + o[1] + '</button>'; }).join('') +
        '</div><div class="src">' + (c.auto ? '答えない場合は、メッシュの人口密度から自動で判定します。 ' : '') + '出典: ' + srcLinksRisk(c.src) + '</div></div>';
    });
    $('conds').innerHTML = h;
    Array.prototype.forEach.call($('conds').querySelectorAll('.seg'), function (seg) {
      Array.prototype.forEach.call(seg.children, function (b) {
        b.addEventListener('click', function () {
          S.diag.cond[seg.getAttribute('data-id')] = b.getAttribute('data-v');
          Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
          renderDiag();
        });
      });
    });
  }
  function srcLinksRisk(keys) {
    return keys.map(function (k) { var s = S.risk.sources[k]; return s ? link(s.url, s.name) : esc(k); }).join('、');
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
    showSummary();
  }
  /* 診断直後に、受付欄へ結果の要約と「結果を見る」案内を出す（スクロールは勝手にしない。要約が出ている間は、区分・回答の変更でも renderDiag から更新する） */
  function showSummary() {
    var msg = $('pos-msg'), r = S.res;
    if (!r) return;
    msg.innerHTML = '位置を受け取りました（この端末の中だけで使います。地図は動かしません）。<b>診断しました</b>: リスク（仮）' + bandChip(r.levelMin) + (r.levelMax !== r.levelMin ? '〜' + bandChip(r.levelMax) : '') + '。対象' + r.total + '項目のうち、実施していない' + r.notDone.length + '件・わからない' + r.unknown.length + '件。 <a href="#box-result" id="go-result">結果を見る</a>';
    msg.className = 'note';
    $('go-result').addEventListener('click', function (e) { e.preventDefault(); $('box-result').scrollIntoView({ block: 'start' }); });
  }
  function showPoint() {
    if (!map || !mapReady || S.diag.lon == null) return;
    if (!marker) marker = new maplibregl.Marker({ color: '#0072B2' });
    marker.setLngLat([S.diag.lon, S.diag.lat]).addTo(map);
    var m = G.toMesh(S.diag.lon, S.diag.lat), b = G.cellBounds(m.cx, m.cy);
    map.getSource('mine').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } }] });
  }
  function resetDiag() {
    S.diag = { lon: null, lat: null, cls: 'unknown', answers: {}, cond: {} };
    $('in-lat').value = ''; $('in-lon').value = ''; $('pos-msg').textContent = ''; $('pos-msg').className = 'note';
    if (marker) { marker.remove(); marker = null; }
    if (mapReady) map.getSource('mine').setData({ type: 'FeatureCollection', features: [] });
    buildClass(); buildConds(); buildChecklist(); renderDiag();
  }

  var STATE_TXT = { risk: '当てはまる', ok: '当てはまらない', unknown: 'わからない' };
  var BY_TXT = { answer: '本人の回答', derived: '下の対策の回答から', auto: '公開データから自動（回答なし）', none: '' };
  function renderDiag() {
    var el = $('diag-result');
    if (!S.items.length) return;
    if (S.diag.lon == null) { el.innerHTML = '<p class="note">位置を指すと、リスクの色（仮）・周囲の目安・未実施の対策が出ます。</p>'; S.res = null; return; }
    var r = G.diagnose({ lon: S.diag.lon, lat: S.diag.lat, cls: S.diag.cls, answers: S.diag.answers, cond: S.diag.cond }, { cells: S.cells, pops: S.pops, items: S.items, conds: S.risk.conds, tiers: S.tiers, regionNames: S.areaNames });
    S.res = r;
    var reg = r.region, rt = reg ? areaOf(S.d711, reg.name) : null;
    var risk = '<div class="riskbox"><b>この設備のリスク（仮の規則）</b>: いまの回答では ' + bandChip(r.levelMin) +
      (r.unknownCount && r.levelMax !== r.levelMin ? '　「わからない」の' + r.unknownCount + '項目がすべて当てはまる場合は ' + bandChip(r.levelMax) : r.unknownCount ? '　（「わからない」が' + r.unknownCount + '項目ありますが、どう答えても色は変わりません）' : '') +
      '<div class="note" style="margin:4px 0 0">点数 ' + r.scoreMin + '＝地区 ' + (reg ? G.W_REGION * reg.tier : 0) + '＋当てはまる条件 ' + r.riskCount + '件（0〜3点＝低、4〜6点＝中、7〜8点＝やや高、9点以上＝高。仮の切り方）。被害の予測ではなく、公開された「盗まれやすい条件」にいくつ当てはまるかの目安です。</div></div>';
    var h = risk + '<div class="sent"><b>対策の状況（対象' + r.total + '項目）</b>: 実施している <b>' + r.done + '</b> ／ 実施していない <b>' + r.notDone.length + '</b> ／ わからない <b>' + r.unknown.length + '</b></div>' +
      '<h3>色の内訳と、なぜそう判定するか</h3><ul class="note" style="font-size:13px;padding-left:18px;color:#222"><li><b>地区（実績。点数が最も大きい部分）</b>: ' +
      (reg ? esc(reg.name) + (reg.near ? '（この約5kmメッシュは公開メッシュではないため、近くの公開メッシュの地区で代用。推測）' : '（県の区分で推測）') + '。県警の令和7年11月末の太陽光の件数は設備1,000件あたり' + n1(rt.rate) + '件（県全体 ' + n1(S.d711.avg) + '件）で、段階' + reg.tier + '（点数 ' + G.W_REGION * reg.tier + '）。出典: ' + link(S.reality.areas711.url, 'Metal News 令和7年第12号') : '近くに公開メッシュがなく、地区が分かりません（地区の点数は0として下限、最大側では最大の4点を足します）') + '</li></ul>';
    h += '<div class="scroll"><table class="cards cond"><tr><th class="l">盗まれやすい条件（資料が挙げるもの）</th><th>状態</th><th class="l">なぜ・出典</th></tr>';
    S.risk.conds.forEach(function (c, i) {
      var e = r.conds[i];
      h += '<tr><td class="l" data-label="条件">' + esc(c.label) + '</td><td data-label="状態"><span class="st st-' + e.state + '">' + STATE_TXT[e.state] + '</span>' + (BY_TXT[e.by] ? '<div class="by">' + BY_TXT[e.by] + '</div>' : '') + '</td><td class="l why" data-label="なぜ・出典">' + esc(c.why) + '<div class="src">出典: ' + srcLinksRisk(c.src) + '</div></td></tr>';
    });
    h += '</table></div><p class="note">規模（出力）は点数に使いません。' + esc(S.risk.scale.note) + '</p>' +
      '<h3>周囲の目安（公開データの集計から。被害の予測ではありません）</h3><ul class="note" style="font-size:13px;padding-left:18px;color:#222">' +
      '<li>この位置を含む約5kmメッシュ（南西角の基準メッシュ ' + esc(r.code) + '）の人口は約' + n0(r.cellPopulation) + '人（人口密度 約' + n0(r.cellDensity) + '人/km²、2020年国勢調査の常住人口）。診断は約5kmメッシュの単位でしか位置を使いません。</li>' +
      '<li>周囲の人の少なさ: 県内のメッシュの中で、人口密度が低い方から' + (r.quietPos == null ? '—' : (r.autoQuiet ? '1/3に入る（人目が少ない側）' : '1/3には入らない')) + '。</li>' +
      '<li>このメッシュの認定設備の集計: ' + (r.cellVisible ? r.cell.n + '件・出力計約' + mw(r.cell.kw) + ' MW・うち50kW未満' + r.cell.small + '件' : '設備が少ないか無いため表示しません') + '。</li></ul>';
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
    labelCells(el);
    if ($('go-result')) showSummary(); /* 受付欄に要約が出ている間は、結果と同じ件数に更新する */
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
    var a7 = R.areas711, mx7 = Math.max.apply(null, a7.rows.map(function (r) { return r.n; }));
    h += '<div class="box"><h2>' + esc(a7.title) + '（リスクの色の主な根拠）</h2>' + bars(a7.rows.map(function (r) { return { label: r.area, v: r.n }; }), 'v', '', mx7) +
      '<p class="note">' + esc(a7.note) + '<br>出典: ' + link(a7.url, a7.source) + '</p></div>';
    h += '<div class="box"><h2>' + esc(R.nation.title) + '</h2><p style="font-size:13px;margin:6px 0">' + esc(R.nation.text) + '<br><span class="src">出典: ' + link(R.nation.url, R.nation.source) + '</span></p>' +
      '<h3 style="margin-top:10px">法・条例</h3><p style="font-size:13px;margin:6px 0">' + esc(R.law.text) + '<br><span class="src">出典: ' + link(R.law.url, R.law.source) + '</span></p></div>';
    var mxa = Math.max.apply(null, ar.rows.map(function (r) { return r.n; }));
    h += '<div class="box"><h2>' + esc(ar.title) + '</h2>' + bars(ar.rows.map(function (r) { return { label: r.area + '（' + r.example + '）', v: r.n }; }), 'v', '', mxa) +
      '<p class="note">' + esc(ar.note) + '<br>出典: ' + link(ar.url, ar.source) + '</p></div>';
    h += '<div class="box"><h2>県警の被害実績と、リスクの色の照合</h2><div id="dist-compare2"></div></div>';
    h += '<div class="box"><h2>なぜ個別の設備を公開しないのか、被害の影響</h2>' + R.why.map(function (w) { return '<p style="font-size:13px;margin:6px 0">' + esc(w.text) + '<br><span class="src">出典: ' + link(w.url, w.src) + '</span></p>'; }).join('') + '</div>';
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
