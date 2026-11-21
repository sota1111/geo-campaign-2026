(function () {
  'use strict';
  const K = window.KantoLib, D = window.SUGI_KANTO, C = D.cells, POP = window.SUGI_POP || null, V9 = window.SUGI_VERIFY9 || null;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.round(n).toLocaleString('ja-JP');
  const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString('ja-JP');
  const N = C.n.length;
  const state = { params: Object.assign({}, K.DEFAULTS), cls: null, sum: null, sel: null, muni: null, shown: 30, rshown: 15, mapReady: false, sc: null, rb: null, bs: null };
  window.__kanto = state; // 画面確認・テスト用

  // ---- 色と模様（色だけに頼らない） ----
  const COL = { 1: '#d95f02', 2: '#e6b800', 3: '#0e7a5f', 4: '#b9b9b9' };
  const INK = { 1: '#6b2c00', 2: '#5c4500', 3: '#03281e', 4: '#8a8a8a' };
  const SHORT = { 1: '伐る・植え替える（重点）', 2: '少花粉スギ等へ更新（伐採は次）', 3: '広葉樹林化・針広混交林', 4: '対象外・低優先' };
  // 区分1の中の順位の帯（濃い=先に着手）。色（茶→橙→薄橙）に加え、斜線の太さ・間隔でも区別する。
  const BCOL = { 1: '#4a1500', 2: '#d94801', 3: '#fd8d3c', 4: '#fdd0a2' };
  const BINK = { 1: '#ff9a4d', 2: '#3d1500', 3: '#7a3300', 4: '#a85a1f' };
  const BLW = { 1: 1.5, 2: 2, 3: 2, 4: 1.5 }, BGAP = { 1: 8, 2: 8, 3: 16, 4: 16 };
  function bandCanvas(b) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    g.fillStyle = BCOL[b]; g.fillRect(0, 0, 16, 16);
    g.strokeStyle = BINK[b]; g.lineWidth = BLW[b];
    for (let o = -16; o <= 16; o += BGAP[b]) { g.beginPath(); g.moveTo(o, 16); g.lineTo(o + 16, 0); g.stroke(); }
    return cv;
  }
  const BPAT = {}; [1, 2, 3, 4].forEach((b) => { BPAT[b] = bandCanvas(b); });
  const bswatch = (b) => 'background-image:url(' + BPAT[b].toDataURL() + ')';
  function patternCanvas(k) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    g.fillStyle = COL[k]; g.fillRect(0, 0, 16, 16);
    g.strokeStyle = INK[k]; g.fillStyle = INK[k]; g.lineWidth = 2;
    const line = (a, b, c, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };
    if (k === 1) { [-16, 0, 16].forEach((o) => line(o, 16, o + 16, 0)); [-8, 8, 24].forEach((o) => line(o, 16, o + 16, 0)); } // 斜線
    if (k === 2) { [[4, 4], [12, 12]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }); } // 点
    if (k === 3) { [-16, 0, 16].forEach((o) => { line(o, 16, o + 16, 0); line(o, 0, o + 16, 16); }); } // 格子（交差斜線）
    if (k === 4) { g.globalAlpha = 0.5; line(0, 8, 16, 8); } // 横線（薄い）
    return cv;
  }
  const PAT = {}; [1, 2, 3, 4].forEach((k) => { PAT[k] = patternCanvas(k); });
  const swatch = (k) => 'background-image:url(' + PAT[k].toDataURL() + ')';

  // ---- 集計・説明 ----
  const prefOf = (i) => D.meta.prefs[D.munis[C.muni[i]][1]];
  const muniName = (i) => D.munis[C.muni[i]][0];
  function recompute() {
    state.cls = K.classifyAll(D, state.params);
    state.sum = K.summarize(D, state.cls);
    state.sc = K.scores(D, POP, state.params, state.cls);
    state.rb = K.rankBands(D, state.cls, state.sc.S);
    state.bs = K.bandSummary(D, state.cls, state.rb.band);
  }
  const BANDS = K.RANK_BANDS;
  const bandName = (b) => BANDS[b - 1].name;
  function mainMeasure(b) { // 市町村・都県の「主な対策」: 区分1〜3のうち面積最大。無ければ4
    let best = 4, v = 0;
    [1, 2, 3].forEach((k) => { if (b[k] > v) { v = b[k]; best = k; } });
    return best;
  }
  function bar(b) {
    const tot = b[1] + b[2] + b[3] + b[4] || 1;
    return '<div class="bar" role="img" aria-label="区分の内訳">' + [1, 2, 3, 4].map((k) => '<i style="width:' + (b[k] / tot * 100).toFixed(1) + '%;' + swatch(k) + ';background-size:8px 8px"></i>').join('') + '</div>';
  }
  function explain(i) {
    const p = state.params, k = state.cls[i], ha = C.n[i] * K.CELL_HA;
    const mature = (p.age === 21 ? C.n21[i] : C.n26[i]) * K.CELL_HA;
    const o = D.origins[C.org[i]];
    const inZone = D.munis[C.muni[i]][2] === 1, inRange = C.dist[i] <= p.radiusKm;
    const why = [];
    if (k === 4) {
      if (ha < p.minHa) why.push('スギ人工林が ' + f1(ha) + ' ha で、まとまった林とみなす ' + p.minHa + ' ha 未満（<span class="chip prov">仮</span>）');
      if (!inRange && !inZone) why.push('50km圏の外（最寄りの起点 ' + esc(o[0]) + ' まで ' + f1(C.dist[i]) + ' km）で、重点区域の市町村でもない');
    } else {
      why.push(inRange ? '50km圏の内側（最寄りの起点 ' + esc(o[0]) + '〔' + esc(o[2]) + '〕まで ' + f1(C.dist[i]) + ' km）' : '50km圏の外だが、林野庁の重点区域がある市町村');
      why.push('スギ人工林 ' + f1(ha) + ' ha（' + p.minHa + ' ha 以上＝まとまった林。<span class="chip prov">仮</span>）');
      if (k === 3) why.push('平均傾斜 ' + f1(C.slope[i]) + '度 ≧ ' + p.slopeMax + '度（<span class="chip prov">仮</span>）→ 林業を続けにくい条件不利地とみなす');
      else why.push('平均傾斜 ' + (C.slope[i] < 0 ? '不明' : f1(C.slope[i]) + '度') + '（' + p.slopeMax + '度未満＝林業を続けられる適地とみなす。<span class="chip prov">仮</span>）');
      why.push(p.age + '年生以上のスギ ' + f1(mature) + ' ha（林齢は森林簿の値。' + (k === 2 ? '過半に届かない' : '過半以上') + '）');
    }
    return why;
  }
  function rankLines(i) {
    if (state.cls[i] !== 1) return '';
    const b = state.rb.band[i], p = state.params, sc = state.sc, a = (p.age === 21 ? C.n21[i] : C.n26[i]) * K.CELL_HA;
    const x = sc.x[i];
    return '<div class="fact"><b><span class="sw sm" style="' + bswatch(b) + '"></span> 区分1の中の順位: ' + bandName(b) + '（面積で数えて上位 ' + f1(state.rb.pct[i] * 100) + '% から）</b><br>' +
      (sc.pop ? p.age + '年生以上のスギ ' + f1(a) + ' ha × 半径 ' + p.rankKm + ' km 内の人口 約' + fmt(x) + ' 人（令和2年国勢調査の250mメッシュ人口）' : '人口は使っていない。' + p.age + '年生以上のスギ ' + f1(a) + ' ha × 最寄りの起点までの近さ ' + f1(x) + '（1−距離/50）') +
      '<br><span class="note">「人に届きやすい発生源の順位」（作成者の式。半径は<span class="chip prov">仮</span>）。花粉の量や対策の成果を示すものではありません。</span></div>';
  }
  function cellCard(i) {
    const k = state.cls[i], c = K.CLASSES[k], z = D.munis[C.muni[i]][2] === 1;
    return '<div class="sel-box"><h3>' + esc(muniName(i)) + '（' + esc(prefOf(i)) + '）' + (z ? ' <span class="chip zone">重点区域あり</span>' : '') + '</h3>' +
      '<p class="big"><span class="sw" style="' + swatch(k) + '"></span> ' + esc(c.name) + '</p><p>' + esc(c.todo) + '</p>' +
      '<ul style="margin:4px 0;padding-left:18px">' + explain(i).map((t) => '<li>' + t + '</li>').join('') + '</ul>' +
      rankLines(i) + '<p class="note">根拠: ' + esc(c.basis) + '</p></div>';
  }
  function popupHtml(i) {
    const k = state.cls[i], b = state.rb.band[i];
    return '<b>' + esc(muniName(i)) + '（' + esc(prefOf(i)) + '）</b><br><span class="sw" style="' + (k === 1 ? bswatch(b) : swatch(k)) + '"></span> ' + esc(K.CLASSES[k].name) + (k === 1 ? '<br>区分1の中: ' + esc(bandName(b)) : '') + '<br>' + esc(K.CLASSES[k].todo);
  }

  // ---- 描画: パネル ----
  function renderLegend() {
    const S = state.sum;
    $('#legend-rows').innerHTML = [1, 2, 3, 4].map((k) => {
      const c = K.CLASSES[k], prov = (k === 3 || k === 4) ? ' <span class="chip prov">基準は仮</span>' : '';
      return '<div class="lg-row"><span class="sw" style="' + swatch(k) + '"></span><div><b>' + k + ' ' + esc(c.name) + '</b>' + prov + ' <span class="ha">' + fmt(S.tot[k]) + ' ha</span><div class="todo">' + esc(c.todo) + '</div><div class="basis">根拠: ' + esc(c.basis) + '</div>' + (k === 1 ? '<div class="basis"><b>この中の着手順は、下の「区分1の中の順位」で濃淡と斜線の太さで示す。</b></div>' : '') + '</div></div>';
    }).join('');
    $('#mini').innerHTML = '<div><span class="sws">' + BANDS.map((r) => '<span class="sw sm" style="' + bswatch(r.k) + '"></span>').join('') + '</span>' + esc(SHORT[1]) + '：濃いほど先に</div>' + [2, 3, 4].map((k) => '<div><span class="sw" style="' + swatch(k) + '"></span>' + esc(SHORT[k]) + '</div>').join('');
  }
  function renderTotals() {
    const S = state.sum, A = D.zone.areasHa;
    let rows = D.meta.prefs.map((n, i) => { const b = S.byPref[i]; return '<tr><td>' + esc(n) + '</td>' + [1, 2, 3, 4].map((k) => '<td class="n">' + fmt(b[k]) + '</td>').join('') + '<td class="n">' + fmt(b.all) + '</td><td class="n">' + fmt(A[n]) + '</td></tr>'; }).join('');
    const tot = [1, 2, 3, 4].map((k) => '<td class="n">' + fmt(S.tot[k]) + '</td>').join('');
    const all = [1, 2, 3, 4].reduce((s, k) => s + S.tot[k], 0), zsum = Object.values(A).reduce((s, v) => s + v, 0);
    rows += '<tr><th>計</th>' + tot.replace(/<td/g, '<th').replace(/<\/td>/g, '</th>') + '<th class="n">' + fmt(all) + '</th><th class="n">' + fmt(zsum) + '</th></tr>';
    $('#tot-body').innerHTML = '<table><thead><tr><th>都県</th>' + [1, 2, 3, 4].map((k) => '<th class="n"><span class="sw" style="width:14px;height:10px;' + swatch(k) + '"></span>' + k + '</th>').join('') + '<th class="n">スギ計</th><th class="n">林野庁の重点区域</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="note">単位は ha。1〜4 はこの地図の区分（スギ人工林の面積。まとまりの基準未満の小さな林は区分4に入る）。「林野庁の重点区域」は、林野庁の表（' + esc(D.zone.asof) + '）の都県ごとの面積で、ポリゴンは公開されていないため、地図の区分とは重ならない別の数字です。表の面積に国有林が含まれるかは未確認。スギ計は全国森林資源メッシュの「林種=人工林・樹種1=スギ」の合計で、混交林の2番目以下の樹種は入りません。</p>';
  }
  function renderPlaces() {
    const S = state.sum, pf = $('#f-pref').value, q = $('#f-q').value.trim();
    let list = D.munis.map((m, idx) => ({ idx, m, b: S.byMuni[idx] })).filter((r) => r.b.all > 0);
    if (pf !== '') list = list.filter((r) => r.m[1] === +pf);
    if (q) list = list.filter((r) => r.m[0].includes(q));
    list.sort((a, b) => (b.b[1] + b.b[3] + b.b[2]) - (a.b[1] + a.b[3] + a.b[2]) || b.b.all - a.b.all);
    const shown = list.slice(0, state.shown);
    const rows = shown.map((r) => {
      const k = mainMeasure(r.b), z = r.m[2] === 1;
      return '<tr data-m="' + r.idx + '" tabindex="0" class="' + (state.muni === r.idx ? 'sel' : '') + '"><td>' + esc(r.m[0]) + '<br><span class="note">' + esc(D.meta.prefs[r.m[1]]) + '</span>' + (z ? ' <span class="chip zone">重点区域</span>' : '') + '</td><td><span class="sw" style="width:16px;height:12px;' + swatch(k) + '"></span> ' + esc(SHORT[k]) + '</td><td>' + bar(r.b) + '</td><td class="n">' + fmt(r.b.all) + '</td></tr>';
    }).join('');
    $('#places-body').innerHTML = (list.length ? '<table><thead><tr><th>市町村</th><th>主な対策</th><th>内訳</th><th class="n">スギ ha</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="note">該当する市町村がありません。</p>') +
      (list.length > shown.length ? '<button type="button" class="btn" id="more">さらに表示（' + shown.length + ' / ' + list.length + '）</button>' : '') +
      '<p class="note">行をクリックすると地図がその市町村に移ります。「主な対策」は区分1〜3のうち面積が最大のもの。内訳の棒は区分1〜4の面積の割合。並びは、区分1〜3（対象域）の面積が大きい順。</p>';
    $('#places-body').querySelectorAll('tr[data-m]').forEach((tr) => {
      const go = () => selectMuni(+tr.dataset.m, true);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    const more = $('#more'); if (more) more.addEventListener('click', () => { state.shown += 30; renderPlaces(); });
  }
  // ---- 区分1の中の順位 ----
  function bandBar(v) {
    const t = v[1] + v[2] + v[3] + v[4] || 1;
    return '<div class="bar" role="img" aria-label="区分1の順位の帯の内訳">' + [1, 2, 3, 4].map((b) => '<i style="width:' + (v[b] / t * 100).toFixed(1) + '%;' + bswatch(b) + ';background-size:8px 8px"></i>').join('') + '</div>';
  }
  function renderRank() {
    const bs = state.bs, tot = bs.tot[1] + bs.tot[2] + bs.tot[3] + bs.tot[4], p = state.params, pop = state.sc.pop;
    const rows = BANDS.map((r) => '<div class="lg-row"><span class="sw" style="' + bswatch(r.k) + '"></span><div><b>' + esc(r.name) + '</b>（' + esc(r.short) + '） <span class="ha">' + fmt(bs.tot[r.k]) + ' ha</span> <span class="note">区分1の' + (tot ? (bs.tot[r.k] / tot * 100).toFixed(0) : 0) + '%</span></div></div>').join('');
    const pf = $('#r-pref').value;
    let list = D.munis.map((m, idx) => ({ idx, m, v: bs.byMuni[idx] })).filter((r) => r.v[1] + r.v[2] + r.v[3] + r.v[4] > 0);
    if (pf !== '') list = list.filter((r) => r.m[1] === +pf);
    list.sort((a, b) => b.v[1] - a.v[1] || b.v[2] - a.v[2] || b.v[3] - a.v[3] || b.v[4] - a.v[4]);
    const shown = list.slice(0, state.rshown);
    const trs = shown.map((r, n) => '<tr data-m="' + r.idx + '" tabindex="0" class="' + (state.muni === r.idx ? 'sel' : '') + '"><td class="n">' + (n + 1) + '</td><td>' + esc(r.m[0]) + '<br><span class="note">' + esc(D.meta.prefs[r.m[1]]) + '</span></td><td class="n">' + fmt(r.v[1]) + '</td><td class="n">' + fmt(r.v[1] + r.v[2]) + '</td><td class="n">' + fmt(r.v[1] + r.v[2] + r.v[3] + r.v[4]) + '</td><td>' + bandBar(r.v) + '</td></tr>').join('');
    const prefRows = D.meta.prefs.map((n, i) => '<tr><td>' + esc(n) + '</td>' + [1, 2, 3, 4].map((b) => '<td class="n">' + fmt(bs.byPref[i][b]) + '</td>').join('') + '</tr>').join('');
    $('#rank-body').innerHTML =
      (pop ? '' : '<div class="warn"><b>人口は使っていない。</b>人口データを読み込めなかったため、代わりに「最寄りの起点までの近さ（1−距離/50、0以上）」で点数を付けています。</div>') +
      '<p>区分1（' + fmt(tot) + ' ha）を、<b>人に届きやすい発生源の順位</b>（作成者の式。仮）で4つの帯に分けました。面積で数えた百分位で、<b>濃く太い斜線ほど先に手を付ける候補</b>です。</p>' + rows +
      '<table class="small"><thead><tr><th>都県</th>' + BANDS.map((r) => '<th class="n"><span class="sw sm" style="' + bswatch(r.k) + '"></span>' + esc(r.name.replace('上位', '').replace('（下位40%）', '')) + '</th>').join('') + '</tr></thead><tbody>' + prefRows + '</tbody></table><p class="note">単位は ha。林齢は ' + p.age + '年生以上、人口を数える半径は ' + p.rankKm + ' km（仮）の設定での値。</p>' +
      '<h3 class="h3">市町村の並び（上位10%の面積が大きい順）</h3>' +
      (list.length ? '<table><thead><tr><th class="n">#</th><th>市町村</th><th class="n">上位10% ha</th><th class="n">上位30%まで ha</th><th class="n">区分1 ha</th><th>帯の内訳</th></tr></thead><tbody>' + trs + '</tbody></table>' : '<p class="note">該当する市町村がありません。</p>') +
      (list.length > shown.length ? '<button type="button" class="btn" id="r-more">さらに表示（' + shown.length + ' / ' + list.length + '）</button>' : '') +
      '<p class="note">行をクリックすると地図がその市町村に移ります。「上位30%まで」は上位10%と10〜30%の合計。市町村の並びは帯の面積で決めた目安で、市町村全体の優先度ではありません。</p>';
    $('#rank-body').querySelectorAll('tr[data-m]').forEach((tr) => {
      const go = () => selectMuni(+tr.dataset.m, true);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    const more = $('#r-more'); if (more) more.addEventListener('click', () => { state.rshown += 15; renderRank(); });
  }
  // 順位の検証・感度（東京都12地点の9年分）。R を観測に合わせて選び直さない（初期値20kmは固定）。
  function renderRankCheck() {
    const el = $('#rank-check-body');
    if (!state.sc.pop || !V9) { el.innerHTML = '<p class="note">人口を使っていないため、この照合は行いません。</p>'; return; }
    const p = state.params, mat = (i) => (p.age === 21 ? C.n21[i] : C.n26[i]) * K.CELL_HA;
    const cum = V9.sites.map((s) => D.verify.tokyo.sites.find((x) => x.name === s.name).cum);
    const per = K.RANK_RADII.map((R) => {
      const pr = Object.assign({}, p, { rankKm: R }), sc = K.scores(D, POP, pr, state.cls), rb = K.rankBands(D, state.cls, sc.S);
      const site = V9.sites.map((s) => K.siteScore(D, sc.S, s.lon, s.lat, R)), base = V9.sites.map((s) => K.haWithin(D, s.lon, s.lat, R, mat));
      const r = (a) => K.spearman(a, site);
      const yr = V9.years.map((y, j) => K.spearman(V9.sites.map((s) => s.byYear[j]), site));
      return { R, sc, rb, mean9: r(V9.sites.map((s) => s.mean9)), coef: r(V9.sites.map((s) => s.coef)), cum26: r(cum), ymin: Math.min(...yr), ymax: Math.max(...yr), base: K.spearman(V9.sites.map((s) => s.mean9), base) };
    });
    const f = (v) => (v == null ? '—' : v.toFixed(2));
    const t1 = per.map((r) => '<tr' + (r.R === K.DEFAULTS.rankKm ? ' class="init"' : '') + '><td>' + r.R + ' km' + (r.R === K.DEFAULTS.rankKm ? '（初期値）' : '') + '</td><td class="n">' + f(r.mean9) + '</td><td class="n">' + f(r.coef) + '</td><td class="n">' + f(r.cum26) + '</td><td class="n">' + f(r.ymin) + '〜' + f(r.ymax) + '</td><td class="n">' + f(r.base) + '</td></tr>').join('');
    const pairs = [[0, 1], [1, 2], [0, 2]].map(([a, b]) => {
      const A = per[a], B = per[b], idx = []; let both = 0, top = 0;
      for (let i = 0; i < state.cls.length; i++) if (state.cls[i] === 1) {
        idx.push(i);
        if (A.rb.band[i] === 1) { top += C.n[i]; if (B.rb.band[i] === 1) both += C.n[i]; }
      }
      const rho = K.spearman(idx.map((i) => A.sc.S[i]), idx.map((i) => B.sc.S[i]));
      return '<tr><td>' + A.R + ' km と ' + B.R + ' km</td><td class="n">' + f(rho) + '</td><td class="n">' + (top ? (both / top * 100).toFixed(0) : 0) + '%</td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="warn"><b>順位の正しさの証明ではありません。</b>東京都の12地点（区市の代表点）だけの照合で、n=12、観測は2009〜2017年のスギ・ヒノキ亜科の合計、風向なし。関東の他の場所では確かめていません。<b>R は観測に合わせて選び直していません</b>（初期値の20kmは先に決めた仮の値で固定）。</div>' +
      '<p>地点の周囲（半径 R km）にある区分1のメッシュの点数の合計と、東京都の飛散花粉数とのスピアマンの順位相関 ρ（n=12）。</p>' +
      '<table class="small"><thead><tr><th>R</th><th class="n">9年平均</th><th class="n">回帰係数</th><th class="n">2026年</th><th class="n">9年の各年</th><th class="n">人口なし※</th></tr></thead><tbody>' + t1 + '</tbody></table>' +
      '<p class="note">9年平均＝2009〜2017年の12地点の平均飛散数（原表の表2を機械で読み直した）。回帰係数＝県平均の雄花1個/m²あたりの飛散数（同表3。年の影響を除いた地点の違い）。2026年＝東京都の公表値（単年）。9年の各年＝年ごとに出した ρ の最小〜最大（年によって大きく動く）。※周囲の' + p.age + '年生以上スギ人工林の面積だけ（人口を掛けない）と9年平均の ρ。</p>' +
      '<p>R を変えたときの順位の安定（区分1の全メッシュ）</p>' +
      '<table class="small"><thead><tr><th>比べる R</th><th class="n">点数の順位相関 ρ</th><th class="n">上位10%の共通面積</th></tr></thead><tbody>' + pairs + '</tbody></table>' +
      '<p class="note">「上位10%の共通面積」＝片方の R で上位10%の帯に入る面積のうち、もう片方の R でも上位10%の帯に入る割合。数字が小さいほど、R の選び方で最優先の場所が入れ替わる。</p>';
  }
  function muniCard(idx) {
    const m = D.munis[idx], b = state.sum.byMuni[idx], k = mainMeasure(b), z = m[2] === 1;
    return '<div class="sel-box"><h3>' + esc(m[0]) + '（' + esc(D.meta.prefs[m[1]]) + '）' + (z ? ' <span class="chip zone">重点区域あり</span>' : ' <span class="chip ok">重点区域の表に無い</span>') + '</h3>' +
      '<p class="big"><span class="sw" style="' + swatch(k) + '"></span> 主な対策: ' + esc(K.CLASSES[k].name) + '</p><p>' + esc(K.CLASSES[k].todo) + '</p>' +
      '<dl class="kv">' + [1, 2, 3, 4].map((j) => '<dt>' + j + ' ' + esc(SHORT[j]) + '</dt><dd>' + fmt(b[j]) + ' ha</dd>').join('') + '<dt>スギ人工林の計</dt><dd>' + fmt(b.all) + ' ha</dd></dl>' + bar(b) +
      '<p class="note">区分1の中の順位（面積 ha）:</p><dl class="kv">' + BANDS.map((r) => '<dt><span class="sw sm" style="' + bswatch(r.k) + '"></span> ' + esc(r.name) + '</dt><dd>' + fmt(state.bs.byMuni[idx][r.k]) + ' ha</dd>').join('') + '</dl>' +
      '<p class="note">地図で色の違う場所をクリックすると、その場所の理由が出ます。</p></div>';
  }
  function showSel(html) { $('#sel').hidden = false; $('#sel-body').innerHTML = html; }

  // ---- 検証（参考） ----
  function renderVerify() {
    const V = D.verify, S = state.sum, p = state.params;
    const mat = (i) => (p.age === 21 ? C.n21[i] : C.n26[i]) * K.CELL_HA;
    const c1 = (i) => (state.cls[i] === 1 ? C.n[i] * K.CELL_HA : 0);
    const Rs = [10, 20, 30];
    const sites = V.tokyo.sites.map((s) => ({ s, m: Rs.map((R) => K.haWithin(D, s.lon, s.lat, R, mat)), c: Rs.map((R) => K.haWithin(D, s.lon, s.lat, R, c1)) }));
    const cum = sites.map((r) => r.s.cum);
    const rho = (arr) => { const v = K.spearman(cum, arr); return v == null ? '—' : v.toFixed(2); };
    const trs = sites.slice().sort((a, b) => b.s.cum - a.s.cum).map((r) => '<tr><td>' + esc(r.s.name) + '</td><td class="n">' + fmt(r.s.cum) + '</td>' + r.m.map((v) => '<td class="n">' + fmt(v) + '</td>').join('') + '</tr>').join('');
    const bl = V.bloom.prefs.map((b) => { const i = D.meta.prefs.indexOf(b.pref), s = S.byPref[i]; return { b, all: s.all, m: p.age === 21 ? s.mature21 : s.mature26, c1: s[1], share: s.all ? s[1] / s.all : 0 }; });
    const rb = (arr) => { const v = K.spearman(bl.map((x) => x.b.avg10), arr); return v == null ? '—' : v.toFixed(2); };
    $('#verify-body').innerHTML =
      '<div class="warn"><b>参考であり、区分の正しさの証明ではありません。</b>観測と区分を並べただけで、風向・飛距離は入っていません。単年・少数の点での順位相関で、因果は示せません。「花粉が○%減る」とは言えません。</div>' +
      '<h3 style="font-size:13px;margin:8px 0 2px">東京都12地点の飛散花粉数（' + esc(V.tokyo.what) + '）</h3>' +
      '<table><thead><tr><th>地点</th><th class="n">累積(個/cm²)</th>' + Rs.map((R) => '<th class="n">' + R + 'km内 ha</th>').join('') + '</tr></thead><tbody>' + trs + '</tbody></table>' +
      '<p>順位相関（スピアマンのρ、n=12）: 周囲の' + p.age + '年生以上スギ人工林の面積と累積飛散数 → ' + Rs.map((R, j) => R + 'km内 ρ=' + rho(sites.map((r) => r.m[j]))).join('／') + '。区分1の面積では ' + Rs.map((R, j) => R + 'km内 ρ=' + rho(sites.map((r) => r.c[j]))).join('／') + '。</p>' +
      '<p class="note">地点は区市の代表点（観測地点そのものではない）。500mメッシュの中心で半径内を数えた近似。年は曜日から2026年と判断。単年の値で、森林総研は「数年分の集計で決める」としている。</p>' +
      '<h3 style="font-size:13px;margin:10px 0 2px">スギ雄花花芽調査（環境省・林野庁、個/m²）と区分の分布</h3>' +
      '<table><thead><tr><th>都県</th><th class="n">雄花 過去10年平均</th><th class="n">令和6年度</th><th class="n">' + p.age + '年生以上 ha</th><th class="n">区分1 ha</th><th class="n">区分1の割合</th></tr></thead><tbody>' +
      bl.map((x) => '<tr><td>' + esc(x.b.pref) + '</td><td class="n">' + fmt(x.b.avg10) + '</td><td class="n">' + fmt(x.b.r6) + '</td><td class="n">' + fmt(x.m) + '</td><td class="n">' + fmt(x.c1) + '</td><td class="n">' + (x.share * 100).toFixed(0) + '%</td></tr>').join('') + '</tbody></table>' +
      '<p>順位相関（n=7）: 雄花の10年平均と ' + p.age + '年生以上スギ人工林の面積 ρ=' + rb(bl.map((x) => x.m)) + '／区分1の割合 ρ=' + rb(bl.map((x) => x.share)) + '。</p>' +
      '<p class="note">雄花の値は都県単位（個/m²、調査林分あたり）で面積ではなく密度に近い量のため、面積との相関を期待する根拠はない。7点の参考値で、相関が出ても出なくても区分の検証にはならない。地点別の雄花データは未取得。</p>';
  }

  // ---- 地図 ----
  let map = null, popup = null;
  const LAYERS = ['c1b1', 'c1b2', 'c1b3', 'c1b4', 'c2', 'c3', 'c4'];
  function cellsGeo() {
    const f = new Array(N);
    for (let i = 0; i < N; i++) {
      const x0 = C.ix[i] / 160, x1 = (C.ix[i] + 1) / 160, y0 = C.iy[i] / 240, y1 = (C.iy[i] + 1) / 240;
      f[i] = { type: 'Feature', properties: { i, k: state.cls[i], b: state.rb.band[i], ha: Math.round(C.n[i] * K.CELL_HA * 10) / 10 }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
    }
    return { type: 'FeatureCollection', features: f };
  }
  const BOUNDS = {};
  function muniGeo() {
    return {
      type: 'FeatureCollection', features: D.muniGeo.map(([idx, polys]) => {
        let b = [180, 90, -180, -90];
        polys.forEach((p) => p[0].forEach(([x, y]) => { b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; }));
        BOUNDS[idx] = b;
        return { type: 'Feature', properties: { m: idx, z: D.munis[idx][2], n: D.munis[idx][0] }, geometry: { type: 'MultiPolygon', coordinates: polys } };
      }),
    };
  }
  function setVis(id, on) { if (map && map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
  function applyToggles() {
    setVis('ring-casing', $('#t-ring').checked); setVis('ring-line', $('#t-ring').checked);
    setVis('zone-line', $('#t-zone').checked); setVis('muni-line', $('#t-muni').checked);
    setVis('org-dot', $('#t-org').checked);
  }
  function refreshMap() {
    if (!map || !state.mapReady) return;
    map.getSource('cells').setData(cellsGeo());
    map.setFilter('sel-cell', ['==', ['get', 'i'], state.sel == null ? -1 : state.sel]);
  }
  function initMap() {
    map = new maplibregl.Map({
      container: 'map', attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'] } }, layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      bounds: [[138.5, 34.8], [140.95, 37.2]], fitBoundsOptions: { padding: 10 },
    });
    window.__kantoMap = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: '出典：林野庁 全国森林資源メッシュ等を加工／地理院タイル／MapLibre' }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      [1, 2, 3, 4].forEach((k) => { const g = PAT[k].getContext('2d').getImageData(0, 0, 16, 16); map.addImage('pat' + k, g); });
      [1, 2, 3, 4].forEach((b) => { map.addImage('pat1b' + b, BPAT[b].getContext('2d').getImageData(0, 0, 16, 16)); });
      map.addSource('cells', { type: 'geojson', data: cellsGeo(), tolerance: 0.1 });
      map.addSource('muni', { type: 'geojson', data: muniGeo() });
      const ring = { type: 'FeatureCollection', features: D.ring.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p[0] } })) };
      map.addSource('ring', { type: 'geojson', data: ring });
      map.addSource('org', { type: 'geojson', data: { type: 'FeatureCollection', features: D.origins.map((o) => ({ type: 'Feature', properties: { n: o[0] + '（' + o[2] + '）' }, geometry: { type: 'Point', coordinates: [o[3], o[4]] } })) } });
      const op = ['interpolate', ['linear'], ['get', 'ha'], 5, 0.55, 20, 0.97];
      [1, 2, 3, 4].forEach((b) => map.addLayer({ id: 'c1b' + b, type: 'fill', source: 'cells', filter: ['all', ['==', ['get', 'k'], 1], ['==', ['get', 'b'], b]], paint: { 'fill-pattern': 'pat1b' + b, 'fill-opacity': 0.96 } }));
      [2, 3, 4].forEach((k) => map.addLayer({ id: 'c' + k, type: 'fill', source: 'cells', filter: ['==', ['get', 'k'], k], paint: { 'fill-pattern': 'pat' + k, 'fill-opacity': k === 4 ? 0.5 : op } }));
      map.addLayer({ id: 'muni-line', type: 'line', source: 'muni', paint: { 'line-color': '#5a5a5a', 'line-width': 0.5, 'line-opacity': 0.6 } });
      map.addLayer({ id: 'zone-line', type: 'line', source: 'muni', filter: ['==', ['get', 'z'], 1], paint: { 'line-color': '#111', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 11, 2.2], 'line-opacity': 0.7 } });
      map.addLayer({ id: 'sel-muni', type: 'line', source: 'muni', filter: ['==', ['get', 'm'], -1], paint: { 'line-color': '#0036ff', 'line-width': 3.5 } });
      map.addLayer({ id: 'ring-casing', type: 'line', source: 'ring', paint: { 'line-color': '#fff', 'line-width': 4.5 } });
      map.addLayer({ id: 'ring-line', type: 'line', source: 'ring', paint: { 'line-color': '#000', 'line-width': 2, 'line-dasharray': [3, 2] } });
      map.addLayer({ id: 'sel-cell', type: 'line', source: 'cells', filter: ['==', ['get', 'i'], -1], paint: { 'line-color': '#000', 'line-width': 3 } });
      map.addLayer({ id: 'org-dot', type: 'circle', source: 'org', paint: { 'circle-radius': 4.5, 'circle-color': '#000', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      const tip = document.createElement('div'); tip.id = 'tip'; tip.style.cssText = 'position:absolute;z-index:4;pointer-events:none;background:#fff;border:1px solid #333;border-radius:4px;padding:2px 7px;font-size:12px;display:none;white-space:nowrap'; $('#mapwrap').appendChild(tip);
      map.on('mousemove', (e) => {
        const fs = map.queryRenderedFeatures(e.point, { layers: LAYERS });
        if (fs.length) { const i = fs[0].properties.i; tip.style.display = 'block'; tip.style.left = (e.point.x + 12) + 'px'; tip.style.top = (e.point.y + 12) + 'px'; tip.textContent = muniName(i) + '（' + prefOf(i) + '）: ' + SHORT[state.cls[i]] + (state.cls[i] === 1 ? '／' + bandName(state.rb.band[i]) : ''); map.getCanvas().style.cursor = 'pointer'; }
        else { tip.style.display = 'none'; map.getCanvas().style.cursor = ''; }
      });
      map.on('mouseout', () => { tip.style.display = 'none'; });
      map.on('click', (e) => {
        const o = map.queryRenderedFeatures(e.point, { layers: ['org-dot'] });
        if (o.length) { new maplibregl.Popup({ closeButton: true }).setLngLat(e.lngLat).setHTML('<b>50km圏の起点</b><br>' + esc(o[0].properties.n)).addTo(map); return; }
        const fs = map.queryRenderedFeatures(e.point, { layers: LAYERS });
        if (fs.length) selectCell(fs[0].properties.i, e.lngLat);
      });
      state.mapReady = true;
      applyToggles();
      document.body.dataset.mapReady = '1';
    });
  }
  function selectCell(i, lngLat) {
    state.sel = i;
    if (map) {
      map.setFilter('sel-cell', ['==', ['get', 'i'], i]);
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ closeButton: true, maxWidth: '260px' }).setLngLat(lngLat || K.cellLonLat(D, i)).setHTML(popupHtml(i)).addTo(map);
    }
    showSel(cellCard(i));
  }
  function selectMuni(idx, fly) {
    state.muni = idx;
    if (map && state.mapReady) {
      map.setFilter('sel-muni', ['==', ['get', 'm'], idx]);
      const b = BOUNDS[idx];
      if (fly && b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, maxZoom: 12, duration: 600 });
    }
    showSel(muniCard(idx));
    renderPlaces();
  }

  // ---- 基準の操作 ----
  function refreshAll() {
    recompute(); renderLegend(); renderRank(); renderRankCheck(); renderTotals(); renderPlaces(); renderVerify(); refreshMap();
    if (state.sel != null) showSel(cellCard(state.sel)); else if (state.muni != null) showSel(muniCard(state.muni));
  }
  function readParams() {
    state.params.slopeMax = +$('#p-slope').value; state.params.minHa = +$('#p-ha').value;
    state.params.age = +document.querySelector('input[name=age]:checked').value;
    state.params.rankKm = +document.querySelector('input[name=rk]:checked').value;
    $('#o-slope').textContent = state.params.slopeMax; $('#o-ha').textContent = state.params.minHa;
  }
  function writeParams() {
    $('#p-slope').value = state.params.slopeMax; $('#p-ha').value = state.params.minHa;
    document.querySelector('input[name=age][value="' + state.params.age + '"]').checked = true;
    document.querySelector('input[name=rk][value="' + state.params.rankKm + '"]').checked = true;
    $('#o-slope').textContent = state.params.slopeMax; $('#o-ha').textContent = state.params.minHa;
  }
  function about() {
    const A = D.zone.areasHa, vint = D.meta.src.vintage;
    const yrs = Object.keys(vint).filter((y) => /^\d{4}$/.test(y)).sort().join('・');
    $('#about-body').innerHTML =
      '<h3>この地図が示すもの</h3><p>関東1都6県（島しょを除く）の、林種が人工林で森林簿の樹種1がスギの場所を、500mメッシュ（地域メッシュ4次）に集計し、公的資料の条件で4区分に塗り分けたものです。「花粉がどれだけ減る」「健康への影響」は示しません（根拠がありません）。</p>' +
      '<h3>区分の決め方（優先順）</h3><ol><li><b>区分4（対象外・低優先）</b>: スギ人工林が基準（初期値5ha）未満、または「50km圏の外で、林野庁の重点区域がある市町村でもない」。</li><li><b>区分3（広葉樹林化・針広混交林）</b>: 上に当たらず、500mメッシュ内のスギ林の平均傾斜が基準（初期値25度）以上。</li><li><b>区分1（伐る・植え替える）</b>: 上に当たらず、26年生以上（または21年生以上）のスギが過半。</li><li><b>区分2（少花粉スギ等へ更新）</b>: 上に当たらない残り（若い林が多い、または林齢なし）。</li></ol>' +
      '<h3>区分1の中の順位（人に届きやすい発生源の順位。作成者の式）</h3><ul>' +
      '<li>式: 点数 S = 26年生以上のスギ人工林の面積（ha）× 半径 R km 以内の人口。R は10・20・30 kmから選ぶ（初期値20 km。<b>仮</b>）。区分1の中を、面積で数えた百分位で 上位10%・10〜30%・30〜60%・残り の4つの帯にする。</li>' +
      '<li><b>根拠があるもの</b>: 26年生以上のスギ人工林を発生源とすること（金指・篠原 2009）。「発生源の量×そこに住む人口」の形（森林総研は人口を考慮して首都圏の居住者が浴びる花粉を発生源別に集計している。同上）。<b>方向だけ根拠があるもの</b>: 近いほど影響が大きいこと（東京都12地点の回帰係数は、発生源に近い青梅2.91〜大田0.39。横山 2017）。<b>仮置き</b>: 距離の減り方（半径内を1、外を0）と R の値。距離による減り方の式を示した公的資料・論文は見つからなかった。</li>' +
      '<li>林齢では順位を付けていない。林分あたりの雄花の量は、ある林齢以上で頭打ちになる（齋藤 1991 は50年生で頭打ち。金指 2009、宇都木 森林総研資料）。区分1は26年生以上が過半の所で、関東のスギ人工林の97%が26年生以上であり、林齢は順位を分けない。</li>' +
      '<li>点数に混ぜないもの: 風（単一地点・数年の最多風向では限界が大きく、根拠になる数値がない）、傾斜（区分3の判定に使う別の軸）、まとまり、県別の雄花調査値（県の平均で、年によって2〜3倍動く例がある）。ヒノキは数えない。</li>' +
      '<li>人口: e-Stat 地域メッシュ統計 令和2年国勢調査 250mメッシュ（統計表ID T001102、人口総数。1次メッシュ19面）。500mメッシュごとに半径内の人口を合計した（tools/kanto_pop.py）。出典: 総務省統計局（e-Stat）。加工は当方。</li>' +
      '<li>この順位は「どこから手を付けるか」の目安で、花粉の量や対策の成果を示すものではありません。東京都の12地点・9年分との照合は「順位の検証と感度」に載せた（n=12、単年・少数地点の限界あり。R は観測に合わせて選び直していない）。</li></ul>' +
      '<h3>公的資料・論文で決まっていること</h3><ul>' +
      '<li>50km圏: 林野庁「スギ花粉発生源対策推進方針」（最終改正 令和6年4月3日）は、県庁所在地・政令指定都市・中核市・施行時特例市・東京都区部から50km圏内のまとまったスギ人工林を、伐採重点区域の目安とする。起点は総務省の指定都市・中核市・施行時特例市の一覧（令和4年7月／令和5年4月現在）と各県の県庁所在地（関東の外の都市も50km圏が関東にかかるため含む）。位置は国土地理院の地名検索の代表点。東京都区部は23区の合併領域から50kmで測る。</li>' +
      '<li>伐採重点区域: 林野庁の公表表（' + esc(D.zone.asof) + '）の市町村。ポリゴンは公開されておらず、市町村単位でのみ示す。関東の面積は茨城' + fmt(A['茨城県']) + '・栃木' + fmt(A['栃木県']) + '・群馬' + fmt(A['群馬県']) + '・埼玉' + fmt(A['埼玉県']) + '・千葉' + fmt(A['千葉県']) + '・東京' + fmt(A['東京都']) + '・神奈川' + fmt(A['神奈川県']) + ' ha。</li>' +
      '<li>林齢: 森林総研の研究は26年生以上のスギ林を発生源とする（家原ほか 2000、金指・篠原 2009）。林野庁Q&Aは「20年生以降」、政府資料の定義は21年生以上とされる（国民森林会議の指摘）ため、画面で26年／21年を切り替えられる。林齢は森林簿の値で、森林簿の年は' + esc(yrs) + '年と都県・地域で異なる（今年の林齢ではない）。</li>' +
      '<li>少花粉スギ等・広葉樹化: 推進方針は少花粉・無花粉・低花粉スギの定義を示し、林野庁Q&Aは林業に適さない所では広葉樹の導入や針広混交林への誘導を挙げる。「適地」「条件不利地」の数値基準は公的資料にない。</li></ul>' +
      '<h3>仮の基準（参謀長判断。公的資料に数値がない）</h3><ul><li>条件不利地とみなす傾斜: 初期値25度（国土数値情報 標高・傾斜度5次メッシュ G04-d の平均傾斜角度。250mメッシュの平均なので個々の斜面より緩く出る。スギ林の平均傾斜の90％点は約27度）。</li><li>まとまった林: 初期値5ha／500m四方（メッシュの20%）。</li><li>区分1と2を分ける「過半」: 26年生以上のスギが半分以上。</li></ul>' +
      '<h3>使ったデータと条件</h3><ul>' +
      '<li>林野庁 全国森林資源メッシュ（20m。G空間情報センター dataset mesh_9、公共データ利用規約 第1.0版。<b>出典：林野庁（https://www.geospatial.jp/ckan/dataset/mesh_9）、PDL1.0（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）をもとに、500mメッシュに集計・区分する加工を当方が行った</b>。林野庁が作成したものではない）。規約は2026-11-21に取得して確認。原典は都道府県・森林管理局の森林簿・森林調査簿（主に空中写真判読）で、現地・登記・課税と一致するとは限らず、整備時点の資源情報である。</li>' +
      '<li>国土数値情報 行政区域（2025年版、CC BY 4.0）、標高・傾斜度5次メッシュ（2011年度版、商用可。原典は国土地理院の基盤地図情報 数値標高モデル10m）。いずれも国土交通省の国土数値情報を加工して作成。</li>' +
      '<li>総務省 指定都市一覧・中核市一覧・施行時特例市一覧、林野庁 スギ人工林伐採重点区域（令和8年4月1日時点）、東京都 飛散花粉数データ、環境省・林野庁 令和6年度スギ雄花花芽調査結果。地図は地理院タイル（淡色地図）。</li>' +
      '<li>国土数値情報 A13（森林地域）は非商用のため使っていない。</li></ul>' +
      '<h3>限界</h3><ul>' +
      '<li>スギは「樹種1（面積歩合が最大の樹種）」のみ。ヒノキ人工林・天然林のスギは数えない。500mメッシュの中心点で市町村を決めるため、境界付近の面積は隣の市町村に入ることがある。</li>' +
      '<li>風向・飛距離は使っていない（根拠が確認できなかったため。旧版の「風下人口×面積」は参考・仮置きとして別ページに残した）。人口は、区分1の中の順位（下の節）にだけ使う。森林総研は気象モデルで首都圏の発生源別の影響を計算しており、「埼玉県や東京都西部の影響が高く、神奈川県西部や房総半島中北部も高い」としている（2008年の1シーズン。数年の集計が必要とも書いている）。この地図の区分はそれを再現するものではない。</li>' +
      '<li>飛散防止剤（雄花抑制）は場所の優先条件が公的資料にないため塗り分けに入れていない。間伐は強度間伐で雄花が増える例（清野ほか 2003）があるため、雄花を減らす対策として載せていない。</li>' +
      '<li>実際の施業は森林簿・所有者・現地の確認が必要。この地図は候補を見つけるためのもの。</li></ul>';
  }

  function init() {
    recompute();
    $('#f-pref').innerHTML = '<option value="">関東すべて</option>' + D.meta.prefs.map((n, i) => '<option value="' + i + '">' + esc(n) + '</option>').join('');
    writeParams();
    $('#r-pref').innerHTML = '<option value="">関東すべて</option>' + D.meta.prefs.map((n, i) => '<option value="' + i + '">' + esc(n) + '</option>').join('');
    renderLegend(); renderRank(); renderRankCheck(); renderTotals(); renderPlaces(); renderVerify(); about();
    ['#p-slope', '#p-ha'].forEach((s) => $(s).addEventListener('input', () => { readParams(); refreshAll(); }));
    document.querySelectorAll('input[name=age], input[name=rk]').forEach((r) => r.addEventListener('change', () => { readParams(); refreshAll(); }));
    $('#r-pref').addEventListener('change', () => { state.rshown = 15; renderRank(); });
    $('#p-reset').addEventListener('click', () => { state.params = Object.assign({}, K.DEFAULTS); writeParams(); refreshAll(); });
    ['#t-ring', '#t-zone', '#t-muni', '#t-org'].forEach((s) => $(s).addEventListener('change', applyToggles));
    $('#f-pref').addEventListener('change', () => { state.shown = 30; renderPlaces(); });
    $('#f-q').addEventListener('input', () => { state.shown = 30; renderPlaces(); });
    $('#btn-about').addEventListener('click', () => { $('#modal').hidden = false; $('#btn-close').focus(); });
    $('#btn-close').addEventListener('click', () => { $('#modal').hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });
    initMap();
  }
  init();
})();
