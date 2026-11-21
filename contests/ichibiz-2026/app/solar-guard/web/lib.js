/* 太陽光発電所の金属盗対策アプリ: 計算（画面に依存しない）。ブラウザでは window.Sg、node では module.exports。
   扱うのは集計（約5kmメッシュ・市町村）と、利用者がその場で入力した1地点だけ。個別設備のデータは持たない。 */
(function (root) {
  'use strict';
  var CELL = 5;            // 集計メッシュ＝1kmメッシュ×5（build_data.py の CELL と同じ）
  var KM2_PER_MESH = 1.04; // 1kmメッシュの面積の目安（緯度36度付近: 東西約1.13km×南北約0.93km）
  /* リスクの色分け（仮の規則。公的な数値の根拠はない。README「色分けの規則」）。
     メッシュ・市町村: 地区の実績（県警の設備あたり件数）を主な根拠にした点数 W_REGION×地区の段階(0〜2) ＋ 人目の少なさ(0か1) を、4段階の色にする。
     自己診断: 同じ地区の点数 ＋ JPEA・REASP の条件に当てはまる数（0〜7）。 */
  var LEVELS = ['低', '中', 'やや高', '高'];
  var W_REGION = 2;          // 地区の段階1つ分の点数（人目の少なさ1つ分の2倍。地区の実績を主な根拠にするため。仮）
  var TIER_MID = 20;         // 設備1,000件あたりの件数がこれ以上なら段階1（仮）。県全体の値以上なら段階2
  var QUIET_FROM = 200 / 3;  // 人口密度が県内の低い方から1/3に入れば「人目が少ない」（仮。公的な閾値はない）
  var MAP_LEVEL = [0, 1, 1, 2, 2, 3];          // 点数0〜5 → 色
  var DIAG_CUTS = [4, 7, 9];                   // 診断の点数（0〜11）: <4 低、<7 中、<9 やや高、それ以上 高（仮）
  function diagLevel(sc) { return sc < DIAG_CUTS[0] ? 0 : sc < DIAG_CUTS[1] ? 1 : sc < DIAG_CUTS[2] ? 2 : 3; }

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

  /* 地区ごとの実績: theft=[{area,n}]（県警の件数）、regions={地区:[市町村]}、munis=munis.json の rows。
     rate=設備1,000件あたりの件数（分母は隠していない市町村の設備数）、avg=県全体（5地区の合計）の同じ値、tier=段階（avg以上2、TIER_MID以上1、他0） */
  function districtStats(regions, theft, munis) {
    var by = {}; munis.forEach(function (m) { by[m.name] = m; });
    var rows = theft.map(function (t) {
      var plants = (regions[t.area] || []).reduce(function (a, nm) { var m = by[nm]; return a + (m && m.n != null ? m.n : 0); }, 0);
      return { area: t.area, theft: t.n, plants: plants, rate: plants ? t.n / plants * 1000 : null };
    });
    var tt = rows.reduce(function (a, r) { return a + r.theft; }, 0), tp = rows.reduce(function (a, r) { return a + r.plants; }, 0), avg = tp ? tt / tp * 1000 : null;
    rows.forEach(function (r) { r.tier = r.rate == null ? null : r.rate >= avg ? 2 : r.rate >= TIER_MID ? 1 : 0; });
    return { rows: rows, avg: avg };
  }
  /* 密度の配列 → 人目が少ない(true)か。県内の同じ単位の中で、低い方から1/3 */
  function quietFlags(dens) {
    return percentRank(dens.map(function (d) { return -d; })).map(function (p) { return p >= QUIET_FROM; });
  }
  function mapLevel(tier, quiet) { return MAP_LEVEL[W_REGION * tier + (quiet ? 1 : 0)]; }

  /* 集計メッシュ: cells.json の rows（[cx,cy,n,kw,small,pop,region]）→ 画面用。tiers は地区番号→段階。地区のないメッシュは level=null。連続値は持たない */
  function meshLevels(rows, tiers) {
    var base = rows.map(function (r) { return { cx: r[0], cy: r[1], n: r[2], kw: r[3], small: r[4], pop: r[5], region: r[6], dens: density(r[5]), share: r[2] ? r[4] / r[2] : 0 }; });
    var q = quietFlags(base.map(function (c) { return c.dens; }));
    base.forEach(function (c, i) { c.quiet = q[i]; c.level = c.region >= 0 && tiers[c.region] != null ? mapLevel(tiers[c.region], q[i]) : null; });
    return base;
  }
  /* 市町村: munis.json の rows と地区の対応。n が null（3件未満で秘匿）は level を付けない */
  function muniLevels(rows, regions, tiers, areaNames) {
    var reg = {}; areaNames.forEach(function (a, i) { (regions[a] || []).forEach(function (nm) { reg[nm] = i; }); });
    var out = rows.map(function (m) {
      var hide = m.n == null;
      return { name: m.name, n: m.n, kw: m.kw, small: m.small, pop: m.pop, area: m.area_km2, hidden: hide, region: reg[m.name] == null ? -1 : reg[m.name],
        dens: m.area_km2 ? m.pop / m.area_km2 : 0, share: !hide && m.n ? m.small / m.n : 0 };
    });
    var q = quietFlags(out.map(function (m) { return m.dens; }));
    out.forEach(function (m, i) { m.quiet = q[i]; m.level = m.hidden || m.region < 0 || tiers[m.region] == null ? null : mapLevel(tiers[m.region], q[i]); });
    return out;
  }
  /* 順位相関（スピアマン）。2点以下や定数列は null */
  function rankCorr(a, b) {
    var n = a.length; if (n < 3) return null;
    var ra = percentRank(a), rb = percentRank(b), ma = ra.reduce(function (x, y) { return x + y; }, 0) / n, mb = rb.reduce(function (x, y) { return x + y; }, 0) / n, c = 0, va = 0, vb = 0;
    for (var i = 0; i < n; i++) { c += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) * (ra[i] - ma); vb += (rb[i] - mb) * (rb[i] - mb); }
    return va && vb ? c / Math.sqrt(va * vb) : null;
  }
  /* 位置の地区: 診断の約5kmメッシュが公開メッシュならその地区。隠したメッシュなど公開メッシュでない時は、2メッシュ（約10km）以内でいちばん近い公開メッシュの地区で代用（near=true。推測） */
  function regionAt(rows, cx, cy) {
    var best = null;
    rows.forEach(function (r) {
      if (r[6] < 0) return;
      var d = Math.max(Math.abs(r[0] - cx), Math.abs(r[1] - cy));
      if (d > 2) return;
      var e = d * 100 + Math.hypot(r[0] - cx, r[1] - cy);
      if (!best || e < best.e) best = { e: e, idx: r[6], near: d > 0 };
    });
    return best ? { idx: best.idx, near: best.near } : null;
  }

  /* 診断の条件（risk.json の conds）の判定。state: risk（当てはまる）／ok／unknown。
     answers=この条件への直接の回答（yes＝当てはまる）、cl=対策チェックリストの回答（yes＝実施している）、autoQuiet=メッシュの人口密度から出した「人目が少ない」。
     by: answer（本人の回答）／derived（対策の回答から）／auto（公開データ）／none */
  function evalConds(conds, answers, cl, autoQuiet) {
    return conds.map(function (c) {
      var st = 'unknown', by = 'none', a = (answers || {})[c.id];
      if (c.derive) {
        var v = c.derive.items.map(function (id) { return (cl || {})[id] || 'unknown'; });
        var yes = v.filter(function (x) { return x === 'yes'; }).length, no = v.filter(function (x) { return x === 'no'; }).length;
        if (c.derive.risk === 'any_no' ? no > 0 : (yes === 0 && no > 0)) { st = 'risk'; by = 'derived'; }
        else if (c.derive.ok === 'all_yes' ? yes === v.length : yes > 0) { st = 'ok'; by = 'derived'; }
      } else if (a === 'yes') { st = 'risk'; by = 'answer'; }
      else if (a === 'no') { st = 'ok'; by = 'answer'; }
      else if (c.auto === 'quiet' && autoQuiet != null) { st = autoQuiet ? 'risk' : 'ok'; by = 'auto'; }
      return { id: c.id, state: st, by: by };
    });
  }

  /* 事業者の自己診断。
     input: { lon, lat, cls: 'low'|'high'|'special'|'unknown', answers: {id: 'yes'|'no'|'unknown'}（対策）, cond: {id: 'yes'|'no'|'unknown'}（条件） }
     ctx:   { cells, pops, items（対策）, conds（risk.json）, tiers（地区番号→段階）, regionNames }
     返す値は、地区の実績・周囲の人口（約5kmメッシュ）・条件の判定・リスクの色と、未実施・不明の対策。個別設備の情報は参照しない。 */
  function diagnose(input, ctx) {
    var m = toMesh(input.lon, input.lat);
    var cellRow = ctx.cells.filter(function (r) { return r[0] === m.cx && r[1] === m.cy; })[0] || null;
    var cellPopulation = cellPop(ctx.pops, m.cx, m.cy);   // 約5kmメッシュの人口だけを使う（入力点の1kmメッシュの人口は使わない）
    var allDens = ctx.cells.map(function (r) { return -density(r[5]); });
    var mine = -density(cellPopulation);
    var below = allDens.filter(function (x) { return x < mine; }).length, eq = allDens.filter(function (x) { return x === mine; }).length;
    var quiet = allDens.length ? (below + eq / 2) / allDens.length * 100 : null; // 0〜100（同値は平均順位。高いほど人口密度が低い）
    var autoQuiet = quiet == null ? null : quiet >= QUIET_FROM;
    var items = ctx.items.filter(function (it) { return input.cls === 'unknown' || it.cls.indexOf('all') >= 0 || it.cls.indexOf(input.cls) >= 0; });
    var done = 0, no = [], unk = [];
    items.forEach(function (it) {
      var a = (input.answers || {})[it.id] || 'unknown';
      if (a === 'yes') done++; else if (a === 'no') no.push(it); else unk.push(it);
    });
    var reg = regionAt(ctx.cells, m.cx, m.cy), tier = reg ? ctx.tiers[reg.idx] : null;
    var conds = evalConds(ctx.conds || [], input.cond, input.answers, autoQuiet);
    var nr = conds.filter(function (c) { return c.state === 'risk'; }).length, nu = conds.filter(function (c) { return c.state === 'unknown'; }).length;
    var base = (tier == null ? 0 : W_REGION * tier) + nr, max = base + nu + (tier == null ? W_REGION * 2 : 0);
    return {
      mesh: m, code: meshCode(m.cx * CELL, m.cy * CELL), cellDensity: density(cellPopulation), cellPopulation: cellPopulation,
      quietPos: quiet, autoQuiet: autoQuiet, cellVisible: !!cellRow,
      cell: cellRow ? { n: cellRow[2], kw: cellRow[3], small: cellRow[4] } : null,
      region: reg ? { idx: reg.idx, name: ctx.regionNames[reg.idx], near: reg.near, tier: tier } : null,
      conds: conds, riskCount: nr, unknownCount: nu, scoreMin: base, scoreMax: max, levelMin: diagLevel(base), levelMax: diagLevel(max),
      total: items.length, done: done, notDone: no, unknown: unk
    };
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

  /* CSV（UTF-8, BOM は書き出し側）。値のエスケープ */
  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvEscape).join(','); }).join('\r\n'); }

  var api = { CELL: CELL, KM2_PER_MESH: KM2_PER_MESH, LEVELS: LEVELS, W_REGION: W_REGION, TIER_MID: TIER_MID, QUIET_FROM: QUIET_FROM, MAP_LEVEL: MAP_LEVEL, DIAG_CUTS: DIAG_CUTS, diagLevel: diagLevel,
    parseCoord: parseCoord, landSet: landSet, toMesh: toMesh, cellBounds: cellBounds, meshCode: meshCode, popGrid: popGrid, popAt: popAt, localPop: localPop,
    cellPop: cellPop, density: density, percentRank: percentRank, districtStats: districtStats, quietFlags: quietFlags, mapLevel: mapLevel, meshLevels: meshLevels, muniLevels: muniLevels,
    rankCorr: rankCorr, regionAt: regionAt, evalConds: evalConds, diagnose: diagnose, csvEscape: csvEscape, toCsv: toCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sg = api;
})(typeof window !== 'undefined' ? window : globalThis);
