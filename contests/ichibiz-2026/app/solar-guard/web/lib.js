/* 太陽光発電所の金属盗対策アプリ: 計算（画面に依存しない）。ブラウザでは window.Sg、node では module.exports。
   扱うのは集計（約5kmメッシュ・市町村）と、利用者がその場で入力した1地点だけ。個別設備のデータは持たない。 */
(function (root) {
  'use strict';
  var CELL = 5;            // 集計メッシュ＝1kmメッシュ×5（build_data.py の CELL と同じ）
  var KM2_PER_MESH = 1.04; // 1kmメッシュの面積の目安（緯度36度付近: 東西約1.13km×南北約0.93km）
  /* 指標。初期の重み def: 人の少なさは0（参考）。理由は README「指標の見直し」: 県警の5地区別の被害と対応せず、常住人口は人目の代理として弱い */
  var IND = [
    { id: 'kw', label: '設備1件あたりの出力', def: 1, hint: 'メッシュ内の出力合計÷設備数（kW/件）が大きいほど高い（1件あたりの被害額の大きさの目安）' },
    { id: 'small', label: '低圧（50kW未満）の割合', def: 1, hint: 'メッシュ内の設備のうち出力50kW未満の割合が高いほど高い' },
    { id: 'quiet', label: '周囲の人の少なさ（参考）', def: 0, hint: '集計メッシュの常住人口密度（人/km²）が低いほど高い。初期値は0（目安に使わない）' }
  ];
  function defaultWeights() { var w = {}; IND.forEach(function (d) { w[d.id] = d.def; }); return w; }

  /* 経緯度 → 1kmメッシュの格子番号（lat = iy/120, lon = 100 + ix/80 が南西角）と、集計メッシュの番号 */
  function toMesh(lon, lat) {
    var ix = Math.floor((lon - 100) * 80 + 1e-9), iy = Math.floor(lat * 120 + 1e-9);
    return { ix: ix, iy: iy, cx: Math.floor(ix / CELL), cy: Math.floor(iy / CELL) };
  }
  function cellBounds(cx, cy) { /* [西, 南, 東, 北] */
    return [100 + cx * CELL / 80, cy * CELL / 120, 100 + (cx + 1) * CELL / 80, (cy + 1) * CELL / 120];
  }
  /* 基準地域メッシュコード（8桁）。1kmメッシュの格子番号から */
  function meshCode(ix, iy) {
    var p = Math.floor(iy / 80), r = iy % 80, u = Math.floor(ix / 80), s = ix % 80;
    var two = function (x) { return (x < 10 ? '0' : '') + x; };
    return two(p) + two(u) + Math.floor(r / 10) + Math.floor(s / 10) + (r % 10) + (s % 10);
  }

  /* 人口グリッド: rows=[[ix,iy,pop]] → Map */
  function popGrid(rows) {
    var m = new Map();
    rows.forEach(function (r) { m.set(r[0] + ',' + r[1], r[2]); });
    return m;
  }
  function popAt(grid, ix, iy) { return grid.get(ix + ',' + iy) || 0; }
  /* 1kmメッシュの周囲 (2r+1)×(2r+1) の人口（人）。r=1 なら約3km四方 */
  function localPop(grid, ix, iy, r) {
    var s = 0;
    for (var dx = -r; dx <= r; dx++) for (var dy = -r; dy <= r; dy++) s += popAt(grid, ix + dx, iy + dy);
    return s;
  }
  function cellPop(grid, cx, cy) {
    var s = 0;
    for (var dx = 0; dx < CELL; dx++) for (var dy = 0; dy < CELL; dy++) s += popAt(grid, cx * CELL + dx, cy * CELL + dy);
    return s;
  }
  function density(pop) { return pop / (CELL * CELL * KM2_PER_MESH); } // 人/km²

  /* 順位を0〜100に直す（同値は平均順位）。値が1つなら50。 */
  function percentRank(vals) {
    var n = vals.length;
    if (n === 0) return [];
    if (n === 1) return [50];
    var sorted = vals.slice().sort(function (a, b) { return a - b; });
    var first = new Map(), last = new Map();
    sorted.forEach(function (v, i) { if (!first.has(v)) first.set(v, i); last.set(v, i); });
    return vals.map(function (v) { return ((first.get(v) + last.get(v)) / 2) / (n - 1) * 100; });
  }

  /* 利用者が与える重み {quiet,kw,small}（0以上）。合計0なら null を返す */
  function weightedScore(parts, w) {
    var tw = 0, s = 0;
    IND.forEach(function (d) { var x = Math.max(0, +w[d.id] || 0); tw += x; s += x * parts[d.id]; });
    return tw > 0 ? s / tw : null;
  }

  /* 集計メッシュ: cells.json の rows（[cx,cy,n,kw,small,pop]）→ 内部計算用の指標の位置と score。画面・CSV・公開データには出さない（app.js が帯だけ残して捨てる） */
  function scoreCells(rows, w) {
    var base = rows.map(function (r) {
      return { cx: r[0], cy: r[1], n: r[2], kw: r[3], small: r[4], pop: r[5], dens: density(r[5]), share: r[2] ? r[4] / r[2] : 0 };
    });
    var q = percentRank(base.map(function (c) { return -c.dens; }));
    var k = percentRank(base.map(function (c) { return c.n ? c.kw / c.n : 0; }));
    var s = percentRank(base.map(function (c) { return c.share; }));
    base.forEach(function (c, i) {
      c.parts = { quiet: q[i], kw: k[i], small: s[i] };
      c.score = weightedScore(c.parts, w);
    });
    return base;
  }

  /* 市町村: munis.json の rows。n が null（3件未満で秘匿）は指標・スコアを付けない */
  function scoreMunis(rows, w) {
    var out = rows.map(function (m) {
      var hide = m.n == null;
      return { name: m.name, n: m.n, kw: m.kw, small: m.small, pop: m.pop, area: m.area_km2, hidden: hide,
        dens: m.area_km2 ? m.pop / m.area_km2 : 0, kwEach: !hide && m.n ? m.kw / m.n : 0, share: !hide && m.n ? m.small / m.n : 0 };
    });
    var vis = out.filter(function (m) { return !m.hidden; });
    var q = percentRank(vis.map(function (m) { return -m.dens; }));
    var k = percentRank(vis.map(function (m) { return m.kwEach; }));
    var s = percentRank(vis.map(function (m) { return m.share; }));
    vis.forEach(function (m, i) { m.parts = { quiet: q[i], kw: k[i], small: s[i] }; m.score = weightedScore(m.parts, w); });
    out.forEach(function (m) { if (m.hidden) { m.parts = null; m.score = null; } });
    return out;
  }

  /* 5段階の帯（0=低 … 4=高）。スコアの順位（同値は平均順位）を5等分する。同値が多いと同じ帯に入る（順位は出さない）。 */
  function bands(scores) {
    var idx = [], vals = [];
    scores.forEach(function (x, i) { if (x != null) { idx.push(i); vals.push(x); } });
    var pr = percentRank(vals), out = scores.map(function () { return null; });
    pr.forEach(function (p, j) { out[idx[j]] = Math.min(4, Math.floor(p / 20)); });
    return out;
  }

  /* 座標の入力 → 数値。全角を半角にし、符号付きの10進数だけを受け付ける（「36,34」「36.34abc」は null） */
  function parseCoord(s) {
    var t = String(s == null ? '' : s).normalize('NFKC').trim();
    return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
  }

  /* 茨城県の区域に重なる1kmメッシュ（land.json の rows: [iy, ix0, ix1, ...]）→ 判定関数 */
  function landSet(rows) {
    var m = new Map();
    rows.forEach(function (r) { var runs = []; for (var i = 1; i < r.length; i += 2) runs.push([r[i], r[i + 1]]); m.set(r[0], runs); });
    return function (ix, iy) { var runs = m.get(iy) || []; for (var i = 0; i < runs.length; i++) if (ix >= runs[i][0] && ix <= runs[i][1]) return true; return false; };
  }

  /* 県内5地区: 市町村の目安（連続値）の地区平均と、県警の被害の設備1,000件あたりを並べ、順位と順位相関を返す。
     regions: {地区: [市町村]}、theft: [{area, n}]、scored: scoreMunis の結果。5点だけの比較で、重みを実績に合わせるために使ってはいけない。 */
  function districtCompare(regions, theft, scored) {
    var by = {}; scored.forEach(function (m) { by[m.name] = m; });
    var rows = theft.map(function (t) {
      var ms = (regions[t.area] || []).map(function (n) { return by[n]; }).filter(function (m) { return m && !m.hidden; });
      var plants = ms.reduce(function (a, m) { return a + m.n; }, 0);
      var sc = ms.filter(function (m) { return m.score != null; });
      return { area: t.area, theft: t.n, plants: plants, rate: plants ? t.n / plants * 1000 : null, munis: ms.length,
        score: sc.length ? sc.reduce(function (a, m) { return a + m.score; }, 0) / sc.length : null };
    });
    var ok = rows.filter(function (r) { return r.score != null && r.rate != null; });
    var rr = percentRank(ok.map(function (r) { return r.rate; })), rs = percentRank(ok.map(function (r) { return r.score; }));
    var n = ok.length, rho = null;
    if (n > 2) {
      var ma = rr.reduce(function (a, b) { return a + b; }, 0) / n, mb = rs.reduce(function (a, b) { return a + b; }, 0) / n, c = 0, va = 0, vb = 0;
      for (var i = 0; i < n; i++) { c += (rr[i] - ma) * (rs[i] - mb); va += (rr[i] - ma) * (rr[i] - ma); vb += (rs[i] - mb) * (rs[i] - mb); }
      rho = va && vb ? c / Math.sqrt(va * vb) : null;
    }
    ok.forEach(function (r, i) { r.rankRate = Math.round(rr[i] / 100 * (n - 1)) + 1; r.rankScore = Math.round(rs[i] / 100 * (n - 1)) + 1; }); // 1=最低 … n=最高
    return { rows: rows, rho: rho };
  }

  /* 事業者の自己診断。
     input: { lon, lat, cls: 'low'|'high'|'special'|'unknown', answers: {id: 'yes'|'no'|'unknown'} }
     ctx:   { cells: cells.json の rows, pops: popGrid, items: checklist の items, weights }
     返す値は、周囲の目安（集計と人口だけから）と、未実施・不明の対策。個別設備の情報は参照しない。 */
  function diagnose(input, ctx) {
    var m = toMesh(input.lon, input.lat);
    var cellRow = ctx.cells.filter(function (r) { return r[0] === m.cx && r[1] === m.cy; })[0] || null;
    var cellPopulation = cellPop(ctx.pops, m.cx, m.cy);   // 約5kmメッシュの人口だけを使う（入力点の1kmメッシュの人口は使わない）
    var allDens = scoreCells(ctx.cells, ctx.weights).map(function (c) { return -c.dens; });
    var mine = -density(cellPopulation);
    var below = allDens.filter(function (x) { return x < mine; }).length, eq = allDens.filter(function (x) { return x === mine; }).length;
    var quiet = allDens.length ? (below + eq / 2) / allDens.length * 100 : null; // 0〜100（同値は平均順位）
    var items = ctx.items.filter(function (it) { return input.cls === 'unknown' || it.cls.indexOf('all') >= 0 || it.cls.indexOf(input.cls) >= 0; });
    var done = 0, no = [], unk = [];
    items.forEach(function (it) {
      var a = (input.answers || {})[it.id] || 'unknown';
      if (a === 'yes') done++; else if (a === 'no') no.push(it); else unk.push(it);
    });
    return {
      mesh: m, code: meshCode(m.cx * CELL, m.cy * CELL), cellDensity: density(cellPopulation), cellPopulation: cellPopulation,
      quietPos: quiet, quietBand: quiet == null ? null : Math.min(4, Math.floor(quiet / 20)), cellVisible: !!cellRow,
      cell: cellRow ? { n: cellRow[2], kw: cellRow[3], small: cellRow[4] } : null,
      total: items.length, done: done, notDone: no, unknown: unk
    };
  }

  /* CSV（UTF-8, BOM は書き出し側）。値のエスケープ */
  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n'); }

  var api = { CELL: CELL, KM2_PER_MESH: KM2_PER_MESH, IND: IND, defaultWeights: defaultWeights, parseCoord: parseCoord, landSet: landSet, districtCompare: districtCompare, toMesh: toMesh, cellBounds: cellBounds, meshCode: meshCode, popGrid: popGrid, popAt: popAt, localPop: localPop,
    cellPop: cellPop, density: density, percentRank: percentRank, weightedScore: weightedScore, scoreCells: scoreCells, scoreMunis: scoreMunis, bands: bands,
    diagnose: diagnose, csvEscape: csvEscape, toCsv: toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sg = api;
})(typeof window !== 'undefined' ? window : globalThis);
