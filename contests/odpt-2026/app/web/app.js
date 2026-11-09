/* 生活アクセス診断マップ: 画面制御（MapLibre GL JS） */
(function () {
  'use strict';
  var L = window.Lib;
  var COLORS = { walk: '#4a90d9', transit: '#2e9e5b', none: '#e0533d', lost: '#6a1b9a' };
  var STATE = { index: null, data: null, cellIdx: null, fi: 0, day: 'wd', per: 'm', w: 60, marker: null, lost: null };
  var map;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function man(n) { return n >= 10000 ? (Math.round(n / 100) / 100) + '万人' : n.toLocaleString('ja-JP') + '人'; }

  /* ---------- セグメントボタン ---------- */
  function seg(el, options, value, onChange) {
    el.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.textContent = o.label;
      b.addEventListener('click', function () {
        onChange(o.value);
        Array.prototype.forEach.call(el.children, function (c) { c.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
      });
      el.appendChild(b);
    });
  }

  /* ---------- データ読み込み ---------- */
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function init() {
    getJSON('data/index.json').then(function (idx) {
      STATE.index = idx;
      var sel = $('region');
      sel.innerHTML = idx.regions.map(function (r) {
        return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>';
      }).join('');
      var m = /region=([a-z0-9_-]+)/.exec(location.hash);
      var start = m && idx.regions.some(function (r) { return r.id === m[1]; }) ? m[1] : idx.regions[0].id;
      sel.value = start;
      sel.addEventListener('change', function () { loadRegion(sel.value); });
      initMap(function () { loadRegion(start); });
    }).catch(function (e) {
      $('summary').innerHTML = '<p class="note">データを読み込めませんでした: ' + esc(e.message) + '</p>';
    });
    $('btn-about').addEventListener('click', openAbout);
    $('modal-close').addEventListener('click', closeAbout);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeAbout(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAbout(); });
    $('sheet-toggle').addEventListener('click', function () {
      var p = $('panel');
      var closed = p.classList.toggle('closed');
      document.body.classList.toggle('sheet-closed', closed);
      $('sheet-toggle').setAttribute('aria-expanded', String(!closed));
    });
    ['cells', 'nodes', 'routes', 'fac'].forEach(function (k) {
      $('lyr-' + k).addEventListener('change', applyLayerVisibility);
    });
  }

  function initMap(cb) {
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          gsi: {
            type: 'raster', tileSize: 256, maxzoom: 18,
            tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>'
          }
        },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }]
      },
      center: [137.2, 36.7], zoom: 10, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      var empty = { type: 'FeatureCollection', features: [] };
      ['cells', 'routes', 'routes-hl', 'routes-wi', 'nodes', 'fac'].forEach(function (s) {
        map.addSource(s, { type: 'geojson', data: empty });
      });
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: {
        'fill-color': ['match', ['get', 'st'], 'walk', COLORS.walk, 'transit', COLORS.transit, 'lost', COLORS.lost, COLORS.none],
        'fill-opacity': 0.55, 'fill-outline-color': 'rgba(255,255,255,0.35)' } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: {
        'line-color': '#444', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.8], 'line-opacity': 0.5 } });
      map.addLayer({ id: 'routes-hl', type: 'line', source: 'routes-hl', paint: {
        'line-color': '#1b4f8a', 'line-width': 3.5, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'routes-wi', type: 'line', source: 'routes-wi', paint: {
        'line-color': '#6a1b9a', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'nodes', type: 'circle', source: 'nodes', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3.5, 16, 7],
        'circle-color': '#999', 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
      map.addLayer({ id: 'fac', type: 'circle', source: 'fac', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 7],
        'circle-color': ['match', ['get', 't'], 'hospital', '#8e24aa', '#f9a825'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.on('click', onMapClick);
      cb();
    });
  }

  function applyLayerVisibility() {
    if (!map || !map.getLayer('cells')) return;
    var v = { cells: 'lyr-cells', nodes: 'lyr-nodes', routes: 'lyr-routes', fac: 'lyr-fac' };
    Object.keys(v).forEach(function (k) {
      map.setLayoutProperty(k, 'visibility', $(v[k]).checked ? 'visible' : 'none');
    });
    map.setLayoutProperty('routes-hl', 'visibility', $('lyr-routes').checked ? 'visible' : 'none');
    map.setLayoutProperty('routes-wi', 'visibility', $('lyr-routes').checked ? 'visible' : 'none');
  }

  function loadRegion(id) {
    $('summary').innerHTML = '<p class="note">読み込み中…</p>';
    getJSON('data/' + id + '.json').then(function (d) {
      STATE.data = d;
      STATE.cellIdx = L.indexCells(d.cells);
      STATE.fi = 0;
      history.replaceState(null, '', '#region=' + id);
      buildControls();
      buildStaticLayers();
      var b = d.bbox;
      var mobile = window.matchMedia('(max-width: 720px)').matches;
      var pad = mobile ? { top: 20, left: 20, right: 20, bottom: Math.round(window.innerHeight * 0.56) + 20 }
        : { top: 20, left: 400, right: 20, bottom: 20 };
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, duration: 600 });
      if (STATE.marker) { STATE.marker.remove(); STATE.marker = null; }
      map.getSource('routes-hl').setData({ type: 'FeatureCollection', features: [] });
      map.getSource('routes-wi').setData({ type: 'FeatureCollection', features: [] });
      STATE.lost = null;
      $('detail').innerHTML = '<h2>地点の診断</h2><p class="note">地図をタップすると、その地点の診断と近くの停留所を表示します。</p>';
      $('region-note').textContent = d.reason;
      if (window.WhatIf) window.WhatIf.onRegion(STATE, d, refresh);
      refresh();
    }).catch(function (e) {
      $('summary').innerHTML = '<p class="note">地域データを読み込めませんでした: ' + esc(e.message) + '</p>';
    });
  }

  function buildControls() {
    var d = STATE.data;
    seg($('ctl-facility'), d.facility_order.map(function (k, i) { return { value: i, label: d.facility_labels[k] }; }),
      STATE.fi, function (v) { STATE.fi = v; refresh(); });
    seg($('ctl-day'), L.DAYS.map(function (k) { return { value: k, label: L.DAY_LABEL[k] }; }),
      STATE.day, function (v) { STATE.day = v; refresh(); });
    seg($('ctl-period'), L.PERIODS.map(function (k) {
      return { value: k, label: L.PERIOD_LABEL[k] + d.params.start_hours[k] + '時' };
    }), STATE.per, function (v) { STATE.per = v; refresh(); });
    seg($('ctl-w'), d.params.thresholds.map(function (w) { return { value: w, label: w + '分' }; }),
      STATE.w, function (v) { STATE.w = v; refresh(); });
  }

  function lonlat(n) { return [n[0], n[1]]; }

  function buildStaticLayers() {
    var d = STATE.data;
    map.getSource('nodes').setData({ type: 'FeatureCollection', features: d.nodes.map(function (n, i) {
      return { type: 'Feature', properties: { i: i, wd: n[3][3], hol: n[4][3] },
        geometry: { type: 'Point', coordinates: lonlat(n) } };
    }) });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: d.patterns.map(function (p) {
      return { type: 'Feature', properties: { r: p[0] },
        geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return lonlat(d.nodes[i]); }) } };
    }) });
    applyLayerVisibility();
  }

  function need() { return L.needLevel(STATE.data.params.thresholds, STATE.w); }

  function refresh() {
    var d = STATE.data;
    if (!d) return;
    var nd = need();
    if (window.WhatIf) window.WhatIf.onRefresh();   // STATE.lost を更新する
    // メッシュの色
    var lost = STATE.lost;
    var feats = d.cells.map(function (c, k) {
      var b = L.meshBounds(c[0]);
      return { type: 'Feature', properties: { st: lost && lost[k] ? 'lost' : L.cellStatus(c, STATE.fi, STATE.day, STATE.per, nd) },
        geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
    });
    map.getSource('cells').setData({ type: 'FeatureCollection', features: feats });
    // 停留所の色（選択中の曜日の1日の本数）
    map.setPaintProperty('nodes', 'circle-color', ['step', ['get', STATE.day], '#9e9e9e',
      1, '#fdd49e', 6, '#fdbb84', 16, '#fc8d59', 41, '#e34a33', 101, '#b30000']);
    // 施設
    var key = d.facility_order[STATE.fi];
    map.getSource('fac').setData({ type: 'FeatureCollection', features: d.facilities[key].map(function (f) {
      return { type: 'Feature', properties: { t: key, name: f[2] }, geometry: { type: 'Point', coordinates: [f[0], f[1]] } };
    }) });
    renderSummary();
    renderLegend();
  }

  function renderLegend() {
    $('legend').innerHTML = '停留所の色（1日の発車本数）:' +
      [['#9e9e9e', '0'], ['#fdd49e', '1-5'], ['#fdbb84', '6-15'], ['#fc8d59', '16-40'], ['#e34a33', '41-100'], ['#b30000', '101+']]
        .map(function (c) { return '<span class="sw" style="background:' + c[0] + '"></span>' + c[1]; }).join('') +
      '<br>施設: <span class="sw" style="background:' + (STATE.fi === 0 ? '#8e24aa' : '#f9a825') + '"></span>' +
      esc(STATE.data.facility_labels[STATE.data.facility_order[STATE.fi]]);
  }

  /* ---------- 集計 ---------- */
  function renderSummary() {
    var d = STATE.data, nd = need();
    var s = L.summarize(d.cells, STATE.fi, STATE.day, STATE.per, nd);
    var okp = L.pct(s.walk + s.transit, s.pop);
    var ok65 = L.pct(s.walk65 + s.transit65, s.pop65);
    var fl = d.facility_labels[d.facility_order[STATE.fi]];
    var h = '<p class="big">' + esc(L.DAY_LABEL[STATE.day]) + esc(L.PERIOD_LABEL[STATE.per]) + d.params.start_hours[STATE.per] +
      '時に出発して<b>' + STATE.w + '分以内</b>に' + esc(fl) + 'へ行ける人は<br><b>' + okp + '%</b>' +
      '（診断範囲の人口 ' + man(s.pop) + '）</p>';
    h += '<div class="bar" role="img" aria-label="徒歩圏 ' + L.pct(s.walk, s.pop) + '%、公共交通で到達 ' + L.pct(s.transit, s.pop) +
      '%、到達できない ' + L.pct(s.none, s.pop) + '%">' +
      '<i class="w" style="width:' + L.pct(s.walk, s.pop) + '%"></i><i class="t" style="width:' + L.pct(s.transit, s.pop) + '%"></i>' +
      '<i class="n" style="width:' + L.pct(s.none, s.pop) + '%"></i></div>';
    h += '<div class="keys"><span style="--c:' + COLORS.walk + '">徒歩圏 ' + L.pct(s.walk, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.transit + '">公共交通で到達 ' + L.pct(s.transit, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.none + '">到達できない ' + L.pct(s.none, s.pop) + '%</span></div>';
    h += '<p class="note">65歳以上では ' + ok65 + '%（' + man(s.pop65) + '）が到達可。</p>';
    // 平日/休日 × 朝昼夕の比較
    h += '<table><caption class="note">到達できる人の割合（' + STATE.w + '分以内・' + esc(fl) + '）</caption><tr><th></th>' +
      L.PERIODS.map(function (p) { return '<th>' + L.PERIOD_LABEL[p] + d.params.start_hours[p] + '時</th>'; }).join('') + '</tr>';
    L.DAYS.forEach(function (dy) {
      h += '<tr><th>' + L.DAY_LABEL[dy] + '</th>';
      L.PERIODS.forEach(function (p) {
        var t = L.summarize(d.cells, STATE.fi, dy, p, nd);
        h += '<td' + (dy === STATE.day && p === STATE.per ? ' class="cur"' : '') + '>' + L.pct(t.walk + t.transit, t.pop) + '%</td>';
      });
      h += '</tr>';
    });
    h += '</table><p class="note">診断範囲: 収録した停留所から' + d.params.diag_radius_m + 'm以内の人口メッシュ。徒歩圏=施設まで直線' +
      d.params.walk_only_m + 'm以内。</p>';
    $('summary').innerHTML = h;
  }

  /* ---------- 地点の診断 ---------- */
  function onMapClick(e) {
    var d = STATE.data;
    if (!d) return;
    var lon = e.lngLat.lng, lat = e.lngLat.lat;
    if (STATE.marker) STATE.marker.remove();
    STATE.marker = new maplibregl.Marker({ color: '#1b4f8a' }).setLngLat([lon, lat]).addTo(map);
    var code = L.meshCodeAt(lon, lat);
    var ci = STATE.cellIdx[code];
    var h = '<h2>地点の診断</h2>';
    if (ci == null) {
      h += '<p class="note">この地点は診断範囲外です（停留所から' + d.params.diag_radius_m + 'm超、または人口データなし）。</p>';
    } else {
      var c = d.cells[ci];
      h += '<p class="note">この500mメッシュ: 人口 ' + c[1] + '人（65歳以上 ' + c[2] + '人。秘匿処理により近隣メッシュ分を含む／欠ける場合あり）</p>';
      h += diagTable(c);
    }
    var near = L.nearbyNodes(d.nodes, lon, lat, d.params.walk_in_m, 6);
    var hl = {};
    if (!near.length) {
      h += '<p><b>半径' + d.params.walk_in_m + 'm以内に停留所がありません。</b>公共交通の空白地の可能性があります（収録事業者のみ対象）。</p>';
    } else {
      h += '<h2>近くの停留所（' + d.params.walk_in_m + 'm以内）</h2>';
      near.forEach(function (o) {
        var n = d.nodes[o.i];
        n[5].forEach(function (r) { hl[r] = 1; });
        h += '<div class="stop"><b>' + esc(n[2] || '(名称なし)') + '</b>（約' + Math.round(o.d) + 'm）<br>' +
          '平日 朝' + n[3][0] + '／昼' + n[3][1] + '／夕' + n[3][2] + '本、終発 ' + L.fmtMin(n[3][5]) + '<br>' +
          '休日 朝' + n[4][0] + '／昼' + n[4][1] + '／夕' + n[4][2] + '本、終発 ' + L.fmtMin(n[4][5]) + '<br>' +
          '<span class="note">' + L.nodeFacts(n).map(esc).join('。') + '。路線: ' +
          esc(n[5].slice(0, 5).map(function (r) { return d.routes[r][0]; }).join('、')) + (n[5].length > 5 ? ' ほか' + (n[5].length - 5) + '路線' : '') +
          '</span></div>';
      });
      h += '<p class="note">本数は朝6-9時／昼9-16時／夕16-20時の発車数（基準日の時刻表）。</p>';
    }
    $('detail').innerHTML = h;
    var feats = d.patterns.filter(function (p) { return hl[p[0]]; }).map(function (p) {
      return { type: 'Feature', properties: { r: p[0] },
        geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return lonlat(d.nodes[i]); }) } };
    });
    map.getSource('routes-hl').setData({ type: 'FeatureCollection', features: feats });
    if (window.matchMedia('(max-width: 720px)').matches) {
      $('panel').classList.remove('closed');
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function diagTable(c) {
    var d = STATE.data;
    var h = '<table><tr><th rowspan="2">行き先</th>';
    L.DAYS.forEach(function (dy) { h += '<th colspan="3">' + L.DAY_LABEL[dy] + '</th>'; });
    h += '</tr><tr>';
    L.DAYS.forEach(function () { L.PERIODS.forEach(function (p) { h += '<th>' + L.PERIOD_LABEL[p] + '</th>'; }); });
    h += '</tr>';
    d.facility_order.forEach(function (k, fi) {
      h += '<tr><th>' + esc(d.facility_labels[k]) + '</th>';
      var walk = c[4] & (1 << fi);
      L.DAYS.forEach(function (dy) {
        L.PERIODS.forEach(function (p) {
          var lv = +c[3][L.condIndex(fi, dy, p)];
          if (walk) h += '<td class="lw">徒歩圏</td>';
          else h += '<td class="l' + lv + '">' + esc(L.levelLabel(lv, d.params.thresholds)) + '</td>';
        });
      });
      h += '</tr>';
    });
    return h + '</table><p class="note">朝8時・昼12時・夕17時に出発して、最短で何分以内に着けるか（待ち時間・乗継を含む）。×は60分以内に着けない。</p>';
  }

  /* ---------- 出典・前提 ---------- */
  function openAbout() {
    var d = STATE.data;
    var h = '<h2 id="about-title" style="margin-top:0">出典・ライセンス・診断の前提</h2>';
    h += '<p>本アプリは、収録した事業者・地域のデータだけで診断しています。<b>全国を網羅するものではありません</b>（JR・大手民営鉄道等、GTFSデータリポジトリに未収録の事業者は含みません）。</p>';
    if (d) {
      h += '<h2>この地域（' + esc(d.name) + '）に収録したGTFSデータ</h2>';
      h += '<p>出典: <a href="https://www.gtfs-data.jp/" target="_blank" rel="noopener">GTFSデータリポジトリ</a>。各データは事業者がそれぞれのライセンスで公開しており、本アプリでは停留所の集約・本数集計・到達時間の計算という加工を行っています。</p>';
      h += '<table><tr><th>事業者</th><th>データ名</th><th>ライセンス</th><th>リポジトリ更新日</th><th>データ有効期間</th><th>診断の基準日（平日/休日）</th></tr>';
      d.feeds.forEach(function (f) {
        h += '<tr><td><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.org) + '</a></td><td>' + esc(f.name) + '</td><td>' +
          (f.license_url ? '<a href="' + esc(f.license_url) + '" target="_blank" rel="noopener">' + esc(f.license) + '</a>' : esc(f.license)) +
          '</td><td>' + esc(f.updated) + '</td><td>' + esc((f.valid[0] || '?') + '〜' + (f.valid[1] || '?')) + '</td><td>' +
          esc(f.ref.wd + ' / ' + f.ref.hol) + '</td></tr>';
      });
      h += '</table><p class="note">データ生成日: ' + esc(d.built) + '。基準日は水曜（平日）・日曜（休日）のうち、各データの有効期間内で生成日以降の最初の日です。祝日・臨時ダイヤは反映していません。</p>';
    }
    h += '<h2>その他のデータ</h2><ul>' +
      '<li>人口: 政府統計の総合窓口（e-Stat）「令和2年国勢調査 地域メッシュ統計（250mメッシュ）」を500mメッシュに集約して作成。65歳以上人口は秘匿処理のため近隣メッシュに合算されている場合があります。</li>' +
      '<li>施設: 国土数値情報（医療機関データ P04-20［病院のみ］、学校データ P29-21［小学校・中学校］）（国土交通省）を加工して作成。施設の位置・存廃は現在と異なる場合があります。</li>' +
      '<li>地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li></ul>';
    h += '<h2>診断の前提と限界</h2><ul>' +
      '<li>「行ける」とは、指定時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可・乗継時間3分以上）→徒歩で、許容時間内に施設の近くへ着けること。待ち時間を含みます。</li>' +
      '<li>徒歩は直線距離の1.25倍を分速80mで歩くと仮定（道路網・坂・横断は未考慮）。乗車停留所は直線600m以内、降車停留所から施設は直線500m以内。施設まで直線800m以内は「徒歩圏」とし、公共交通なしで可とします。</li>' +
      '<li>運賃、予約が必要なデマンド交通の予約可否、バリアフリー、施設の診療時間・受付時間、帰りの便は評価していません。</li>' +
      '<li>診断範囲は、収録した停留所から' + (d ? d.params.diag_radius_m : 2000) + 'm以内の人口メッシュです。未収録事業者のみが走る地区は「空白」に見えることがあります。</li>' +
      '<li>診断は時刻表データに基づく計算であり、実際の遅延・運休を示すものではありません。結果は計画・検討の参考であり、個別の移動の保証ではありません。</li></ul>';
    $('about').innerHTML = h;
    $('modal').hidden = false;
    $('modal-close').focus();
  }
  function closeAbout() { $('modal').hidden = true; }

  window.App = { STATE: STATE, refresh: refresh, getMap: function () { return map; }, esc: esc, man: man, need: need,
    lonlat: lonlat, colors: COLORS };
  init();
})();
