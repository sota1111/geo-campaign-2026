// 実行: node --test contests/ichibiz-2026/app/realestate/tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Lib = require('../web/lib.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../web/data/tokushima.json'), 'utf8'));

const baseFacts = (o) => Object.assign({ place: 't', inArea: true, zone: null, flood: { status: 'outside' }, hightide: { status: 'outside' }, tsunami: { status: 'outside' }, sediment: {}, elevation: null, transit: null }, o);
const text = (s) => JSON.stringify(s);
const exit = (s, k) => s.exits.find((e) => e.key === k);

test('タイル座標: 徳島市役所付近は z16 で 57262/26164', () => {
  const t = Lib.tileOf(134.5548, 34.0703, 16);
  assert.deepStrictEqual([t.x, t.y], [57262, 26164]);
  assert.ok(t.px >= 0 && t.px < 256 && t.py >= 0 && t.py < 256);
});
test('世界座標の往復', () => {
  const w = Lib.lonLatToWorld(134.5, 34.0, 15), b = Lib.worldToLonLat(w.x, w.y, 15);
  assert.ok(Math.abs(b.lon - 134.5) < 1e-9 && Math.abs(b.lat - 34.0) < 1e-9);
});
test('距離: 経度0.01度 (北緯34度) は約920m', () => {
  const d = Lib.haversine(134.5, 34, 134.51, 34);
  assert.ok(d > 900 && d < 940, String(d));
});
test('多角形の内外判定と穴', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.ok(Lib.inPolygon(1, 1, [sq]));
  assert.ok(!Lib.inPolygon(11, 1, [sq]));
  assert.ok(!Lib.inPolygon(5, 5, [sq, hole]));
});
test('用途地域データ: 徳島市中心部のどこかで用途地域が見つかる', () => {
  assert.ok(data.zones.length > 50);
  const z = Lib.findZone(data.zones, 134.5548, 34.0703);
  assert.ok(z === null || typeof z.name === 'string');
  let found = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) if (Lib.findZone(data.zones, 134.5 + i * 0.002, 34.03 + j * 0.002)) found++;
  assert.ok(found > 100, 'found=' + found);
});
test('交通: 最寄り停留所と駅', () => {
  const t = Lib.transitAround(data, 134.5548, 34.0703, 500);
  assert.ok(t.bus && t.bus.dist < 2000);
  assert.ok(t.rail && t.rail.dist < 5000);
  assert.ok(t.busNames >= 1);
});
test('洪水の画素分類', () => {
  assert.strictEqual(Lib.classifyFlood([0, 0, 0, 0]).inside, false);
  const c = Lib.classifyFlood([255, 216, 192, 255]);
  assert.strictEqual(c.inside, true); assert.strictEqual(c.depth, '0.5〜3m');
  assert.strictEqual(Lib.classifyFlood([10, 200, 10, 255]).depth, null); // 凡例にない色は深さを言わない
});
test('標高タイルの復号', () => {
  assert.strictEqual(Lib.demElevation(0, 0, 100), 1);
  assert.strictEqual(Lib.demElevation(128, 0, 0), null);
});
test('シート: 4つの出口が必ずあり、建物ありは手放すに国庫帰属の注意が出る', () => {
  const s = Lib.buildSheet(baseFacts({}), { building: 'あり' });
  assert.deepStrictEqual(s.exits.map((e) => e.label), ['売る', '貸す', '活かす', '手放す']);
  assert.match(text(exit(s, 'release')), /国庫帰属/);
  assert.match(text(exit(s, 'release')), /司法書士/);
});
test('シート: 洪水想定区域内なら貸すに借り手への説明を聞く項目が出る', () => {
  const s = Lib.buildSheet(baseFacts({ flood: { status: 'inside', depth: '0.5〜3m' } }), {});
  assert.match(text(exit(s, 'rent')), /洪水浸水想定区域/);
  assert.match(text(exit(s, 'rent')), /借り手に何を説明すべきか/);
});
test('シート: 用途地域の指定がない場合は区域区分を市役所に聞く（断定しない）', () => {
  const s = Lib.buildSheet(baseFacts({}), {});
  assert.match(text(exit(s, 'sell')), /市街化調整区域か/);
  assert.match(text(s), /可能性/);
});
test('シート: データ範囲外は用途地域を出せない旨を「データにない項目」に出す', () => {
  const s = Lib.buildSheet(baseFacts({ inArea: false }), {});
  assert.ok(s.missing.some((m) => m.includes('用途地域')));
});
test('シート: 通信失敗の災害データは「ない」ではなく取得できなかったと示す', () => {
  const s = Lib.buildSheet(baseFacts({ flood: { status: 'error' } }), {});
  assert.ok(s.missing.some((m) => m.includes('取得できませんでした')));
  assert.doesNotMatch(text(s), /該当しなかった/);
});
test('サンプルは「サンプル（架空）」と明示される', () => {
  const s = Lib.buildSheet(Lib.SAMPLE_FACTS, Lib.SAMPLE_ANSWERS);
  assert.ok(s.sample); assert.match(s.title, /サンプル（架空）/);
  assert.match(text(exit(s, 'sell')), /市街化調整区域/);
});
test('禁止事項: 金額・査定・断定の語、およびサービス名にライブラリ名が出ない', () => {
  for (const [f, a] of [[Lib.SAMPLE_FACTS, Lib.SAMPLE_ANSWERS], [baseFacts({ zone: { name: '第一種住居地域', bcr: 60, far: 200 }, flood: { status: 'inside', depth: null } }), { building: 'なし', landUse: '農地', road: 'なし', registered: '未' }]]) {
    const s = Lib.buildSheet(f, a);
    assert.doesNotMatch(s.title, /不動産情報ライブラリ/);
    const body = text(s.exits);
    assert.doesNotMatch(body, /売るべき|貸すべき|査定|円|万円|利回り|収益|必ず売れ|税金が/);
    // どの項目も「聞く」「確かめる」の形
    for (const e of s.exits) for (const it of e.items) assert.match(it.ask, /聞く|確かめる/);
  }
});
test('データファイル: 徳島市コードと出典がある', () => {
  assert.strictEqual(data.code, '36201');
  assert.match(data.zones_source, /国土数値情報/);
});
