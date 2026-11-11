// node tests/lib_test.js : web/lib.js の純粋関数の試験。実データ（コピーした data/）と odpt 側の lib.js（読むだけ）で突き合わせる。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = require('../web/lib.js');
const Odpt = require('../../../../odpt-2026/app/web/lib.js');
const DATA = path.join(__dirname, '..', 'web', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf-8'));

// 合成データ: 路線10はセル0,1,3、路線11はセル1,2に影響。水準は 公共交通(施設0・平日朝)=先頭の桁
const mk = (code, pop, p65, lv, walk) => [code, pop, p65, lv, walk, 0];
const Z = '000000000000';
const cells = [mk('523776262', 100, 40, '400000000000', '0'), mk('523776283', 50, 20, '400000000000', '0'),
  mk('523776284', 30, 10, '400000000000', '0'), mk('523776372', 70, 30, '400000000000', '4')];
const W = { routes: { 10: [[0, Z], [1, Z], [3, Z]], 11: [[1, Z], [2, Z]] } };
const need = 4;

// 単独路線
let r = B.planLoss(cells, W, [10], 0, 'wd', 'm', need);
assert.equal(r.lost, 150); assert.equal(r.lost65, 60); assert.equal(r.exact, true);   // セル3は徒歩で着くので影響なし
// 複数路線: セル1の重複は1回だけ（単純和 150+80=230 にならない）
r = B.planLoss(cells, W, [10, 11], 0, 'wd', 'm', need);
assert.equal(r.lost, 180); assert.equal(r.lost65, 70); assert.equal(r.exact, false);
assert.deepEqual(r.cells.slice().sort(), [0, 1, 2]);
assert.ok(r.lost >= B.planLoss(cells, W, [10], 0, 'wd', 'm', need).lost);
assert.ok(r.lost >= B.planLoss(cells, W, [11], 0, 'wd', 'm', need).lost);
// 路線なし・事前計算にない路線は0
assert.equal(B.planLoss(cells, W, [], 0, 'wd', 'm', need).lost, 0);
assert.equal(B.planLoss(cells, W, [99], 0, 'wd', 'm', need).lost, 0);
// 元から行けないセルは「行けなくなる」に数えない
const c2 = [mk('523776262', 100, 40, '000000000000', '0')];
assert.equal(B.planLoss(c2, { routes: { 1: [[0, Z]] } }, [1], 0, 'wd', 'm', need).lost, 0);
// 別の条件（休日）では数えない
assert.equal(B.planLoss(cells, W, [10], 0, 'hol', 'm', need).lost, 0);

// 基準値
const b = B.baseline(cells, 0, 'wd', 'm', need);
assert.equal(b.pop, 250); assert.equal(b.reach, 250);

// CSV
assert.equal(B.csvCell('a,b'), '"a,b"');
assert.equal(B.csvCell('say "hi"'), '"say ""hi"""');
assert.equal(B.csvCell('=1+1'), "'=1+1");
assert.equal(B.csvCell(-5), '-5');
assert.equal(B.toCsv([['x', 1], ['y,z', 2]]), 'x,1\r\n"y,z",2\r\n');

// 地区のまとめ: 人数の合計が保存される
const nodes = [[137.80, 35.50, '甲'], [137.90, 35.40, '乙']];
const gs = B.groupByNearestStop(cells, [0, 1, 2], nodes);
assert.equal(gs.reduce((a, g) => a + g.lost, 0), 180);
assert.equal(gs.reduce((a, g) => a + g.meshes, 0), 3);

// 実データ: 単独停止は odpt の lostPopulation と一致し、複数の和集合は単独の最大以上・単純和以下
const idx = load('index.json');
let checks = 0;
for (const reg of idx.regions) {
  const d = load(reg.id + '.json'), w = load('whatif_' + reg.id + '.json');
  const th = d.params.thresholds;
  const keys = Object.keys(w.routes);
  assert.ok(keys.length > 0, reg.id);
  for (const fi of [0, 1]) for (const day of B.DAYS) for (const per of B.PERIODS) for (const t of th) {
    const nd = B.needLevel(th, t);
    const singles = keys.map((k) => {
      const mine = B.planLoss(d.cells, w, [+k], fi, day, per, nd);
      const ref = Odpt.lostPopulation(d.cells, w.routes[k], fi, day, per, nd);
      assert.equal(mine.lost, ref.lost); assert.equal(mine.lost65, ref.lost65);
      assert.deepEqual(mine.cells.slice().sort((a, c) => a - c), Object.keys(ref.idx).map(Number).sort((a, c) => a - c));
      checks++;
      return mine;
    });
    if (keys.length >= 2) {
      const u = B.planLoss(d.cells, w, keys.slice(0, 2).map(Number), fi, day, per, nd);
      const mx = Math.max(singles[0].lost, singles[1].lost);
      assert.ok(u.lost >= mx && u.lost <= singles[0].lost + singles[1].lost, reg.id);
    }
  }
}
assert.ok(checks > 100);
console.log('lib_test OK', checks, 'checks vs odpt');
