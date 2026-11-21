import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, parseBuiltYear, median, quantile, toTrade, aggregate, quarterKey } from '../tools/aggregate.mjs';
import { simplify, ringArea } from '../tools/build-boundaries.mjs';

const rec = (o = {}) => ({ Type: '中古マンション等', MunicipalityCode: '13103', Period: '2024年第3四半期', TradePrice: '60000000', Area: '60', BuildingYear: '平成20年', ...o });

test('取引時点・築年の読み取り', () => {
  assert.deepEqual(parsePeriod('2024年第3四半期'), { year: 2024, q: 3 });
  assert.equal(parsePeriod('2024年'), null);
  assert.equal(quarterKey(2005, 3), '2005Q3');
  assert.equal(parseBuiltYear('平成20年'), 2008);
  assert.equal(parseBuiltYear('令和元年'), 2019);
  assert.equal(parseBuiltYear('昭和55年'), 1980);
  assert.equal(parseBuiltYear('戦前'), null);
  assert.equal(parseBuiltYear('2010年'), 2010);
});

test('中央値・分位点', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
});

test('toTrade: 種類・区・面積・価格で除く', () => {
  const t = toTrade(rec());
  assert.equal(t.code, '13103'); assert.equal(t.key, '2024Q3'); assert.equal(t.unit, 1000000); assert.equal(t.age, 16);
  assert.equal(toTrade(rec({ Type: '宅地(土地と建物)' })), null);
  assert.equal(toTrade(rec({ MunicipalityCode: '13201' })), null); // 区外（八王子市）
  assert.equal(toTrade(rec({ Area: '2000' })), null);
  assert.equal(toTrade(rec({ Area: '5' })), null);
  assert.equal(toTrade(rec({ TradePrice: '' })), null);
  assert.equal(toTrade(rec({ Period: '不明' })), null);
  assert.equal(toTrade(rec({ BuildingYear: '戦前' })).age, null);
  assert.equal(toTrade(rec({ BuildingYear: '令和7年' })).age, null); // 取引より後の築年は築年数なし
});

test('aggregate: 区×四半期の件数と中央値', () => {
  const ts = [rec(), rec({ TradePrice: '90000000' }), rec({ TradePrice: '30000000' }), rec({ MunicipalityCode: '13104' })].map(toTrade);
  const a = aggregate(ts);
  const x = a.get('13103|2024Q3');
  assert.equal(x.n, 3); assert.equal(x.unit, 1000000); assert.equal(x.price, 60000000); assert.equal(x.area, 60);
  assert.equal(a.get('13104|2024Q3').n, 1);
  assert.equal(a.get('13105|2024Q3'), undefined);
});

test('境界の単純化: 直線上の点は落ち、角は残る', () => {
  const s = simplify([[0, 0], [1, 0.00001], [2, 0], [2, 2], [0, 2], [0, 0]], 0.0001);
  assert.equal(s.length, 5);
  assert.equal(ringArea([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]), 4);
});
