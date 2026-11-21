/* 大規模修繕プラットフォーム: 画面。ネットワークは GET のみ（国土地理院のタイル、同梱データ data/*.json）。
 * 利用者の入力（条件・見積・事例・口コミ・点群）は端末内だけで扱い、送信しない。事例・口コミ・チェックだけ localStorage に保存する。 */
(function () {
  'use strict';
  const L = window.Lib;
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/pale/';
  const GSI_PHOTO = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/'; // 国土地理院 シームレス空中写真（出典表示が必要）
  const DATA = 'data/';
  const KEY = { cases: 'rp1-cases', reviews: 'rp1-reviews', checks: 'rp1-checks', quotes: 'rp2-quotes' };
  const COLORS = ['#f2c14e', '#f08a24', '#d1495b', '#7a2e8e'];
  const colorOf = (f) => (f >= 15 ? COLORS[3] : f >= 10 ? COLORS[2] : f >= 6 ? COLORS[1] : COLORS[0]);
  const GRAY = '#a7afb7'; // 規模が大きく目安を出さない建物（押す前に分かるように）
  const B_ = (kind, text) => '<span class="b ' + kind + '">' + text + '</span>';
  const BADGE = { real: B_('real', '実データ'), est: B_('est', '推定'), user: B_('user', '利用者入力'), fake: B_('fake', '架空') };
  const n2 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(2));
  const n1 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(1));
  const esc = L.esc;

  const state = {
    B: null, S: null, DEMO: null, list: [], vis: [], storeyH: L.DEFAULT_STOREY_H, minFloors: 8, town: '', sel: null, simIds: new Set(),
    osm: new Map(), photos: new Map(), aptList: [], tab: 'est', cloud: null, cloudInfo: null, cloudSynthetic: false, cloudName: '', cloudUp: 'z', cloudApplied: false, cloudErr: '',
    cases: [], reviews: [], checks: {}, reviewFilter: '', simSort: 'near', wallUse: 'map', wallQty: 0, wallUnit: 0, view: { lon: 139.81, lat: 35.71, z: 13 }, fitZ: 13,
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても動く */ } },
  };

  // ---- 地図（平面の座標変換） ----
  const map = $('map'), tiles = $('tiles'), cv = $('over');
  const ctx = cv.getContext('2d');
  const imgs = new Map();
  const world = (lon, lat) => { const s = Math.sin((lat * Math.PI) / 180); return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) }; };
  const lonlat = (x, y) => ({ lon: x * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI });
  const scale = () => 256 * 2 ** state.view.z;
  const size = () => ({ w: map.clientWidth, h: map.clientHeight });
  function toScreen(wx, wy, c, k, w, h) { return [w / 2 + (wx - c.x) * k, h / 2 + (wy - c.y) * k]; }
  function fitTo(bb, pad) {
    const { w, h } = size();
    if (!w || !h) return;
    const a = world(bb[0], bb[3]), z = world(bb[2], bb[1]);
    const dx = Math.max(1e-9, z.x - a.x), dy = Math.max(1e-9, z.y - a.y);
    const zoom = Math.log2(Math.min((w - pad * 2) / (256 * dx), (h - pad * 2) / (256 * dy)));
    state.view = { lon: (bb[0] + bb[2]) / 2, lat: (bb[1] + bb[3]) / 2, z: Math.max(11, Math.min(18, zoom)) };
  }
  function boundsOfList(list) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const b of list) { if (b.lon < x0) x0 = b.lon; if (b.lon > x1) x1 = b.lon; if (b.lat < y0) y0 = b.lat; if (b.lat > y1) y1 = b.lat; }
    return [x0, y0, x1, y1];
  }
  function renderTiles() {
    const { w, h } = size(), v = state.view, zi = Math.max(5, Math.min(18, Math.round(v.z))), ts = 256 * 2 ** (v.z - zi);
    const c = world(v.lon, v.lat), n = 2 ** zi, cx = c.x * n, cy = c.y * n, k = scale();
    const want = new Set();
    for (let x = Math.floor(cx - w / 2 / ts); x <= Math.floor(cx + w / 2 / ts); x++) {
      for (let y = Math.floor(cy - h / 2 / ts); y <= Math.floor(cy + h / 2 / ts); y++) {
        if (y < 0 || y >= n) continue;
        const xx = ((x % n) + n) % n, key = zi + '/' + xx + '/' + y + '@' + x;
        want.add(key);
        let im = imgs.get(key);
        if (!im) { im = new Image(); im.alt = ''; im.src = GSI + zi + '/' + xx + '/' + y + '.png'; tiles.appendChild(im); imgs.set(key, im); }
        im.style.left = w / 2 + (x / n - c.x) * k + 'px'; im.style.top = h / 2 + (y / n - c.y) * k + 'px'; im.style.width = ts + 0.5 + 'px'; im.style.height = ts + 0.5 + 'px';
      }
    }
    for (const [key, im] of imgs) if (!want.has(key)) { im.remove(); imgs.delete(key); }
  }
  function ringPath(b, c, k, w, h) {
    ctx.beginPath();
    for (let i = 0; i < b.w.length; i += 2) {
      const [x, y] = toScreen(b.w[i], b.w[i + 1], c, k, w, h);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function draw() {
    const { w, h } = size();
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    renderTiles();
    const k = scale(), c = world(state.view.lon, state.view.lat);
    const x0 = c.x - w / 2 / k, x1 = c.x + w / 2 / k, y0 = c.y - h / 2 / k, y1 = c.y + h / 2 / k;
    ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(40,40,40,.55)';
    for (const b of state.vis) {
      if (b.bb[2] < x0 || b.bb[0] > x1 || b.bb[3] < y0 || b.bb[1] > y1) continue;
      ringPath(b, c, k, w, h);
      ctx.fillStyle = b.blocked ? GRAY : colorOf(b.floors); ctx.globalAlpha = 0.93; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
    }
    for (const b of state.vis) {
      if (!state.simIds.has(b.id)) continue;
      ringPath(b, c, k, w, h); ctx.lineWidth = 3; ctx.strokeStyle = '#0a8f6a'; ctx.stroke();
      const [sx, sy] = toScreen(b.cw.x, b.cw.y, c, k, w, h);
      ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 6.3); ctx.fillStyle = '#0a8f6a'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(state.simRank.get(b.id) || ''), sx, sy);
    }
    if (state.sel) {
      const b = state.sel;
      ringPath(b, c, k, w, h); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 3.2; ctx.strokeStyle = '#d6336c'; ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#d6336c'; ctx.fill(); ctx.globalAlpha = 1;
      const [sx, sy] = toScreen(b.cw.x, b.cw.y, c, k, w, h);
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      const tw = ctx.measureText('選択中').width + 10;
      ctx.fillStyle = '#d6336c'; ctx.fillRect(sx - tw / 2, sy - 30, tw, 18);
      ctx.beginPath(); ctx.moveTo(sx - 5, sy - 12); ctx.lineTo(sx + 5, sy - 12); ctx.lineTo(sx, sy - 5); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('選択中', sx, sy - 14);
    }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function zoomAt(px, py, dz) {
    const { w, h } = size(), c = world(state.view.lon, state.view.lat), k0 = scale();
    const wx = c.x + (px - w / 2) / k0, wy = c.y + (py - h / 2) / k0;
    state.view.z = Math.max(11, Math.min(19, state.view.z + dz));
    const k1 = scale(), nx = wx - (px - w / 2) / k1, ny = wy - (py - h / 2) / k1;
    const ll = lonlat(nx, ny); state.view.lon = ll.lon; state.view.lat = ll.lat;
    schedule();
  }
  function panBy(dx, dy) {
    const c = world(state.view.lon, state.view.lat), k = scale();
    const ll = lonlat(c.x - dx / k, c.y - dy / k); state.view.lon = ll.lon; state.view.lat = ll.lat; schedule();
  }
  function buildingAt(px, py) {
    const { w, h } = size(), c = world(state.view.lon, state.view.lat), k = scale();
    const wx = c.x + (px - w / 2) / k, wy = c.y + (py - h / 2) / k;
    let best = null, bestA = Infinity;
    for (const b of state.vis) {
      if (wx < b.bb[0] || wx > b.bb[2] || wy < b.bb[1] || wy > b.bb[3]) continue;
      const ring = []; for (let i = 0; i < b.w.length; i += 2) ring.push([b.w[i], b.w[i + 1]]);
      if (L.pointInRing(wx, wy, ring)) { const a = (b.bb[2] - b.bb[0]) * (b.bb[3] - b.bb[1]); if (a < bestA) { bestA = a; best = b; } }
    }
    if (best) return best;
    let nd = 14 * 14;
    for (const b of state.vis) { const [sx, sy] = toScreen(b.cw.x, b.cw.y, c, k, w, h); const d = (sx - px) ** 2 + (sy - py) ** 2; if (d < nd) { nd = d; best = b; } }
    return best;
  }
  function bindMap() {
    const pts = new Map();
    let moved = 0, pinch = 0;
    map.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.zoombtns')) return;
      map.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; map.style.cursor = 'grabbing';
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    map.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 1) panBy(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = map.getBoundingClientRect();
        if (pinch > 0 && d > 0) zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, Math.log2(d / pinch));
        pinch = d; moved += 10;
      }
    });
    const up = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId); map.style.cursor = 'grab';
      if (e.type === 'pointerup' && moved < 6 && pts.size === 0) {
        const r = map.getBoundingClientRect(), b = buildingAt(e.clientX - r.left, e.clientY - r.top);
        if (b) selectBuilding(b, false, true);
      }
    };
    map.addEventListener('pointerup', up); map.addEventListener('pointercancel', up);
    map.addEventListener('wheel', (e) => { e.preventDefault(); const r = map.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, -e.deltaY * 0.0015); }, { passive: false });
    map.addEventListener('keydown', (e) => {
      const s = 60;
      if (e.key === 'ArrowLeft') panBy(s, 0); else if (e.key === 'ArrowRight') panBy(-s, 0); else if (e.key === 'ArrowUp') panBy(0, s); else if (e.key === 'ArrowDown') panBy(0, -s);
      else if (e.key === '+' || e.key === '=') zoomAt(size().w / 2, size().h / 2, 0.5); else if (e.key === '-') zoomAt(size().w / 2, size().h / 2, -0.5); else return;
      e.preventDefault();
    });
    $('zin').onclick = () => zoomAt(size().w / 2, size().h / 2, 0.7);
    $('zout').onclick = () => zoomAt(size().w / 2, size().h / 2, -0.7);
    $('zfit').onclick = () => { fitTo(boundsOfList(state.vis.length ? state.vis : state.list), 16); schedule(); };
    new ResizeObserver(() => schedule()).observe(map);
  }

  // ---- データ ----
  const baseTown = (t) => String(t || '').replace(/[一二三四五六七八九十]+丁目$/, '');
  function prepare() {
    state.list = state.B.buildings.map((b) => {
      const e = L.enrich(b, state.storeyH);
      const ws = e.ring.map((p) => world(p[0], p[1]));
      e.w = ws.flatMap((p) => [p.x, p.y]);
      e.bb = [Math.min(...ws.map((p) => p.x)), Math.min(...ws.map((p) => p.y)), Math.max(...ws.map((p) => p.x)), Math.max(...ws.map((p) => p.y))];
      e.cw = world(e.lon, e.lat);
      e.blocked = L.scaleCheck(e).blocked;
      e.apt = state.osm.get(e.id) || null; // OSM で共同住宅（building=apartments 等）とされ、PLATEAU の建物と位置が重なったもの
      return e;
    });
    state.aptList = state.list.filter((b) => b.apt);
    refilter();
  }
  function reenrich() {
    for (const e of state.list) { const f = L.enrich(e, state.storeyH); e.floors = f.floors; e.tfa = f.tfa; e.wall = f.wall; e.blocked = L.scaleCheck(e).blocked; }
    if (state.sel) state.sel = state.list.find((b) => b.id === state.sel.id) || null;
    refilter();
  }
  function refilter() {
    state.vis = state.list.filter((b) => b.floors >= state.minFloors && (!state.town || baseTown(b.town) === state.town));
    $('mapNote').innerHTML = BADGE.real + ' PLATEAU <b>' + L.fmt(state.vis.length, 0) + '棟</b>（用途不明でマンションとは限りません・灰色は対象外）';
    refreshSim(); schedule();
  }

  // ---- 入力 ----
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : 0; };
  const inputs = () => ({ units: num('inUnits'), tfa: num('inTfa'), age: num('inAge'), floors: num('inFloors'), count: (document.querySelector('input[name=count]:checked') || {}).value || '1', quote: num('inQuote'), quoteTaxIn: $('inTax').value === 'in' });
  const est = { units: false, tfa: false }; // 欄が建物からの推定値のままか
  function setEst(id, v) { $(id === 'units' ? 'inUnits' : 'inTfa').value = v; est[id] = v !== ''; $(id + 'Tag').hidden = !est[id]; }
  function selectBuilding(b, pan, jump) {
    state.sel = b;
    $('mapHint').hidden = true;
    if (state.cloudSynthetic) { state.cloud = null; state.cloudInfo = null; state.cloudSynthetic = false; }
    state.scale = L.scaleCheck(b);
    $('inFloors').value = b.floors;
    if (state.scale.blocked) { setEst('tfa', ''); if (est.units) setEst('units', ''); }
    else {
      const tfa = Math.round(b.tfa / 10) * 10;
      setEst('tfa', tfa);
      if (est.units || !num('inUnits')) setEst('units', L.unitsFromTfa(tfa));
    }
    if (pan) { state.view.lon = b.lon; state.view.lat = b.lat; if (state.view.z < 16) state.view.z = 16; }
    state.cloudApplied = false;
    refreshSim(); renderAll(); schedule();
    if (jump && narrow()) { mapMin(true); if (state.tab !== 'est') setTab('est'); scrollToSide(); }
  }
  /** スマホ: 地図を小さくして下の結果を広く見せる（ボタンで戻せる） */
  function mapMin(on) {
    document.body.classList.toggle('mapmin', on);
    $('mapToggle').textContent = on ? '地図を大きく' : '地図を小さく';
    $('mapToggle').setAttribute('aria-pressed', on);
    schedule();
  }
  /** 目安を出せない建物のとき: 近くのマンション規模の建物（対象外・小規模を除く） */
  function nearestUsable(b) {
    let best = null, bd = Infinity;
    for (const x of state.vis) {
      if (x.id === b.id || x.blocked || L.scaleCheck(x).small) continue;
      const d = (x.lon - b.lon) ** 2 + (x.lat - b.lat) ** 2;
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  function pickExample() {
    const c = state.vis.filter((x) => x.floors >= 8 && x.floors <= 14 && !L.scaleCheck(x).blocked && !L.scaleCheck(x).small).sort((a, b) => b.area - a.area);
    const b = c[Math.floor(c.length / 3)] || state.vis[0];
    if (b) selectBuilding(b, true, true);
  }

  // ---- 範囲バー（0から始める軸。範囲外の見積は端に寄せて矢印） ----
  function rangeBar(r, marks) {
    const ms = (marks || []).filter((m) => m.v > 0);
    const top = Math.max(r.high * 1.35, Math.min(Math.max(0, ...ms.map((m) => m.v)) * 1.1, r.high * 2));
    const p = (v) => Math.max(0, Math.min(100, (v / top) * 100));
    let h = '<div class="rangebar' + (ms.length > 1 ? ' many' : '') + '" role="img" aria-label="目安の範囲 ' + L.fmtMan(r.low) + 'から' + L.fmtMan(r.high) + '、中央値 ' + L.fmtMan(r.mid) + ms.map((m) => '、' + m.label + ' ' + L.fmtMan(m.v)).join('') + '">' +
      '<div class="rng" style="left:' + p(r.low) + '%;width:' + (p(r.high) - p(r.low)) + '%"></div><div class="mid" style="left:' + p(r.mid) + '%">' + (ms.length ? '' : '<span>中央値</span>') + '</div>' +
      '<span class="q" style="left:' + p(r.low) + '%">' + L.fmt(r.low, 0) + '</span><span class="q" style="left:' + p(r.high) + '%">' + L.fmt(r.high, 0) + '</span>';
    ms.forEach((m, i) => {
      const over = m.v > top;
      h += '<div class="you' + (i ? ' alt' : '') + (i % 2 ? ' up' : '') + '" style="left:' + (over ? 99 : p(m.v)) + '%"><span>' + esc(m.label) + (over ? '→' : '') + '</span></div>';
    });
    return h + '</div>';
  }
  const bandShort = { 'above-q3': '高め（上位25%）', 'median-q3': 'やや高め', 'q1-median': 'やや安め', 'below-q1': '安め（下位25%）' };
  const bandTiny = { 'above-q3': '高め', 'median-q3': 'やや高め', 'q1-median': 'やや安め', 'below-q1': '安め' };

  // ---- 表示: 選んだ建物 ----
  function renderSelCard() {
    const b = state.sel, el = $('selCard');
    if (!b) { el.innerHTML = '<ol class="steps"><li><b>地図の建物を押す</b>（または「例の建物を選ぶ」）</li><li>戸数と手元の見積を入れる</li><li>似た建物・点群・発注先で比べる</li></ol>'; return; }
    const sc = state.scale || L.scaleCheck(b);
    const name = b.name && !sc.blocked ? ' ' + esc(b.name) + '<span class="mini">（PLATEAU の名称）</span>' : b.apt && b.apt.name ? ' ' + esc(b.apt.name) + '<span class="mini">（OpenStreetMap の名称）</span>' : '';
    const cw = state.cloudInfo && cloudWhole(state.cloudInfo);
    const cloud = state.cloudApplied && cw ? '<br>点群からの概算（建物全体に補正） <b>' + L.fmt(cw, 0) + '㎡</b>' + (state.cloudSynthetic ? ' ' + BADGE.fake + '合成の点群' : '') : '';
    el.innerHTML = '<b>' + esc(state.B.meta.ward) + esc(b.town) + '</b>' + name + ' ' + BADGE.est + ' <span class="mini">' + (b.apt ? 'OpenStreetMap で共同住宅とされた建物' : '共同住宅か不明') + '</span><br>' +
      '高さ' + n1(b.h) + 'm・推定階数 約' + b.floors + '階・推定延床 約' + L.fmt(b.tfa, 0) + '㎡・外壁面積の概算 約' + L.fmt(b.wall, 0) + '㎡' + cloud +
      (sc.text && !sc.blocked ? '<p class="warnline">' + esc(sc.text) + '</p>' : '') +
      '<details class="mini"><summary>推定の根拠</summary>高さは PLATEAU の計測高さ。階数は高さ÷階高' + state.storeyH + 'm、延床は屋根面積' + L.fmt(b.area, 0) + '㎡×階数、戸数は延床÷' + L.UNIT_SQM + '㎡の仮定、外壁面積は外周' + L.fmt(b.per, 0) + 'm×高さ（開口部などは考えない。誤差は未検証）。建築年・用途は PLATEAU に値なし。建物ID ' + esc(b.id) + '</details>';
  }

  // ---- 表示: 目安と見積の位置（結論を先頭に） ----
  function renderEst() {
    const S = state.S, inp = inputs(), r = L.estimate(inp, S), set = r.set;
    state.lastEst = r;
    let h = '<div class="result">';
    if (state.sel && state.scale && state.scale.blocked && !r.primary) {
      const nb = nearestUsable(state.sel);
      h += '<p class="err">' + esc(state.scale.text) + '。マンションなら、戸数を入れると計算します。' + (nb ? '<br><button type="button" class="pick" id="toNear">近くのマンション規模の建物（約' + nb.floors + '階）を選ぶ</button>' : '') + '</p>';
    } else if (!r.primary) {
      h += '<p class="mini">戸数（または延床）を入れると、目安の範囲が出ます。</p>';
    } else if (r.conflict && (r.conflict.per < L.PER_UNIT_SQM.min / 3 || r.conflict.per > L.PER_UNIT_SQM.max * 4)) {
      h += '<p class="mini">戸数か延床の桁が違うようです。直すと目安が出ます。</p>';
    } else {
      const g = r.primary;
      const gu = g.key === 'perUnit' && est.units;
      h += '<p class="big' + (gu ? ' guessing' : '') + '">修繕費の目安 <b>' + L.fmtMan(g.low) + '〜' + L.fmtMan(g.high) + '</b> ' + (gu ? '<span class="tag">推定</span>' : '') + '<span class="sub">国交省調査の中位50%（' + esc(set.label) + '・税抜）</span></p>';
      if (gu) h += '<p class="guessline">推定' + L.fmt(g.basis, 0) + '戸で試算中。<b>実際の戸数を入れてください</b></p>';
      h += rangeBar(g, r.quoteEx ? [{ v: r.quoteEx, label: '見積' }] : []);
      const pp = r.primaryPos;
      const guessU = g.key === 'perUnit' && est.units;
      if (pp) h += '<p class="concl' + (pp.band === 'above-q3' ? ' hi' : '') + '">' + (guessU ? '<span class="tag">仮</span> ' : '') + '見積 ' + L.fmtMan(r.quoteEx) + (inp.quoteTaxIn ? '（税抜換算）' : '') + ' → <b>' + pp.text + '</b>・' + pp.rel + (r.quoteEx > g.high * 1.2 ? '<br><b>目安の上限の約' + n1(r.quoteEx / g.high) + '倍で、範囲を大きく超えています</b>' : r.quoteEx < g.low * 0.8 ? '<br><b>目安の下限の約' + n1(r.quoteEx / g.low) + '倍で、範囲を大きく下回ります</b>（工事範囲を確認）' : '') + '</p>';
      else if (!inp.quote) h += '<p class="mini">↑ 手元の見積を入れると、帯に印が出ます。</p>';
    }
    if (r.conflict) {
      const u2 = L.unitsFromTfa(inp.tfa), t2 = Math.round((inp.units * L.UNIT_SQM) / 10) * 10;
      h += '<p class="err">戸数と延床が合っていません（1戸あたり' + L.fmt(r.conflict.per, 0) + '㎡）。延床' + L.fmt(inp.tfa, 0) + '㎡なら約' + u2 + '戸です。<br><button type="button" class="pick" data-fix="units" data-v="' + u2 + '">戸数を' + u2 + '戸にする</button> <button type="button" class="pick" data-fix="tfa" data-v="' + t2 + '">延床を' + L.fmt(t2, 0) + '㎡にする</button></p>';
    }
    h += '</div>';
    $('estOut').innerHTML = h;
    renderQuoteRead(inp, r);
    if ($('toNear')) $('toNear').onclick = () => { const nb = nearestUsable(state.sel); if (nb) selectBuilding(nb, true); };
    $('estOut').querySelectorAll('[data-fix]').forEach((bt) => (bt.onclick = () => {
      const el = $(bt.dataset.fix === 'units' ? 'inUnits' : 'inTfa');
      if (bt.dataset.fix === 'tfa' && !$('moreCond').open) $('moreCond').open = true;
      el.value = bt.dataset.v; el.dispatchEvent(new Event('input', { bubbles: true }));
    }));

    // 根拠（折りたたみ）
    const wasOpen = !!($('estMore').querySelector('details') || {}).open;
    let m = '<details' + (wasOpen ? ' open' : '') + '><summary>根拠・別の見方 ' + BADGE.real + '</summary>';
    if (r.primary && !r.conflict) {
      const g = r.primary;
      m += '<p class="mini">中央値 ' + L.fmtMan(g.mid) + '。範囲は' + (g.key === 'perUnit' ? L.fmt(g.basis, 0) + '戸×戸あたり' : '延床' + L.fmt(g.basis, 0) + '㎡×㎡あたり') + 'の下位25%値〜上位25%値。</p>';
      const sq = g.key === 'perUnit' && r.ranges.find((x) => x.key === 'perSqm'), ps = r.positions.find((x) => x.key === 'perSqm');
      if (sq) m += '<p class="mini">別の見方（延床あたり）: ' + L.fmtMan(sq.low) + '〜' + L.fmtMan(sq.high) + (ps ? '・見積は' + bandShort[ps.band] : '') + '。戸数' + (est.units ? 'が推定のため' : 'と延床の関係で') + '戸あたりとずれることがあり、判定は戸あたりを主にします。</p>';
    }
    m += '<p class="mini">国交省調査の分布（' + esc(set.label) + '）</p>';
    m += '<table><thead><tr><th>指標</th><th>下位25%値</th><th>中央値</th><th>上位25%値</th><th>件数</th></tr></thead><tbody>';
    const row = (name, s, f) => '<tr><td>' + name + ' <span class="mini">' + esc(s.page) + '</span></td><td>' + f(s.q1) + '</td><td>' + f(s.median) + '</td><td>' + f(s.q3) + '</td><td>' + s.n + '</td></tr>';
    m += row('戸あたり（万円/戸）', set.perUnit, n1) + row('㎡あたり（万円/㎡）', set.perSqm, n1) + row('総額（万円）', set.total, (x) => L.fmt(x, 0));
    m += '</tbody></table><p class="mini">' + esc(S.sample) + esc(S.definition) + '</p>';
    const tp = r.positions.find((x) => x.key === 'total');
    if (tp) m += '<p class="mini">参考（規模を考えない）: 総額では ' + bandShort[tp.band] + '（' + tp.rel + '）</p>';
    if (r.hint) m += '<p class="mini">築' + inp.age + '年は、平均修繕周期（' + esc(S.cycle.page) + '）からは<b>' + (r.hint.count === '3' ? '3回目以上' : r.hint.count + '回目') + '</b>の見当です（実際の回数を選んでください）。</p>';
    const shareWall = (S.breakdown.total[0].pct * S.breakdown.groups['外壁関係']) / 100, shareWp = (S.breakdown.total[0].pct * S.breakdown.groups['防水関係']) / 100;
    m += '<p class="mini">内訳（' + esc(S.breakdown.page) + '）: 総額のうち外壁関係 約' + n1(shareWall) + '%、防水関係 約' + n1(shareWp) + '%（建築系' + S.breakdown.total[0].pct + '%×各比率の計算）' + (r.quoteEx ? '。見積に当てはめると外壁関係 約' + L.fmtMan((r.quoteEx * shareWall) / 100) : '') + '</p></details>';
    $('estMore').innerHTML = m;
    renderSimMini();
    renderSumBar();
  }

  // ---- 似た建物（目安タブの中に上位3棟） ----
  /** 目安タブと同じ計算（推定戸数×戸あたりの中位50%）。戸数は延床からの推定 */
  function simRange(b) {
    const set = state.S.byCount[inputs().count] || state.S.byCount['1'], u = L.unitsFromTfa(Math.round(b.tfa / 10) * 10);
    return { low: set.perUnit.q1 * u, high: set.perUnit.q3 * u };
  }
  /** 建物の上空写真（国土地理院シームレス空中写真 z18 の 2x2 タイルから、建物を中心に 132x99px を切り出す）。建物の外形を線で重ねる */
  const PW = 132, PH = 99, PZ = 18;
  const NAMED_BONUS = 0.15; // 規模の比（対数）0.15 ≒ 約16% の差までは、名前の分かる建物を先にする
  function aerialHtml(b, alt) {
    const k = 256 * 2 ** PZ, c = world(b.lon, b.lat);
    const left = c.x * k - PW / 2, top = c.y * k - PH / 2;
    const tx = Math.floor(left / 256), ty = Math.floor(top / 256);
    let h = '<div class="aer" role="img" aria-label="' + esc(alt) + '">';
    for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) {
      h += '<img loading="lazy" alt="" width="256" height="256" src="' + GSI_PHOTO + PZ + '/' + (tx + dx) + '/' + (ty + dy) + '.jpg" style="left:' + Math.round((tx + dx) * 256 - left) + 'px;top:' + Math.round((ty + dy) * 256 - top) + 'px">';
    }
    const pts = b.ring.map((p) => { const w = world(p[0], p[1]); return (w.x * k - left).toFixed(1) + ',' + (w.y * k - top).toFixed(1); }).join(' ');
    return h + '<svg viewBox="0 0 ' + PW + ' ' + PH + '" aria-hidden="true"><polygon points="' + pts + '"/></svg></div>';
  }
  const nameOf = (b) => (b.apt && b.apt.name ? esc(b.apt.name) : '<span class="noname">名称不明</span>');
  /** 外観の写真（Wikimedia Commons。作者・ライセンスを必ず表示）。見つかった建物だけ */
  function exteriorHtml(b) {
    const p = state.photos.get(b.id);
    if (!p) return '';
    return '<figure class="ext"><img loading="lazy" src="' + esc(p.thumb) + '" alt="' + esc((b.apt && b.apt.name) || '') + 'の外観写真"><figcaption>外観写真（Wikimedia Commons）作者 ' + esc(p.artist) + '・<a href="' + esc(p.licenseUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.license) + '</a>・<a href="' + esc(p.page) + '" target="_blank" rel="noopener noreferrer">原典</a></figcaption></figure>';
  }
  /** 似た建物のカード。実在の建物なので、修繕費・修繕実績・口コミの数値は一切出さない（公開データなし） */
  function simCard(x) {
    const b = x.b, i = state.simRank.get(b.id);
    const alt = '上空写真: ' + (b.apt && b.apt.name ? b.apt.name : '名称不明') + '（' + b.town + '）';
    return '<li class="aptcard"><button type="button" class="pick" data-id="' + esc(b.id) + '" aria-label="地図の' + i + '番の建物を選ぶ">' + i + '</button>' +
      aerialHtml(b, alt) + '<div class="apb"><b class="apn">' + nameOf(b) + '</b> <span class="mini">' + esc(b.town) + '</span><br>' +
      '推定' + b.floors + '階・延床約' + L.fmt(b.tfa, 0) + '㎡・高さ' + n1(b.h) + 'm' + (x.km != null ? '・' + n1(x.km) + 'km' : '') + '<br>' +
      '<span class="mini">写真: 上空（国土地理院）' + (state.photos.has(b.id) ? '＋外観' : '') + '　修繕実績: <b>未登録（公開データなし）</b></span></div>' + exteriorHtml(b) + '</li>';
  }
  function bindPicks(el) { el.querySelectorAll('.pick[data-id]').forEach((b) => (b.onclick = () => { const bd = state.list.find((x) => x.id === b.dataset.id); if (bd) selectBuilding(bd, true); })); }
  /** 見積の読み上げ（桁の取り違え防止）: 25000万円＝2億5,000万円・1戸あたり */
  function renderQuoteRead(inp) {
    const q = inp.quote, el = $('quoteRead');
    if (!q) { el.textContent = ''; return; }
    const oku = Math.floor(q / 10000), man = Math.round(q % 10000);
    const yomi = oku ? oku + '億' + (man ? L.fmt(man, 0) + '万円' : '円') : L.fmt(q, 0) + '万円';
    el.innerHTML = '入力 ' + L.fmt(q, 0) + '万円＝<b>' + yomi + '</b>' + (inp.units ? '・1戸あたり 約' + L.fmtMan(q / inp.units) : '');
  }
  /** 目安タブの下に、ほかのタブの結果を1行ずつ（押すとそのタブへ） */
  function renderSimMini() {
    const el = $('simMini');
    if (!state.sel && !(state.lastEst && state.lastEst.primary)) { el.innerHTML = ''; return; }
    const n = (state.simList || []).length;
    const ci = state.cloudInfo, sb = state.sel;
    const slam = ci && sb ? '点群 ' + L.fmt(cloudWhole(ci), 0) + '㎡（地図 ' + L.fmt(sb.wall, 0) + '㎡）' : sb ? '外壁 約' + L.fmt(sb.wall, 0) + '㎡（地図）。点群で照合' : '点群で外壁面積を概算';
    const base = state.lastEst, inp = inputs();
    let ven = '発注先: 3社の見積を同じ帯で比べる';
    if (base && base.primary && state.quotes) {
      const ps = state.quotes.map((q, i) => { const a = quoteAmount(q, base, inp.quoteTaxIn); const c = a > 0 ? L.compareQuotes([{ name: q.name, amount: a, taxIn: inp.quoteTaxIn }], inp, state.S)[0] : null; return c && c.pos ? LETTER[i] + ' ' + bandTiny[c.pos.band] : null; }).filter(Boolean);
      if (ps.length) ven = '発注先: ' + ps.join('・') + (state.quotes.some((q) => q.demo) ? '（見本）' : '');
    }
    el.innerHTML = '<span class="ovl">' + (n ? '<a href="#" id="toSim">似た建物 ' + n + '棟（地図の緑の番号）→</a>' : '') + '<a href="#" id="toSlam">' + slam + ' →</a><a href="#" id="toVendor">' + esc(ven) + ' →</a></span>';
    if ($('toSim')) $('toSim').onclick = (e) => { e.preventDefault(); setTab('sim', true); };
    $('toSlam').onclick = (e) => { e.preventDefault(); setTab('slam', true); };
    $('toVendor').onclick = (e) => { e.preventDefault(); setTab('vendor', true); };
  }

  // ---- スマホ: 画面下の要約バー ----
  function renderSumBar() {
    const r = state.lastEst, el = $('selLine');
    if (!r || !r.primary) el.innerHTML = state.sel ? '建物を選びました。戸数・見積を入れてください ▲' : '建物を押すと、修繕費の目安が出ます';
    else el.innerHTML = '目安 <b>' + L.fmt(r.primary.low, 0) + '〜' + L.fmtMan(r.primary.high) + '</b>' + (r.primaryPos ? '・見積は<b>' + bandShort[r.primaryPos.band] + '</b>' + (r.quoteEx > r.primary.high * 1.2 ? '（範囲外）' : '') : '・見積を入れる') + (r.conflict ? '・<b>戸数と延床が合っていません</b>' : '') + ' <span class="go">目安へ</span>';
    el.onclick = () => { setTab('est'); scrollToSide(); };
    sumBarVis();
  }
  /** スマホ: 要約は地図の直下。目安タブでは結果がすぐ下にあるので出さない（スクロールで出し入れしない） */
  function sumBarVis() {
    $('selLine').classList.toggle('off', state.tab === 'est' || !state.sel);
  }
  /** スマホ: 地図（上に固定）のすぐ下にパネルの先頭が来るように寄せる */
  function scrollToSide() {
    if (!narrow()) return;
    const top = $('side').getBoundingClientRect().top, mb = $('mapcol').getBoundingClientRect().bottom;
    if (top >= mb - 1 && top <= mb + 20) return; // すでに地図のすぐ下（勝手に画面を動かさない）
    const y = top + window.scrollY - $('mapcol').offsetHeight;
    window.scrollTo(0, Math.max(0, y));
  }

  // ---- 似た建物・事例 ----
  function simTarget() {
    if (state.sel) return state.sel;
    const f = num('inFloors'), t = num('inTfa');
    return f > 0 && t > 0 ? { id: '', floors: f, tfa: t } : null;
  }
  function refreshSim() {
    const t = simTarget();
    state.simList = t ? L.similar(state.aptList, t, 6, state.storeyH, (b) => (b.apt && b.apt.name ? NAMED_BONUS : 0)) : [];
    state.simIds = new Set(state.simList.map((x) => x.b.id));
    state.simRank = new Map(state.simList.map((x, i) => [x.b.id, i + 1]));
  }
  function renderSim() {
    const t = simTarget(), om = state.osmMeta;
    let h = '<h2>規模が似た実在のマンション（推定階数±2階） ' + BADGE.real + BADGE.est + '</h2>';
    h += '<p class="concl hi"><b>実在の建物に、修繕費・修繕実績・口コミは結び付けていません</b>（公開データなし）。番号は地図の緑の番号と同じです。</p>';
    if (!t) h += '<p class="mini">建物を選ぶと、規模の近いマンションを地図に番号で示し、上空写真つきで並べます。</p>';
    else if (!state.simList.length) h += '<p>条件に合うマンションがありません（OpenStreetMap で共同住宅とされた ' + state.aptList.length + ' 棟の中から探しています）。</p>';
    else {
      const key = { near: null, km: (x) => (x.km == null ? 1e9 : x.km) }[state.simSort];
      const rows = key ? state.simList.slice().sort((a, b) => key(a) - key(b)) : state.simList;
      const sb = (k, label) => '<button type="button" class="pick' + (state.simSort === k ? ' on' : '') + '" data-sort="' + k + '" aria-pressed="' + (state.simSort === k) + '">' + label + '</button>';
      h += '<p class="mini">並べ替え ' + sb('near', '規模が近い') + sb('km', '距離') + ' <button type="button" class="pick" id="fitSim">地図に全部映す</button></p>';
      h += '<ul class="aptgrid">' + rows.map(simCard).join('') + '</ul>';
    }
    h += '<details class="mini"><summary>出典・選び方</summary><ul class="list">' +
      '<li>「マンション」= OpenStreetMap で建物の種別が共同住宅（apartments・residential・dormitory）とされ、PLATEAU の建物の内側に位置が入ったもの' + (om ? '（墨田区 ' + L.fmt(om.osmWays, 0) + ' 件のうち、地図に出る規模の ' + L.fmt(om.matched, 0) + ' 棟。名前があるのは ' + L.fmt(om.named, 0) + ' 棟）' : '') + '。名前は OpenStreetMap にあるものだけ。無いものは「名称不明」（町丁目で区別）。住戸・居住者の情報は扱いません。</li>' +
      '<li>上空写真: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院 シームレス空中写真</a>（建物の外形線は PLATEAU）。外観写真は Wikimedia Commons で商用利用できるライセンスのものが見つかった建物だけ（今は0棟。上空写真のみ）。</li>' +
      '<li>名称・種別: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>（ODbL）。階数・延床は PLATEAU の高さ・屋根面積からの推定。</li></ul></details>';
    $('simOut').innerHTML = h;
    bindPicks($('simOut'));
    if ($('fitSim')) $('fitSim').onclick = () => { fitTo(boundsOfList(state.simList.map((x) => x.b).concat(state.sel ? [state.sel] : [])), 40); schedule(); if (narrow()) { mapMin(false); map.scrollIntoView({ block: 'start' }); } };
    $('simOut').querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { state.simSort = b.dataset.sort; renderSim(); }));
    renderCases();
  }
  function allCases() {
    const demo = state.DEMO.cases.map((c) => Object.assign({}, c, { fake: true }));
    const mine = state.cases.map((c) => Object.assign({}, c, { fake: false }));
    return mine.concat(demo);
  }
  function renderCases() {
    const S = state.S, tfa = state.sel ? state.sel.tfa : num('inTfa');
    let list = allCases();
    if (tfa > 0) list = list.map((c) => Object.assign({ dist: Math.abs(Math.log(c.tfa / tfa)) }, c)).sort((a, b) => a.dist - b.dist);
    const caseLi = (c) => {
      const set = S.byCount[String(c.count)] || S.byCount['1'];
      const pu = L.position(c.total / c.units, set.perUnit);
      return '<tr class="' + (c.fake ? 'fakeitem' : 'mine') + '" title="' + esc((c.age ? '築' + c.age + '年・' : '') + (c.year ? c.year + '年・' : '') + (c.count >= 3 ? '3回目以上' : c.count + '回目')) + '"><td>' + (c.fake ? BADGE.fake : BADGE.user) + ' ' + esc(c.name) +
        (c.fake ? '' : ' <button type="button" class="pick delcase" data-cid="' + esc(c.id) + '">削除</button>') + '</td><td>' + esc(String(c.units)) + '</td><td>' + L.fmt(c.tfa, 0) + '</td><td>' + L.fmt(c.total, 0) + '</td><td>' + bandTiny[pu.band] + '</td></tr>';
    };
    const mine = list.filter((c) => !c.fake), demo = list.filter((c) => c.fake);
    let h = '<h3>架空のデモ事例（実在の建物ではありません） <span class="mini">見本は架空・足した事例は端末内のみ</span></h3>';
    h += '<table class="cst"><thead><tr><th>事例</th><th>戸</th><th>延床㎡</th><th>総額（万円）</th><th>戸あたり</th></tr></thead><tbody>' + mine.concat(demo).map(caseLi).join('') + '</tbody></table>';
    h += '<form id="caseForm" class="mini-form case3" autocomplete="off">' +
      '<label>戸数<input name="units" type="number" min="1" required></label><label>延床㎡<input name="tfa" type="number" min="1" required></label>' +
      '<label>総額（万円・税抜）<input name="total" type="number" min="1" required></label>' +
      '<div class="sub2"><button type="submit">足す</button></div>' +
      '<details class="full addcase"><summary>工事回数・工事年など（任意）・書き出し</summary><div class="mini-form">' +
      '<label>工事回数<select name="count"><option value="1">1回目</option><option value="2">2回目</option><option value="3">3回目以上</option></select></label>' +
      '<label>工事年<input name="year" type="number" min="1990" max="2040"></label>' +
      '<label>建物名<input name="name" maxlength="40"></label><label>町名<input name="town" maxlength="20"></label>' +
      '<label>築年数（工事時）<input name="age" type="number" min="0" max="100"></label>' +
      '<label>発注方式<select name="method"><option value="">不明</option><option>設計・監理方式</option><option>責任施工方式</option><option>CM方式</option><option>その他</option></select></label>' +
      '<label class="full">メモ（個人名・部屋番号は書かない）<input name="memo" maxlength="120"></label>' +
      '<div class="full"><button type="button" class="ghost" id="exportCases">JSONで書き出す</button></div></div></details></form>';
    const wasOpen = [...$('caseOut').querySelectorAll('details')].map((d) => d.open);
    $('caseOut').innerHTML = h;
    $('caseOut').querySelectorAll('details').forEach((d, i) => { if (wasOpen[i]) d.open = true; });
    const f = $('caseForm');
    f.onsubmit = (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      state.cases.unshift({ id: 'c' + Date.now(), name: d.name || '（名称なし）', town: d.town || '', units: +d.units, tfa: +d.tfa, age: +d.age || 0, count: +d.count, year: +d.year || '', total: +d.total, method: d.method, memo: d.memo });
      store.set(KEY.cases, state.cases); renderCases();
    };
    $('exportCases').onclick = () => download('repair-cases.json', JSON.stringify(state.cases, null, 2), 'application/json');
    $('caseOut').querySelectorAll('.delcase').forEach((b) => (b.onclick = () => { state.cases = state.cases.filter((c) => c.id !== b.dataset.cid); store.set(KEY.cases, state.cases); renderCases(); }));
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- 点群 ----
  /** 点群の壁の長さ×建物の高さ（測れた高さの外周を、建物全体の高さに伸ばした概算） */
  function cloudWhole(c) { return state.sel ? c.wallLen * state.sel.h : c.wall; }
  function renderSlam() {
    const c = state.cloudInfo, sb = state.sel;
    let h = '<div class="fields"><button type="button" id="cloudSample">見本で試す</button><label class="btn ghost filebtn">点群ファイル（お持ちの方）<input id="cloudFile" class="vh" type="file" accept=".ply,.las,.laz,.xyz,.txt,.csv,.pts"></label></div>';
    if (state.cloudErr) h += '<p class="err">' + esc(state.cloudErr) + '</p>';
    if (c) {
      const fake = state.cloudSynthetic ? ' ' + BADGE.fake : '';
      if (sb) {
        const lowH = Math.min(c.height, sb.h), mapLow = sb.per * lowH, whole = cloudWhole(c);
        const d = ((whole - sb.wall) / sb.wall) * 100, ad = L.fmt(Math.abs(d), 0);
        const why = Math.abs(d) < 10 ? '地図とほぼ同じ' : d < 0 ? '測れていない面がある可能性' : '付属物や周りも測った可能性';
        const useCloud = state.wallUse === 'cloud', useV = useCloud ? whole : sb.wall;
        state.wallRef = useV;
        const ub = (k, label) => '<button type="button" class="pick' + (state.wallUse === k ? ' on' : '') + '" data-use="' + k + '" aria-pressed="' + (state.wallUse === k) + '">' + label + '</button>';
        h += '<p class="concl">点群 <b>' + L.fmt(whole, 0) + '㎡</b>' + fake + ' は地図 ' + L.fmt(sb.wall, 0) + '㎡ より <b>' + (d >= 0 ? '+' : '−') + ad + '%</b>（' + why + '）' +
          (state.cloudSynthetic ? '<br><span class="mini">' + BADGE.fake + ' 操作の練習用の合成データ（<b>実測ではありません</b>）</span>' : '<br><span class="mini">' + BADGE.user + ' ' + esc(state.cloudName) + '</span>') + '</p>';
        h += '<p class="usebar">判断に使う外壁面積 ' + ub('map', '地図 ' + L.fmt(sb.wall, 0) + '㎡') + ub('cloud', '点群 ' + L.fmt(whole, 0) + '㎡') + '</p>';
        h += unitLine(sb.wall, whole);
        h += '<div class="qcheck"><b>見積書と照らす</b> <label>外壁数量 <input id="wQty" type="number" min="0" inputmode="numeric" value="' + (state.wallQty || '') + '"><span class="u">㎡</span></label> ' +
          '<label>単価 <input id="wUnit" type="number" min="0" inputmode="numeric" value="' + (state.wallUnit || '') + '"><span class="u">円/㎡</span></label><div id="wOut"></div></div>';
        const W = (x) => '<b>' + x + '</b>';
        h += '<div class="slamrow"><table><thead><tr><th>外壁面積</th><th>測れた範囲<br><span class="mini">高さ' + n1(lowH) + 'm</span></th><th>建物全体<br><span class="mini">' + n1(sb.h) + 'm</span></th></tr></thead><tbody>' +
          '<tr><td>点群' + fake + '</td><td>' + L.fmt(c.wall, 0) + '㎡</td><td>' + (useCloud ? W(L.fmt(whole, 0) + '㎡') : L.fmt(whole, 0) + '㎡') + '</td></tr>' +
          '<tr><td>地図</td><td>' + L.fmt(mapLow, 0) + '㎡</td><td>' + (useCloud ? L.fmt(sb.wall, 0) + '㎡' : W(L.fmt(sb.wall, 0) + '㎡')) + '</td></tr></tbody></table>' +
          '<canvas id="plan" width="120" height="84" role="img" aria-label="点群を真上から見た図（青い点）と外周（赤線）"></canvas></div>';
      } else {
        h += '<p class="mini">' + (state.cloudSynthetic ? BADGE.fake + ' 操作の練習用の合成データ（<b>実測ではありません</b>）' : BADGE.user + ' ' + esc(state.cloudName)) + '</p>';
        h += '<p class="big">外壁面積の概算 <b>' + L.fmt(c.wall, 0) + '㎡</b>' + fake + ' <span class="mini">壁の長さ' + n1(c.wallLen) + 'm×高さ' + n1(c.height) + 'm</span></p><p class="mini">地図で建物を選ぶと、建物全体との比較が出ます。</p><canvas id="plan" width="120" height="84" role="img" aria-label="点群を真上から見た図（青い点）と外周（赤線）"></canvas>';
      }
      if (c.width < 10 && c.depth < 10) h += '<p class="warnline">範囲が10m未満です。建物の一部だけの可能性が高いです。</p>';
      if (c.slender) h += '<p class="warnline">細長いので壁1面とみなしました。</p>';
      h += '<p><button type="button" id="cloudApply">この概算を建物の欄に出す</button></p>';
    } else {
      h += '<p class="mini">低層部を一周測った点群から外壁面積を概算し、地図の値・見積書の数量と比べます。点群が無ければ地図の概算（建物の欄）で比べられます。</p>';
    }
    h += '<p class="warnline">スマホ LiDAR は1〜5m程度まで。高層の外壁全体は測れません。</p>';
    h += '<details class="mini"><summary>詳しく（計算・形式・向き）</summary>建物全体は、測れた低層部の外周を建物の高さまで伸ばした値。図は真上から見た点（青）と外周（赤線）。窓・バルコニー・凹みで実面積とずれます（誤差は未検証）。PLY・LAS（無圧縮）・XYZ を端末内で読み、送信・保存しません。LAZ は LAS か PLY に変換してください。点群に住戸内や人が写ることがあります。検出範囲は電子情報通信学会 FIT2025 I-015 の記載とメーカー資料による。<br><label>上方向 <select id="cloudUp"><option value="z"' + (state.cloudUp === 'z' ? ' selected' : '') + '>Z</option><option value="y"' + (state.cloudUp === 'y' ? ' selected' : '') + '>Y（スマホのARアプリ）</option></select></label> <button type="button" id="cloudSavePly" class="ghost">見本をPLYで保存</button></details>';
    $('slamOut').innerHTML = h;
    $('cloudFile').onchange = async (e) => { const f = e.target.files[0]; if (f) await loadCloud(f); };
    $('cloudSample').onclick = () => setCloud(sampleCloud(), '見本（合成）', true);
    $('cloudSavePly').onclick = () => download('sample-synthetic.ply', L.toPLY(sampleCloud()), 'text/plain');
    $('cloudUp').onchange = (e) => { state.cloudUp = e.target.value; if (state.cloud) setCloud(state.cloud, state.cloudName, state.cloudSynthetic); };
    if ($('wQty')) {
      const upd = () => { state.wallQty = num('wQty'); state.wallUnit = num('wUnit'); renderWallCheck(); };
      $('wQty').oninput = upd; $('wUnit').oninput = upd; renderWallCheck();
    }
    $('slamOut').querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => { state.wallUse = b.dataset.use; renderSlam(); }));
    if (c) { drawPlan(); $('cloudApply').onclick = () => { state.cloudApplied = true; renderSelCard(); setTab('est'); }; }
  }
  /** 見積書の外壁数量・単価（利用者が見積書から入れる）を、使う値と照らす。単価は作らない */
  function renderWallCheck() {
    const el = $('wOut'), ref = state.wallRef, q = state.wallQty, u = state.wallUnit;
    if (!el || !ref) return;
    let h = '';
    if (q) {
      const d = ((q - ref) / ref) * 100;
      h += '<p class="pos">見積書の数量は' + (state.wallUse === 'cloud' ? '点群' : '地図') + 'の値より <b>' + (d >= 0 ? '+' : '') + L.fmt(d, 0) + '%</b><span class="mini">（差の理由＝開口部・付属部の扱いなどを業者に確認）</span></p>';
    }
    if (u) h += '<p class="mini">' + (state.wallUse === 'cloud' ? '点群' : '地図') + 'の値×見積書の単価 = <b>' + L.fmtMan((ref * u) / 10000) + '</b>' + (q ? '（見積書の数量では ' + L.fmtMan((q * u) / 10000) + '）' : '') + '</p>';
    if (!q && !u) h = '<p class="mini">見積書の外壁数量（㎡）を入れると差が％で出ます。</p>';
    el.innerHTML = h;
  }
  /** 見本: 建物を選んでいれば、その外形を低層部（5m＝スマホ LiDAR の検出範囲の上限か建物の高さの低い方）まで測ったとみなす。選んでいなければ箱 */
  function sampleCloud() { return state.sel ? L.synthCloudFor(state.sel.ring, Math.min(5, state.sel.h)) : L.synthCloud(); }
  /** 見積の外壁関係（調査の平均比率）÷外壁面積を、地図の値と点群の値で並べる（どちらを使うかで判断がどう変わるか） */
  function unitLine(mapW, cloudW) {
    const S = state.S, q = state.lastEst && state.lastEst.quoteEx;
    const share = (S.breakdown.total[0].pct * S.breakdown.groups['外壁関係']) / 100;
    if (!q) return '<p class="mini">目安タブで見積を入れると、外壁の㎡単価（参考）を地図・点群の両方で出します。</p>';
    const u = (w) => L.fmt(((q * share) / 100 / w) * 10000, 0);
    return '<p class="pos">見積の外壁関係の㎡単価（参考）: 地図なら <b>' + u(mapW) + '円</b>・点群なら <b>' + u(cloudW) + '円</b>' + (state.cloudSynthetic ? '（点群は見本）' : '') + '<br><span class="mini">外壁関係＝総額の約' + n1(share) + '%（' + esc(S.breakdown.page) + '）。面積が大きいほど単価は下がります</span></p>';
  }
  async function loadCloud(f) {
    state.cloudErr = '';
    try {
      if (f.size > 400 * 1024 * 1024) throw new Error('ファイルが大きすぎます（400MB まで）');
      const ab = await f.arrayBuffer();
      setCloud(L.parseCloud(ab, f.name), f.name, false);
    } catch (e) { state.cloudErr = e.message; state.cloud = null; state.cloudInfo = null; renderSlam(); }
  }
  function setCloud(cloud, name, synthetic) {
    state.cloudErr = '';
    try { state.cloudInfo = L.analyzeCloud(cloud, state.cloudUp); state.cloud = cloud; state.cloudName = name; state.cloudSynthetic = synthetic; state.cloudApplied = false; state.wallUse = synthetic ? 'map' : 'cloud'; }
    catch (e) { state.cloudErr = e.message; state.cloudInfo = null; }
    renderSlam(); renderSelCard();
  }
  function drawPlan() {
    const c = state.cloudInfo, cvp = $('plan'); if (!cvp || !c) return;
    const g = cvp.getContext('2d'), W = cvp.width, H = cvp.height;
    g.clearRect(0, 0, W, H);
    const xs = c.hull.map((p) => p[0]), ys = c.hull.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((W - 12) / Math.max(1e-6, x1 - x0), (H - 12) / Math.max(1e-6, y1 - y0));
    const X = (x) => 6 + (x - x0) * s, Y = (y) => H - 6 - (y - y0) * s;
    g.fillStyle = '#0b3d63';
    for (const p of c.sample) g.fillRect(X(p[0]) - 1, Y(p[1]) - 1, 2, 2);
    g.strokeStyle = '#d6336c'; g.lineWidth = 2; g.beginPath();
    c.hull.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); g.stroke();
  }

  // ---- 発注先の比較（見積の横並び＋口コミの件数） ----
  const LETTER = ['A', 'B', 'C'];
  // 見本の3社（架空）。見積は「選んだ建物の目安の中央値×係数」を100万円単位に丸めた作り物で、根拠のある値ではない（1社は帯の外に出る）
  const DEMO_QUOTES = [['架空工務店A', 0.95], ['架空リフォームB', 1.1], ['架空建設C', 1.6]];
  const demoQuotes = () => DEMO_QUOTES.map(([name, f]) => ({ name, amount: 0, demo: true, f }));
  function quoteAmount(r, base, taxIn) {
    if (!r.demo) return r.amount;
    return base.primary ? Math.round((base.primary.mid * r.f * (taxIn ? 1 + L.TAX_RATE : 1)) / 100) * 100 : 0;
  }
  function renderVendor() {
    const inp = inputs(), all = L.sortReviews(state.DEMO.reviews.map((r) => Object.assign({}, r, { fake: true })).concat(state.reviews.map((r) => Object.assign({}, r, { fake: false }))));
    const rows = state.quotes, base = L.estimate(inp, state.S);
    const amts = rows.map((r) => quoteAmount(r, base, inp.quoteTaxIn));
    const per = rows.map((r, i) => (amts[i] > 0 ? L.compareQuotes([{ name: r.name, amount: amts[i], taxIn: inp.quoteTaxIn }], inp, state.S)[0] : null));
    const anyDemo = rows.some((r) => r.demo);
    let h = '<p class="banner">' + BADGE.fake + ' 見本の3社・口コミは架空です（実データなし）。<b>会社名と見積を書き換えて比べます。</b></p>';
    const mine = inp.quote > 0 ? L.compareQuotes([{ name: '自分の見積', amount: inp.quote, taxIn: inp.quoteTaxIn }], inp, state.S)[0] : null;
    if (base.primary) h += rangeBar(base.primary, (mine ? [{ v: mine.ex, label: '自' }] : []).concat(per.map((c, i) => (c ? { v: c.ex, label: LETTER[i] } : null)).filter(Boolean)));
    else h += '<p class="mini">建物を選ぶか戸数を入れると、各社の位置が同じ帯に並びます。</p>';
    const posCell = (c) => '<span class="pb ' + c.pos.band + '">' + bandTiny[c.pos.band] + (base.primary && c.ex > base.primary.high * 1.2 ? '・範囲外' : '') + '</span>';
    h += '<table class="qt"><thead><tr><th></th><th>会社名</th><th>見積（万円・' + (inp.quoteTaxIn ? '税込' : '税抜') + '）</th><th>位置</th><th>口コミ</th></tr></thead><tbody>';
    // 目安タブで入れた見積を「自分の見積」として先頭に並べる（入力の往復をなくす）
    if (inp.quote > 0) h += '<tr class="minerow"><td><b>自</b></td><td>目安タブの見積</td><td>' + L.fmt(inp.quote, 0) + '</td><td>' + (mine && mine.pos ? posCell(mine) : '—') + '</td><td>—</td></tr>';
    rows.forEach((r, i) => {
      const c = per[i], rc = L.reviewCounts(all, r.name);
      h += '<tr' + (r.demo ? ' class="demorow"' : '') + '><td><b>' + LETTER[i] + '</b></td><td><input class="qname" data-i="' + i + '" value="' + esc(r.name) + '" maxlength="20" aria-label="会社' + LETTER[i] + 'の名前"></td><td><input class="qamt" data-i="' + i + '" type="number" min="0" inputmode="numeric" value="' + (amts[i] || '') + '" aria-label="会社' + LETTER[i] + 'の見積（万円）"></td><td>' +
        (c && c.pos ? posCell(c) : amts[i] ? '戸数を入れる' : '—') + '</td><td>' + (r.name ? (rc.n ? rc.n + '件' + (rc.related ? '（利害あり' + rc.related + '）' : '') : '該当なし') : '—') + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="mini">' + (anyDemo ? '' : '<button type="button" class="pick" id="qDemo">見本の3社に戻す</button> ') + '<button type="button" class="pick" id="qClear">表を空にする</button> 税は目安タブに合わせます。格付けはしません。</p>';

    const q = state.reviewFilter.trim();
    const shown = q ? all.filter((r) => r.company.includes(q)) : all;
    // 口コミは1行の要約（星・会社・利害・冒頭）で全件並べ、押すと本文が開く
    const revLi = (r) => '<li class="' + (r.fake ? 'fakeitem' : '') + '"><details class="rv"><summary>' + (r.fake ? BADGE.fake : BADGE.user) + ' <span class="stars" aria-label="評価' + r.stars + '">' + '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + '</span> <b>' + esc(r.company) + '</b> ' + (r.stake === 'related' ? '<b>利害あり</b>' : '利害なし') + ' <span class="rvt">' + esc(r.text) + '</span></summary>' + esc(r.date) + '・利害関係は申告<br>' + esc(r.text) + (r.fake ? '' : ' <button type="button" class="pick delrev" data-rid="' + esc(r.id) + '">削除</button>') + '</details></li>';
    h += '<h3>口コミ <span class="mini">新しい順・' + shown.length + '件・押すと全文。実際の口コミは下の「投稿」で追加（端末内）</span></h3>';
    h += '<ul class="list rev">' + shown.map(revLi).join('') + '</ul>';
    h += '<details class="revs"><summary>口コミの投稿・絞り込み</summary>';
    h += '<label class="mini">会社名で絞り込む <input id="revFilter" value="' + esc(state.reviewFilter) + '" maxlength="30"></label>';
    h += '<details><summary>口コミを投稿する（端末に保存。送信しません）</summary><form id="revForm" class="mini-form" autocomplete="off">' +
      '<label>会社名<input name="company" maxlength="40" required></label><label>工事年<input name="year" type="number" min="1990" max="2040" required></label>' +
      '<label>あなたの立場<select name="role"><option>管理組合の理事</option><option>区分所有者</option><option>管理会社の担当者</option><option>その他</option></select></label>' +
      '<label>評価<select name="stars"><option>5</option><option>4</option><option selected>3</option><option>2</option><option>1</option></select></label>' +
      '<label class="full">この会社との利害関係（必須）<select name="stake" required><option value="">選んでください</option><option value="none">ない（金銭・雇用・紹介などの関係なし）</option><option value="related">ある（関係者・紹介を受けた等）</option></select></label>' +
      '<label class="full">内容（事実と感想を分けて書く。個人名・部屋番号は書かない）<textarea name="text" rows="3" maxlength="400" required></textarea></label>' +
      '<div class="full"><button type="submit">投稿する（この端末に保存）</button></div></form></details></details>';
    h += '<details><summary>公的な確認先（許可・処分）と見積のチェック項目</summary>' + '<ul class="links list">' + L.LINKS.map((l) => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.name) + '</a><br><span class="mini">' + esc(l.note) + '</span></li>').join('') + '</ul><ul class="checklist">' + L.CHECKLIST.map((c) => '<li><label><input type="checkbox" data-id="' + c.id + '"' + (state.checks[c.id] ? ' checked' : '') + '><span>' + esc(c.text) + '<span class="basis">根拠: ' + esc(c.basis) + '</span></span></label></li>').join('') + '</ul>' +
      '<p class="mini">国交省調査では、発注方法は設計・監理方式が80.1%、責任施工方式が12.6%（' + esc(state.S.orderMethod.page) + '）。</p></details>';
    const dkey = (d) => (d.querySelector('summary') || {}).textContent || '';
    const openDs = new Set([...$('vendorOut').querySelectorAll('details')].filter((d) => d.open).map(dkey));
    $('vendorOut').innerHTML = h;
    $('vendorOut').querySelectorAll('details').forEach((d) => { if (openDs.has(dkey(d))) d.open = true; });
    $('vendorOut').querySelectorAll('.checklist input').forEach((i) => (i.onchange = () => { state.checks[i.dataset.id] = i.checked; store.set(KEY.checks, state.checks); }));
    const live = (sel, fn) => $('vendorOut').querySelectorAll(sel).forEach((el) => (el.oninput = () => {
      fn(el); store.set(KEY.quotes, state.quotes);
      const di = el.dataset.i; let pos = null; try { pos = el.selectionStart; } catch { /* number */ }
      renderVendor();
      const n = $('vendorOut').querySelector(sel + '[data-i="' + di + '"]'); n.focus(); if (pos != null) try { n.setSelectionRange(pos, pos); } catch { /* number */ }
    }));
    const freeze = (i) => { const r = state.quotes[i]; if (r.demo) { r.amount = amts[i]; r.demo = false; } };
    live('.qname', (el) => { freeze(+el.dataset.i); state.quotes[+el.dataset.i].name = el.value; });
    live('.qamt', (el) => { freeze(+el.dataset.i); state.quotes[+el.dataset.i].amount = parseFloat(el.value) || 0; });
    if ($('qDemo')) $('qDemo').onclick = () => { state.quotes = demoQuotes(); store.set(KEY.quotes, state.quotes); renderVendor(); };
    $('qClear').onclick = () => { state.quotes = [0, 1, 2].map(() => ({ name: '', amount: 0 })); store.set(KEY.quotes, state.quotes); renderVendor(); };
    const rf = $('revFilter'); if (rf) rf.oninput = () => { state.reviewFilter = rf.value; const pos = rf.selectionStart; renderVendor(); const n = $('revFilter'); n.focus(); n.setSelectionRange(pos, pos); };
    const f = $('revForm');
    f.onsubmit = (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.stake) return;
      state.reviews.unshift({ id: 'r' + Date.now(), company: d.company, date: new Date().toISOString().slice(0, 10), role: d.role, stake: d.stake, stars: +d.stars, year: +d.year, text: d.text });
      store.set(KEY.reviews, state.reviews); renderVendor();
    };
    $('vendorOut').querySelectorAll('.delrev').forEach((b) => (b.onclick = () => { state.reviews = state.reviews.filter((r) => r.id !== b.dataset.rid); store.set(KEY.reviews, state.reviews); renderVendor(); }));
  }

  // ---- 出典・限界 ----
  function renderSrc() {
    const B = state.B, S = state.S, fr = L.fillRates(B.stats);
    const fk = Object.fromEntries(fr.map((x) => [x.key, x]));
    let h = '<ul class="list srcsum"><li>' + BADGE.real + ' 建物の高さ・外形: PLATEAU（国土交通省・PLATEAU Site Policy）。修繕費の分布: 国交省調査（二次利用条件は要確認）</li><li>' + BADGE.est + ' 階数・延床・戸数・外壁面積・目安の範囲は、上の実データからの計算</li><li>' + BADGE.fake + ' 見本の会社・見積・口コミ・事例・点群</li></ul>';
    h += '<p class="mini"><b>責任</b>: ' + esc(L.RESPONSIBILITY) + '。</p>';
    h += '<details><summary>出典の詳細（リンク・ライセンス・加工）</summary><ul class="list">' +
      '<li><b>建物</b>: ' + esc(B.meta.source) + '。' + esc(B.meta.license) + '。高さ・屋根外形から外周・面積を計算。</li>' +
      '<li><b>修繕費の分布</b>: ' + esc(S.publisher) + '「' + esc(S.title) + '」（<a href="' + esc(S.reportUrl) + '" target="_blank" rel="noopener noreferrer">報告書</a>、<a href="' + esc(S.summaryUrl) + '" target="_blank" rel="noopener noreferrer">概要</a>）を転記。<b>' + esc(S.license) + '</b>。</li>' +
      '<li><b>地図</b>: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院 地理院タイル（淡色地図）</a>。</li>' +
      '<li><b>共同住宅・名称</b>: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>（ODbL。Overpass API の GET で取得し、PLATEAU の建物と位置で突き合わせて同梱）。</li>' +
      '<li><b>上空写真</b>: 国土地理院 シームレス空中写真（地理院タイルを表示時に取得）。<b>外観写真</b>: Wikimedia Commons（作者・ライセンスを各写真の下に表示。現在の採用は ' + state.photos.size + ' 棟。半径60m の検索では建物そのものの写真が見つからなかった）。</li></ul></details>';
    h += '<details><summary>限界・プライバシー・表示の区別</summary><ul class="list"><li>' + esc(L.DISCLAIMER) + '。' + esc(L.LICENSE_NOTE) + '。' + esc(S.transcribed) + '</li><li>調査は200社・818件の工事事例で、全国を代表するとは限りません。金額は税抜・共通仮設費を含みません。</li><li>個別の修繕事例・口コミの実データは未収録で、見本は架空です。実在のマンションには修繕費・実績・口コミを結び付けていません。</li><li>階数・延床・戸数は推定（階高' + state.storeyH + 'm、1戸' + L.UNIT_SQM + '㎡の仮定）。推定' + L.SCALE_MAX.floors + '階超・延床' + L.fmt(L.SCALE_MAX.tfa, 0) + '㎡超は目安を出しません。外壁面積の誤差は未検証です。</li>' +
      '<li>入力・点群は端末内だけで扱い、送信しません。事例・口コミ・見積の比較・チェックだけ localStorage に保存します。通信は地図画像と同梱データの GET だけです。</li></ul>' +
      '<p class="mini">' + BADGE.real + ' 公的データ ' + BADGE.est + ' 計算した参考値 ' + BADGE.user + ' あなたの入力 ' + BADGE.fake + ' デモ用の作り物</p></details>';
    h += '<details><summary>PLATEAU の属性の付与率（建築年・階数・延床・用途は0%）</summary><p class="mini">PLATEAU（' + esc(B.meta.ward) + '・全 ' + L.fmt(B.stats.total, 0) + ' 棟・' + B.meta.meshCount + ' メッシュ）の付与率: 高さ' + L.fmt(fk.height.pct, 0) + '%・<b>建築年' + L.fmt(fk.year.pct, 0) + '%・階数' + L.fmt(fk.floors.pct, 0) + '%・延床' + L.fmt(fk.tfa.pct, 0) + '%・用途' + L.fmt(fk.usage.pct, 0) + '%</b>（23区の ' + esc(String(B.meta.sample.meshes)) + ' メッシュ・' + L.fmt(B.meta.sample.buildings, 0) + ' 棟でも同じ）。</p>';
    h += '<table><thead><tr><th>属性</th><th>棟数</th><th>付与率</th></tr></thead><tbody>' + fr.map((x) => '<tr><td>' + x.label + '</td><td>' + L.fmt(x.n, 0) + '</td><td>' + (x.pct === 0 ? '<b>0%</b>' : n1(x.pct) + '%') + '</td></tr>').join('') + '</tbody></table></details>';
    $('srcOut').innerHTML = h;
  }

  // ---- タブ・全体 ----
  const TABS = ['est', 'sim', 'slam', 'vendor', 'src'];
  const narrow = () => window.matchMedia('(max-width: 899px)').matches;
  function setTab(t, scroll) {
    state.tab = t;
    for (const x of TABS) { const b = $('t-' + x), p = $('p-' + x); const on = x === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; p.hidden = !on; }
    renderTab();
    if (scroll && narrow()) scrollToSide();
    sumBarVis();
  }
  function renderTab() {
    if (state.tab === 'est') { renderSelCard(); renderEst(); }
    else if (state.tab === 'sim') renderSim();
    else if (state.tab === 'slam') renderSlam();
    else if (state.tab === 'vendor') renderVendor();
    else renderSrc();
  }
  function renderAll() {
    renderSelCard();
    renderEst();
    if (state.tab !== 'est') renderTab();
  }
  function bindUi() {
    $('disclaimer').textContent = '目安は適正な金額であることを保証しません。';
    $('toSources').onclick = (e) => { e.preventDefault(); setTab('src', true); $('t-src').focus(); };
    $('pickExample').onclick = pickExample;
    setTimeout(() => { $('mapHint').hidden = true; }, 8000);
    $('side').addEventListener('focusin', (e) => { if (narrow() && e.target.matches('input[type=number]')) document.body.classList.add('typing'); });
    $('side').addEventListener('focusout', () => document.body.classList.remove('typing'));
    $('mapToggle').onclick = () => mapMin(!document.body.classList.contains('mapmin'));
    $('selLine').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('selLine').click(); } };
    for (const t of TABS) {
      $('t-' + t).onclick = () => setTab(t, true);
      $('t-' + t).onkeydown = (e) => {
        const i = TABS.indexOf(t); let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
        if (j >= 0) { e.preventDefault(); setTab(TABS[j]); $('t-' + TABS[j]).focus(); }
      };
    }
    // 数値欄は押したら全選択（推定値の後ろに打ち足して桁を誤らないように）
    document.addEventListener('focusin', (e) => { const t = e.target; if (t.matches && t.matches('#form input[type=number], #moreCond input[type=number], .qcheck input')) setTimeout(() => { try { t.select(); } catch { /* 選択できない欄 */ } }, 0); });
    for (const id of ['inUnits', 'inTfa', 'inAge', 'inFloors', 'inQuote']) $(id).addEventListener('input', () => {
      if (id === 'inUnits' && est.units) { est.units = false; $('unitsTag').hidden = true; }
      if (id === 'inTfa') {
        if (est.tfa) { est.tfa = false; $('tfaTag').hidden = true; }
        if (est.units && num('inTfa')) $('inUnits').value = L.unitsFromTfa(num('inTfa')); // 戸数が推定のままなら延床に合わせる
      }
      if (id === 'inFloors' || id === 'inTfa') { refreshSim(); schedule(); }
      renderEst(); if (state.tab === 'sim') renderSim();
    });
    $('inTax').onchange = renderEst;
    document.querySelectorAll('input[name=count]').forEach((r) => (r.onchange = () => { renderEst(); if (state.tab === 'sim') renderSim(); }));
    $('selMin').onchange = (e) => { state.minFloors = +e.target.value; refilter(); renderAll(); };
    $('storeyH').onchange = (e) => {
      const v = parseFloat(e.target.value);
      if (v >= 2 && v <= 5) { state.storeyH = v; reenrich(); if (state.sel) selectBuilding(state.sel, false); else renderAll(); }
    };
    $('selTown').onchange = (e) => { state.town = e.target.value; refilter(); fitTo(boundsOfList(state.vis.length ? state.vis : state.list), state.town ? 30 : 16); renderAll(); schedule(); };
    const towns = {}; for (const b of state.list) { const t = baseTown(b.town); towns[t] = (towns[t] || 0) + 1; }
    $('selTown').innerHTML = '<option value="">' + esc(state.B.meta.ward) + '全体</option>' + Object.keys(towns).sort((a, b) => a.localeCompare(b, 'ja')).map((t) => '<option value="' + esc(t) + '">' + esc(t) + '（' + towns[t] + '）</option>').join('');
    $('mapAttr').innerHTML = '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>｜建物: PLATEAU（国土交通省）｜共同住宅: © OpenStreetMap contributors｜空中写真: 国土地理院';
    $('mapAttr').style.pointerEvents = 'auto';
  }

  async function init() {
    try {
      const get = async (f) => { const r = await fetch(DATA + f); if (!r.ok) throw new Error(f + ' を読めません（' + r.status + '）'); return r.json(); };
      const [B, S, DEMO] = await Promise.all([get('buildings.json'), get('mlit-survey.json'), get('demo.json')]);
      // 突き合わせ結果と外観写真は、読めなくても本体は動く（似た建物が出ないだけ）
      try { const O = await get('osm.json'); state.osmMeta = O.meta; for (const it of O.items) state.osm.set(it.id, it); } catch { /* 無し */ }
      try { const P = await get('photos.json'); state.photoMeta = P.meta; for (const it of P.items) state.photos.set(it.id, it); } catch { /* 無し */ }
      if (!L.validateBuildings(B)) throw new Error('建物データの形式が不正です');
      state.B = B; state.S = S; state.DEMO = DEMO;
    } catch (e) { const el = $('loaderr'); el.hidden = false; el.textContent = 'データを読めませんでした: ' + e.message; return; }
    state.cases = store.get(KEY.cases, []); state.reviews = store.get(KEY.reviews, []); state.checks = store.get(KEY.checks, {});
    const qs = store.get(KEY.quotes, null);
    state.quotes = Array.isArray(qs) && qs.length === 3 ? qs : demoQuotes();
    prepare(); bindUi(); bindMap();
    const fit0 = () => { fitTo(boundsOfList(state.list), 16); if (narrow()) state.view.z += 1; schedule(); };
    fit0();
    renderAll(); setTab('est'); schedule();
    requestAnimationFrame(fit0);
    window.__rp = { state, L, selectBuilding, setTab, setCloud, draw, pickExample };
  }
  init();
})();
