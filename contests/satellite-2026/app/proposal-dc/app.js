/* データセンター候補地の一次スクリーニング：地図と確認項目の画面（点数・順位は作らない） */
(function () {
  'use strict';
  const L = window.DCLib, DATA = window.DC_DATA;
  const g = DATA.grid;
  const N = g.nx * g.ny;
  const LAYERS = {};
  Object.keys(DATA.layers).forEach((k) => { LAYERS[k] = L.decodeRle(DATA.layers[k], N); });
  const state = { map: null, mapReady: false, target: null, markers: {}, ptMarker: null, layerOn: {}, pins: [], hz: {}, nPoint: 0 };
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
  // 温度は紫（涼しい）→黄（熱い）。災害の「重なる」の赤と混ざらない色にする
  const LST_STOPS = [[68, 1, 84], [65, 68, 135], [42, 120, 142], [34, 168, 132], [122, 209, 81], [253, 231, 37]];
  // 範囲全体の 10〜90% に色を割り当て、中央値を中間色にする（市街地が一色にならないように）
  const LST_P10 = DATA.stats.lst_p10, LST_P50 = DATA.stats.lst_p50, LST_P90 = DATA.stats.lst_p90;
  const lstT = (v) => (v <= LST_P50 ? 0.5 * (v - LST_P10) / (LST_P50 - LST_P10) : 0.5 + 0.5 * (v - LST_P50) / (LST_P90 - LST_P50));
  const INSAR_STOPS = [[178, 24, 43], [239, 138, 98], [253, 219, 199], [150, 210, 120], [209, 229, 240], [103, 169, 207], [33, 102, 172]];
  const PAL = {
    land: { 1: rgba(60, 160, 70, 140), 2: rgba(214, 150, 60, 200), 3: rgba(120, 120, 130, 190), 4: rgba(40, 110, 220, 170), 5: rgba(180, 210, 110, 120) },
    chg: { 1: rgba(230, 30, 30, 200) },
    slide: { 1: rgba(240, 200, 20, 170), 2: rgba(210, 30, 30, 190) },
  };
  const BLUES = [[200, 225, 250], [150, 195, 240], [90, 150, 225], [40, 100, 200], [20, 60, 160], [10, 30, 110]];
  function colorOf(key, v) {
    if (!v) return key === 'sub' ? [110, 110, 110, 70] : null; // 地盤: 値が取れない所は灰色で見せる
    if (key === 'flood') return BLUES[Math.min(5, v - 1)].concat(170);
    if (key === 'tsunami') return [[225, 200, 245], [190, 150, 230], [150, 100, 210], [110, 50, 180], [70, 20, 130], [40, 10, 90]][Math.min(5, v - 1)].concat(175);
    if (key === 'surge') return [[190, 240, 230], [130, 220, 205], [70, 190, 175], [30, 150, 140], [15, 110, 105], [5, 70, 70], [0, 40, 45], [0, 20, 25]][Math.min(7, v - 1)].concat(175);
    if (key === 'slide') return PAL.slide[v & 3] || null;
    if (key === 'lst') return ramp(lstT(L.lstFromCode(v)), LST_STOPS).concat(125); // 印・災害の層が読めるよう薄め
    if (key === 'sub') return v === 8 || v === 9 ? [150, 210, 120, 45] : ramp((v - 1) / 15, INSAR_STOPS).concat(225); // 目立つ動きのない階級は薄く
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
    lst: () => `<div class="lg"><b>地表面温度</b>（${L.SCENES.landsat.date}）<br>${LST_P10}℃ ${grad(LST_STOPS)} ${LST_P90}℃ 黄ほど熱い</div>`,
    sub: () => `<div class="lg"><b>地盤の変動</b>（干渉SAR）沈下 ${grad(INSAR_STOPS)} 隆起（±30 mm/年）<br>目立つ動き（濃い色）の割合 <b>地図全体：${SUB_MOVE.all ? `${SUB_MOVE.all}%` : '該当なし'}</b>${subMoveTarget()}<br>ほぼ無色＝年3.75mm超の動きなし ${sw([110, 110, 110, 120])}値なし</div>`,
    flood: () => `<div class="lg"><b>洪水</b>${BLUES.map((c) => sw(c.concat(200))).join('')}浸水深 浅→深</div>`,
    slide: () => `<div class="lg"><b>土砂</b>${sw(PAL.slide[1])}警戒 ${sw(PAL.slide[2])}特別警戒</div>`,
    tsunami: () => `<div class="lg"><b>津波</b>${[[225, 200, 245], [150, 100, 210], [70, 20, 130]].map((c) => sw(c.concat(200))).join('')}浅→深</div>`,
    surge: () => `<div class="lg"><b>高潮</b>${[[190, 240, 230], [70, 190, 175], [5, 70, 70]].map((c) => sw(c.concat(200))).join('')}浅→深</div>`,
    power: () => `<div class="lg"><b>電力（OSM）</b><span class="sw" style="background:#111;border-radius:50%"></span>変電所 <span class="sw" style="height:2px;background:#d4a000;vertical-align:3px"></span>送電線</div>`,
  };
  // 地盤：目立つ動き（±3.75 mm/年の外）の格子の数。範囲全体と選択中の範囲
  const isMove = (v) => v && v !== 8 && v !== 9;
  const moveShare = (vals) => { let n = 0, m = 0; vals.forEach((v) => { if (v) { n++; if (isMove(v)) m++; } }); return n ? Math.round((100 * m) / n) : null; };
  const SUB_MOVE = { all: moveShare(LAYERS.sub) };
  function subMoveTarget() {
    const t = state.target; if (!t || !t.cells) return '';
    const k = moveShare(t.cells.map((c) => LAYERS.sub[c]));
    return `／${esc(nameOf(t))}の範囲：${k == null ? '値なし' : k ? `${k}%` : '<b>該当なし</b>'}`;
  }
  const RASTER_KEYS = ['land', 'chg', 'lst', 'sub', 'flood', 'slide', 'tsunami', 'surge'];

  function setLayer(key, on) {
    state.layerOn[key] = on;
    const m = state.map;
    if (m && state.mapReady) {
      const ids = key === 'power' ? ['pw-lines', 'pw-subs'] : ['img-' + key];
      ids.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    }
    drawLegend();
    const r = document.querySelector(`#layers input[data-layer="${key}"]`);
    if (r && r.type === 'radio' && on) r.checked = true;
  }
  function drawLegend() {
    $('#legend').innerHTML = MK_LEGEND + Object.keys(LEGENDS).filter((k) => state.layerOn[k]).map((k) => LEGENDS[k]()).join('');
  }
  /** 衛星の層を 1 つだけ出す（none なら全て隠す） */
  function setSat(key) {
    SAT_KEYS.forEach((k) => setLayer(k, k === key));
    const r = document.querySelector(`#layers input[data-layer="${key}"]`); if (r) r.checked = true;
    $('#satnote').innerHTML = SAT_NOTE[key] ? SAT_NOTE[key]() : '';
  }
  // 衛星の層が何を見ているかの一言（地図の上に常に出す）
  const SAT_NOTE = {
    lst: () => '温度＝夏の地面の熱さ（黄ほど熱い）。<b>災害の危険度ではない</b>',
    sub: () => `地盤＝年に何mm上下したか。目立つ動きは全体の${SUB_MOVE.all || 0}%＝<b>ほぼ無色が普通</b>`,
    land: () => '土地＝いま何があるか（植生・裸地等・建物・水）',
    chg: () => '変化＝赤は 2020年に植生、2026年に裸地等（造成・伐採など）',
  };
  const MK_LEGEND = '<div class="lg"><span class="mkd dev">造</span>造成地の候補 <span class="mkd idle">遊</span>遊休地の候補<br>右肩＝重なる災害の種類数 <i class="hzd h0">0</i>なし <i class="hzd h1">1</i>1種 <i class="hzd h2">2</i>複数</div>';
  const SAT_KEYS = ['land', 'chg', 'lst', 'sub'];

  // ---- 候補地と確認項目 ----
  const cands = DATA.candidates;
  const kindLabel = (c) => (c.kind === 'dev' ? '造成地の候補' : '遊休地の候補');

  const isMobile = () => window.matchMedia('(max-width: 800px)').matches;
  /** スマホは結果が地図の下なので、操作した後は結果の先頭へ寄せる */
  function showResult() {
    updateJump();
    if (!isMobile()) return;
    const top = $('#checks .ttl').getBoundingClientRect().top + window.scrollY - 4; // 埋め込み先の親ページは動かさない
    window.scrollTo({ top, behavior: 'smooth' });
  }
  /** スマホ：結果が画面の外にある時、下端に「選んだ所と災害の該当 ▼確認項目」の帯を出す */
  function updateJump() {
    const b = $('#jump'); if (!b) return;
    const t = state.target;
    if (!isMobile() || !t || !state.rows) { b.hidden = true; return; }
    const first = document.querySelector('#impact');
    const hit = hazHits(state.rows).map((r) => r.label);
    b.textContent = `${nameOf(t)}：${hit.length ? hit.join('・') + 'に重なる' : '災害に重ならない'}　▼タップで確認項目`;
    b.className = 'jump ' + (hit.length ? 'hit' : 'none');
    b.hidden = !first || first.getBoundingClientRect().top < window.innerHeight - 70; // 結果の先頭が画面に入ったら出さない（行に重ねない）
  }
  function select(target, byUser) {
    state.userPicked = state.userPicked || !!byUser;
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
    drawLegend();
    if (byUser) showResult();
  }

  const LAB = { hit: '重なる', none: '重ならない', info: '参考', nodata: 'データなし' };
  const SAT_OF = { insar: 'sub', lst: 'lst', land: 'land' };
  const HAZ = ['flood', 'slide', 'tsunami', 'surge'];
  const hazHits = (rows) => rows.filter((r) => HAZ.includes(r.key) && r.status === 'hit');
  const nameOf = (t) => t.id || t.ptName || '指した点';

  /** 選んだ場所に合わせた、防災・都市課題への一言 */
  function impactText(rows) {
    const hit = hazHits(rows);
    if (!hit.length) return '浸水・土砂・津波・高潮のどれにも重ならない（概略）→ 災害時もデータと通信の拠点を残せる可能性。現地で確かめる';
    // 災害の種類ごとに確かめること（浸水と土砂では対策が違う）
    const ADV = { flood: 'かさ上げ・止水の費用を見込む', slide: '斜面・擁壁を確かめる', tsunami: '想定水深と避難を確かめる', surge: '想定水深と避難を確かめる' };
    const adv = [...new Set(hit.map((r) => ADV[r.key]))];
    return `${hit.map((r) => r.label).join('・')}に重なる → ${adv.join('／')}か、別の候補と比べる`;
  }

  function render(t) {
    const rows = L.buildChecks(DATA, LAYERS, t);
    state.rows = rows;
    $('#target-title').innerHTML = t.id ? `${esc(t.id)} の確認項目 <small>${kindLabel(t)}・約 ${t.ha} ha の範囲で集計</small>` : '地図で指した地点';
    $('#target-sub').textContent = t.id
      ? (state.userPicked ? '' : `例として ${t.id}・${state.pins.filter((p) => p !== t).map(nameOf).join('・')} を表示中。地図の印で切替`)
      : `指した点の周囲 約 ${L.CLICK_RADIUS_M} m で集計（候補地の全体ではない）`;
    const hit = hazHits(rows).length;
    const im = $('#impact'); im.textContent = impactText(rows); im.className = 'impact ' + (hit ? 'hit' : 'none');
    $('#rows').innerHTML = rows.map((r, i) => `<li class="row" data-key="${r.key}"><span class="chip ${r.status}">${LAB[r.status]}</span><div class="rb"><span class="lb">${esc(r.label)}</span>${r.sat ? `<button type="button" class="sat" data-sat="${SAT_OF[r.key]}" title="地図をこの衛星の層に切り替える">衛星▸</button>` : ''}<span class="val">${esc(r.value)}</span><div class="src" id="src-${i}" hidden>${r.hint ? `<span class="hint">${esc(r.hint)}</span><br>` : ''}出典：<a href="${r.src.url}" target="_blank" rel="noopener">${esc(r.src.name)}</a>（${esc(r.src.lic)}）${r.note ? `<br>${esc(r.note)}` : ''}</div></div><button type="button" class="info" aria-expanded="false" aria-controls="src-${i}" aria-label="${esc(r.label)}の出典・注意" title="出典・注意">ⓘ</button></li>`).join('');
    $('#rows').querySelectorAll('button.info').forEach((b) => b.addEventListener('click', () => {
      const d = document.getElementById(b.getAttribute('aria-controls')), open = d.hidden;
      d.hidden = !open; b.setAttribute('aria-expanded', String(open));
    }));
    $('#rows').querySelectorAll('button.sat').forEach((b) => b.addEventListener('click', () => setSat(b.dataset.sat)));
    const pinned = state.pins.some((p) => p === t);
    const pb = $('#btn-pin'); pb.textContent = pinned ? '表から外す' : '表に入れる'; pb.setAttribute('aria-pressed', String(pinned));
    pb.title = pinned ? '比べる表から外す' : `別の所を選んでも表に残す（最大 ${MAX_PINS} 件）`;
    renderCompare();
    updateJump();
  }

  // ---- 比べる（点数・順位は作らない。差がある項目だけ強調する）----
  const MAX_PINS = 3;
  function togglePin() {
    const t = state.target; if (!t) return;
    const i = state.pins.indexOf(t);
    if (i >= 0) state.pins.splice(i, 1);
    else { state.pins.push(t); if (state.pins.length > MAX_PINS) state.pins.shift(); }
    render(t);
  }
  function renderCompare() {
    const box = $('#cmp'), cur = state.target;
    // 列＝残した候補地。選択中が残していなければ、一時の列として右端に足す（最大 3 列）
    const tmp = cur && !state.pins.includes(cur);
    const P = tmp ? state.pins.slice(-(MAX_PINS - 1)).concat([cur]) : state.pins.slice();
    if (!P.length) { box.innerHTML = '<p class="cmp-empty">「表に入れる」で候補地を 2〜3 件並べると、差がある項目が分かる</p>'; return; }
    const R = P.map((t) => L.buildChecks(DATA, LAYERS, t));
    const keys = R[0].map((r) => r.key);
    const diff = {}, points = [], same = {};
    keys.forEach((k, ri) => {
      const cells = R.map((rows) => rows[ri]);
      if (HAZ.includes(k)) {
        const hit = P.filter((_, c) => cells[c].status === 'hit');
        diff[k] = hit.length > 0 && hit.length < P.length;
        if (diff[k]) points.push(`${cells[0].label}：${hit.map(nameOf).join('・')} が該当`);
      } else if (k === 'insar') {
        diff[k] = new Set(cells.map((c) => c.short)).size > 1;
        if (P.length > 1 && !diff[k]) same[k] = true; // 全て同じ値なら 1 つのセルにまとめる
        if (diff[k]) points.push(`地盤：${P.map((t, c) => `${nameOf(t)} ${cells[c].short}`).join('・')}`);
      } else if (k === 'lst') {
        // 差が範囲の 10〜90% の幅の 1/4 以上なら目立たせる（優劣ではなく、確かめる点として）
        const v = cells.map((c) => c.num);
        if (P.length > 1 && v.every((x) => x != null)) {
          const d = Math.max(...v) - Math.min(...v);
          diff[k] = d >= (LST_P90 - LST_P10) / 4;
          if (diff[k]) points.push(`地表面温度：差 ${d.toFixed(1)}℃ → 冷却の可否は別に確かめる`);
        }
      }
    });
    const allHit = keys.filter((k, ri) => HAZ.includes(k) && R.every((rows) => rows[ri].status === 'hit')).map((k) => R[0].find((r) => r.key === k).label);
    if (allHit.length) points.push(`${allHit.join('・')}：並べた全てが該当`);
    const noDiff = keys.filter((k, ri) => HAZ.includes(k) && !diff[k] && !allHit.includes(R[0][ri].label)).map((k) => R[0].find((r) => r.key === k).label);
    if (P.length > 1 && noDiff.length) points.push(`差なし：${noDiff.join('・')}${same.insar ? '・地盤' : ''}`);
    if (P.length > 1 && !points.length) points.push('災害の該当に差はない。温度・電力設備・土地の状態を値で比べる');
    const head = P.map((t, i) => {
      const isCur = t === cur, temp = isCur && tmp;
      return `<th scope="col" class="${isCur ? 'cur' : ''}"><button type="button" class="go" data-i="${i}">${esc(nameOf(t))}</button>${temp ? '' : `<button type="button" class="rm" data-i="${i}" aria-label="${esc(nameOf(t))}を外す">×</button>`}${isCur ? ` <small>${temp ? '選択中・未固定' : '選択中'}</small>` : ''}</th>`;
    }).join('');
    // 既定は、差がある行・どれかが災害に重なる行・地盤・温度だけ（上の一覧と重ねない）。「全項目」で 8 行
    const shown = keys.map((k, ri) => state.cmpAll || diff[k] || k === 'insar' || k === 'lst' || (HAZ.includes(k) && R.some((rows) => rows[ri].status === 'hit')));
    const RH = { lst: '地表面温度<small class="em">8/22の1場面・優劣でない</small>', insar: '地盤の変動<small class="em">小さな動きは判別不可</small>' };
    const cellsOf = (k, ri) => (same[k] ? `<td colspan="${P.length}" class="${R[0][ri].status}">どれも${esc(R[0][ri].short)}（差なし）</td>` : R.map((rows) => `<td class="${rows[ri].status}">${esc(rows[ri].short)}</td>`).join(''));
    const body = keys.map((k, ri) => (shown[ri] ? `<tr class="${diff[k] ? 'diff' : ''}"><th scope="row">${RH[k] || esc(R[0][ri].label)}</th>${cellsOf(k, ri)}</tr>` : '')).join('');
    const nHide = shown.filter((x) => !x).length;
    const tog = state.cmpAll ? '<button type="button" class="cmp-all">差のある行だけ</button>' : (nHide ? `<button type="button" class="cmp-all">全項目（ほか ${nHide} 行）</button>` : '');
    box.innerHTML = `<h3>比べる <small>差がある行を強調（順位は付けない）</small>${tog}</h3><table class="cmp"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`
      + (points.length ? `<div class="cmp-pts"><b>確認すべき点</b><ul>${points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '<p class="cmp-empty">もう 1 件選ぶと並ぶ</p>');
    const ta = box.querySelector('button.cmp-all'); if (ta) ta.addEventListener('click', () => { state.cmpAll = !state.cmpAll; renderCompare(); });
    box.querySelectorAll('button.go').forEach((b) => b.addEventListener('click', () => { const t = P[+b.dataset.i]; t.id ? pickCandidate(t.id) : select(t); }));
    box.querySelectorAll('button.rm').forEach((b) => b.addEventListener('click', () => { const k = state.pins.indexOf(P[+b.dataset.i]); if (k >= 0) state.pins.splice(k, 1); render(state.target); }));
  }

  const candTargets = {};
  function targetOfCandidate(c) {
    return candTargets[c.id] || (candTargets[c.id] = Object.assign({}, c, { cells: L.cellsInRing(g, c.ring) }));
  }
  function targetOfPoint(lon, lat) {
    return { lon, lat, cells: L.cellsInDisk(g, lon, lat, L.CLICK_RADIUS_M) };
  }
  function pickCandidate(id, byUser) {
    const c = cands.find((x) => x.id === id);
    if (!c) return;
    select(targetOfCandidate(c), byUser);
    showCompared();
  }
  /** 比べる表に並ぶ候補地が全部地図に入るようにする。拡大はしない（全体の見渡しを残す） */
  function showCompared() {
    const m = state.map; if (!m || !state.mapReady) return;
    const T = state.pins.concat(state.target && !state.pins.includes(state.target) ? [state.target] : []);
    const pts = T.flatMap((t) => (t.ring ? t.ring : [[t.lon, t.lat]]));
    if (!pts.length) return;
    const vb = m.getBounds();
    if (pts.every((p) => vb.contains(p))) return;
    m.fitBounds(bounds(pts), { padding: isMobile() ? 40 : 80, maxZoom: m.getZoom(), duration: 400 });
  }
  const bounds = (ring) => {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  };

  function buildPicker() {
    const sel = $('#pick');
    // 災害の該当なしを先に。造＝造成地（2020 植生→2026 裸地等）・遊＝遊休地（両年とも裸地等）
    const opt = (c) => { const h = state.hz[c.id] || []; return `<option value="${c.id}">${c.id}（${c.kind === 'dev' ? '造成地' : '遊休地'}）${c.ha} ha${h.length ? '・' + h.join('・') : ''}</option>`; };
    const none = cands.filter((c) => !(state.hz[c.id] || []).length), hit = cands.filter((c) => (state.hz[c.id] || []).length);
    sel.innerHTML = `<optgroup label="災害の該当なし（${none.length} 件）">${none.map(opt).join('')}</optgroup>`
      + `<optgroup label="洪水・土砂・津波・高潮に該当（${hit.length} 件）">${hit.map(opt).join('')}</optgroup>`
      + '<option value="point" disabled>地図で指した地点</option>';
    sel.addEventListener('change', () => pickCandidate(sel.value, true));
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
    const HEADS = ['用途', 'ID', '日付', '利用条件', '表記'];
    $('#datadlg-body').innerHTML = `<table><thead><tr><th>用途</th><th>データ・場面の ID</th><th>日付</th><th>利用条件</th><th>表記</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td data-th="${HEADS[i]}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table><p>衛星の窓・国土数値情報・OSM は取得（GET のみ）して加工し、処理済みの格子の集計値だけを同梱している。範囲は 経度 ${g.w}〜${g.e}・緯度 ${g.s}〜${g.n}。格子は ${g.d} 度（約 23〜28 m）。使わないデータ: 非商用（P03・L05・P20・A30b）、利用条件が不明のもの（JAXA 土地被覆・活断層・J-SHIS・液状化・空容量マップ）。</p>`;
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
    // 背景タイルが読めない環境でも、候補地・層・確認項目は使える。その旨を小さく出す
    let tileErr = 0;
    m.on('error', (e) => { if (e && e.sourceId === 'gsi' && ++tileErr >= 3) $('#tilewarn').hidden = false; });
    // 全体表示では印を小さくして重なりを減らす（拡大すると元の大きさ）
    const zcls = () => { const z = m.getZoom(); m.getContainer().classList.toggle('zlow', z < 11.3); };
    m.on('zoom', zcls); m.on('load', zcls);
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
        const h = state.hz[c.id] || [];
        const el = document.createElement('div'); el.className = 'cand-mk ' + c.kind; el.innerHTML = `${esc(c.id)}<i class="hzd h${Math.min(2, h.length)}">${h.length}</i>`;
        el.title = `${c.id}：${kindLabel(c)} 約 ${c.ha} ha。${h.length ? h.join('・') + 'に該当' : '浸水・土砂・津波・高潮の該当なし'}`;
        el.querySelector('.hzd').title = h.length ? `災害の該当 ${h.length} 種（${h.join('・')}）` : '災害の該当なし';
        el.addEventListener('click', (ev) => { ev.stopPropagation(); pickCandidate(c.id, true); });
        state.markers[c.id] = el;
        new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(m);
      });
      state.mapReady = true;
      $('#loading').hidden = true;
      if (state.target) select(state.target);
    });
    m.on('click', (e) => {
      if (!state.mapReady) return;
      const { lng, lat } = e.lngLat;
      if (!L.cellOf(g, lng, lat)) return;
      const t = targetOfPoint(lng, lat); t.ptName = `指した点${++state.nPoint}`;
      const sel = $('#pick'); sel.querySelector('option[value="point"]').disabled = false;
      select(t, true);
    });
  }

  // ---- 起動 ----
  function init() {
    cands.forEach((c) => { state.hz[c.id] = hazHits(L.buildChecks(DATA, LAYERS, targetOfCandidate(c))).map((r) => r.label); });
    buildPicker();
    buildDataDialog();
    $('#credit').innerHTML = `<button type="button" class="credit-more">出典・詳細</button> ${esc(L.SCENES.insar.credit)}／Contains modified Copernicus Sentinel data [2020, 2026]／${esc(L.SCENES.landsat.credit)}／国土数値情報（CC BY 4.0）加工／© OpenStreetMap contributors（ODbL）／地理院タイル`;
    $('#credit .credit-more').addEventListener('click', () => $('#datadlg').showModal());
    document.querySelectorAll('#layers input[data-layer]').forEach((cb) => {
      if (cb.dataset.layer !== 'none') state.layerOn[cb.dataset.layer] = cb.checked;
      cb.addEventListener('change', () => {
        if (cb.type === 'radio') setSat(cb.dataset.layer); // 衛星の層は 1 つだけ
        else setLayer(cb.dataset.layer, cb.checked);
      });
    });
    setSat('lst');
    $('#btn-pin').addEventListener('click', togglePin);
    $('#jump').addEventListener('click', () => { const top = $('#checks .ttl').getBoundingClientRect().top + window.scrollY - 4; window.scrollTo({ top, behavior: 'smooth' }); });
    window.addEventListener('scroll', updateJump, { passive: true });
    window.addEventListener('resize', updateJump);
    $('#btn-home').addEventListener('click', () => state.map && state.map.fitBounds([[g.w, g.s], [g.e, g.n]], { padding: 10, duration: 400 }));
    $('#btn-data').addEventListener('click', () => $('#datadlg').showModal());
    const first = cands.find((c) => c.kind === 'dev') || cands[0];
    if (first) state.target = targetOfCandidate(first);
    // 比べる表の初期例：造成地と遊休地の先頭を 1 件ずつ
    const firstIdle = cands.find((c) => c.kind === 'idle');
    state.pins = [state.target, firstIdle && targetOfCandidate(firstIdle)].filter(Boolean);
    initMap();
    if (state.target) { $('#pick').value = first.id; render(state.target); }
    if (isMobile()) $('#legendbox').open = false;
    updateJump();
  }
  init();
})();
