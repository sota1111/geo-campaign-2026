import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePeriod, parseBuiltYear, median, quantile, toTrade, aggregate, aggregateYears, floorGroup, PLAN_GROUPS, quarterKey } from '../tools/aggregate.mjs';

const rec = (o = {}) => ({ Type: '中古マンション等', MunicipalityCode: '13103', DistrictName: '赤坂', FloorPlan: '１ＬＤＫ', Period: '2024年第3四半期', TradePrice: '60000000', Area: '60', BuildingYear: '平成20年', ...o });

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

test('間取りのまとめ方: 実データの原文（全角）を4つに分ける', () => {
  const g = (s) => floorGroup(s);
  assert.deepEqual(['ワンルーム', 'スタジオ', '１Ｒ', '１Ｋ', '１Ｋ＋Ｓ'].map(g), ['p1', 'p1', 'p1', 'p1', 'p1']);
  assert.deepEqual(['１ＤＫ', '１ＬＤＫ', '１ＬＤＫ＋Ｓ', '２Ｋ', '２ＤＫ', '２ＤＫ＋Ｓ', '１Ｌ'].map(g), ['p2', 'p2', 'p2', 'p2', 'p2', 'p2', 'p2']);
  assert.deepEqual(['２ＬＤＫ', '２ＬＤＫ＋Ｓ', '３Ｋ', '３ＤＫ', '２ＬＤ＋Ｓ'].map(g), ['p3', 'p3', 'p3', 'p3', 'p3']);
  assert.deepEqual(['３ＬＤＫ', '３ＬＤＫ＋Ｓ', '４ＬＤＫ', '４ＤＫ', '５ＬＤＫ', '７ＬＤＫ', '３ＬＫ'].map(g), ['p4', 'p4', 'p4', 'p4', 'p4', 'p4', 'p4']);
  assert.deepEqual(['', 'オープンフロア', 'メゾネット', undefined].map(g), [null, null, null, null]);
  assert.deepEqual(PLAN_GROUPS.map((p) => p.key), ['all', 'p1', 'p2', 'p3', 'p4']);
});

test('toTrade: 種類・区・面積・価格で除く。地区名・間取りを持つ', () => {
  const t = toTrade(rec());
  assert.equal(t.code, '13103'); assert.equal(t.key, '2024Q3'); assert.equal(t.year, 2024); assert.equal(t.unit, 1000000); assert.equal(t.age, 16);
  assert.equal(t.district, '赤坂'); assert.equal(t.plan, 'p2');
  assert.equal(toTrade(rec({ DistrictName: undefined })).district, '');
  assert.equal(toTrade(rec({ Type: '宅地(土地と建物)' })), null);
  assert.equal(toTrade(rec({ MunicipalityCode: '13201' })), null); // 区外（八王子市）
  assert.equal(toTrade(rec({ Area: '2000' })), null);
  assert.equal(toTrade(rec({ Area: '5' })), null);
  assert.equal(toTrade(rec({ TradePrice: '' })), null);
  assert.equal(toTrade(rec({ Period: '不明' })), null);
  assert.equal(toTrade(rec({ BuildingYear: '戦前' })).age, null);
  assert.equal(toTrade(rec({ BuildingYear: '令和7年' })).age, null); // 取引より後の築年は築年数なし
});

test('aggregate: 区×四半期の件数と中央値（従来の関数）', () => {
  const ts = [rec(), rec({ TradePrice: '90000000' }), rec({ TradePrice: '30000000' }), rec({ MunicipalityCode: '13104' })].map(toTrade);
  const a = aggregate(ts);
  const x = a.get('13103|2024Q3');
  assert.equal(x.n, 3); assert.equal(x.unit, 1000000); assert.equal(x.price, 60000000);
  assert.equal(a.get('13104|2024Q3').n, 1);
});

test('aggregateYears: 窓（直近N年）・間取り・地区ごとの件数と中央値', () => {
  const ts = [
    rec({ Period: '2020年第1四半期', TradePrice: '60000000' }),                        // 赤坂・p2
    rec({ Period: '2022年第2四半期', TradePrice: '90000000' }),                        // 赤坂・p2
    rec({ Period: '2022年第3四半期', TradePrice: '30000000', FloorPlan: '３ＬＤＫ' }), // 赤坂・p4
    rec({ Period: '2022年第3四半期', DistrictName: '' }),                              // 地区名なし: 区別にだけ入る
    rec({ Period: '2022年第3四半期', DistrictName: '六本木', TradePrice: '120000000' }),
    rec({ Period: '2022年第3四半期', FloorPlan: 'オープンフロア', TradePrice: '120000000' }), // 間取り特殊: 「すべて」だけ
  ].map(toTrade);
  const d1 = aggregateYears(ts, { scope: 'district', win: 1, years: [2020, 2022] });
  assert.equal(d1.get('13103|赤坂|all|2020').n, 1);
  assert.equal(d1.get('13103|赤坂|all|2022').n, 3); // 赤坂の2022年: p2 1件・p4 1件・オープンフロア 1件
  const d5 = aggregateYears(ts, { scope: 'district', win: 5, years: [2022] });
  const a = d5.get('13103|赤坂|p2|2022');
  assert.equal(a.n, 2); assert.equal(a.unit, (1000000 + 1500000) / 2);
  assert.equal(d5.get('13103|赤坂|p4|2022').n, 1);
  assert.equal(d5.get('13103|赤坂|p1|2022'), undefined);
  assert.equal(d5.get('13103|赤坂|all|2022').n, 4);
  assert.equal(d5.get('13103||all|2022'), undefined); // 地区名なしは地区別に入らない
  const w = aggregateYears(ts, { scope: 'ward', win: 5, years: [2022] });
  assert.equal(w.get('13103|all|2022').n, 6); // 区別には地区名なしも入る
  const d2 = aggregateYears(ts, { scope: 'district', win: 2, years: [2021] }); // 2020〜2021年の窓
  assert.equal(d2.get('13103|赤坂|all|2021').n, 1);
});
