/* 大規模修繕プラットフォーム: 画面。ネットワークは GET のみ（国土地理院のタイル、同梱データ data/*.json）。
 * 利用者の入力（条件・見積・事例・口コミ・点群）は端末内だけで扱い、送信しない。事例・口コミ・チェックだけ localStorage に保存する。 */
(function () {
  'use strict';
  const L = window.Lib;
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/pale/';
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
    tab: 'est', cloud: null, cloudInfo: null, cloudSynthetic: false, cloudName: '', cloudUp: 'z', cloudApplied: false, cloudErr: '',
    cases: [], reviews: [], checks: {}, reviewFilter: '', simSort: 'near', wallQty: 0, wallUnit: 0, view: { lon: 139.81, lat: 35.71, z: 13 }, fitZ: 13,
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
      return e;
    });
    refilter();
  }
  function reenrich() {
    for (const e of state.list) { const f = L.enrich(e, state.storeyH); e.floors = f.floors; e.tfa = f.tfa; e.wall = f.wall; e.blocked = L.scaleCheck(e).blocked; }
    if (state.sel) state.sel = state.list.find((b) => b.id === state.sel.id) || null;
    refilter();
  }
  function refilter() {
    state.vis = state.list.filter((b) => b.floors >= state.minFloors && (!state.town || baseTown(b.town) === state.town));
    $('mapNote').innerHTML = BADGE.real + ' PLATEAU <b>' + L.fmt(state.vis.length, 0) + '棟</b>。用途不明でマンションとは限りません。灰色は対象外';
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
    if (jump && narrow()) { if (state.tab !== 'est') setTab('est'); scrollToSide(); }
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
    let h = '<div class="rangebar" role="img" aria-label="目安の範囲 ' + L.fmtMan(r.low) + 'から' + L.fmtMan(r.high) + '、中央値 ' + L.fmtMan(r.mid) + ms.map((m) => '、' + m.label + ' ' + L.fmtMan(m.v)).join('') + '">' +
      '<div class="rng" style="left:' + p(r.low) + '%;width:' + (p(r.high) - p(r.low)) + '%"></div><div class="mid" style="left:' + p(r.mid) + '%"></div>' +
      '<span class="q" style="left:' + p(r.low) + '%">' + L.fmt(r.low, 0) + '</span><span class="q" style="left:' + p(r.high) + '%">' + L.fmt(r.high, 0) + '</span>';
    ms.forEach((m, i) => {
      const over = m.v > top;
      h += '<div class="you' + (i ? ' alt' : '') + '" style="left:' + (over ? 99 : p(m.v)) + '%"><span>' + esc(m.label) + (over ? '→' : '') + '</span></div>';
    });
    return h + '</div>';
  }
  const bandShort = { 'above-q3': '高め（上位25%）', 'median-q3': 'やや高め', 'q1-median': 'やや安め', 'below-q1': '安め（下位25%）' };

  // ---- 表示: 選んだ建物 ----
  function renderSelCard() {
    const b = state.sel, el = $('selCard');
    if (!b) { el.innerHTML = '<b>地図で建物を押すか、「例の建物を選ぶ」を押してください。</b>'; return; }
    const sc = state.scale || L.scaleCheck(b);
    const name = b.name && !sc.blocked ? ' ' + esc(b.name) + '<span class="mini">（PLATEAU の名称）</span>' : '';
    const cw = state.cloudInfo && cloudWhole(state.cloudInfo);
    const cloud = state.cloudApplied && cw ? '<br>点群からの概算（建物全体に補正） <b>' + L.fmt(cw, 0) + '㎡</b>' + (state.cloudSynthetic ? ' ' + BADGE.fake + '合成の点群' : '') : '';
    el.innerHTML = '<b>' + esc(state.B.meta.ward) + esc(b.town) + '</b>' + name + ' ' + BADGE.est + ' <span class="mini">共同住宅か不明</span><br>' +
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
      h += '<p class="big">修繕費の目安 <b>' + L.fmtMan(g.low) + '〜' + L.fmtMan(g.high) + '</b><span class="sub">税抜・国交省調査の中位50%（' + esc(set.label) + '）' + (g.key === 'perUnit' && est.units ? '・<b class="guess">推定' + L.fmt(g.basis, 0) + '戸・用途不明の建物での試算</b>' : '') + '</span></p>';
      h += rangeBar(g, r.quoteEx ? [{ v: r.quoteEx, label: '見積' }] : []);
      const pp = r.primaryPos;
      const guessU = g.key === 'perUnit' && est.units;
      if (pp) h += '<p class="concl' + (pp.band === 'above-q3' ? ' hi' : '') + '">' + (guessU ? '<span class="tag">仮の判定</span> ' : '') + '見積 ' + L.fmtMan(r.quoteEx) + (inp.quoteTaxIn ? '（税抜換算）' : '') + ' → <b>' + pp.text + '</b>・' + pp.rel + (guessU ? '<span class="mini">（戸数を直すと確定）</span>' : '') + '</p>';
      else if (!inp.quote) h += '<p class="mini">↑ 手元の見積を入れると、帯に印が出ます。</p>';
    }
    if (r.conflict) {
      const u2 = L.unitsFromTfa(inp.tfa), t2 = Math.round((inp.units * L.UNIT_SQM) / 10) * 10;
      h += '<p class="err">戸数と延床が合っていません（1戸あたり' + L.fmt(r.conflict.per, 0) + '㎡）。延床' + L.fmt(inp.tfa, 0) + '㎡なら約' + u2 + '戸です。<br><button type="button" class="pick" data-fix="units" data-v="' + u2 + '">戸数を' + u2 + '戸にする</button> <button type="button" class="pick" data-fix="tfa" data-v="' + t2 + '">延床を' + L.fmt(t2, 0) + '㎡にする</button></p>';
    }
    h += '</div>';
    $('estOut').innerHTML = h;
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
  function simRange(b) {
    const set = state.S.byCount[inputs().count] || state.S.byCount['1'];
    return { low: set.perSqm.q1 * b.tfa, high: set.perSqm.q3 * b.tfa };
  }
  function simRow(x) {
    const g = simRange(x.b), i = state.simRank.get(x.b.id);
    return '<tr title="' + esc(x.b.town) + '"><td><button type="button" class="pick" data-id="' + esc(x.b.id) + '" aria-label="' + i + 'を選ぶ">' + i + '</button></td><td>' + x.b.floors + '</td><td>' + L.fmt(x.b.tfa, 0) + '</td><td>' + L.fmt(x.b.wall, 0) + '</td><td>' + (x.km != null ? n1(x.km) : '—') + '</td><td class="calc">' + L.fmt(g.low, 0) + '〜' + L.fmt(g.high, 0) + '</td></tr>';
  }
  function bindPicks(el) { el.querySelectorAll('.pick[data-id]').forEach((b) => (b.onclick = () => { const bd = state.list.find((x) => x.id === b.dataset.id); if (bd) selectBuilding(bd, true); })); }
  function renderSimMini() {
    const el = $('simMini');
    if (!state.simList || !state.simList.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<a href="#" id="toSim">規模が近い建物' + state.simList.length + '棟（地図の緑の番号）を比べる →</a>';
    $('toSim').onclick = (e) => { e.preventDefault(); setTab('sim', true); };
  }

  // ---- スマホ: 画面下の要約バー ----
  function renderSumBar() {
    const r = state.lastEst, el = $('selLine');
    if (!r || !r.primary) el.innerHTML = state.sel ? '建物を選びました。戸数・見積を入れてください ▲' : '建物を押すと、修繕費の目安が出ます';
    else el.innerHTML = '目安 <b>' + L.fmt(r.primary.low, 0) + '〜' + L.fmtMan(r.primary.high) + '</b>' + (r.primaryPos ? '・見積は<b>' + bandShort[r.primaryPos.band] + '</b>' : '・見積を入れる') + (r.conflict ? '・<b>戸数と延床が合っていません</b>' : '') + ' <span class="go">▲ 開く</span>';
    el.onclick = () => { setTab('est'); scrollToSide(); };
    sumBarVis();
  }
  /** スマホ: 結果（目安）が画面に見えている間は要約バーを隠す */
  function sumBarVis() {
    const el = $('selLine');
    if (!narrow()) return;
    const r = $('estOut').getBoundingClientRect(), mb = $('mapcol').getBoundingClientRect().bottom;
    const seen = state.tab === 'est' && r.height > 0 && r.top < innerHeight - 60 && r.bottom > mb + 30;
    el.classList.toggle('off', seen);
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
    state.simList = t ? L.similar(state.list, t, 8, state.storeyH) : [];
    state.simIds = new Set(state.simList.map((x) => x.b.id));
    state.simRank = new Map(state.simList.map((x, i) => [x.b.id, i + 1]));
  }
  function renderSim() {
    const t = simTarget();
    let h = '<h2>規模が似た建物（推定階数±2階） ' + BADGE.est + '</h2>';
    h += '<p class="concl">修繕実績・築年は未収録（公開された個別事例がない）。表は規模と試算の比較。<b>実額は下に手元の事例を足して比べます。</b></p>';
    if (!t) h += '<p class="mini">建物を選ぶと、規模の近い建物を地図に番号で示します。</p>';
    else if (!state.simList.length) h += '<p>条件に合う建物がありません。</p>';
    else {
      const key = { near: null, floors: (x) => -x.b.floors, km: (x) => (x.km == null ? 1e9 : x.km), wall: (x) => -x.b.wall }[state.simSort];
      const rows = key ? state.simList.slice().sort((a, b) => key(a) - key(b)) : state.simList;
      const sb = (k, label) => '<button type="button" class="pick' + (state.simSort === k ? ' on' : '') + '" data-sort="' + k + '" aria-pressed="' + (state.simSort === k) + '">' + label + '</button>';
      h += '<p class="mini">並べ替え ' + sb('near', '規模が近い') + sb('floors', '階数') + sb('km', '距離') + sb('wall', '外壁') + '</p>';
      h += '<table class="simt"><thead><tr><th>地図</th><th>階</th><th>延床㎡</th><th>外壁㎡</th><th>km</th><th class="calc">規模からの試算（万円）<br>実績ではない</th></tr></thead><tbody>' + rows.map(simRow).join('') + '</tbody></table>';
      h += '<p class="mini">試算は延床×㎡あたりの中位50%。</p>';
    }
    $('simOut').innerHTML = h;
    bindPicks($('simOut'));
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
      return '<li class="' + (c.fake ? 'fakeitem' : '') + '">' + (c.fake ? BADGE.fake : BADGE.user) + ' <b>' + esc(c.name) + '</b> ' +
        esc(String(c.units)) + '戸・' + L.fmt(c.tfa, 0) + '㎡・' + (c.age ? '築' + c.age + '年・' : '') + (c.year ? c.year + '年・' : '') + (c.count >= 3 ? '3回目以上' : c.count + '回目') + '・総額' + L.fmtMan(c.total) + '（戸あたり' + pu.rel + '）' +
        (c.fake ? '' : ' <button type="button" class="pick delcase" data-cid="' + esc(c.id) + '">削除</button>') + '</li>';
    };
    const mine = list.filter((c) => !c.fake), demo = list.filter((c) => c.fake);
    let h = '<h3>手元の修繕事例を足して比べる <span class="mini">端末内のみ</span></h3>';
    h += '<form id="caseForm" class="mini-form case3" autocomplete="off">' +
      '<label>戸数<input name="units" type="number" min="1" required></label><label>延床㎡<input name="tfa" type="number" min="1" required></label>' +
      '<label>総額（万円・税抜）<input name="total" type="number" min="1" required></label>' +
      '<label>工事回数<select name="count"><option value="1">1回目</option><option value="2">2回目</option><option value="3">3回目以上</option></select></label>' +
      '<label>工事年<input name="year" type="number" min="1990" max="2040"></label>' +
      '<div class="sub2"><button type="submit">事例を足す</button></div>' +
      '<details class="full addcase"><summary>任意の項目・書き出し</summary><div class="mini-form">' +
      '<label>建物名<input name="name" maxlength="40"></label><label>町名<input name="town" maxlength="20"></label>' +
      '<label>築年数（工事時）<input name="age" type="number" min="0" max="100"></label>' +
      '<label>発注方式<select name="method"><option value="">不明</option><option>設計・監理方式</option><option>責任施工方式</option><option>CM方式</option><option>その他</option></select></label>' +
      '<label class="full">メモ（個人名・部屋番号は書かない）<input name="memo" maxlength="120"></label>' +
      '<div class="full"><button type="button" class="ghost" id="exportCases">JSONで書き出す</button></div></div></details></form>';
    if (mine.length) h += '<ul class="list">' + mine.map(caseLi).join('') + '</ul>';
    h += '<details class="cases"><summary>架空の見本3件 ' + BADGE.fake + '</summary><ul class="list">' + demo.map(caseLi).join('') + '</ul></details>';
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
    h += '<p class="warnline">スマホ LiDAR は1〜5m程度まで。高層の外壁全体は測れません。</p>';
    if (state.cloudErr) h += '<p class="err">' + esc(state.cloudErr) + '</p>';
    if (c) {
      const fake = state.cloudSynthetic ? ' ' + BADGE.fake : '';
      h += '<p class="mini">' + (state.cloudSynthetic ? BADGE.fake + ' 操作の練習用の合成データ（<b>実測ではありません</b>）' : BADGE.user + ' ' + esc(state.cloudName)) + '</p>';
      if (sb) {
        const lowH = Math.min(c.height, sb.h), mapLow = sb.per * lowH, whole = cloudWhole(c);
        const d = ((whole - sb.wall) / sb.wall) * 100, ad = L.fmt(Math.abs(d), 0);
        const why = Math.abs(d) < 10 ? '地図とほぼ同じ（差' + ad + '%）' : d < 0 ? '地図より' + ad + '%小さい＝測れていない面がある可能性' : '地図より' + ad + '%大きい＝付属物や周りも測った可能性';
        const useV = state.cloudSynthetic ? sb.wall : whole;
        state.wallRef = useV;
        h += '<p class="concl">判断に使う外壁面積 <b>' + L.fmt(useV, 0) + '㎡</b>' + (state.cloudSynthetic ? '（地図の値。見本は練習用）' : '（点群・建物全体）') + '<br><span class="mini">点群は' + why + '</span></p>';
        const W = state.cloudSynthetic ? (x) => x : (x) => '<b>' + x + '</b>';
        h += '<div class="slamrow"><table><thead><tr><th>外壁面積</th><th>測れた範囲<br><span class="mini">高さ' + n1(lowH) + 'm</span></th><th>建物全体<br><span class="mini">' + n1(sb.h) + 'm</span></th></tr></thead><tbody>' +
          '<tr><td>点群' + fake + '</td><td>' + L.fmt(c.wall, 0) + '㎡</td><td>' + W(L.fmt(whole, 0) + '㎡') + '</td></tr>' +
          '<tr><td>地図</td><td>' + L.fmt(mapLow, 0) + '㎡</td><td>' + L.fmt(sb.wall, 0) + '㎡</td></tr></tbody></table>' +
          '<canvas id="plan" width="120" height="84" role="img" aria-label="点群を真上から見た図（青い点）と外周（赤線）"></canvas></div>';
        h += '<div class="qcheck"><b>見積書と照らす</b> <label>外壁数量 <input id="wQty" type="number" min="0" inputmode="numeric" value="' + (state.wallQty || '') + '"><span class="u">㎡</span></label> ' +
          '<label>単価 <input id="wUnit" type="number" min="0" inputmode="numeric" value="' + (state.wallUnit || '') + '"><span class="u">円/㎡</span></label><div id="wOut"></div></div>';
        if (!state.cloudSynthetic) h += unitLine(whole);
      } else {
        h += '<p class="big">外壁面積の概算 <b>' + L.fmt(c.wall, 0) + '㎡</b>' + fake + ' <span class="mini">壁の長さ' + n1(c.wallLen) + 'm×高さ' + n1(c.height) + 'm</span></p><p class="mini">地図で建物を選ぶと、建物全体との比較が出ます。</p><canvas id="plan" width="120" height="84" role="img" aria-label="点群を真上から見た図（青い点）と外周（赤線）"></canvas>';
      }
      if (c.width < 10 && c.depth < 10) h += '<p class="warnline">範囲が10m未満です。建物の一部だけの可能性が高いです。</p>';
      if (c.slender) h += '<p class="warnline">細長いので壁1面とみなしました。</p>';
      h += '<p><button type="button" id="cloudApply">この概算を建物の欄に出す</button></p>';
    } else {
      h += '<p class="mini">低層部の外壁を一周測った点群から、外壁面積を概算し、地図の値・見積書の数量と比べます。</p>';
    }
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
    if (c) { drawPlan(); $('cloudApply').onclick = () => { state.cloudApplied = true; renderSelCard(); setTab('est'); }; }
  }
  /** 見積書の外壁数量・単価（利用者が見積書から入れる）を、使う値と照らす。単価は作らない */
  function renderWallCheck() {
    const el = $('wOut'), ref = state.wallRef, q = state.wallQty, u = state.wallUnit;
    if (!el || !ref) return;
    let h = '';
    if (q) {
      const d = ((q - ref) / ref) * 100;
      h += '<p class="pos">見積書の数量は使う値より <b>' + (d >= 0 ? '+' : '') + L.fmt(d, 0) + '%</b><span class="mini">（差の理由＝開口部・付属部の扱いなどを業者に確認）</span></p>';
    }
    if (u) h += '<p class="mini">使う値×見積書の単価 = <b>' + L.fmtMan((ref * u) / 10000) + '</b>' + (q ? '（見積書の数量では ' + L.fmtMan((q * u) / 10000) + '）' : '') + '</p>';
    if (!q && !u) h = '<p class="mini">見積書の外壁数量（㎡）を入れると差が％で出ます。</p>';
    el.innerHTML = h;
  }
  /** 見本: 建物を選んでいれば、その外形を低層部（5m＝スマホ LiDAR の検出範囲の上限か建物の高さの低い方）まで測ったとみなす。選んでいなければ箱 */
  function sampleCloud() { return state.sel ? L.synthCloudFor(state.sel.ring, Math.min(5, state.sel.h)) : L.synthCloud(); }
  /** 見積の外壁関係（調査の平均比率）÷外壁面積。見本（合成）のときは出さない */
  function unitLine(wall) {
    const S = state.S, q = state.lastEst && state.lastEst.quoteEx;
    const share = (S.breakdown.total[0].pct * S.breakdown.groups['外壁関係']) / 100;
    if (state.cloudSynthetic) return '<p class="mini">見積の外壁単価: <span class="muted">見本のため出しません</span></p>';
    if (!q) return '<p class="mini">見積を入れると、外壁関係の単価の参考値が出ます。</p>';
    return '<p class="mini">見積の外壁関係（総額の約' + n1(share) + '%・' + esc(S.breakdown.page) + '）÷建物全体 = <b>' + L.fmt(((q * share) / 100 / wall) * 10000, 0) + '円/㎡</b>（参考値）</p>';
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
    try { state.cloudInfo = L.analyzeCloud(cloud, state.cloudUp); state.cloud = cloud; state.cloudName = name; state.cloudSynthetic = synthetic; state.cloudApplied = false; }
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
    h += '<table class="qt"><thead><tr><th></th><th>会社名</th><th>見積（万円・' + (inp.quoteTaxIn ? '税込' : '税抜') + '）</th><th>目安の中の位置</th><th>口コミ</th></tr></thead><tbody>';
    // 目安タブで入れた見積を「自分の見積」として先頭に並べる（入力の往復をなくす）
    const mine = inp.quote > 0 ? L.compareQuotes([{ name: '自分の見積', amount: inp.quote, taxIn: inp.quoteTaxIn }], inp, state.S)[0] : null;
    if (inp.quote > 0) h += '<tr class="minerow"><td><b>自</b></td><td>目安タブの見積</td><td>' + L.fmt(inp.quote, 0) + '</td><td>' + (mine && mine.pos ? '<b class="band ' + mine.pos.band + '">' + bandShort[mine.pos.band] + '</b>' : '—') + '</td><td>—</td></tr>';
    rows.forEach((r, i) => {
      const c = per[i], rc = L.reviewCounts(all, r.name);
      h += '<tr' + (r.demo ? ' class="demorow"' : '') + '><td><b>' + LETTER[i] + '</b></td><td><input class="qname" data-i="' + i + '" value="' + esc(r.name) + '" maxlength="20" aria-label="会社' + LETTER[i] + 'の名前"></td><td><input class="qamt" data-i="' + i + '" type="number" min="0" inputmode="numeric" value="' + (amts[i] || '') + '" aria-label="会社' + LETTER[i] + 'の見積（万円）"></td><td>' +
        (c && c.pos ? (r.demo ? '<span class="band demo">見本: ' + bandShort[c.pos.band] + '</span>' : '<b class="band ' + c.pos.band + '">' + bandShort[c.pos.band] + '</b>') : amts[i] ? '戸数を入れてください' : '—') + '</td><td>' + (r.name ? (rc.n ? rc.n + '件' + (rc.related ? '（利害あり' + rc.related + '）' : '') : '該当なし') : '—') + '</td></tr>';
    });
    h += '</tbody></table>';
    if (base.primary) h += rangeBar(base.primary, (mine ? [{ v: mine.ex, label: '自' }] : []).concat(per.map((c, i) => (c ? { v: c.ex, label: LETTER[i] } : null)).filter(Boolean)));
    else h += '<p class="mini">建物を選ぶか戸数を入れると、各社の位置が同じ帯に並びます。</p>';
    h += '<p class="mini">' + (anyDemo ? '' : '<button type="button" class="pick" id="qDemo">見本の3社に戻す</button> ') + '<button type="button" class="pick" id="qClear">表を空にする</button> 税は目安タブに合わせます。格付けはしません。</p>';

    const q = state.reviewFilter.trim();
    const shown = q ? all.filter((r) => r.company.includes(q)) : all;
    // 口コミは1行の要約（星・会社・利害・冒頭）で全件並べ、押すと本文が開く
    const revLi = (r) => '<li class="' + (r.fake ? 'fakeitem' : '') + '"><details class="rv"><summary>' + (r.fake ? BADGE.fake : BADGE.user) + ' <span class="stars" aria-label="評価' + r.stars + '">' + '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + '</span> <b>' + esc(r.company) + '</b> ' + (r.stake === 'related' ? '<b>利害あり</b>' : '利害なし') + ' <span class="rvt">' + esc(r.text) + '</span></summary>' + esc(r.date) + '・利害関係は申告<br>' + esc(r.text) + (r.fake ? '' : ' <button type="button" class="pick delrev" data-rid="' + esc(r.id) + '">削除</button>') + '</details></li>';
    h += '<h3>口コミ <span class="mini">新しい順・' + shown.length + '件・押すと全文</span></h3>';
    h += '<ul class="list rev">' + shown.map(revLi).join('') + '</ul>';
    h += '<details class="revs"><summary>絞り込み・投稿</summary>';
    h += '<label class="mini">会社名で絞り込む <input id="revFilter" value="' + esc(state.reviewFilter) + '" maxlength="30"></label>';
    h += '<details><summary>口コミを投稿する（端末に保存。送信しません）</summary><form id="revForm" class="mini-form" autocomplete="off">' +
      '<label>会社名<input name="company" maxlength="40" required></label><label>工事年<input name="year" type="number" min="1990" max="2040" required></label>' +
      '<label>あなたの立場<select name="role"><option>管理組合の理事</option><option>区分所有者</option><option>管理会社の担当者</option><option>その他</option></select></label>' +
      '<label>評価<select name="stars"><option>5</option><option>4</option><option selected>3</option><option>2</option><option>1</option></select></label>' +
      '<label class="full">この会社との利害関係（必須）<select name="stake" required><option value="">選んでください</option><option value="none">ない（金銭・雇用・紹介などの関係なし）</option><option value="related">ある（関係者・紹介を受けた等）</option></select></label>' +
      '<label class="full">内容（事実と感想を分けて書く。個人名・部屋番号は書かない）<textarea name="text" rows="3" maxlength="400" required></textarea></label>' +
      '<div class="full"><button type="submit">投稿する（この端末に保存）</button></div></form></details></details>';
    h += '<details><summary>見積のチェック項目・公的な確認先</summary><ul class="checklist">' + L.CHECKLIST.map((c) => '<li><label><input type="checkbox" data-id="' + c.id + '"' + (state.checks[c.id] ? ' checked' : '') + '><span>' + esc(c.text) + '<span class="basis">根拠: ' + esc(c.basis) + '</span></span></label></li>').join('') + '</ul>' +
      '<ul class="links list">' + L.LINKS.map((l) => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.name) + '</a><br><span class="mini">' + esc(l.note) + '</span></li>').join('') + '</ul>' +
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
    let h = '<ul class="list srcsum"><li>' + BADGE.real + ' 建物の高さ・外形（PLATEAU）、修繕費の分布（国交省調査）</li><li>' + BADGE.est + ' 階数・延床・戸数・外壁面積・目安の範囲（上の実データからの計算）</li><li>' + BADGE.fake + ' 見本の会社・見積・口コミ・事例・点群</li></ul>';
    h += '<h2>出典・加工・責任</h2><ul class="list">' +
      '<li>' + BADGE.real + ' <b>建物</b>: ' + esc(B.meta.source) + '。' + esc(B.meta.license) + '。高さ・屋根外形から外周・面積を計算。</li>' +
      '<li>' + BADGE.real + ' <b>修繕費の分布</b>: ' + esc(S.publisher) + '「' + esc(S.title) + '」（<a href="' + esc(S.reportUrl) + '" target="_blank" rel="noopener noreferrer">報告書</a>、<a href="' + esc(S.summaryUrl) + '" target="_blank" rel="noopener noreferrer">概要</a>）を転記。<b>' + esc(S.license) + '</b>。</li>' +
      '<li><b>地図</b>: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院 地理院タイル（淡色地図）</a>。<b>責任</b>: ' + esc(L.RESPONSIBILITY) + '。</li></ul>';
    h += '<details><summary>限界・プライバシー・表示の区別</summary><ul class="list"><li>' + esc(L.DISCLAIMER) + '。' + esc(L.LICENSE_NOTE) + '。' + esc(S.transcribed) + '</li><li>調査は200社・818件の工事事例で、全国を代表するとは限りません。金額は税抜・共通仮設費を含みません。</li><li>個別の修繕事例・口コミの実データは未収録で、見本は架空です。</li><li>階数・延床・戸数は推定（階高' + state.storeyH + 'm、1戸' + L.UNIT_SQM + '㎡の仮定）。推定' + L.SCALE_MAX.floors + '階超・延床' + L.fmt(L.SCALE_MAX.tfa, 0) + '㎡超は目安を出しません。外壁面積の誤差は未検証です。</li>' +
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
    window.addEventListener('scroll', sumBarVis, { passive: true }); window.addEventListener('resize', sumBarVis);
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
    $('mapAttr').innerHTML = '地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院</a>｜建物: PLATEAU（国土交通省）';
    $('mapAttr').style.pointerEvents = 'auto';
  }

  async function init() {
    try {
      const get = async (f) => { const r = await fetch(DATA + f); if (!r.ok) throw new Error(f + ' を読めません（' + r.status + '）'); return r.json(); };
      const [B, S, DEMO] = await Promise.all([get('buildings.json'), get('mlit-survey.json'), get('demo.json')]);
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
