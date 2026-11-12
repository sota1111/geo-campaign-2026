/* 相談前の1枚シート: 画面。ネットワークはGETのみ（地理院タイル・地理院の住所検索）。入力は端末内のみ。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const HAZ = 'https://disaportaldata.gsi.go.jp/raster/';
  const state = { data: null, view: { lon: 134.5548, lat: 34.0703, z: 14 }, pin: null, facts: null, answers: {}, overlay: '', showZones: true, seq: 0 };

  // ---- 地図 ----
  const map = $('map'), tiles = $('tiles'), cv = $('zones'), pinEl = $('pin');
  const imgs = new Map();
  const ZCOLOR = { '住居': '#3b9c5a', '商業': '#d6336c', '工業': '#6b7bd6' };
  function zoneColor(name) { return name.includes('商業') ? ZCOLOR['商業'] : name.includes('工業') ? ZCOLOR['工業'] : ZCOLOR['住居']; }

  function size() { return { w: map.clientWidth, h: map.clientHeight }; }
  function project(lon, lat) {
    const { w, h } = size(), v = state.view;
    const c = Lib.lonLatToWorld(v.lon, v.lat, v.z), p = Lib.lonLatToWorld(lon, lat, v.z);
    return { x: w / 2 + (p.x - c.x) * 256, y: h / 2 + (p.y - c.y) * 256 };
  }
  function unproject(x, y) {
    const { w, h } = size(), v = state.view;
    const c = Lib.lonLatToWorld(v.lon, v.lat, v.z);
    return Lib.worldToLonLat(c.x + (x - w / 2) / 256, c.y + (y - h / 2) / 256, v.z);
  }
  function render() {
    const { w, h } = size(), v = state.view;
    const c = Lib.lonLatToWorld(v.lon, v.lat, v.z);
    const x0 = Math.floor(c.x - w / 512), x1 = Math.floor(c.x + w / 512);
    const y0 = Math.floor(c.y - h / 512), y1 = Math.floor(c.y + h / 512);
    const want = new Set();
    const layers = [['b', GSI + 'std/']];
    if (state.overlay) layers.push(['o', HAZ + state.overlay + '/']);
    for (const [k, base] of layers) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const key = k + state.overlay + '/' + v.z + '/' + x + '/' + y;
        want.add(key);
        let im = imgs.get(key);
        if (!im) {
          im = new Image();
          im.alt = '';
          if (k === 'o') { im.style.opacity = '0.65'; im.onerror = () => { im.style.display = 'none'; }; }
          im.src = base + v.z + '/' + x + '/' + y + '.png';
          imgs.set(key, im); tiles.appendChild(im);
        }
        im.style.left = Math.round(w / 2 + (x - c.x) * 256) + 'px';
        im.style.top = Math.round(h / 2 + (y - c.y) * 256) + 'px';
        im.style.zIndex = k === 'o' ? 2 : 1;
      }
    }
    for (const [key, im] of imgs) if (!want.has(key)) { im.remove(); imgs.delete(key); }
    drawZones(); placePin();
  }
  function drawZones() {
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    if (!state.showZones || !state.data) return;
    const v = state.view, c = Lib.lonLatToWorld(v.lon, v.lat, v.z);
    const n = Math.pow(2, v.z);
    for (const z of state.data.zones) {
      g.fillStyle = zoneColor(z.name) + '55'; g.strokeStyle = zoneColor(z.name) + 'aa'; g.lineWidth = 1;
      for (const poly of z.polys) {
        g.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const wx = ((ring[i][0] + 180) / 360) * n;
            const s = Math.sin((ring[i][1] * Math.PI) / 180);
            const wy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
            const X = w / 2 + (wx - c.x) * 256, Y = h / 2 + (wy - c.y) * 256;
            if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
          }
          g.closePath();
        }
        g.fill('evenodd'); g.stroke();
      }
    }
  }
  function placePin() {
    if (!state.pin) { pinEl.hidden = true; return; }
    const p = project(state.pin.lon, state.pin.lat);
    pinEl.hidden = false; pinEl.style.left = p.x + 'px'; pinEl.style.top = p.y + 'px';
  }
  function setZoom(z, anchor) {
    z = Math.max(11, Math.min(17, z));
    if (z === state.view.z) return;
    if (anchor) { const a = unproject(anchor.x, anchor.y); state.view.z = z; const b = unproject(anchor.x, anchor.y); state.view.lon += a.lon - b.lon; state.view.lat += a.lat - b.lat; }
    else state.view.z = z;
    render();
  }
  // ドラッグとクリックの区別
  let drag = null;
  map.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.zoombtns')) return;
    map.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, lon: state.view.lon, lat: state.view.lat, moved: false };
  });
  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    const v = state.view, c = Lib.lonLatToWorld(drag.lon, drag.lat, v.z);
    const nc = Lib.worldToLonLat(c.x - dx / 256, c.y - dy / 256, v.z);
    v.lon = nc.lon; v.lat = nc.lat; render();
  });
  map.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) return;
    const r = map.getBoundingClientRect();
    const ll = unproject(e.clientX - r.left, e.clientY - r.top);
    choose(ll.lon, ll.lat);
  });
  map.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = map.getBoundingClientRect();
    setZoom(state.view.z + (e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  $('zin').onclick = () => setZoom(state.view.z + 1);
  $('zout').onclick = () => setZoom(state.view.z - 1);
  window.addEventListener('resize', render);

  // ---- 取得 ----
  // タイルの1画素を読む。404=タイルなし(区域外)。通信失敗は 'error'
  async function samplePixel(url, px, py) {
    let res;
    try { res = await fetch(url, { mode: 'cors' }); } catch (e) { return { status: 'error' }; }
    if (res.status === 404) return { status: 'none' };
    if (!res.ok) return { status: 'error' };
    try {
      const bmp = await createImageBitmap(await res.blob());
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return { status: 'ok', rgba: Array.from(g.getImageData(px, py, 1, 1).data) };
    } catch (e) { return { status: 'error' }; }
  }
  async function hazard(layer, lon, lat) {
    const t = Lib.tileOf(lon, lat, 16);
    const r = await samplePixel(HAZ + layer + '/' + t.z + '/' + t.x + '/' + t.y + '.png', t.px, t.py);
    if (r.status === 'error') return { status: 'error' };
    if (r.status === 'none') return { status: 'outside' };
    return { status: 'ok', rgba: r.rgba };
  }
  async function analyze(lon, lat, place) {
    const mine = ++state.seq;
    const facts = { place, inArea: false, zone: null, elevation: null, transit: null, flood: null, hightide: null, tsunami: null, sediment: {} };
    const d = state.data;
    if (d) {
      facts.inArea = Lib.inBBox(d.bbox, lon, lat);
      if (facts.inArea) {
        facts.zone = Lib.findZone(d.zones, lon, lat);
        facts.transit = Lib.transitAround(d, lon, lat, 500);
      }
    }
    const dt = Lib.tileOf(lon, lat, 14);
    const [fl, hi, ts, ky, ds, js, dem] = await Promise.all([
      hazard('01_flood_l2_shinsuishin_data', lon, lat), hazard('03_hightide_l2_shinsuishin_data', lon, lat), hazard('04_tsunami_newlegend_data', lon, lat),
      hazard('05_kyukeishakeikaikuiki', lon, lat), hazard('05_dosekiryukeikaikuiki', lon, lat), hazard('05_jisuberikeikaikuiki', lon, lat),
      samplePixel(GSI + 'dem_png/14/' + dt.x + '/' + dt.y + '.png', dt.px, dt.py),
    ]);
    if (mine !== state.seq) return null; // 後から指された
    const flood = (r, cls) => (r.status === 'ok' ? Object.assign({ status: cls(r.rgba).inside ? 'inside' : 'outside' }, cls(r.rgba)) : { status: r.status });
    facts.flood = flood(fl, Lib.classifyFlood);
    facts.hightide = flood(hi, Lib.classifyPresence);
    facts.tsunami = flood(ts, Lib.classifyPresence);
    const sd = (r) => (r.status === 'ok' ? (Lib.classifyPresence(r.rgba).inside ? 'inside' : 'outside') : r.status === 'error' ? 'error' : 'outside');
    facts.sediment = { kyukeisha: sd(ky), dosekiryu: sd(ds), jisuberi: sd(js) };
    if (dem.status === 'ok') facts.elevation = Lib.demElevation(dem.rgba[0], dem.rgba[1], dem.rgba[2]);
    return facts;
  }

  // ---- 表示 ----
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const BASIS = { data: 'データ', answer: 'あなたの回答', none: 'データなし' };
  function renderSheet() {
    const el = $('sheet');
    if (!state.facts) { el.innerHTML = ''; $('printBtn').disabled = true; return; }
    const s = Lib.buildSheet(state.facts, state.answers);
    const exits = s.exits.map((e) => '<div class="exit"><h4>' + esc(e.label) + '</h4><ul>' + e.items.map((it) =>
      '<li><span class="fact"><span class="tag">' + BASIS[it.basis] + '</span>' + esc(it.fact) + '</span><span class="ask">→ ' + esc(it.ask) + '（' + esc(it.who) + '）</span></li>').join('') + '</ul></div>').join('');
    const where = state.facts.sample ? '' : (state.pin ? '指定した位置: 北緯' + state.pin.lat.toFixed(4) + '度 東経' + state.pin.lon.toFixed(4) + '度' : '');
    el.innerHTML =
      '<h3>' + esc(s.title) + '</h3>' +
      '<p class="meta">' + (s.sample ? '<span class="sample-badge">サンプル（架空）</span> 実在の土地ではありません。 ' : '') + esc(where) + ' 作成日: ' + new Date().toLocaleDateString('ja-JP') + '</p>' +
      '<div class="exits">' + exits + '</div>' +
      '<h5>データにない項目（相談先で確かめる）</h5><ul class="plain">' + s.missing.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' +
      '<h5>不動産情報ライブラリで確認する項目（この画面では取得していません）</h5><ul class="plain">' + s.reinfolibItems.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>' +
      '<p class="fine">出典: 国土地理院タイル、ハザードマップポータルサイト（国土地理院）、国土数値情報 用途地域データ（国土交通省・令和元年度版・徳島県）を加工して作成、GTFSデータリポジトリ（CC BY 4.0）。国土交通省 不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）。' +
      '国のデータを加工した参考情報であり、法的・税務的な判断や査定ではありません。区域境界付近や古いデータでは実際と異なります。必ず相談先で確認してください。</p>';
    $('printBtn').disabled = false;
  }
  function readAnswers() {
    const a = {};
    for (const n of ['building', 'landUse', 'road', 'registered']) { const r = document.querySelector('input[name=' + n + ']:checked'); a[n] = r ? r.value : '不明'; }
    state.answers = a; renderSheet();
  }
  function statusText(f) {
    if (f.sample) return 'サンプル（架空）の土地の1枚シートです。実在の土地ではありません。';
    const bits = [];
    if (!f.inArea) bits.push('この地点は地図データの範囲（徳島市周辺）の外です。用途地域・公共交通は出ません');
    return '位置を指定しました。' + (bits.length ? bits.join('。') + '。' : '') + '下の1枚シートを確認してください。2の項目を選ぶと内容が変わります。';
  }
  async function choose(lon, lat, label) {
    state.pin = { lon, lat }; placePin();
    $('status').textContent = '公開データを集めています…';
    const facts = await analyze(lon, lat, label || '地図で指した土地');
    if (!facts) return;
    state.facts = facts; $('status').textContent = statusText(facts); renderSheet();
    $('sheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    App.last = facts;
  }

  // ---- 入力 ----
  $('search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('q').value.trim(); if (!q) return;
    $('status').textContent = '検索しています…';
    try {
      const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
      const j = await r.json();
      if (!j.length) { $('status').textContent = '見つかりませんでした。地図を直接クリックしてください。'; return; }
      const [lon, lat] = j[0].geometry.coordinates;
      state.view = { lon, lat, z: 16 }; render();
      $('status').textContent = '「' + j[0].properties.title + '」付近に移動しました。土地の位置を地図でクリックしてください。';
    } catch (err) { $('status').textContent = '検索に失敗しました。地図を直接クリックしてください。'; }
  });
  $('overlay').onchange = (e) => { state.overlay = e.target.value; render(); };
  $('zoneToggle').onchange = (e) => { state.showZones = e.target.checked; drawZones(); };
  document.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', readAnswers));
  $('sampleBtn').onclick = () => {
    state.pin = null; placePin();
    state.facts = Lib.SAMPLE_FACTS;
    for (const [k, v] of Object.entries(Lib.SAMPLE_ANSWERS)) { const r = document.querySelector('input[name=' + k + '][value="' + v + '"]'); if (r) r.checked = true; }
    readAnswers(); $('status').textContent = statusText(state.facts);
    $('sheet').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('printBtn').onclick = () => window.print();

  // ---- 起動 ----
  const App = window.App = { state, choose, analyze, render, last: null, ready: false };
  fetch('data/tokushima.json').then((r) => r.json()).then((d) => { state.data = d; App.ready = true; render(); })
    .catch(() => { $('status').textContent = '用途地域・公共交通のデータを読み込めませんでした（地図と災害データだけで動きます）。'; App.ready = true; });
  render();
})();
