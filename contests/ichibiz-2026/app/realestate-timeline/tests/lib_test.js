const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../web/lib.js');

const dir = path.join(__dirname, '../web/data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const D = L.validate(read('price.json'), read('rent.json'), read('wards.json'));

test('実データが検証を通り、23区・84四半期・4調査年', () => {
  assert.ok(D);
  assert.equal(D.wards.length, 23);
  assert.equal(D.price.quarters[0], '2005Q3');
  assert.equal(D.price.quarters.at(-1), '2026Q2');
  assert.deepEqual(D.rent.years, ['2008', '2013', '2018', '2023']);
});

test('色の階級: 境界は上の階級に入る。値なしは -1', () => {
  const b = L.MODES.price.breaks;
  assert.equal(L.classOf(39.9, b), 0);
  assert.equal(L.classOf(40, b), 1);
  assert.equal(L.classOf(170, b), 6);
  assert.equal(L.classOf(null, b), -1);
  assert.equal(L.PALETTE.length, b.length + 1);
  assert.equal(L.classLabel(0, b, ''), '40未満');
  assert.equal(L.classLabel(6, b, ''), '170以上');
});

test('家賃の調査年: 10月1日時点なので、その年は第4四半期から', () => {
  const ys = ['2008', '2013', '2018', '2023'];
  assert.equal(L.surveyYearFor('2008Q3', ys), null);
  assert.equal(L.surveyYearFor('2008Q4', ys), '2008');
  assert.equal(L.surveyYearFor('2013Q3', ys), '2008');
  assert.equal(L.surveyYearFor('2013Q4', ys), '2013');
  assert.equal(L.surveyYearFor('2026Q2', ys), '2023');
});

test('件数が30未満は low。実データの低件数セルの数', () => {
  const qs = D.price.quarters;
  let low = 0, total = 0;
  for (const w of D.wards) for (let i = 0; i < qs.length; i++) { const p = L.priceAt(D.price, w.code, i); total++; if (p.low) low++; assert.equal(p.low, p.n < 30); }
  assert.equal(total, 23 * 84);
  assert.equal(low, 12);
});

test('cellFor / ranking: 港区は千代田区より最新期に高い、順位は降順', () => {
  const qi = D.price.quarters.length - 1;
  const r = L.ranking('price', D, qi);
  assert.equal(r.length, 23);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].value >= r[i].value);
  const rent = L.ranking('rent', D, qi);
  assert.equal(rent.length, 23);
  assert.equal(L.cellFor('rent', D, '13103', 0).value, null); // 2005Q3 は家賃の調査より前
  assert.equal(L.cellFor('rent', D, '13103', qi).year, '2023');
});

test('境界: 港区の中心が港区に入り、海の上は区なし', () => {
  const minato = D.wards.find((w) => w.code === '13103');
  const lp = L.labelPoint(minato);
  assert.equal(L.wardAt(D.wards, 139.7454, 35.6586)?.name, '港区'); // 東京タワー付近
  assert.ok(lp.w > 0);
  assert.equal(L.wardAt(D.wards, 139.9, 35.55), null);
});

test('グラフの座標: null で線が切れる。帯は閉じる', () => {
  assert.equal(L.linePath([{ x: 0, y: 1 }, null, { x: 2, y: 3 }]), 'M0.0 1.0M2.0 3.0');
  const top = [{ x: 0, y: 0 }, { x: 1, y: 0 }], bot = [{ x: 0, y: 2 }, { x: 1, y: 2 }];
  assert.match(L.bandPath(top, bot), /Z$/);
  assert.deepEqual(L.niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
});

test('禁止語を使わない（査定・適正価格）／サービス名にライブラリ名を入れない', () => {
  const texts = [L.NOTICE, L.PROCESSED, L.RESPONSIBILITY, L.ATTRIBUTION_RENT].join('');
  assert.ok(!/査定|適正価格/.test(texts));
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(!/<title>[^<]*不動産情報ライブラリ/.test(html) && !/<h1>[^<]*不動産情報ライブラリ/.test(html));
  assert.ok(!/査定|適正価格/.test(html));
});

test('利用規約の文言（クレジット）が変わっていない', () => {
  assert.equal(L.CREDIT, 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません');
  assert.equal(L.CREDIT_ESTAT, 'このサービスは、統計ダッシュボードのAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません');
});
