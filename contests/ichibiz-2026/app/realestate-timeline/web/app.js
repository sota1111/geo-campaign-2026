/* 23区、値段の年表: 画面。ネットワークは GET のみ（国土地理院のタイル、同梱データ data/*.json）。
 * 不動産情報ライブラリ・統計のAPIはここからは呼ばない（取得は tools/fetch*.mjs で事前に行う）。操作は端末内のみ。 */
(function () {
  'use strict';
  const L = window.Lib;
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/pale/';
  const PLAY_MS = 320;
  const state = { data: null, mode: 'price', qi: 0, sel: null, view: { lon: 139.74, lat: 35.68, z: 11 }, timer: null, qmin: 0, loaded: false };

  // ---- 地図（平面の座標変換。z は小数可） ----
  const map = $('map'), tiles = $('tiles'), cv = $('over');
  const imgs = new Map();
  const world = (lon, lat) => { const s = Math.sin((lat * Math.PI) / 180); return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }; };
  const lonlat = (x, y) => ({ lon: x * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI });
  const scale = () => 256 * 2 ** state.view.z;
  const size = () => ({ w: map.clientWidth, h: map.clientHeight });
  function project(lon, lat) {
    const { w, h } = size(), c = world(state.view.lon, state.view.lat), p = world(lon, lat), k = scale();
    return { x: w / 2 + (p.x - c.x) * k, y: h / 2 + (p.y - c.y) * k };
  }
  function unproject(x, y) {
    const { w, h } = size(), c = world(state.view.lon, state.view.lat), k = scale();
    return lonlat(c.x + (x - w / 2) / k, c.y + (y - h / 2) / k);
  }
  function fit() {
    if (!state.data) return;
    const b = L.boundsOf(state.data.wards), { w, h } = size();
    const a = world(b.x0, b.y1), z = world(b.x1, b.y0);
    const pad = w < 500 ? 8 : 24;
    const zoom = Math.log2(Math.min((w - pad * 2) / (256 * (z.x - a.x)), (h - pad * 2) / (256 * (z.y - a.y))));
    state.view = { lon: (b.x0 + b.x1) / 2, lat: (b.y0 + b.y1) / 2, z: Math.max(9, Math.min(15, zoom)) };
    state.fitZ = state.view.z;
  }
  function renderTiles() {
    const { w, h } = size(), v = state.view, zi = Math.max(5, Math.min(18, Math.round(v.z))), ts = 256 * 2 ** (v.z - zi);
    const c = world(v.lon, v.lat), n = 2 ** zi, cx = c.x * n, cy = c.y * n;
    const want = new Set();
    for (let x = Math.floor(cx - w / 2 / ts); x <= Math.floor(cx + w / 2 / ts); x++) {
      for (let y = Math.floor(cy - h / 2 / ts); y <= Math.floor(cy + h / 2 / ts); y++) {
        if (y < 0 || y >= n) continue;
        const xx = ((x % n) + n) % n, key = zi + '/' + xx + '/' + y + '@' + x;
        want.add(key);
        let im = imgs.get(key);
        if (!im) { im = new Image(); im.alt = ''; im.src = GSI + zi + '/' + xx + '/' + y + '.png'; imgs.set(key, im); tiles.appendChild(im); }
        im.style.width = im.style.height = Math.ceil(ts) + 1 + 'px';
        im.style.left = Math.round(w / 2 + (x - cx) * ts) + 'px';
        im.style.top = Math.round(h / 2 + (y - cy) * ts) + 'px';
      }
    }
    for (const [key, im] of imgs) if (!want.has(key)) { im.remove(); imgs.delete(key); }
  }

  let hatch = null;
  function hatchPattern(g) {
    if (hatch) return hatch;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 2.2;
    x.beginPath(); x.moveTo(-1, 9); x.lineTo(9, -1); x.moveTo(-1, 1); x.lineTo(1, -1); x.moveTo(7, 9); x.lineTo(9, 7); x.stroke();
    hatch = g.createPattern(c, 'repeat'); return hatch;
  }
  const lightClass = (cls) => cls <= 3;
  function drawOverlay() {
    const D = state.data; if (!D) return;
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const mode = state.mode, labels = [];
    for (const wd of D.wards) {
      const c = L.cellFor(mode, D, wd.code, state.qi);
      g.beginPath();
      for (const ring of wd.polys) ring.forEach(([lon, lat], i) => { const p = project(lon, lat); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      if (c.cls < 0) { g.fillStyle = 'rgba(170,170,170,.6)'; g.fill(); }
      else {
        g.fillStyle = L.PALETTE[c.cls]; g.globalAlpha = c.low ? 0.4 : 0.86; g.fill(); g.globalAlpha = 1;
        if (c.low) { g.fillStyle = hatchPattern(g); g.fill(); }
      }
      g.lineWidth = 1; g.strokeStyle = '#3b4652'; g.stroke();
      const lp = L.labelPoint(wd);
      if (lp) labels.push({ wd, c, p: project(lp.lon, lp.lat), px: lp.w * scale() / 360 });
    }
    // 選択した区は太い縁（色以外でも分かる）
    const sw = state.sel && D.wards.find((x) => x.code === state.sel);
    if (sw) {
      g.beginPath();
      for (const ring of sw.polys) ring.forEach(([lon, lat], i) => { const p = project(lon, lat); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); });
      g.lineWidth = 5; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 2.6; g.strokeStyle = '#d6336c'; g.stroke();
    }
    // 区名と値（色だけに頼らない）
    const small = w < 520;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    for (const { wd, c, p, px } of labels) {
      const nm = wd.name.replace(/区$/, '');
      const showVal = c.value !== null && px >= (small ? 20 : 30);
      const fs = small ? 9 : px > 60 ? 12 : 11;
      const val = c.value === null ? '' : mode === 'price' ? (c.value < 100 ? c.value.toFixed(0) : Math.round(c.value)) + (c.low ? '※' : '') : String(Math.round(c.value));
      g.font = 'bold ' + fs + 'px "Hiragino Sans","Noto Sans JP",sans-serif';
      const y0 = showVal ? p.y - fs * 0.6 : p.y;
      g.lineWidth = 3.2; g.strokeStyle = 'rgba(255,255,255,.92)'; g.fillStyle = '#1d2733';
      g.strokeText(nm, p.x, y0); g.fillText(nm, p.x, y0);
      if (showVal) { g.strokeText(val, p.x, y0 + fs * 1.15); g.fillText(val, p.x, y0 + fs * 1.15); }
    }
    const ps = $('period'); const q = D.price.quarters[state.qi];
    if (mode === 'rent') {
      const sy = L.surveyYearFor(q, D.rent.years);
      ps.innerHTML = L.esc(L.quarterLabel(q)) + '<small>家賃: ' + (sy ? L.esc(sy) + '年10月の調査の値' : L.NODATA) + '</small>';
    } else ps.innerHTML = L.esc(L.quarterLabel(q)) + '<small>' + L.esc(L.quarterMonths(q)) + 'の取引</small>';
  }
  function render() { renderTiles(); drawOverlay(); }

  // ---- 地図の操作（ドラッグ・ピンチ・ホイール・ボタン・キー） ----
  const ptrs = new Map();
  let drag = null, pinch0 = null;
  const zoomBy = (dz, ax, ay) => {
    const nz = Math.max(Math.min(state.fitZ ?? 9, 10) - 0.5, Math.min(16, state.view.z + dz));
    if (nz === state.view.z) return;
    const { w, h } = size(); ax = ax ?? w / 2; ay = ay ?? h / 2;
    const before = unproject(ax, ay); state.view.z = nz;
    const after = unproject(ax, ay);
    state.view.lon += before.lon - after.lon; state.view.lat += before.lat - after.lat;
    render();
  };
  const panBy = (dx, dy) => { const c = world(state.view.lon, state.view.lat), k = scale(); const n = lonlat(c.x - dx / k, c.y - dy / k); state.view.lon = n.lon; state.view.lat = Math.max(-80, Math.min(80, n.lat)); render(); };
  const pos = (e) => { const r = map.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  map.addEventListener('pointerdown', (e) => {
    map.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, pos(e));
    if (ptrs.size === 1) drag = { ...pos(e), moved: false };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: state.view.z }; drag = null; }
  });
  map.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = pos(e), prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, p);
    if (ptrs.size === 2 && pinch0) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      zoomBy(pinch0.z + Math.log2(d / pinch0.d) - state.view.z, (a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (drag) {
      if (Math.hypot(p.x - drag.x, p.y - drag.y) > 5) drag.moved = true;
      if (drag.moved) { panBy(p.x - prev.x, p.y - prev.y); map.style.cursor = 'grabbing'; }
    }
  });
  const end = (e) => {
    const wasClick = drag && !drag.moved && ptrs.size === 1 && e.type === 'pointerup';
    const p = pos(e); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = null; if (!ptrs.size) { drag = null; map.style.cursor = ''; }
    if (wasClick) { const ll = unproject(p.x, p.y); const w = L.wardAt(state.data.wards, ll.lon, ll.lat); select(w ? w.code : null); }
  };
  map.addEventListener('pointerup', end); map.addEventListener('pointercancel', end);
  map.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); zoomBy(e.deltaY < 0 ? 0.4 : -0.4, p.x, p.y); }, { passive: false });
  map.addEventListener('keydown', (e) => {
    const k = e.key, s = 60;
    if (k === 'ArrowLeft') panBy(s, 0); else if (k === 'ArrowRight') panBy(-s, 0); else if (k === 'ArrowUp') panBy(0, s); else if (k === 'ArrowDown') panBy(0, -s);
    else if (k === '+' || k === '=') zoomBy(0.5); else if (k === '-' || k === '_') zoomBy(-0.5); else return;
    e.preventDefault();
  });
  $('zin').addEventListener('click', () => zoomBy(0.6));
  $('zout').addEventListener('click', () => zoomBy(-0.6));
  $('zfit').addEventListener('click', () => { fit(); render(); });
  window.addEventListener('resize', () => { if (state.loaded) { buildTicks(); render(); } });
  if (window.ResizeObserver) new ResizeObserver(() => { if (state.loaded) render(); }).observe(map);

  // ---- 時間・再生・切り替え ----
  const slider = $('slider');
  function qIndexOf(key) { return state.data.price.quarters.indexOf(key); }
  function firstRentIndex() {
    const D = state.data, y = D.rent.years[0];
    return Math.max(0, qIndexOf(y + 'Q4'));
  }
  function setMode(mode) {
    state.mode = mode;
    $('modePrice').setAttribute('aria-pressed', String(mode === 'price'));
    $('modeRent').setAttribute('aria-pressed', String(mode === 'rent'));
    const M = L.MODES[mode];
    state.qmin = mode === 'rent' ? firstRentIndex() : 0;
    if (state.qi < state.qmin) state.qi = state.qmin;
    slider.min = String(state.qmin); slider.value = String(state.qi);
    $('modeNote').textContent = mode === 'price'
      ? '中古マンション等の取引価格の ㎡単価（中央値）。四半期ごと'
      : '借家の1畳当たり家賃。5年ごとの調査（' + state.data.rent.years.join('・') + '年）。間の期は直前の調査の値';
    $('legUnit').textContent = M.unit + (mode === 'price' ? '・㎡単価の中央値' : '・1畳当たり家賃');
    buildLegend(); buildTicks(); update();
  }
  function setTime(qi, fromUser) {
    state.qi = Math.max(state.qmin, Math.min(state.data.price.quarters.length - 1, qi));
    slider.value = String(state.qi);
    if (fromUser && state.timer) stop();
    update();
  }
  function update() {
    const D = state.data, q = D.price.quarters[state.qi];
    $('when').textContent = L.quarterLabel(q);
    slider.setAttribute('aria-valuetext', L.quarterLabel(q));
    drawOverlay(); renderDetail();
  }
  function play() {
    if (state.timer) return stop();
    const last = state.data.price.quarters.length - 1;
    if (state.qi >= last) setTime(state.qmin);
    $('play').textContent = '■ 停止'; $('play').setAttribute('aria-label', '停止');
    $('when').setAttribute('aria-live', 'off');
    state.timer = setInterval(() => {
      if (state.qi >= last) return stop();
      setTime(state.qi + 1);
      if (state.qi >= last) stop();
    }, PLAY_MS);
  }
  function stop() {
    clearInterval(state.timer); state.timer = null;
    $('play').textContent = '▶ 再生'; $('play').setAttribute('aria-label', '再生');
    $('when').removeAttribute('aria-live');
  }
  $('play').addEventListener('click', play);
  slider.addEventListener('input', () => setTime(Number(slider.value), true));
  $('modePrice').addEventListener('click', () => setMode('price'));
  $('modeRent').addEventListener('click', () => setMode('rent'));

  function buildTicks() {
    const D = state.data, n = D.price.quarters.length - 1, min = state.qmin, span = n - min, box = $('ticks');
    box.innerHTML = '';
    const small = window.innerWidth < 520;
    D.price.quarters.forEach((k, i) => {
      if (i < min || !/Q1$/.test(k)) return;
      const y = Number(k.slice(0, 4)); if (y % (small ? 10 : 5) !== 0) return;
      const s = document.createElement('span'); s.textContent = y + '年';
      s.style.left = 'calc(8px + (100% - 16px) * ' + ((i - min) / span).toFixed(4) + ')';
      box.appendChild(s);
    });
  }
  function buildLegend() {
    const M = L.MODES[state.mode], ul = $('legend'); ul.innerHTML = '';
    for (let i = M.breaks.length; i >= 0; i--) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="sw" style="background:' + L.PALETTE[i] + '"></span><span>' + L.esc(L.classLabel(i, M.breaks, M.unit)) + '</span>';
      ul.appendChild(li);
    }
    const lowN = state.data.price.filter?.lowN ?? L.LOW_N_DEFAULT;
    if (state.mode === 'price') {
      const li = document.createElement('li'); li.style.gridColumn = '1 / -1';
      li.innerHTML = '<span class="sw low"></span><span>斜線・薄い色・数字の後の「※」：件数が少ない（' + lowN + '件未満）</span>'; ul.appendChild(li);
    }
    $('legLow').textContent = state.mode === 'price'
      ? '区名の下の数字は、その四半期の㎡単価の中央値（万円/㎡）。色の階級は時間が動いても同じです。'
      : '区名の下の数字は、1畳当たり家賃（円）。色の階級は時間が動いても同じです。';
  }

  // ---- 区を選ぶ・推移のグラフ ----
  function select(code) { state.sel = code; drawOverlay(); renderDetail(); }
  const W = 360, PADL = 38, PADR = 10;
  function xOf(i, n) { return PADL + ((W - PADL - PADR) * i) / (n - 1); }
  function xAxis(n, qs, top, bottom) {
    let s = '<line class="axis" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + bottom + '" y2="' + bottom + '"/>';
    qs.forEach((k, i) => { if (/Q1$/.test(k) && Number(k.slice(0, 4)) % 5 === 0) s += '<line class="grid" x1="' + xOf(i, n).toFixed(1) + '" x2="' + xOf(i, n).toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/><text x="' + xOf(i, n).toFixed(1) + '" y="' + (bottom + 13) + '" text-anchor="middle">' + k.slice(0, 4) + '</text>'; });
    return s;
  }
  function priceChart(code) {
    const D = state.data, qs = D.price.quarters, n = qs.length, H = 170, top = 10, bottom = H - 22;
    const rows = qs.map((_, i) => L.priceAt(D.price, code, i));
    const maxV = Math.max(...rows.filter(Boolean).map((r) => r.p75 ?? r.unit));
    const ticks = L.niceTicks(0, maxV * 1.05, 4), yMax = ticks[ticks.length - 1] > maxV * 1.05 ? ticks[ticks.length - 1] : maxV * 1.05;
    const y = (v) => bottom - ((bottom - top) * v) / yMax;
    const med = rows.map((r, i) => (r ? { x: xOf(i, n), y: y(r.unit) } : null));
    const hi = rows.map((r, i) => (r ? { x: xOf(i, n), y: y(r.p75) } : null)), lo = rows.map((r, i) => (r ? { x: xOf(i, n), y: y(r.p25) } : null));
    let s = '<svg class="chart" id="priceChart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + L.esc(wardName(code)) + 'のマンション㎡単価の中央値の推移の折れ線グラフ。' + L.esc(chartSummary(rows, qs)) + '">';
    for (const t of ticks) s += '<line class="grid" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text x="' + (PADL - 4) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + t + '</text>';
    s += xAxis(n, qs, top, bottom);
    s += '<path class="band" d="' + L.bandPath(hi, lo) + '"/><path class="line" d="' + L.linePath(med) + '"/>';
    rows.forEach((r, i) => { if (r && r.low) s += '<circle class="dotlow" cx="' + xOf(i, n).toFixed(1) + '" cy="' + y(r.unit).toFixed(1) + '" r="3.4"/>'; });
    const cx = xOf(state.qi, n).toFixed(1), cr = rows[state.qi];
    s += '<line class="cur" x1="' + cx + '" x2="' + cx + '" y1="' + top + '" y2="' + bottom + '"/>';
    if (cr) s += '<circle class="dot" cx="' + cx + '" cy="' + y(cr.unit).toFixed(1) + '" r="4.5" stroke="#fff" stroke-width="1.5"/>';
    return s + '</svg>';
  }
  function chartSummary(rows, qs) {
    const a = rows.findIndex(Boolean), b = rows.length - 1 - [...rows].reverse().findIndex(Boolean);
    return qs[a] + 'は' + L.priceText(rows[a]) + '、' + qs[b] + 'は' + L.priceText(rows[b]) + '。';
  }
  function rentChart(code) {
    const D = state.data, qs = D.price.quarters, n = qs.length, H = 120, top = 14, bottom = H - 22;
    const pts = D.rent.years.map((yr) => ({ yr, i: qIndexOf(yr + 'Q4'), v: D.rent.wards[code][D.rent.years.indexOf(yr)] })).filter((p) => p.v !== null && p.i >= 0);
    if (!pts.length) return '<p class="minor">この区の家賃のデータはありません。</p>';
    const vals = pts.map((p) => p.v), lo = Math.min(...vals), hi = Math.max(...vals);
    const ticks = L.niceTicks(Math.floor(lo * 0.85 / 1000) * 1000, Math.ceil(hi * 1.08 / 1000) * 1000, 4), t0 = ticks[0], t1 = ticks[ticks.length - 1];
    const y = (v) => bottom - ((bottom - top) * (v - t0)) / (t1 - t0);
    const sy = L.surveyYearFor(qs[state.qi], D.rent.years);
    let s = '<svg class="chart" id="rentChart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + L.esc(wardName(code)) + 'の1畳当たり家賃の折れ線グラフ。' + pts.map((p) => p.yr + '年は' + L.fmt(p.v) + '円').join('、') + '">';
    for (const t of ticks) s += '<line class="grid" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text x="' + (PADL - 4) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + t.toLocaleString('ja-JP') + '</text>';
    s += xAxis(n, qs, top, bottom);
    s += '<path class="rentline" d="' + L.linePath(pts.map((p) => ({ x: xOf(p.i, n), y: y(p.v) }))) + '"/>';
    const cx = xOf(state.qi, n).toFixed(1);
    s += '<line class="cur" x1="' + cx + '" x2="' + cx + '" y1="' + top + '" y2="' + bottom + '"/>';
    for (const p of pts) {
      const px = xOf(p.i, n);
      s += '<circle class="rentdot' + (p.yr === sy ? ' on' : '') + '" cx="' + px.toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="4.5"/><text x="' + Math.min(px, W - 18).toFixed(1) + '" y="' + (y(p.v) - 8).toFixed(1) + '" text-anchor="middle">' + p.v.toLocaleString('ja-JP') + '</text>';
    }
    return s + '</svg>';
  }
  const wardName = (code) => state.data.wards.find((w) => w.code === code)?.name ?? code;

  function readoutPrice(code) {
    const D = state.data, p = L.priceAt(D.price, code, state.qi), q = D.price.quarters[state.qi];
    if (!p) return '<p class="rd">' + L.esc(L.quarterLabel(q)) + ': ' + L.NODATA + '</p>';
    const lowN = D.price.filter?.lowN ?? L.LOW_N_DEFAULT;
    const lastTwo = state.qi >= D.price.quarters.length - 2;
    return '<p class="rd">' + L.esc(L.quarterLabel(q)) + '　㎡単価の中央値 <strong>' + L.esc(L.priceText(p)) + '</strong>（半数の取引が ' + L.fmt(p.p25, 0) + '〜' + L.fmt(p.p75, 0) + '万円/㎡）</p>'
      + '<p class="rd">取引件数 <strong>' + p.n + '件</strong>' + (p.low ? ' <span class="badge">件数が少ない</span>' : '') + '　築年数の中央値 ' + (p.age === null ? L.NODATA : p.age + '年') + '　面積の中央値 ' + p.area + '㎡　総額の中央値 ' + L.fmt(p.total) + '万円</p>'
      + (p.low ? '<p class="minor">' + L.esc(L.lowText(p.n, lowN)) + '。</p>' : '')
      + (lastTwo ? '<p class="minor">最新の2四半期は、取引の登録が途中のため件数が少ない場合があります（取得時点）。</p>' : '');
  }
  function readoutRent(code) {
    const D = state.data, r = L.rentAt(D.rent, code, D.price.quarters[state.qi]);
    if (!r) return '<p class="rd">家賃: この時点より前の調査はありません（最初は ' + L.esc(D.rent.years[0]) + '年10月）。</p>';
    return '<p class="rd">家賃（1畳当たり） <strong>' + L.fmt(r.value) + '円/畳</strong>（' + L.esc(r.year) + '年10月の調査' + (D.price.quarters[state.qi].startsWith(r.year) ? '' : '。次の調査まで同じ値') + '）</p>';
  }
  function tableHtml(code) {
    const D = state.data, qs = D.price.quarters, years = [...new Set(qs.map((k) => k.slice(0, 4)))];
    let h = '<details><summary>数値の表（各年の第2四半期。2005年は第3四半期）</summary><table class="tbl"><thead><tr><th scope="col">年</th><th scope="col">㎡単価(万円)</th><th scope="col">件数</th><th scope="col">築年数</th><th scope="col">家賃(円/畳)</th></tr></thead><tbody>';
    for (const y of years) {
      const k = qs.includes(y + 'Q2') ? y + 'Q2' : qs.find((q) => q.startsWith(y)), i = qs.indexOf(k), p = L.priceAt(D.price, code, i);
      const ri = D.rent.years.indexOf(y), rv = ri >= 0 ? D.rent.wards[code][ri] : null;
      h += '<tr><th scope="row">' + y + '</th><td>' + (p ? L.fmt(p.unit, p.unit < 100 ? 1 : 0) : '—') + '</td><td>' + (p ? p.n + (p.low ? '（少）' : '') : '—') + '</td><td>' + (p && p.age !== null ? p.age : '—') + '</td><td>' + (rv === null ? '' : L.fmt(rv)) + '</td></tr>';
    }
    return h + '</tbody></table></details>';
  }
  function rankingHtml(open) {
    const rows = L.ranking(state.mode, state.data, state.qi), M = L.MODES[state.mode];
    let h = '<details' + (open ? ' open' : '') + '><summary>順位表（高い順。押すとその区を選びます）</summary><ol class="ranks">';
    rows.forEach((r, i) => { h += '<li><button type="button" class="rk" data-code="' + r.code + '"><span>' + (i + 1) + '. ' + L.esc(r.name) + (r.low ? '（件数少）' : '') + '</span><b>' + L.esc(L.fmt(r.value, state.mode === 'price' && r.value < 100 ? 1 : 0)) + M.unit + '</b></button></li>'; });
    return h + '</ol></details>';
  }
  function renderDetail() {
    const box = $('detailBody'), D = state.data; if (!D) return;
    const code = state.sel;
    let h;
    if (!code) {
      h = '<p class="rd">地図の区を押すと、その区の推移（折れ線）と件数が出ます。</p>' + rankingHtml(true);
    } else {
      h = '<div class="ward"><h3>' + L.esc(wardName(code)) + ' <button type="button" class="clr" id="clr">選択をやめる</button></h3>'
        + (state.mode === 'price' ? readoutPrice(code) + readoutRent(code) : readoutRent(code) + readoutPrice(code))
        + '<p class="cap">マンション㎡単価の中央値（万円/㎡）。帯は半数の取引の幅、白丸は件数が少ない期</p>' + priceChart(code)
        + '<p class="cap">家賃（円/畳。5年ごとの調査）</p>' + rentChart(code)
        + '<p class="minor">グラフを押すと、その時点に移ります。点線は今の時点です。</p>' + tableHtml(code) + rankingHtml(false) + '</div>';
    }
    box.innerHTML = h;
    const ss = $('selLine');
    if (ss) ss.innerHTML = code ? '選択中: <strong>' + L.esc(wardName(code)) + '</strong>　' + L.esc(L.cellText(state.mode, '', L.cellFor(state.mode, D, code, state.qi)).trim()) + '　<a href="#detail">推移のグラフへ</a>' : '区を押すと、推移のグラフと件数が出ます。';
    box.querySelectorAll('.rk').forEach((b) => b.addEventListener('click', () => select(b.dataset.code)));
    const clr = $('clr'); if (clr) clr.addEventListener('click', () => select(null));
    for (const id of ['priceChart', 'rentChart']) {
      const el = $(id); if (!el) continue;
      el.addEventListener('click', (e) => {
        const r = el.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * W, n = D.price.quarters.length;
        setTime(Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1)), true);
      });
    }
  }

  // ---- 起動 ----
  function showError(msg) { const e = $('loaderr'); e.hidden = false; e.textContent = msg; }
  function fill() {
    $('noticeTop').textContent = L.NOTICE;
    $('attribution').textContent = L.ATTRIBUTION; $('processed').textContent = L.PROCESSED; $('credit').textContent = L.CREDIT;
    $('attributionRent').textContent = L.ATTRIBUTION_RENT; $('creditEstat').textContent = L.CREDIT_ESTAT;
    $('attributionMap').textContent = L.ATTRIBUTION_MAP; $('resp').textContent = L.RESPONSIBILITY;
    $('mapAttr').textContent = '地図: 国土地理院／区境界: 国土数値情報（国土交通省）を加工／値: 不動産情報ライブラリ（国土交通省）・総務省統計局を加工';
  }
  fill();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.json(); });
  Promise.all([get('data/price.json'), get('data/rent.json'), get('data/wards.json')]).then(([p, r, w]) => {
    const D = L.validate(p, r, w);
    if (!D) throw new Error('データの形式が想定と違います');
    state.data = D; state.loaded = true;
    $('fetchedAt').textContent = p.fetchedAt + '（マンション価格）／' + r.fetchedAt + '（家賃）';
    slider.max = String(p.quarters.length - 1);
    state.qi = p.quarters.length - 1;
    fit(); setMode('price'); render();
    if (new URLSearchParams(location.search).get('autoplay')) play();
  }).catch((e) => showError('データを読み込めませんでした（' + e.message + '）。ファイルを直接開かず、サーバー経由（http://）で開いてください。'));
  window.__tl = state; // 試験用
})();
