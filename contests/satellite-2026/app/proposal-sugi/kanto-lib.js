// 関東全域の区分ロジック（画面に依存しない）。ブラウザでは window.KantoLib、node では module.exports。
// 区分の根拠は README「関東全域の区分」。仮の基準（参謀長判断）は PROVISIONAL に集めてあり、画面と README に「仮」と明記する。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KantoLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const CELL_HA = 0.04; // 20m メッシュ1個 = 0.04 ha

  // 区分。何をするか・根拠は凡例にそのまま出す。
  const CLASSES = {
    1: { key: 'cut', name: '伐る・植え替える（重点）', todo: '26年生以上のスギ人工林を伐って、少花粉・無花粉スギなどで植え替える', basis: '推進方針（50km圏・重点区域）＋森林総研（26年生以上が雄花の発生源）' },
    2: { key: 'renew', name: '少花粉スギ等へ更新（伐採は次）', todo: '若い（26年生未満）または林齢不明の林。主伐の時期に少花粉・無花粉スギで更新する', basis: '推進方針（少花粉スギ等の定義）。26年生未満は発生源の主流の定義に入らないため伐採は後回し' },
    3: { key: 'broad', name: '広葉樹林化・針広混交林を検討', todo: '傾斜が急で林業を続けにくい林。スギで植え替えず、広葉樹の導入や針広混交林化を検討する', basis: '林野庁Q&A・資料（林業に適さない所は広葉樹導入）。傾斜のしきい値は仮' },
    4: { key: 'low', name: '対象外・低優先', todo: '50km圏の外で重点区域でもない、または小さな林。この地図では優先しない', basis: '推進方針（50km圏のまとまった人工林が目安）。まとまりのしきい値は仮' },
  };

  // 公的資料に数値が無く、参謀長が仮に置いた基準。画面・README で「仮」と明記する。
  const PROVISIONAL = {
    slopeMax: { value: 25, min: 15, max: 40, label: '条件不利地とみなす傾斜（度）', note: '公的資料に数値基準なし（情報部報告 2-7）。仮の基準（参謀長判断）' },
    minHa: { value: 5, min: 1, max: 15, label: 'まとまった林とみなす面積（ha／500mメッシュ）', note: '推進方針は「まとまった」とだけ書き数値なし。仮の基準（参謀長判断）' },
  };
  // 出典が割れている林齢のしきい値。主流は26年生以上（森林総研 2000・2009）。20・21・25年の説もある。
  const AGES = [26, 21];
  const DEFAULTS = { slopeMax: PROVISIONAL.slopeMax.value, minHa: PROVISIONAL.minHa.value, age: 26, radiusKm: 50, matureShare: 0.5, rankKm: 20, winterMin: 0.4, cutMinHa: 1 };
  // 区分1の中の順位（作成者の式。仮）。S_i = a_i × Σ_j Pop_j×K(d_ij)、K は半径 R km 以内なら1。R の初期値20km（仮）。
  const RANK_RADII = [10, 20, 30];
  const RANK_BANDS = [
    { k: 1, upto: 0.10, name: '上位10%', short: '最優先' },
    { k: 2, upto: 0.30, name: '上位10〜30%', short: '優先' },
    { k: 3, upto: 0.60, name: '上位30〜60%', short: '次点' },
    { k: 4, upto: 1.01, name: '残り（下位40%）', short: '後回し' },
  ];

  // 列指向データ D.cells の i 番目のメッシュを区分する。戻り値 1..4。
  function classify(D, i, p) {
    const c = D.cells;
    const ha = c.n[i] * CELL_HA;
    const inZone = D.munis[c.muni[i]][2] === 1;
    const inRange = c.dist[i] <= p.radiusKm;
    if (ha < p.minHa || !(inRange || inZone)) return 4;
    if (c.slope[i] >= p.slopeMax) return 3;
    const mature = (p.age === 21 ? c.n21[i] : c.n26[i]) * CELL_HA;
    return mature >= ha * p.matureShare ? 1 : 2;
  }

  function classifyAll(D, p) {
    const n = D.cells.n.length, out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = classify(D, i, p);
    return out;
  }

  // 区分ごと・都県ごと・市町村ごとの面積（ha）。cls は classifyAll の結果。
  function summarize(D, cls) {
    const c = D.cells, tot = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const cnt = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const byPref = D.meta.prefs.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, all: 0, mature26: 0, mature21: 0 }));
    const byMuni = D.munis.map(() => ({ 1: 0, 2: 0, 3: 0, 4: 0, all: 0 }));
    for (let i = 0; i < cls.length; i++) {
      const ha = c.n[i] * CELL_HA, k = cls[i], m = c.muni[i], pr = D.munis[m][1];
      tot[k] += ha; cnt[k]++;
      byPref[pr][k] += ha; byPref[pr].all += ha; byPref[pr].mature26 += c.n26[i] * CELL_HA; byPref[pr].mature21 += c.n21[i] * CELL_HA;
      byMuni[m][k] += ha; byMuni[m].all += ha;
    }
    return { tot, cnt, byPref, byMuni };
  }

  // 順位相関（スピアマン）。同順位は平均順位。n<3 は null。
  function ranks(a) {
    const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
    }
    return r;
  }
  function spearman(a, b) {
    if (a.length !== b.length || a.length < 3) return null;
    const ra = ranks(a), rb = ranks(b), n = a.length;
    const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
    return da && db ? num / Math.sqrt(da * db) : null;
  }

  // 地点（lon, lat）から半径 R km 以内の、条件に合うスギ人工林の面積（ha）。500mメッシュ中心点で数える（近似）。
  function haWithin(D, lon, lat, R, pick) {
    const c = D.cells, k = Math.cos((lat * Math.PI) / 180);
    let s = 0;
    for (let i = 0; i < c.n.length; i++) {
      const x = ((c.ix[i] + 0.5) / 160 - lon) * 111.32 * k, y = ((c.iy[i] + 0.5) / 240 - lat) * 111.32;
      if (x * x + y * y <= R * R) s += pick(i);
    }
    return s;
  }

  // 半径内人口 X_i（人）。POP（data/pop.js）があれば人口、無ければ代替 max(0, 1−dist/50)（画面に「人口は使っていない」と出す）。
  function exposure(D, POP, p) {
    const n = D.cells.n.length, out = new Float64Array(n);
    const col = POP && POP.x && POP.x[String(p.rankKm)];
    if (col && col.length === n) { for (let i = 0; i < n; i++) out[i] = col[i] * POP.meta.unit; return { x: out, pop: true }; }
    for (let i = 0; i < n; i++) out[i] = Math.max(0, 1 - D.cells.dist[i] / 50);
    return { x: out, pop: false };
  }
  // 区分1のメッシュの点数 S_i = a_i（林齢しきい値以上のスギ人工林 ha）× X_i。区分1以外は 0。a_i は林齢で重み付けしない。
  function scores(D, POP, p, cls) {
    const c = D.cells, n = c.n.length, S = new Float64Array(n), ex = exposure(D, POP, p);
    for (let i = 0; i < n; i++) if (cls[i] === 1) S[i] = (p.age === 21 ? c.n21[i] : c.n26[i]) * CELL_HA * ex.x[i];
    return { S, x: ex.x, pop: ex.pop };
  }
  // 区分1の面積（ha）で数えた百分位の帯。同点は同じ帯。戻り値 band: 区分1は 1..4（1=上位10%）、他は 0。
  function rankBands(D, cls, S) {
    const c = D.cells, n = cls.length, band = new Uint8Array(n), pct = new Float32Array(n);
    const idx = []; let tot = 0;
    for (let i = 0; i < n; i++) if (cls[i] === 1) { idx.push(i); tot += c.n[i] * CELL_HA; }
    idx.sort((a, b) => S[b] - S[a]);
    let cum = 0;
    for (let a = 0; a < idx.length;) {
      let b = a; while (b + 1 < idx.length && S[idx[b + 1]] === S[idx[a]]) b++;
      const f = tot ? cum / tot : 0, bd = RANK_BANDS.find((r) => f < r.upto).k;
      for (let k = a; k <= b; k++) { band[idx[k]] = bd; pct[idx[k]] = f; cum += c.n[idx[k]] * CELL_HA; }
      a = b + 1;
    }
    return { band, pct, tot };
  }
  // 帯ごとの区分1の面積（ha）。市町村ごと・都県ごと。
  function bandSummary(D, cls, band) {
    const c = D.cells, tot = [0, 0, 0, 0, 0];
    const byMuni = D.munis.map(() => [0, 0, 0, 0, 0]), byPref = D.meta.prefs.map(() => [0, 0, 0, 0, 0]);
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== 1) continue;
      const ha = c.n[i] * CELL_HA, m = c.muni[i], b = band[i];
      tot[b] += ha; byMuni[m][b] += ha; byPref[D.munis[m][1]][b] += ha;
    }
    return { tot, byMuni, byPref };
  }
  // 地点（lon, lat）の半径 R km 以内にある、区分1のメッシュの点数の合計。
  function siteScore(D, S, lon, lat, R) { return haWithin(D, lon, lat, R, (i) => S[i]); }

  // ---- 衛星（Sentinel-2 の冬の NDVI。data/sat.js）。樹種・林齢・雄花の量は判別できない。しきい値は仮 ----
  // 要確認: 冬の NDVI の500mメッシュ平均が winterMin 未満（常緑の林が今も残っているか疑わしい。伐採跡・森林簿とのずれ・広葉樹の混在・影などの可能性）。
  // 伐採・植え替えの候補: 古い冬に緑だった40m画素のうち NDVI が大きく下がった画素の面積（ha）。cutMinHa 以上のメッシュを「進んだ」とする。
  function satInfo(SAT, i, p) {
    if (!SAT) return null;
    const w = SAT.wNew[i], ok = w > -900, cutHa = SAT.nDrop[i] * SAT.meta.pixelHa;
    return { ndvi: ok ? w / 100 : null, check: ok && w / 100 < p.winterMin, cutHa, cut: cutHa >= p.cutMinHa, both: SAT.nBoth[i] * SAT.meta.pixelHa };
  }
  // 区分1の帯（band 1..4）ごと・市町村ごとの 要確認 の面積（ha, スギ人工林の面積）と 伐採候補の面積（ha）、衛星で見えたメッシュ数。
  function satSummary(D, SAT, p, cls, band) {
    const c = D.cells, z = () => ({ check: 0, cut: 0, cutCells: 0, seen: 0, all: 0 });
    const byBand = [0, 1, 2, 3, 4].map(z), byMuni = D.munis.map(z), tot = z();
    if (!SAT) return { byBand, byMuni, tot };
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== 1) continue;
      const si = satInfo(SAT, i, p), ha = c.n[i] * CELL_HA, m = c.muni[i];
      for (const o of [byBand[band[i]], byMuni[m], tot]) {
        o.all += ha;
        if (si.ndvi != null) o.seen += ha;
        if (si.check) o.check += ha;
        o.cut += si.cutHa; if (si.cut) o.cutCells++;
      }
    }
    return { byBand, byMuni, tot };
  }

  function cellLonLat(D, i) { return [(D.cells.ix[i] + 0.5) / 160, (D.cells.iy[i] + 0.5) / 240]; }

  return { satInfo, satSummary, RANK_RADII, RANK_BANDS, exposure, scores, rankBands, bandSummary, siteScore, CELL_HA, CLASSES, PROVISIONAL, AGES, DEFAULTS, classify, classifyAll, summarize, spearman, haWithin, cellLonLat };
});
