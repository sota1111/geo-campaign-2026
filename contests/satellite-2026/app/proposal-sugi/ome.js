(function () {
  'use strict';
  const L = window.SugiLib, D = window.SUGI;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
  const f2 = (n) => (n == null ? '不明' : n.toFixed(2));
  const PAGE = 20;
  const state = { params: Object.assign({}, L.DEFAULTS), res: null, byCode: {}, sel: null, cand: new Set(), shown: PAGE, step: 1, mapReady: false };
  window.__sugi = state; // 画面確認・テスト用

  // ---- 計算と地図の色 ----
  const haCuts = L.bands(D.cells.map((r) => r[1]), 5);
  let idxCuts = [];
  // 区画の市町村・大字（国土地理院 逆ジオコーダで取得した data/muni.js）
  const MUNI = window.SUGI_MUNI || {};
  const muniOf = (r) => (MUNI[r.code] ? MUNI[r.code][1] : '');
  const placeText = (r) => { const m = MUNI[r.code]; return m ? m[1] + (m[2] ? ' ' + m[2] : '') : '市町村不明'; };
  const MUNI_LIST = (() => { const c = {}; Object.values(MUNI).forEach((m) => (c[m[1]] = (c[m[1]] || 0) + 1)); return Object.keys(c).sort((x, y) => c[y] - c[x]).map((k) => [k, c[k]]); })();
  function recompute() {
    state.res = L.buildRows(D, state.params);
    state.byCode = {};
    state.res.rows.forEach((r) => (state.byCode[r.code] = r));
    idxCuts = L.bands(state.res.ranked.map((r) => r.index), 5);
    state.shown = Math.min(Math.max(state.shown, PAGE), Math.max(state.res.ranked.length, PAGE));
    applyColors();
  }
  const bandIdx = (r) => (r.rank == null ? -1 : L.bandOf(r.index, idxCuts));

  // ---- 地図 ----
  let map = null;
  function applyColors() {
    if (!map || !state.mapReady) return;
    state.res.rows.forEach((r) => map.setFeatureState({ source: 'sugi', id: r.code }, { bandHa: L.bandOf(r.ha, haCuts), bandIdx: bandIdx(r) }));
    map.setPaintProperty('sugi-fill', 'fill-color', fillExpr(state.step === 1 ? 'bandHa' : 'bandIdx'));
    map.setFilter('cand-line', ['in', ['get', 'code'], ['literal', Array.from(state.cand)]]);
    map.setFilter('sel-line', ['==', ['get', 'code'], state.sel || '']);
    updateRing();
  }
  function fillExpr(key) {
    return ['match', ['coalesce', ['feature-state', key], 0], -1, '#c8c8c8', 0, '#d6e6f2', 1, '#8fbcdc', 2, '#f2c58a', 3, '#e08a3a', 4, '#b34d00', '#c8c8c8'];
  }
  function ringGeo() {
    const r = state.sel && state.byCode[state.sel];
    if (!r) return { type: 'FeatureCollection', features: [] };
    const pts = [], R = state.params.radiusKm * 1000;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      pts.push([r.lon + (R * Math.sin(a)) / (111320 * Math.cos((r.lat * Math.PI) / 180)), r.lat + (R * Math.cos(a)) / 111320]);
    }
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }] };
  }
  function updateRing() { const s = map && map.getSource('ring'); if (s) s.setData(ringGeo()); }

  function initMap() {
    const b = D.meta.bbox;
    map = new maplibregl.Map({
      container: 'map', attributionControl: false, dragRotate: false,
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'] } }, layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      bounds: [[b[0], b[1]], [b[2], b[3]]], fitBoundsOptions: { padding: 20 },
    });
    window.__sugiMap = map; // 画面確認用
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '地理院タイル（淡色地図） ／ 植生: 環境省 現存植生図2024 ／ MapLibre GL JS' }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('sugi', { type: 'geojson', data: D.geo, promoteId: 'code' });
      map.addSource('pop', { type: 'geojson', data: { type: 'FeatureCollection', features: D.pop.map((p) => ({ type: 'Feature', properties: { n: p[2] }, geometry: { type: 'Point', coordinates: [p[1], p[0]] } })) } });
      map.addSource('ring', { type: 'geojson', data: ringGeo() });
      map.addLayer({ id: 'pop-circle', type: 'circle', source: 'pop', layout: { visibility: 'none' }, paint: { 'circle-color': '#4a4a4a', 'circle-opacity': 0.35, 'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 0, 0, 20, 2, 200, 5, 1500, 10] } });
      map.addLayer({ id: 'sugi-fill', type: 'fill', source: 'sugi', paint: { 'fill-color': fillExpr('bandHa'), 'fill-opacity': 0.82 } });
      map.addLayer({ id: 'sugi-edge', type: 'line', source: 'sugi', paint: { 'line-color': '#ffffff', 'line-width': 0.4, 'line-opacity': 0.8 } });
      map.addLayer({ id: 'cand-line', type: 'line', source: 'sugi', filter: ['in', ['get', 'code'], ['literal', []]], paint: { 'line-color': '#003a63', 'line-width': 3, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'sel-line', type: 'line', source: 'sugi', filter: ['==', ['get', 'code'], ''], paint: { 'line-color': '#000', 'line-width': 3.5 } });
      map.addLayer({ id: 'ring-line', type: 'line', source: 'ring', paint: { 'line-color': '#1d2b33', 'line-width': 1.5, 'line-dasharray': [3, 2] } });
      map.on('click', 'sugi-fill', (e) => { const f = e.features && e.features[0]; if (f) select(f.properties.code, { go: true }); });
      map.on('mouseenter', 'sugi-fill', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'sugi-fill', () => (map.getCanvas().style.cursor = ''));
      state.mapReady = true;
      applyColors();
      document.body.dataset.mapReady = '1';
    });
  }

  // ---- 選択・候補 ----
  function select(code, o) {
    state.sel = code;
    const r = state.byCode[code];
    if (map && r && o && o.fly) map.easeTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 14.5) });
    applyColors();
    if (o && o.go) setStep(3); else render();
  }
  function toggleCand(code) { if (state.cand.has(code)) state.cand.delete(code); else state.cand.add(code); applyColors(); render(); }

  // ---- 画面 ----
  function setStep(n) {
    state.step = n;
    document.querySelectorAll('#steps button').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.step === n)));
    for (let i = 1; i <= 4; i++) $('#s' + i).hidden = i !== n;
    applyColors(); render();
    $('#panel-body').scrollTop = 0;
  }
  const statusChip = (r) => {
    const s = L.satStatus(r, state.params.winterMin);
    return '<span class="chip ' + (r.ndviW == null ? 'na' : r.weak ? 'warn' : 'ok') + '">' + esc(s) + '</span>';
  };
  const legendHtml = (title, lo, hi) => '<div class="note">' + esc(title) + '</div><div class="grad"></div><div class="lg"><span>' + esc(lo) + '</span><span>' + esc(hi) + '</span></div>';

  function render1() {
    const rows = state.res.rows, ha = rows.reduce((a, r) => a + r.ha, 0), weak = rows.filter((r) => r.weak === true).length, na = rows.filter((r) => r.ndviW == null).length;
    const w = D.meta.wind, top = w.freq.map((f, i) => [f, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => w.dirs[x[1]] + ' ' + Math.round(x[0] * 100) + '%').join('・');
    const sc = D.meta.scenes;
    $('#s1').innerHTML = '<h2>スギ林を地図で把握する</h2>' +
      '<p>' + esc(D.meta.area) + '。環境省の植生図で「スギ・ヒノキ・サワラ植林」とされた林を、約500m四方の<b>区画</b>に分けて表示しています（色が濃いほど植林の面積が大きい区画）。</p>' +
      '<dl class="kv"><dt>区画の数</dt><dd>' + rows.length + '</dd><dt>植林の面積（合計）</dt><dd>約' + fmt(ha) + ' ha</dd>' +
      '<dt>衛星で見た冬の緑</dt><dd>冬NDVI ' + state.params.winterMin + ' 未満 <b>' + weak + '</b> 区画（要確認）／判定不可 ' + na + ' 区画</dd></dl>' +
      (weak ? '<details class="weak"><summary>「要確認」の ' + weak + ' 区画を見る（冬／夏の緑の濃さ）</summary><ul>' + rows.filter((r) => r.weak === true).sort((a, b) => a.ndviW - b.ndviW).map((r) => '<li><button class="btn" type="button" data-weak="' + r.code + '">区画 ' + r.code + '</button> 冬 ' + f2(r.ndviW) + '／夏 ' + f2(r.ndviS) + '・' + r.ha.toFixed(1) + ' ha</li>').join('') + '</ul><p class="note">押すと、その区画の根拠を開きます。冬だけ低い区画は落葉樹の林、冬も夏も低い区画は伐採跡地や林でない土地の可能性があります（現地で確かめる）。</p></details>' : '') +
      '<p class="note">衛星（Sentinel-2、冬 ' + esc(sc.w.date) + '／夏 ' + esc(sc.s.date) + '）は、植生図が古い調査に基づくため、いまも常緑の林が残っているかの確認に使います。落葉樹は冬に緑が落ちるので、冬のNDVIが高い区画は常緑樹林と整合します。</p>' +
      '<div class="row"><label><input type="checkbox" id="c-pop"' + (map && state.mapReady && map.getLayoutProperty('pop-circle', 'visibility') === 'visible' ? ' checked' : '') + '> 人口メッシュ（250m、灰色の丸）も表示</label></div>' +
      legendHtml('植林の面積（区画あたり）', '小', '大（最大約26 ha）') +
      '<p class="note">花粉の時期（' + w.months.join('・') + '月）の風は、' + esc(w.station) + 'で ' + esc(top) + ' の方向から吹く日が多い（最多風向の日数割合）。地図の区画をクリックすると根拠を確認できます。</p>' +
      '<p><button class="btn pri" type="button" id="go2">風下の人口で順位付けする</button></p>';
    $('#go2').onclick = () => setStep(2);
    document.querySelectorAll('[data-weak]').forEach((b) => (b.onclick = () => select(b.dataset.weak, { go: true, fly: true })));
    $('#c-pop').onchange = (e) => { if (map && state.mapReady) map.setLayoutProperty('pop-circle', 'visibility', e.target.checked ? 'visible' : 'none'); };
  }

  function render2() {
    const p = state.params, R = state.res;
    const flt = state.office ? R.ranked.filter((r) => muniOf(r) === state.office) : R.ranked;
    const list = flt.slice(0, state.shown);
    const sel = (id, opts, cur) => '<select id="' + id + '">' + opts.map((o) => '<option value="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    $('#s2').innerHTML = '<h2>風下の人口で順位付けする</h2>' +
      '<p>各区画の周囲の人口を、<b>風下になりやすい方角ほど重く</b>数えた「風下人口指数」を出し、植林の面積（ha）を掛けた「優先度指数」の高い順に並べます。</p>' +
      '<div class="row"><label>人口を数える半径 ' + sel('p-radius', [[1, '1 km'], [2, '2 km'], [3, '3 km'], [5, '5 km']], p.radiusKm) + '</label>' +
      '<label>並び順 ' + sel('p-sort', [['index', '優先度指数（人口×面積）'], ['down', '風下人口指数'], ['ha', '植林の面積']], p.sortKey) + '</label></div>' +
      '<div class="row"><label><input type="checkbox" id="p-wind"' + (p.useWind ? ' checked' : '') + '> 風向を使う</label><small class="hint">花粉の時期に風下になりやすい方角の人を多めに数えます。外すと、どの方角の人も同じに数えます。</small></div>' +
      '<div class="row"><label><input type="checkbox" id="p-weak"' + (p.excludeWeak ? ' checked' : '') + '> 衛星で「冬の緑が弱い」区画を除く</label><small class="hint">冬の衛星画像で緑が薄い区画（すでに伐採済み・落葉樹の可能性。' + state.params.winterMin + '未満の区画）を順位から外します。</small></div>' +
      '<p class="note">半径・しきい値は説明用の仮置きで、根拠のある値ではありません。担当者が見直す前提です。</p>' +
      '<div class="row"><label>市町村で絞る ' + sel('p-office', [['', 'すべての市町村']].concat(MUNI_LIST.map((m) => [m[0], m[0] + '（' + m[1] + '区画）'])), state.office || '') + '</label></div>' +
      '<p class="note">' + (state.office ? esc(state.office) + 'の ' + flt.length + ' 区画。順位の列は、太字が' + esc(state.office) + 'の中での順位、小さな字が全体での順位です（除外中の区画は出ません）' : R.ranked.length + ' 区画を表示（全 ' + R.rows.length + '）') + '。区画の下の小さな字は、区画の中心がある市町村と大字です。</p>' +
      '<p class="note"><b>表の行を押すと、その区画の「なぜこの順位か」が開きます。右端の「候補に」で、その場で植え替え候補に入れられます。</b>区画は植生図の「スギ・ヒノキ・サワラ植林」で、スギだけではありません。衛星で「要確認」の区画には印が付きます（一覧は「1 把握」にあります）。</p>' +
      '<table id="rank"><thead><tr><th class="n">順位</th><th>区画</th><th class="n">面積<br>ha</th><th class="n">' + (p.useWind ? '風下人口<br>指数' : '周囲の人口<br>（風向なし）') + '</th><th class="n">優先度<br>指数</th><th>候補</th></tr></thead><tbody>' +
      list.map((r) => '<tr tabindex="0" data-code="' + r.code + '"' + (r.code === state.sel ? ' class="sel"' : '') + '><td class="n">' + (state.office ? '<b>' + (flt.indexOf(r) + 1) + '</b><br><small>全体 ' + r.rank + '</small>' : r.rank) + '</td><td>' + r.code + '<br><small>' + esc(placeText(r)) + '</small>' + (state.cand.has(r.code) ? ' <span class="chip ok">候補</span>' : '') + (r.weak ? ' <span class="chip warn">要確認</span>' : '') + '</td><td class="n">' + r.ha.toFixed(1) + '</td><td class="n">' + fmt(r.down) + '</td><td class="n">' + fmt(r.index) + '</td><td><button class="btn" type="button" data-addc="' + r.code + '" aria-label="区画' + r.code + 'を植え替え候補' + (state.cand.has(r.code) ? 'から外す' : 'に入れる') + '">' + (state.cand.has(r.code) ? '外す' : '候補に') + '</button></td></tr>').join('') +
      '</tbody></table>' +
      (state.shown < flt.length ? '<p><button class="btn" type="button" id="more">さらに ' + PAGE + ' 件表示</button></p>' : '') +
      legendHtml('地図の色：優先度指数（区画の分位）', '低', '高') + '<p class="note">灰色は除外した区画です。</p>';
    $('#p-radius').onchange = (e) => { state.params.radiusKm = +e.target.value; recompute(); render(); };
    $('#p-sort').onchange = (e) => { state.params.sortKey = e.target.value; recompute(); render(); };
    $('#p-office').onchange = (e) => {
      state.office = e.target.value; state.shown = PAGE; render();
      const rs = state.res.rows.filter((r) => !state.office || muniOf(r) === state.office);
      if (map && rs.length) {
        const lo = rs.map((r) => r.lon), la = rs.map((r) => r.lat);
        map.fitBounds([[Math.min.apply(null, lo) - 0.005, Math.min.apply(null, la) - 0.005], [Math.max.apply(null, lo) + 0.005, Math.max.apply(null, la) + 0.005]], { padding: 30, maxZoom: 14 });
      }
    };
    $('#p-wind').onchange = (e) => { state.params.useWind = e.target.checked; recompute(); render(); };
    $('#p-weak').onchange = (e) => { state.params.excludeWeak = e.target.checked; recompute(); render(); };
    document.querySelectorAll('[data-addc]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleCand(b.dataset.addc); }));
    document.querySelectorAll('#rank tbody tr').forEach((tr) => {
      const go = () => select(tr.dataset.code, { go: true, fly: true });
      tr.onclick = (e) => { if (e.target.closest('button')) return; go(); }; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    if ($('#more')) $('#more').onclick = () => { state.shown += PAGE; render(); };
  }

  function render3() {
    const r = state.sel && state.byCode[state.sel], el = $('#s3');
    if (!r) { el.innerHTML = '<h2>区画の根拠を確認する</h2><p>地図の区画、または「順位」の表の行を選ぶと、順位の根拠が表示されます。</p><p><button class="btn" type="button" id="back2">順位の表へ</button></p>'; $('#back2').onclick = () => setStep(2); return; }
    const p = state.params, f = L.normFreq(D.meta.wind.freq);
    const max = Math.max.apply(null, r.byDir.concat([1]));
    const bars = L.DIRS.map((d, i) => {
      const w = p.useWind ? f[L.windIndexFor(i * 22.5)] * 16 : 1;
      return '<div class="b"><span>' + d + '</span><span class="track"><span class="fill" style="width:' + (r.byDir[i] / max * 100).toFixed(1) + '%"></span><span class="wind" style="width:' + Math.min(100, (w / 3) * 100).toFixed(1) + '%"></span></span><span>' + fmt(r.byDir[i]) + '人 ×' + w.toFixed(1) + '</span></div>';
    }).join('');
    const inCand = state.cand.has(r.code);
    // 平易な一言: 風で重みを付けた人口の多い上位2方角
    const wsum = L.DIRS.map((d, i) => [d, r.byDir[i] * (p.useWind ? f[L.windIndexFor(i * 22.5)] * 16 : 1), r.byDir[i], p.useWind ? f[L.windIndexFor(i * 22.5)] * 16 : 1]).sort((a, b) => b[1] - a[1]).slice(0, 2).filter((x) => x[2] > 0);
    const why = r.rank == null ? 'この区画はいまの条件では除外されています（' + statusChip(r) + '）。' :
      '半径' + p.radiusKm + 'kmの中に約' + fmt(r.within) + '人が住んでいます。' +
      (wsum.length ? (p.useWind ? '人数に風下のなりやすさを掛けると、' : '人口の多い') + '方角（' + wsum.map((x) => x[0] + ' 約' + fmt(x[2]) + '人' + (p.useWind ? '×' + x[3].toFixed(1) : '')).join('、') + '）が大きく、' : '') +
      '植林も ' + r.ha.toFixed(1) + ' ha あります。「風下に住む人の多さ × 林の広さ」で比べると、全体の ' + state.res.ranked.length + ' 区画中 ' + r.rank + ' 位' +
      (muniOf(r) ? '、' + esc(muniOf(r)) + 'の中では ' + (state.res.ranked.filter((x) => muniOf(x) === muniOf(r)).indexOf(r) + 1) + ' 位' : '') + 'です。';
    el.innerHTML = '<h2>区画 ' + r.code + '</h2><p class="note">場所: ' + esc(placeText(r)) + '（直線）</p>' +
      '<p><span class="big">' + (r.rank == null ? '除外中' : r.rank + ' 位') + '</span> ／ ' + state.res.ranked.length + ' 区画中</p>' +
      '<div class="why"><b>なぜこの順位か：</b>' + why + '</div>' +
      '<dl class="kv"><dt>植林の面積</dt><dd>' + r.ha.toFixed(1) + ' ha（植生図の「スギ・ヒノキ・サワラ植林」）</dd>' +
      '<dt>半径' + p.radiusKm + 'km内の人口</dt><dd>' + fmt(r.within) + ' 人（国勢調査2020、250mメッシュ）</dd>' +
      '<dt>風下人口指数</dt><dd>' + fmt(r.down) + (p.useWind ? '（風向で重み付け）' : '（風向なし）') + '<br><small>花粉が飛んでいきやすい方角に住む人の多さ。風下になりやすい方角の人を多めに数えた人数です。</small></dd>' +
      '<dt>優先度指数</dt><dd>' + fmt(r.index) + '（風下人口指数 × 面積）' + (state.res.ranked.length ? '＝最も大きい区画の ' + Math.round(r.index / Math.max.apply(null, state.res.ranked.map((x) => x.index)) * 100) + '%' : '') + '<br><small>順位を決めるための相対的な値で、単位はありません。他の区画と比べるためのもので、大きいほど上位です（説明用の仮置きの式）。</small></dd>' +
      '<dt>冬NDVI／夏NDVI</dt><dd>' + f2(r.ndviW) + ' ／ ' + f2(r.ndviS) + '（Sentinel-2、植林部分の平均）<br><small>NDVI＝衛星で見た緑の濃さ（0〜1）。冬も高ければ、葉を落とさない針葉樹（スギ・ヒノキなど）の林が残っていると考えられます。</small></dd>' +
      '<dt>衛星での確認</dt><dd>' + statusChip(r) + '</dd></dl>' +
      '<h3 style="font-size:13px;margin:8px 0 2px">周囲の人口と風下のなりやすさ</h3>' +
      '<p class="note">青の棒＝区画から見てその方角にいる人口。橙の線と「×」＝その方角が風下になる程度（×1.0 が全方位の平均、×3.0 は平均の3倍風下になりやすい）。花粉の時期の最多風向の日数から出しています。人数がいちばん多い方角でも、×が小さければ（風下になりにくければ）重みは小さくなります。</p>' +
      '<div class="bars" aria-label="方角別の人口と風下のなりやすさ">' + bars + '</div>' +
      '<p class="note">地図の点線の円が人口を数えている範囲です。この指数は説明用で、花粉の飛散量・健康への影響・対策の効果を示す値ではありません。現地の樹種・林齢・所有・地形は別の確認が必要です。</p>' +
      '<p><button class="btn pri" type="button" id="b-cand">' + (inCand ? '植え替え候補から外す' : '植え替え候補に入れる') + '</button> <button class="btn" type="button" id="b-out">候補の出力へ（' + state.cand.size + '件）</button></p>';
    $('#b-cand').onclick = () => toggleCand(r.code);
    $('#b-out').onclick = () => setStep(4);
  }

  function candList() { return state.res.rows.filter((r) => state.cand.has(r.code)).sort((a, b) => (a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank) || (a.code < b.code ? -1 : 1)); }
  function render4() {
    const list = candList();
    $('#s4').innerHTML = '<h2>植え替え候補をCSVで出す</h2>' +
      '<p>「根拠」で入れた候補、または上位から一括で入れた候補を、順位・面積・人口・衛星の状態つきでCSVにします。現地確認や所有者の確認の前の<b>候補</b>です。</p>' +
      '<div class="row"><label>上位から <input type="number" id="topn" min="1" max="100" value="' + (state.topn || 10) + '" style="width:5em"> 件</label><button class="btn" type="button" id="b-top">候補に入れる</button><button class="btn" type="button" id="b-clear"' + (list.length ? '' : ' disabled') + '>候補を全て外す</button></div>' +
      '<p><b id="cand-count">' + list.length + '</b> 件の候補</p><p class="note">候補はこの画面の中だけに保持され、ページを閉じると消えます。残すには下の「候補をCSVで書き出す」でファイルに保存してください（外部へは送信しません）。</p>' +
      (list.length ? '<table><thead><tr><th class="n">順位</th><th>区画</th><th class="n">面積ha</th><th class="n">優先度指数</th><th></th></tr></thead><tbody>' + list.map((r) => '<tr data-code="' + r.code + '"><td class="n">' + (r.rank == null ? '除外' : r.rank) + '</td><td>' + r.code + '</td><td class="n">' + r.ha.toFixed(1) + '</td><td class="n">' + fmt(r.index) + '</td><td><button class="btn" type="button" data-rm="' + r.code + '" aria-label="区画' + r.code + 'を候補から外す">外す</button></td></tr>').join('') + '</tbody></table>' : '<p class="note">まだ候補がありません。</p>') +
      '<p><button class="btn pri" type="button" id="b-csv"' + (list.length ? '' : ' disabled') + '>候補をCSVで書き出す</button></p><p id="csv-msg" class="saved" role="status" hidden></p>' +
      '<p class="note">CSVには、条件（半径・風向）と、データが実データの加工値で指数が説明用である旨を入れています。</p>';
    $('#b-top').onclick = () => {
      const n = Math.max(1, Math.min(100, +$('#topn').value || 10));
      state.topn = n;
      state.res.ranked.slice(0, n).forEach((r) => state.cand.add(r.code));
      applyColors(); render();
    };
    $('#b-clear').onclick = () => { state.cand.clear(); applyColors(); render(); };
    $('#b-csv').onclick = () => download('sugi-replant-candidates.csv', L.toCsv(candList(), state.params, D.meta));
    document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => toggleCand(b.dataset.rm)));
    document.querySelectorAll('#s4 tbody tr').forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('button')) return; select(tr.dataset.code, { go: true, fly: true }); }));
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    const m = $('#csv-msg');
    if (m) { m.hidden = false; m.textContent = '「' + name + '」を保存しました（' + candList().length + ' 件。ブラウザのダウンロード先に入ります。Excel で開けます）。'; }
  }
  function render() { [null, render1, render2, render3, render4][state.step](); }

  // ---- 出典モーダル ----
  function about() {
    const m = D.meta, sc = m.scenes, w = m.wind;
    $('#about-body').innerHTML =
      '<p><b>このデモに架空のデータはありません。</b>すべて公開データを加工したものです。優先度指数・半径・冬NDVIのしきい値は説明用の仮置きで、根拠のある値ではありません。</p>' +
      '<h3>データと出典</h3><ul>' +
      '<li>植林の位置: 環境省 生物多様性センター「現存植生図2024」関東ブロック、凡例「スギ・ヒノキ・サワラ植林」（調査年度 2000–2023。この範囲の作成年度は2000〜2011）。生物多様性センター利用規約（CC BY 互換）。スギ単独ではなく、ヒノキ・サワラを含む区分です。</li>' +
      '<li>人口: 政府統計の総合窓口（e-Stat）地域メッシュ統計 250mメッシュ（統計表ID T001102）の人口総数（令和2年国勢調査）。秘匿セルは ' + m.popHidden + ' 件。</li>' +
      '<li>風向: 気象庁「過去の気象データ検索」' + esc(w.station) + 'の日ごとの最多風向、' + w.years.join('・') + '年の' + w.months.join('・') + '月（' + w.days + '日）。</li>' +
      '<li>衛星: Sentinel-2 L2A（ESA／Copernicus。Element 84 Earth Search の公開COG）。冬 ' + esc(sc.w.id) + '（' + esc(sc.w.date) + '）、夏 ' + esc(sc.s.id) + '（' + esc(sc.s.date) + '）。</li>' +
      '<li>背景地図: 国土地理院「地理院タイル（淡色地図）」。</li></ul>' +
      '<h3>計算方法</h3><ul>' +
      '<li>区画＝500mメッシュ（4次メッシュ）のうち植林を含むもの（' + m.cellDef + '）。</li>' +
      '<li>風下人口指数＝区画の中心から半径内にある250m人口メッシュの人口 × 重みの合計。重み＝その人口がいる方角が風下になる日の割合（最多風向の16方位の日数割合）×16。風向なしのときは全て1。</li>' +
      '<li>優先度指数＝風下人口指数 × 植林の面積（ha）。</li>' +
      '<li>衛星の確認＝植林部分のNDVI平均（雲・影・雪の画素は除く）。冬NDVIが0.5未満なら「要確認」（仮置き）。</li></ul>' +
      '<h3>限界</h3><ul>' +
      '<li>植生図は現地調査ベースで、調査年度が古い場所があります。伐採・植え替え済みの林が残っている可能性があります。</li>' +
      '<li>風向は1地点（青梅）・3年・日ごとの最多風向だけで、風速・地形による風の変化・花粉の飛散量は入っていません。</li>' +
      '<li>花粉が実際にどれだけ届くか、植え替えでどれだけ減るかは、このデモでは示しません。</li>' +
      '<li>区画は市町村・林班・所有の境界とは対応していません。実際の施業は森林簿・所有者・補助要件の確認が必要です。</li></ul>';
  }
  function openModal(open) { $('#modal').hidden = !open; if (open) { about(); $('#btn-close').focus(); } else $('#btn-about').focus(); }

  // ---- 起動 ----
  document.querySelectorAll('#steps button').forEach((b) => (b.onclick = () => setStep(+b.dataset.step)));
  $('#btn-about').onclick = () => openModal(true);
  $('#btn-close').onclick = () => openModal(false);
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') openModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) openModal(false); });
  $('#sheet-toggle').onclick = () => { const c = $('#panel').classList.toggle('closed'); $('#sheet-toggle').setAttribute('aria-expanded', String(!c)); if (map) setTimeout(() => map.resize(), 250); };
  recompute();
  render();
  initMap();
})();
