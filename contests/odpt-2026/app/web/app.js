/* 生活アクセス診断マップ: 画面制御（MapLibre GL JS） */
(function () {
  'use strict';
  var L = window.Lib;
  /* 色覚に配慮: 赤と緑の対比を避け、青（行ける）とオレンジ（行けない）の明暗差で区別する（Okabe-Ito配色を基にした） */
  var COLORS = { walk: '#56B4E9', transit: '#0072B2', none: '#D55E00', rail: '#8c8c8c', lost: '#CC79A7' };
  var STATE = { index: null, data: null, cellIdx: null, fi: 0, day: 'wd', per: 'm', w: 20, marker: null, lost: null, req: 0 };
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
    if (typeof maplibregl === 'undefined') {
      $('summary').innerHTML = '<p class="note">地図の部品（MapLibre GL JS）を読み込めませんでした。ネットワーク（unpkg.com への接続）を確認して、ページを再読み込みしてください。</p>';
      return;
    }
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
      window.addEventListener('hashchange', function () {
        var h = /region=([a-z0-9_-]+)/.exec(location.hash);
        if (h && h[1] !== sel.value && idx.regions.some(function (r) { return r.id === h[1]; })) { sel.value = h[1]; loadRegion(h[1]); }
      });
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
    ['cells', 'nodes', 'routes', 'fac', 'rail'].forEach(function (k) {
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
      ['cells', 'routes', 'routes-hl', 'routes-wi', 'nodes', 'fac', 'rail'].forEach(function (s) {
        map.addSource(s, { type: 'geojson', data: empty });
      });
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: {
        'fill-color': ['match', ['get', 'st'], 'walk', COLORS.walk, 'transit', COLORS.transit, 'lost', COLORS.lost,
          'rail', COLORS.rail, COLORS.none],
        /* 人口の少ないメッシュは薄く、多いメッシュは濃く（面積の広い無人に近い地区が目立ちすぎないように） */
        'fill-opacity': ['interpolate', ['linear'], ['get', 'pop'], 0, 0.3, 50, 0.45, 300, 0.65],
        'fill-outline-color': 'rgba(255,255,255,0.35)' } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: {
        'line-color': '#444', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.8], 'line-opacity': 0.5 } });
      map.addLayer({ id: 'routes-hl', type: 'line', source: 'routes-hl', paint: {
        'line-color': '#1b4f8a', 'line-width': 3.5, 'line-opacity': 0.9 } });
      map.addLayer({ id: 'routes-wi', type: 'line', source: 'routes-wi', paint: {
        'line-color': '#B03A8C', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'nodes', type: 'circle', source: 'nodes', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3.5, 16, 7],
        'circle-color': '#999', 'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } });
      map.addLayer({ id: 'rail', type: 'circle', source: 'rail', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5],
        'circle-color': '#fff', 'circle-stroke-color': '#555', 'circle-stroke-width': 1.6 } });
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
    var v = { cells: 'lyr-cells', nodes: 'lyr-nodes', routes: 'lyr-routes', fac: 'lyr-fac', rail: 'lyr-rail' };
    Object.keys(v).forEach(function (k) {
      map.setLayoutProperty(k, 'visibility', $(v[k]).checked ? 'visible' : 'none');
    });
    map.setLayoutProperty('routes-hl', 'visibility', $('lyr-routes').checked ? 'visible' : 'none');
    map.setLayoutProperty('routes-wi', 'visibility', $('lyr-routes').checked ? 'visible' : 'none');
  }

  function loadRegion(id) {
    var req = ++STATE.req;   // 地域を素早く切り替えたとき、遅れて届いた古い応答を捨てるための通し番号
    $('summary').innerHTML = '<p class="note">読み込み中…</p>';
    $('headline').innerHTML = '';
    getJSON('data/' + id + '.json').then(function (d) {
      if (req !== STATE.req) return;
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
      renderCoverage();
      if (window.WhatIf) window.WhatIf.onRegion(STATE, d, refresh);
      refresh();
    }).catch(function (e) {
      if (req !== STATE.req) return;
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
    map.getSource('rail').setData({ type: 'FeatureCollection', features: (d.rail || []).map(function (r) {
      return { type: 'Feature', properties: { name: r[2], op: r[3] }, geometry: { type: 'Point', coordinates: [r[0], r[1]] } };
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
      return { type: 'Feature', properties: { st: lost && lost[k] ? 'lost' : L.cellStatus(c, STATE.fi, STATE.day, STATE.per, nd), pop: c[1] },
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

  function sw(color, label, extra) {
    return '<span class="lg"><span class="sw" style="background:' + color + (extra || '') + '"></span>' + label + '</span>';
  }

  function renderLegend() {
    var d = STATE.data;
    var fl = d.facility_labels[d.facility_order[STATE.fi]];
    $('legend').innerHTML = '<b>メッシュ（500m四方）の色</b><br>' +
      sw(COLORS.walk, '歩いて行ける') + sw(COLORS.transit, '公共交通で行ける') + sw(COLORS.none, '行けない') +
      sw(COLORS.rail, '鉄道駅が近い（鉄道は未評価）') + (STATE.lost ? sw(COLORS.lost, '路線を止めると行けなくなる') : '') +
      '<br><span class="note">濃いほど人口が多いメッシュです。</span><br>' +
      '<b>停留所の色（1日の発車本数）</b><br>' +
      [['#9e9e9e', '0'], ['#fdd49e', '1-5'], ['#fdbb84', '6-15'], ['#fc8d59', '16-40'], ['#e34a33', '41-100'], ['#b30000', '101+']]
        .map(function (c) { return sw(c[0], c[1]); }).join('') +
      '<br>' + sw(STATE.fi === 0 ? '#8e24aa' : '#f9a825', esc(fl), ';border-radius:50%') +
      sw('#fff', '鉄道駅（未収録）', ';border-radius:50%;border:1.6px solid #555');
  }

  /* 収録範囲の注記（主要画面に常時表示）。「データなし」を「行けない」と誤読させないため */
  function coverageText(d) {
    var c = d.coverage || {};
    var railModes = (c.modes || []).filter(function (m) { return m !== 'バス'; });
    var t = '収録しているのは' + esc((c.sources || []).join('・')) + 'のGTFS ' + c.feeds + '件（' + esc((c.modes || []).join('・')) + '）のみ。';
    t += railModes.length ? '鉄道は' + esc(railModes.join('・')) + 'のみ収録し、JR等そのほかの鉄道は未収録です。'
      : '鉄道（JR等）は未収録です。';
    t += 'デマンド交通・予約制の便も未収録です。';
    if (c.rail_checked) {
      t += '<br>未収録の鉄道の駅から徒歩' + d.params.rail_walk_min + '分圏で行けない地区は、赤ではなく灰色「鉄道駅が近い（未評価）」にしています。';
    }
    return t;
  }

  function renderCoverage() {
    var d = STATE.data;
    $('coverage').innerHTML = '<b>診断の範囲</b>　' + coverageText(d);
    // フィードの有効期限（今この画面を開いた日で判定する）
    var today = new Date();
    var iso = today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) + '-' + ('0' + today.getDate()).slice(-2);
    var expiredNow = d.feeds.filter(function (f) { return f.valid[1] && f.valid[1] < iso; });
    var soon = d.feeds.filter(function (f) { return f.valid[1] && f.valid[1] >= iso && f.valid[1] < d.public_until; });
    var msg = '';
    if (expiredNow.length) {
      msg += '有効期間が切れたデータが' + expiredNow.length + '件あります（' + esc(expiredNow.map(function (f) { return f.org + ' ' + f.valid[1]; }).slice(0, 3).join('、')) +
        (expiredNow.length > 3 ? ' ほか' : '') + '）。ダイヤが変わっている可能性があり、この診断は現在の運行を示しません。';
    } else if (soon.length) {
      var first = soon.map(function (f) { return f.valid[1]; }).sort()[0];
      msg += soon.length + '件のデータは' + first + 'から順に有効期間が終わります。切れた後は最新のGTFSで作り直す必要があります。';
    }
    var el = $('data-warn');
    el.hidden = !msg;
    el.innerHTML = msg ? '<b>データの期限</b>　' + msg : '';
  }

  /* ---------- 集計 ---------- */
  function renderSummary() {
    var d = STATE.data, nd = need();
    var s = L.summarize(d.cells, STATE.fi, STATE.day, STATE.per, nd);
    var okp = L.pct(s.walk + s.transit, s.pop);
    var ok65 = L.pct(s.walk65 + s.transit65, s.pop65);
    var fl = d.facility_labels[d.facility_order[STATE.fi]];
    var cond = esc(L.DAY_LABEL[STATE.day]) + esc(L.PERIOD_LABEL[STATE.per]) + d.params.start_hours[STATE.per] + '時に出発して<b>' + STATE.w + '分以内</b>に' + esc(fl) + 'へ';
    var h = '<p class="big">' + cond + '歩くか収録した公共交通で行ける人は<br><b>' + okp + '%</b>' +
      '（診断範囲の人口 ' + man(s.pop) + '）</p>';
    h += '<div class="bar" role="img" aria-label="歩いて行ける ' + L.pct(s.walk, s.pop) + '%、公共交通で行ける ' + L.pct(s.transit, s.pop) +
      '%、鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%、行けない ' + L.pct(s.none, s.pop) + '%">' +
      '<i class="w" style="width:' + L.pct(s.walk, s.pop) + '%"></i><i class="t" style="width:' + L.pct(s.transit, s.pop) + '%"></i>' +
      '<i class="r" style="width:' + L.pct(s.rail, s.pop) + '%"></i><i class="n" style="width:' + L.pct(s.none, s.pop) + '%"></i></div>';
    h += '<div class="keys"><span style="--c:' + COLORS.walk + '">歩いて ' + L.pct(s.walk, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.transit + '">公共交通で ' + L.pct(s.transit, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.rail + '">鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.none + '">行けない ' + L.pct(s.none, s.pop) + '%</span></div>';
    h += '<p class="note">「行けない」は、' + STATE.w + '分以内に歩いても、収録した公共交通を使っても着けない場合だけです。65歳以上では ' + ok65 + '%（' + man(s.pop65) + '）が行ける。</p>';
    // 平日/休日 × 朝昼夕の比較
    h += '<table><caption class="note">行ける人の割合（' + STATE.w + '分以内・' + esc(fl) + '）</caption><tr><th></th>' +
      L.PERIODS.map(function (p) { return '<th>' + L.PERIOD_LABEL[p] + d.params.start_hours[p] + '時</th>'; }).join('') + '</tr>';
    L.DAYS.forEach(function (dy) {
      h += '<tr><th>' + L.DAY_LABEL[dy] + '</th>';
      L.PERIODS.forEach(function (p) {
        var t = L.summarize(d.cells, STATE.fi, dy, p, nd);
        h += '<td' + (dy === STATE.day && p === STATE.per ? ' class="cur"' : '') + '>' + L.pct(t.walk + t.transit, t.pop) + '%</td>';
      });
      h += '</tr>';
    });
    h += '</table><p class="note">診断範囲: 収録した停留所から' + d.params.diag_radius_m + 'm以内の人口メッシュ。徒歩は直線×' + d.params.detour +
      '÷分速' + d.params.walk_m_per_min + 'mで換算し、許容時間内に歩いて着けるなら「歩いて行ける」。</p>';
    $('summary').innerHTML = h;
    // スマホで最初に結論が見えるよう、パネル上部に固定表示する
    $('headline').innerHTML = '<span class="hl-cond">' + esc(L.DAY_LABEL[STATE.day]) + esc(L.PERIOD_LABEL[STATE.per]) + d.params.start_hours[STATE.per] + '時・' +
      STATE.w + '分以内・' + esc(fl) + '</span><span class="hl-num">行ける <b>' + okp + '%</b></span>' +
      '<span class="hl-sub">行けない ' + L.pct(s.none, s.pop) + '%／鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%</span>' +
      '<span class="hl-sub">収録はGTFS ' + d.coverage.feeds + '件のみ。' + (d.coverage.modes.length > 1 ? '' : 'JR等の鉄道は未収録。') + '</span>';
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
      if (c[5]) h += '<p class="note">未収録の鉄道の駅から徒歩' + d.params.rail_walk_min + '分圏です。鉄道を使えば行ける可能性がありますが、本アプリは評価していません。</p>';
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
      var wl = +String(c[4]).charAt(fi);   // 徒歩だけで着ける水準
      L.DAYS.forEach(function (dy) {
        L.PERIODS.forEach(function (p) {
          var lv = +c[3][L.condIndex(fi, dy, p)];
          if (wl > 0 && wl >= lv) h += '<td class="lw">' + esc(L.levelLabel(wl, d.params.thresholds)) + '<br>徒歩</td>';
          else if (lv === 0 && c[5]) h += '<td class="lr">鉄道駅が近い</td>';
          else h += '<td class="l' + lv + '">' + esc(L.levelLabel(lv, d.params.thresholds)) + '</td>';
        });
      });
      h += '</tr>';
    });
    return h + '</table><p class="note">朝8時・昼12時・夕17時に出発して、最短で何分以内に着けるか（待ち時間・乗継を含む）。×は60分以内に歩いても収録した公共交通でも着けない。「鉄道駅が近い」は、未収録の鉄道があるため評価していない。</p>';
  }

  /* ---------- 出典・前提 ---------- */
  function openAbout() {
    var d = STATE.data;
    var h = '<h2 id="about-title" style="margin-top:0">出典・ライセンス・診断の前提</h2>';
    h += '<p>本アプリは、収録した事業者・地域のデータだけで診断しています。<b>全国を網羅するものではありません</b>（JR・大手民営鉄道等、GTFSデータリポジトリ・公共交通オープンデータセンターから収録していない事業者は含みません）。</p>';
    if (d) {
      h += '<h2>この地域（' + esc(d.name) + '）に収録したGTFSデータ</h2>';
      h += '<p>出典: ' + (d.coverage.sources.indexOf('GTFSデータリポジトリ') >= 0 ? '<a href="https://www.gtfs-data.jp/" target="_blank" rel="noopener">GTFSデータリポジトリ</a>' : '') +
        (d.coverage.sources.length > 1 ? '、' : '') +
        (d.coverage.sources.indexOf('公共交通オープンデータセンター') >= 0 ? '<a href="https://www.odpt.org/" target="_blank" rel="noopener">公共交通オープンデータセンター</a>（公開API https://api-public.odpt.org/api/v4/ 、キー不要）' : '') +
        '。各データは事業者がそれぞれのライセンスで公開しており、本アプリでは停留所の集約・本数集計・到達時間の計算という加工を行っています。</p>';
      h += '<table><tr><th>事業者</th><th>データ名</th><th>取得元</th><th>ライセンス・クレジット</th><th>更新日</th><th>データ有効期間</th><th>診断の基準日（平日/休日）</th></tr>';
      d.feeds.forEach(function (f) {
        var warn = f.expired ? ' <b class="warn">期限切れ</b>' : (f.ends_before_public_end ? ' <b class="warn">公開期間（〜' + esc(d.public_until) + '）の途中で終了</b>' : '');
        h += '<tr><td><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.org) + '</a></td><td>' + esc(f.name) + '</td><td>' +
          (f.source === 'odpt' ? '公共交通オープンデータセンター' : 'GTFSデータリポジトリ') + '</td><td>' +
          (f.license_url ? '<a href="' + esc(f.license_url) + '" target="_blank" rel="noopener">' + esc(f.license) + '</a>' : esc(f.license)) +
          (f.credit ? '<br>クレジット: ' + esc(f.credit) : '') +
          '</td><td>' + esc(f.updated) + '</td><td>' + esc((f.valid[0] || '?') + '〜' + (f.valid[1] || '?')) + warn + '</td><td>' +
          esc(f.ref.wd + ' / ' + f.ref.hol) + '</td></tr>';
      });
      h += '</table><p class="note">データ生成日: ' + esc(d.built) + '。基準日は水曜（平日）・日曜（休日）のうち、各データの有効期間内で生成日以降の最初の日です。祝日・臨時ダイヤは反映していません。</p>';
    }
    h += '<h2>その他のデータ</h2><ul>' +
      '<li>鉄道駅: 国土数値情報「鉄道データ」N02-22（国土交通省、令和4年12月31日時点）を加工して作成。GTFSに収録していない鉄道の駅の位置を地図に示し、駅から徒歩' + (d ? d.params.rail_walk_min : 15) + '分圏の地区を「鉄道駅が近い（未評価）」とするためだけに使っています（時刻表・運行は使っていません）。新設駅・廃止駅は反映されていない場合があります。</li>' +
      '<li>人口: 政府統計の総合窓口（e-Stat）「令和2年国勢調査 地域メッシュ統計（250mメッシュ）」を500mメッシュに集約して作成。65歳以上人口は秘匿処理のため近隣メッシュに合算されている場合があります。</li>' +
      '<li>施設: 国土数値情報（医療機関データ P04-20［病院のみ］、学校データ P29-21［小学校・中学校］）（国土交通省）を加工して作成。施設の位置・存廃は現在と異なる場合があります。</li>' +
      '<li>地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li></ul>';
    h += '<h2>診断の前提と限界</h2><ul>' +
      '<li>「行ける」とは、指定時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可・乗継時間3分以上）→徒歩で、許容時間内に施設の近くへ着けること。待ち時間を含みます。</li>' +
      '<li>徒歩は直線距離の1.25倍を分速80mで歩くと仮定（道路網・坂・横断は未考慮）。乗車停留所は直線600m以内、降車停留所から施設は直線500m以内。公共交通を使わなくても、同じ徒歩モデルで許容時間内に施設へ歩いて着ければ「歩いて行ける」とします。「行けない」は、歩いても収録した公共交通を使っても許容時間内に着けない場合だけです。</li>' +
      '<li>GTFSに収録していない鉄道（JR・民鉄等）とデマンド交通は評価していません。そのため、鉄道駅の近くで「行けない」となる地区は赤にせず灰色「鉄道駅が近い（未評価）」で示しています。「行けない」の中にも、未収録のバスや予約制の便で行ける地区が含まれることがあります。</li>' +
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
