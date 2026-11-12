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
const cell = ['533946111', 100, 30, '210000' + '004321', '30'];
assert.equal(L.condIndex(1, 'hol', 'e'), 11);
assert.equal(L.cellStatus(cell, 0, 'wd', 'm', 2), 'walk');          // 病院は徒歩だけで水準3（30分以内）。必要2（45分）を満たす
assert.equal(L.cellStatus(cell, 1, 'wd', 'm', 1), 'none'); // 学校 wd 朝は水準0
assert.equal(L.cellStatus(cell, 1, 'hol', 'e', 1), 'transit');       // 末尾 '1'
assert.equal(L.cellStatus(cell, 1, 'hol', 'e', 2), 'none');          // 水準1 < 必要2
assert.equal(L.cellStatus(cell, 0, 'wd', 'm', 4), 'none');           // 徒歩3・公共交通2 はどちらも必要4（20分）に届かない
assert.equal(L.cellStatus(cell, 0, 'wd', 'm', 3), 'walk');           // 必要3（30分）なら歩いて着く（徒歩を優先して表示）
// 鉄道駅が近い（rail=1）が、どちらでも着けない地区は 'rail'（鉄道は未評価）。着ける地区は rail を無視
const railCell = ['533946111', 100, 30, '0'.repeat(12), '00', 1];
assert.equal(L.cellStatus(railCell, 0, 'wd', 'm', 1), 'rail');
assert.equal(L.cellStatus(['x', 1, 1, '1' + '0'.repeat(11), '00', 1], 0, 'wd', 'm', 1), 'transit');
assert.equal(L.reachable('rail'), false);

// 集計
const cells = [
  ['a', 100, 40, '4' + '00000' + '00000' + '0', '00'],
  ['b', 50, 10, '0'.repeat(12), '00'],
  ['c', 10, 5, '0'.repeat(12), '10'],
  ['d', 20, 8, '0'.repeat(12), '00', 1],
];
const s = L.summarize(cells, 0, 'wd', 'm', 1);
assert.deepEqual([s.pop, s.walk, s.transit, s.rail, s.none], [180, 10, 100, 20, 50]);
assert.deepEqual([s.pop65, s.walk65, s.transit65, s.rail65, s.none65], [63, 5, 40, 8, 10]);
assert.equal(L.pct(1, 3), 33.3);
assert.equal(L.pct(1, 0), 0);

// 路線を止めた差分: a は水準4→0 で「行けなくなる」。b は水準0→0 で変化なし。c は徒歩圏で不変
const cs = [
  ['a', 100, 40, '4' + '0'.repeat(11), '00'],
  ['b', 50, 10, '0'.repeat(12), '00'],
  ['c', 10, 5, '4' + '0'.repeat(11), '10'],
  ['d', 20, 8, '4' + '0'.repeat(11), '00', 1],
];
const lp = L.lostPopulation(cs, [[0, '0'.repeat(12)], [1, '0'.repeat(12)], [2, '0'.repeat(12)]], 0, 'wd', 'm', 1);
assert.deepEqual([lp.lost, lp.lost65, Object.keys(lp.idx)], [100, 40, ['0']]);
// d は水準4→0 で「行けなくなる」。鉄道駅が近くても、止めた結果が 'rail' なら行けなくなった人に数える
const lpd = L.lostPopulation(cs, [[3, '0'.repeat(12)]], 0, 'wd', 'm', 1);
assert.equal(lpd.lost, 20);
// 水準が4→2 に下がっても W=60 の条件ではまだ行ける（失わない）
const lp2 = L.lostPopulation(cs, [[0, '2' + '0'.repeat(11)]], 0, 'wd', 'm', 1);
assert.equal(lp2.lost, 0);
const lp3 = L.lostPopulation(cs, [[0, '2' + '0'.repeat(11)]], 0, 'wd', 'm', 3);   // W=30 では失う
assert.equal(lp3.lost, 100);

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
assert.deepEqual(L.nodeFacts(node), ['平日は1日20本、終発は19:00', '休日は1日5本（平日の本数の25%）、終発は16:40']);
assert.deepEqual(L.nodeFacts([135, 35, 'Z', [0, 0, 0, 0, -1, -1], [0, 0, 0, 0, -1, -1], []]), ['この停留所群から発車する便は基準日にありません']);

// 結論の一言
const vo = { fi: 0, day: 'wd', per: 'm', w: 30, thresholds: th, startHours: { m: 8, d: 12, e: 17 }, facLabel: '病院' };
const vcell = ['533946111', 10, 3, '300000' + '000000', '00', 0];   // 病院 平日朝=水準3(30分) 休日朝=0
const v1 = L.verdict(vcell, vo);
assert.equal(v1.status, 'transit');
assert.equal(v1.main, 'この地点から平日朝8時に出発すると、病院へ30分以内に 行けます（公共交通で）');
assert.ok(v1.cmp.startsWith('休日（日曜ダイヤ）の朝8時発は 行けません'));
assert.equal(L.verdict(['x', 1, 1, '0'.repeat(12), '30', 0], vo).status, 'walk');
assert.ok(L.verdict(['x', 1, 1, '0'.repeat(12), '30', 0], vo).cmp.includes('同じ結果'));
assert.equal(L.verdict(['x', 1, 1, '0'.repeat(12), '00', 1], vo).status, 'rail');
assert.equal(L.verdict(null, vo), null);
assert.equal(L.verdict(vcell, Object.assign({}, vo, { day: 'hol' })).status, 'none');

// 同名停留所の区別
const ns = [[0, 0, '西赤田', [], [], [0, 1, 2]], [0, 0, '西赤田', [], [], [1]], [0, 0, '駅前', [], [], [0]]];
const rts = [['A線'], ['B線'], ['C線']];
const nr = [{ i: 0, d: 100 }, { i: 1, d: 200 }, { i: 2, d: 300 }];
assert.deepEqual(L.stopLabels(ns, nr, rts), ['西赤田（A線・B線 ほか方面）', '西赤田（B線方面）', '駅前']);

// ハッシュの読み書き
const hs = { region: 'toyama', fi: 1, day: 'hol', per: 'e', w: 45, route: '12', pt: [137.2137, 36.7016] };
assert.equal(L.writeHash(hs), '#region=toyama&f=1&d=hol&p=e&w=45&r=12&pt=137.21370,36.70160');
assert.deepEqual(L.parseHash(L.writeHash(hs)), { region: 'toyama', fi: 1, day: 'hol', per: 'e', w: 45, route: '12', pt: [137.2137, 36.7016] });
assert.deepEqual(L.parseHash('#region=toyama'), { region: 'toyama' });
assert.deepEqual(L.parseHash('#region=<script>'), {});
assert.deepEqual(L.parseHash('#region=iida&d=xx&p=m&w=abc&pt=1,2&r=-1'), { region: 'iida', per: 'm' });
assert.deepEqual(L.parseHash(''), {});
assert.equal(L.writeHash({ region: 'a', fi: 0, day: 'wd', per: 'm', w: 20 }), '#region=a&f=0&d=wd&p=m&w=20');

// 地名検索の応答・地域判定
const gs = L.parseGsi([{ geometry: { coordinates: [137.21, 36.69] }, properties: { title: '富山駅' } }, { geometry: {} }, null]);
assert.deepEqual(gs, [{ lon: 137.21, lat: 36.69, title: '富山駅' }]);
assert.deepEqual(L.parseGsi({ error: 1 }), []);
const regs = [{ id: 'a', bbox: [0 + 130, 30, 131, 31] }, { id: 'b', bbox: [130.5, 30.5, 130.7, 30.7] }];
assert.equal(L.regionForPoint(regs, 130.6, 30.6), 'b');
assert.equal(L.regionForPoint(regs, 130.1, 30.1), 'a');
assert.equal(L.regionForPoint(regs, 140, 35), null);
assert.equal(L.shortName('東京都区部（都営バス・都営地下鉄沿線の一部）'), '東京都区部');

// 地域比較
const cd = { id: 'x', name: 'X市', facility_order: ['hospital', 'school'], params: { thresholds: th }, cells: cells };
const cr = L.compareRow(cd, 'hospital', 'wd', 'm', 60);
assert.deepEqual([cr.pop, cr.none, cr.none65, cr.okPct], [180, 50, 10, 61.1]);
assert.equal(L.compareRow(cd, 'hospital', 'wd', 'm', 50), null);
assert.equal(L.compareRow(cd, 'mall', 'wd', 'm', 60), null);

// 出典の例文
const ct = L.citationText({ name: 'X市', coverage: { sources: ['GTFSデータリポジトリ'] },
  feeds: [{ org: 'A社', license: 'CC0 1.0', credit: '' }, { org: 'A社', license: 'CC0 1.0' }, { org: 'B市', license: 'CC BY 4.0', credit: 'B市交通局' }] },
  { url: 'https://example.org/app/', date: '2026-11-11' });
assert.ok(ct.includes('A社（CC0 1.0）、B市（CC BY 4.0、B市交通局）') && ct.includes('2026-11-11') && ct.includes('国土地理院'));

console.log('lib_test OK');
