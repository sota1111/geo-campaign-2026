// 実行: lib_test.js の先頭の行を参照
import test from 'node:test';
import assert from 'node:assert';
import { numLead, diagnoseXpt, groupParcels, extractKojiPoints, matchKoji, attachKoji, fillParcels, tilesOf, MATCH_RADIUS_M } from '../tools/parcels.mjs';

const rec = (o) => ({ id: '133-福岡中央-商業地-9', lon: 130.4, lat: 33.59, use: '商業地', area: '福岡中央', lot: '天神1', addr: '', price: 111, change: 1, rosenka: null, rosenkaYear: '0', hikaku: 1000, shueki: null, rimawari: null, zone: '商業地域', kenpei: 80, yoseki: 800, chiseki: 100, genkyo: '', ...o });
const feat = (lon, lat, p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { point_id: 1, u_current_years_price_ja: '12,100,000(円/㎡)', standard_lot_number_ja: '福岡中央5-9', use_category_name_ja: '商業地', land_price_type: 0, ...p } });

test('同じ標準地番号の記録を1つにまとめ、値は記録ごとの配列で持つ', () => {
  const g = groupParcels([rec({ hikaku: 1000, rosenka: 800, rosenkaYear: '2024' }), rec({ hikaku: 1050, rosenka: 800, rosenkaYear: '2024' }), rec({ id: 'other', hikaku: 5 })]);
  assert.strictEqual(g.length, 2);
  const p = g[0];
  assert.deepStrictEqual([p.n, p.hikaku, p.rosenka, p.shueki, p.rosenkaYear], [2, [1000, 1050], [800, 800], [null, null], '2024']);
  assert.strictEqual(g[1].n, 1);
  assert.ok(!('price' in p) && !('change' in p), 'XCT001 の公示価格は持たない');
});
test('XPT002: 地価公示の点だけ取り出す（価格なし・地価調査・重複を除く）', () => {
  const k = extractKojiPoints([
    feat(130.4, 33.59, {}),
    feat(130.4, 33.59, {}), // 同じ point_id
    feat(130.5, 33.6, { point_id: 2, land_price_type: 1 }),
    feat(130.5, 33.6, { point_id: 3, u_current_years_price_ja: '' }),
    feat(130.5, 33.6, { point_id: 4, use_category_name_ja: '00,住宅地', u_current_years_price_ja: '95,000' }),
    { geometry: { type: 'Polygon' }, properties: {} },
  ]);
  assert.deepStrictEqual(k.map((e) => [e.id, e.price, e.use]), [['1', 12100000, '商業地'], ['4', 95000, '住宅地']]);
  assert.strictEqual(k[0].lotNo, '福岡中央5-9');
});
test('突き合わせ: 位置が近く用途が同じ点を当てる', () => {
  const p = groupParcels([rec({})])[0];
  const m = matchKoji(p, extractKojiPoints([feat(130.40001, 33.59, {})]));
  assert.deepStrictEqual([m.price, m.lotNo], [12100000, '福岡中央5-9']);
  assert.ok(m.distM <= MATCH_RADIUS_M);
});
test('突き合わせ: 遠い・用途が違う点は当てず null（照合できませんでした）', () => {
  const p = groupParcels([rec({})])[0];
  assert.strictEqual(matchKoji(p, extractKojiPoints([feat(130.41, 33.59, {})])), null); // 約900m
  assert.strictEqual(matchKoji(p, extractKojiPoints([feat(130.4, 33.59, { use_category_name_ja: '住宅地' })])), null);
  assert.strictEqual(matchKoji(p, []), null);
});
test('突き合わせ: 最も近い2点が同距離で価格が違えば決められず null。近い方があれば当てる', () => {
  const p = groupParcels([rec({})])[0];
  const amb = extractKojiPoints([feat(130.40002, 33.59, { point_id: 1, u_current_years_price_ja: 100 }), feat(130.39998, 33.59, { point_id: 2, u_current_years_price_ja: 200 })]);
  assert.strictEqual(matchKoji(p, amb), null);
  const near = extractKojiPoints([feat(130.40001, 33.59, { point_id: 1, u_current_years_price_ja: 100 }), feat(130.4002, 33.59, { point_id: 2, u_current_years_price_ja: 200 })]);
  assert.strictEqual(matchKoji(p, near).price, 100);
});
test('全標準地への当てはめと集計', () => {
  const g = groupParcels([rec({ hikaku: 1, rosenka: 1, shueki: 1 }), rec({ hikaku: 1, rosenka: 1, shueki: 1 }), rec({ id: 'b', lon: 131, lat: 33, hikaku: 1 })]);
  const { parcels, matched } = attachKoji(g, extractKojiPoints([feat(130.4, 33.59, {})]));
  assert.strictEqual(matched, 1);
  assert.strictEqual(parcels[1].koji, null);
  assert.deepStrictEqual(fillParcels(parcels), { parcels: 2, records: 3, koji: 1, rosenka: 1, hikaku: 2, shueki: 1, all4: 1 });
});
test('XPT002 を取るタイルは標準地の位置があるものだけ（重複なし）', () => {
  const t = tilesOf([{ lon: 130.4, lat: 33.59 }, { lon: 130.4001, lat: 33.5901 }, { lon: 131.1, lat: 33.9 }], 13);
  assert.strictEqual(t.length, 2);
  assert.ok(t.every((e) => Number.isInteger(e.x) && Number.isInteger(e.y)));
});

test('XPT002 の価格は単位つきの文字列（3,100,000(円/㎡)）で返る。先頭の数を読む', () => {
  assert.strictEqual(numLead('3,100,000(円/㎡)'), 3100000);
  assert.strictEqual(numLead(2820000), 2820000);
  assert.strictEqual(numLead('7.6'), 7.6);
  assert.strictEqual(numLead(''), null); assert.strictEqual(numLead('-'), null); assert.strictEqual(numLead('0(円/㎡)'), null); assert.strictEqual(numLead(undefined), null);
  const k = extractKojiPoints([feat(130.4, 33.59, { u_current_years_price_ja: '3,100,000(円/㎡)', year_on_year_change_rate: '7.6' })]);
  assert.deepStrictEqual([k[0].price, k[0].change], [3100000, 7.6]);
});
test('地価区分: 0（地価公示）だけ使う。項目が無い時は除かない', () => {
  const k = extractKojiPoints([feat(130.4, 33.59, { point_id: 1, land_price_type: 0 }), feat(130.4, 33.59, { point_id: 2, land_price_type: 1 }), feat(130.4, 33.59, { point_id: 3, land_price_type: '1' })]);
  assert.deepStrictEqual(k.map((e) => e.id), ['1']);
  const f = feat(130.4, 33.59, { point_id: 9 }); delete f.properties.land_price_type;
  assert.strictEqual(extractKojiPoints([f]).length, 1);
});
test('診断: 項目名・地価区分の件数・価格を読めた件数を出す（値は出さない）', () => {
  const d = diagnoseXpt([feat(130.4, 33.59, {}), feat(130.4, 33.59, { point_id: 2, land_price_type: 1, u_current_years_price_ja: '' })]);
  assert.deepStrictEqual([d.features, d.points, d.priceReadable], [2, 2, 1]);
  assert.deepStrictEqual(d.typeCounts, { 0: 1, 1: 1 });
  assert.ok(d.keys.includes('u_current_years_price_ja') && d.missingKeys.length === 0);
  const e = diagnoseXpt([{ geometry: { type: 'Point' }, properties: { foo: 1 } }]);
  assert.ok(e.missingKeys.includes('u_current_years_price_ja') && e.priceReadable === 0);
  assert.deepStrictEqual(diagnoseXpt(undefined).keys, []);
});
