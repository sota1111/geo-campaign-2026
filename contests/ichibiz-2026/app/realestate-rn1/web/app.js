/* 住む場所の先行き: 画面。ネットワークはGETのみ（国土地理院のタイル・住所検索、同梱データ）。
 * 不動産情報ライブラリのAPIはここからは呼ばない（取得は tools/fetch-reinfolib.mjs で事前に行い、data/ に同梱）。入力は端末内のみ。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const state = { region: Lib.REGIONS[Lib.DEFAULT_REGION], loaded: {}, data: null, view: Object.assign({}, Lib.REGIONS[Lib.DEFAULT_REGION].view), pin: null, facts: null, show: { res: true, city: true, flood: false, sed: false, tsunami: false, surge: false, liq: false }, rimg: {}, pending: null,
    life: { layers: {}, status: {}, stations: [] }, lifeShow: {}, places: Life.empty(), pick: null, popup: null };
  for (const l of Life.LAYERS) state.lifeShow[l.id] = l.on;
  try { state.places = Life.sanitize(JSON.parse(localStorage.getItem(Life.KEY))); } catch (e) { /* 保存できない環境でも動く */ }
  function savePlaces() { try { localStorage.setItem(Life.KEY, JSON.stringify(state.places)); } catch (e) { /* 保存できなくても続ける */ } }

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
    drawOverlay(); placePin(); placeMarks();
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
  const RCOLOR = { flood: [74, 163, 223], tsunami: [120, 60, 190], surge: [20, 150, 160], liquefaction: [235, 195, 0] };
  // 液状化は「しやすい」側の区分1〜3だけ塗る（しにくい・評価対象外は塗らない）。区分が小さいほど濃い。
  const LIQ_ALPHA = { 1: 215, 2: 170, 3: 120 };
  let sedPattern = null;
  function sedFill(g) {
    // 土砂災害警戒区域は斜線の模様（色だけに頼らない。液状化・洪水と見分ける）
    if (!sedPattern) {
      const t = document.createElement('canvas'); t.width = t.height = 10;
      const q = t.getContext('2d'); q.fillStyle = 'rgba(192,113,26,.28)'; q.fillRect(0, 0, 10, 10);
      q.strokeStyle = 'rgba(120,60,0,.9)'; q.lineWidth = 2; q.beginPath(); q.moveTo(-2, 12); q.lineTo(12, -2); q.moveTo(-2, 2); q.lineTo(2, -2); q.moveTo(8, 12); q.lineTo(12, 8); q.stroke();
      sedPattern = g.createPattern(t, 'repeat');
    }
    return sedPattern;
  }
  function rasterImage(part) {
    const r = state.data && state.data.hazard && state.data.hazard[part];
    if (!r) return null;
    if (state.rimg[part]) return state.rimg[part];
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    const g = c.getContext('2d'), id = g.createImageData(r.w, r.h), px = id.data, col = RCOLOR[part];
    for (let i = 0; i < r.w * r.h; i++) {
      if (part === 'liquefaction') {
        const a = r.levels ? LIQ_ALPHA[r.levels[i]] : 0;
        if (a) { px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = a; }
      } else if (Lib.cellOn(r, i)) { px[i * 4] = col[0]; px[i * 4 + 1] = col[1]; px[i * 4 + 2] = col[2]; px[i * 4 + 3] = 150; }
    }
    g.putImageData(id, 0, 0);
    return (state.rimg[part] = c);
  }
  // 対象外（東京23区・大阪市の外側）を灰色で覆う。対象は都市計画区域（XKT001）の多角形。覆いから多角形を切り抜く
  let shade = null;
  function drawOutside(g, w, h, dpr) {
    const d = state.data;
    const areas = d && state.region.clip && d.zoning && d.zoning.areas;
    if (!areas || w <= 0 || h <= 0) return;
    if (!shade) shade = document.createElement('canvas');
    shade.width = w * dpr; shade.height = h * dpr;
    const q = shade.getContext('2d');
    q.setTransform(dpr, 0, 0, dpr, 0, 0);
    q.fillStyle = 'rgba(70,78,88,.42)'; q.fillRect(0, 0, w, h);
    q.globalCompositeOperation = 'destination-out'; q.fillStyle = '#000';
    for (const e of areas) { if (!Lib.regionHas(d.region, e.cityCode)) continue; q.beginPath(); tracePolys(q, e.polys, w, h); q.fill('evenodd'); }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(shade, 0, 0); g.restore();
  }
  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const d = state.data;
    drawOutside(g, w, h, dpr);
    if (d) {
      for (const [k, part] of [['flood', 'flood'], ['tsunami', 'tsunami'], ['surge', 'surge'], ['liq', 'liquefaction']]) {
        if (state.show[k] && d.hazard && d.hazard[part]) {
          const r = d.hazard[part], a = project(r.west, r.north), b = project(r.west + r.w * r.dx, r.north - r.h * r.dy);
          g.imageSmoothingEnabled = false; g.drawImage(rasterImage(part), a.x, a.y, b.x - a.x, b.y - a.y);
        }
      }
      if (state.show.sed && d.hazard && d.hazard.sediment) {
        g.beginPath(); tracePolys(g, d.hazard.sediment, w, h); g.fillStyle = sedFill(g); g.fill('evenodd');
      }
      if (d.plan) {
        for (const e of d.plan) {
          if (!Lib.regionHas(d.region, e.cityCode)) continue;
          if (e.id === 31 && state.show.res) { g.beginPath(); tracePolys(g, e.polys, w, h); g.fillStyle = 'rgba(47,158,91,.38)'; g.fill('evenodd'); }
          if (e.id === 32 && state.show.city) { g.beginPath(); tracePolys(g, e.polys, w, h); g.strokeStyle = '#2b6fd6'; g.lineWidth = 2; g.stroke(); }
        }
      }
    }
    drawLife(g, w, h);
    if (state.pin) {
      const p = project(state.pin.lon, state.pin.lat);
      const mpp = (156543.03392 * Math.cos((state.pin.lat * Math.PI) / 180)) / Math.pow(2, state.view.z);
      g.lineWidth = 2; g.strokeStyle = '#d6336c';
      g.beginPath(); g.arc(p.x, p.y, Lib.POP_RADIUS / mpp, 0, Math.PI * 2); g.stroke();
      g.setLineDash([6, 5]); g.beginPath(); g.arc(p.x, p.y, Lib.WALK_RADIUS / mpp, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    }
  }
  // 生活に必要な場所: 種類ごとの色の丸（拡大すると1文字の記号つき。色だけに頼らない）
  function drawLife(g, w, h) {
    const z = state.view.z, r = z >= 16 ? 9 : z >= 14 ? 6.5 : 3.5;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold ' + Math.round(r * 1.1) + 'px sans-serif';
    for (const l of Life.LAYERS) {
      if (!state.lifeShow[l.id]) continue;
      const pts = state.life.layers[l.id] || [];
      for (const p of pts) {
        const q = project(p.lon, p.lat);
        if (q.x < -12 || q.x > w + 12 || q.y < -12 || q.y > h + 12) continue;
        g.beginPath(); g.arc(q.x, q.y, r, 0, Math.PI * 2); g.fillStyle = l.color; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
        if (z >= 15) { g.fillStyle = '#fff'; g.fillText(l.glyph, q.x, q.y + 0.5); }
      }
    }
  }
  // 物件（番号つきの丸）・勤務先（A/Bの四角）の印。押すと情報。キーボードでも選べる
  function placeMarks() {
    const box = $('marks'); box.innerHTML = '';
    const mk = (kind, i, p, text, label) => {
      const q = project(p.lon, p.lat);
      if (q.x < -20 || q.x > size().w + 20 || q.y < -20 || q.y > size().h + 20) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mk ' + kind; b.textContent = text; b.setAttribute('aria-label', label);
      b.style.left = q.x + 'px'; b.style.top = q.y + 'px'; b.dataset.kind = kind; b.dataset.i = i;
      b.addEventListener('click', (e) => { e.stopPropagation(); showPopup(kind, i); });
      box.appendChild(b);
    };
    state.places.props.forEach((p, i) => mk('prop', i, p, String(i + 1), '物件' + (i + 1) + '：' + (p.label || '位置指定') + '。押すと情報'));
    state.places.works.forEach((p, i) => p && mk('work', i, p, 'ＡＢ'[i], '勤務先' + 'AB'[i] + '：' + (p.label || '位置指定') + '。押すと情報'));
    if (state.popup) positionPopup();
  }
  function placePin() {
    const at = state.pin || state.pending; // 読み込み中は、押した位置に仮のピンを出す
    if (!at) { pinEl.hidden = true; return; }
    const p = project(at.lon, at.lat);
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
    if (e.target.closest('.zoombtns') || e.target.closest('.mk') || e.target.closest('.popup')) return;
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
    hidePopup();
    if (state.pick) { applyPick(ll.lon, ll.lat); return; }
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
    if (e.target !== map) return; // 印のボタンなどのキー操作は、地図の操作にしない
    const v = state.view, step = 120;
    const c = Lib.lonLatToWorld(v.lon, v.lat, v.z);
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); const n = Lib.worldToLonLat(c.x + mv[0] / 256, c.y + mv[1] / 256, v.z); v.lon = n.lon; v.lat = n.lat; render(); }
    else if (e.key === '+' || e.key === '=') setZoom(v.z + 1);
    else if (e.key === '-') setZoom(v.z - 1);
    else if (e.key === 'Escape') { hidePopup(); cancelPick(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (state.pick) applyPick(v.lon, v.lat); else choose(v.lon, v.lat); }
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
        sec.missing.map((m) => (m.includes('は' + Lib.NODATA + '（') ? '<li class="nod"><span class="tag nod-tag">' + Lib.NODATA + '</span>' : '<li class="unf"><span class="tag">' + Lib.UNFETCHED + '</span>') + esc(m) + '</li>').join('') +
        sec.lines.map((l) => '<li><span class="tag' + (l.tag === '注意' ? ' warn-tag' : '') + '">' + esc(l.tag) + '</span>' + esc(l.text) + '</li>').join('') +
        sec.ask.map((a) => '<li class="ask">→ ' + esc(a) + '</li>').join('') + '</ul></div>').join('') + '</div>' +
        '<h5>データにない項目（相談先で確かめる）</h5><ul class="plain">' + s.missing.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul>';
    }
    el.innerHTML =
      '<h3>' + esc(s.title) + '</h3>' +
      '<p class="meta">' + esc(where) + '　作成日: ' + new Date().toLocaleDateString('ja-JP') + '　取得データ: ' + esc(state.data.fetchedAt || '—') + ' 取得</p>' +
      // シートは縦に長い。項目への目次を先頭に置く（区域・人口・学校区・災害を探してスクロールで行き来していた）。印刷には出さない
      (s.outOfScope ? '' : '<nav class="sec-toc" aria-label="シートの項目へ移動">項目へ移動: ' + s.sections.map((sec) => '<button type="button" data-jump="' + esc(sec.id) + '">' + esc(sec.title) + '</button>').join('') + '</nav>') + body +
      '<div class="fine"><p>' + esc(Lib.ATTRIBUTION) + '。取得日 ' + esc(state.data.fetchedAt || '—') + '。</p><p>' + esc(Lib.processedFor(state.region)) + '。</p><p>' + esc(Lib.NLNI_SHORT) + '。' + esc(Lib.SCHOOL_FAC_NOTE) + '</p><p>' + esc(Lib.CREDIT) + '。</p><p>' + esc(Lib.RESPONSIBILITY) + '。</p>' +
      '<p>区域は' + (state.region.unit === '区' ? '区' : '市') + 'が公表する図が正。' + esc(Lib.POP_NOTE) + '。</p></div>';
    $('printBtn').disabled = !!s.outOfScope; // 対象外の地点は印刷できない
    el.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
      const t = el.querySelector('[data-sec="' + b.dataset.jump + '"]');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
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
    if (!f.inRegion) { const nm = f.neighbor && !Lib.regionHas(state.region, f.neighbor) ? Lib.cityName(f.neighbor) : null; return (nm ? '「' + nm + '」は' : 'この地点は') + state.region.name + 'の対象外です。シートは出せず、印刷もできません。'; }
    return '位置を指定しました。下の先行きシートを確認してください。';
  }
  function choose(lon, lat) {
    if (!state.data) { state.pending = { lon, lat }; placePin(); $('status').textContent = state.region.name + 'のデータを読み込み中です。押した位置（地図の赤いピン）は覚えてあり、読み込みが終わると自動でシートを出します。'; return; }
    state.pin = { lon, lat };
    state.facts = Lib.collect(state.data, lon, lat);
    $('status').textContent = statusText(state.facts);
    render(); renderSheet();
    // 結果は地図の下にある。シートの先頭（見出しと目次）が見える位置まで動かす
    selectTab('sheet');
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

  // ---- タブ ----
  const TABS = ['place', 'props', 'sheet', 'info'];
  function selectTab(name) {
    for (const t of TABS) {
      const on = t === name;
      $('t-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + t).hidden = !on;
    }
    const pn = $('tab-' + name); if (pn) pn.scrollTop = 0;
  }
  for (const t of TABS) $('t-' + t).addEventListener('click', () => selectTab(t));
  $('aboutLink').addEventListener('click', (e) => { e.preventDefault(); selectTab('info'); });

  // ---- 生活に必要な場所（凡例のチェック） ----
  function buildLifeToggles() {
    const box = $('lifeToggles'); box.innerHTML = '';
    for (const l of Life.LAYERS) {
      const lb = document.createElement('label');
      const st = state.life.status[l.id], n = (state.life.layers[l.id] || []).length;
      lb.innerHTML = '<input type="checkbox" data-life="' + l.id + '"> <span class="gl" style="background:' + l.color + '" aria-hidden="true">' + esc(l.glyph) + '</span><span>' + esc(l.label) + '<span class="nd"></span></span>';
      const cb = lb.querySelector('input');
      cb.checked = !!state.lifeShow[l.id];
      if (st !== 'ok') { cb.disabled = true; cb.checked = false; state.lifeShow[l.id] = false; lb.classList.add('nodata'); lb.querySelector('.nd').textContent = l.id === 'gakudo' ? '（位置データが見つかりません）' : '（データなし）'; }
      else lb.querySelector('.nd').textContent = '（' + n.toLocaleString('ja-JP') + '）';
      cb.addEventListener('change', () => { state.lifeShow[l.id] = cb.checked; drawOverlay(); });
      box.appendChild(lb);
    }
    $('lifeNote').textContent = Life.OSM_NOTE + ' ' + Life.SCHOOL_NOTE + ' ' + Life.GAKUDO_NOTE + '地図を拡大（15以上）すると、丸の中に種類の記号（ス・コ・駅 など）が出ます。';
    const items = [];
    for (const l of Life.LAYERS) {
      const st = state.life.status[l.id], n = (state.life.layers[l.id] || []).length;
      items.push('<li><strong>' + esc(l.label) + '</strong>： ' + (st === 'ok' ? n.toLocaleString('ja-JP') + '件' : '<span class="st-ng">' + (l.id === 'gakudo' ? '位置データが見つかりません' : 'データなし') + '</span>') + '（' + (l.src === 'osm' ? 'OpenStreetMap・ODbL' : '国土数値情報（不動産情報ライブラリ経由）') + '）</li>');
    }
    const am = state.amenities;
    $('lifeStatus').innerHTML = items.join('') + '<li>OpenStreetMap の取得日: ' + esc((am && am.fetchedAt) || '—') + '。' + esc(Life.OSM_NOTE) + '</li><li>' + esc(Life.MLIT_NOTE) + '</li>';
  }
  function setLife(amenities, data) {
    state.amenities = amenities || null;
    const b = Life.buildLayers(amenities, data && data.fac);
    state.life = { layers: b.layers, status: b.status, stations: b.layers.station || [] };
    buildLifeToggles(); renderPlaces(); drawOverlay();
  }
  function setLifeEmpty() { state.life = { layers: {}, status: {}, stations: [] }; buildLifeToggles(); renderPlaces(); }

  // ---- 物件（最大10件）・勤務先（2か所）----
  async function gsiSearch(q) {
    const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return Life.parseGsi(await r.json());
  }
  // 地域内の候補を先に並べる（対象地域の外の同名の住所を先頭にしない）
  function rankCands(list) {
    const bb = state.region.bbox, inb = (c) => c.lon >= bb[0] && c.lon <= bb[2] && c.lat >= bb[1] && c.lat <= bb[3];
    return list.filter(inb).concat(list.filter((c) => !inb(c)));
  }
  function showCands(host, list, onPick) {
    const old = host.querySelector('.cands'); if (old) old.remove();
    const d = document.createElement('div'); d.className = 'cands'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', '住所の候補');
    d.innerHTML = '<p>候補が複数あります。どれか選んでください（選ばないと追加されません）。</p>';
    for (const c of list.slice(0, 8)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary'; b.textContent = c.title;
      b.addEventListener('click', () => { d.remove(); onPick(c); }); d.appendChild(b);
    }
    host.appendChild(d);
  }
  function msg(el, text, err) { el.textContent = text; el.classList.toggle('err', !!err); }
  async function resolveAddress(q, msgEl, host, done) {
    msg(msgEl, '住所を探しています…');
    const old = host.querySelector('.cands'); if (old) old.remove();
    let list;
    try { list = rankCands(await gsiSearch(q)); } catch (e) { msg(msgEl, '住所検索に失敗しました（ネットワーク）。「地図で指定」で位置を指してください。', true); return; }
    if (!list.length) { msg(msgEl, '「' + q + '」は見つかりませんでした。書き方を変えるか、「地図で指定」で位置を指してください。', true); return; }
    const exact = list.filter((c) => c.title === q);
    if (list.length === 1 || exact.length === 1) { msg(msgEl, ''); done(exact[0] || list[0]); return; }
    msg(msgEl, '「' + q + '」の候補が' + list.length + '件あります。', true);
    showCands(host, list, (c) => { msg(msgEl, ''); done(c); });
  }
  function afterPlaceChange(focus) {
    savePlaces(); renderPlaces(); placeMarks(); hidePopup();
    if (focus) { state.view = { lon: focus.lon, lat: focus.lat, z: Math.max(state.view.z, 15) }; render(); }
  }
  $('propForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('propQ').value.trim(); if (!q) return;
    if (state.places.props.length >= Life.MAX_PROPS) { msg($('propMsg'), '物件は最大' + Life.MAX_PROPS + '件までです。不要な物件を消してください。', true); return; }
    resolveAddress(q, $('propMsg'), $('propMsg').parentNode, (c) => {
      const r = Life.addProp(state.places, { label: q, lon: c.lon, lat: c.lat, resolved: c.title });
      if (!r.ok) { msg($('propMsg'), r.reason, true); return; }
      $('propQ').value = ''; msg($('propMsg'), state.places.props.length + '件目を追加しました（' + c.title + '）。住所の代表点で、建物の位置とは限りません。');
      afterPlaceChange(c);
    });
  });
  $('propPick').addEventListener('click', () => startPick({ kind: 'prop' }));
  function startPick(p) {
    if (p.kind === 'prop' && state.places.props.length >= Life.MAX_PROPS) { msg($('propMsg'), '物件は最大' + Life.MAX_PROPS + '件までです。', true); return; }
    state.pick = p; map.classList.add('picking');
    $('pickbar').hidden = false;
    $('picktext').textContent = (p.kind === 'prop' ? '物件' + (state.places.props.length + 1) : '勤務先' + 'AB'[p.idx]) + 'の位置を、地図をクリック（キーボードは地図で Enter）して指定してください。';
    map.focus();
  }
  function cancelPick() { state.pick = null; map.classList.remove('picking'); $('pickbar').hidden = true; }
  $('pickCancel').addEventListener('click', cancelPick);
  function applyPick(lon, lat) {
    const p = state.pick; cancelPick();
    if (p.kind === 'prop') {
      const r = Life.addProp(state.places, { label: '地図で指定', lon, lat, resolved: '' });
      if (!r.ok) { msg($('propMsg'), r.reason, true); return; }
      msg($('propMsg'), state.places.props.length + '件目を地図の位置で追加しました。');
    } else {
      state.places.works[p.idx] = { label: '地図で指定', lon, lat, resolved: '' };
      msg($('workMsg'), '勤務先' + 'AB'[p.idx] + 'を地図の位置で設定しました。');
    }
    afterPlaceChange(null); selectTab('props');
  }
  function renderWorkForms() {
    const box = $('workForms'); box.innerHTML = '';
    for (let i = 0; i < Life.MAX_WORKS; i++) {
      const w = state.places.works[i], L = 'AB'[i];
      const row = document.createElement('div'); row.className = 'workrow';
      row.innerHTML = '<form class="wrow"><span class="num w" aria-hidden="true">' + L + '</span><label class="sr" for="wq' + i + '">勤務先' + L + 'の住所</label><input id="wq' + i + '" type="search" placeholder="勤務先' + L + 'の住所" autocomplete="off" value="' + esc(w && w.label !== '地図で指定' ? w.label : '') + '"><button type="submit">設定</button><button type="button" class="secondary wpick">地図で指定</button>' + (w ? '<button type="button" class="secondary wdel">消す</button>' : '') + '</form>' +
        '<p class="hint">' + (w ? '設定済み: ' + esc(w.resolved || w.label) + '（北緯' + w.lat.toFixed(4) + ' 東経' + w.lon.toFixed(4) + '）' : '未設定') + '</p>';
      row.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const q = row.querySelector('input').value.trim(); if (!q) return;
        resolveAddress(q, $('workMsg'), row, (c) => { state.places.works[i] = { label: q, lon: c.lon, lat: c.lat, resolved: c.title }; msg($('workMsg'), '勤務先' + L + 'を設定しました（' + c.title + '）。'); afterPlaceChange(c); });
      });
      row.querySelector('.wpick').addEventListener('click', () => startPick({ kind: 'work', idx: i }));
      const del = row.querySelector('.wdel'); if (del) del.addEventListener('click', () => { state.places.works[i] = null; msg($('workMsg'), ''); afterPlaceChange(null); });
      box.appendChild(row);
    }
  }
  function nearestHTML(i) {
    const p = state.places.props[i];
    const nr = Life.nearest(state.life.layers, p.lon, p.lat);
    const bb = state.region.bbox, inReg = p.lon >= bb[0] && p.lon <= bb[2] && p.lat >= bb[1] && p.lat <= bb[3];
    let h = '<table class="near"><thead><tr><th>種類</th><th>最寄りの施設</th><th>直線距離</th><th>徒歩の目安</th></tr></thead><tbody>';
    for (const id of Life.NEAREST_IDS) {
      const l = Life.LAYERS.find((x) => x.id === id), n = nr[id], st = state.life.status[id];
      let c;
      if (st !== 'ok') c = '<td colspan="3">' + (id === 'gakudo' ? '位置データが見つかりません' : 'データなし') + '</td>';
      else if (!n) c = '<td colspan="3">見つかりません（登録漏れの可能性）</td>';
      else c = '<td>' + esc(n.name) + '</td><td>' + Life.fmtM(n.m) + '</td><td>約' + Life.walkMin(n.m) + '分</td>';
      h += '<tr><th scope="row">' + esc(l.label) + '</th>' + c + '</tr>';
    }
    h += '</tbody></table>';
    return h + '<p class="hint">' + esc(Life.DISTANCE_NOTE) + esc(Life.SCHOOL_NOTE) + esc(Life.OSM_NOTE) + (inReg ? '' : '（この物件は選択中の地域の外です。距離は選択中の地域のデータだけで測っています）') + '</p>';
  }
  function commuteCell(c) {
    let h = '徒歩 ' + c.walk + '分';
    if (c.rail) h += '<br>鉄道＋徒歩 ' + c.rail.total + '分' + (c.rail.same ? '（同じ駅）' : '');
    else h += '<br>鉄道 —（最寄駅が' + Life.MAX_STATION_M + 'm超、またはデータなし）';
    return h;
  }
  function commuteDetail(c) {
    let t = '直線' + Life.fmtM(c.straightM) + '。';
    if (c.rail) t += '鉄道＋徒歩＝家から' + esc(c.rail.from || '駅') + 'まで徒歩' + c.rail.walkFrom + '分＋' + (c.rail.same ? '乗車なし' : '乗車の目安' + c.rail.ride + '分') + '＋' + esc(c.rail.to || '駅') + 'から勤務先まで徒歩' + c.rail.walkTo + '分。';
    return t;
  }
  function commuteOf(p, w) { return Life.commute(p, w, state.life.stations, { speedKmh: state.places.speedKmh }); }
  function popupHTML(kind, i) {
    if (kind === 'work') {
      const w = state.places.works[i];
      return '<h3>勤務先' + 'AB'[i] + '</h3><p>' + esc(w.resolved || w.label) + '</p><p class="hint">各物件への通勤時間は、物件の印と「物件・勤務先」タブの表に出ます。</p>';
    }
    const p = state.places.props[i];
    let h = '<h3>物件' + (i + 1) + '：' + esc(p.resolved || p.label) + '</h3>';
    const ws = state.places.works.map((w, j) => (w ? { w, j } : null)).filter(Boolean);
    if (ws.length) {
      h += '<table><thead><tr><th>勤務先</th><th>通勤時間の目安（名称・時間）</th></tr></thead><tbody>' + ws.map(({ w, j }) => {
        const c = commuteOf(p, w);
        return '<tr><th scope="row">勤務先' + 'AB'[j] + '</th><td>' + esc(w.resolved || w.label) + '<br>' + commuteCell(c) + '<br><span class="hint">' + commuteDetail(c) + '</span></td></tr>';
      }).join('') + '</tbody></table><p class="hint">目安です。前提は「物件・勤務先」タブに表示しています。</p>';
    } else h += '<p class="hint">勤務先を入れると、ここに通勤時間の目安が出ます。</p>';
    h += nearestHTML(i);
    h += '<p><button type="button" id="popSheet">この物件の先行きシートを見る</button></p>';
    return h;
  }
  function showPopup(kind, i) {
    state.popup = { kind, i };
    const el = $('popup');
    el.innerHTML = '<button type="button" class="x secondary" aria-label="閉じる">×</button>' + popupHTML(kind, i);
    el.hidden = false; positionPopup();
    el.querySelector('.x').addEventListener('click', hidePopup);
    const sb = el.querySelector('#popSheet');
    if (sb) sb.addEventListener('click', () => { const p = state.places.props[i]; hidePopup(); state.view = { lon: p.lon, lat: p.lat, z: Math.max(state.view.z, 15) }; choose(p.lon, p.lat); });
    el.querySelector('.x').focus();
  }
  function hidePopup() { state.popup = null; $('popup').hidden = true; }
  function positionPopup() {
    const el = $('popup'), pp = state.popup; if (!pp) return;
    const p = (pp.kind === 'prop' ? state.places.props : state.places.works)[pp.i]; if (!p) { hidePopup(); return; }
    const q = project(p.lon, p.lat), { w, h } = size();
    let x = q.x + 18, y = q.y - 20;
    if (x + el.offsetWidth > w - 8) x = Math.max(8, q.x - 18 - el.offsetWidth);
    y = Math.max(8, Math.min(y, h - el.offsetHeight - 8));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }
  function renderAssump() {
    $('assump').innerHTML = [
      '<strong>徒歩</strong>: 直線距離×' + Life.DETOUR + '（道路距離の見積り。出典のある統計ではなく、本リポジトリの公共交通診断（odpt-2026）と同じ仮定）÷分速' + Life.WALK_M_PER_MIN + 'm（「不動産の表示に関する公正競争規約施行規則」が徒歩の所要時間の表示に使う、道路距離80mにつき1分）。坂・信号・横断・屋内は含みません。',
      '<strong>鉄道＋徒歩</strong>: 家から最寄駅まで徒歩（上の式）＋乗車＋勤務先の最寄駅から徒歩。乗車＝駅間の直線距離×' + Life.RAIL_DETOUR + '÷表定速度＋待ち' + Life.RAIL_WAIT_MIN + '分。表定速度<input id="railSpeed" type="number" min="10" max="120" step="1" value="' + state.places.speedKmh + '" aria-label="鉄道の表定速度（km/h）">km/h は出典のない仮定（初期値' + Life.RAIL_SPEED_KMH + '）で、変えられます。<strong>路線のつながり・乗換・運行本数・時刻は見ていません</strong>（その2駅が直通・乗換で行けるとは限りません）。駅は OpenStreetMap の登録（漏れあり）。最寄駅まで直線' + Life.MAX_STATION_M + 'mを超えるときは出しません。',
      '時刻表（GTFS）による経路探索・自転車・車は、この版では計算していません。いずれの数値も、実際の所要時間の保証ではなく、物件どうしを比べるための目安です。',
    ].map((x) => '<li>' + x + '</li>').join('');
    const sp = $('railSpeed');
    if (sp) sp.addEventListener('change', () => { const v = Number(sp.value); if (v >= 10 && v <= 120) { state.places.speedKmh = v; savePlaces(); renderPlaces(); } else sp.value = state.places.speedKmh; });
  }
  function renderPlaces() {
    const P = state.places;
    const ol = $('propList'); ol.innerHTML = '';
    const ws = P.works.map((w, j) => (w ? { w, j } : null)).filter(Boolean);
    P.props.forEach((p, i) => {
      const li = document.createElement('li');
      const comm = ws.length ? '<p class="hint">' + ws.map(({ w, j }) => '勤務先' + 'AB'[j] + '： ' + commuteCell(commuteOf(p, w)).replace(/<br>/g, ' ／ ')).join('<br>') + '</p>' : '';
      li.innerHTML = '<div class="head"><span class="num" aria-hidden="true">' + (i + 1) + '</span><span class="t">物件' + (i + 1) + '：' + esc(p.resolved || p.label) + '</span><button type="button" class="secondary pmap">地図で見る</button><button type="button" class="secondary psheet">シート</button><button type="button" class="secondary pdel" aria-label="物件' + (i + 1) + 'を消す">消す</button></div>' + comm +
        '<details><summary>最寄りの生活施設までの距離</summary>' + nearestHTML(i) + '</details>';
      li.querySelector('.pmap').addEventListener('click', () => { state.view = { lon: p.lon, lat: p.lat, z: Math.max(state.view.z, 15) }; render(); showPopup('prop', i); });
      li.querySelector('.psheet').addEventListener('click', () => { state.view = { lon: p.lon, lat: p.lat, z: Math.max(state.view.z, 15) }; choose(p.lon, p.lat); });
      li.querySelector('.pdel').addEventListener('click', () => { P.props.splice(i, 1); msg($('propMsg'), ''); afterPlaceChange(null); });
      ol.appendChild(li);
    });
    if (!P.props.length) ol.innerHTML = '<li class="hint">まだ物件がありません（' + Life.MAX_PROPS + '件まで）。</li>';
    $('propAdd').disabled = $('propQ').disabled = $('propPick').disabled = P.props.length >= Life.MAX_PROPS;
    renderWorkForms();
    const box = $('commuteBox');
    if (!P.props.length || !ws.length) box.innerHTML = '<p class="hint">物件と勤務先を入れると、物件×勤務先の表が出ます。</p>';
    else {
      box.innerHTML = '<table class="ct"><caption class="sr">物件と勤務先ごとの通勤時間の目安</caption><thead><tr><th>物件</th>' + ws.map(({ w, j }) => '<th>勤務先' + 'AB'[j] + '<br><span class="hint">' + esc(w.resolved || w.label) + '</span></th>').join('') + '</tr></thead><tbody>' +
        P.props.map((p, i) => '<tr><th scope="row">' + (i + 1) + ' ' + esc(p.resolved || p.label) + '</th>' + ws.map(({ w }) => '<td>' + commuteCell(commuteOf(p, w)) + '</td>').join('') + '</tr>').join('') + '</tbody></table><p class="hint">目安です（計算方法は下）。</p>';
    }
    renderAssump();
    if (state.popup) showPopup(state.popup.kind, state.popup.i);
  }
  $('clearAll').addEventListener('click', () => { state.places = Life.empty(); try { localStorage.removeItem(Life.KEY); } catch (e) { /* 無視 */ } msg($('propMsg'), '入力を消しました。'); msg($('workMsg'), ''); hidePopup(); renderPlaces(); placeMarks(); });

  // ---- 起動・地域の切り替え ----
  // 選んだ地域のデータ（data/<地域>/）だけを読み込む。読み込んだ地域はメモリに残し、切り替えを速くする
  async function load(region, onStep) {
    const base = 'data/' + region.dir + '/';
    const get = async (name) => { const r = await fetch(base + name); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
    let manifest;
    try { manifest = await get('manifest.json'); } catch (e) { manifest = { layers: {} }; }
    const files = {};
    let done = 0, total = 1;
    const step = () => { done++; if (onStep) onStep(done, total); };
    const key = { 'plan.json': 'plan', 'population.json': 'population', 'districts.json': 'districts', 'facilities.json': 'facilities', 'hazards.json': 'hazards', 'zoning.json': 'zoning' };
    const need = (file) => Object.values(manifest.layers || {}).some((l) => l.file === file && l.status === 'ok');
    total = 1 + Object.keys(key).filter(need).length;
    step();
    await Promise.all(Object.entries(key).map(async ([file, k]) => {
      if (!need(file)) return;
      try { files[k] = await get(file); step(); } catch (e) { step();
        for (const l of Object.values(manifest.layers)) if (l.file === file && l.status === 'ok') { l.status = 'failed'; l.reason = 'データファイル（' + file + '）を読み込めませんでした'; }
      }
    }));
    let amenities = null;
    try { amenities = await get('amenities.json'); } catch (e) { amenities = null; } // 生活施設の読み込みに失敗しても、シートは使える
    const data = Lib.assemble(manifest, files, region);
    data.amenities = amenities;
    return data;
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
    setLifeEmpty(); renderExamples(); renderSheet(); footerTexts(); render(); updateToggles();
    $('dataStatus').innerHTML = '<li>' + esc(region.name) + 'のデータを読み込み中です…</li>'; $('fetchedAt').textContent = '—';
    let data = state.loaded[id];
    if (!data) {
      showLoading(region, 0, 1);
      $('status').textContent = region.name + 'のデータを読み込み中です（' + region.size + '）。' + region.wait + 'かかります。読み込み中に地図を押すと、その位置を覚えておき、終わると自動でシートを出します。';
      try { data = state.loaded[id] = await load(region, (d, t) => { if (state.region === region) showLoading(region, d, t); }); } catch (e) { data = null; }
    }
    if (state.region !== region) return; // 読み込み中に別の地域が選ばれた
    state.data = data; App.ready = true;
    $('status').textContent = data ? '地図で場所を指すか、例の場所を選ぶと、ここに状況が出ます。' : 'データを読み込めませんでした。';
    hideLoading(data ? region.name + 'のデータを読み込みました。' : '読み込めませんでした。ページを開き直してください。');
    setLife(data && data.amenities, data);
    renderStatus(); footerTexts(); updateToggles(); runPending(); render();
  }
  // ---- 読み込み中の帯（地域選択の直下）と地図の覆い ----
  let doneTimer = null;
  function showLoading(region, d, t) {
    clearTimeout(doneTimer);
    const pct = Math.round((d / t) * 100);
    $('loadbar').hidden = false; $('loadbar').classList.remove('done');
    $('loadtext').textContent = region.name + 'のデータを読み込み中（' + region.size + '。' + region.wait + 'かかります）' + pct + '%';
    $('loadprog').value = pct; $('loadprog').hidden = false;
    $('maploading').hidden = false; $('maploading').textContent = region.name + 'を読み込み中… ' + pct + '%（押した位置は覚えます）';
    map.setAttribute('aria-busy', 'true');
  }
  function hideLoading(msg) {
    $('maploading').hidden = true; map.removeAttribute('aria-busy');
    $('loadprog').hidden = true; $('loadtext').textContent = msg; $('loadbar').hidden = false; $('loadbar').classList.add('done');
    clearTimeout(doneTimer); doneTimer = setTimeout(() => { $('loadbar').hidden = true; }, 5000);
  }
  // データ無しの災害は、重ね表示の選択肢を無効にして理由を添える（地図に何も出ないのを「安全」と読ませない）
  const TOGGLE_API = { tgFlood: 'XKT026', tgSediment: 'XKT029', tgTsunami: 'XKT028', tgSurge: 'XKT027', tgLiq: 'XKT025' };
  function updateToggles() {
    const d = state.data;
    for (const [id, api] of Object.entries(TOGGLE_API)) {
      const box = $(id), st = d && d.status[api], bad = !!d && st.state !== 'ok';
      box.disabled = bad;
      if (bad) { box.checked = false; state.show[toggles[id]] = false; }
      $(id).closest('label').classList.toggle('nodata', bad);
      const note = $(id).closest('label').querySelector('.nd');
      note.hidden = !bad;
      if (bad) note.textContent = '（' + state.region.name + 'は' + (st.state === 'empty' ? Lib.NODATA : Lib.UNFETCHED) + '。安全という意味ではありません）';
    }
    drawOverlay();
  }
  App.setRegion = setRegion;
    // 矢印キーで地域のラジオを通過するだけで、大きなデータ（東京23区 約12MB）を読み込まないよう、読み込んでいない地域は少し待ってから始める
  let regionTimer = null;
  document.querySelectorAll('input[name=region]').forEach((r) => r.addEventListener('change', (e) => {
    if (!e.target.checked) return;
    clearTimeout(regionTimer);
    App.ready = false;
    const id = e.target.value;
    $('dataStatus').innerHTML = '<li>' + esc(Lib.REGIONS[id].name) + 'のデータの状況を読み込み中です…</li>'; // 前の地域の内容を残さない
    if (state.loaded[id]) setRegion(id); else regionTimer = setTimeout(() => setRegion(id), 400);
  }));
  setRegion(Lib.DEFAULT_REGION);
})();
