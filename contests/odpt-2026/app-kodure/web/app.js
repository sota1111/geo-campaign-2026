/* 子連れお出かけ診断: 画面制御（MapLibre GL JS） */
(function () {
  'use strict';
  var L = window.Lib;
  var esc = L.esc;
  var BL = L.BUCKET_LABEL;
  /* 色覚に配慮: 赤と緑の対比を避け、青（行ける）の濃淡とオレンジ（行けない）で区別する（Okabe-Ito配色を基にした） */
  var COLORS = { both: '#0072B2', one: '#56B4E9', none: '#D55E00', rail: '#8c8c8c',
    n0: '#D55E00', n1: '#9ECAE1', n2: '#4292C6', n3: '#08519C' };
  /* 地図で実際に描く不透明度（凡例の色見本も同じ不透明度で描いて、地図と凡例の色を一致させる） */
  var OPA = { none: 0.5, n0: 0.5, dim: 0.12, fill: 0.75 };
  /* 行き先の種類ごとの点の色（地区の塗り分けと混ざらないよう、青・オレンジ以外） */
  var KIND_COLORS = { park_l: '#1b7a3d', park_m: '#8fd19e', zoo: '#CC6677', aquarium: '#882255', museum: '#DDCC77', botanical: '#999933' };
  var STATE = { meta: null, osaka: null, region: 'tokyo', o: 9, r: 16, w: 45, c: 500, t: 2, kinds: null, view: 'a', sel: null,
    mats: null, matsKey: '', loading: false, req: 0, cellIdx: null, statuses: null, cache: {}, listAll: false,
    focus: null, from: null };
  var map, popup;

  function $(id) { return document.getElementById(id); }
  function man(n) { return n >= 10000 ? (Math.round(n / 100) / 100) + '万人' : Math.round(n).toLocaleString('ja-JP') + '人'; }

  function seg(el, options, value, onChange) {
    el.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      if (o.sub) {
        b.innerHTML = '<span class="s1"></span><span class="s2"></span>';
        b.firstChild.textContent = o.label; b.lastChild.textContent = o.sub;
      } else b.textContent = o.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.children, function (c) { c.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
        onChange(o.value);
      });
      el.appendChild(b);
    });
  }
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) { var er = new Error(url + ' ' + r.status); er.status = r.status; er.url = url; throw er; }
      return r.json();
    });
  }

  function showNoData() {
    var msg = '行き先データ（国土数値情報 P13・P27）は許諾確認中のため同梱していません。';
    var h = $('headline');
    if (h) h.textContent = msg;
    $('summary').innerHTML = '<div class="notice warn"><b>' + msg + '</b><br>' +
      '公園・動物園・水族館・博物館などの行き先は、データの利用許諾（「非商用」の条件）を国土数値情報の事務局に確認するまで、このリポジトリと公開物には入れていません。' +
      '手元で作り直す手順は README の「ビルド」を参照してください。</div>';
  }

  function showFail(what, e) {
    if (e && e.status === 404 && /data\/meta\.json/.test(e.url || '')) { showNoData(); return; }
    var el = $('summary');
    el.innerHTML = '<div class="notice warn"><b>' + what + 'を表示できませんでした。</b><br>通信の不調や、古い画面が残っていることが原因の場合があります。' +
      '下のボタンでページを読み込み直してください。<br><button type="button" id="btn-reload" class="act">ページを読み込み直す</button>' +
      '<br><span class="note">詳細: ' + esc(e && e.message) + '</span></div>';
    var b = $('btn-reload');
    if (b) b.addEventListener('click', function () { location.reload(); });
  }

  /* ---------- 条件 ---------- */
  function layerOf() { return STATE.t; }
  function destsVisible() {
    var out = [], ks = STATE.kinds, d = STATE.meta.dests;
    for (var i = 0; i < d.length; i++) if (ks.indexOf(d[i][3]) >= 0) out.push(i);
    return out;
  }
  function kindLabel(k) {
    var m = STATE.meta.kinds.filter(function (x) { return x[0] === k; })[0];
    return m ? m[1] : k;
  }

  function windowText(h) { var p = STATE.meta.params; return h + ':00〜' + h + ':' + (p.window_min < 10 ? '0' : '') + p.window_min; }

  function buildControls() {
    var p = STATE.meta.params;
    var vsel = [{ value: 'a', label: '地区から探す' }, { value: 'b', label: '行き先から探す' }];
    seg($('ctl-view'), vsel, STATE.view, function (v) { STATE.view = v; STATE.sel = null; STATE.focus = null; STATE.from = null; STATE.listAll = false; afterChange(false); });
    seg($('ctl-o'), p.out_hours.map(function (h) { return { value: h, label: h + '時台', sub: windowText(h) }; }), STATE.o, function (v) { STATE.o = v; afterChange(true); });
    seg($('ctl-r'), p.ret_hours.map(function (h) { return { value: h, label: h + '時台', sub: windowText(h) }; }), STATE.r, function (v) { STATE.r = v; afterChange(true); });
    seg($('ctl-w'), [30, 45, 60, 90].map(function (w) { return { value: w, label: w + '分' }; }), STATE.w, function (v) { STATE.w = v; afterChange(false); });
    seg($('ctl-c'), p.caps_m.map(function (c) {
      return { value: c, label: c + 'm', sub: '徒歩約' + Math.round(c * p.detour / p.walk_m_per_min) + '分' };
    }), STATE.c, function (v) { STATE.c = v; afterChange(true); });
    seg($('ctl-t'), [{ value: 1, label: '乗換なし' }, { value: 2, label: '1回まで' }, { value: 3, label: '制限なし' }], STATE.t,
      function (v) { STATE.t = v; afterChange(false); });
    $('cond-note').textContent = '出発時刻は1点ではなく幅で見ます。行きは「行き出発」の時間帯（例 9:00〜9:30）に家を出る' + (p.window_min / p.window_step_min + 1) +
      '通り（' + p.window_step_min + '分おき）の所要時間の中央値、帰りも同様に行き先を出る場合の中央値です。許容時間は片道で、待ち時間を含みます。' +
      '徒歩は分速' + p.walk_m_per_min + 'm（ベビーカー連れの仮定）。乗継は' + (p.transfer_s / 60) + '分以上の余裕を見て、直線' + p.walk_transfer_m +
      'm以内の別の停留所・駅へは歩いて乗り換えます（徒歩時間も加算）。休日は日曜のダイヤです。';
    var k = $('ctl-kinds');
    k.innerHTML = '';
    STATE.meta.kinds.forEach(function (kk) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = STATE.kinds.indexOf(kk[0]) >= 0;
      cb.addEventListener('change', function () {
        var ks = STATE.kinds.filter(function (x) { return x !== kk[0]; });
        if (cb.checked) ks.push(kk[0]);
        STATE.kinds = STATE.meta.kinds.map(function (x) { return x[0]; }).filter(function (x) { return ks.indexOf(x) >= 0; });
        if (STATE.view === 'b' && STATE.sel != null && STATE.kinds.indexOf(STATE.meta.dests[STATE.sel][3]) < 0) STATE.sel = null;
        STATE.listAll = false;
        buildDestSelect();
        afterChange(false);
      });
      var sw = document.createElement('i');
      sw.className = 'ksw';
      sw.style.background = KIND_COLORS[kk[0]];
      lab.appendChild(cb); lab.appendChild(sw); lab.appendChild(document.createTextNode(' ' + kk[1]));
      k.appendChild(lab);
    });
    $('kinds-note').textContent = '公園は国土数値情報の都市公園（面積1ha以上。街区公園などの小さな公園、緑道・緩衝緑地は除く）。動物園・水族館・博物館等は文化施設データから分類した推定です。';
    updateViewHelp();
  }

  function updateViewHelp() {
    $('view-help').textContent = STATE.view === 'a'
      ? '地図で家のある地区（メッシュ）をタップすると、そこから行ける行き先の一覧が出ます（広く見ているときは点より地区を優先。拡大すると点も選べます）。'
      : '地図の行き先の点をタップするか、下の「行き先を選ぶ」の一覧から選ぶと、行ける地区が青く塗られます。';
  }

  function buildDestSelect() {
    var sel = $('dest-select'), d = STATE.meta.dests;
    var h = '<option value="">（選んでいません）</option>';
    STATE.meta.kinds.forEach(function (kk) {
      if (STATE.kinds.indexOf(kk[0]) < 0) return;
      var items = [];
      d.forEach(function (x, i) { if (x[3] === kk[0]) items.push(i); });
      items.sort(function (a, b) { return d[a][2].localeCompare(d[b][2], 'ja'); });
      if (!items.length) return;
      h += '<optgroup label="' + esc(kk[1]) + '">' + items.map(function (i) {
        return '<option value="' + i + '"' + (STATE.view === 'b' && STATE.sel === i ? ' selected' : '') + '>' + esc(d[i][2]) + '</option>';
      }).join('') + '</optgroup>';
    });
    sel.innerHTML = h;
  }

  /* ---------- 地図の見えている範囲（パネルに隠れない） ---------- */
  function isMobile() { return window.matchMedia('(max-width: 720px)').matches; }
  function updatePadding() {
    if (!map) return;
    var panel = $('panel');
    if (isMobile()) map.setPadding({ top: 8, right: 8, left: 8, bottom: panel.offsetHeight + 8 });
    else map.setPadding({ top: 8, right: 8, bottom: 8, left: panel.offsetWidth + 8 });
  }
  function fitToCells(idx, extra) {
    if (!map || !STATE.meta) return;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    var add = function (lon, lat) { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); };
    idx.forEach(function (c) { var b = L.meshBounds(STATE.meta.cells[c][0]); add(b[0], b[1]); add(b[2], b[3]); });
    (extra || []).forEach(function (p) { add(p[0], p[1]); });
    if (x0 > x1) return;
    map.fitBounds([[x0, y0], [x1, y1]], { padding: 24, maxZoom: 13, duration: 600 });
  }
  function fitAllCells() {
    if (!map || !STATE.meta) return;
    var m = STATE.meta.region.bbox;
    map.fitBounds([[m[0], m[1]], [m[2], m[3]]], { padding: 8, duration: 0 });
  }

  /* ---------- データ読み込み（時刻・徒歩上限ごとに6ファイル: 行き・帰り × 乗車回数の3層） ---------- */
  function matsKey() { return [STATE.o, STATE.r, STATE.c].join('_'); }
  function loadMats(cb) {
    var key = matsKey(), req = ++STATE.req;
    if (STATE.cache[key]) { STATE.mats = STATE.cache[key]; STATE.matsKey = key; cb(); return; }
    STATE.loading = true;
    $('summary').innerHTML = '<p class="note">この条件のデータを読み込み中です…</p>';
    var nCell = STATE.meta.cells.length;
    var jobs = [];
    [['o', STATE.o], ['r', STATE.r]].forEach(function (dh) {
      [1, 2, 3].forEach(function (ly) {
        jobs.push(getJSON('data/' + L.fileName(dh[0], dh[1], STATE.c, ly)).then(function (rows) {
          return { dir: dh[0], ly: ly, rows: rows.map(function (s) { return L.rleDecode(s, nCell); }) };
        }));
      });
    });
    Promise.all(jobs).then(function (res) {
      if (req !== STATE.req) return;   // 条件を素早く変えたとき、遅れて届いた古い応答を捨てる
      var m = { o: [null, null, null], r: [null, null, null] };
      res.forEach(function (x) { m[x.dir][x.ly - 1] = x.rows; });
      STATE.cache[key] = m;
      STATE.mats = m; STATE.matsKey = key; STATE.loading = false;
      cb();
    }).catch(function (e) { STATE.loading = false; showFail('診断結果のデータ', e); });
  }

  /* ---------- 状態の計算と表示 ---------- */
  function computeStatuses() {
    var m = STATE.meta, cells = m.cells, w = STATE.w, ly = layerOf();
    if (STATE.view === 'b' && STATE.sel != null) return L.statusesForDest(STATE.mats, ly, STATE.sel, cells, w);
    return L.statusesForCounts(STATE.mats, ly, destsVisible(), cells, w);
  }

  function cellFeatures() {
    return STATE.meta.cells.map(function (c) {
      var b = L.meshBounds(c[0]);
      return { type: 'Feature', properties: { i: 0, st: 'n0', pop: c[1] },
        geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
    });
  }

  function refreshMap() {
    if (!map || !map.getSource('cells') || !STATE.mats) return;
    var cells = STATE.meta.cells, st = STATE.statuses;
    var feats = STATE.cellFeats;
    var dim = STATE.view === 'a' && STATE.sel != null ? 1 : 0;      // 地区を選んだら、塗り分けを薄くして行き先の点を主役にする
    var noKinds = !destsVisible().length && !(STATE.view === 'b' && STATE.sel != null);
    for (var i = 0; i < feats.length; i++) { feats[i].properties.st = st[i]; feats[i].properties.i = i; feats[i].properties.dim = dim; feats[i].properties.off = noKinds ? 1 : 0; }
    map.getSource('cells').setData({ type: 'FeatureCollection', features: feats });
    // 行き先の点: 地区を選んでいればその地区からの状態、行き先を選んでいればその点を強調、無ければ種類の色
    var dv = destsVisible(), d = STATE.meta.dests, selCell = STATE.view === 'a' && STATE.sel != null ? STATE.cellIdx[STATE.sel] : null;
    var df = dv.map(function (i) {
      var col = KIND_COLORS[d[i][3]], r = 1, ring = 0, sc = '#222', sw = 1.2;
      if (selCell != null) {
        // 行き帰りとも行ける: 青で塗った点。片道だけ: 白抜きの点＋青い太枠。行けない: 小さな灰色の点
        var ps = L.pairStatus(STATE.mats, layerOf(), i, selCell, STATE.w);
        if (ps === 'both') { col = COLORS.both; sc = '#fff'; sw = 2; r = 1.5; }
        else if (ps === 'one') { col = '#fff'; sc = COLORS.both; sw = 3; r = 1.5; }
        else { col = '#bdbdbd'; sc = '#777'; sw = 0.8; r = 0.7; }
        if (STATE.focus === i) r = 2;
      } else if (STATE.view === 'b' && STATE.sel === i) { ring = 1; r = 1.5; }
      return { type: 'Feature', properties: { i: i, col: col, sc: sc, sw: sw, r: r, ring: ring, k: d[i][3] }, geometry: { type: 'Point', coordinates: [d[i][0], d[i][1]] } };
    });
    map.getSource('dests').setData({ type: 'FeatureCollection', features: df });
    var sel = { type: 'FeatureCollection', features: [] };
    if (selCell != null) {
      var b = L.meshBounds(cells[selCell][0]);
      sel.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } });
    }
    map.getSource('selcell').setData(sel);
    var sd = { type: 'FeatureCollection', features: [] };
    if (STATE.view === 'a' && STATE.focus != null) sd.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d[STATE.focus][0], d[STATE.focus][1]] } });
    if (STATE.view === 'b' && STATE.sel != null) sd.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [d[STATE.sel][0], d[STATE.sel][1]] } });
    map.getSource('seldest').setData(sd);
    var hs = { type: 'FeatureCollection', features: [] };
    if (selCell != null) {
      var bb = L.meshBounds(cells[selCell][0]);
      hs.features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] } });
    }
    map.getSource('home').setData(hs);
  }

  function legendHtml() {
    // 色見本は、地図で描く不透明度（地区の塗りは地図の上に重なる）と同じにして、地図の色と一致させる
    var sw = function (c, t, op) { return '<span><i style="background:' + c + ';opacity:' + (op == null ? OPA.fill : op) + '"></i>' + t + '</span>'; };
    var dotk = function (c, t, st) { return '<span><i class="dot" style="background:' + c + ';' + (st || '') + '"></i>' + t + '</span>'; };
    var kinds = '<b>行き先の種類（点の色）</b>' + STATE.meta.kinds.map(function (k) { return dotk(KIND_COLORS[k[0]], k[1]); }).join('');
    var viewB = STATE.view === 'b' && STATE.sel != null;
    if (!destsVisible().length && !viewB) return '<b>行き先の種類が選ばれていません。地図の色は付けていません</b>';
    if (viewB) {
      return '<b>地図の色（選んだ行き先まで）</b>' + sw(COLORS.both, '行き帰りとも行ける') + sw(COLORS.one, '片道だけ行ける') +
        sw(COLORS.none, '行けない', OPA.none) + sw(COLORS.rail, '鉄道駅が近い（未評価）') + kinds;
    }
    if (STATE.view === 'a' && STATE.sel != null) {
      return '<b>行き先の点（選んだ地区から）</b>' + dotk(COLORS.both, '行き帰りとも行ける', 'border:2px solid #fff;box-shadow:0 0 0 1px #555') +
        dotk('#fff', '片道だけ（白抜き）', 'border:3px solid ' + COLORS.both) + dotk('#bdbdbd', '行けない') +
        '<span><i class="dot" style="background:#000;border:3px solid #fff;box-shadow:0 0 0 1px #000"></i>選んだ地区（地区の塗りは薄く表示）</span>';
    }
    return '<b>地図の色（行き帰りとも行ける行き先の数）</b>' + sw(COLORS.n3, BL.n3) + sw(COLORS.n2, BL.n2) + sw(COLORS.n1, BL.n1) +
      sw(COLORS.n0, BL.n0, OPA.n0) + sw(COLORS.rail, '鉄道駅が近い（未評価）') + kinds;
  }

  function refresh() {
    if (STATE.region !== 'tokyo') return;
    // 条件（時刻・徒歩上限）を変えた直後は、その条件のデータが届くまで古い結果を描かない（見出しの条件と数字の食い違いを防ぐ）
    if (!STATE.mats || STATE.matsKey !== matsKey()) { if (STATE.mats && !STATE.loading) loadMats(refresh); return; }
    STATE.statuses = computeStatuses();
    refreshMap();
    renderSummary();
    renderDetail();
    $('map-legend').innerHTML = legendHtml();
    writeHash();
  }

  function afterChange(needData) {
    updateViewHelp();
    if (STATE.region === 'osaka') { renderOsaka(); return; }
    if (needData) loadMats(refresh); else refresh();
  }

  /* ---------- 結論・詳細 ---------- */
  function whenText() {
    return '行き' + windowText(STATE.o) + '発・帰り' + windowText(STATE.r) + '発（中央値）、片道' + STATE.w + '分以内、徒歩1回' + STATE.c + 'm以内、乗換' +
      (STATE.t === 1 ? 'なし' : (STATE.t === 2 ? '1回まで' : '制限なし'));
  }

  function summaryTable(sum, keys, labels) {
    var h = '<table class="sumtab"><tr><th></th><th>0〜14歳</th><th>総人口</th></tr>';
    keys.forEach(function (k) {
      var b = sum.by[k] || { pop: 0, kids: 0 };
      h += '<tr><th><i class="sq" style="background:' + COLORS[k] + '"></i>' + labels[k] + '</th><td><b>' + man(b.kids) + '</b><br>' + L.pct(b.kids, sum.kids) + '%</td><td>' +
        man(b.pop) + '<br>' + L.pct(b.pop, sum.pop) + '%</td></tr>';
    });
    return h + '</table>';
  }

  function renderSummary() {
    var m = STATE.meta, sum = L.summarize(m.cells, STATE.statuses), h = '', head = '';
    if (STATE.view === 'a' && STATE.sel != null && STATE.cellIdx[STATE.sel] != null) {
      // 地区を選んでいるときの結論は、その地区の答え（地区全体の数字は本文の下に残る）
      var cc = STATE.cellIdx[STATE.sel], rows0 = L.listForCell(STATE.mats, layerOf(), destsVisible(), cc, STATE.w);
      var nb = rows0.filter(function (r) { return r.status === 'both'; }).length;
      head = '<span class="hl-cond">この地区から／' + whenText() + '</span><span class="hl-num">行き帰りとも行ける行き先 <b>' + nb + 'か所</b></span>' +
        '<span class="hl-sub">片道だけ ' + (rows0.length - nb) + 'か所' + (!nb && m.cells[cc][3] ? '／未収録の鉄道の駅が近い地区（鉄道は未評価）' : '') + '</span>';
    }
    if (head) {
      // 下の本文は地区全体の集計（見出しは上で作成済み）
      var any0 = 0, sum0 = sum;
      ['n1', 'n2', 'n3'].forEach(function (k) { any0 += sum0.by[k] ? sum0.by[k].kids : 0; });
      h += '<h2 class="sum-h">東京都区部の診断結果（参考）</h2><p class="note" style="margin-top:0">行き帰りとも行ける行き先が1か所以上ある地区に住む0〜14歳は ' + L.pct(any0, sum0.kids) + '%（地区を選ばないときの値）。</p>';
    } else if (STATE.view === 'b' && STATE.sel != null) {
      var d = m.dests[STATE.sel], b = sum.by.both || { pop: 0, kids: 0 };
      head = '<span class="hl-cond">' + esc(d[2]) + '／' + whenText() + '</span><span class="hl-num"><b>' + L.pct(b.kids, sum.kids) + '%</b> の子ども（0〜14歳）が行き帰りとも行ける</span>' +
        '<span class="hl-sub">約' + man(b.kids) + '／診断した地区の0〜14歳 ' + man(sum.kids) + '</span>';
      h += '<h2 class="sum-h">' + esc(d[2]) + ' へ行ける地区</h2><p class="note" style="margin-top:0">' + esc(whenText()) + '</p>';
      if (STATE.from != null) h += '<p><button type="button" class="act" id="btn-back">← 元の地区の一覧に戻る</button></p>';
      h += farNote(d);
      h += '<p class="big"><b>' + man(b.kids) + '</b>の子ども（0〜14歳。診断した地区の ' + L.pct(b.kids, sum.kids) + '%）が、行き帰りとも行けます。</p>';
      h += summaryTable(sum, ['both', 'one', 'none', 'rail'], { both: '行き帰りとも行ける', one: '片道だけ行ける', none: '行けない', rail: '鉄道駅が近い（未評価）' });
      h += '<p class="note">「片道だけ」は、行きか帰りの一方だけが許容時間内に着ける地区です。夕方の帰りの便が少ない地区で起こりやすくなります。' +
        '0〜14歳は国勢調査メッシュの値で、人数が少ないメッシュは秘匿のため0として集計しており、実際より少なめです（総人口に対する0〜14歳の割合は ' + L.pct(sum.kids, sum.pop) + '%）。</p>';
    } else {
      var any = (sum.by.n1 ? sum.by.n1.kids : 0) + (sum.by.n2 ? sum.by.n2.kids : 0) + (sum.by.n3 ? sum.by.n3.kids : 0);
      var anyPop = (sum.by.n1 ? sum.by.n1.pop : 0) + (sum.by.n2 ? sum.by.n2.pop : 0) + (sum.by.n3 ? sum.by.n3.pop : 0);
      var nd = destsVisible().length;
      head = nd ? '<span class="hl-cond">' + whenText() + '</span><span class="hl-num"><b>' + L.pct(any, sum.kids) + '%</b> の子どもに、行き帰りとも行ける行き先がある</span>' +
        '<span class="hl-sub">行き先 ' + nd + 'か所の中で。徒歩だけで着く公園を含む</span>'
        : '<span class="hl-cond">' + whenText() + '</span><span class="hl-num">行き先の種類を選んでください（いまは1つも選ばれていません）</span>';
      h += '<h2 class="sum-h">東京都区部の診断結果（行き先 ' + nd + 'か所）</h2><p class="note" style="margin-top:0">' + esc(whenText()) + '</p>';
      if (!nd) {
        h += '<p class="notice warn">行き先の種類が1つも選ばれていません。上の「行き先の種類」で選んでください。</p>';
      } else {
        h += '<p class="big">行き帰りとも行ける行き先が1か所以上ある地区に住む子ども（0〜14歳）は <b>' + L.pct(any, sum.kids) + '%</b>（総人口では ' + L.pct(anyPop, sum.pop) + '%）です。</p>';
        h += summaryTable(sum, ['n3', 'n2', 'n1', 'n0', 'rail'], { n3: BL.n3, n2: BL.n2, n1: BL.n1, n0: BL.n0, rail: '鉄道駅が近い（未評価）' });
        h += '<p class="note">' + (STATE.view === 'a' ? '地図で地区をタップすると、その地区から行ける行き先の一覧が出ます。' : '行き先を選ぶと、行ける地区の塗り分けに変わります。') +
          'JR・東急・京急・京成などは時刻表を収録していないため、その駅の近くで「0か所」となる地区は灰色（未評価）にしています。</p>';
      }
    }
    $('summary').innerHTML = h;
    $('headline').innerHTML = head;
    var bk = $('btn-back');
    if (bk) bk.addEventListener('click', function () { var c = STATE.from; STATE.from = null; selectCell(c, true); });
  }

  /* 最寄りの収録停留所が遠い行き先の注意（d[6]=入口の点から最も近い収録停留所までの直線距離。2000m以上は2000m） */
  function farNote(d) {
    var nearest = d[6];
    if (nearest == null || nearest <= STATE.c) return '';
    return '<p class="notice warn"><b>最寄りの収録停留所が遠い行き先です</b>（約' + (nearest >= 2000 ? '2km以上' : nearest + 'm') + '先。いまの徒歩上限 ' + STATE.c +
      'm を超えています）。徒歩だけで着く近所の地区のほかは「行けない」になりますが、収録していない交通（東急・京急・私鉄・バスなど）の停留所が近い場合は、実際には行ける可能性があります。</p>';
  }
  function farTag(d) { return d[6] != null && d[6] > STATE.c ? ' <b class="warn">停留所が遠い（約' + (d[6] >= 2000 ? '2km以上' : d[6] + 'm') + '）</b>' : ''; }

  function transText(n) { return n < 0 ? '' : (n === 0 ? '乗換なし' : (n === 1 ? '乗換1回' : '乗換2回以上')); }

  function renderDetail() {
    var el = $('detail'), m = STATE.meta, h = '';
    if (STATE.view === 'a' && STATE.sel != null) {
      var c = STATE.cellIdx[STATE.sel];
      if (c == null) { el.innerHTML = ''; return; }
      var cell = m.cells[c], rows = L.listForCell(STATE.mats, layerOf(), destsVisible(), c, STATE.w);
      var both = rows.filter(function (r) { return r.status === 'both'; });
      var one = rows.length - both.length;
      h += '<h2>この地区から行ける行き先</h2><p class="note" style="margin-top:0">メッシュ ' + esc(cell[0]) + '（人口 ' + man(cell[1]) + '、0〜14歳 ' + man(cell[2]) + '）。' + esc(whenText()) + '</p>';
      h += '<div class="verdict' + (both.length ? '' : ' no') + '"><p class="v-main">行き帰りとも行ける行き先: <b>' + both.length + 'か所</b>' +
        (one ? '（片道だけ ' + one + 'か所）' : '') + '</p>' +
        (!both.length && cell[3] ? '<p class="v-cmp">この地区は未収録の鉄道（JR・東急等）の駅が近く、鉄道を使えば行ける行き先は評価できていません。</p>' : '') + '</div>';
      var limit = STATE.listAll ? rows.length : 30;
      h += '<ul class="dlist">' + rows.slice(0, limit).map(function (r) {
        var d = m.dests[r.d];
        var o = r.out != null ? '行き ' + r.out + '分以内' + (r.tOut >= 0 ? '（' + transText(r.tOut) + '）' : '') : '行き ×';
        var rt = r.ret != null ? '帰り ' + r.ret + '分以内' + (r.tRet >= 0 ? '（' + transText(r.tRet) + '）' : '') : '帰り ×';
        var open = STATE.focus === r.d;
        return '<li class="' + r.status + (open ? ' open' : '') + '"><button type="button" data-d="' + r.d + '" aria-expanded="' + open + '"><b>' + esc(d[2]) + '</b><span class="kd">' + esc(kindLabel(d[3])) +
          (d[5] ? '・' + d[5] + 'ha' : '') + '</span><br><span>' + o + '／' + rt + '</span>' +
          (r.ret != null ? '<br><span class="note">' + STATE.r + '時台に出て、遅くとも ' + L.clock(STATE.r, r.ret, 30) + ' までに帰宅</span>' : '') +
          (r.status === 'one' ? ' <b class="warn">片道だけ</b>' : '') + farTag(d) + '</button>' +
          (open ? '<div class="dopen">' + esc(kindLabel(d[3])) + (d[4] ? '（' + esc(d[4]) + '）' : '') + (d[5] ? '、面積 約' + d[5] + 'ha' : '') +
            '。地図で ◎ の印を付けました。<br><button type="button" class="act" data-view="' + r.d + '">この行き先へ行ける地区を地図で見る</button></div>' : '') + '</li>';
      }).join('') + '</ul>';
      if (rows.length > limit) h += '<button type="button" id="btn-more" class="act">残り ' + (rows.length - limit) + '件も表示</button>';
      h += '<p class="note">所要時間は5分刻み（切り上げ）の中央値で、待ち時間を含みます。「乗換」は、その時間内に着ける最少の乗換回数です。公園は、面積から半径を仮定した外周の点（入口の代わり）までで、実際の入口の位置ではありません。「帰宅」の時刻は、帰りの時間帯の最後（:30）に出た場合の目安です。</p>';
    } else if (STATE.view === 'b' && STATE.sel != null) {
      var d2 = m.dests[STATE.sel];
      h += '<h2>行き先の情報</h2><p><b>' + esc(d2[2]) + '</b><br><span class="note">' + esc(kindLabel(d2[3])) + (d2[4] ? '（' + esc(d2[4]) + '）' : '') + (d2[5] ? '、面積 約' + d2[5] + 'ha' : '') +
        '。地図の青い地区が「行き帰りとも行ける」地区です。</span></p>' + farNote(d2);
    } else {
      h += '<p class="note">' + (STATE.view === 'a' ? '地図の地区（四角いメッシュ）をタップしてください。' : '地図の行き先の点をタップするか、上の一覧から行き先を選んでください。') + '</p>';
    }
    el.innerHTML = h;
    Array.prototype.forEach.call(el.querySelectorAll('.dlist > li > button[data-d]'), function (b) {
      b.addEventListener('click', function () { focusDest(+b.getAttribute('data-d')); });
    });
    Array.prototype.forEach.call(el.querySelectorAll('button[data-view]'), function (b) {
      b.addEventListener('click', function () { STATE.from = STATE.sel; selectDest(+b.getAttribute('data-view'), true); });
    });
    var more = $('btn-more');
    if (more) more.addEventListener('click', function () { STATE.listAll = true; renderDetail(); });
  }

  /* ---------- 選択 ---------- */
  function selectCell(code, pan) {
    STATE.view = 'a'; STATE.sel = code; STATE.listAll = false; STATE.focus = null; STATE.from = null;
    setViewSeg();
    afterChange(false);
    scrollPanel($('detail'));
    if (pan && map) { var b = L.meshBounds(code); map.easeTo({ center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], zoom: Math.max(map.getZoom(), 12) }); }
  }
  /* 地区を選んだまま、一覧の行き先を開いて地図で強調する（見方は変えない） */
  function focusDest(i) {
    STATE.focus = STATE.focus === i ? null : i;
    refreshMap();
    renderDetail();
    if (STATE.focus != null && map) {
      var d = STATE.meta.dests[i];
      map.easeTo({ center: [d[0], d[1]], zoom: Math.max(map.getZoom(), 12) });
    }
  }
  function selectDest(i, pan) {
    STATE.view = 'b'; STATE.sel = i; STATE.focus = null;
    if (STATE.kinds.indexOf(STATE.meta.dests[i][3]) < 0) { STATE.kinds.push(STATE.meta.dests[i][3]); buildControls(); }
    setViewSeg();
    buildDestSelect();
    afterChange(false);
    scrollPanel($('summary'));
    fitToAnswer();
  }
  /* 行き先を選んだとき、行ける地区の全体（と行き先の点）が見えるように地図を合わせる */
  function fitToAnswer() {
    if (!map || !STATE.statuses || STATE.view !== 'b' || STATE.sel == null) return;
    var idx = [];
    STATE.statuses.forEach(function (s, c) { if (s === 'both' || s === 'one') idx.push(c); });
    var d = STATE.meta.dests[STATE.sel];
    if (!idx.length) { map.easeTo({ center: [d[0], d[1]], zoom: Math.max(map.getZoom(), 12) }); return; }
    fitToCells(idx, [[d[0], d[1]]]);
  }
  function setViewSeg() {
    Array.prototype.forEach.call($('ctl-view').children, function (b, k) { b.setAttribute('aria-checked', String(['a', 'b'][k] === STATE.view)); });
    updateViewHelp();
  }
  function scrollPanel(el) {
    if (!el || !el.scrollIntoView) return;
    var p = $('panel');
    p.classList.remove('closed'); document.body.classList.remove('sheet-closed');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function onMapClick(e) {
    if (STATE.region === 'osaka') return;
    if (!STATE.mats) return;
    // 見方 a（地区から探す）で広く見ているときは、点が密で地区を選びにくいので、地区の選択を優先する
    var f = STATE.view === 'a' && map.getZoom() < 12 ? [] : map.queryRenderedFeatures(e.point, { layers: ['dests'] });
    if (f.length) { STATE.from = null; selectDest(f[0].properties.i, false); return; }
    var code = L.meshCodeAt(e.lngLat.lng, e.lngLat.lat);
    if (STATE.cellIdx[code] == null) {
      if (popup) popup.remove();
      popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML('この地点は診断の対象外です（収録した停留所から' + STATE.meta.params.diag_radius_m + 'm以内の、人口のある500mメッシュだけを診断しています）。').addTo(map);
      return;
    }
    selectCell(code, false);
  }

  /* ---------- 地域（東京 / 大阪） ---------- */
  function renderOsaka() {
    if (!STATE.osaka || !map || !map.getSource('dests')) return;
    var d = STATE.osaka.dests.filter(function (x) { return STATE.kinds.indexOf(x[3]) >= 0; });
    map.getSource('dests').setData({ type: 'FeatureCollection', features: d.map(function (x) {
      return { type: 'Feature', properties: { i: -1, col: KIND_COLORS[x[3]], r: 1, ring: 0, k: x[3], name: x[2], kind: x[4], ha: x[5] }, geometry: { type: 'Point', coordinates: [x[0], x[1]] } };
    }) });
  }

  function osakaLegend() {
    return '<b>行き先の種類（点の色）</b>' + STATE.meta.kinds.map(function (k) {
      return '<span><i class="dot" style="background:' + KIND_COLORS[k[0]] + '"></i>' + k[1] + '</span>';
    }).join('');
  }

  function setRegion(id) {
    STATE.region = id;
    var tokyo = id === 'tokyo';
    $('osaka-note').hidden = tokyo;
    ['ctl-calc', 'pick', 'summary', 'detail', 'coverage', 'data-warn', 'lead-tokyo'].forEach(function (k) { if ($(k)) $(k).hidden = !tokyo; });
    if ($('lead-osaka')) $('lead-osaka').hidden = tokyo;
    if (tokyo) renderCoverage();
    $('map-legend').hidden = false;
    Array.prototype.forEach.call($('region-seg').children, function (b, k) { b.setAttribute('aria-checked', String(['tokyo', 'osaka'][k] === id)); });
    var show = function (k, v) { if (map && map.getLayer(k)) map.setLayoutProperty(k, 'visibility', v ? 'visible' : 'none'); };
    if (!map || !map.getSource('cells')) return;
    if (tokyo) {
      show('cells', $('lyr-cells').checked); show('rail', $('lyr-rail').checked); show('selcell', true);
      fitAllCells();
      refresh();
      if (!STATE.mats) loadMats(refresh);
    } else {
      show('cells', false); show('rail', false); show('selcell', false);
      $('map-legend').innerHTML = osakaLegend();
      $('headline').innerHTML = '<span class="hl-num">大阪は時刻表のオープンデータが無いため、<b>行き先の位置だけ</b>を表示しています（所要時間は出していません）</span>';
      var go = function (o) {
        STATE.osaka = o;
        map.getSource('selcell').setData({ type: 'FeatureCollection', features: [] });
        map.getSource('seldest').setData({ type: 'FeatureCollection', features: [] });
        map.getSource('home').setData({ type: 'FeatureCollection', features: [] });
        map.jumpTo({ center: o.center, zoom: 10.6 });
        $('data-warn').hidden = true;
        renderOsaka();
        writeHash();
      };
      if (STATE.osaka) go(STATE.osaka); else getJSON('data/osaka.json').then(go).catch(function (e) { showFail('大阪の行き先', e); });
    }
  }

  /* ---------- 地図 ---------- */
  function initMap(cb) {
    map = new maplibregl.Map({
      container: 'map',
      style: { version: 8,
        sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18, tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
          attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: STATE.meta.region.center, zoom: 10.3, attributionControl: { compact: true }
    });
    updatePadding();
    window.addEventListener('resize', function () { updatePadding(); });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      updatePadding();
      fitAllCells();
      var empty = { type: 'FeatureCollection', features: [] };
      ['cells', 'rail', 'dests', 'selcell', 'seldest', 'home'].forEach(function (s) { map.addSource(s, { type: 'geojson', data: empty }); });
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: {
        'fill-color': ['match', ['get', 'st'], 'both', COLORS.both, 'one', COLORS.one, 'rail', COLORS.rail, 'n1', COLORS.n1, 'n2', COLORS.n2, 'n3', COLORS.n3, COLORS.none],
        'fill-opacity': ['case', ['==', ['get', 'off'], 1], 0.04, ['==', ['get', 'dim'], 1], OPA.dim, ['==', ['get', 'st'], 'none'], OPA.none, ['==', ['get', 'st'], 'n0'], OPA.n0, OPA.fill],
        'fill-outline-color': 'rgba(255,255,255,0.35)' } });
      map.addLayer({ id: 'selcell', type: 'line', source: 'selcell', paint: { 'line-color': '#000', 'line-width': 3 } });
      map.addLayer({ id: 'rail', type: 'circle', source: 'rail', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 4], 'circle-color': '#fff', 'circle-stroke-color': '#555', 'circle-stroke-width': 1.2 } });
      map.addLayer({ id: 'dests', type: 'circle', source: 'dests', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'r'], 3], 13, ['*', ['get', 'r'], 6], 16, ['*', ['get', 'r'], 9]],
        'circle-color': ['get', 'col'], 'circle-stroke-color': ['coalesce', ['get', 'sc'], '#222'], 'circle-stroke-width': ['coalesce', ['get', 'sw'], 1.2] } });
      map.addLayer({ id: 'home', type: 'circle', source: 'home', paint: {
        'circle-radius': 9, 'circle-color': '#000', 'circle-stroke-color': '#fff', 'circle-stroke-width': 4 } });
      map.addLayer({ id: 'seldest', type: 'circle', source: 'seldest', paint: {
        'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#000', 'circle-stroke-width': 3 } });
      map.on('click', onMapClick);
      map.on('click', 'dests', function (e) {
        if (STATE.region !== 'osaka') return;
        var p = e.features[0].properties;
        if (popup) popup.remove();
        popup = new maplibregl.Popup().setLngLat(e.lngLat).setHTML('<b>' + esc(p.name) + '</b><br>' + esc(p.kind) + (p.ha ? '・約' + esc(p.ha) + 'ha' : '') +
          '<br><span class="note">大阪は時刻表のオープンデータが無いため、行き先の位置のみです。</span>').addTo(map);
      });
      map.on('mouseenter', 'dests', function () { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'dests', function () { map.getCanvas().style.cursor = ''; });
      STATE.cellFeats = cellFeatures();
      map.getSource('rail').setData({ type: 'FeatureCollection', features: STATE.meta.rail.map(function (r) {
        return { type: 'Feature', properties: { n: r[2], op: r[3] }, geometry: { type: 'Point', coordinates: [r[0], r[1]] } };
      }) });
      cb();
    });
  }

  function applyLayerVisibility() {
    if (!map || !map.getLayer('cells')) return;
    var tokyo = STATE.region === 'tokyo';
    map.setLayoutProperty('cells', 'visibility', tokyo && $('lyr-cells').checked ? 'visible' : 'none');
    map.setLayoutProperty('dests', 'visibility', $('lyr-dests').checked ? 'visible' : 'none');
    map.setLayoutProperty('rail', 'visibility', tokyo && $('lyr-rail').checked ? 'visible' : 'none');
  }

  /* ---------- 画面上部の収録範囲・期限の警告 ---------- */
  function renderCoverage() {
    var m = STATE.meta, c = m.coverage;
    $('coverage').innerHTML = '<b>収録範囲:</b> 東京都区部。公共交通は公共交通オープンデータセンターの' + c.feeds + 'データ（都営地下鉄・東京メトロ・都営バス・民間バスなど）だけで、' +
      '<b>JR・東急・京急・京成・私鉄各線は未収録</b>です。未収録の鉄道の駅が近い地区は、行けなくても赤ではなく灰色（未評価）にしています。' +
      '<b>大阪は時刻表のオープンデータが無いため未対応</b>です。';
    if (c.skipped_feeds && c.skipped_feeds.length) {
      $('coverage').innerHTML += '<br><b class="warn">取得できなかったデータがあり、診断に含まれていません:</b> ' +
        esc(c.skipped_feeds.map(function (k) { return k.join('/'); }).join('、')) + '（その事業者の路線・バスを使えない前提の結果になっています）。';
    }
    var today = new Date().toISOString().slice(0, 10), ended = [], ending = [];
    m.feeds.forEach(function (f) {
      if (f.expired || (f.valid[1] && f.valid[1] < today)) ended.push(f);
      else if (f.ends_before_public_end) ending.push(f);
    });
    ending.sort(function (a, b) { return a.valid[1] < b.valid[1] ? -1 : 1; });
    var el = $('data-warn');
    if (!(ended.length || ending.length)) el.hidden = true;
    if (ended.length || ending.length) {
      el.hidden = false;
      el.innerHTML = '<b>データの期限:</b> ' + (ended.length ? ended.length + 'データは有効期間が終わっています。' : '') +
        (ending.length ? ending.length + 'データは公開期間の終わり（' + esc(m.public_until) + '）より前に終わります（最も早いのは' + esc(ending[0].org) + 'の' + esc(ending[0].valid[1]) + '）。' : '') +
        '期限後は時刻表が変わっている可能性があり、診断は参考値です（基準日は日曜、生成日 ' + esc(m.built) + '。一覧は「出典・ライセンス・診断の前提」）。';
    }
  }

  /* ---------- 出典・前提 ---------- */
  function pageUrl() {
    var u = location.href.split('#')[0];
    return /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/.test(u) ? '（公開URL）' : u;
  }
  function openAbout() {
    var m = STATE.meta, p = m.params;
    var h = '<h2 id="about-title" style="margin-top:0">出典・ライセンス・診断の前提</h2>';
    h += '<p>本アプリは、収録した事業者・地域のデータだけで診断しています。<b>東京都区部の一部の公共交通だけが対象で、JR・東急・京急・京成などの鉄道は含みません</b>。大阪は時刻表のオープンデータが無いため所要時間を出していません。</p>';
    h += '<h2>収録した公共交通のデータ（公共交通オープンデータセンター）</h2>';
    h += '<p class="note" id="odpt-notice">' + esc(L.ODPT_NOTICE) + '</p>';
    h += '<p>出典: <a href="https://www.odpt.org/" target="_blank" rel="noopener">公共交通オープンデータセンター</a>（公開API、および開発者登録で得たアクセストークンで取得する認証API）。' +
      'データは事業者が公開したGTFSで、本アプリでは停留所の集約・休日（日曜）ダイヤの接続の計算・所要時間の計算という加工を行っています。' +
      'ライセンスが「公共交通オープンデータ基本ライセンス」のデータについて、個々の便の時刻は公開データに含めていません（所要時間を5分刻みにした結果だけを出力）。</p>';
    h += '<table><tr><th>事業者</th><th>データ名</th><th>ライセンス・クレジット</th><th>更新日</th><th>データ有効期間</th><th>診断の基準日（休日）</th></tr>';
    m.feeds.forEach(function (f) {
      var warn = f.expired ? ' <b class="warn">期限切れ</b>' : (f.ends_before_public_end ? ' <b class="warn">公開期間（〜' + esc(m.public_until) + '）の途中で終了</b>' : '');
      h += '<tr><td><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.org) + '</a></td><td>' + esc(f.name) + '</td><td>' +
        (f.license_url ? '<a href="' + esc(f.license_url) + '" target="_blank" rel="noopener">' + esc(f.license) + '</a>' : esc(f.license)) +
        (f.credit ? '<br>クレジット: ' + esc(f.credit) : '') + '</td><td>' + esc(f.updated) + '</td><td>' + esc((f.valid[0] || '?') + '〜' + (f.valid[1] || '?')) + warn +
        '</td><td>' + esc(f.ref_hol) + '</td></tr>';
    });
    h += '</table><p class="note">データ生成日: ' + esc(m.built) + '。基準日は、各データの有効期間内で生成日以降の最初の日曜です。土曜・祝日・臨時ダイヤは反映していません。</p>';
    h += '<h2>行き先・人口・地図</h2><ul>' +
      '<li><b>行き先（公園）</b>: 国土数値情報「都市公園データ」P13（2011年度版、データ基準 2010年3月、国土交通省）を加工して作成。面積1ha以上のうち、緑道・緩衝緑地を除く。位置は公園の中心付近の点で、判定には面積から仮定した外周の点を使います。約1割の公園は位置が特定できず元データに含まれません。</li>' +
      '<li><b>行き先（動物園・水族館・博物館等）</b>: 国土数値情報「文化施設データ」P27（2013年度版、国土交通省）を加工して作成。文化施設分類のうち動植物園・水族館・博物館等だけを使い、動物園と植物園は名称で分けた推定です。休館・閉館した施設を含む場合があります。美術館・図書館は対象にしていません。</li>' +
      '<li><b>使用許諾条件（そのまま）</b>: ' + esc(L.KSJ_TERMS) + '</li>' +
      '<li><b>人口</b>: 政府統計の総合窓口（e-Stat）「令和2年国勢調査 地域メッシュ統計」（250mメッシュ）を500mメッシュに集約して作成。0〜14歳人口は人数が少ないメッシュで秘匿（0として集計）のため、実際より少なめです。</li>' +
      '<li><b>鉄道駅</b>: 国土数値情報「鉄道データ」N02-22（国土交通省、令和4年12月31日時点）を加工して作成。時刻表を収録していない鉄道の駅の位置だけを示し、駅から徒歩' + p.rail_walk_min + '分圏（直線約' + p.rail_walk_m + 'm）の地区を「鉄道駅が近い（未評価）」とするためだけに使っています。</li>' +
      '<li><b>地図</b>: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。住所・駅名の検索: 国土地理院 地名検索API（検索したときだけ入力文字列をGETで送ります）。</li></ul>';
    h += '<h2>資料に貼れる出典の例</h2><p style="font-size:.8rem;background:#f3f5f8;padding:6px 8px;border-radius:6px">' + esc(L.citationText(m, { url: pageUrl(), date: new Date().toISOString().slice(0, 10) })) + '</p>';
    h += '<h2>診断の前提と限界（仮定を含む）</h2><ul>' +
      '<li>「行ける」は、指定時刻に500mメッシュの中心（行き）／行き先の点（帰り）を出て、徒歩→公共交通（乗継可）→徒歩で、片道の許容時間内に着けること。待ち時間を含みます。「行き帰りとも行ける」は、行きの診断と帰りの診断の両方を満たすことです。実際に滞在できる時間は別です。</li>' +
      '<li><b>徒歩は分速' + p.walk_m_per_min + 'm（仮定）</b>。ベビーカー連れの速度を示す根拠資料は確認しておらず、一般の徒歩の目安（分速80m）の75%と置いた仮定です。直線距離の' + p.detour + '倍を道のりとし、坂・段差・信号・横断は未考慮です。乗継の余裕' + (p.transfer_s / 60) + '分も<b>仮定</b>です。</li>' +
      '<li>徒歩1回の上限は直線距離で、出発地から最初の停留所、最後の停留所から到着地、および乗らずに歩いて着く場合に適用します。乗継は、同じ停留所群（近接・同名の停留所を統合）の中のほか、直線' + p.walk_transfer_m + 'm以内の別の停留所・駅へ歩いて乗り換えられるものとしています（徒歩時間を加算。乗継の余裕は別に必要）。</li>' +
      '<li><b>出発時刻は幅で判定</b>: 行きは9時台・10時台、帰りは16時台・17時台の先頭から' + p.window_min + '分の間に' + p.window_step_min + '分おきに出発した' + (p.window_min / p.window_step_min + 1) +
      '通りの所要時間の中央値（半分以上の出発で着けなければ「行けない」）。5分ずれても結果が大きく変わらないようにする定義で、乗り遅れや、その時間帯以外の便は反映しません。</li>' +
      '<li><b>公園の入口</b>: 公園は点データしかなく形が分からないため、面積と同じ面積の円を仮定し、中心から等価半径（最大' + 700 + 'm）離れた外周の' + p.ring_points + '点と中心のうち最も近い点から出入りするものとしています（実際の入口の位置ではありません）。動物園・水族館・博物館等は施設の点です。</li>' +
      '<li>エレベーター・ベビーカーでの乗降のしやすさ、混雑、授乳室・おむつ替えの場所、施設の開館時間・入場料・運賃は評価していません。</li>' +
      '<li>収録していない鉄道・バス・デマンド交通は評価していません。「行けない」の中には、未収録の交通で行ける地区が含まれます。診断範囲は収録した停留所から' + p.diag_radius_m + 'm以内の人口メッシュです。</li>' +
      '<li>診断は時刻表データに基づく計算であり、実際の遅延・運休を示すものではありません。結果は計画・検討の参考であり、個別の移動の保証ではありません。</li></ul>';
    $('about').innerHTML = h;
    $('modal').hidden = false;
    $('modal-close').focus();
  }
  function closeAbout() { $('modal').hidden = true; }

  /* ---------- 共有・検索 ---------- */
  function writeHash() {
    if (STATE.region !== 'tokyo') { try { history.replaceState(null, '', '#region=osaka'); } catch (e) { /* 無視 */ } return; }
    var h = L.writeHash({ o: STATE.o, r: STATE.r, w: STATE.w, c: STATE.c, t: STATE.t, kinds: STATE.kinds, view: STATE.view, sel: STATE.sel });
    try { history.replaceState(null, '', h); } catch (e) { /* file:// 等では無視 */ }
    $('cite-text').value = L.citationText(STATE.meta, { url: pageUrl(), date: new Date().toISOString().slice(0, 10) });
  }
  function copyText(text, msgId) {
    var done = function (ok) { $(msgId).textContent = ok ? 'コピーしました' : 'コピーできませんでした。手動で選んでコピーしてください。'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  function doSearch(q) {
    q = (q || '').trim();
    var out = $('search-result');
    if (!q) { out.textContent = '住所か駅名を入力してください。'; return; }
    out.textContent = '検索中…';
    fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (js) {
      if (!js || !js.length) { out.textContent = '見つかりませんでした。'; return; }
      var b = STATE.meta.region.bbox, found = js.filter(function (x) {
        var c = x.geometry.coordinates; return c[0] >= b[0] && c[0] <= b[2] && c[1] >= b[1] && c[1] <= b[3];
      });
      if (!found.length) { out.textContent = '診断範囲（東京都区部）の外です。'; return; }
      out.innerHTML = '';
      found.slice(0, 5).forEach(function (x) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = x.properties.title;
        btn.addEventListener('click', function () {
          var c = x.geometry.coordinates, code = L.meshCodeAt(c[0], c[1]);
          if (STATE.cellIdx[code] == null) { out.textContent = 'その場所は診断の対象外です（人口のあるメッシュで、停留所から' + STATE.meta.params.diag_radius_m + 'm以内のみ）。'; return; }
          out.textContent = '';
          selectCell(code, true);
        });
        out.appendChild(btn);
      });
    }).catch(function () { out.textContent = '検索できませんでした（通信を確認してください）。'; });
  }

  /* ---------- 起動 ---------- */
  function init() {
    if (typeof maplibregl === 'undefined') {
      $('summary').innerHTML = '<p class="note">地図の部品（MapLibre GL JS）を読み込めませんでした。ネットワーク（unpkg.com への接続）を確認して、ページを再読み込みしてください。</p>';
      return;
    }
    getJSON('data/meta.json').then(function (meta) {
      STATE.meta = meta;
      STATE.cellIdx = L.indexCells(meta.cells);
      var allKinds = meta.kinds.map(function (k) { return k[0]; });
      var hs = L.parseHash(location.hash);
      var wantOsaka = /region=osaka/.test(location.hash);
      var okv = function (v, list) { return v != null && list.indexOf(v) >= 0; };
      STATE.o = okv(hs.o, meta.params.out_hours) ? hs.o : 9;
      STATE.r = okv(hs.r, meta.params.ret_hours) ? hs.r : 16;
      STATE.w = okv(hs.w, [30, 45, 60, 90]) ? hs.w : 45;
      STATE.c = okv(hs.c, meta.params.caps_m) ? hs.c : 500;
      STATE.t = okv(hs.t, [1, 2, 3]) ? hs.t : 2;
      STATE.kinds = hs.kinds ? allKinds.filter(function (k) { return hs.kinds.indexOf(k) >= 0; }) : allKinds;
      STATE.view = hs.view || 'a';
      if (hs.sel != null) {
        if (STATE.view === 'a' && STATE.cellIdx[hs.sel] != null) STATE.sel = hs.sel;
        else if (STATE.view === 'b' && /^\d+$/.test(hs.sel) && +hs.sel < meta.dests.length) STATE.sel = +hs.sel;
      }
      seg($('region-seg'), [{ value: 'tokyo', label: '東京都区部' }, { value: 'osaka', label: '大阪（時刻表なし・位置のみ）' }], 'tokyo', function (v) {
        setRegion(v);
        applyLayerVisibility();
      });
      buildControls();
      buildDestSelect();
      renderCoverage();
      $('dest-select').addEventListener('change', function () {
        var v = $('dest-select').value;
        if (v === '') { STATE.sel = STATE.view === 'b' ? null : STATE.sel; afterChange(false); } else selectDest(+v, true);
      });
      initMap(function () {
        applyLayerVisibility();
        loadMats(function () {
          refresh();
          if (STATE.sel != null && STATE.view === 'b') fitToAnswer();
          else if (STATE.sel != null && STATE.view === 'a' && STATE.cellIdx[STATE.sel] != null) {
            var b0 = L.meshBounds(STATE.sel);
            map.jumpTo({ center: [(b0[0] + b0[2]) / 2, (b0[1] + b0[3]) / 2], zoom: 12 });
          }
          if (wantOsaka) setRegion('osaka');
        });
      });
    }).catch(function (e) { showFail('診断画面', e); });
    $('search-form').addEventListener('submit', function (e) { e.preventDefault(); doSearch($('search-q').value); });
    $('btn-share').addEventListener('click', function () { copyText(location.href, 'share-msg'); });
    $('btn-cite').addEventListener('click', function () { copyText($('cite-text').value, 'cite-msg'); });
    $('btn-about').addEventListener('click', openAbout);
    $('modal-close').addEventListener('click', closeAbout);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeAbout(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAbout(); });
    $('sheet-toggle').addEventListener('click', function () {
      var p = $('panel');
      var closed = p.classList.toggle('closed');
      document.body.classList.toggle('sheet-closed', closed);
      $('sheet-toggle').setAttribute('aria-expanded', String(!closed));
      $('sheet-toggle').textContent = closed ? '▲ 結果と条件を見る' : '▼ 地図を広く見る';
      updatePadding();
    });
    ['cells', 'dests', 'rail'].forEach(function (k) { $('lyr-' + k).addEventListener('change', applyLayerVisibility); });
  }

  window.App = { STATE: STATE, refresh: refresh, getMap: function () { return map; } };
  init();
})();
