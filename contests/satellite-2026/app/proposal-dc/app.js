/* データセンター候補地の一次スクリーニング：地図と確認項目の画面（点数・順位は作らない） */
(function () {
  'use strict';
  const L = window.DCLib, DATA = window.DC_DATA;
  const g = DATA.grid;
  const N = g.nx * g.ny;
  const LAYERS = {};
  Object.keys(DATA.layers).forEach((k) => { LAYERS[k] = L.decodeRle(DATA.layers[k], N); });
  const state = { map: null, mapReady: false, target: null, markers: {}, ptMarker: null, layerOn: {} };
  window.DCApp = { state, L, DATA, LAYERS };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- 重ねる格子の色 ----
  const rgba = (r, gr, b, a) => [r, gr, b, a];
  const ramp = (t, stops) => {
    t = Math.max(0, Math.min(1, t));
    const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  };
  const LST_STOPS = [[49, 54, 149], [69, 117, 180], [171, 217, 233], [255, 255, 191], [253, 174, 97], [215, 48, 39], [165, 0, 38]];
  const LST_MIN = 25, LST_MAX = 50;
  const INSAR_STOPS = [[178, 24, 43], [239, 138, 98], [253, 219, 199], [150, 210, 120], [209, 229, 240], [103, 169, 207], [33, 102, 172]];
  const PAL = {
    land: { 1: rgba(60, 160, 70, 140), 2: rgba(214, 150, 60, 200), 3: rgba(120, 120, 130, 190), 4: rgba(40, 110, 220, 170), 5: rgba(180, 210, 110, 120) },
    chg: { 1: rgba(230, 30, 30, 200) },
    slide: { 1: rgba(240, 200, 20, 170), 2: rgba(210, 30, 30, 190) },
  };
  const BLUES = [[200, 225, 250], [150, 195, 240], [90, 150, 225], [40, 100, 200], [20, 60, 160], [10, 30, 110]];
  function colorOf(key, v) {
    if (!v) return null;
    if (key === 'flood') return BLUES[Math.min(5, v - 1)].concat(170);
    if (key === 'tsunami') return [[225, 200, 245], [190, 150, 230], [150, 100, 210], [110, 50, 180], [70, 20, 130], [40, 10, 90]][Math.min(5, v - 1)].concat(175);
    if (key === 'surge') return [[190, 240, 230], [130, 220, 205], [70, 190, 175], [30, 150, 140], [15, 110, 105], [5, 70, 70], [0, 40, 45], [0, 20, 25]][Math.min(7, v - 1)].concat(175);
    if (key === 'slide') return PAL.slide[v & 3] || null;
    if (key === 'lst') return ramp((L.lstFromCode(v) - LST_MIN) / (LST_MAX - LST_MIN), LST_STOPS).concat(185);
    if (key === 'sub') return ramp((v - 1) / 15, INSAR_STOPS).concat(170);
    return PAL[key][v] || null;
  }
  const imageCache = {};
  function layerImage(key) {
    if (imageCache[key]) return imageCache[key];
    const c = document.createElement('canvas');
    c.width = g.nx; c.height = g.ny;
    const ctx = c.getContext('2d'), im = ctx.createImageData(g.nx, g.ny), a = LAYERS[key];
    for (let k = 0; k < N; k++) {
      const col = colorOf(key, a[k]);
      if (col) { im.data[k * 4] = col[0]; im.data[k * 4 + 1] = col[1]; im.data[k * 4 + 2] = col[2]; im.data[k * 4 + 3] = col[3]; }
    }
    ctx.putImageData(im, 0, 0);
    return (imageCache[key] = c.toDataURL('image/png'));
  }

  // ---- 凡例 ----
  const sw = (c) => `<span class="sw" style="background:rgba(${c[0]},${c[1]},${c[2]},${(c[3] || 255) / 255})"></span>`;
  const grad = (stops) => `<span class="ramp" style="background:linear-gradient(90deg,${stops.map((s) => `rgb(${s})`).join(',')})"></span>`;
  const LEGENDS = {
    land: () => `<div class="lg"><b>土地の状態</b>（Sentinel-2 ${L.SCENES.s2_now.date}）<br>${sw(PAL.land[1])}植生 ${sw(PAL.land[2])}裸地等 ${sw(PAL.land[3])}建物（OSM） ${sw(PAL.land[4])}水 ${sw(PAL.land[5])}草地等</div>`,
    chg: () => `<div class="lg"><b>変化</b>${sw(PAL.chg[1])}2020 は植生、2026 は裸地等（造成・伐採・開墾など）</div>`,
    lst: () => `<div class="lg"><b>地表面温度</b>（${L.SCENES.landsat.date}）<br>${LST_MIN}℃ ${grad(LST_STOPS)} ${LST_MAX}℃</div>`,
    sub: () => `<div class="lg"><b>地盤の変動</b>（干渉SAR。1 階級 3.75 mm/年）<br>−30 ${grad(INSAR_STOPS)} +30 mm/年<br><small>範囲の大半は −3.75〜+3.75 の 2 階級</small></div>`,
    flood: () => `<div class="lg"><b>洪水</b>${BLUES.map((c) => sw(c.concat(200))).join('')}浸水深 浅→深</div>`,
    slide: () => `<div class="lg"><b>土砂</b>${sw(PAL.slide[1])}警戒 ${sw(PAL.slide[2])}特別警戒</div>`,
    tsunami: () => `<div class="lg"><b>津波</b>${[[225, 200, 245], [150, 100, 210], [70, 20, 130]].map((c) => sw(c.concat(200))).join('')}浅→深</div>`,
    surge: () => `<div class="lg"><b>高潮</b>${[[190, 240, 230], [70, 190, 175], [5, 70, 70]].map((c) => sw(c.concat(200))).join('')}浅→深</div>`,
    power: () => `<div class="lg"><b>電力（OSM）</b><span class="sw" style="background:#111;border-radius:50%"></span>変電所 <span class="sw" style="height:2px;background:#d4a000;vertical-align:3px"></span>送電線</div>`,
  };
  const RASTER_KEYS = ['land', 'chg', 'lst', 'sub', 'flood', 'slide', 'tsunami', 'surge'];

  function setLayer(key, on) {
    state.layerOn[key] = on;
    const m = state.map;
    if (m && state.mapReady) {
      const ids = key === 'power' ? ['pw-lines', 'pw-subs'] : ['img-' + key];
      ids.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    }
    $('#legend').innerHTML = Object.keys(LEGENDS).filter((k) => state.layerOn[k]).map((k) => LEGENDS[k]()).join('');
  }

  // ---- 候補地と確認項目 ----
  const cands = DATA.candidates;
  const kindLabel = (c) => (c.kind === 'dev' ? '造成地の候補' : '遊休地の候補');

  function select(target) {
    state.target = target;
    const m = state.map;
    Object.entries(state.markers).forEach(([id, el]) => el.classList.toggle('sel', target.id === id));
    if (state.ptMarker) { state.ptMarker.remove(); state.ptMarker = null; }
    if (m && state.mapReady) {
      m.getSource('sel') && m.getSource('sel').setData(target.ring ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [target.ring] }, properties: {} } : { type: 'FeatureCollection', features: [] });
      if (!target.id) {
        const el = document.createElement('div'); el.className = 'pt-mk';
        state.ptMarker = new maplibregl.Marker({ element: el }).setLngLat([target.lon, target.lat]).addTo(m);
      }
    }
    $('#pick').value = target.id || 'point';
    render(target);
  }

  function render(t) {
    const rows = L.buildChecks(DATA, LAYERS, t);
    state.rows = rows;
    $('#target-title').textContent = t.id ? `${t.id}：${kindLabel(t)}（約 ${t.ha} ha）` : '地図で指した地点';
    $('#target-sub').textContent = t.id
      ? `Sentinel-2 で見つけた範囲の全体（格子 ${t.cells.length} 個）で集計。中心 ${t.lat.toFixed(4)}, ${t.lon.toFixed(4)}。${t.kind === 'dev' ? `植生指数 ${t.pndvi}（2020）→ ${t.ndvi}（2026）。` : `植生指数は 2020 が ${t.pndvi}、2026 が ${t.ndvi}。`}`
      : `${t.lat.toFixed(4)}, ${t.lon.toFixed(4)} の周囲 約 ${L.CLICK_RADIUS_M} m（格子 ${t.cells.length} 個）で集計。`;
    const lab = { hit: '該当', none: '非該当', info: '参考値', nodata: 'データなし' };
    $('#rows').innerHTML = rows.map((r) => `<li class="row" data-key="${r.key}"><span class="chip ${r.status}">${lab[r.status]}</span><div><div class="lb">${esc(r.label)}</div><div class="val">${esc(r.value)}</div><div class="src">出典：<a href="${r.src.url}" target="_blank" rel="noopener">${esc(r.src.name)}</a>（${esc(r.src.lic)}）</div>${r.note ? `<div class="note">${esc(r.note)}</div>` : ''}</div></li>`).join('');
  }

  function targetOfCandidate(c) {
    return Object.assign({}, c, { cells: L.cellsInRing(g, c.ring) });
  }
  function targetOfPoint(lon, lat) {
    return { lon, lat, cells: L.cellsInDisk(g, lon, lat, L.CLICK_RADIUS_M) };
  }
  function pickCandidate(id) {
    const c = cands.find((x) => x.id === id);
    if (!c) return;
    select(targetOfCandidate(c));
    if (state.map) state.map.fitBounds(bounds(c.ring), { padding: 80, maxZoom: 15, duration: 400 });
  }
  const bounds = (ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  };

  function buildPicker() {
    const sel = $('#pick');
    const opt = (c) => `<option value="${c.id}">${c.id}　${c.ha} ha</option>`;
    sel.innerHTML = `<optgroup label="造成地の候補（2020 植生 → 2026 裸地等）">${cands.filter((c) => c.kind === 'dev').map(opt).join('')}</optgroup>`
      + `<optgroup label="遊休地の候補（両年とも裸地等）">${cands.filter((c) => c.kind === 'idle').map(opt).join('')}</optgroup>`
      + '<option value="point" disabled>地図で指した地点</option>';
    sel.addEventListener('change', () => pickCandidate(sel.value));
  }

  // ---- データと場面 ----
  function buildDataDialog() {
    const S = L.SCENES, R = L.SRC;
    const rows = [
      ['地表面温度', `${S.landsat.label}<br>${S.landsat.id}`, S.landsat.date, 'USGS: 利用制限なし（パブリックドメイン）。引用を推奨', S.landsat.credit],
      ['土地の状態・変化（現在）', `${S.s2_now.label}<br>${S.s2_now.id}`, S.s2_now.date, 'Copernicus Sentinel データの利用条件（無償・自由）', S.s2_now.credit],
      ['土地の状態・変化（過去）', `${S.s2_past.label}<br>${S.s2_past.id}`, S.s2_past.date, '同上', S.s2_past.credit],
      ['地盤の変動', `${S.insar.label}<br>${S.insar.id}`, S.insar.date, '国土地理院コンテンツ。出典表示。測量法上の承認の要否は要確認', S.insar.credit],
      ['洪水・土砂・津波・高潮', [R.flood, R.slide, R.tsunami, R.surge].map((x) => x.name).join('<br>'), '洪水 令和7年度版／土砂 2025-08-01／津波 2016年版／高潮 2020年版', 'CC BY 4.0（一部制限。県別の条件あり）', '国土数値情報（国土交通省）を加工して作成'],
      ['変電所・送電線・建物', `${R.sub.name}。取得 ${DATA.stats.osm_timestamp ? DATA.stats.osm_timestamp.slice(0, 10) : '2026-11-22'}`, '2026-11-22 取得', 'ODbL（派生データベースは ODbL で提供）', '© OpenStreetMap contributors'],
      ['背景地図', '国土地理院 地理院タイル（標準地図）', '配信中のもの', '国土地理院コンテンツ利用規約', '国土地理院'],
    ];
    $('#datadlg-body').innerHTML = `<table><thead><tr><th>用途</th><th>データ・場面の ID</th><th>日付</th><th>利用条件</th><th>表記</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table><p>衛星の窓・国土数値情報・OSM は取得（GET のみ）して加工し、処理済みの格子の集計値だけを同梱している。範囲は 経度 ${g.w}〜${g.e}・緯度 ${g.s}〜${g.n}。格子は ${g.d} 度（約 23〜28 m）。使わないデータ: 非商用（P03・L05・P20・A30b）、利用条件が不明のもの（JAXA 土地被覆・活断層・J-SHIS・液状化・空容量マップ）。</p>`;
  }

  // ---- 地図 ----
  function initMap() {
    const m = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 18, attribution: '国土地理院' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e8edf2' } }, { id: 'gsi', type: 'raster', source: 'gsi' }] },
      bounds: [[g.w, g.s], [g.e, g.n]], fitBoundsOptions: { padding: 10 }, attributionControl: false, dragRotate: false,
    });
    state.map = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      const coords = [[g.w, g.n], [g.e, g.n], [g.e, g.s], [g.w, g.s]];
      RASTER_KEYS.forEach((k) => {
        m.addSource('img-' + k, { type: 'image', url: layerImage(k), coordinates: coords });
        m.addLayer({ id: 'img-' + k, type: 'raster', source: 'img-' + k, paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }, layout: { visibility: state.layerOn[k] ? 'visible' : 'none' } });
      });
      m.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: DATA.lines.map((l) => ({ type: 'Feature', properties: { v: L.maxVoltage(l.v) }, geometry: { type: 'LineString', coordinates: l.p } })) } });
      m.addLayer({ id: 'pw-lines', type: 'line', source: 'lines', paint: { 'line-color': '#c79300', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2.5] }, layout: { visibility: state.layerOn.power ? 'visible' : 'none' } });
      m.addSource('subs', { type: 'geojson', data: { type: 'FeatureCollection', features: DATA.substations.map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) } });
      m.addLayer({ id: 'pw-subs', type: 'circle', source: 'subs', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6], 'circle-color': '#111', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 }, layout: { visibility: state.layerOn.power ? 'visible' : 'none' } });
      m.addSource('cands', { type: 'geojson', data: { type: 'FeatureCollection', features: cands.map((c) => ({ type: 'Feature', properties: { kind: c.kind }, geometry: { type: 'Polygon', coordinates: [c.ring] } })) } });
      m.addLayer({ id: 'cand-line', type: 'line', source: 'cands', paint: { 'line-color': ['match', ['get', 'kind'], 'dev', '#e07b00', '#7b3fb0'], 'line-width': 2 } });
      m.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'sel-line', type: 'line', source: 'sel', paint: { 'line-color': '#0b5cab', 'line-width': 4 } });
      cands.forEach((c) => {
        const el = document.createElement('div'); el.className = 'cand-mk ' + c.kind; el.textContent = c.id; el.title = `${c.id}：${kindLabel(c)} 約 ${c.ha} ha`;
        el.addEventListener('click', (ev) => { ev.stopPropagation(); pickCandidate(c.id); });
        state.markers[c.id] = el;
        new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(m);
      });
      state.mapReady = true;
      if (state.target) select(state.target);
    });
    m.on('click', (e) => {
      if (!state.mapReady) return;
      const { lng, lat } = e.lngLat;
      if (!L.cellOf(g, lng, lat)) return;
      const t = targetOfPoint(lng, lat);
      const sel = $('#pick'); sel.querySelector('option[value="point"]').disabled = false;
      select(t);
    });
  }

  // ---- 起動 ----
  function init() {
    buildPicker();
    buildDataDialog();
    $('#credit').textContent = `${L.SCENES.insar.credit} ／ ${L.SCENES.s2_now.credit}・${L.SCENES.s2_past.credit} ／ ${L.SCENES.landsat.credit} ／ 国土数値情報（CC BY 4.0）を加工して作成 ／ © OpenStreetMap contributors（ODbL） ／ 地理院タイル`;
    document.querySelectorAll('#layers input[data-layer]').forEach((cb) => {
      state.layerOn[cb.dataset.layer] = cb.checked;
      cb.addEventListener('change', () => setLayer(cb.dataset.layer, cb.checked));
    });
    setLayer('chg', true);
    $('#btn-data').addEventListener('click', () => $('#datadlg').showModal());
    const first = cands.find((c) => c.kind === 'dev') || cands[0];
    if (first) state.target = targetOfCandidate(first);
    initMap();
    if (state.target) { $('#pick').value = first.id; render(state.target); }
    if (window.matchMedia('(max-width: 800px)').matches) $('#layers').open = false;
  }
  init();
})();
