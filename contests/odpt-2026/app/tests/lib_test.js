// web/lib.js の試験。python3 -m unittest（test_lib_js.py）から呼ばれる。node 単体でも実行可: node tests/lib_test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require(path.join(__dirname, '..', 'web', 'lib.js'));

// メッシュ: 東京駅付近 53394611 の 500m 象限
const b = L.meshBounds('533946111');
assert.ok(Math.abs(b[2] - b[0] - 1 / 160) < 1e-12 && Math.abs(b[3] - b[1] - 1 / 240) < 1e-12);
// 点 -> コード -> 範囲に含まれる
for (const [lon, lat] of [[139.7671, 35.6812], [130.7417, 32.8032], [137.2113, 36.6953], [137.8, 35.5]]) {
  const code = L.meshCodeAt(lon, lat);
  const bb = L.meshBounds(code);
  assert.equal(code.length, 9);
  assert.ok(bb[0] <= lon && lon <= bb[2] && bb[1] <= lat && lat <= bb[3], code);
}

// 水準としきい値
const th = [20, 30, 45, 60];
assert.equal(L.needLevel(th, 20), 4);
assert.equal(L.needLevel(th, 60), 1);
assert.throws(() => L.needLevel(th, 50));

// 状態: 診断文字列 = 施設(2) × 日(wd,hol) × 時間帯(m,d,e)
const cell = ['533946111', 100, 30, '210000' + '004321', 0b01];
assert.equal(L.condIndex(1, 'hol', 'e'), 11);
assert.equal(L.cellStatus(cell, 0, 'wd', 'm', 2), 'walk');          // 病院は徒歩圏ビット
assert.equal(L.cellStatus(cell, 1, 'wd', 'm', 1), 'none'); // 学校 wd 朝は水準0
assert.equal(L.cellStatus(cell, 1, 'hol', 'e', 1), 'transit');       // 末尾 '1'
assert.equal(L.cellStatus(cell, 1, 'hol', 'e', 2), 'none');          // 水準1 < 必要2

// 集計
const cells = [
  ['a', 100, 40, '4' + '00000' + '00000' + '0', 0],
  ['b', 50, 10, '0'.repeat(12), 0],
  ['c', 10, 5, '0'.repeat(12), 1],
];
const s = L.summarize(cells, 0, 'wd', 'm', 1);
assert.deepEqual([s.pop, s.walk, s.transit, s.none], [160, 10, 100, 50]);
assert.deepEqual([s.pop65, s.walk65, s.transit65, s.none65], [55, 5, 40, 10]);
assert.equal(L.pct(1, 3), 33.3);
assert.equal(L.pct(1, 0), 0);

// 表示
assert.equal(L.fmtMin(8 * 60 + 5), '8:05');
assert.equal(L.fmtMin(25 * 60 + 10), '翌1:10');
assert.equal(L.fmtMin(-1), '—');
assert.equal(L.levelLabel(0, th), '×');
assert.equal(L.levelLabel(4, th), '20分以内');
assert.equal(L.levelLabel(1, th), '60分以内');

// 近傍
const nodes = [[135, 35, 'A', [], [], []], [135.0045, 35, 'B', [], [], []], [135.02, 35, 'C', [], [], []]];
const near = L.nearbyNodes(nodes, 135, 35, 600, 5);
assert.deepEqual(near.map((o) => o.i), [0, 1]);
assert.ok(near[1].d > 400 && near[1].d < 450);

// 自動コメントは事実のみ
const node = [135, 35, 'A', [1, 2, 3, 20, 400, 1140], [0, 1, 0, 5, 600, 1000], []];
assert.deepEqual(L.nodeFacts(node), ['平日は1日20本、終発は19:00', '休日は1日5本（平日の25%）、終発は16:40']);
assert.deepEqual(L.nodeFacts([135, 35, 'Z', [0, 0, 0, 0, -1, -1], [0, 0, 0, 0, -1, -1], []]), ['この停留所群から発車する便は基準日にありません']);

console.log('lib_test OK');
