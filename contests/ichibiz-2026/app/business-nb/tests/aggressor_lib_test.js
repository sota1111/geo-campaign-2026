// アグレッサーの失敗テスト（ichibiz-2026 新案NB: 計算 lib.js と実データ）。2026-11-13
// usage: node tests/aggressor_lib_test.js [app_dir]（アグレッサー作成。app/business-nb/tests/ へ移設。変更は APP の既定値だけ）
// FAIL は「弱点が残っている」ことを示す。番号は reports/aggressor/ichibiz-2026-business-nb-20261113.md に対応。
'use strict';
const path = require('node:path');
const APP = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const Nb = require(path.join(APP, 'web', 'lib.js'));
const P = require(path.join(APP, 'web', 'data', 'plants.json'));
const F = require(path.join(APP, 'web', 'data', 'facilities.json'));

const results = [];
function check(id, title, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) results.push([id, 'PASS', title, '']);
    else results.push([id, 'FAIL', title, String(r)]);
  } catch (e) {
    results.push([id, 'FAIL', title, 'throw: ' + (e && e.message)]);
  }
}
const row = (kw, start, fit, lat, lon, prec, muni) => [lat, lon, kw, start, fit, 201500, prec || 0, muni || 0];
const L25 = { type: 'life', years: 25 };

// --- 空データ・欠損・極端な値 ---
check('T1', '設備0件でも analyze が落ちない', () => {
  const r = Nb.analyze([], [], F, { basis: L25, cutoff: 2045, radiusKm: 20 });
  return (r.total.plants === 0 && r.yearly.length === 0) || 'unexpected ' + JSON.stringify(r.total);
});

check('T2', '施設リストが空（施設を公表していない県へ広げた場合）でも analyze が落ちない', () => {
  const rows = [row(100, 201505, 203505, 35, 135.5)];
  const r = Nb.analyze(rows, ['甲'], [], { basis: L25, cutoff: 2045, radiusKm: 20 });
  return r.total.plants === 1 || 'total ' + JSON.stringify(r.total);
});

check('T3', '対象年までに出る設備が0件なら、候補拠点を返さない（意味のない地点を置かない）', () => {
  // 実データ・運転開始＋35年・2035年まで → 対象0件
  const s = Nb.suggestSite(P.rows, F, { basis: { type: 'life', years: 35 }, cutoff: 2035, radiusKm: 20 });
  return s === null || '対象0件なのに候補を返す ' + JSON.stringify(s);
});

check('T4', '壊れた年月（start_ym=190001）が混じっても年別の配列が膨張しない（100年分以下）', () => {
  const rows = [row(100, 201505, 203505, 35, 135.5), row(100, 190001, 0, 35, 135.5)];
  const r = Nb.analyze(rows, ['甲'], F, { basis: L25, cutoff: 2045, radiusKm: 20 });
  return r.yearly.length <= 100 || 'yearly length ' + r.yearly.length;
});

check('T5', 'kW が欠損（null/NaN）した行が合計を NaN にしない', () => {
  const rows = [row(100, 201505, 203505, 35, 135.5), row(null, 201505, 203505, 35, 135.5), row(NaN, 201505, 203505, 35, 135.5)];
  const r = Nb.analyze(rows, ['甲'], F, { basis: L25, cutoff: 2045, radiusKm: 20 });
  return Number.isFinite(r.total.kw) || 'total.kw ' + r.total.kw;
});

check('T6', '座標が欠損（null）した行が「圏外」に数えられない', () => {
  const rows = [row(100, 201505, 203505, null, null)];
  const r = Nb.analyze(rows, ['甲'], F, { basis: L25, cutoff: 2045, radiusKm: 20 });
  return r.total.outPlants === 0 || 'outPlants ' + r.total.outPlants + ' km=' + r.items[0].km;
});

// --- 実データの弱点（審査で突かれる点） ---
check('T7', '画面で選べる「仮説×対象年」の組で、対象0件になる組がない', () => {
  const zero = [];
  for (const b of [{ type: 'fit' }, L25, { type: 'life', years: 30 }, { type: 'life', years: 35 }]) {
    for (const y of [2035, 2040, 2045, 2050, 2060]) {
      const r = Nb.analyze(P.rows, P.munis, F, { basis: b, cutoff: y, radiusKm: 20 });
      if (r.total.plants === 0) zero.push((b.years ? '+' + b.years : 'fit') + '/' + y);
    }
  }
  return zero.length === 0 || '0件の組 ' + zero.length + '/20: ' + zero.join(' ') + '（運転開始の最古年 ' + Math.min(...P.rows.map((r) => Math.floor(r[3] / 100))) + '）';
});

check('T8', '市区町村の代表点（粗い位置）は全体の15%未満', () => {
  const m = P.rows.filter((r) => r[6] === 1).length;
  const kwAll = P.rows.reduce((a, r) => a + r[2], 0), kwM = P.rows.filter((r) => r[6] === 1).reduce((a, r) => a + r[2], 0);
  return m / P.rows.length < 0.15 || '市区町村代表点 ' + m + '件 ' + (m / P.rows.length * 100).toFixed(1) + '%（出力では ' + (kwM / kwAll * 100).toFixed(1) + '%）';
});

check('T9', '郡部の町村（京丹波町・与謝野町など）で町字の位置が1件以上取れている', () => {
  const gun = ['京丹波町', '与謝野町', '宇治田原町', '南山城村', '精華町', '久御山町', '和束町', '井手町', '笠置町', '大山崎町'];
  let n = 0;
  const bad = gun.filter((g) => {
    const k = P.munis.indexOf(g);
    if (k < 0) return false;
    const rs = P.rows.filter((r) => r[7] === k);
    if (rs.length > 0 && rs.every((r) => r[6] === 1)) { n += rs.length; return true; }
    return false;
  });
  return bad.length === 0 || '町字が0件の郡部町村 ' + bad.length + '（' + bad.join('・') + '）計 ' + n + '件';
});

check('T10', '1つの点に重なる設備は100件未満（地図で1点に潰れない）', () => {
  const c = {};
  P.rows.forEach((r) => { const k = r[0] + ',' + r[1]; c[k] = (c[k] || 0) + 1; });
  const mx = Math.max(...Object.values(c));
  return mx < 100 || '最大 ' + mx + '件が1点に重なる';
});

check('T11', '施設どうしが10km以上離れている（3施設が実質1か所でない）', () => {
  let mx = 0;
  for (let i = 0; i < F.length; i++) for (let j = i + 1; j < F.length; j++) mx = Math.max(mx, Nb.distKm(F[i].lat, F[i].lon, F[j].lat, F[j].lon));
  return mx >= 10 || '3施設の最大の離れ ' + mx.toFixed(1) + ' km（八幡市・伏見区に集中）';
});

check('T12', '候補探索の結果の30km圏で、対象出力に占める市区町村代表点が30%未満', () => {
  const o = { basis: L25, cutoff: 2045, radiusKm: 20 };
  const s = Nb.suggestSite(P.rows, F, o);
  let all = 0, coarse = 0;
  P.rows.forEach((r) => {
    const y = Nb.disposalYear(r, o.basis);
    if (y === null || y > o.cutoff) return;
    if (Nb.distKm(s.lat, s.lon, r[0], r[1]) <= 30) { all += r[2]; if (r[6] === 1) coarse += r[2]; }
  });
  return coarse / all < 0.3 || '候補 ' + s.lat + ',' + s.lon + ' の30km圏で市区町村代表点の出力比 ' + (coarse / all * 100).toFixed(1) + '%';
});

check('T13', '調達期間終了年−運転開始報告年 が20年でない行が10%未満（報告年月を運転開始とみなす前提の確認）', () => {
  let off = 0;
  P.rows.forEach((r) => { if (r[4] && Math.floor(r[4] / 100) - Math.floor(r[3] / 100) !== 20) off++; });
  return off / P.rows.length < 0.1 || '≠20年: ' + off + '件 ' + (off / P.rows.length * 100).toFixed(1) + '%';
});

let fail = 0;
for (const [id, st, title, msg] of results) {
  if (st === 'FAIL') fail++;
  console.log(st.padEnd(4), id.padEnd(4), title + (msg ? '\n          -> ' + msg : ''));
}
console.log(`aggressor_lib_test: ${results.length - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
