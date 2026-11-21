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
  // 物件・勤務先がすべて入る範囲に地図を合わせる
  function fitAll() {
    const pts = state.places.props.concat(state.places.works.filter(Boolean));
    if (!pts.length) return false;
    const { w, h } = size();
    const ws = pts.map((p) => Lib.lonLatToWorld(p.lon, p.lat, 0));
    const xs = ws.map((p) => p.x), ys = ws.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max((x1 - x0) / Math.max(60, w - 70), (y1 - y0) / Math.max(60, h - 70));
    let z = span > 0 ? Math.floor(Math.log2(1 / (span * 256))) : 15;
    z = Math.max(state.region.zoomMin || 11, Math.min(15, z));
    const c = Lib.worldToLonLat((x0 + x1) / 2, (y0 + y1) / 2, 0);
    state.view = { lon: c.lon, lat: c.lat, z }; render();
    return true;
  }
  $('fitAll').onclick = () => fitAll();
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
  // 節の見出し横に出す1行の結論（要約と同じデータから。事実だけ）
  function secHead(sec, sum) {
    const row = (re) => (sum || []).find((r) => re.test(r.k));
    if (sec.id === 'plan') { const r = row(/^区域/); return r ? r.short : ''; }
    if (sec.id === 'pop') { const r = row(/^人口/); return r ? r.v : ''; }
    if (sec.id === 'school') { const r = row(/^小学校区/); return r ? r.v : ''; }
    if (sec.id === 'hazard') { const r = row(/^災害/); return r ? (r.haz && r.haz.length ? r.haz.join('・') + 'の想定区域か付近' : '想定区域の外') : ''; }
    if (sec.id === 'fac') { const n = sec.lines.filter((l) => /: \d+件/.test(l.text)).length; return n ? n + '種類が直線800m以内' : ''; }
    return '';
  }
  // API項目コード（XKT…）は画面では出さず印刷・出典だけに残す。「作成者の集計」「市の資料」などは残す
  function tagHTML(t) { return /^XKT\d+$/.test(t) ? '<span class="tag api">' + esc(t) + '</span>' : '<span class="tag">' + esc(t) + '</span>'; }
  function hazBadges(r) {
    return (r.parts || [r.v]).map((x) => { const out = / 外$/.test(x), nd = /(データ無し|未取得)$/.test(x); return '<span class="hb' + (out ? ' out' : nd ? ' nd' : '') + '">' + esc(x) + '</span>'; }).join(' ');
  }
  function renderSheet() {
    const el = $('sheet');
    if (!state.facts || !state.data) { el.innerHTML = ''; $('printBtn').disabled = true; return; }
    const s = Lib.buildSheet(state.data, state.facts);
    const f = state.facts;
    const where = '位置: 北緯' + f.lat.toFixed(4) + '度 東経' + f.lon.toFixed(4) + '度' + (state.pinLabel && state.pinLabel.geo ? '（住所の位置は町丁などの代表点。境界付近は市の図で確かめる）' : '');
    let body;
    const sum = s.outOfScope ? null : Lib.sheetSummary(state.data, f);
    if (s.outOfScope) body = '<p class="oos">' + esc(s.outOfScope) + '</p>';
    else {
      // 先頭に事実の要約（結論ではない）。計画と災害の節は開いておく。各節の見出し横に1行の結論
      body = (sum ? '<table class="sum"><caption class="sr">この場所の要約（事実）</caption><tbody>' + sum.map((r) => '<tr><th scope="row">' + esc(r.k) + '</th><td>' + (r.parts ? hazBadges(r) : esc(r.v)) + '</td></tr>').join('') + '</tbody></table>' : '') +
        '<div class="secs">' + s.sections.map((sec) => {
          const facts = sec.lines.filter((l) => l.tag !== '注意'), notes = sec.lines.filter((l) => l.tag === '注意');
          const hd = secHead(sec, sum);
          return '<details class="sec" data-sec="' + sec.id + '"' + (sec.id === 'plan' || sec.id === 'hazard' ? ' open' : '') + '><summary><h4>' + esc(sec.title) + (hd ? '<span class="sechd">' + esc(hd) + '</span>' : '') + '</h4></summary><ul>' +
            sec.missing.map((m) => (m.includes('は' + Lib.NODATA + '（') ? '<li class="nod"><span class="tag nod-tag">' + Lib.NODATA + '</span>' : '<li class="unf"><span class="tag">' + Lib.UNFETCHED + '</span>') + esc(m) + '</li>').join('') +
            facts.map((l) => '<li>' + tagHTML(l.tag) + esc(l.text) + '</li>').join('') + '</ul>' +
            (notes.length || sec.ask.length ? '<details class="more"><summary>注意・聞く先</summary><ul>' + notes.map((l) => '<li><span class="tag warn-tag">注意</span>' + esc(l.text) + '</li>').join('') +
            sec.ask.map((a) => '<li class="ask">→ ' + esc(a) + '</li>').join('') + '</ul></details>' : '') + '</details>';
        }).join('') + '</div>' +
        '<details class="more"><summary>データにない項目（相談先で確かめる）</summary><ul class="plain">' + s.missing.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></details>';
    }
    const who = state.pinLabel ? (state.pinLabel.i != null ? '物件' + (state.pinLabel.i + 1) + ' ' : '') + state.pinLabel.name + ' の' : '';
    el.innerHTML =
      '<h3>' + esc(who + s.title.replace(/^住む場所の/, who ? '' : '住む場所の')) + '</h3>' +
      '<p class="meta">' + esc(where) + '　作成日: ' + new Date().toLocaleDateString('ja-JP') + '</p>' + body +
      '<div class="fine"><p>' + esc(Lib.ATTRIBUTION) + '。取得日 ' + esc(state.data.fetchedAt || '—') + '。将来人口は推計。表示の責任は作成者（国の作成・監修ではない）。</p>' +
      '<details class="more"><summary>出典・加工・責任の全文</summary><p>' + esc(Lib.processedFor(state.region)) + '。</p><p>' + esc(Lib.NLNI_SHORT) + '。' + esc(Lib.SCHOOL_FAC_NOTE) + '</p><p>' + esc(Lib.CREDIT) + '。</p><p>' + esc(Lib.RESPONSIBILITY) + '。</p>' +
      '<p>区域は' + (state.region.unit === '区' ? '区' : '市') + 'が公表する図が正。' + esc(Lib.POP_NOTE) + '。</p></details></div>';
    $('printBtn').disabled = !!s.outOfScope; // 対象外の地点は印刷できない
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
    return '';
  }
  function choose(lon, lat, label) {
    state.pinLabel = label || null;
    if (!state.data) { state.pending = { lon, lat }; placePin(); $('status').textContent = state.region.name + 'のデータを読み込み中です。押した位置（地図の赤いピン）は覚えてあり、読み込みが終わると自動でシートを出します。'; return; }
    state.pin = { lon, lat };
    state.facts = Lib.collect(state.data, lon, lat);
    $('status').textContent = statusText(state.facts);
    render(); renderSheet();
    selectTab('sheet', true);
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
      state.view = { lon, lat, z: 16 }; render(); scrollToMap();
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
  const TABS = ['props', 'sheet', 'place', 'info'];
  const narrow = () => window.matchMedia('(max-width: 640px)').matches;
  function selectTab(name, reveal) {
    for (const t of TABS) {
      const on = t === name;
      $('t-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('tab-' + t).hidden = !on;
    }
    const pn = $('tab-' + name); if (pn) pn.scrollTop = 0;
    // スマホも地図は上に固定し、パネルの中だけスクロールする（ページ全体は動かさない）
    if (narrow()) window.scrollTo(0, 0);
  }
  function scrollToMap() { if (narrow()) window.scrollTo(0, 0); }
  $('backProps').addEventListener('click', () => selectTab('props', true));
  window.addEventListener('beforeprint', () => document.querySelectorAll('#sheet details').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; }));
  window.addEventListener('afterprint', () => document.querySelectorAll('#sheet details').forEach((d) => { d.open = d.dataset.wasOpen === '1'; }));
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
    $('lifeNote').textContent = Life.OSM_NOTE + ' ' + Life.SCHOOL_NOTE + ' ' + Life.GAKUDO_NOTE;
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
  // 候補は入力欄のすぐ下（host）に出す。先頭の候補を強調する
  function showCands(host, list, onPick) {
    const old = host.querySelector('.cands'); if (old) old.remove();
    const d = document.createElement('div'); d.className = 'cands'; d.setAttribute('role', 'group'); d.setAttribute('aria-label', '住所の候補');
    d.innerHTML = '<p><strong>候補から選んでください</strong>（選ぶまで追加されません）</p>';
    for (const [k, c] of list.slice(0, 8).entries()) {
      const b = document.createElement('button'); b.type = 'button'; b.className = k ? 'secondary' : 'first'; b.textContent = c.title;
      b.addEventListener('click', () => { d.remove(); onPick(c); }); d.appendChild(b);
    }
    host.appendChild(d);
  }
  function msg(el, text, err, warn) { el.textContent = text; el.classList.toggle('err', !!err); el.classList.toggle('warnmsg', !!warn); }
  async function resolveAddress(q, msgEl, host, done) {
    msg(msgEl, '住所を探しています…');
    const old = host.querySelector('.cands'); if (old) old.remove();
    let list;
    try {
      list = await gsiSearch(q);
      const alt = Life.altQuery(q); // 「JR徳島駅」→「徳島駅」
      if (!list.length && alt) list = await gsiSearch(alt);
    } catch (e) { msg(msgEl, '住所検索に失敗しました（ネットワーク）。「地図で指定」で位置を指してください。', true); return; }
    list = rankCands(list);
    // 市区町村の代表点だけの候補は、ほかに候補があれば外す
    const fine = list.filter((c) => !Life.isCoarse(c.title));
    if (fine.length) list = fine;
    if (!list.length) { msg(msgEl, '「' + q + '」は見つかりませんでした。町名・番地まで入れるか（駅は「徳島駅」の形）、「地図で指定」で位置を指してください。', true); return; }
    const pick = (c) => {
      if (Life.isCoarse(c.title)) { msg(msgEl, '「' + c.title + '」は市区町村の中心点です。町名以下まで入れるか、「地図で指定」を使ってください（このままでは使いません）。', true); return; }
      msg(msgEl, ''); done(c);
    };
    const exact = list.filter((c) => c.title === q);
    if (list.length === 1 || exact.length === 1) { pick(exact[0] || list[0]); return; }
    msg(msgEl, '「' + q + '」の候補が' + list.length + '件あります。', true);
    showCands(host, list, pick);
  }
  /** 入力と結果の住所が違うときの注意（黄色） */
  function mismatchNote(q, c) { return Life.addressMismatch(q, c.title) ? '入力「' + q + '」と結果「' + c.title + '」が違います。位置を確かめてください。' : ''; }
  // 追加・削除のたびに、全物件と勤務先が入る範囲に地図を合わせる
  function afterPlaceChange(flashCol) {
    savePlaces(); renderPlaces(); hidePopup();
    if (!fitAll()) placeMarks();
    // 変わった列を一瞬強調し、表をパネル内で見える位置に寄せる
    if (flashCol) document.querySelectorAll('#propList [data-col="' + flashCol + '"]').forEach((c) => { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1600); });
    const t = $('propList').querySelector('table'); if (t) t.scrollIntoView({ block: 'nearest' });
  }
  $('propForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('propQ').value.trim(); if (!q) return;
    if (state.places.props.length >= Life.MAX_PROPS) { msg($('propMsg'), '物件は最大' + Life.MAX_PROPS + '件までです。不要な物件を消してください。', true); return; }
    resolveAddress(q, $('propMsg'), $('propCands'), (c) => {
      const r = Life.addProp(state.places, { label: q, lon: c.lon, lat: c.lat, resolved: c.title });
      if (!r.ok) { msg($('propMsg'), r.reason, true); return; }
      $('propQ').value = '';
      const mm = mismatchNote(q, c), n = state.places.props.length;
      msg($('propMsg'), mm || (n + '件目を追加（' + shortAddr(c.title) + '）。地図の「' + n + '」で位置を確かめてください（町丁などの代表点）。' + (n >= Life.MAX_PROPS ? Life.MAX_PROPS + '件まで入りました。' : '')), false, !!mm);
      afterPlaceChange();
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
      msg($('propMsg'), state.places.props.length + '件目を地図の位置で追加しました。' + (state.places.props.length >= Life.MAX_PROPS ? Life.MAX_PROPS + '件まで入りました。' : ''));
    } else {
      state.places.works[p.idx] = { label: '地図で指定', lon, lat, resolved: '' };
      msg($('workMsg'), '勤務先' + 'AB'[p.idx] + 'を地図の位置で設定しました。');
    }
    selectTab('props'); afterPlaceChange(p.kind === 'work' ? 'w' + p.idx : null);
  }
  // 勤務先: 2か所とも入れた後（または1か所と物件がある時）は1行にたたみ、「変更」で開く
  function renderWorkForms() {
    const box = $('workForms'); box.innerHTML = '';
    const W = state.places.works, nw = W.filter(Boolean).length;
    const folded = !state.workOpen && (nw === Life.MAX_WORKS || (nw >= 1 && state.places.props.length > 0));
    if (folded) {
      box.innerHTML = '<p class="wfold"><span class="stepn" aria-hidden="true">1</span><strong>勤務先</strong> ' + [0, 1].map((i) => W[i]).map((w, i) => '<span class="num w" aria-hidden="true">' + 'AB'[i] + '</span>' + (w ? esc(shortAddr(w.resolved || w.label)) : '<span class="faint">未設定</span>')).join(' ') + ' <button type="button" class="secondary mini" id="workEdit">変更</button></p>';
      $('workEdit').addEventListener('click', () => { state.workOpen = true; renderWorkForms(); const q = $('wq0'); if (q) q.focus(); });
      return;
    }
    const h = document.createElement('h2'); h.innerHTML = '<span class="stepn" aria-hidden="true">1</span>勤務先（2か所まで）' + (nw ? ' <button type="button" class="secondary mini" id="workDone">閉じる</button>' : ''); box.appendChild(h);
    const dn = h.querySelector('#workDone'); if (dn) dn.addEventListener('click', () => { state.workOpen = false; renderWorkForms(); });
    for (let i = 0; i < Life.MAX_WORKS; i++) {
      const w = state.places.works[i], L = 'AB'[i];
      const row = document.createElement('div'); row.className = 'workrow';
      row.innerHTML = '<form class="wrow"><span class="num w" aria-hidden="true">' + L + '</span><label class="sr" for="wq' + i + '">勤務先' + L + 'の住所</label><input id="wq' + i + '" type="search" placeholder="勤務先' + L + 'の住所" autocomplete="off" value="' + esc(w && w.label !== '地図で指定' ? w.label : '') + '"><button type="submit">設定</button><button type="button" class="secondary wpick" aria-label="勤務先' + L + 'を地図で指定">地図</button>' + (w ? '<button type="button" class="secondary wdel" aria-label="勤務先' + L + 'を消す">×</button>' : '') + '</form>' +
        (w && (w.label === '地図で指定' || Life.addressMismatch(w.label, w.resolved)) ? '<p class="hint' + (w.label === '地図で指定' ? '' : ' warnmsg') + '">結果: ' + esc(w.resolved || '地図で指定した位置') + '</p>' : '');
      row.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const q = row.querySelector('input').value.trim(); if (!q) return;
        resolveAddress(q, $('workMsg'), row, (c) => { state.places.works[i] = { label: q, lon: c.lon, lat: c.lat, resolved: c.title }; const mm = mismatchNote(q, c); msg($('workMsg'), mm || '勤務先' + L + 'を設定しました（' + shortAddr(c.title) + '）。表の「' + L + '」列に出ます。', false, !!mm); if (state.places.works.filter(Boolean).length === Life.MAX_WORKS) state.workOpen = false; afterPlaceChange('w' + i); });
      });
      row.querySelector('.wpick').addEventListener('click', () => startPick({ kind: 'work', idx: i }));
      const del = row.querySelector('.wdel'); if (del) del.addEventListener('click', () => { state.places.works[i] = null; msg($('workMsg'), ''); afterPlaceChange(); });
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
      else if (l.sparse && n.m > Life.SPARSE_CAP_M) c = '<td colspan="3">' + Life.fmtM(Life.SPARSE_CAP_M) + '以内に登録なし（データ不足・自治体に確認）</td>';
      else c = '<td>' + esc(n.name) + (l.sparse ? '（データ不足・参考）' : '') + '</td><td>' + Life.fmtM(n.m) + '</td><td>約' + Life.walkMin(n.m) + '分</td>';
      h += '<tr><th scope="row">' + esc(l.label) + '</th>' + c + '</tr>';
    }
    h += '</tbody></table>';
    return h + (inReg ? '' : '<p class="hint">この物件は選択中の地域の外です。距離は選択中の地域のデータだけで測っています。</p>');
  }
  // 徒歩が鉄道以下・最寄駅が同じなら徒歩だけ。徒歩60分超は「現実的でない」として淡く出し、鉄道を主にする
  function commuteCell(c) {
    const v = Life.commuteSummary(c);
    if (v.mode === 'rail') return '<b class="cm">' + v.min + '分</b>' + (v.walkOver ? '<span class="wi" title="徒歩は' + Life.WALK_MAX_MIN + '分超" aria-label="徒歩は' + Life.WALK_MAX_MIN + '分超">！</span>' : '') + '<span class="md">鉄道</span>';
    if (v.walkOver) return '<span class="faint" title="徒歩 約' + c.walk + '分。駅が' + Life.fmtM(Life.MAX_STATION_M) + '超のため鉄道の目安なし">' + Life.WALK_MAX_MIN + '分超</span>';
    return '<b class="cm">' + v.min + '分</b><span class="md">徒歩</span>';
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
      return '<h3>勤務先' + 'AB'[i] + '</h3><p>' + esc(w.resolved || w.label) + '</p><p class="hint">通勤時間は「物件・通勤」の表に出ます。</p>';
    }
    const p = state.places.props[i];
    let h = '<h3>物件' + (i + 1) + '：' + esc(p.resolved || p.label) + '</h3>';
    const ws = state.places.works.map((w, j) => (w ? { w, j } : null)).filter(Boolean);
    if (ws.length) {
      h += '<table><thead><tr><th>勤務先</th><th>通勤時間の目安（名称・時間）</th></tr></thead><tbody>' + ws.map(({ w, j }) => {
        const c = commuteOf(p, w);
        return '<tr><th scope="row">勤務先' + 'AB'[j] + '</th><td>' + esc(w.resolved || w.label) + '<br>' + commuteCell(c) + '<br><span class="hint">' + commuteDetail(c) + '</span></td></tr>';
      }).join('') + '</tbody></table><p class="hint">直線距離からの目安です（路線のつながりは見ていません）。</p>';
    } else h += '<p class="hint">勤務先を入れると、ここに通勤時間の目安が出ます。</p>';
    h += nearestHTML(i);
    h += '<p class="row"><button type="button" id="popSheet">先行きシートを見る</button><button type="button" class="secondary" id="popDel">この物件を消す</button></p>';
    return h;
  }
  function showPopup(kind, i) {
    state.popup = { kind, i };
    const el = $('popup');
    el.innerHTML = '<button type="button" class="x secondary" aria-label="閉じる">×</button>' + popupHTML(kind, i);
    el.hidden = false; positionPopup();
    el.querySelector('.x').addEventListener('click', hidePopup);
    const sb = el.querySelector('#popSheet');
    if (sb) sb.addEventListener('click', () => { hidePopup(); openPropSheet(i); });
    const db = el.querySelector('#popDel');
    if (db) db.addEventListener('click', () => { state.places.props.splice(i, 1); msg($('propMsg'), '物件' + (i + 1) + 'を消しました。'); afterPlaceChange(); });
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
      '<strong>徒歩</strong>: 直線距離×' + Life.DETOUR + '（道路距離の見積り。出典のない係数）÷分速' + Life.WALK_M_PER_MIN + 'm（不動産の表示に関する公正競争規約施行規則の「道路距離80mにつき1分」）。' + Life.WALK_MAX_MIN + '分超は「現実的でない」と表示。坂・信号は含みません。',
      '<strong>鉄道＋徒歩</strong>: 家から最寄駅まで徒歩（上の式）＋乗車＋勤務先の最寄駅から徒歩。乗車＝駅間の直線距離×' + Life.RAIL_DETOUR + '÷表定速度＋待ち' + Life.RAIL_WAIT_MIN + '分。表定速度<input id="railSpeed" type="number" min="10" max="120" step="1" value="' + state.places.speedKmh + '" aria-label="鉄道の表定速度（km/h）">km/h は出典のない仮定（初期値' + Life.RAIL_SPEED_KMH + '）。<strong>路線のつながり・乗換・時刻は見ていません</strong>。駅は OpenStreetMap（漏れあり）。最寄駅まで直線' + Life.MAX_STATION_M + 'm超・徒歩の方が早い・最寄駅が同じときは鉄道を出しません。',
      '<strong>生活施設</strong>: ' + esc(Life.DISTANCE_NOTE + Life.SCHOOL_NOTE + Life.OSM_NOTE) + esc(Life.GAKUDO_NOTE),
    ].map((x) => '<li>' + x + '</li>').join('');
    const sp = $('railSpeed');
    if (sp) sp.addEventListener('change', () => { const v = Number(sp.value); if (v >= 10 && v <= 120) { state.places.speedKmh = v; savePlaces(); renderPlaces(); } else sp.value = state.places.speedKmh; });
  }
  /** 表示用の住所（都道府県・市を省く） */
  function shortAddr(t) { const r = String(t || '').replace(/^(東京都|北海道|(京都|大阪)府|[^都道府県]{2,3}県)/, '').replace(/^[^市区町村郡]{1,5}?市/, ''); return r || t; }
  /** 物件の場所の要約を小さな札で（区域・人口・災害の想定）。シートと同じデータから作る */
  function propBadges(p) {
    if (!state.data) return '';
    const sm = Lib.sheetSummary(state.data, Lib.collect(state.data, p.lon, p.lat));
    if (!sm) return '<span class="pb out">地域の外</span>';
    const z = sm.find((r) => r.id === 'zone'), pop = sm.find((r) => /^人口/.test(r.k)), hz = sm.find((r) => /^災害/.test(r.k));
    let h = '';
    if (z) h += '<span class="pb' + (z.inRes ? ' in' : '') + '" title="' + esc(z.v) + '">' + esc(z.short.replace('居住誘導 ', '誘導').replace('計画データ無し', '計画無')) + '</span>';
    if (pop) h += '<span class="pb" title="' + esc(pop.k + ': ' + pop.v) + '">' + esc(pop.short.replace('人口 ', '人')) + '</span>';
    if (hz && hz.haz && hz.haz.length) h += '<span class="pb hz" title="' + esc(hz.v) + '">' + esc(hz.haz.map((x) => x[0]).join('')) + '</span>';
    return h;
  }
  function openPropSheet(i) {
    const p = state.places.props[i];
    state.view = { lon: p.lon, lat: p.lat, z: Math.max(state.view.z, 15) };
    choose(p.lon, p.lat, { i, name: shortAddr(p.resolved || p.label), geo: p.label !== '地図で指定' });
  }
  const TINY = { nursery: '保育', kinder: '幼稚', elem: '小', junior: '中', gakudo: '学童', super: 'スーパー', conv: 'コンビニ', station: '駅' };
  /** 物件の比較表（1つの表）: 行=物件、列=通勤A・B（概算）＋生活施設7種（直線距離）。各列の最短を太字。物件名を押すと先行きシート */
  function nearTable(P, ws) {
    const ids = Life.NEAREST_IDS, rows = P.props.map((p) => Life.nearest(state.life.layers, p.lon, p.lat));
    const min = {};
    for (const id of ids) { const l = Life.LAYERS.find((x) => x.id === id); if (l.sparse) continue; const v = rows.map((r) => r[id] && r[id].m).filter((m) => m != null); if (v.length > 1) min[id] = Math.min(...v); }
    const wcols = ws.length ? ws : [null];
    let h = '<table class="ct cmp"><caption class="sr">物件ごとの通勤時間の目安（概算）と、生活施設までの直線距離</caption><thead><tr><th rowspan="2" class="pc">物件<span class="hsub">押すとシート</span></th>' +
      '<th colspan="' + wcols.length + '" class="grp">通勤<span class="hsub">約・概算</span></th><th colspan="' + ids.length + '" class="grp">施設まで<span class="hsub">直線</span></th></tr><tr>' +
      wcols.map((x) => (x ? '<th scope="col" data-col="w' + x.j + '" title="勤務先' + 'AB'[x.j] + '：' + esc(x.w.resolved || x.w.label) + '"><span class="num w">' + 'AB'[x.j] + '</span></th>' : '<th scope="col" class="na">勤務先を入れると表示</th>')).join('') +
      ids.map((id) => { const l = Life.LAYERS.find((x) => x.id === id); return '<th scope="col" title="' + esc(l.label) + (l.sparse ? '（登録が少なく参考）' : '') + '">' + esc(TINY[id]) + (l.sparse ? '<span class="wi" aria-label="登録が少なく参考">！</span>' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    P.props.forEach((p, i) => {
      const mm = p.resolved && p.label !== '地図で指定' && Life.addressMismatch(p.label, p.resolved);
      h += '<tr><th scope="row" class="pc"><button type="button" class="pname psheet" data-i="' + i + '" aria-label="物件' + (i + 1) + 'の先行きシートを見る"><span class="rowno">' + (i + 1) + '</span>' + esc(shortAddr(p.resolved || p.label)) + '</button>' + (mm ? '<span class="warnmsg" title="入力「' + esc(p.label) + '」と違う">！入力と違う</span>' : '') + '<div class="pbs">' + propBadges(p) + '</div></th>';
      h += wcols.map((x) => (x ? '<td class="cmt" data-col="w' + x.j + '">' + commuteCell(commuteOf(p, x.w)) + '</td>' : '<td class="na">—</td>')).join('');
      for (const id of ids) {
        const l = Life.LAYERS.find((x) => x.id === id), n = rows[i][id];
        if (state.life.status[id] !== 'ok') { h += '<td class="na">—</td>'; continue; }
        const c = Life.nearCell(l, n);
        if (c.kind === 'none') h += '<td class="na">なし</td>';
        else if (c.kind === 'sparse-far') h += '<td class="na" title="' + Life.fmtM(Life.SPARSE_CAP_M) + '以内に登録なし（データ不足。市区町村に確認）">未登録</td>';
        else if (c.kind === 'sparse') h += '<td class="na" title="' + esc(n.name) + '・' + Life.fmtM(c.m) + '（登録が少なく参考）">' + Life.fmtM(c.m) + '?</td>';
        else h += '<td' + (min[id] === c.m ? ' class="best"' : '') + ' title="' + esc(n.name) + '・徒歩約' + Life.walkMin(c.m) + '分">' + Life.fmtM(c.m) + '</td>';
      }
      // スマホでは場所の札を物件の下の行に横並びで出す（名前の欄を細くし、行を低くする）
      h += '</tr><tr class="brow" aria-hidden="true"><td colspan="' + (1 + wcols.length + ids.length) + '"><span class="pbs">' + propBadges(p) + '</span></td></tr>';
    });
    return h + '</tbody></table><p class="tnote">通勤は直線距離と平均速度からの概算で、鉄道の本数・乗換・時刻は含みません。施設は直線距離（最短は太字）。小・中は学区の学校と限らず、学童！は登録が少なく参考。札: 誘導＝居住誘導区域、人＝周辺人口の増減（2025→2050年・推計）、洪津高土＝その災害の想定区域か付近。</p>';
  }
  function renderPlaces() {
    const P = state.places;
    const ws = P.works.map((w, j) => (w ? { w, j } : null)).filter(Boolean);
    const box = $('propList');
    if (!P.props.length) box.innerHTML = '<p class="hint">物件を入れると、通勤時間と保育園〜駅までの距離を1つの表で並べます。</p>';
    else {
      box.innerHTML = nearTable(P, ws);
      box.querySelectorAll('.psheet').forEach((b) => b.addEventListener('click', () => openPropSheet(Number(b.dataset.i))));
    }
    const full = P.props.length >= Life.MAX_PROPS;
    $('propAdd').disabled = $('propQ').disabled = $('propPick').disabled = full;
    $('propForm').hidden = full; // 10件入ったら入力欄をたたむ（消すと戻る）
    $('propFull').hidden = !full;
    $('propQ').placeholder = full ? Life.MAX_PROPS + '件まで入りました（消すと追加できます）' : '例: ' + (state.region.id === 'tokushima' ? '徳島市幸町2丁目' : state.region.search);
    $('exFill').hidden = P.props.length > 0 || !state.region.examples.length;
    renderWorkForms();
    renderAssump();
    if (state.popup) showPopup(state.popup.kind, state.popup.i);
  }
  // 例を入れる: 選んだ地域の例の場所を、1つ目を勤務先A、残りを物件として入れる（物件が0件の時だけ）
  $('exFill').addEventListener('click', () => {
    const ex = state.region.examples; if (!ex.length || state.places.props.length) return;
    if (!state.places.works[0]) state.places.works[0] = { label: ex[0].label, lon: ex[0].lon, lat: ex[0].lat, resolved: ex[0].label };
    for (const e of ex.slice(1)) Life.addProp(state.places, { label: '地図で指定', lon: e.lon, lat: e.lat, resolved: e.label });
    msg($('propMsg'), '例の場所を入れました（勤務先A＝' + ex[0].label + '）。消すときは地図の番号を押します。');
    afterPlaceChange('w0');
  });
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
  const App = window.App = { state, choose, render, fitAll, last: null, ready: false, setRegion: null };
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
