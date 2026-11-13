// lib.js の単体試験（node tests/lib_test.js）。実データ（web/data）でも整合を確かめる。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../web/lib.js');
const D = path.join(__dirname, '..', 'web', 'data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('メッシュ: 水戸付近の基準メッシュコード・往復', () => {
  const m = G.toMesh(140.4468, 36.3418);
  assert.equal(G.meshCode(m.ix, m.iy), '54404315');
  const b = G.cellBounds(m.cx, m.cy);
  assert.ok(b[0] <= 140.4468 && 140.4468 < b[2] && b[1] <= 36.3418 && 36.3418 < b[3]);
  assert.ok(Math.abs((b[2] - b[0]) - 5 / 80) < 1e-9 && Math.abs((b[3] - b[1]) - 5 / 120) < 1e-9);
});

t('percentRank: 範囲・同値・単調', () => {
  assert.deepEqual(G.percentRank([]), []);
  assert.deepEqual(G.percentRank([7]), [50]);
  assert.deepEqual(G.percentRank([1, 2, 3]), [0, 50, 100]);
  assert.deepEqual(G.percentRank([5, 5, 5]), [50, 50, 50]);
  const r = G.percentRank([3, 1, 4, 1, 5, 9, 2, 6]);
  r.forEach((x) => assert.ok(x >= 0 && x <= 100));
  assert.ok(r[0] < r[2] && r[1] < r[0]);
});

t('weightedScore: 重み0の指標は無視・全0はnull・負は0扱い', () => {
  const p = { quiet: 100, kw: 0, small: 50 };
  assert.equal(G.weightedScore(p, { quiet: 1, kw: 0, small: 0 }), 100);
  assert.equal(G.weightedScore(p, { quiet: 1, kw: 1, small: 0 }), 50);
  assert.equal(G.weightedScore(p, { quiet: 0, kw: 0, small: 0 }), null);
  assert.equal(G.weightedScore(p, { quiet: -3, kw: 1, small: 0 }), 0);
});

t('bands: 5段階・nullはnull・スコアが大きいほど帯は下がらない', () => {
  const sc = []; for (let i = 0; i < 100; i++) sc.push(i);
  sc.push(null);
  const b = G.bands(sc);
  assert.equal(b[100], null);
  for (let i = 1; i < 100; i++) assert.ok(b[i] >= b[i - 1]);
  assert.equal(new Set(b.slice(0, 100)).size, 5);
  assert.deepEqual(G.bands([null, null]), [null, null]);
});

t('csvEscape', () => {
  assert.equal(G.csvEscape('a,b'), '"a,b"');
  assert.equal(G.csvEscape('a"b'), '"a""b"');
  assert.equal(G.csvEscape(null), '');
  assert.equal(G.toCsv([['a', 1], ['b,c', 2]]), 'a,1\r\n"b,c",2');
});

const cells = J('cells.json'), pops = J('pops.json'), munis = J('munis.json'), ck = J('checklist.json');
const grid = G.popGrid(pops.rows);
const W = { quiet: 1, kw: 1, small: 1 };

t('実データ: 集計メッシュの件数・人口の整合', () => {
  assert.deepEqual(cells.cols, ['cx', 'cy', 'n', 'kw', 'small', 'pop']);
  assert.ok(cells.rows.length > 150);
  cells.rows.forEach((r) => {
    assert.ok(r[2] >= cells.meta.k_min, 'しきい値未満のメッシュが出力にある');
    assert.ok(r[4] <= r[2] && r[3] > 0);
    assert.equal(r[5], G.cellPop(grid, r[0], r[1]), 'メッシュ人口が人口グリッドの合計と一致しない');
  });
});

t('実データ: スコアは0〜100、重みを変えると位置が変わる、全0でnull', () => {
  const a = G.scoreCells(cells.rows, W);
  a.forEach((c) => { assert.ok(c.score >= 0 && c.score <= 100); });
  const q = G.scoreCells(cells.rows, { quiet: 1, kw: 0, small: 0 });
  q.forEach((c, i) => assert.equal(c.score, c.parts.quiet));
  // 人の少なさだけ: 人口密度が低いほどスコアが高い（単調）
  const s = q.slice().sort((x, y) => x.dens - y.dens);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].score <= s[i - 1].score + 1e-9);
  const z = G.scoreCells(cells.rows, { quiet: 0, kw: 0, small: 0 });
  z.forEach((c) => assert.equal(c.score, null));
});

t('実データ: 市町村の指標（隠した市町村にはスコアを付けない）', () => {
  const m = G.scoreMunis(munis.rows, W);
  assert.equal(m.length, 44);
  m.forEach((x) => { if (x.hidden) assert.equal(x.score, null); else assert.ok(x.score >= 0 && x.score <= 100); });
  const fake = G.scoreMunis([{ name: 'A', n: null, kw: null, small: null, pop: 100, area_km2: 1 }, { name: 'B', n: 5, kw: 100, small: 2, pop: 10, area_km2: 2 }], W);
  assert.equal(fake[0].score, null);
  assert.ok(fake[1].score != null);
});

t('診断: 位置→メッシュ→周囲の目安、未実施・不明の分類、区分による項目の違い', () => {
  const items = ck.items;
  const base = { lon: 140.4468, lat: 36.3418, cls: 'unknown', answers: {} };
  const ctx = { cells: cells.rows, pops: grid, items, weights: W };
  const r0 = G.diagnose(base, ctx);
  assert.equal(r0.code.length, 8);
  assert.equal(r0.total, items.length);
  assert.equal(r0.done, 0); assert.equal(r0.notDone.length, 0); assert.equal(r0.unknown.length, items.length);
  assert.ok(r0.quietPos >= 0 && r0.quietPos <= 100);
  assert.ok(r0.cellPopulation >= 0 && r0.localPop3km >= 0);
  const ans = {}; items.forEach((it, i) => { ans[it.id] = i % 3 === 0 ? 'yes' : i % 3 === 1 ? 'no' : 'unknown'; });
  const r1 = G.diagnose({ ...base, answers: ans }, ctx);
  assert.equal(r1.done + r1.notDone.length + r1.unknown.length, r1.total);
  const low = G.diagnose({ ...base, cls: 'low' }, ctx), high = G.diagnose({ ...base, cls: 'high' }, ctx), sp = G.diagnose({ ...base, cls: 'special' }, ctx);
  [low, high, sp].forEach((r) => assert.ok(r.total < items.length && r.total >= 13));
  assert.ok(low.unknown.some((i) => i.id === 'pole_barrier') && !high.unknown.some((i) => i.id === 'pole_barrier'));
  assert.ok(high.unknown.some((i) => i.id === 'pcs_conduit') && sp.unknown.some((i) => i.id === 'hotspot'));
});

t('診断: 人口の少ない地点ほど「人の少なさ」の位置が高い（単調）', () => {
  const ctx = { cells: cells.rows, pops: grid, items: ck.items, weights: W };
  // 常総・つくば付近（人口多）と 大子町北部（人口少）
  const urban = G.diagnose({ lon: 140.1, lat: 36.08, cls: 'low', answers: {} }, ctx);
  const rural = G.diagnose({ lon: 140.35, lat: 36.75, cls: 'low', answers: {} }, ctx);
  assert.ok(rural.cellDensity < urban.cellDensity);
  assert.ok(rural.quietPos > urban.quietPos);
});

console.log('lib_test OK', n);
