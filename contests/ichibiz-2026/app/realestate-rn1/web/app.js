/* 住む場所の先行き: 画面。ネットワークはGETのみ（国土地理院のタイル・住所検索、同梱データ）。
 * 不動産情報ライブラリのAPIはここからは呼ばない（取得は tools/fetch-reinfolib.mjs で事前に行い、data/ に同梱）。入力は端末内のみ。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const state = { region: Lib.REGIONS[Lib.DEFAULT_REGION], loaded: {}, data: null, view: Object.assign({}, Lib.REGIONS[Lib.DEFAULT_REGION].view), pin: null, facts: null, show: { res: true, city: true, flood: false, sed: false, tsunami: false, surge: false, liq: false }, rimg: {}, pending: null };

  // ---- 地図 ----
  const map = $('map'), tiles = $('tiles'), cv = $('over'), pinEl = $('pin');
  const imgs = new Map();
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
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = v.z + '/' + x + '/' + y;
      want.add(key);
      let im = imgs.get(key);
      if (!im) {
        im = new Image(); im.alt = '';
        im.src = GSI + 'std/' + v.z + '/' + x + '/' + y + '.png';
        imgs.set(key, im); tiles.appendChild(im);
      }
      im.style.left = Math.round(w / 2 + (x - c.x) * 256) + 'px';
      im.style.top = Math.round(h / 2 + (y - c.y) * 256) + 'px';
    }
    for (const [key, im] of imgs) if (!want.has(key)) { im.remove(); imgs.delete(key); }
    drawOverlay(); placePin();
  }
  function tracePolys(g, polys, w, h) {
    // 画面外の多角形は描かない（範囲の外接矩形で判定）
    for (const poly of polys) {
      let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      const ring0 = poly[0];
      const pts = ring0.map((c) => project(c[0], c[1]));
      for (const p of pts) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
      if (maxx < 0 || minx > w || maxy < 0 || miny > h) continue;
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      for (let k = 1; k < poly.length; k++) {
        const q = poly[k].map((c) => project(c[0], c[1]));
        g.moveTo(q[0].x, q[0].y); for (let i = 1; i < q.length; i++) g.lineTo(q[i].x, q[i].y); g.closePath();
      }
    }
  }
  const RCOLOR = { flood: [74, 163, 223], tsunami: [120, 60, 190], surge: [20, 150, 160], liquefaction: [200, 90, 30] };
  function rasterImage(part) {
    const r = state.data && state.data.hazard && state.data.hazard[part];
    if (!r) return null;
    if (state.rimg[part]) return state.rimg[part];
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const g = c.getContext('2d'), id = g.createImageData(r.w, r.h), px = id.data, col = RCOLOR[part];
    for (let i = 0; i < r.w * r.h; i++) {
      if (Lib.cellOn(r, i)) { px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 150; }
    }
    g.putImageData(id, 0, 0);
    return (state.rimg[part] = c);
  }
  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const d = state.data;
    if (d) {
      for (const [k, part] of [['flood', 'flood'], ['tsunami', 'tsunami'], ['surge', 'surge'], ['liq', 'liquefaction']]) {
        if (state.show[k] && d.hazard && d.hazard[part]) {
          const r = d.hazard[part], a = project(r.west, r.north), b = project(r.west + r.w * r.dx, r.north - r.h * r.dy);
          g.imageSmoothingEnabled = false; g.drawImage(rasterImage(part), a.x, a.y, b.x - a.x, b.y - a.y);
        }
      }
      if (state.show.sed && d.hazard && d.hazard.sediment) {
        g.beginPath(); tracePolys(g, d.hazard.sediment, w, h); g.fillStyle = 'rgba(192,113,26,.45)'; g.fill('evenodd');
      }
      if (d.plan) {
        for (const e of d.plan) {
          if (!Lib.regionHas(d.region, e.cityCode)) continue;
          if (e.id === 31 && state.show.res) { g.beginPath(); tracePolys(g, e.polys, w, h); g.fillStyle = 'rgba(47,158,91,.38)'; g.fill('evenodd'); }
          if (e.id === 32 && state.show.city) { g.beginPath(); tracePolys(g, e.polys, w, h); g.strokeStyle = '#2b6fd6'; g.lineWidth = 2; g.stroke(); }
        }
      }
    }
    if (state.pin) {
      const p = project(state.pin.lon, state.pin.lat);
      const mpp = (156543.03392 * Math.cos((state.pin.lat * Math.PI) / 180)) / Math.pow(2, state.view.z);
      g.lineWidth = 2; g.strokeStyle = '#d6336c';
      g.beginPath(); g.arc(p.x, p.y, Lib.POP_RADIUS / mpp, 0, Math.PI * 2); g.stroke();
      g.setLineDash([6, 5]); g.beginPath(); g.arc(p.x, p.y, Lib.WALK_RADIUS / mpp, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
  }
  function placePin() {
    if (!state.pin) { pinEl.hidden = true; return; }
    const p = project(state.pin.lon, state.pin.lat);
    pinEl.hidden = false; pinEl.style.left = p.x + 'px'; pinEl.style.top = p.y + 'px';
  }
  function setZoom(z, anchor) {
    z = Math.max(state.region.zoomMin || 11, Math.min(17, z));
    if (z === state.view.z) return;
    if (anchor) { const a = unproject(anchor.x, anchor.y); state.view.z = z; const b = unproject(anchor.x, anchor.y); state.view.lon += a.lon - b.lon; state.view.lat += a.lat - b.lat; }
    else state.view.z = z;
    render();
  }
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
  // キーボード: 矢印で移動、+/- で拡大縮小、Enter で中心を指定
  map.addEventListener('keydown', (e) => {
    const v = state.view, step = 120;
    const c = Lib.lonLatToWorld(v.lon, v.lat, v.z);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); const n = Lib.worldToLonLat(c.x + mv[0] / 256, c.y + mv[1] / 256, v.z); v.lon = n.lon; v.lat = n.lat; render(); }
    else if (e.key === '+' || e.key === '=') setZoom(v.z + 1);
    else if (e.key === '-') setZoom(v.z - 1);
    else if (e.key === 'Enter') { e.preventDefault(); choose(v.lon, v.lat); }
  });
  window.addEventListener('resize', render);

  // ---- 表示 ----
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function renderSheet() {
    const el = $('sheet');
    if (!state.facts || !state.data) { el.innerHTML = ''; $('printBtn').disabled = true; return; }
    const s = Lib.buildSheet(state.data, state.facts);
    const f = state.facts;
    const where = '指定した位置: 北緯' + f.lat.toFixed(4) + '度 東経' + f.lon.toFixed(4) + '度';
    let body;
    if (s.outOfScope) body = '<p class="oos">' + esc(s.outOfScope) + '</p>';
    else {
      body = '<div class="secs">' + s.sections.map((sec) => '<div class="sec" data-sec="' + sec.id + '"><h4>' + esc(sec.title) + '</h4><ul>' +
        sec.missing.map((m) => '<li class="unf"><span class="tag">' + Lib.UNFETCHED + '</span>' + esc(m) + '</li>').join('') +
        sec.lines.map((l) => '<li><span class="tag' + (l.tag === '注意' ? ' warn-tag' : '') + '">' + esc(l.tag) + '</span>' + esc(l.text) + '</li>').join('') +
        sec.ask.map((a) => '<li class="ask">→ ' + esc(a) + '</li>').join('') + '</ul></div>').join('') + '</div>' +
        '<h5>データにない項目（相談先で確かめる）</h5><ul class="plain">' + s.missing.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>';
    }
    el.innerHTML =
      '<h3>' + esc(s.title) + '</h3>' +
      '<p class="meta">' + esc(where) + '　作成日: ' + new Date().toLocaleDateString('ja-JP') + '　取得データ: ' + esc(state.data.fetchedAt || '—') + ' 取得</p>' + body +
      '<div class="fine"><p>' + esc(Lib.ATTRIBUTION) + '。取得日 ' + esc(state.data.fetchedAt || '—') + '。</p><p>' + esc(Lib.PROCESSED) + '。</p><p>' + esc(Lib.NLNI_SHORT) + '。' + esc(Lib.SCHOOL_FAC_NOTE) + '</p><p>' + esc(Lib.CREDIT) + '。</p><p>' + esc(Lib.RESPONSIBILITY) + '。</p>' +
      '<p>区域は市が公表する図が正。' + esc(Lib.POP_NOTE) + '。</p></div>';
    $('printBtn').disabled = false;
  }
  function renderStatus() {
    const d = state.data;
    $('dataStatus').innerHTML = Object.entries(Lib.apisFor(state.region)).map(([api, a]) => {
      const s = d ? d.status[api] : { state: 'missing', reason: 'データを読み込めませんでした' };
      return '<li><strong>' + esc(api) + '</strong> ' + esc(a.name) + '： ' + (s.state === 'ok' ? '<span class="st-ok">取得済み</span>（' + s.count + (['XKT026', 'XKT028', 'XKT027', 'XKT025'].includes(api) ? 'セル（約18m格子）' : '件') + '・' + esc(s.fetchedAt || '') + '）' : '<span class="st-ng">' + (s.state === 'empty' ? Lib.NODATA : Lib.UNFETCHED) + '</span>（' + esc(s.reason) + '）') + '</li>';
    }).join('');
    $('fetchedAt').textContent = d && d.fetchedAt ? d.fetchedAt : '—';
  }
  function statusText(f) {
    if (!f.inBBox) return 'この地点は同梱データの範囲（' + state.region.name + '周辺）の外です。';
    return '位置を指定しました。下の先行きシートを確認してください。';
  }
  function choose(lon, lat) {
    if (!state.data) { state.pending = { lon, lat }; $('status').textContent = 'データを読み込み中です（回線が遅いと十数秒かかります）。読み込みが終わると、指した位置で自動的にシートを出します。'; return; }
    state.pin = { lon, lat };
    state.facts = Lib.collect(state.data, lon, lat);
    $('status').textContent = statusText(state.facts);
    render(); renderSheet();
    $('sheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    App.last = state.facts;
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
      $('status').textContent = '「' + j[0].properties.title + '」付近に移動しました。土地の位置を地図でクリックしてください（地図にフォーカスして Enter でも、中心を指せます）。';
    } catch (err) { $('status').textContent = '検索に失敗しました。地図を直接クリックしてください。'; }
  });
  // 例の場所のボタンは、選んだ地域のものを作る
  function renderExamples() {
    const box = $('exButtons'); box.innerHTML = '';
    for (const e of state.region.examples) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'secondary ex'; b.textContent = e.label; b.dataset.lon = e.lon; b.dataset.lat = e.lat;
      b.addEventListener('click', () => { state.view = { lon: e.lon, lat: e.lat, z: 15 }; choose(e.lon, e.lat); });
      box.appendChild(b);
    }
    $('q').placeholder = '例: ' + state.region.search;
  }
  const toggles = { tgResidential: 'res', tgCity: 'city', tgFlood: 'flood', tgSediment: 'sed', tgTsunami: 'tsunami', tgSurge: 'surge', tgLiq: 'liq' };
  for (const [id, k] of Object.entries(toggles)) $(id).onchange = (e) => { state.show[k] = e.target.checked; drawOverlay(); };
  $('printBtn').onclick = () => window.print();

  // ---- 起動・地域の切り替え ----
  // 選んだ地域のデータ（data/<地域>/）だけを読み込む。読み込んだ地域はメモリに残し、切り替えを速くする
  async function load(region) {
    const base = 'data/' + region.dir + '/';
    const get = async (name) => { const r = await fetch(base + name); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
    let manifest;
    try { manifest = await get('manifest.json'); } catch (e) { manifest = { layers: {} }; }
    const files = {};
    const key = { 'plan.json': 'plan', 'population.json': 'population', 'districts.json': 'districts', 'facilities.json': 'facilities', 'hazards.json': 'hazards', 'zoning.json': 'zoning' };
    await Promise.all(Object.entries(key).map(async ([file, k]) => {
      const needed = Object.values(manifest.layers || {}).some((l) => l.file === file && l.status === 'ok');
      if (!needed) return;
      try { files[k] = await get(file); } catch (e) {
        for (const l of Object.values(manifest.layers)) if (l.file === file && l.status === 'ok') { l.status = 'failed'; l.reason = 'データファイル（' + file + '）を読み込めませんでした'; }
      }
    }));
    return Lib.assemble(manifest, files, region);
  }
  function runPending() { if (state.pending && state.data) { const p = state.pending; state.pending = null; choose(p.lon, p.lat); } }
  const App = window.App = { state, choose, render, last: null, ready: false, setRegion: null };
  function footerTexts() {
    const r = state.region;
    $('attribution').textContent = Lib.ATTRIBUTION; $('processed').textContent = Lib.processedFor(r); $('nlni').textContent = Lib.NLNI_SOURCE; $('orignote').textContent = Lib.ORIG_NOTES; $('credit').textContent = Lib.CREDIT; $('resp').textContent = Lib.RESPONSIBILITY; $('popnote').textContent = Lib.POP_NOTE;
    const link = $('regionLink');
    if (r.id === 'tokushima') link.innerHTML = '徳島市の立地適正化計画の公表ページ: <a href="' + Lib.PLAN_PAGE + '" rel="noopener">徳島市</a>。';
    else link.textContent = r.name + 'の区域は、各区（市）の公表ページで確かめてください。';
    $('regionNote').textContent = Lib.regionNote(r);
    const hasPlan = !!(state.data && state.data.plan);
    $('lbRes').hidden = $('lbCity').hidden = !hasPlan;
  }
  async function setRegion(id) {
    const region = Lib.REGIONS[id];
    if (!region) return;
    state.region = region; state.data = null; state.pin = null; state.facts = null; state.pending = null; state.rimg = {};
    state.view = Object.assign({}, region.view); App.ready = false; App.last = null;
    document.querySelectorAll('input[name=region]').forEach((r) => { r.checked = r.value === id; });
    renderExamples(); renderSheet(); footerTexts(); render();
    $('status').textContent = region.name + 'のデータを読み込み中です（回線が遅いと十数秒かかります）。読み込みが終わるまで、指した位置は覚えておき、終わると自動でシートを出します。';
    let data = state.loaded[id];
    try { if (!data) data = state.loaded[id] = await load(region); } catch (e) { data = null; }
    if (state.region !== region) return; // 読み込み中に別の地域が選ばれた
    state.data = data; App.ready = true;
    $('status').textContent = data ? '地図で場所を指すか、例の場所を選ぶと、ここに状況が出ます。' : 'データを読み込めませんでした。';
    renderStatus(); footerTexts(); runPending(); render();
  }
  App.setRegion = setRegion;
  document.querySelectorAll('input[name=region]').forEach((r) => r.addEventListener('change', (e) => { if (e.target.checked) setRegion(e.target.value); }));
  setRegion(Lib.DEFAULT_REGION);
})();
