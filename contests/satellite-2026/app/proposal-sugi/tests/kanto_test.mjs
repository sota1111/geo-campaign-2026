import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = createRequire(import.meta.url)(path.join(root, 'kanto-lib.js'));
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'data/kanto.js'), 'utf8'), ctx);
const D = ctx.window.SUGI_KANTO;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// 1セルだけのデータで区分の判定条件を確かめる
function one(o) {
  return { munis: [['A市', 0, o.zone ? 1 : 0, 0, 0]], meta: { prefs: ['X'] },
    cells: { n: [o.ha * 25], n26: [o.m26 * 25], n21: [o.m21 == null ? o.m26 * 25 : o.m21 * 25], slope: [o.slope], dist: [o.dist], muni: [0] } };
}
const P = Object.assign({}, K.DEFAULTS);
test('区分の判定条件', () => {
  const c = (o, p) => K.classify(one(o), 0, p || P);
  assert.equal(c({ ha: 10, m26: 10, slope: 10, dist: 30 }), 1);       // 圏内・26年以上・適地
  assert.equal(c({ ha: 10, m26: 2, slope: 10, dist: 30 }), 2);        // 若い
  assert.equal(c({ ha: 10, m26: 10, slope: 30, dist: 30 }), 3);       // 急傾斜
  assert.equal(c({ ha: 10, m26: 10, slope: 10, dist: 80 }), 4);       // 圏外
  assert.equal(c({ ha: 10, m26: 10, slope: 10, dist: 80, zone: true }), 1); // 圏外でも重点区域の市町村
  assert.equal(c({ ha: 3, m26: 3, slope: 10, dist: 10 }), 4);         // 小さい林
  assert.equal(c({ ha: 10, m26: 2, m21: 8, slope: 10, dist: 30 }, Object.assign({}, P, { age: 21 })), 1); // 21年に切替
});
test('データの整合', () => {
  const c = D.cells, n = c.n.length;
  assert.ok(n > 40000);
  for (const k of ['iy', 'ix', 'n26', 'n21', 'nunk', 'slope', 'dist', 'org', 'muni']) assert.equal(c[k].length, n);
  for (let i = 0; i < n; i++) {
    assert.ok(c.n[i] * 0.04 >= D.meta.minHa);
    assert.ok(c.n26[i] <= c.n21[i] && c.n21[i] <= c.n[i]);
    assert.ok(c.muni[i] < D.munis.length && c.org[i] < D.origins.length);
  }
  assert.equal(D.meta.src.dup20, 0);
  assert.equal(D.meta.prefs.length, 7);
  assert.ok(Object.keys(D.zone.areasHa).length === 7);
});
test('区分の面積の合計は全スギ人工林に等しい。傾斜を下げると区分3が増える', () => {
  const s = K.summarize(D, K.classifyAll(D, P));
  let all = 0; for (let i = 0; i < D.cells.n.length; i++) all += D.cells.n[i] * 0.04;
  assert.ok(Math.abs(s.tot[1] + s.tot[2] + s.tot[3] + s.tot[4] - all) < 1);
  const s2 = K.summarize(D, K.classifyAll(D, Object.assign({}, P, { slopeMax: 18 })));
  assert.ok(s2.tot[3] > s.tot[3]);
});
test('スピアマン', () => {
  assert.equal(K.spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(K.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
  assert.equal(K.spearman([1, 2], [1, 2]), null);
});
test('画面の表示規約: 実データ・仮の明示、外部送信なし、効果の数値なし', () => {
  const html = read('index.html'), app = read('kanto.js');
  assert.ok(html.includes('実データ') && html.includes('仮の基準'));
  assert.ok(!/<script[^>]+src="https?:/.test(html));
  assert.ok(!/XMLHttpRequest|sendBeacon|method:\s*'POST'/.test(app));
  assert.ok(!/#0f0|#00ff00/.test(read('kanto.css')));
  assert.ok(!/%減る|％減る/.test(html.replace('「花粉が○%減る」とは言えません', '')));
});

// ---- 区分1の中の順位（人に届きやすい発生源の順位。作成者の式） ----
const ctx2 = { window: {} }; vm.createContext(ctx2);
vm.runInContext(read('data/pop.js'), ctx2); vm.runInContext(read('data/verify9.js'), ctx2);
const POP = ctx2.window.SUGI_POP, V9 = ctx2.window.SUGI_VERIFY9;
test('人口データは kanto.js のメッシュと同じ並び・件数で、半径が広いほど人口が増える', () => {
  const n = D.cells.n.length;
  assert.equal(POP.meta.n, n);
  for (const R of ['10', '20', '30']) assert.equal(POP.x[R].length, n);
  for (let i = 0; i < n; i += 97) assert.ok(POP.x['10'][i] <= POP.x['20'][i] + 1 && POP.x['20'][i] <= POP.x['30'][i] + 1);
  assert.ok(POP.meta.popTotal > 4e7 && POP.meta.popTotal < 6e7);
  assert.equal(POP.meta.unit, 100);
});
test('点数 S = 26年生以上の面積 × 半径内の人口。区分1以外は0。帯は面積の10/30/60%で分かれる', () => {
  const cls = K.classifyAll(D, P), p = Object.assign({}, P, { rankKm: 20 });
  const sc = K.scores(D, POP, p, cls), rb = K.rankBands(D, cls, sc.S), bs = K.bandSummary(D, cls, rb.band);
  assert.equal(sc.pop, true);
  let tot1 = 0;
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== 1) { assert.equal(sc.S[i], 0); assert.equal(rb.band[i], 0); continue; }
    tot1 += D.cells.n[i] * 0.04;
    assert.ok(Math.abs(sc.S[i] - D.cells.n26[i] * 0.04 * POP.x['20'][i] * 100) < 1e-6);
    assert.ok(rb.band[i] >= 1 && rb.band[i] <= 4);
  }
  assert.ok(Math.abs(bs.tot[1] + bs.tot[2] + bs.tot[3] + bs.tot[4] - tot1) < 1e-6);
  assert.ok(bs.tot[0] === 0);
  assert.ok(Math.abs(bs.tot[1] / tot1 - 0.10) < 0.01 && Math.abs((bs.tot[1] + bs.tot[2]) / tot1 - 0.30) < 0.01 && Math.abs((bs.tot[1] + bs.tot[2] + bs.tot[3]) / tot1 - 0.60) < 0.01);
  const lo = [0, Infinity, Infinity, Infinity, Infinity], hi = [0, 0, 0, 0, 0];
  for (let i = 0; i < cls.length; i++) if (cls[i] === 1) { const b = rb.band[i]; lo[b] = Math.min(lo[b], sc.S[i]); hi[b] = Math.max(hi[b], sc.S[i]); }
  for (let b = 1; b < 4; b++) assert.ok(lo[b] >= hi[b + 1]);
});
test('人口が無いときの代替は max(0, 1-距離/50) で、画面に出す印（pop=false）が付く', () => {
  const cls = K.classifyAll(D, P), sc = K.scores(D, null, Object.assign({}, P, { rankKm: 20 }), cls);
  assert.equal(sc.pop, false);
  for (let i = 0; i < cls.length; i += 53) assert.ok(Math.abs(sc.x[i] - Math.max(0, 1 - D.cells.dist[i] / 50)) < 1e-9);
});
test('林齢では順位を分けない: 点数は26年生以上の面積に比例し、林齢の重みの項がない。R は10/20/30で初期値20', () => {
  assert.equal(K.RANK_RADII.join(','), '10,20,30');
  assert.equal(K.DEFAULTS.rankKm, 20);
  const D1 = { cells: { n: [100], n26: [50], n21: [80], dist: [10] }, munis: [['x', 0, 0, 0, 0]], meta: { prefs: ['x'] } };
  const pop = { meta: { unit: 100 }, x: { 20: [7] } };
  const a = K.scores(D1, pop, Object.assign({}, P, { rankKm: 20 }), [1]).S[0], b = K.scores(D1, pop, Object.assign({}, P, { rankKm: 20, age: 21 }), [1]).S[0];
  assert.equal(a, 50 * 0.04 * 700); assert.equal(b, 80 * 0.04 * 700);
});
test('東京都12地点9年分の原表の読み取り: 12地点×9年、青梅の9年平均、回帰係数', () => {
  assert.equal(V9.sites.length, 12); assert.equal(V9.years.join(','), '2009,2010,2011,2012,2013,2014,2015,2016,2017');
  for (const s of V9.sites) assert.equal(s.byYear.length, 9);
  const o = V9.sites.find((s) => s.name === '青梅');
  assert.equal(o.byYear[0], 11246); assert.equal(o.byYear[2], 31733); assert.equal(o.coef, 2.9141);
  assert.ok(Math.abs(o.mean9 - 11149.2) < 0.1);
});
test('画面の表示規約（順位）: 「効果」「花粉量」と書かない。仮・出典・限界を出す', () => {
  const t = read('index.html') + read('kanto.js');
  assert.ok(!/効果|花粉量/.test(t));
  assert.ok(t.includes('人に届きやすい発生源の順位') && t.includes('作成者の式') && t.includes('選び直していません'));
  assert.ok(t.includes('林齢では順位を付けていない'));
});

// ---- 衛星（Sentinel-2 の冬の NDVI） ----
test('衛星: 要確認・伐採候補の判定（仮のしきい値）と、衛星は樹種・林齢・雄花を判別しないと明記', () => {
  const SAT = { meta: { pixelHa: 0.16 }, wNew: [30, 60, -999], nDrop: [10, 3, 0], nBoth: [50, 50, 0] };
  const p = Object.assign({}, P, { winterMin: 0.4, cutMinHa: 1 });
  const a = K.satInfo(SAT, 0, p), b = K.satInfo(SAT, 1, p), c = K.satInfo(SAT, 2, p);
  assert.equal(a.check, true); assert.equal(a.cut, true); assert.ok(Math.abs(a.cutHa - 1.6) < 1e-9);
  assert.equal(b.check, false); assert.equal(b.cut, false);
  assert.equal(c.ndvi, null); assert.equal(c.check, false);
  assert.equal(K.satInfo(null, 0, p), null);
  const t = read('kanto.js');
  assert.ok(t.includes('樹種・林齢・雄花の量を判別できません') && t.includes('Copernicus') && t.includes('2019〜2024年'));
});
test('衛星データは kanto.js のメッシュと同じ件数で、場面（ID・日付）を持つ', () => {
  const c2 = { window: {} }; vm.createContext(c2); vm.runInContext(read('data/sat.js'), c2);
  const S = c2.window.SUGI_SAT, n = D.cells.n.length;
  for (const k of ['wNew', 'wOld', 'nValid', 'nBoth', 'nDrop']) assert.equal(S[k].length, n);
  const sc = Object.values(S.meta.scenes);
  assert.ok(sc.length >= 10);
  for (const id of ['54SUG', '54SVG', '54STF', '54SUF', '54SVF']) assert.ok(S.meta.scenes['MGRS-' + id], id);
  for (const v of sc) { assert.match(v.new.id, /^S2[AB]_54S/); assert.match(v.new.date, /^2026-/); assert.match(v.old.date, /^2022-/); }
});
test('衛星で見えた区分1の面積の割合は、どの都県も95%以上（北側のタイルの取りこぼしを防ぐ）', () => {
  const c2 = { window: {} }; vm.createContext(c2); vm.runInContext(read('data/sat.js'), c2);
  const S = c2.window.SUGI_SAT, cls = K.classifyAll(D, K.DEFAULTS);
  const cov = D.meta.prefs.map(() => [0, 0]);
  for (let i = 0; i < cls.length; i++) if (cls[i] === 1) { const q = cov[D.munis[D.cells.muni[i]][1]]; q[0] += D.cells.n[i]; if (S.wNew[i] > -900) q[1] += D.cells.n[i]; }
  cov.forEach((q, i) => assert.ok(q[1] / q[0] >= 0.95, D.meta.prefs[i] + ' ' + (q[1] / q[0])));
});
