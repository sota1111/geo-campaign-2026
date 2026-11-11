/* 地名の記憶マップ（デモ）: 画面制御（MapLibre GL JS 4.7.1 + 地理院タイル） */
(function () {
  'use strict';
  var L = window.Lib;
  var STORE_KEY = 'chimei-kioku-demo-v1';
  var GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  var ICHIRAN = 'https://maps.gsi.go.jp/development/ichiran.html';
  /* 色覚に配慮: Okabe-Ito配色（青・オレンジ・赤紫）。色だけに頼らず、形（円/ラベル付きピン/破線枠）も変える */
  var OVERLAYS = [
    { id: 'none', label: 'なし', note: '標準地図だけを表示します。' },
    { id: 'ort_USA10', label: '空中写真 1945〜50年', ext: 'png', minzoom: 10, maxzoom: 17,
      note: '終戦前後に撮影された空中写真。昔の水路・田・集落の位置を見る手がかりになります。' },
    { id: 'ort_old10', label: '空中写真 1961〜69年', ext: 'png', minzoom: 10, maxzoom: 17,
      note: '高度成長期の空中写真。宅地になる前の様子を見る手がかりになります。' },
    { id: 'swale', label: '明治期の低湿地', ext: 'png', minzoom: 10, maxzoom: 16,
      note: '明治期の地形図などから読み取られた低湿地の範囲。重なるかどうかを目で確かめます（範囲は目安です）。' },
    { id: 'lcmfc2', label: '治水地形分類図', ext: 'png', minzoom: 11, maxzoom: 16,
      note: '河川沿いの地形（旧河道・氾濫原など）を分類した図。凡例は国土地理院の公開ページで確認できます。' },
    { id: 'relief', label: '色別標高図', ext: 'png', minzoom: 5, maxzoom: 15,
      note: '標高を色で表した図。谷・低地の位置関係を見る手がかりになります。' }
  ];
  var CHECKS = [
    '伝承碑の記載に、この話と重なる点があった',
    '明治期の低湿地に重なっていた',
    '古い空中写真に、話と関係しそうな水路や地形が見えた',
    '治水地形分類図に、話と関係しそうな地形があった',
    '公開データでは手がかりが見つからなかった'
  ];
  var STATE = { samples: null, lore: null, records: [], focus: null, overlay: 'none', radius: 1000, stepDone: {} };
  var map, pinMarker = null, placeMarkers = {}, recMarkers = {}, popup = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function gsiLink(lon, lat, z) { return 'https://maps.gsi.go.jp/#' + (z || 16) + '/' + lat + '/' + lon + '/'; }

  /* ---------- 保存 ---------- */
  function loadRecords() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  function saveRecords() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(STATE.records)); } catch (e) { /* 容量超過・無効化時は画面上のみ */ }
  }

  /* ---------- 初期化 ---------- */
  function init() {
    if (typeof maplibregl === 'undefined') {
      $('place-list').innerHTML = '<li class="note">地図の部品（MapLibre GL JS）を読み込めませんでした。ネットワーク（unpkg.com への接続）を確認して、再読み込みしてください。</li>';
      return;
    }
    Promise.all([getJSON('data/samples.json'), getJSON('data/lore.json')]).then(function (r) {
      STATE.samples = r[0]; STATE.lore = r[1];
      STATE.records = loadRecords();
      buildUI();
      buildMap();
    }).catch(function (e) {
      $('place-list').innerHTML = '<li class="note">データを読み込めませんでした（' + esc(e.message) + '）。ローカルサーバー経由（python3 -m http.server）で開いてください。</li>';
    });
  }

  function buildUI() {
    /* 地名一覧 */
    var ul = $('place-list');
    ul.innerHTML = '';
    STATE.samples.places.forEach(function (p) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'item'; b.dataset.id = p.id; b.setAttribute('aria-pressed', 'false');
      b.innerHTML = '<span class="tag sample">サンプル（架空）</span>' + esc(p.name) + '<span class="sub">' + esc(p.type) + '・語られている災害: ' + esc(p.claimedKinds.join('・')) + '</span>';
      b.addEventListener('click', function () { selectPlace(p.id); });
      li.appendChild(b); ul.appendChild(li);
    });
    /* 重ねる地図 */
    var ov = $('ovl');
    OVERLAYS.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(o.id === STATE.overlay));
      b.textContent = o.label; b.dataset.id = o.id;
      b.addEventListener('click', function () { setOverlay(o.id); });
      ov.appendChild(b);
    });
    $('opacity').addEventListener('input', applyOpacity);
    $('radius').addEventListener('change', function () { STATE.radius = Number($('radius').value); renderCross(); });
    /* チェック・種別 */
    $('checks').innerHTML = CHECKS.map(function (c, i) {
      return '<label><input type="checkbox" name="chk" value="' + esc(c) + '" id="chk' + i + '"> ' + esc(c) + '</label>';
    }).join('');
    $('f-kinds').innerHTML = L.KINDS.map(function (k, i) {
      return '<label><input type="checkbox" name="kind" value="' + esc(k) + '" id="kind' + i + '"> ' + esc(k) + '</label>';
    }).join('');
    $('f-kinds').addEventListener('change', renderCross);
    $('f-vis').innerHTML = Object.keys(L.VISIBILITY).map(function (k) { return '<option value="' + k + '">' + esc(L.VISIBILITY[k]) + '</option>'; }).join('');
    $('f-lic').innerHTML = Object.keys(L.LICENSES).map(function (k) { return '<option value="' + esc(k) + '">' + esc(L.LICENSES[k]) + '</option>'; }).join('');
    $('rec-form').addEventListener('submit', onSubmit);
    $('ex-pub').addEventListener('click', function () { exportGeoJSON(true); });
    $('ex-all').addEventListener('click', function () { exportGeoJSON(false); });
    $('clear').addEventListener('click', function () {
      if (!STATE.records.length) return;
      if (window.confirm('この端末に保存した記録をすべて消します。よろしいですか？')) { STATE.records = []; saveRecords(); renderRecords(); }
    });
    $('sheet-toggle').addEventListener('click', function () {
      var p = $('panel'); var closed = p.classList.toggle('closed');
      $('sheet-toggle').setAttribute('aria-expanded', String(!closed));
    });
    $('btn-about').addEventListener('click', openAbout);
    $('modal-close').addEventListener('click', closeAbout);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeAbout(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAbout(); });
    var lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = '<div><i style="background:#D55E00"></i>地名（サンプル・架空）</div><div><i style="background:#0072B2"></i>自然災害伝承碑（国土地理院・実データ）</div><div><i style="background:#fff;box-shadow:0 0 0 2px #CC79A7"></i>残した記録</div>';
    document.body.appendChild(lg);
    renderRecords();
  }

  /* ---------- 地図 ---------- */
  function overlayTiles(o) { return [GSI + o.id + '/{z}/{x}/{y}.' + o.ext]; }
  function buildMap() {
    var sources = {
      std: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: [GSI + 'std/{z}/{x}/{y}.png'],
        attribution: '<a href="' + ICHIRAN + '" target="_blank" rel="noopener">国土地理院（地理院タイル：標準地図）</a>' }
    };
    var layers = [{ id: 'std', type: 'raster', source: 'std' }];
    OVERLAYS.forEach(function (o) {
      if (o.id === 'none') return;
      sources['ovl-' + o.id] = { type: 'raster', tileSize: 256, minzoom: o.minzoom, maxzoom: o.maxzoom, tiles: overlayTiles(o),
        attribution: '<a href="' + ICHIRAN + '" target="_blank" rel="noopener">国土地理院（地理院タイル：' + o.label + '）</a>' };
      layers.push({ id: 'ovl-' + o.id, type: 'raster', source: 'ovl-' + o.id, layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.7 } });
    });
    map = new maplibregl.Map({
      container: 'map', style: { version: 8, sources: sources, layers: layers },
      center: [132.485, 34.475], zoom: 12, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      var lore = { type: 'FeatureCollection', features: STATE.lore.items.map(function (it) {
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [it.lon, it.lat] }, properties: { id: it.id } };
      }) };
      map.addSource('lore', { type: 'geojson', data: lore });
      map.addSource('radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#0072B2', 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#0072B2', 'line-width': 2, 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'lore', type: 'circle', source: 'lore', paint: {
        'circle-radius': 8, 'circle-color': '#0072B2', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 } });
      map.on('mouseenter', 'lore', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'lore', function () { map.getCanvas().style.cursor = ''; });
      map.on('click', onMapClick);
      buildPlaceMarkers();
      renderRecordMarkers();
      STATE.mapReady = true;
    });
  }

  function pinEl(text, cls, label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pin ' + (cls || ''); b.textContent = text; if (label) b.setAttribute('aria-label', label);
    return b;
  }
  function buildPlaceMarkers() {
    STATE.samples.places.forEach(function (p) {
      var el = pinEl(p.name, '', '地名 ' + p.name + '（サンプル・架空）を選ぶ');
      el.addEventListener('click', function (e) { e.stopPropagation(); selectPlace(p.id); });
      placeMarkers[p.id] = { el: el, marker: new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map) };
    });
  }
  function renderRecordMarkers() {
    Object.keys(recMarkers).forEach(function (k) { recMarkers[k].remove(); });
    recMarkers = {};
    STATE.records.forEach(function (r) {
      if (r.visibility === 'private') return; /* 非公開は地図に出さない */
      var el = pinEl((r.verified ? '✓ ' : '') + r.placeName, 'rec' + (r.verified ? ' verified' : ''), '残した記録 ' + r.placeName + (r.verified ? '（確認済み）' : '（未確認）'));
      el.addEventListener('click', function (e) { e.stopPropagation(); showRecordPopup(r); });
      recMarkers[r.id] = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lon, r.lat]).addTo(map);
    });
  }

  /* パネルに隠れない位置へ寄せるための余白 */
  function mapPadding() {
    return window.innerWidth <= 720 ? { top: 0, left: 0, right: 0, bottom: Math.round(window.innerHeight * 0.58) } : { top: 0, bottom: 0, right: 0, left: 400 };
  }

  function closePopup() { if (popup) { popup.remove(); popup = null; } }
  function openPopup(lon, lat, html) {
    closePopup();
    popup = new maplibregl.Popup({ maxWidth: '300px', offset: 14 }).setLngLat([lon, lat]).setHTML(html).addTo(map);
  }
  function lorePopupHtml(it) {
    return '<div style="font-size:.82rem;line-height:1.6"><b>' + esc(it.name) + '</b>（' + esc(it.year) + '年建立）<br>' +
      '種類: ' + esc(it.kind) + '<br>災害: ' + esc(it.disaster) + '<br>所在: ' + esc(it.address) + '<br>' + esc(it.info) +
      '<br><a href="' + esc(gsiLink(it.lon, it.lat, 17)) + '" target="_blank" rel="noopener">地理院地図で見る（写真もここで確認）</a>' +
      '<br><span style="color:#555;font-size:.72rem">出典: 国土地理院 自然災害伝承碑</span></div>';
  }
  function showRecordPopup(r) {
    openPopup(r.lon, r.lat, '<div style="font-size:.82rem;line-height:1.6"><b>' + esc(r.placeName) + '</b>（' + esc(r.placeType) + '）<br>' +
      (r.verified ? '確認済み（' + esc(r.verifiedBy) + '）' : '未確認') + '・確からしさ: ' + esc(r.certainty) + '<br>' + esc(r.story) +
      '<br>出典: ' + esc(r.basis) + '<br>語り手: ' + esc(r.teller) + '<br>公開範囲: ' + esc(L.VISIBILITY[r.visibility]) + '・' + esc(r.license) + '</div>');
  }

  function onMapClick(e) {
    var f = map.queryRenderedFeatures(e.point, { layers: ['lore'] });
    if (f.length) {
      var it = STATE.lore.items.filter(function (x) { return x.id === f[0].properties.id; })[0];
      if (it) { openPopup(it.lon, it.lat, lorePopupHtml(it)); return; }
    }
    closePopup();
    setPin(e.lngLat.lng, e.lngLat.lat);
  }

  /* ---------- 重ねる地図 ---------- */
  function setOverlay(id) {
    STATE.overlay = id;
    Array.prototype.forEach.call($('ovl').children, function (b) { b.setAttribute('aria-checked', String(b.dataset.id === id)); });
    OVERLAYS.forEach(function (o) {
      if (o.id !== 'none' && map.getLayer('ovl-' + o.id)) map.setLayoutProperty('ovl-' + o.id, 'visibility', o.id === id ? 'visible' : 'none');
    });
    var o = OVERLAYS.filter(function (x) { return x.id === id; })[0];
    $('ovl-note').textContent = o.note + (id !== 'none' ? '（出典: 国土地理院 地理院タイル）' : '');
  }
  function applyOpacity() {
    var v = Number($('opacity').value) / 100;
    OVERLAYS.forEach(function (o) { if (o.id !== 'none' && map.getLayer('ovl-' + o.id)) map.setPaintProperty('ovl-' + o.id, 'raster-opacity', v); });
  }

  /* ---------- 選択と突き合わせ ---------- */
  function setSteps(active) {
    ['st1', 'st2', 'st3'].forEach(function (id, i) {
      var li = $(id); li.className = (i + 1 === active) ? 'on' : (i + 1 < active || STATE.stepDone[i + 1] ? 'done' : '');
    });
  }
  function kindsChecked() {
    return Array.prototype.map.call(document.querySelectorAll('input[name="kind"]:checked'), function (c) { return c.value; });
  }
  function setKinds(arr) {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="kind"]'), function (c) { c.checked = arr.indexOf(c.value) >= 0; });
  }
  function clearChecks() {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="chk"]'), function (c) { c.checked = false; });
  }
  function showSteps() { $('s-check').hidden = false; $('s-rec').hidden = false; }

  function selectPlace(id) {
    var p = STATE.samples.places.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    closePopup();
    STATE.focus = { lon: p.lon, lat: p.lat, place: p };
    removePin();
    Array.prototype.forEach.call($('place-list').querySelectorAll('button.item'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === id)); });
    Object.keys(placeMarkers).forEach(function (k) { placeMarkers[k].el.classList.toggle('sel', k === id); });
    $('f-name').value = p.name.replace(/（架空）$/, '') + '（架空）';
    $('f-type').value = p.type === '小字' || p.type === '旧地名' || p.type === '通称地名' ? p.type : 'その他';
    setKinds(p.claimedKinds);
    $('f-cert').value = p.certainty;
    clearChecks();
    showSteps(); setSteps(2);
    renderFocus();
    renderCross();
    map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600, padding: mapPadding() });
    $('s-check').scrollIntoView({ block: 'nearest' });
  }

  function removePin() { if (pinMarker) { pinMarker.remove(); pinMarker = null; } }
  function setPin(lon, lat) {
    STATE.focus = { lon: lon, lat: lat, place: null };
    Object.keys(placeMarkers).forEach(function (k) { placeMarkers[k].el.classList.remove('sel'); });
    Array.prototype.forEach.call($('place-list').querySelectorAll('button.item'), function (b) { b.setAttribute('aria-pressed', 'false'); });
    removePin();
    var el = pinEl('', 'new', '新しい地名の位置');
    pinMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
    if (!$('f-name').value || /（架空）$/.test($('f-name').value)) { $('f-name').value = ''; setKinds([]); }
    showSteps(); setSteps(2);
    renderFocus(); renderCross();
  }

  function renderFocus() {
    var f = STATE.focus; if (!f) return;
    var h;
    if (f.place) {
      var p = f.place;
      h = '<div class="card"><span class="tag sample">サンプル（架空）</span><b>' + esc(p.name) + '</b>（' + esc(p.type) + '）' +
        '<div class="story">' + esc(p.story) + '</div>' +
        '<div>語り手: ' + esc(p.teller) + '</div><div>出典: ' + esc(p.basis) + '</div>' +
        '<div>確からしさ（現状）: <span class="tag wait">' + esc(p.certainty) + '</span></div></div>';
    } else {
      h = '<div class="card"><b>新しい地名の位置</b>（経度 ' + f.lon.toFixed(5) + '・緯度 ' + f.lat.toFixed(5) + '）<div class="story">語られている災害の種類を、下の「3」で選ぶと、突き合わせの結果が変わります。</div></div>';
    }
    $('focus-card').innerHTML = h;
    $('f-pos').textContent = '位置: 経度 ' + f.lon.toFixed(5) + '・緯度 ' + f.lat.toFixed(5) + (f.place ? '（サンプル地名の位置）' : '（地図で指定）');
  }

  function circlePoly(lon, lat, rM) {
    var pts = [], dLat = rM / 111320, dLon = rM / (111320 * Math.cos(lat * Math.PI / 180));
    for (var i = 0; i <= 48; i++) { var a = i / 48 * 2 * Math.PI; pts.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]); }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
  }

  function renderCross() {
    var f = STATE.focus; if (!f) return;
    var near = L.nearby(STATE.lore.items, f.lon, f.lat, STATE.radius);
    var claimed = kindsChecked();
    var res = L.crossCheck(claimed, near);
    if (STATE.mapReady) map.getSource('radius').setData({ type: 'FeatureCollection', features: [circlePoly(f.lon, f.lat, STATE.radius)] });
    var h = '';
    if (!claimed.length) {
      h += '<div class="card none">語られている災害の種類が未選択です。下の「3 聞き取りを記録」の「語られている災害」を選ぶと、碑の種類と突き合わせます。</div>';
    } else if (res.level === 'clue') {
      h += '<div class="card clue"><b>手がかりあり</b>: 半径' + L.fmtDist(STATE.radius) + '以内に、語られている種類（' + esc(res.matchedKinds.join('・')) + '）の伝承碑が <b>' + res.hits.length + '件</b>あります。' +
        '<br><span class="note">碑は「その近くで災害があった」ことの手がかりです。地名との因果や、その場所の危険度は示しません。</span></div>';
    } else {
      h += '<div class="card none"><b>公開データでは見つからず</b>: 半径' + L.fmtDist(STATE.radius) + '以内に、語られている種類（' + esc(claimed.join('・')) + '）の伝承碑はありません。' +
        '<br><span class="note">碑が建てられていないだけの場合もあり、話が誤りという意味ではありません。範囲を広げるか、郷土資料・語り手への再確認で確かめます。</span></div>';
    }
    if (near.length) {
      h += '<p class="note">範囲内の伝承碑（全種類・近い順・上位5件／全' + near.length + '件）。地図の青い丸でも見られます。</p><ul class="hits">';
      near.slice(0, 5).forEach(function (n) {
        h += '<li><b>' + esc(n.item.name) + '</b>（' + esc(n.item.year) + '年・' + esc(n.item.kind) + '）' + L.fmtDist(n.dist) +
          '<details><summary>伝承内容</summary>' + esc(n.item.info) + ' <a href="' + esc(gsiLink(n.item.lon, n.item.lat, 17)) + '" target="_blank" rel="noopener">地理院地図で見る</a></details></li>';
      });
      h += '</ul>';
    } else {
      h += '<p class="note">この範囲に、収録した伝承碑はありません（収録範囲は安佐南区周辺のみ）。</p>';
    }
    $('cross').innerHTML = h;
  }

  /* ---------- 記録 ---------- */
  function readForm() {
    var f = STATE.focus || {};
    return {
      placeName: $('f-name').value, placeType: $('f-type').value, teller: $('f-teller').value, heardOn: $('f-date').value,
      story: $('f-story').value, basis: $('f-basis').value, claimedKinds: kindsChecked(), certainty: $('f-cert').value,
      visibility: $('f-vis').value, license: $('f-lic').value,
      checked: Array.prototype.map.call(document.querySelectorAll('input[name="chk"]:checked'), function (c) { return c.value; }),
      lon: f.lon == null ? '' : f.lon, lat: f.lat == null ? '' : f.lat
    };
  }
  function onSubmit(e) {
    e.preventDefault();
    var r = L.createRecord(readForm(), new Date().toISOString());
    var box = $('f-err');
    if (!r.ok) { box.hidden = false; box.className = 'err'; box.innerHTML = r.errors.map(esc).join('<br>'); return; }
    STATE.records.push(r.record); saveRecords();
    renderRecords(); renderRecordMarkers();
    STATE.stepDone[3] = true; setSteps(3);
    box.hidden = false; box.className = 'notice';
    box.textContent = '「' + r.record.placeName + '」を未確認の記録として地図に残しました。確認役が確かめると「確認済み」になり、公開分として書き出せます（下の一覧）。';
    $('f-story').value = ''; $('f-basis').value = '';
    $('s-list').scrollIntoView({ block: 'nearest' });
  }

  function renderRecords() {
    $('rec-count').textContent = '（' + STATE.records.length + '件）';
    var ul = $('rec-list'); ul.innerHTML = '';
    if (!STATE.records.length) { ul.innerHTML = '<li class="note">まだありません。上の手順で記録すると、ここに並びます。</li>'; return; }
    STATE.records.forEach(function (r) {
      var li = document.createElement('li');
      li.className = 'card';
      li.innerHTML = '<b>' + esc(r.placeName) + '</b> ' +
        (r.verified ? '<span class="tag ok">確認済み</span>' : '<span class="tag wait">未確認</span>') +
        '<span class="tag">' + esc(L.VISIBILITY[r.visibility]) + '</span><span class="tag">' + esc(r.certainty) + '</span>' +
        (L.isPublishable(r) ? '<span class="tag ok">公開分に含む</span>' : '') +
        '<div class="story">' + esc(r.story) + '</div><div class="note">出典: ' + esc(r.basis) + '／語り手: ' + esc(r.teller) + '／' + esc(r.license) + '</div>';
      var act = document.createElement('div');
      function mini(text, cls, fn) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'mini ' + (cls || ''); b.textContent = text; b.addEventListener('click', fn); act.appendChild(b);
      }
      mini('地図で見る', '', function () { map.flyTo({ center: [r.lon, r.lat], zoom: 15, duration: 500, padding: mapPadding() }); if (r.visibility !== 'private') showRecordPopup(r); });
      if (!r.verified) mini('確認役として確認済みにする（デモ）', '', function () { updateRecord(r.id, function (x) { return L.setVerified(x, '確認役（デモ）', new Date().toISOString()); }); });
      if (r.visibility !== 'private') mini('本人・家族の求めで非公開にする', '', function () { updateRecord(r.id, function (x) { x.visibility = 'private'; return x; }); });
      mini('削除', 'danger', function () { STATE.records = STATE.records.filter(function (x) { return x.id !== r.id; }); saveRecords(); renderRecords(); renderRecordMarkers(); closePopup(); });
      li.appendChild(act); ul.appendChild(li);
    });
  }
  function updateRecord(id, fn) {
    STATE.records = STATE.records.map(function (x) { return x.id === id ? fn(Object.assign({}, x)) : x; });
    saveRecords(); renderRecords(); renderRecordMarkers(); closePopup();
  }

  function exportGeoJSON(onlyPub) {
    var gj = L.toGeoJSON(STATE.records, { onlyPublishable: onlyPub, exportedAt: new Date().toISOString() });
    var note = $('ex-note');
    if (!gj.features.length) {
      note.textContent = onlyPub ? '公開分がありません。記録を「確認済み」にし、公開範囲を「公開」、利用条件を「利用不可」以外にすると含まれます。' : '書き出せる記録がありません。';
      return;
    }
    var blob = new Blob([JSON.stringify(gj, null, 2)], { type: 'application/geo+json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chimei-kioku-' + (onlyPub ? 'public' : 'all') + '.geojson';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    note.textContent = gj.features.length + '件を書き出しました（端末内で作成。送信はしていません）。';
    STATE.lastExport = gj;
  }

  /* ---------- 出典 ---------- */
  function openAbout() {
    $('about').innerHTML =
      '<h2 id="about-title">出典・利用条件・このデモの限界</h2>' +
      '<p>これは「地名の記憶マップ」（イチBizアワード2026 アイデア部門）の考え方を触って確かめるための<b>最小限のデモ</b>です。</p>' +
      '<h3>実データ</h3><table><tr><th>データ</th><th>出典・条件</th></tr>' +
      '<tr><td>自然災害伝承碑（青い丸・' + STATE.lore.items.length + '件）</td><td>国土地理院「自然災害伝承碑」（地理院地図で公開）から広島市安佐南区周辺の点を切り出して同梱。名称・建立年・災害種別・所在地・伝承内容の文のみ。<b>写真は取り込まず</b>、地理院地図へのリンクにしています（広島市分の写真は二次利用に利用申請が必要とされているため）。</td></tr>' +
      '<tr><td>標準地図・空中写真（1945〜50年／1961〜69年）・明治期の低湿地・治水地形分類図・色別標高図</td><td>国土地理院 地理院タイル。<a href="' + ICHIRAN + '" target="_blank" rel="noopener">地理院タイル一覧</a>に従い、出典を表示してリアルタイムに読み込んでいます。</td></tr>' +
      '<tr><td>地図ライブラリ</td><td>MapLibre GL JS 4.7.1（BSD-3-Clause）</td></tr></table>' +
      '<h3>サンプル（架空）</h3><p>地名（オレンジのピン）・語り手・話・出典はすべて架空です。位置は操作例のための仮置きで、実在の小字や旧地名、地名の由来、実在の人物の証言とは関係ありません。</p>' +
      '<h3>このデモがしないこと・限界</h3><ul>' +
      '<li>災害の危険度は判定しません。「手がかりあり／公開データでは見つからず」は、話を確かめる入り口で、地名と災害の因果は示しません。</li>' +
      '<li>突き合わせは、語られた災害の種類と近くの伝承碑の種類を比べるだけの簡易なものです。碑の有無は災害の有無を意味しません。</li>' +
      '<li>旧地名の公開データは用意していません（サンプルのみ）。対象は広島市安佐南区周辺の1地域です。</li>' +
      '<li>記録はこの端末のブラウザ（localStorage）に保存され、サーバーには送りません。「確認役」はボタンで模擬しており、本人確認や権限管理はありません。</li>' +
      '<li>書き出しはGeoJSONファイルのダウンロードのみです。公開分は「確認済み・公開・利用条件あり」の記録に限ります。</li></ul>';
    $('modal').hidden = false;
    $('modal-close').focus();
  }
  function closeAbout() { $('modal').hidden = true; }

  window.App = { STATE: STATE, getMap: function () { return map; }, selectPlace: selectPlace, setPin: setPin, setOverlay: setOverlay, renderCross: renderCross };
  init();
}());
