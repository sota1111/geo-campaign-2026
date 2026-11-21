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
  const DEFAULTS = { slopeMax: PROVISIONAL.slopeMax.value, minHa: PROVISIONAL.minHa.value, age: 26, radiusKm: 50, matureShare: 0.5 };

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

  function cellLonLat(D, i) { return [(D.cells.ix[i] + 0.5) / 160, (D.cells.iy[i] + 0.5) / 240]; }

  return { CELL_HA, CLASSES, PROVISIONAL, AGES, DEFAULTS, classify, classifyAll, summarize, spearman, haWithin, cellLonLat };
});
