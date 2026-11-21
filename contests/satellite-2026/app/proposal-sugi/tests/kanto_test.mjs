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
