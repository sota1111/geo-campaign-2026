/* 23区、値段の年表: 画面。ネットワークは GET のみ（国土地理院のタイル、同梱データ data/*.json、クリックした区の data/detail/<区コード>.json）。
 * 不動産情報ライブラリ・統計のAPIはここからは呼ばない（取得は tools/fetch*.mjs で事前に行う）。操作は端末内のみ。 */
(function () {
  'use strict';
  const L = window.Lib;
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/pale/';
  const PLAY_MS = 650;
  const state = { data: null, mode: 'price', pi: 0, yi: 0, sel: null, selWard: null, view: { lon: 139.74, lat: 35.68, z: 11 }, timer: null, loaded: false, details: new Map() };

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
  const GRAY = 'rgba(140,140,140,.32)';
  function pathOf(g, rings) {
    g.beginPath();
    for (const ring of rings) { ring.forEach(([lon, lat], i) => { const p = project(lon, lat); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }); g.closePath(); }
  }
  const halo = (g, text, x, y) => { g.strokeText(text, x, y); g.fillText(text, x, y); };
  function drawOverlay() {
    const D = state.data; if (!D) return;
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const mode = state.mode, z = state.view.z, k = scale();
    const tl = unproject(0, 0), br = unproject(w, h);
    const vis = (b) => b.x1 >= tl.lon && b.x0 <= br.lon && b.y1 >= br.lat && b.y0 <= tl.lat;
    const pxW = (b) => ((b.x1 - b.x0) / 360) * k;
    const pxH = (b) => (world(0, b.y0).y - world(0, b.y1).y) * k;
    const small = w < 520;
    // 地区（価格）。家賃のときは地区は塗らず、うすい線だけ
    g.lineJoin = 'round';
    for (const d of D.districts) {
      if (!vis(d.bbox)) continue;
      pathOf(g, d.rings);
      if (mode === 'price') {
        const c = L.cellFor('price', D, d, state.pi, state.yi);
        if (c.cls < 0) { g.fillStyle = GRAY; g.fill('evenodd'); }
        else {
          g.fillStyle = L.PALETTE[c.cls]; g.globalAlpha = c.low ? 0.4 : 0.88; g.fill('evenodd'); g.globalAlpha = 1;
          if (c.low) { g.fillStyle = hatchPattern(g); g.fill('evenodd'); }
        }
        g.lineWidth = 0.6; g.strokeStyle = z < 11.6 ? 'rgba(59,70,82,.28)' : 'rgba(59,70,82,.55)'; g.stroke();
      } else {
        g.lineWidth = 0.5; g.strokeStyle = 'rgba(59,70,82,.22)'; g.stroke();
      }
    }
    // 区（家賃のときは区を塗る）。区の境界は太線
    const wlabels = [];
    for (const wd of D.wards) {
      if (!vis(wd.bbox)) continue;
      const c = mode === 'rent' ? L.cellFor('rent', D, wd, 0, state.yi) : null;
      pathOf(g, wd.rings);
      if (c) { g.fillStyle = c.cls < 0 ? GRAY : L.PALETTE[c.cls]; g.globalAlpha = c.cls < 0 ? 1 : 0.86; g.fill('evenodd'); g.globalAlpha = 1; }
      g.lineWidth = z < 11.6 ? 2.2 : 2.8; g.strokeStyle = '#1d2733'; g.stroke();
      wlabels.push({ wd, c });
    }
    // 選択した地区（家賃のときは区）は太い縁（色以外でも分かる）
    const seld = mode === 'price' && state.sel ? D.byKey.get(state.sel) : null;
    const selw = mode === 'rent' && state.selWard ? D.wardByCode.get(state.selWard) : null;
    const target = seld || selw;
    if (target) { pathOf(g, target.rings); g.lineWidth = 5.5; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 3; g.strokeStyle = '#d6336c'; g.stroke(); }
    // 地区名と値（地図を拡大して、地区が十分大きいときだけ）
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fsD = small ? 9 : 11;
    if (mode === 'price' && z >= 11.6) {
      g.font = 'bold ' + fsD + 'px "Hiragino Sans","Noto Sans JP",sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.92)'; g.fillStyle = '#1d2733';
      for (const d of D.districts) {
        if (!vis(d.bbox)) continue;
        const bw = pxW(d.bbox), bh = pxH(d.bbox), nm = d.label;
        if (bw < Math.max(34, nm.length * fsD * 0.9) || bh < fsD * 2.6) continue;
        const c = L.cellFor('price', D, d, state.pi, state.yi), p = project(d.lp.lon, d.lp.lat);
        const val = c.value === null ? '' : c.value + (c.low ? '※' : '');
        halo(g, nm, p.x, p.y - (val ? fsD * 0.6 : 0)); if (val) halo(g, val, p.x, p.y + fsD * 0.6);
      }
    }
    // 区名（家賃のときは値も）
    for (const { wd, c } of wlabels) {
      const lp = wd.lp, p = project(lp.lon, lp.lat), px = pxW(wd.bbox);
      const nm = wd.name.replace(/区$/, ''), showVal = c && c.value !== null && px >= (small ? 20 : 30);
      const fs = small ? 10 : px > 60 ? 13 : 11;
      if (mode === 'price' && z >= 12.6 && px > 260) continue; // 十分拡大したら区名は出さない（地区名を優先）
      g.font = 'bold ' + fs + 'px "Hiragino Sans","Noto Sans JP",sans-serif';
      g.lineWidth = 3.4; g.strokeStyle = 'rgba(255,255,255,.95)'; g.fillStyle = '#10161d';
      const y0 = showVal ? p.y - fs * 0.6 : p.y;
      halo(g, nm, p.x, y0);
      if (showVal) halo(g, String(Math.round(c.value)), p.x, y0 + fs * 1.15);
    }
    const ps = $('period');
    if (mode === 'rent') {
      const sy = L.surveyYearFor(D.price.years[state.yi], D.rent.years);
      ps.innerHTML = L.esc(D.price.years[state.yi] + '年') + '<small>家賃: ' + (sy ? L.esc(sy) + '年10月の調査の値（区ごと）' : L.NODATA) + '</small>';
    } else ps.innerHTML = L.esc(L.windowShort(D.price, state.yi)) + '<small>' + L.esc(L.windowLabel(D.price, state.yi)) + 'の取引</small>';
  }
  function render() { renderTiles(); drawOverlay(); }

  // ---- 地図の操作（ドラッグ・ピンチ・ホイール・ボタン・キー） ----
  const ptrs = new Map();
  let drag = null, pinch0 = null;
  const zoomBy = (dz, ax, ay) => {
    const nz = Math.max(Math.min(state.fitZ ?? 9, 10) - 0.5, Math.min(17, state.view.z + dz));
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
    if (wasClick) { const ll = unproject(p.x, p.y); pickAt(ll.lon, ll.lat); }
  };
  function pickAt(lon, lat) {
    const D = state.data;
    if (state.mode === 'price') { const d = L.districtAt(D, lon, lat); select(d ? d.key : null); }
    else { const w = L.wardAt(D, lon, lat); selectWard(w ? w.code : null); }
  }
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

  // ---- 時間（年）・間取り・再生・切り替え ----
  const slider = $('slider');
  function buildPlanBar() {
    const bar = $('planbar'); bar.innerHTML = '';
    state.data.price.plans.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'mode plan'; b.textContent = p.label; b.title = p.note; b.dataset.pi = String(i);
      b.addEventListener('click', () => setPlan(i)); bar.appendChild(b);
    });
  }
  function syncPlanBar() {
    const rent = state.mode === 'rent';
    $('planbar').querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(!rent && Number(b.dataset.pi) === state.pi));
      b.disabled = rent; b.setAttribute('aria-disabled', String(rent));
    });
    $('planbar').setAttribute('aria-label', rent ? '間取り（家賃は間取りで分けられないため選べません）' : '間取り');
  }
  function setPlan(i) { state.pi = i; syncPlanBar(); update(); }
  function setMode(mode) {
    state.mode = mode;
    $('modePrice').setAttribute('aria-pressed', String(mode === 'price'));
    $('modeRent').setAttribute('aria-pressed', String(mode === 'rent'));
    const M = L.MODES[mode];
    $('modeNote').hidden = mode === 'price';
    $('modeNote').textContent = mode === 'price' ? '' : '家賃は区ごとの値です。間取り・町丁目には分けられません（5年ごとの調査。間の年は直前の値）';
    $('legUnit').textContent = M.unit + (mode === 'price' ? '・㎡単価の中央値' : '・1畳当たり家賃（区）');
    syncPlanBar(); buildLegend(); update();
  }
  function setTime(yi, fromUser) {
    state.yi = Math.max(0, Math.min(state.data.price.years.length - 1, yi));
    slider.value = String(state.yi);
    if (fromUser && state.timer) stop();
    update();
  }
  function whenText() {
    const P = state.data.price;
    return state.mode === 'price' ? L.windowLabel(P, state.yi) + '（直近5年の取引）' : P.years[state.yi] + '年（家賃は調査年の値）';
  }
  function update() {
    $('when').textContent = whenText();
    slider.setAttribute('aria-valuetext', whenText());
    drawOverlay(); updateCounts(); renderDetail();
  }
  function updateCounts() {
    const D = state.data, el = $('legCount');
    if (state.mode !== 'price') { el.textContent = ''; return; }
    const c = L.stateCounts(D, state.pi, state.yi), shown = c.ok + c.low, f = D.price.filter;
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    el.textContent = 'いまの表示（' + D.price.plans[state.pi].label + '・' + L.windowShort(D.price, state.yi) + '）: 全' + c.total + '地区のうち、値を出せるのは ' + shown + '地区。その' + pct(c.low, shown) + '%（' + c.low + '地区）は件数が少ない（' + f.lowN + '件未満）。データなしは ' + (c.none + c.few) + '地区（0件 ' + c.none + '・' + f.minN + '件未満 ' + c.few + '）。';
  }
  function play() {
    if (state.timer) return stop();
    const last = state.data.price.years.length - 1;
    if (state.yi >= last) setTime(0);
    $('play').textContent = '■ 停止'; $('play').setAttribute('aria-label', '停止');
    $('when').setAttribute('aria-live', 'off');
    state.timer = setInterval(() => {
      if (state.yi >= last) return stop();
      setTime(state.yi + 1);
      if (state.yi >= last) stop();
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
    const ys = state.data.price.years, n = ys.length - 1, box = $('ticks');
    box.innerHTML = '';
    const small = window.innerWidth < 520;
    ys.forEach((y, i) => {
      if (y % (small ? 10 : 5) !== 0) return;
      const s = document.createElement('span'); s.textContent = y + '年';
      s.style.left = 'calc(8px + (100% - 16px) * ' + (i / n).toFixed(4) + ')';
      box.appendChild(s);
    });
  }
  function buildLegend() {
    const M = L.MODES[state.mode], ul = $('legend'); ul.innerHTML = '';
    for (let i = M.breaks.length; i >= 0; i--) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="sw" style="background:' + L.PALETTE[i] + '"></span><span>' + L.esc(L.classLabel(i, M.breaks)) + '</span>';
      ul.appendChild(li);
    }
    const f = state.data.price.filter;
    const add = (cls, text) => { const li = document.createElement('li'); li.style.gridColumn = '1 / -1'; li.innerHTML = '<span class="sw ' + cls + '"></span><span>' + L.esc(text) + '</span>'; ul.appendChild(li); };
    if (state.mode === 'price') {
      add('low', '斜線・薄い色・数字の後の「※」：件数が少ない（' + f.lowN + '件未満。作成者の基準）');
      add('none', '灰色：データなし（0件、または' + f.minN + '件未満で中央値を出さない）');
    } else add('none', '灰色：調査なし');
    $('legLow').textContent = state.mode === 'price'
      ? '太い線は区の境界、細い線は地区の境界。地区名の下の数字は㎡単価の中央値（万円/㎡）。拡大すると地区名が出ます。色の階級は年・間取りを変えても同じです。'
      : '太い線が区の境界。区名の下の数字は1畳当たり家賃（円）。色の階級は年を変えても同じです。';
  }

  // ---- 地区・区を選ぶ・推移のグラフ ----
  function select(key) {
    state.sel = key;
    const d = key ? state.data.byKey.get(key) : null;
    if (d) { state.selWard = d.code; loadDetail(d.code); }
    drawOverlay(); renderDetail(); revealDetail(key);
  }
  function selectWard(code) { state.selWard = code; state.sel = null; drawOverlay(); renderDetail(); revealDetail(code); }
  /** 広い画面では、右の欄を「地区の推移」の位置までスクロールして、選んだ結果が見えるようにする（狭い画面はページが動くので何もしない） */
  function revealDetail(picked) {
    const side = $('side');
    if (!picked || window.innerWidth <= 900 || side.scrollHeight <= side.clientHeight) return;
    side.scrollTop = $('detail').offsetTop - side.offsetTop - 8;
  }
  function loadDetail(code) {
    if (state.details.has(code)) return;
    state.details.set(code, 'loading');
    fetch('data/detail/' + code + '.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((j) => { state.details.set(code, j); renderDetail(); })
      .catch(() => { state.details.set(code, 'failed'); renderDetail(); });
  }
  const detailOf = (code) => { const v = state.details.get(code); return v && typeof v === 'object' ? v : null; };
  const W = 360, PADL = 38, PADR = 10;
  const xOf = (i, n) => PADL + ((W - PADL - PADR) * i) / Math.max(1, n - 1);
  function xAxis(ys, top, bottom) {
    const n = ys.length;
    let s = '<line class="axis" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + bottom + '" y2="' + bottom + '"/>';
    ys.forEach((y, i) => { if (y % 5 === 0) s += '<line class="grid" x1="' + xOf(i, n).toFixed(1) + '" x2="' + xOf(i, n).toFixed(1) + '" y1="' + top + '" y2="' + bottom + '"/><text x="' + xOf(i, n).toFixed(1) + '" y="' + (bottom + 13) + '" text-anchor="middle">' + y + '</text>'; });
    return s;
  }
  const wardName = (code) => state.data.wardByCode.get(code)?.name ?? code;
  function priceChart(d) {
    const D = state.data, P = D.price, ys = P.years, n = ys.length, H = 170, top = 10, bottom = H - 22, pi = state.pi;
    const det = detailOf(d.code);
    const rows = ys.map((_, i) => { const c = L.districtCell(P, d.code, d.pname, pi, i); return { c, x: det && c.value !== null ? L.detailAt(det, d.pname, pi, i) : null }; });
    const ward = ys.map((_, i) => L.wardCell(P, d.code, pi, i));
    const vals = [];
    rows.forEach((r) => { if (r.c.value !== null) vals.push(r.c.value, r.x ? r.x.p75 : r.c.value); });
    ward.forEach((r) => { if (r && r.unit !== null) vals.push(r.unit); });
    const maxV = Math.max(...vals), ticks = L.niceTicks(0, maxV * 1.05, 4), yMax = ticks[ticks.length - 1] > maxV * 1.05 ? ticks[ticks.length - 1] : maxV * 1.05;
    const y = (v) => bottom - ((bottom - top) * v) / yMax;
    const med = rows.map((r, i) => (r.c.value !== null ? { x: xOf(i, n), y: y(r.c.value) } : null));
    const hi = rows.map((r, i) => (r.x ? { x: xOf(i, n), y: y(r.x.p75) } : null)), lo = rows.map((r, i) => (r.x ? { x: xOf(i, n), y: y(r.x.p25) } : null));
    const wl = ward.map((r, i) => (r && r.unit !== null ? { x: xOf(i, n), y: y(r.unit) } : null));
    let s = '<svg class="chart" id="priceChart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + L.esc(d.label) + 'の' + L.esc(P.plans[pi].label) + 'のマンション㎡単価の中央値の推移の折れ線グラフ。' + L.esc(chartSummary(rows, ys)) + '">';
    for (const t of ticks) s += '<line class="grid" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text x="' + (PADL - 4) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + t + '</text>';
    s += xAxis(ys, top, bottom);
    s += '<path class="wardline" d="' + L.linePath(wl) + '"/><path class="band" d="' + L.bandPath(hi, lo) + '"/><path class="line" d="' + L.linePath(med) + '"/>';
    rows.forEach((r, i) => { if (r.c.low) s += '<circle class="dotlow" cx="' + xOf(i, n).toFixed(1) + '" cy="' + y(r.c.value).toFixed(1) + '" r="3.4"/>'; });
    const cx = xOf(state.yi, n).toFixed(1), cr = rows[state.yi].c;
    s += '<line class="cur" x1="' + cx + '" x2="' + cx + '" y1="' + top + '" y2="' + bottom + '"/>';
    if (cr.value !== null) s += '<circle class="dot" cx="' + cx + '" cy="' + y(cr.value).toFixed(1) + '" r="4.5" stroke="#fff" stroke-width="1.5"/>';
    return s + '</svg>';
  }
  function chartSummary(rows, ys) {
    const idx = rows.map((r, i) => (r.c.value !== null ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return '値を出せる年がありません。';
    const a = idx[0], b = idx[idx.length - 1];
    return ys[a] + '年は' + rows[a].c.value + '万円/㎡、' + ys[b] + '年は' + rows[b].c.value + '万円/㎡。';
  }
  function rentChart(code) {
    const D = state.data, ys = D.price.years, n = ys.length, H = 120, top = 14, bottom = H - 22;
    const pts = D.rent.years.map((yr) => ({ yr, i: ys.indexOf(Number(yr)), v: D.rent.wards[code][D.rent.years.indexOf(yr)] })).filter((p) => p.v !== null && p.i >= 0);
    if (!pts.length) return '<p class="minor">この区の家賃のデータはありません。</p>';
    const vals = pts.map((p) => p.v), lo = Math.min(...vals), hi = Math.max(...vals);
    const ticks = L.niceTicks(Math.floor(lo * 0.85 / 1000) * 1000, Math.ceil(hi * 1.08 / 1000) * 1000, 4), t0 = ticks[0], t1 = ticks[ticks.length - 1];
    const y = (v) => bottom - ((bottom - top) * (v - t0)) / (t1 - t0);
    const sy = L.surveyYearFor(ys[state.yi], D.rent.years);
    let s = '<svg class="chart" id="rentChart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + L.esc(wardName(code)) + 'の1畳当たり家賃の折れ線グラフ。' + pts.map((p) => p.yr + '年は' + L.fmt(p.v) + '円').join('、') + '">';
    for (const t of ticks) s += '<line class="grid" x1="' + PADL + '" x2="' + (W - PADR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/><text x="' + (PADL - 4) + '" y="' + (y(t) + 4).toFixed(1) + '" text-anchor="end">' + t.toLocaleString('ja-JP') + '</text>';
    s += xAxis(ys, top, bottom);
    s += '<path class="rentline" d="' + L.linePath(pts.map((p) => ({ x: xOf(p.i, n), y: y(p.v) }))) + '"/>';
    const cx = xOf(state.yi, n).toFixed(1);
    s += '<line class="cur" x1="' + cx + '" x2="' + cx + '" y1="' + top + '" y2="' + bottom + '"/>';
    for (const p of pts) {
      const px = xOf(p.i, n);
      s += '<circle class="rentdot' + (p.yr === sy ? ' on' : '') + '" cx="' + px.toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="4.5"/><text x="' + Math.min(px, W - 18).toFixed(1) + '" y="' + (y(p.v) - 8).toFixed(1) + '" text-anchor="middle">' + p.v.toLocaleString('ja-JP') + '</text>';
    }
    return s + '</svg>';
  }

  function readoutPrice(d) {
    const D = state.data, P = D.price, c = L.districtCell(P, d.code, d.pname, state.pi, state.yi), plan = P.plans[state.pi];
    const f = P.filter, wlabel = L.windowLabel(P, state.yi), det = detailOf(d.code);
    const head = '<p class="rd">' + L.esc(wlabel) + '・' + L.esc(plan.label) + '</p>';
    if (c.state === 'none' || c.state === 'few') return head + '<p class="rd"><strong>' + L.NODATA + '</strong>（' + (c.n === 0 ? 'この窓の取引は0件' : c.n + '件のみ。' + f.minN + '件未満は中央値を出しません') + '）</p>';
    const x = det ? L.detailAt(det, d.pname, state.pi, state.yi) : null;
    const lastTwo = state.yi === P.years.length - 1;
    return head + '<p class="rd">㎡単価の中央値 <strong>' + L.fmt(c.value) + '万円/㎡</strong>' + (x ? '（半数の取引が ' + L.fmt(x.p25) + '〜' + L.fmt(x.p75) + '万円/㎡）' : '') + '</p>'
      + '<p class="rd">取引件数 <strong>' + c.n + '件</strong>' + (c.low ? ' <span class="badge">件数が少ない</span>' : '') + (x ? '　築年数の中央値 ' + (x.age === null ? L.NODATA : x.age + '年') + '　面積の中央値 ' + x.area + '㎡' : '') + '</p>'
      + (c.low ? '<p class="minor">' + L.esc(L.lowText(c.n, f.lowN)) + '。</p>' : '')
      + (lastTwo ? '<p class="minor">最後の年は2026年6月までの取引（登録が途中の取引は含まれません）。</p>' : '');
  }
  function wardContext(code) {
    const D = state.data, P = D.price, wc = L.wardCell(P, code, state.pi, state.yi);
    if (!wc || wc.unit === null) return '<p class="rd">区全体（' + L.esc(P.plans[state.pi].label) + '）: ' + L.NODATA + '</p>';
    return '<p class="rd">区全体（' + L.esc(wardName(code)) + '・' + L.esc(P.plans[state.pi].label) + '）の中央値 <strong>' + L.fmt(wc.unit) + '万円/㎡</strong>（' + wc.n + '件）</p>';
  }
  function readoutRent(code) {
    const D = state.data, r = L.rentAt(D.rent, code, D.price.years[state.yi]);
    if (!r) return '<p class="rd">家賃: この時点より前の調査はありません（最初は ' + L.esc(D.rent.years[0]) + '年10月）。</p>';
    return '<p class="rd">' + L.esc(wardName(code)) + 'の家賃（1畳当たり） <strong>' + L.fmt(r.value) + '円/畳</strong>（' + L.esc(r.year) + '年10月の調査' + (String(D.price.years[state.yi]) === r.year ? '' : '。次の調査まで同じ値') + '）</p>';
  }
  function tableHtml(d) {
    const D = state.data, P = D.price;
    let h = '<details><summary>数値の表（年ごと）</summary><table class="tbl"><thead><tr><th scope="col">年</th><th scope="col">件数</th><th scope="col">中央値(万円/㎡)</th><th scope="col">区の中央値</th></tr></thead><tbody>';
    P.years.forEach((y, i) => {
      const c = L.districtCell(P, d.code, d.pname, state.pi, i), wc = L.wardCell(P, d.code, state.pi, i);
      h += '<tr><th scope="row">' + y + '</th><td>' + c.n + (c.state === 'low' ? '（少）' : '') + '</td><td>' + (c.value === null ? '—' : L.fmt(c.value)) + '</td><td>' + (wc && wc.unit !== null ? L.fmt(wc.unit) : '—') + '</td></tr>';
    });
    return h + '</tbody></table></details>';
  }
  function rankingHtml(open) {
    const D = state.data;
    if (state.mode === 'rent') {
      const rows = L.wardRanking(D, state.yi);
      let h = '<details' + (open ? ' open' : '') + '><summary>区の順位表（高い順。押すとその区を選びます）</summary><ol class="ranks">';
      rows.forEach((r, i) => { h += '<li><button type="button" class="rk" data-ward="' + r.w.code + '"><span>' + (i + 1) + '. ' + L.esc(r.w.name) + '</span><b>' + L.esc(L.fmt(r.value)) + '円/畳</b></button></li>'; });
      return h + '</ol></details>';
    }
    const rows = L.ranking(D, state.pi, state.yi);
    let h = '<details' + (open ? ' open' : '') + '><summary>地区の順位表（件数が' + D.price.filter.lowN + '件以上の地区の高い順 上位30。押すと選びます）</summary><ol class="ranks">';
    rows.slice(0, 30).forEach((r, i) => { h += '<li><button type="button" class="rk" data-key="' + L.esc(r.d.key) + '"><span>' + (i + 1) + '. ' + L.esc(r.d.label) + '<small>（' + L.esc(r.d.ward) + '・' + r.n + '件）</small></span><b>' + L.esc(L.fmt(r.value)) + '万円/㎡</b></button></li>'; });
    return h + '</ol></details>';
  }
  function findHtml() {
    return '<div class="find"><label for="find">地区名で探す</label><input id="find" list="dlist" autocomplete="off" placeholder="例: 西新宿"><datalist id="dlist">'
      + state.data.districts.map((d) => '<option value="' + L.esc(d.label + '（' + d.ward + '）') + '"></option>').join('') + '</datalist></div>';
  }
  function renderDetail() {
    const box = $('detailBody'), D = state.data; if (!D) return;
    const rent = state.mode === 'rent', d = state.sel ? D.byKey.get(state.sel) : null;
    $('detH').textContent = rent ? '区の家賃の推移' : '地区の推移';
    let h;
    if (rent) {
      const code = state.selWard;
      if (!code) h = '<p class="rd">地図の区を押すと、その区の家賃の推移が出ます。家賃は区ごとの調査で、間取り・町丁目には分けられません。</p>' + rankingHtml(true);
      else h = '<div class="ward"><h3>' + L.esc(wardName(code)) + ' <button type="button" class="clr" id="clr">選択をやめる</button></h3>' + readoutRent(code)
        + '<p class="cap">家賃（円/畳。5年ごとの調査・区ごと。間取り・地区では分けられません）</p>' + rentChart(code)
        + '<p class="minor">グラフを押すと、その年に移ります。点線は今の年です。</p>' + rankingHtml(false) + '</div>';
    } else if (!d) {
      h = findHtml() + '<p class="rd">地図の地区を押すと、その地区の推移（折れ線）と件数が出ます。</p>' + rankingHtml(true);
    } else {
      const loading = state.details.get(d.code) === 'loading', failed = state.details.get(d.code) === 'failed';
      h = findHtml() + '<div class="ward"><h3>' + L.esc(d.label) + '<small>（' + L.esc(d.ward) + '）</small> <button type="button" class="clr" id="clr">選択をやめる</button></h3>'
        + (d.pname ? readoutPrice(d) + wardContext(d.code) : '<p class="rd"><strong>' + L.NODATA + '</strong>（この町名の中古マンション等の取引は、取得した期間にありません）</p>')
        + (d.pname ? '<p class="cap">㎡単価の中央値（万円/㎡）。' + L.esc(D.price.plans[state.pi].label) + '・各年は直近5年の取引</p>' + (!D.price.districts[d.code][d.pname]?.[state.pi] ? '<p class="minor">この間取りの取引は、期間中ありません。</p>' : priceChart(d))
          + '<p class="minor">青い線は地区、灰色の線は区全体（同じ間取り）。帯は半数の取引の幅、白丸は件数が少ない年、線が切れた所は件数が足りない年です。' + (loading ? '（四分位を読み込み中）' : failed ? '（四分位を読み込めませんでした）' : '') + '</p>' : '')
        + readoutRent(d.code) + '<p class="minor">家賃は区の値で、この地区・間取りの値ではありません。</p>'
        + '<p class="minor">グラフを押すと、その年に移ります。点線は今の年です。</p>' + (d.pname ? tableHtml(d) : '') + rankingHtml(false) + '</div>';
    }
    box.innerHTML = h;
    const ss = $('selLine');
    if (ss) {
      if (rent) ss.innerHTML = state.selWard ? '選択中: <strong>' + L.esc(wardName(state.selWard)) + '</strong>　' + L.esc(L.cellText('rent', '', L.cellFor('rent', D, D.wardByCode.get(state.selWard), 0, state.yi)).trim()) + '　<a href="#detail">推移のグラフへ</a>' : '区を押すと、家賃の推移が出ます。';
      else ss.innerHTML = d ? '選択中: <strong>' + L.esc(d.label) + '</strong>（' + L.esc(d.ward) + '）　' + L.esc(L.cellText('price', '', L.cellFor('price', D, d, state.pi, state.yi), D.price).trim()) + '　<a href="#detail">推移のグラフへ</a>' : '地区を押すと、推移のグラフと件数が出ます。';
    }
    box.querySelectorAll('.rk').forEach((b) => b.addEventListener('click', () => (b.dataset.key ? focusDistrict(b.dataset.key) : selectWard(b.dataset.ward))));
    const clr = $('clr'); if (clr) clr.addEventListener('click', () => (rent ? selectWard(null) : select(null)));
    const find = $('find');
    if (find) find.addEventListener('change', () => { const dd = D.districts.find((x) => x.label + '（' + x.ward + '）' === find.value); if (dd) focusDistrict(dd.key); });
    for (const id of ['priceChart', 'rentChart']) {
      const el = $(id); if (!el) continue;
      el.addEventListener('click', (e) => {
        const r = el.getBoundingClientRect(), vx = ((e.clientX - r.left) / r.width) * W, n = D.price.years.length;
        setTime(Math.round(((vx - PADL) / (W - PADL - PADR)) * (n - 1)), true);
      });
    }
  }
  /** 順位表・検索から選んだ地区へ地図を寄せる（見えない位置にある地区を選んでも地図で分かるように） */
  function focusDistrict(key) {
    const d = state.data.byKey.get(key); if (!d) return;
    const v = state.view, bb = d.bbox, dx = world(bb.x1, bb.y0).x - world(bb.x0, bb.y0).x, dy = world(0, bb.y0).y - world(0, bb.y1).y;
    const want = Math.log2((Math.min(size().w, size().h) * 0.4) / (256 * Math.max(dx, dy, 1e-6)));
    v.lon = (bb.x0 + bb.x1) / 2; v.lat = (bb.y0 + bb.y1) / 2; v.z = Math.max(v.z, Math.min(14, want));
    select(key); render();
  }

  // ---- 起動 ----
  function showError(msg) { const e = $('loaderr'); e.hidden = false; e.textContent = msg; }
  function fill() {
    $('noticeTop').textContent = L.NOTICE;
    $('attribution').textContent = L.ATTRIBUTION; $('processed').textContent = L.PROCESSED; $('credit').textContent = L.CREDIT;
    $('attributionRent').textContent = L.ATTRIBUTION_RENT; $('creditEstat').textContent = L.CREDIT_ESTAT;
    $('attributionBoundary').textContent = L.ATTRIBUTION_BOUNDARY;
    $('attributionMap').textContent = L.ATTRIBUTION_MAP; $('resp').textContent = L.RESPONSIBILITY;
    $('mapAttr').textContent = '地図: 国土地理院／地区境界: e-Stat 国勢調査 小地域境界（総務省統計局）を加工／値: 不動産情報ライブラリ（国土交通省）・総務省統計局を加工';
  }
  function fillMethod(P, geo) {
    const m = geo.match, f = P.filter;
    $('matchInfo').textContent = 'XIT001 の地区名 ' + m.priceDistricts + '件のうち ' + m.matched + '件（' + (m.rateByName * 100).toFixed(1) + '%）を、国勢調査の小地域（町丁・字等）の町名（「◯丁目」を束ねたもの）と、区コードと名前の一致で突き合わせました（合わなかった ' + m.unmatched + '件。直近5年の取引件数ベースでも ' + (m.rateByTrades * 100).toFixed(1) + '%）。表記の違い（ケ/ヶ、濤/涛、鶯/鴬）と、「神田猿楽町→猿楽町」「神田三崎町→三崎町」の2件は作成者が対応づけました。境界だけがあり取引のない町名 ' + m.boundaryWithoutPrice + '地区は灰色です。名前の一致であり、範囲が完全に同じとは限りません。地区名が空欄の取引 ' + P.withoutDistrictName + '件は地区別の集計に入っていません。';
    $('methodInfo').textContent = '間取りは、取引の「間取り」欄を部屋数の順に ' + P.plans.slice(1).map((p) => p.label + '（' + p.note + '）').join('、') + ' の4つにまとめました（件数がなるべく近くなるよう分けた作成者の区分）。「すべて」は間取りの欄が空・オープンフロア・メゾネットも含みます。時間は年で、各年の値は「その年を末尾とする直近' + f.windowYears + '年（' + P.years[0] + '〜' + P.years.at(-1) + '年）」の取引の中央値です（小さな地区では1年だけでは件数が足りないため。' + P.firstQuarter.replace('Q', '年第') + '四半期〜' + P.lastQuarter.replace('Q', '年第') + '四半期の取引を使用）。件数が' + f.lowN + '件未満は「件数が少ない」（斜線・薄い色・※）、' + f.minN + '件未満は中央値を出さず「データなし」とします。これらの基準は作成者のもので、統計上の根拠となる出典はありません。';
  }
  fill();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ' HTTP ' + r.status); return r.json(); });
  Promise.all([get('data/price-districts.json'), get('data/rent.json'), get('data/districts.json')]).then(([p, r, g]) => {
    const D = L.validate(p, r, g);
    if (!D) throw new Error('データの形式が想定と違います');
    state.data = D; state.loaded = true;
    $('fetchedAt').textContent = p.fetchedAt + '（マンション価格）／' + r.fetchedAt + '（家賃）';
    fillMethod(p, g);
    slider.max = String(p.years.length - 1);
    state.yi = p.years.length - 1;
    const q = new URLSearchParams(location.search); // 試験・共有用（端末内のみ）
    if (q.get('plan') !== null && D.price.plans[Number(q.get('plan'))]) state.pi = Number(q.get('plan'));
    if (q.get('y') && p.years.includes(Number(q.get('y')))) state.yi = p.years.indexOf(Number(q.get('y')));
    slider.value = String(state.yi);
    buildPlanBar(); fit(); setMode(q.get('mode') === 'rent' ? 'rent' : 'price'); buildTicks(); render();
    const sk = q.get('sel'); if (sk && D.byKey.has(sk)) focusDistrict(sk);
    if (q.get('autoplay')) play();
  }).catch((e) => showError('データを読み込めませんでした（' + e.message + '）。ファイルを直接開かず、サーバー経由（http://）で開いてください。'));
  window.__tl = state; // 試験用
})();
