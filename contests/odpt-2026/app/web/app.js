/* 生活アクセス診断マップ: 画面制御（MapLibre GL JS） */
(function () {
  'use strict';
  var L = window.Lib;
  /* 色覚に配慮: 赤と緑の対比を避け、青（行ける）とオレンジ（行けない）の明暗差で区別する（Okabe-Ito配色を基にした） */
  var COLORS = { walk: '#56B4E9', transit: '#0072B2', none: '#D55E00', rail: '#8c8c8c', lost: '#CC79A7' };
  var STATE = { index: null, data: null, cellIdx: null, fi: 0, day: 'wd', per: 'm', w: 20, marker: null, popup: null, lost: null, req: 0, pt: null, pendingPt: null, pendingRoute: null, compare: null };
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

  /* 読み込み・表示の失敗を利用者向けの日本語で示し、再読み込みボタンを出す（技術的な詳細は小さく添える） */
  function showFail(what, e) {
    var el = $('summary');
    if (!el) return;
    el.innerHTML = '<div class="notice warn"><b>' + what + 'を表示できませんでした。</b><br>通信の不調や、古い画面が残っていることが原因の場合があります。' +
      '下のボタンでページを読み込み直してください。<br><button type="button" id="btn-reload">ページを読み込み直す</button>' +
      '<br><span class="note">詳細: ' + esc(e && e.message) + '</span></div>';
    var b = $('btn-reload');
    if (b) b.addEventListener('click', function () { location.reload(); });
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
      var hs = L.parseHash(location.hash);
      var known = function (id) { return idx.regions.some(function (r) { return r.id === id; }); };
      var start = hs.region && known(hs.region) ? hs.region : idx.regions[0].id;
      if (hs.region && known(hs.region)) {
        if (hs.fi != null) STATE.fi = hs.fi;
        if (hs.day) STATE.day = hs.day;
        if (hs.per) STATE.per = hs.per;
        if (hs.w) STATE.w = hs.w;
        STATE.pendingRoute = hs.route != null ? hs.route : null;
        STATE.pendingPt = hs.pt || null;
      }
      sel.value = start;
      buildRegionSeg(idx, start);
      sel.addEventListener('change', function () { selectRegion(sel.value); });
      window.addEventListener('hashchange', function () {
        var h = L.parseHash(location.hash);
        if (h.region && h.region !== sel.value && known(h.region)) { selectRegion(h.region); }
      });
      var sr = idx.regions.filter(function (r) { return r.id === start; })[0];
      initMap(sr, function () { loadRegion(start); });
    }).catch(function (e) {
      showFail('診断画面', e);
    });
    $('search-form').addEventListener('submit', function (e) { e.preventDefault(); doSearch($('search-q').value); });
    $('btn-compare').addEventListener('click', runCompare);
    $('btn-share').addEventListener('click', function () { copyText(shareUrl(), 'share-msg'); });
    $('btn-cite').addEventListener('click', function () { copyText($('cite-text').value, 'cite-msg'); });
    Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function (b) {
      b.addEventListener('click', function () { goSection(b.getAttribute('data-go')); });
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

  function selectRegion(id) {
    STATE.pendingRoute = null; STATE.pendingPt = null;
    $('region').value = id;
    loadRegion(id);
  }

  /* 地域をボタンで並べ、いまの地域が分かるようにする（選択はhiddenのselectにも反映） */
  function buildRegionSeg(idx, cur) {
    seg($('region-seg'), idx.regions.map(function (r) { return { value: r.id, label: L.shortName(r.name) }; }), cur,
      function (v) { selectRegion(v); });
    setRegionNow(cur);
  }
  function setRegionNow(id) {
    var r = STATE.index.regions.filter(function (x) { return x.id === id; })[0];
    $('region-now').textContent = r ? L.shortName(r.name) : '';
    $('region').value = id;
    var els = $('region-seg').children;
    for (var i = 0; i < els.length; i++) els[i].setAttribute('aria-checked', String(STATE.index.regions[i].id === id));
  }

  function goSection(k) {
    if (k === 'about') { openAbout(); return; }
    var el = $(k);
    if (!el || el.hidden) {
      if (k === 'whatif' && $('summary')) { $('summary').insertAdjacentHTML('afterbegin', '<p class="note">「路線を止めたら？」はこの地域のデータを読み込み中、または用意がありません。</p>'); }
      return;
    }
    $('panel').classList.remove('closed');
    document.body.classList.remove('sheet-closed');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 移動先が分かるよう、一瞬枠を光らせる
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  /* 手元の確認用サーバー（localhost等）のURLは他の人が開けないので、例文では差し替える */
  function isLocalHost() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:'; }
  function pageUrl() { return isLocalHost() ? '公開URLをここに記入' : location.href.replace(/#.*$/, ''); }
  function shareUrl() { return isLocalHost() ? location.href + '\n※いまは手元の確認用アドレスです。公開後のアドレスで共有してください。' : location.href; }

  function copyText(text, msgId) {
    var msg = $(msgId);
    function ok() { msg.textContent = 'コピーしました'; }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? ok() : (msg.textContent = 'コピーできませんでした。手動で選択してコピーしてください'); }
      catch (e) { msg.textContent = 'コピーできませんでした。手動で選択してコピーしてください'; }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }

  function initMap(region, cb) {
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
      center: region.center, zoom: 10, attributionControl: { compact: true }
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
        'fill-opacity': ['case', ['==', ['get', 'st'], 'lost'], 0.95, ['interpolate', ['linear'], ['get', 'pop'], 0, 0.3, 50, 0.45, 300, 0.65]],
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
      if (STATE.fi >= d.facility_order.length) STATE.fi = 0;
      if (d.params.thresholds.indexOf(STATE.w) < 0) STATE.w = d.params.thresholds[0];
      setRegionNow(id);
      STATE.pt = null;
      if ($('pt-bar')) { $('pt-bar').hidden = true; $('pt-bar').innerHTML = ''; }
      buildControls();
      buildStaticLayers();
      var b = d.bbox;
      var mobile = window.matchMedia('(max-width: 720px)').matches;
      var pad = mobile ? { top: 20, left: 20, right: 20, bottom: Math.round(window.innerHeight * 0.56) + 20 }
        : { top: 20, left: 400, right: 20, bottom: 20 };
      var pp = STATE.pendingPt; STATE.pendingPt = null;
      if (!pp) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: pad, duration: 600 });
      else map.jumpTo({ center: pp, zoom: 14, padding: pad });
      if (STATE.marker) { STATE.marker.remove(); STATE.marker = null; }
      if (STATE.popup) { STATE.popup.remove(); STATE.popup = null; }
      map.getSource('routes-hl').setData({ type: 'FeatureCollection', features: [] });
      map.getSource('routes-wi').setData({ type: 'FeatureCollection', features: [] });
      STATE.lost = null;
      $('detail').innerHTML = '<h2>地点の診断</h2><p class="note">地図をタップするか、上の検索で住所・駅名を入れると、その地点から病院などへ行けるかを一言で答えます。</p>';
      $('region-note').textContent = d.reason;
      $('search-q').placeholder = '例: ' + ({ kumamoto: '熊本駅、熊本市中央区水前寺', toyama: '富山駅、富山市大町', tokushima: '徳島駅、徳島市幸町', iida: '飯田駅、飯田市主税町', tokyo: '王子駅、北区赤羽' }[d.id] || '駅名や住所');
      renderCoverage();
      $('cite-text').value = L.citationText(d, { url: pageUrl(), date: todayIso() });
      if (window.WhatIf) window.WhatIf.onRegion(STATE, d, refresh);
      refresh();
      if (pp) diagnose(pp[0], pp[1], { scroll: false });
    }).catch(function (e) {
      if (req !== STATE.req) return;
      showFail('地域のデータ', e);
    });
  }

  function buildControls() {
    var d = STATE.data;
    seg($('ctl-facility'), d.facility_order.map(function (k, i) { return { value: i, label: d.facility_labels[k] }; }),
      STATE.fi, function (v) { STATE.fi = v; refresh(); });
    seg($('ctl-day'), L.DAYS.map(function (k) { return { value: k, label: L.DAY_FULL[k] }; }),
      STATE.day, function (v) { STATE.day = v; refresh(); });
    seg($('ctl-period'), L.PERIODS.map(function (k) {
      return { value: k, label: L.PERIOD_LABEL[k] + d.params.start_hours[k] + '時' };
    }), STATE.per, function (v) { STATE.per = v; refresh(); });
    seg($('ctl-w'), d.params.thresholds.map(function (w) { return { value: w, label: w + '分' }; }),
      STATE.w, function (v) { STATE.w = v; refresh(); });
  }

  function todayIso() {
    var t = new Date();
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  }

  function writeHash() {
    if (!STATE.data) return;
    var r = window.WhatIf && window.WhatIf.getSelected ? window.WhatIf.getSelected() : null;
    if (r == null && STATE.pendingRoute != null) r = STATE.pendingRoute;   // 路線の復元が終わるまで URL から落とさない
    history.replaceState(null, '', L.writeHash({ region: STATE.data.id, fi: STATE.fi, day: STATE.day, per: STATE.per, w: STATE.w, route: r, pt: STATE.pt }));
    if ($('cite-text')) $('cite-text').value = L.citationText(STATE.data, { url: pageUrl(), date: todayIso() });
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
    if (STATE.pt) diagnose(STATE.pt[0], STATE.pt[1], { keepView: true });
    renderSummary();
    renderLegend();
    if (STATE.compare) renderCompare();
    writeHash();
  }

  function sw(color, label, extra) {
    return '<span class="lg"><span class="sw" style="background:' + color + (extra || '') + '"></span>' + label + '</span>';
  }

  function renderLegend() {
    if ($('ml-lost')) $('ml-lost').hidden = !STATE.lost;
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
      sw('#fff', '鉄道駅（未収録）', ';border-radius:50%;border:1.6px solid #555') +
      '<ul class="terms"><li>メッシュ: 地図を約500m四方に区切った区画。人口はこの単位で数えています。</li>' +
      '<li>GTFS: バスなどの時刻表・停留所を、決まった形式で公開したオープンデータ。</li>' +
      '<li>歩いて行ける／公共交通で行ける: 許容時間内に、歩きだけで／バス等に乗って着けること。</li>' +
      '<li>行けない: 歩いても、収録した公共交通でも許容時間内に着けない（未収録の便は含まない）。</li>' +
      '<li>休日: 日曜のダイヤで計算（祝日ダイヤは未反映）。</li></ul>';
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
    var h = '<h2 class="sum-h">地域全体の結果<span class="note">（' + esc(L.shortName(d.name)) + 'の診断範囲に住む人全体。選んだ地点の結果ではありません）</span></h2>';
    h += '<p class="big">' + cond + '歩くか収録した公共交通で行ける人は<br><b>' + okp + '%</b>' +
      '（診断範囲の人口 ' + man(s.pop) + '）</p>';
    h += '<div class="bar" role="img" aria-label="歩いて行ける ' + L.pct(s.walk, s.pop) + '%、公共交通で行ける ' + L.pct(s.transit, s.pop) +
      '%、鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%、行けない ' + L.pct(s.none, s.pop) + '%">' +
      '<i class="w" style="width:' + L.pct(s.walk, s.pop) + '%"></i><i class="t" style="width:' + L.pct(s.transit, s.pop) + '%"></i>' +
      '<i class="r" style="width:' + L.pct(s.rail, s.pop) + '%"></i><i class="n" style="width:' + L.pct(s.none, s.pop) + '%"></i></div>';
    h += '<div class="keys"><span style="--c:' + COLORS.walk + '">歩いて ' + L.pct(s.walk, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.transit + '">公共交通で ' + L.pct(s.transit, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.rail + '">鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%</span>' +
      '<span style="--c:' + COLORS.none + '">行けない ' + L.pct(s.none, s.pop) + '%</span></div>';
    h += '<table class="ng65"><caption class="note" style="text-align:left">行けない人（' + STATE.w + '分以内に歩いても、収録した公共交通でも着けない）</caption>' +
      (d.facility_order[STATE.fi] === 'school'
        ? '<tr><th>全体（住民の人数。児童・生徒数ではありません）</th></tr><tr><td><b>' + s.none.toLocaleString('ja-JP') + '人</b>（' + L.pct(s.none, s.pop) + '%）</td></tr></table>'
        : '<tr><th>全体</th><th>65歳以上</th></tr>' +
          '<tr><td><b>' + s.none.toLocaleString('ja-JP') + '人</b>（' + L.pct(s.none, s.pop) + '%）</td>' +
          '<td><b>' + s.none65.toLocaleString('ja-JP') + '人</b>（' + L.pct(s.none65, s.pop65) + '%）</td></tr></table>') +
      '<p class="note">パーセントは、診断範囲の人口（全体 ' + man(s.pop) + '／65歳以上 ' + man(s.pop65) + '）に対する割合。「鉄道駅が近い（未評価）」の人は含みません。65歳以上で行ける人は ' + ok65 + '%。' +
      '代替交通・デマンド交通・減便は考慮していません。</p>';
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
    if (d.facility_order[STATE.fi] === 'school' && STATE.per !== 'm') {
      h += '<p class="note"><b>学校の昼・夕について:</b> 「その時刻に家を出て学校へ向かう」場合の値です。下校（学校から家へ帰る向き）は評価していません。通学は朝8時の値を見てください。</p>';
    }
    $('summary').innerHTML = h;
    // スマホで最初に結論が見えるよう、パネル上部に固定表示する
    $('headline').innerHTML = '<span class="hl-cond">' + esc(L.DAY_LABEL[STATE.day]) + esc(L.PERIOD_LABEL[STATE.per]) + d.params.start_hours[STATE.per] + '時・' +
      STATE.w + '分以内・' + esc(fl) + '</span><span class="hl-num">行ける <b>' + okp + '%</b></span>' +
      '<span class="hl-sub">行けない ' + L.pct(s.none, s.pop) + '%／鉄道駅が近い（未評価） ' + L.pct(s.rail, s.pop) + '%</span>' +
      '<span class="hl-sub">収録はGTFS ' + d.coverage.feeds + '件のみ。' + (d.coverage.modes.length > 1 ? '' : 'JR等の鉄道は未収録。') + '</span>';
  }

  /* ---------- 地点の診断 ---------- */
  function onMapClick(e) { diagnose(e.lngLat.lng, e.lngLat.lat, { scroll: true }); }

  function diagnose(lon, lat, opt) {
    var d = STATE.data;
    if (!d) return;
    STATE.pt = [lon, lat];
    if (STATE.marker) STATE.marker.remove();
    STATE.marker = new maplibregl.Marker({ color: '#1b4f8a' }).setLngLat([lon, lat]).addTo(map);
    var code = L.meshCodeAt(lon, lat);
    var ci = STATE.cellIdx[code];
    var h = '<h2>地点の診断</h2>';
    var vd = null;
    if (ci != null) {
      vd = L.verdict(d.cells[ci], { fi: STATE.fi, day: STATE.day, per: STATE.per, w: STATE.w, thresholds: d.params.thresholds,
        startHours: d.params.start_hours, facLabel: d.facility_labels[d.facility_order[STATE.fi]] });
      h += '<div class="verdict' + (vd.ok ? '' : ' no') + '"><p class="v-main">' + esc(vd.main) + '</p><p class="v-cmp">' + esc(vd.cmp + vd.extra) + '</p></div>';
    } else {
      h += '<div class="verdict no"><p class="v-main">この地点は診断範囲外です</p><p class="v-cmp">収録した停留所から' + d.params.diag_radius_m + 'm以内の人口メッシュだけを診断しています。</p></div>';
    }
    var bar = $('pt-bar');
    bar.hidden = false;
    bar.innerHTML = '<span class="pt-lbl">選んだ地点</span> <b>' + esc(vd ? vd.short : '診断範囲外') + '</b>' +
      '<button type="button" id="pt-goto">詳しく見る</button><button type="button" id="pt-share">結果の要約とリンクをコピー</button><span id="pt-msg" class="note"></span>';
    $('pt-goto').addEventListener('click', function () { $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    var ptSummary = (vd ? vd.main + '。' + vd.cmp : 'この地点は診断範囲外です。') + '\n' + shareUrl() + '\n（生活アクセス診断マップ。時刻表データによる推計で、実際の運行を保証するものではありません）';
    $('pt-share').addEventListener('click', function () { copyText(ptSummary, 'pt-msg'); });
    if (STATE.popup) STATE.popup.remove();
    STATE.popup = new maplibregl.Popup({ offset: [0, -36], maxWidth: '240px', closeOnClick: false })
      .setLngLat([lon, lat]).setText(vd ? vd.short : '診断範囲外（停留所から遠い、または人口データなし）').addTo(map);
    if (ci == null) {
      h += '<p class="note">この地点は診断範囲外です（停留所から' + d.params.diag_radius_m + 'm超、または人口データなし）。</p>';
    } else {
      var c = d.cells[ci];
      h += '<p class="note">この500mメッシュ: 人口 ' + c[1] + '人（65歳以上 ' + c[2] + '人。秘匿処理により近隣メッシュ分を含む／欠ける場合あり）</p>';
      if (c[5]) h += '<p class="note">未収録の鉄道の駅から徒歩' + d.params.rail_walk_min + '分圏です。鉄道を使えば行ける可能性がありますが、本アプリは評価していません。</p>';
      h += diagTable(c);
    }
    var near = L.nearbyNodes(d.nodes, lon, lat, d.params.walk_in_m, 6);
    var labels = L.stopLabels(d.nodes, near, d.routes);
    var hl = {};
    if (!near.length) {
      h += '<p><b>半径' + d.params.walk_in_m + 'm以内に停留所がありません。</b>公共交通の空白地の可能性があります（収録事業者のみ対象）。</p>';
    } else {
      h += '<h2>近くの停留所（' + d.params.walk_in_m + 'm以内）</h2>';
      var lastOf = function (k) {
        var best = null;
        near.forEach(function (o) { var n = d.nodes[o.i], t = n[k][5]; if (n[k][3] > 0 && t != null && (best == null || t > best.t)) best = { t: t, name: n[2] || '(名称なし)', m: Math.round(o.d) }; });
        return best ? '<b>' + L.fmtMin(best.t) + '</b> まで（' + esc(best.name) + '・約' + best.m + 'm）' : '運行なし';
      };
      h += '<p class="lastbus">バスや電車は何時まで？（' + d.params.walk_in_m + 'm以内の停留所で一番遅い最終便）<br>平日 ' + lastOf(3) + '<br>休日 ' + lastOf(4) + '</p>';
      h += '<p class="note">1日の本数のうち、朝は6-9時・昼は9-16時・夕は16-20時の発車数（それ以外の時間帯の便は1日の本数にだけ含みます）。最終はその日の最後の発車時刻（基準日の時刻表）。</p>';
      near.forEach(function (o, k) {
        var n = d.nodes[o.i];
        n[5].forEach(function (r) { hl[r] = 1; });
        h += '<div class="stop"><b>' + esc(labels[k]) + '</b>（約' + Math.round(o.d) + 'm）<br>' +
          '平日 1日' + n[3][3] + '本（うち朝' + n[3][0] + '／昼' + n[3][1] + '／夕' + n[3][2] + '）、最終 ' + L.fmtMin(n[3][5]) + '<br>' +
          '休日 1日' + n[4][3] + '本（うち朝' + n[4][0] + '／昼' + n[4][1] + '／夕' + n[4][2] + '）、最終 ' + L.fmtMin(n[4][5]) + '<br>' +
          '<span class="note">' + L.nodeFacts(n).map(esc).join('。') + '。路線: ' +
          esc(n[5].slice(0, 5).map(function (r) { return d.routes[r][0]; }).join('、')) + (n[5].length > 5 ? ' ほか' + (n[5].length - 5) + '路線' : '') +
          '</span></div>';
      });
    }
    $('detail').innerHTML = h;
    var feats = d.patterns.filter(function (p) { return hl[p[0]]; }).map(function (p) {
      return { type: 'Feature', properties: { r: p[0] },
        geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return lonlat(d.nodes[i]); }) } };
    });
    map.getSource('routes-hl').setData({ type: 'FeatureCollection', features: feats });
    writeHash();
    if (opt && opt.scroll) {
      $('panel').classList.remove('closed');
      document.body.classList.remove('sheet-closed');
      $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- 住所・駅名検索（国土地理院 地名検索API。キー不要・GETのみ） ---------- */
  function doSearch(q) {
    q = String(q || '').trim();
    var out = $('search-result');
    if (!q) { out.textContent = '住所や駅名を入力してください。'; return; }
    out.textContent = '検索中…';
    fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q))
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
      .then(function (j) {
        var cur = STATE.data && STATE.data.id;
        var rs = L.parseGsi(j);
        rs.forEach(function (r) { r.rid = L.regionForPoint(STATE.index.regions, r.lon, r.lat); });
        rs = rs.map(function (r, i) { return { r: r, k: (r.rid === cur ? 0 : r.rid ? 1 : 2) * 10000 + i }; })
          .sort(function (a, b) { return a.k - b.k; }).map(function (x) { return x.r; }).slice(0, 5);
        if (!rs.length) { out.textContent = '「' + q + '」に該当する場所が見つかりませんでした。'; return; }
        out.innerHTML = '';
        var first = null;
        rs.forEach(function (r, i) { if (first == null && r.rid) first = i; });
        if (first == null) {
          out.innerHTML = '見つかった場所（' + esc(rs[0].title) + '）は、収録している5地域（' +
            esc(STATE.index.regions.map(function (x) { return L.shortName(x.name); }).join('・')) + '）の範囲外です。';
          return;
        }
        goToResult(rs[first]);
        if (rs.length > 1) {
          var p = document.createElement('div');
          p.innerHTML = '他の候補:';
          out.appendChild(p);
          rs.forEach(function (r, i) {
            if (i === first) return;
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = r.title + (r.rid ? '' : '（収録範囲外）');
            b.disabled = !r.rid;
            b.addEventListener('click', function () { goToResult(r); });
            out.appendChild(b);
          });
        }
      })
      .catch(function () { out.textContent = '検索できませんでした（国土地理院の地名検索に接続できません）。ネットワークを確認してください。'; });
  }

  function goToResult(r) {
    var shown = $('search-result');
    var head = shown.querySelector('.hit');
    if (!head) { head = document.createElement('div'); head.className = 'hit'; shown.insertBefore(head, shown.firstChild); }
    var name = (STATE.index.regions.filter(function (x) { return x.id === r.rid; })[0] || {}).name || '';
    head.innerHTML = '<b>' + esc(r.title) + '</b>（' + esc(L.shortName(name)) + '）を調べました。地図と「地点の診断」を見てください。';
    var mobile = window.matchMedia('(max-width: 720px)').matches;
    var pad = mobile ? { top: 20, left: 20, right: 20, bottom: Math.round(window.innerHeight * 0.56) + 20 } : { top: 20, left: 400, right: 20, bottom: 20 };
    if (STATE.data && STATE.data.id === r.rid) {
      map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 14), padding: pad, duration: 600 });
      diagnose(r.lon, r.lat, { scroll: true });
    } else {
      STATE.pendingPt = [r.lon, r.lat]; STATE.pendingRoute = null;
      loadRegion(r.rid);
    }
  }

  /* ---------- 地域比較（押したときだけ全地域を読む） ---------- */
  function runCompare() {
    var btn = $('btn-compare');
    btn.disabled = true;
    $('compare-result').innerHTML = '<p class="note">5地域のデータを読み込み中…</p>';
    Promise.all(STATE.index.regions.map(function (r) { return getJSON('data/' + r.id + '.json'); })).then(function (all) {
      STATE.compare = all;
      renderCompare();
      btn.disabled = false;
      btn.textContent = '条件を変えたら、表も自動で更新されます';
    }).catch(function (e) {
      btn.disabled = false;
      $('compare-result').innerHTML = '<p class="note">比較用のデータを読み込めませんでした: ' + esc(e.message) + '</p>';
    });
  }

  function renderCompare() {
    var d = STATE.data;
    var key = d.facility_order[STATE.fi];
    var fl = d.facility_labels[key];
    var h = '<p class="note"><b>条件: ' + esc(L.DAY_FULL[STATE.day]) + esc(L.PERIOD_LABEL[STATE.per]) + d.params.start_hours[STATE.per] + '時発・' + STATE.w + '分以内・' + esc(fl) + '</b></p>';
    h += '<p class="notice warn" style="margin:4px 0"><b>注意:</b> 地域ごとに収録している交通機関が違うため、この表は地域の優劣を示しません（詳しくは表の下）。</p>';
    h += '<table><tr><th>地域</th><th>行ける割合</th><th>行けない人（全体）</th><th>行けない人（65歳以上）</th></tr>';
    STATE.compare.forEach(function (c) {
      var r = L.compareRow(c, key, STATE.day, STATE.per, STATE.w);
      h += '<tr><td>' + esc(L.shortName(c.name)) + '</td>';
      if (!r) { h += '<td colspan="3">この条件は未計算</td></tr>'; return; }
      h += '<td><b>' + r.okPct + '%</b></td><td>' + r.none.toLocaleString('ja-JP') + '人（' + r.nonePct + '%）</td><td>' +
        r.none65.toLocaleString('ja-JP') + '人（' + r.none65Pct + '%）</td></tr>';
    });
    h += '</table>';
    h += '<p class="note"><b>比べるときの注意:</b> 収録している事業者・交通手段が地域ごとに違います。';
    h += STATE.compare.map(function (c) {
      var ir = STATE.index.regions.filter(function (x) { return x.id === c.id; })[0];
      return esc(L.shortName(c.name)) + '＝' + esc((ir.operators || []).join('・')) + '（' + esc(c.coverage.modes.join('・')) + '）';
    }).join('、') + '。';
    h += 'たとえば東京は都営（東京都交通局）のみ、飯田・下伊那は南信州地域のバスのみで、民営バスやJR等は含みません。数字は地域の優劣ではなく「収録した範囲での診断」の違いです。割合・人数は、各地域の診断範囲（収録停留所から' + d.params.diag_radius_m + 'm以内）の人口が分母です。</p>';
    $('compare-result').innerHTML = h;
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
        var warn = f.expired ? ' <b class="warn">期限切れ</b>' : (f.ends_before_public_end ? ' <b class="warn">公開期間（〜' + esc(d.public_until) + '）の途中で終了</b><br><span class="note">この日以降は時刻表が変わっている可能性があります。資料に使うときは基準日を明記してください。</span>' : '');
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
      '<li>地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li>' +
      '<li>住所・駅名の検索: <a href="https://msearch.gsi.go.jp/address-search/AddressSearch" target="_blank" rel="noopener">国土地理院 地名検索API</a>（国土地理院）。検索したときだけ、入力した文字列を国土地理院のサーバーへ送って（GET）候補の位置を受け取ります。他には送りません。</li></ul>';
    h += '<h2>資料に貼れる出典の例</h2><p class="note">画面の「この画面を共有する・出典を書く」にも、地域に合わせた例文とコピーボタンがあります。</p>' + (d ? '<p style="font-size:.8rem;background:#f3f5f8;padding:6px 8px;border-radius:6px">' + esc(L.citationText(d, { url: pageUrl(), date: todayIso() })) + '</p>' : '');
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
    lonlat: lonlat, colors: COLORS, writeHash: writeHash };
  init();
})();
