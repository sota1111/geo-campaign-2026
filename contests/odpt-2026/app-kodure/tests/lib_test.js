/* web/lib.js の純粋関数の試験（node tests/lib_test.js）。Python の kodure.build と同じ符号化を読めること、集計・一覧の論理を確認する */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const L = require('../web/lib.js');

// --- RLE（Python 側 kodure.build.rle_row と同じ約束）
assert.deepStrictEqual(Array.from(L.rleDecode('3B1A', 6)), [0, 0, 0, 2, 0, 1]);
assert.deepStrictEqual(Array.from(L.rleDecode('', 4)), [0, 0, 0, 0]);
assert.deepStrictEqual(Array.from(L.rleDecode('AR', 2)), [1, 18]);
assert.deepStrictEqual(Array.from(L.rleDecode('12A', 14)), [0,0,0,0,0,0,0,0,0,0,0,0,1,0]);

// --- 実データの整合: ファイルの行を復号して Python と同じ長さになる
const dataDir = path.join(__dirname, '..', 'web', 'data');
const meta = JSON.parse(fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf8'));
const nCell = meta.cells.length;
const rows = JSON.parse(fs.readFileSync(path.join(dataDir, L.fileName('o', 9, 500, 3)), 'utf8'));
assert.strictEqual(rows.length, meta.dests.length);
rows.forEach((s) => assert.strictEqual(L.rleDecode(s, nCell).length, nCell));
assert.ok(rows.some((s) => s.length > 0));

// --- メッシュ
const b = L.meshBounds(meta.cells[0][0]);
assert.ok(b[0] >= meta.region.bbox[0] - 0.01 && b[2] <= meta.region.bbox[2] + 0.01);
meta.cells.slice(0, 50).forEach((c) => {
  const bb = L.meshBounds(c[0]);
  assert.strictEqual(L.meshCodeAt((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2), c[0]);
});

// --- 行き帰りの判定（2地区 × 2行き先の手作り行列）
const mk = (o1, o2, o3, r1, r2, r3) => ({ o: [o1, o2, o3], r: [r1, r2, r3] });
// 行列[dest][cell]。dest0: 地区0=行き6(30分)・帰り6、地区1=行きのみ。dest1: 地区0=層1では着けず層2で着く
const Z = () => [new Uint8Array([0, 0]), new Uint8Array([0, 0])];
const o1 = Z(), o2 = Z(), o3 = Z(), r1 = Z(), r2 = Z(), r3 = Z();
o1[0][0] = 6; o2[0][0] = 6; o3[0][0] = 6; r1[0][0] = 6; r2[0][0] = 6; r3[0][0] = 6;
o1[0][1] = 5; o2[0][1] = 5; o3[0][1] = 5;                       // 地区1: 行きだけ
o2[1][0] = 9; o3[1][0] = 8; r2[1][0] = 9; r3[1][0] = 9;        // 行き先1: 乗換1回で着く（45分/40分）
const mats = mk(o1, o2, o3, r1, r2, r3);
assert.strictEqual(L.pairStatus(mats, 3, 0, 0, 30), 'both');
assert.strictEqual(L.pairStatus(mats, 3, 0, 0, 25), 'none');           // 30分は25分の許容に収まらない
assert.strictEqual(L.pairStatus(mats, 3, 0, 1, 60), 'one');
assert.strictEqual(L.pairStatus(mats, 1, 1, 0, 90), 'none');           // 乗換なしの層では着けない
assert.strictEqual(L.pairStatus(mats, 2, 1, 0, 45), 'both');
assert.strictEqual(L.minTransfers(mats, 'o', 0, 0, 30), 0);
assert.strictEqual(L.minTransfers(mats, 'o', 1, 0, 45), 1);
assert.strictEqual(L.minTransfers(mats, 'o', 1, 0, 40), 2);            // 層3(40分)でだけ着く = 2回以上
assert.strictEqual(L.minTransfers(mats, 'o', 1, 0, 30), -1);
assert.deepStrictEqual(L.pair(mats, 3, 1, 0), { out: 40, ret: 45 });

const cells = [['A', 1000, 100, 0], ['B', 500, 40, 1]];
assert.deepStrictEqual(L.statusesForDest(mats, 3, 0, cells, 30), ['both', 'one']);
assert.deepStrictEqual(L.statusesForDest(mats, 3, 0, cells, 5), ['none', 'rail']);   // 着けず鉄道が近い地区は未評価
const sum = L.summarize(cells, ['both', 'rail']);
assert.strictEqual(sum.by.both.kids, 100);
assert.strictEqual(sum.by.rail.pop, 500);
assert.strictEqual(sum.pop, 1500);
assert.strictEqual(L.pct(100, 140), 71.4);

// --- 区分と一覧
assert.deepStrictEqual([0, 1, 4, 5, 19, 20].map(L.bucketOf), ['n0', 'n1', 'n1', 'n2', 'n2', 'n3']);
assert.strictEqual(L.countBoth(mats, 3, [0, 1], 0, 45), 2);
const list = L.listForCell(mats, 3, [0, 1], 0, 45);
assert.deepStrictEqual(list.map((r) => r.d), [0, 1]);            // 行き帰りの長い方が短い順
assert.ok(list.every((r) => r.status === 'both'));
const list1 = L.listForCell(mats, 3, [0, 1], 1, 45);
assert.deepStrictEqual(list1.map((r) => [r.d, r.status]), [[0, 'one']]);
assert.strictEqual(L.clock(16, 35), '16:35');
assert.strictEqual(L.clock(16, 50), '16:50');
assert.strictEqual(L.clock(17, 75), '18:15');

// --- 共有リンク
const st = { o: 10, r: 17, w: 45, c: 800, t: 2, kinds: ['zoo', 'aquarium'], view: 'b', sel: 12 };
assert.deepStrictEqual(L.parseHash(L.writeHash(st)), { o: 10, r: 17, w: 45, c: 800, t: 2, kinds: ['zoo', 'aquarium'], view: 'b', sel: '12' });
assert.strictEqual(L.parseHash('').o, null);
assert.deepStrictEqual(L.parseHash('#k=').kinds, []);

// --- 通知・出典
assert.ok(L.ODPT_NOTICE.includes('公共交通事業者への直接の問合せは行わないでください'));
assert.ok(L.KSJ_TERMS.includes('非商用'));
const cite = L.citationText(meta, { url: 'https://example.org/', date: '2026-11-14' });
assert.ok(cite.includes('非商用') && cite.includes('公共交通オープンデータセンター'));
assert.strictEqual(L.esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');

console.log('lib_test OK');
