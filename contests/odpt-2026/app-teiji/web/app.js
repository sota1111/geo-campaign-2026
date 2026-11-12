/* バス定時性カルテ: 画面制御（MapLibre GL JS）。公開集計（data/*.json）だけを読む静的サイト。 */
(function () {
  'use strict';
  var L = window.TeijiLib;
  var $ = function (id) { return document.getElementById(id); };
  var q = /[?&]data=([a-z0-9-]+)/.exec(location.search);
  var DATA = q ? q[1] : 'data';
  var STATE = { index: null, op: null, band: 'all', map: null, ready: false, popup: null };

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function init() {
    getJson(DATA + '/index.json').then(function (idx) {
      STATE.index = idx;
      var sel = $('op');
      sel.innerHTML = idx.operators.map(function (o) {
        return '<option value="' + L.esc(o.id) + '">' + L.esc(o.name) + (o.stop_estimates ? '' : '（データ蓄積前）') + '</option>';
      }).join('');
      sel.addEventListener('change', function () { loadOp(sel.value); });
      $('band').innerHTML = L.BANDS.map(function (b) {
        return '<button type="button" role="radio" data-band="' + b + '" aria-checked="' + (b === 'all') + '">' + L.esc(L.BAND_LABEL[b]) + '</button>';
      }).join('');
      $('band').addEventListener('click', function (e) {
        var b = e.target.getAttribute && e.target.getAttribute('data-band');
        if (!b) return;
        STATE.band = b;
        Array.prototype.forEach.call($('band').children, function (el) { el.setAttribute('aria-checked', String(el.getAttribute('data-band') === b)); });
        render();
      });
      $('csv-routes').addEventListener('click', function () {
        if (STATE.op) download('teiji_routes_' + STATE.op.id + '_' + STATE.band + '.csv', L.routesCsv(STATE.op, STATE.band));
      });
      $('csv-seg').addEventListener('click', function () {
        if (STATE.op) download('teiji_segments_' + STATE.op.id + '_' + STATE.band + '.csv', L.segmentsCsv(STATE.op, STATE.band));
      });
      initMap();
      var first = idx.operators.filter(function (o) { return o.stop_estimates > 0; })[0] || idx.operators[0];
      if (first) { sel.value = first.id; loadOp(first.id); }
      else $('period').textContent = '公開できる集計がまだありません。取得と集計（README の手順）を実行してください。';
    }).catch(function (e) {
      $('period').textContent = 'データを読み込めませんでした（' + e.message + '）。ページは `python3 -m http.server` などで配信して開いてください。';
    });
  }

  function loadOp(id) {
    getJson(DATA + '/' + encodeURIComponent(id) + '.json').then(function (op) {
      STATE.op = op;
      render();
    }).catch(function (e) { $('period').textContent = '読み込みに失敗: ' + e.message; });
  }

  function render() {
    var op = STATE.op;
    if (!op) return;
    var band = STATE.band;
    var synth = STATE.index && STATE.index.synthetic ? '<b>【合成データ】実在の事業者・路線・遅れではありません。画面確認用です。</b><br>' : '';
    $('period').innerHTML = synth + '<b>' + L.esc(op.name) + '</b>: ' + L.esc(L.periodText(op)) +
      (op.period.estimated_days && op.period.estimated_days.length < 14 ? '<br>蓄積が短いため、数値は試作段階の参考値です（日数が増えるほど安定します）。' : '');
    renderQuality(op);
    renderRoutes(op, band);
    renderSegments(op, band);
    renderAbout(op);
    drawMap(op, band);
  }

  function renderQuality(op) {
    var q = op.quality || {};
    var est = op.estimate || {};
    var v = q.verdict || '—';
    var h = '<h2>データの状況</h2><p class="note">判定: <b>' + L.esc(v) + '</b>' + (q.verdict_reason ? '（' + L.esc(q.verdict_reason) + '）' : '') + '</p>' +
      '<ul class="note"><li>1回の取得で見えた車両数: 中央値 ' + L.esc(q.vehicles_median) + ' 台、最大 ' + L.esc(q.vehicles_max) + ' 台</li>' +
      '<li>位置の更新間隔（車両ごと・中央値）: ' + (q.position_interval_s == null ? '—' : L.esc(q.position_interval_s) + ' 秒') + '</li>' +
      '<li>trip_id が時刻表と一致した率: ' + (q.trip_match_pct == null ? '—' : L.esc(q.trip_match_pct) + '%') + '</li>' +
      '<li>遅れを推定できた便: ' + L.esc(est.trips_estimated || 0) + ' 便（観測した便 ' + L.esc(est.trips_observed || 0) + '、停留所の推定 ' + L.esc(est.stop_estimates || 0) + ' 件）</li></ul>';
    $('quality').innerHTML = h;
  }

  function renderRoutes(op, band) {
    var rows = op.routes.filter(function (r) { return r.band === band; }).sort(L.routeSortKey);
    var t = $('routes-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td class="empty">この時間帯の集計はまだありません。車両位置の蓄積（昼間の取得）が必要です。</td></tr>';
      return;
    }
    t.innerHTML = '<caption class="sr">' + L.esc(op.name) + ' の ' + L.esc(L.BAND_LABEL[band]) + ' の路線別集計</caption>' +
      '<thead><tr><th scope="col">路線</th><th scope="col">便数</th><th scope="col">定時率</th><th scope="col">遅れ(5分超)</th><th scope="col">遅れ中央値</th><th scope="col">団子運転</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var bunch = r.bunch_enough ? L.fmtPct(r.bunch_pct) + '<span class="sub">（' + r.bunch_pairs + '組）</span>' : '<span class="sub">対象外・不足</span>';
        return '<tr><th scope="row">' + L.esc(r.name) + '</th><td>' + r.n_trips + '</td><td>' + L.esc(L.ontimeLabel(r)) + '</td>' +
          '<td>' + (r.enough ? L.fmtPct(r.late_pct) : '—') + '</td><td>' + (r.enough ? L.fmtDelay(r.median_delay_s) : '—') + '</td><td>' + bunch + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderSegments(op, band) {
    var rows = op.segments.filter(function (s) { return s.band === band; }).slice(0, 15);
    var t = $('seg-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td class="empty">区間の集計はまだありません（同じ区間を8回以上観測すると表示します）。</td></tr>';
      return;
    }
    t.innerHTML = '<caption class="sr">遅れが増える区間の上位</caption><thead><tr><th scope="col">路線・区間</th><th scope="col">増える遅れ</th><th scope="col">観測</th></tr></thead><tbody>' +
      rows.map(function (s, i) {
        return '<tr class="pick" tabindex="0" data-i="' + i + '"><th scope="row">' + L.esc(s.name) + '<span class="sub">' + L.esc(s.from) + ' → ' + L.esc(s.to) + '</span></th>' +
          '<td>' + L.fmtDelay(s.median_added_s) + '<span class="sub">時刻表の所要 ' + Math.round(s.sched_run_s / 60 * 10) / 10 + '分</span></td><td>' + s.n + '</td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call(t.querySelectorAll('tr.pick'), function (tr) {
      function go() {
        var s = rows[+tr.getAttribute('data-i')];
        if (STATE.map) STATE.map.flyTo({ center: [(s.from_lon + s.to_lon) / 2, (s.from_lat + s.to_lat) / 2], zoom: 15 });
        if (window.scrollTo && window.innerWidth < 800) window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function renderAbout(op) {
    var p = op.params || {};
    $('about-list').innerHTML =
      '<li>バス位置・時刻表: ' + L.esc(op.credit) + '（<a href="' + L.esc(op.page) + '" target="_blank" rel="noopener">データセットのページ</a>）。公共交通オープンデータセンター（ODPT）が配信する CC BY 4.0 のデータだけを使っています。</li>' +
      '<li>地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li>' +
      '<li>遅れの推定: 車両位置を停留所列の折れ線に当てはめ、停留所の通過時刻を線形補間して時刻表と比べます。道路形状（shapes）は使わないため、数十秒の誤差を含みます。観測の間隔が5分を超える所は推定しません。</li>' +
      '<li>定時: 時刻表より ' + (-(p.early_s || -60)) + '秒早い〜' + (p.late_s || 300) + '秒遅い。団子運転: 時刻表で隣り合う同じ路線・方向の2便の通過間隔が、時刻表の間隔の ' + ((p.bunch_ratio || 0.25) * 100) + '% 未満（時刻表の間隔が1〜20分の停留所だけ対象）。これらの基準は仮の設定です。</li>' +
      '<li>サンプル不足: 便数 ' + (p.min_trips || 10) + ' 未満または観測 ' + (p.min_obs || 50) + ' 未満は数値を出しません。</li>' +
      '<li>事業者名を出した順位付けはしません。事業者は名称順に並べているだけです。便ごとの推定などの詳細は、事業者向けに別ファイル（CSV）で渡します。</li>' +
      '<li>祝日・臨時ダイヤ・運休は反映していません。位置データが欠けた便は集計に入りません。</li>';
  }

  /* ---- 地図 ---- */
  function initMap() {
    $('map-legend').innerHTML = '<b>区間で増える遅れ</b>' + L.SEG_LEGEND.map(function (x) {
      return '<span><i style="background:' + x[0] + '"></i>' + L.esc(x[1]) + '</span>';
    }).join('');
    if (typeof maplibregl === 'undefined') {
      $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした。表だけをご利用いただけます。</p>';
      return;
    }
    STATE.map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: [137.0, 36.0], zoom: 5, attributionControl: { compact: true }
    });
    STATE.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    STATE.map.on('load', function () {
      STATE.ready = true;
      STATE.map.addSource('segs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      STATE.map.addLayer({ id: 'segs-line', type: 'line', source: 'segs', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8] } });
      STATE.map.on('click', 'segs-line', function (e) {
        var f = e.features[0].properties;
        if (STATE.popup) STATE.popup.remove();
        STATE.popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(
          '<b>' + L.esc(f.name) + '</b><br>' + L.esc(f.from) + ' → ' + L.esc(f.to) + '<br>増える遅れ（中央値）: ' + L.fmtDelay(+f.median_added_s) +
          '<br>観測 ' + L.esc(f.n) + ' 回').addTo(STATE.map);
      });
      STATE.map.on('mouseenter', 'segs-line', function () { STATE.map.getCanvas().style.cursor = 'pointer'; });
      STATE.map.on('mouseleave', 'segs-line', function () { STATE.map.getCanvas().style.cursor = ''; });
      if (STATE.op) drawMap(STATE.op, STATE.band);
    });
  }

  function drawMap(op, band) {
    if (!STATE.map || !STATE.ready) return;
    var segs = op.segments.filter(function (s) { return s.band === band; });
    var feats = segs.map(function (s) {
      return { type: 'Feature', properties: { name: s.name, from: s.from, to: s.to, median_added_s: s.median_added_s, n: s.n, color: L.segColor(s.median_added_s) },
        geometry: { type: 'LineString', coordinates: [[s.from_lon, s.from_lat], [s.to_lon, s.to_lat]] } };
    });
    STATE.map.getSource('segs').setData({ type: 'FeatureCollection', features: feats });
    if (feats.length) {
      var b = new maplibregl.LngLatBounds();
      segs.forEach(function (s) { b.extend([s.from_lon, s.from_lat]); b.extend([s.to_lon, s.to_lat]); });
      STATE.map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 400 });
    }
  }

  init();
})();
