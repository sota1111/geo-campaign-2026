// lib.js の単体試験: node tests/lib_test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Nb = require('../web/lib.js');

// 距離: 京都駅付近〜大阪駅付近はおよそ40km（直線）
const d = Nb.distKm(34.9858, 135.7588, 34.7025, 135.4959);
assert.ok(d > 38 && d < 41, 'kyoto-osaka ' + d);
assert.equal(Nb.distKm(35, 135, 35, 135), 0);

// 廃棄時期の置き方
const row = (kw, start, fit, lat, lon, muni) => [lat, lon, kw, start, fit, 201500, 0, muni || 0];
assert.equal(Nb.disposalYear(row(100, 201505, 203505, 35, 135), { type: 'life', years: 25 }), 2040);
assert.equal(Nb.disposalYear(row(100, 201505, 203505, 35, 135), { type: 'fit' }), 2035);
assert.equal(Nb.disposalYear(row(100, 201505, 0, 35, 135), { type: 'fit' }), 2035, '列が空なら運転開始+20年');
assert.equal(Nb.disposalYear(row(100, 0, 0, 35, 135), { type: 'life', years: 25 }), null, '運転開始前は推定しない');

// 集計: 施設A(35,135) 施設B(35,136)。設備5つ
const sites = [{ lat: 35, lon: 135 }, { lat: 35, lon: 136 }];
const rows = [
  row(1000, 201305, 203305, 35.0, 135.05, 0),   // Aの近く、2038年（25年）
  row(500, 201405, 203405, 35.0, 135.95, 1),    // Bの近く、2039年
  row(200, 201505, 203505, 35.5, 135.5, 1),     // どちらからも遠い、2040年
  row(300, 202005, 204005, 35.0, 135.0, 0),     // Aの上、2045年（対象年より後）
  row(999, 0, 0, 35.0, 135.0, 0)                // 運転開始前（対象外）
];
const o = { basis: { type: 'life', years: 25 }, cutoff: 2040, radiusKm: 20 };
const r = Nb.analyze(rows, ['甲', '乙'], sites, o);
assert.equal(r.total.plants, 3);
assert.equal(r.total.kw, 1700);
assert.equal(r.total.outPlants, 1);
assert.equal(r.total.outKw, 200);
assert.equal(r.bySite[0].plants + r.bySite[1].plants, 3);
assert.ok(r.bySite[0].plants >= 1 && r.bySite[1].plants >= 1);
assert.equal(r.total.allPlants, 5);
const years = r.yearly.map((y) => y.year);
assert.deepEqual(years, [2038, 2039, 2040, 2041, 2042, 2043, 2044, 2045]);
assert.equal(r.yearly.find((y) => y.year === 2045).kw, 300, '対象年より後も年別には出る');
assert.equal(r.munis.find((m) => m.name === '乙').plants, 2);
assert.ok(r.items[4].year === null && !r.items[4].inCut);
// 年別の合計 = 推定できた全設備の出力
assert.equal(r.yearly.reduce((a, y) => a + y.kw, 0), 2000);
// 回収圏を広げれば圏外は減る（単調）
const wide = Nb.analyze(rows, ['甲', '乙'], sites, { ...o, radiusKm: 100 });
assert.ok(wide.total.outKw <= r.total.outKw);
assert.equal(wide.total.outKw, 0);
// 対象年を前倒しすれば対象は減る（単調）
assert.ok(Nb.analyze(rows, ['甲', '乙'], sites, { ...o, cutoff: 2038 }).total.plants <= r.total.plants);

// 拠点を足すと圏外が減る・距離が増えない
const sites3 = sites.concat([{ lat: 35.5, lon: 135.5 }]);
const r3 = Nb.analyze(rows, ['甲', '乙'], sites3, o);
assert.equal(r3.total.outKw, 0);
assert.ok(r3.total.kmKw < r.total.kmKw);

// 候補探索: 町字の代表点(precision 0)だけを候補にし、距離を減らす点を返す
const s = Nb.suggestSite(rows, sites, o);
assert.ok(s && s.reducedKmKw > 0);
assert.ok(rows.some((x) => x[0] === s.lat && x[1] === s.lon && x[6] === 0));
assert.ok(Math.abs(s.lat - 35.5) < 1e-9 && Math.abs(s.lon - 135.5) < 1e-9, 'いちばん遠い設備の位置が選ばれる');

// CSV
assert.equal(Nb.csvCell('a,b'), '"a,b"');
assert.equal(Nb.csvCell('a"b'), '"a""b"');
assert.equal(Nb.toCsv([['x', 1], ['y,z', 2]]), 'x,1\r\n"y,z",2\r\n');

// 実データ（生成済みなら）: 範囲・型
const p = path.join(__dirname, '..', 'web', 'data', 'plants.json');
if (fs.existsSync(p)) {
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(j.rows.length > 1000, 'rows ' + j.rows.length);
  for (const x of j.rows) {
    assert.equal(x.length, 8);
    assert.ok(x[0] > 34.6 && x[0] < 35.8 && x[1] > 134.7 && x[1] < 136.2, 'bbox');
    assert.ok(x[2] > 0 && x[3] >= 201200 && x[3] <= 202700, 'kw/start ' + x);
    assert.ok(x[6] === 0 || x[6] === 1);
    assert.ok(x[7] >= 0 && x[7] < j.munis.length);
  }
  const fac = JSON.parse(fs.readFileSync(path.join(path.dirname(p), 'facilities.json'), 'utf8'));
  const rr = Nb.analyze(j.rows, j.munis, fac, { basis: { type: 'life', years: 25 }, cutoff: 2100, radiusKm: 30 });
  assert.equal(rr.total.plants, j.rows.length, '十分遠い対象年なら全設備が対象');
  assert.ok(Math.abs(rr.total.kw - j.rows.reduce((a, x) => a + x[2], 0)) < 1e-6);
  console.log('real data rows', j.rows.length, 'facilities', fac.length);
}
console.log('lib_test OK');
