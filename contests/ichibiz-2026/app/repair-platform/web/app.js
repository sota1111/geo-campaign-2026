/* 大規模修繕プラットフォーム: 画面。ネットワークは GET のみ（国土地理院のタイル、同梱データ data/*.json）。
 * 利用者の入力（条件・見積・事例・口コミ・点群）は端末内だけで扱い、送信しない。事例・口コミ・チェックだけ localStorage に保存する。 */
(function () {
  'use strict';
  const L = window.Lib;
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/pale/';
  const DATA = 'data/';
  const KEY = { cases: 'rp1-cases', reviews: 'rp1-reviews', checks: 'rp1-checks' };
  const COLORS = ['#f2c14e', '#f08a24', '#d1495b', '#7a2e8e'];
  const colorOf = (f) => (f >= 15 ? COLORS[3] : f >= 10 ? COLORS[2] : f >= 6 ? COLORS[1] : COLORS[0]);
  const B_ = (kind, text) => '<span class="b ' + kind + '">' + text + '</span>';
  const BADGE = { real: B_('real', '実データ'), est: B_('est', '推定'), user: B_('user', '利用者入力'), fake: B_('fake', '架空') };
  const n2 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(2));
  const n1 = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(1));
  const esc = L.esc;

  const state = {
    B: null, S: null, DEMO: null, list: [], vis: [], storeyH: L.DEFAULT_STOREY_H, minFloors: 0, town: '', sel: null, simIds: new Set(),
    tab: 'est', cloud: null, cloudInfo: null, cloudSynthetic: false, cloudName: '', cloudUp: 'z', cloudApplied: false, cloudErr: '',
    cases: [], reviews: [], checks: {}, reviewFilter: '', view: { lon: 139.81, lat: 35.71, z: 13 }, fitZ: 13,
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
      ctx.fillStyle = colorOf(b.floors); ctx.globalAlpha = 0.82; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
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
      ringPath(b, c, k, w, h); ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.lineWidth = 2.2; ctx.strokeStyle = '#d6336c'; ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#d6336c'; ctx.fill(); ctx.globalAlpha = 1;
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
        if (b) selectBuilding(b, false);
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
  function prepare() {
    state.list = state.B.buildings.map((b) => {
      const e = L.enrich(b, state.storeyH);
      const ws = e.ring.map((p) => world(p[0], p[1]));
      e.w = ws.flatMap((p) => [p.x, p.y]);
      e.bb = [Math.min(...ws.map((p) => p.x)), Math.min(...ws.map((p) => p.y)), Math.max(...ws.map((p) => p.x)), Math.max(...ws.map((p) => p.y))];
      e.cw = world(e.lon, e.lat);
      return e;
    });
    refilter();
  }
  function reenrich() {
    for (const e of state.list) { const f = L.enrich(e, state.storeyH); e.floors = f.floors; e.tfa = f.tfa; e.wall = f.wall; }
    if (state.sel) state.sel = state.list.find((b) => b.id === state.sel.id) || null;
    refilter();
  }
  function refilter() {
    state.vis = state.list.filter((b) => b.floors >= state.minFloors && (!state.town || b.town === state.town));
    $('mapNote').innerHTML = BADGE.real + ' PLATEAU（国交省）の' + esc(state.B.meta.ward) + 'の建物のうち、高さ' + state.B.meta.minHeight + 'm以上・屋根面積' + state.B.meta.minArea + '㎡以上の <b>' + L.fmt(state.vis.length, 0) + '棟</b>（共同住宅「らしい」規模。<b>用途の属性は入っていない</b>ので、共同住宅とは限りません）。色は ' + BADGE.est + ' 階数（高さ÷階高の仮置き）';
    refreshSim(); schedule();
  }

  // ---- 入力 ----
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : 0; };
  const inputs = () => ({ units: num('inUnits'), tfa: num('inTfa'), age: num('inAge'), floors: num('inFloors'), count: (document.querySelector('input[name=count]:checked') || {}).value || '1', quote: num('inQuote'), quoteTaxIn: $('inTax').value === 'in' });
  function selectBuilding(b, pan) {
    state.sel = b;
    $('inFloors').value = b.floors; $('inTfa').value = Math.round(b.tfa / 10) * 10;
    if (pan) { state.view.lon = b.lon; state.view.lat = b.lat; if (state.view.z < 16) state.view.z = 16; }
    state.cloudApplied = false;
    refreshSim(); renderAll(); schedule();
  }

  // ---- 表示: 選んだ建物 ----
  function renderSelCard() {
    const b = state.sel, el = $('selCard');
    if (!b) { el.innerHTML = '<b>建物を選んでください</b>。地図で色のついた建物を押すか、町名・規模で絞って探します。選ばずに、下の条件を直接入れてもかまいません。<div class="mini">建築年・階数・延床・用途は PLATEAU の東京23区のデータに入っていない（付与率0%）ので、階数・延床は高さと屋根の形からの推定です。</div>'; return; }
    const cloud = state.cloudApplied && state.cloudInfo ? '<dt>点群からの概算</dt><dd>' + L.fmt(state.cloudInfo.wall, 0) + '㎡ ' + BADGE.est + (state.cloudSynthetic ? ' ' + BADGE.fake + '合成の点群' : ' ' + BADGE.user) + ' <span class="mini">読めた範囲だけの値</span></dd>' : '';
    el.innerHTML = '<b>選んだ建物</b> ' + esc(state.B.meta.ward) + esc(b.town) + (b.name ? ' ' + esc(b.name) : '') + ' ' + BADGE.real +
      '<dl class="kv">' +
      '<dt>建物ID</dt><dd>' + esc(b.id) + '（PLATEAU）</dd>' +
      '<dt>高さ</dt><dd>' + n1(b.h) + ' m ' + BADGE.real + ' <span class="mini">計測高さ</span></dd>' +
      '<dt>屋根外形の面積</dt><dd>' + L.fmt(b.area, 0) + '㎡ ' + BADGE.est + ' <span class="mini">屋根外形の座標から計算</span></dd>' +
      '<dt>外周</dt><dd>' + L.fmt(b.per, 0) + ' m ' + BADGE.est + '</dd>' +
      '<dt>推定階数</dt><dd>約' + b.floors + '階 ' + BADGE.est + ' <span class="mini">高さ÷階高' + state.storeyH + 'm</span></dd>' +
      '<dt>推定延床</dt><dd>約' + L.fmt(b.tfa, 0) + '㎡ ' + BADGE.est + ' <span class="mini">屋根面積×階数。参考値</span></dd>' +
      '<dt>外壁面積の概算</dt><dd><b>約' + L.fmt(b.wall, 0) + '㎡</b> ' + BADGE.est + ' <span class="mini">外周×高さ。参考値（開口部・バルコニー・隣棟との接面は考えていない。LOD1 の単純な形のため誤差は検証していない）</span></dd>' + cloud +
      '<dt>建築年・用途</dt><dd>PLATEAU に値なし → 利用者入力 ' + BADGE.user + '</dd></dl>';
  }

  // ---- 表示: 目安と見積の位置 ----
  function rangeBar(r, quote) {
    const lo = Math.min(r.low, quote || r.low) * 0.75, hi = Math.max(r.high, quote || r.high) * 1.12;
    const p = (v) => ((v - lo) / (hi - lo)) * 100 + '%';
    return '<div class="rangebar" role="img" aria-label="目安の範囲 ' + L.fmtMan(r.low) + 'から' + L.fmtMan(r.high) + '、中央値 ' + L.fmtMan(r.mid) + (quote ? '、見積 ' + L.fmtMan(quote) : '') + '">' +
      '<div class="rng" style="left:' + p(r.low) + ';width:calc(' + p(r.high) + ' - ' + p(r.low) + ')"></div><div class="mid" style="left:' + p(r.mid) + '"></div>' +
      '<span class="q" style="left:' + p(r.low) + '">' + L.fmt(r.low, 0) + '</span><span class="q" style="left:' + p(r.mid) + '">' + L.fmt(r.mid, 0) + '</span><span class="q" style="left:' + p(r.high) + '">' + L.fmt(r.high, 0) + '</span>' +
      (quote ? '<div class="you" style="left:' + p(quote) + '"></div>' : '') + '</div>';
  }
  function renderEst() {
    const S = state.S, inp = inputs(), r = L.estimate(inp, S), set = r.set;
    let h = '<h2>国交省調査の分布（' + esc(set.label) + '） ' + BADGE.real + '</h2>';
    h += '<table><thead><tr><th>指標</th><th>下位25%値</th><th>中央値</th><th>上位25%値</th><th>件数</th></tr></thead><tbody>';
    const row = (name, s, f) => '<tr><td>' + name + '<br><span class="mini">' + esc(s.page) + '</span></td><td>' + f(s.q1) + '</td><td>' + f(s.median) + '</td><td>' + f(s.q3) + '</td><td>' + s.n + '</td></tr>';
    h += row('戸あたり（万円/戸）', set.perUnit, n1) + row('床面積あたり（万円/㎡）', set.perSqm, n1) + row('総額（万円）', set.total, (x) => L.fmt(x, 0));
    h += '</tbody></table><p class="mini">' + esc(S.sample) + esc(S.definition) + ' 国交省調査の利用条件は<b>要確認</b>。</p>';

    h += '<h2>あなたの条件での目安の範囲 ' + BADGE.est + '</h2>';
    if (!r.ranges.length) h += '<p class="mini">戸数か延床面積を入れると、下位25%値〜上位25%値の範囲（総額）を計算します。</p>';
    for (const g of r.ranges) {
      h += '<p><b>' + (g.key === 'perUnit' ? '戸数' + L.fmt(g.basis, 0) + '戸 × 戸あたり' : '延床' + L.fmt(g.basis, 0) + '㎡ × ㎡あたり') + '</b>: ' + L.fmtMan(g.low) + '〜' + L.fmtMan(g.high) + '（中央値の場合 ' + L.fmtMan(g.mid) + '）</p>';
      h += rangeBar(g, r.quoteEx);
    }
    if (r.ranges.length) h += '<p class="mini">調査の下位25%値と上位25%値に、あなたの戸数・延床を掛けただけの範囲です。調査の金額は税抜・共通仮設費を含まないので、見積もその前提にそろえて見てください。範囲の外でも、条件によって妥当な場合があります。</p>';

    if (inp.quote > 0) {
      h += '<h2>見積の位置（' + L.fmtMan(r.quoteEx) + '・税抜に換算' + (inp.quoteTaxIn ? '' : '。入力のまま') + '） ' + BADGE.est + '</h2>';
      if (!r.positions.length) h += '<p class="mini">戸数か延床面積を入れてください。</p>';
      for (const p of r.positions) {
        const f = p.key === 'perSqm' ? n2 : p.key === 'total' ? (x) => L.fmt(x, 0) : n1;
        h += '<div class="pos' + (p.band === 'above-q3' ? ' hi' : '') + '"><b>' + p.label + '</b>: ' + f(p.value) + '（調査の中央値 ' + f(p.median) + '）<br>' + p.rel + '。<b>' + p.text + '</b>' + (p.scaleFree ? '<br><span class="mini">総額は規模で大きく変わるので、参考です。</span>' : '') + '</div>';
      }
      h += '<p class="mini">位置は、調査の四分位（下位25%値・中央値・上位25%値）との比較です。「高い・低い」は調査の分布との比較で、見積が適正か不適切かを判断するものではありません。</p>';
    }
    if (r.hint) {
      h += '<p class="mini">' + BADGE.est + ' 築' + inp.age + '年は、回数別の平均修繕周期（1回目' + S.cycle.years['1'] + '年、2回目' + S.cycle.years['2'] + '年、3回目以上' + S.cycle.years['3'] + '年。' + esc(S.cycle.page) + '）を足し上げた築年（約' + r.hint.cum.map((c) => n1(c)).join('年・') + '年）に最も近いのが<b>' + (r.hint.count === '3' ? '3回目以上' : r.hint.count + '回目') + '</b>です。あなたの実際の回数を選んでください。</p>';
    }
    // 内訳
    const bt = S.breakdown.total, bb = S.breakdown.building;
    const stack = (arr) => '<div class="stack" role="img" aria-label="内訳の比率">' + arr.map((x, i) => '<span class="pal' + (i % 8) + '" style="width:' + x.pct + '%" title="' + esc(x.label) + ' ' + x.pct + '%"></span>').join('') + '</div><div class="legrow">' + arr.map((x, i) => '<span><i class="pal' + (i % 8) + '"></i>' + esc(x.label) + ' ' + x.pct + '%</span>').join('') + '</div>';
    const shareWall = (S.breakdown.total[0].pct * S.breakdown.groups['外壁関係']) / 100, shareWp = (S.breakdown.total[0].pct * S.breakdown.groups['防水関係']) / 100;
    h += '<details><summary>工事費の内訳比率（国交省調査 ' + esc(S.breakdown.page) + '） ' + BADGE.real + '</summary>' +
      '<p class="mini">総工事金額の内訳</p>' + stack(bt) + '<p class="mini">建築系工事の内訳（建築系を100%として）</p>' + stack(bb) +
      '<p class="mini">' + BADGE.est + ' 総額に対する比率の計算: 外壁関係（外壁塗装・タイル・シーリング）は建築系の' + S.breakdown.groups['外壁関係'] + '% → 総額の約' + n1(shareWall) + '%、防水関係は' + S.breakdown.groups['防水関係'] + '% → 約' + n1(shareWp) + '%（掛け算した値）。' +
      (r.quoteEx ? ' 見積' + L.fmtMan(r.quoteEx) + 'に当てはめると、外壁関係の約' + L.fmtMan((r.quoteEx * shareWall) / 100) + '、防水関係の約' + L.fmtMan((r.quoteEx * shareWp) / 100) + 'が調査の平均的な配分です（個別の工事とは異なります）。' : '') + '</p></details>';
    h += '<p class="mini">' + esc(L.DISCLAIMER) + '。' + esc(L.LICENSE_NOTE) + '。</p>';
    $('estOut').innerHTML = h;
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
    let h = '<h2>似た建物（PLATEAU） ' + BADGE.real + ' ' + BADGE.est + '</h2>';
    if (!t) h += '<p class="mini">地図で建物を選ぶか、階数と延床を入れると、規模の近い建物を地図に番号で示します。</p>';
    else {
      h += '<p class="mini">条件: 推定階数が±2階以内で、推定延床の比が近い順（最大8棟）。<b>築年は PLATEAU に入っていない（付与率0%）ので、築年の近さは判定できません</b>。ここで分かるのは「規模が近い建物がどこにあるか」だけで、修繕の事例ではありません。</p>';
      if (!state.simList.length) h += '<p>条件に合う建物がありません。</p>';
      h += '<ul class="list">' + state.simList.map((x, i) => '<li><b>' + (i + 1) + '</b> ' + esc(state.B.meta.ward) + esc(x.b.town) + ' ／ 推定' + x.b.floors + '階 ・延床 約' + L.fmt(x.b.tfa, 0) + '㎡ ／ 延床の比 ' + n2(x.ratio) + '倍 <button type="button" class="pick" data-id="' + esc(x.b.id) + '">地図で見る</button></li>').join('') + '</ul>';
    }
    $('simOut').innerHTML = h;
    $('simOut').querySelectorAll('.pick').forEach((b) => (b.onclick = () => { const bd = state.list.find((x) => x.id === b.dataset.id); if (bd) selectBuilding(bd, true); }));
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
    let h = '<h2>修繕事例の受け皿 ' + BADGE.user + '</h2>';
    h += '<div class="banner"><b>公開されている個別の修繕事例はありません。</b>管理組合などが、自分の実績を登録する欄です（この端末の中だけに保存。送信しません）。' + BADGE.fake + ' の付いた3件は、動きを見せるための<b>架空のデモ</b>で、実在のマンションとは関係ありません。</div>';
    h += '<ul class="list">' + list.map((c) => {
      const set = S.byCount[String(c.count)] || S.byCount['1'];
      const pu = L.position(c.total / c.units, set.perUnit), ps = L.position(c.total / c.tfa, set.perSqm);
      return '<li class="' + (c.fake ? 'fakeitem' : '') + '">' + (c.fake ? BADGE.fake : BADGE.user) + ' <b>' + esc(c.name) + '</b>' + (c.town ? '（' + esc(c.town) + '）' : '') + '<br>' +
        esc(String(c.units)) + '戸・延床' + L.fmt(c.tfa, 0) + '㎡・築' + esc(String(c.age)) + '年・' + (c.count >= 3 ? '3回目以上' : c.count + '回目') + '・' + esc(String(c.year)) + '年・総額' + L.fmtMan(c.total) + '（税抜）' + (c.method ? '・' + esc(c.method) : '') + '<br>' +
        '<span class="mini">戸あたり ' + n1(c.total / c.units) + '万円（' + pu.rel + '）／ ㎡あたり ' + n2(c.total / c.tfa) + '万円（' + ps.rel + '）。国交省調査の' + esc(set.label) + 'との比較。</span>' + (c.memo ? '<br><span class="mini">' + esc(c.memo) + '</span>' : '') +
        (c.fake ? '' : ' <button type="button" class="pick delcase" data-id="' + esc(c.id) + '">削除</button>') + '</li>';
    }).join('') + '</ul>';
    if (tfa > 0) h += '<p class="mini">並びは、いまの延床に近い順です（登録した事例を先に、同じ近さなら架空のデモを後に出します）。</p>';
    h += '<details><summary>自分の事例を登録する</summary><form id="caseForm" class="mini-form" autocomplete="off">' +
      '<label>建物名（任意）<input name="name" maxlength="40"></label><label>町名（任意）<input name="town" maxlength="20"></label>' +
      '<label>戸数<input name="units" type="number" min="1" required></label><label>延床面積（㎡）<input name="tfa" type="number" min="1" required></label>' +
      '<label>築年数（工事時）<input name="age" type="number" min="0" max="100"></label><label>工事年<input name="year" type="number" min="1990" max="2040"></label>' +
      '<label>工事回数<select name="count"><option value="1">1回目</option><option value="2">2回目</option><option value="3">3回目以上</option></select></label>' +
      '<label>総額（万円・税抜）<input name="total" type="number" min="1" required></label>' +
      '<label>発注方式<select name="method"><option value="">不明</option><option>設計・監理方式</option><option>責任施工方式</option><option>CM方式</option><option>その他</option></select></label>' +
      '<label class="full">メモ（任意。個人名・部屋番号は書かない）<input name="memo" maxlength="120"></label>' +
      '<div class="full"><button type="submit">登録する（この端末に保存）</button> <button type="button" class="ghost" id="exportCases">JSONで書き出す</button></div></form></details>';
    $('caseOut').innerHTML = h;
    const f = $('caseForm');
    f.onsubmit = (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      state.cases.unshift({ id: 'c' + Date.now(), name: d.name || '（名称なし）', town: d.town || '', units: +d.units, tfa: +d.tfa, age: +d.age || 0, count: +d.count, year: +d.year || '', total: +d.total, method: d.method, memo: d.memo });
      store.set(KEY.cases, state.cases); renderCases();
    };
    $('exportCases').onclick = () => download('repair-cases.json', JSON.stringify(state.cases, null, 2), 'application/json');
    $('caseOut').querySelectorAll('.delcase').forEach((b) => (b.onclick = () => { state.cases = state.cases.filter((c) => c.id !== b.dataset.id); store.set(KEY.cases, state.cases); renderCases(); }));
  }
  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---- 点群 ----
  function renderSlam() {
    const c = state.cloudInfo;
    let h = '<h2>点群（SLAM・スマホ LiDAR）から外壁面積の概算 ' + BADGE.user + '</h2>';
    h += '<div class="limit"><b>限界（先に読んでください）</b>: スマホの LiDAR の検出範囲は一般に1〜5m程度（電子情報通信学会 FIT2025 I-015 の記載、メーカー資料の5mという数値）です。地上から<b>高層の外壁全体は測れません</b>。測れるのは、低層部・共用部・屋上・バルコニー程度で、この画面の値は<b>読み込めた範囲だけ</b>のものです。建物全体の外壁面積は、上の PLATEAU の外周×高さの概算の方が現実的ですが、その誤差も検証していません。</div>';
    h += '<p class="mini">PLY（ASCII・バイナリ）、LAS（無圧縮）、XYZ（テキスト）をブラウザの中だけで読みます。LAZ（圧縮）は読めないので、LAS か PLY に変換してください。点群には、窓越しの住戸内部や居住者が写ることがあります。ファイルは送信・保存しません。</p>';
    h += '<div class="fields"><label class="btn ghost" style="cursor:pointer;background:#fff;color:var(--accent)">ファイルを選ぶ <input id="cloudFile" type="file" accept=".ply,.las,.laz,.xyz,.txt,.csv,.pts" style="width:12em"></label>' +
      '<button type="button" id="cloudSample" class="ghost">見本（合成）を読み込む</button><button type="button" id="cloudSavePly" class="ghost">見本をPLYで保存</button>' +
      '<label>上方向 <select id="cloudUp"><option value="z"' + (state.cloudUp === 'z' ? ' selected' : '') + '>Z（LAS・多くのスキャナ）</option><option value="y"' + (state.cloudUp === 'y' ? ' selected' : '') + '>Y（AR 系アプリに多い）</option></select></label></div>';
    if (state.cloudErr) h += '<p class="err">' + esc(state.cloudErr) + '</p>';
    if (c) {
      h += '<p>' + (state.cloudSynthetic ? BADGE.fake + ' <b>合成データ</b>（実在の建物ではありません）' : BADGE.user + ' ' + esc(state.cloudName)) + ' ／ ' + esc(state.cloud.format) + ' ／ 点 ' + L.fmt(c.n, 0) + '（全 ' + L.fmt(c.total, 0) + '）</p>';
      h += '<dl class="kv"><dt>範囲（水平）</dt><dd>' + n1(c.width) + ' m × ' + n1(c.depth) + ' m</dd><dt>高さ</dt><dd>' + n1(c.height) + ' m（上下1%を除く）</dd><dt>外周（凸包）</dt><dd>' + n1(c.perimeter) + ' m' + (c.slender ? '。細長いので、壁の1面だけなら往復で数えています → 壁の長さ ' + n1(c.wallLen) + ' m とみなす' : '') + '</dd><dt>水平の面積</dt><dd>' + L.fmt(c.hullArea, 0) + '㎡</dd><dt>外壁面積の概算</dt><dd><b>' + L.fmt(c.wall, 0) + '㎡</b> ' + BADGE.est + ' <span class="mini">壁の長さ×高さ。参考値</span></dd></dl>';
      if (state.sel && !state.cloudSynthetic) h += '<p class="mini">選んだ建物の外周（PLATEAU）は ' + L.fmt(state.sel.per, 0) + ' m。点群の外周はその ' + L.fmt((c.wallLen / state.sel.per) * 100, 0) + '% です（100%に近ければ建物をほぼ一周測れています）。</p>';
      if (c.width < 10 && c.depth < 10) h += '<p class="mini">範囲が10m未満です。建物全体ではなく、一部だけを測った可能性が高いです。</p>';
      h += '<canvas id="plan" width="380" height="200" role="img" aria-label="点群を真上から見た図と、外周（凸包）"></canvas>';
      h += '<p><button type="button" id="cloudApply">この概算を外壁面積として、建物の欄に出す</button></p>';
    } else h += '<p class="mini">まだ点群を読み込んでいません。見本（合成）で動きを試せます。</p>';
    $('slamOut').innerHTML = h;
    $('cloudFile').onchange = async (e) => { const f = e.target.files[0]; if (f) await loadCloud(f); };
    $('cloudSample').onclick = () => setCloud(L.synthCloud(), '見本（合成）', true);
    $('cloudSavePly').onclick = () => download('sample-synthetic.ply', L.toPLY(L.synthCloud()), 'text/plain');
    $('cloudUp').onchange = (e) => { state.cloudUp = e.target.value; if (state.cloud) setCloud(state.cloud, state.cloudName, state.cloudSynthetic); };
    if (c) { drawPlan(); $('cloudApply').onclick = () => { state.cloudApplied = true; renderSelCard(); setTab('est'); }; }
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
    const s = Math.min((W - 20) / Math.max(1e-6, x1 - x0), (H - 20) / Math.max(1e-6, y1 - y0));
    const X = (x) => 10 + (x - x0) * s, Y = (y) => H - 10 - (y - y0) * s;
    g.fillStyle = '#1f5f8b';
    for (const p of c.sample) g.fillRect(X(p[0]) - 1, Y(p[1]) - 1, 2, 2);
    g.strokeStyle = '#d6336c'; g.lineWidth = 2; g.beginPath();
    c.hull.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); g.stroke();
    g.fillStyle = '#333'; g.font = '11px sans-serif'; g.fillText('真上から。赤線は外周（凸包）', 8, 12);
  }

  // ---- 発注先の検討 ----
  function renderVendor() {
    let h = '<h2>公的情報で確かめる ' + BADGE.real + '</h2><ul class="links list">' +
      L.LINKS.map((l) => '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.name) + '</a><br><span class="mini">' + esc(l.note) + '</span></li>').join('') + '</ul>';
    h += '<p class="mini">この画面は、会社の格付けや評点をしません。許可・処分・公表は、リンク先で会社名を入れて確かめてください。公取委の公表では、施工会社と設計コンサルタントが事前に受注予定者を決めるなどの行為が認定され、施工会社が請負金額の一定割合を設計コンサルタントに支払っていた事実も示されています（発表ページで確認してください）。</p>';
    h += '<h2>見積を比べるチェック項目</h2><ul class="checklist">' + L.CHECKLIST.map((c) => '<li><label><input type="checkbox" data-id="' + c.id + '"' + (state.checks[c.id] ? ' checked' : '') + '><span>' + esc(c.text) + '<span class="basis">根拠: ' + esc(c.basis) + '</span></span></label></li>').join('') + '</ul>';
    h += '<p class="mini">国交省調査では、発注方法は設計・監理方式が80.1%、責任施工方式が12.6%（調査全体。' + esc(state.S.orderMethod.page) + '）。</p>';
    h += '<h2>口コミ（利用者の自己投稿の受け皿） ' + BADGE.fake + '</h2>';
    h += '<div class="banner"><b>以下の口コミは、すべて架空のデモです。</b>実在の会社・工事・人物とは関係がありません。他の口コミサイトからの転載や収集はしていません。</div>';
    h += '<div class="rules"><b>並びを操作できない設計（ステマ規制への配慮）</b><ul><li>並びは<b>投稿日の新しい順だけ</b>。評価・会社・申告で並べ替えず、平均点も出さない。</li><li>施工会社・設計コンサルタントは、並び・表示・抽出に関与できない。広告枠・紹介料はない。</li><li>投稿者は、利害関係の有無を必ず申告し、「あり」は表示に残る。</li></ul></div>';
    const all = L.sortReviews(state.DEMO.reviews.map((r) => Object.assign({}, r, { fake: true })).concat(state.reviews.map((r) => Object.assign({}, r, { fake: false }))));
    const q = state.reviewFilter.trim();
    const shown = q ? all.filter((r) => r.company.includes(q)) : all;
    h += '<label class="mini">会社名で絞り込む（並びは変わりません） <input id="revFilter" value="' + esc(state.reviewFilter) + '" maxlength="30"></label>';
    h += '<ul class="list">' + shown.map((r) => '<li class="' + (r.fake ? 'fakeitem' : '') + '">' + (r.fake ? BADGE.fake : BADGE.user) + ' <b>' + esc(r.company) + '</b> ／ ' + esc(r.date) + ' ／ ' + esc(r.role) + ' ／ 工事' + esc(String(r.year)) + '年 ／ <span class="stars" aria-label="評価' + r.stars + '">' + '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars) + '</span> ／ ' + (r.stake === 'related' ? '<b>利害関係あり（申告）</b>' : '利害関係なし（申告）') + '<br>' + esc(r.text) + (r.fake ? '' : ' <button type="button" class="pick delrev" data-id="' + esc(r.id) + '">削除</button>') + '</li>').join('') + '</ul>';
    h += '<details><summary>口コミを投稿する（この端末に保存。送信しません）</summary><form id="revForm" class="mini-form" autocomplete="off">' +
      '<label>会社名<input name="company" maxlength="40" required></label><label>工事年<input name="year" type="number" min="1990" max="2040" required></label>' +
      '<label>あなたの立場<select name="role"><option>管理組合の理事</option><option>区分所有者</option><option>管理会社の担当者</option><option>その他</option></select></label>' +
      '<label>評価<select name="stars"><option>5</option><option>4</option><option selected>3</option><option>2</option><option>1</option></select></label>' +
      '<label class="full">この会社との利害関係（必須）<select name="stake" required><option value="">選んでください</option><option value="none">ない（金銭・雇用・紹介などの関係なし）</option><option value="related">ある（関係者・紹介を受けた等）</option></select></label>' +
      '<label class="full">内容（事実と感想を分けて書く。個人名・部屋番号は書かない）<textarea name="text" rows="3" maxlength="400" required></textarea></label>' +
      '<div class="full"><button type="submit">投稿する（この端末に保存）</button></div></form></details>';
    $('vendorOut').innerHTML = h;
    $('vendorOut').querySelectorAll('.checklist input').forEach((i) => (i.onchange = () => { state.checks[i.dataset.id] = i.checked; store.set(KEY.checks, state.checks); }));
    const rf = $('revFilter'); if (rf) rf.oninput = () => { state.reviewFilter = rf.value; const pos = rf.selectionStart; renderVendor(); const n = $('revFilter'); n.focus(); n.setSelectionRange(pos, pos); };
    const f = $('revForm');
    f.onsubmit = (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.stake) return;
      state.reviews.unshift({ id: 'r' + Date.now(), company: d.company, date: new Date().toISOString().slice(0, 10), role: d.role, stake: d.stake, stars: +d.stars, year: +d.year, text: d.text });
      store.set(KEY.reviews, state.reviews); renderVendor();
    };
    $('vendorOut').querySelectorAll('.delrev').forEach((b) => (b.onclick = () => { state.reviews = state.reviews.filter((r) => r.id !== b.dataset.id); store.set(KEY.reviews, state.reviews); renderVendor(); }));
  }

  // ---- 出典・限界 ----
  function renderSrc() {
    const B = state.B, S = state.S, fr = L.fillRates(B.stats);
    let h = '<h2>PLATEAU の属性の付与率（' + esc(B.meta.ward) + '、全 ' + L.fmt(B.stats.total, 0) + ' 棟） ' + BADGE.real + '</h2>';
    h += '<table><thead><tr><th>属性</th><th>入っている棟数</th><th>付与率</th></tr></thead><tbody>' + fr.map((x) => '<tr><td>' + x.label + '</td><td>' + L.fmt(x.n, 0) + '</td><td>' + (x.pct === 0 ? '<b>0%</b>' : n1(x.pct) + '%') + '</td></tr>').join('') + '</tbody></table>';
    h += '<p class="mini">建築年・階数・延床・用途は、東京23区（2022年度版）の建築物モデルに値が入っていませんでした（' + esc(B.meta.ward) + '以外でも、23区の全 671 メッシュから等間隔に抜いた ' + esc(String(B.meta.sample.meshes)) + ' メッシュ・' + L.fmt(B.meta.sample.buildings, 0) + ' 棟の調査で同じ）。そのため、階数・延床は高さと屋根の形からの推定、築年は利用者入力です。「共同住宅らしい」は、用途ではなく規模（高さ・屋根面積）による選び方です。</p>';
    h += '<h2>出典・加工・責任</h2><ul class="list">' +
      '<li>' + BADGE.real + ' <b>建物</b>: ' + esc(B.meta.source) + '。' + esc(B.meta.license) + '。GET のみで取得し、墨田区の建物の高さ・屋根外形・住所を取り出し、外周・面積を計算して作成（' + B.meta.meshCount + ' メッシュ）。</li>' +
      '<li>' + BADGE.real + ' <b>修繕費の分布</b>: ' + esc(S.publisher) + '「' + esc(S.title) + '」（<a href="' + esc(S.reportUrl) + '" target="_blank" rel="noopener noreferrer">報告書</a>、<a href="' + esc(S.summaryUrl) + '" target="_blank" rel="noopener noreferrer">概要</a>）。' + esc(S.transcribed) + '<b>' + esc(S.license) + '</b>。</li>' +
      '<li><b>地図</b>: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">国土地理院 地理院タイル（淡色地図）</a>。</li>' +
      '<li><b>責任</b>: ' + esc(L.RESPONSIBILITY) + '。</li></ul>';
    h += '<h2>限界</h2><ul class="list"><li>' + esc(L.DISCLAIMER) + '。</li><li>調査は200社・818件の工事事例で、全国のマンションを代表するとは限りません。調査の金額は税抜・共通仮設費を含みません。</li><li>類似の「修繕事例」の公開データはなく、事例は利用者の登録と架空のデモだけです。</li><li>外壁面積の概算は参考値で、誤差は検証していません。点群はスマホ LiDAR の範囲（数m）の限界があります。</li><li>口コミは利用者の自己投稿の受け皿で、デモは架空です。</li></ul>';
    h += '<h2>プライバシー</h2><p class="mini">入力した条件・見積・点群は、この端末のブラウザの中だけで扱い、送信しません。事例・口コミ・チェックだけ、この端末の localStorage に保存します（削除できます）。ネットワークへの要求は、地図画像（国土地理院）と同梱データの読み込みだけで、すべて GET です。</p>';
    $('srcOut').innerHTML = h;
  }

  // ---- タブ・全体 ----
  const TABS = ['est', 'sim', 'slam', 'vendor', 'src'];
  function setTab(t) {
    state.tab = t;
    for (const x of TABS) { const b = $('t-' + x), p = $('p-' + x); const on = x === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; p.hidden = !on; }
    renderTab();
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
    const s = state.sel;
    $('selLine').innerHTML = s ? '選択: ' + esc(state.B.meta.ward) + esc(s.town) + '・高さ' + n1(s.h) + 'm・推定' + s.floors + '階・推定延床 約' + L.fmt(s.tfa, 0) + '㎡（推定）' : '建物を押して選びます。ホイール・ピンチで拡大、ドラッグで移動。';
    const fr = Object.fromEntries(L.fillRates(state.B.stats).map((x) => [x.key, x]));
    $('selLine').innerHTML += ' ／ PLATEAU ' + esc(state.B.meta.ward) + ' ' + L.fmt(state.B.stats.total, 0) + '棟の付与率: 高さ' + L.fmt(fr.height.pct, 0) + '%・屋根面積' + L.fmt(fr.roofArea.pct, 0) + '%・<b>建築年' + L.fmt(fr.year.pct, 0) + '%・階数' + L.fmt(fr.floors.pct, 0) + '%・延床' + L.fmt(fr.tfa.pct, 0) + '%・用途' + L.fmt(fr.usage.pct, 0) + '%</b>';
  }
  function bindUi() {
    $('disclaimer').textContent = L.DISCLAIMER + '。国交省調査の利用条件は要確認';
    $('toSources').onclick = (e) => { e.preventDefault(); setTab('src'); $('t-src').focus(); };
    for (const t of TABS) {
      $('t-' + t).onclick = () => setTab(t);
      $('t-' + t).onkeydown = (e) => {
        const i = TABS.indexOf(t); let j = -1;
        if (e.key === 'ArrowRight') j = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') j = (i + TABS.length - 1) % TABS.length;
        if (j >= 0) { e.preventDefault(); setTab(TABS[j]); $('t-' + TABS[j]).focus(); }
      };
    }
    for (const id of ['inUnits', 'inTfa', 'inAge', 'inFloors', 'inQuote']) $(id).addEventListener('input', () => { if (id === 'inFloors' || id === 'inTfa') { refreshSim(); schedule(); } renderEst(); if (state.tab === 'sim') renderSim(); });
    $('inTax').onchange = renderEst;
    document.querySelectorAll('input[name=count]').forEach((r) => (r.onchange = () => { renderEst(); if (state.tab === 'sim') renderSim(); }));
    $('selMin').onchange = (e) => { state.minFloors = +e.target.value; refilter(); renderAll(); };
    $('storeyH').onchange = (e) => { const v = parseFloat(e.target.value); if (v >= 2 && v <= 5) { state.storeyH = v; reenrich(); if (state.sel) { $('inFloors').value = state.sel.floors; $('inTfa').value = Math.round(state.sel.tfa / 10) * 10; } renderAll(); } };
    $('selTown').onchange = (e) => { state.town = e.target.value; refilter(); fitTo(boundsOfList(state.vis.length ? state.vis : state.list), state.town ? 30 : 16); renderAll(); schedule(); };
    const towns = {}; for (const b of state.list) towns[b.town] = (towns[b.town] || 0) + 1;
    $('selTown').innerHTML = '<option value="">' + esc(state.B.meta.ward) + '全体</option>' + Object.keys(towns).sort((a, b) => a.localeCompare(b, 'ja')).map((t) => '<option value="' + esc(t) + '">' + esc(t) + '（' + towns[t] + '棟）</option>').join('');
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
    prepare(); bindUi(); bindMap();
    fitTo(boundsOfList(state.list), 16);
    renderAll(); setTab('est'); schedule();
    requestAnimationFrame(() => { fitTo(boundsOfList(state.list), 16); schedule(); });
    window.__rp = { state, L, selectBuilding, setTab, setCloud, draw };
  }
  init();
})();
