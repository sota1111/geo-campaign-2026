// node --test tests/   （node 22）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib.js');
const lore = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lore.json'), 'utf8'));
const samples = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/samples.json'), 'utf8'));

const good = () => ({
  placeName: 'テスト地名（架空）', placeType: '旧地名', teller: '語り手Z（架空）', heardOn: '2026-11-11',
  story: 'テスト用の話（架空）', basis: '（架空）語り手Zの話', claimedKinds: ['洪水'], certainty: '不明',
  visibility: 'public', license: 'CC BY 4.0', lon: 132.49, lat: 34.48, checked: ['x']
});

test('distanceM: 同一点は0、緯度1度は約111km', () => {
  assert.strictEqual(L.distanceM(132, 34, 132, 34), 0);
  const d = L.distanceM(132, 34, 132, 35);
  assert.ok(d > 110500 && d < 111800, String(d));
});

test('kindsOf: 区切り表記を分解し、未知はその他にする', () => {
  assert.deepStrictEqual(L.kindsOf('洪水・土砂災害'), ['洪水', '土砂災害']);
  assert.deepStrictEqual(L.kindsOf('洪水・洪水'), ['洪水']);
  assert.deepStrictEqual(L.kindsOf('雪害'), ['その他']);
  assert.deepStrictEqual(L.kindsOf(''), []);
});

test('nearby: 半径内のみ・近い順', () => {
  const r = L.nearby(lore.items, 132.4950, 34.4785, 1000);
  assert.ok(r.length >= 1);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].dist <= r[i].dist);
  r.forEach((x) => assert.ok(x.dist <= 1000));
  assert.strictEqual(L.nearby(lore.items, 132.4950, 34.4785, 1).length, 0);
});

test('crossCheck: 種類が合えば clue、合わなければ none（危険度は返さない）', () => {
  const near = L.nearby(lore.items, 132.4950, 34.4785, 1000);
  const a = L.crossCheck(['洪水'], near);
  assert.strictEqual(a.level, 'clue');
  assert.ok(a.hits.length >= 1);
  const b = L.crossCheck(['地震'], near);
  assert.strictEqual(b.level, 'none');
  assert.deepStrictEqual(b.missingKinds, ['地震']);
  assert.ok(!('risk' in a) && !('score' in a));
});

test('サンプル地名: 5件すべて架空表記、s4/s5 は手がかりなし、s1〜s3 は手がかりあり', () => {
  const lv = {};
  samples.places.forEach((p) => {
    assert.ok(/架空/.test(p.name), p.name);
    assert.ok(/架空/.test(p.teller), p.teller);
    lv[p.id] = L.crossCheck(p.claimedKinds, L.nearby(lore.items, p.lon, p.lat, 1000)).level;
  });
  assert.deepStrictEqual(lv, { s1: 'clue', s2: 'clue', s3: 'clue', s4: 'none', s5: 'none' });
});

test('伝承碑データ: 実データの必須項目があり、写真URLを含まない', () => {
  assert.ok(lore.items.length >= 10);
  lore.items.forEach((it) => {
    assert.ok(/^\d{5}-\d{3}$/.test(it.id));
    assert.ok(it.name && it.kind && it.address);
    assert.ok(!('image' in it) && !('Image' in it));
    assert.ok(it.lon > 132.4 && it.lon < 132.56 && it.lat > 34.4 && it.lat < 34.55);
  });
});

test('validateRecord: 必須欠落・不正値を検出', () => {
  assert.deepStrictEqual(L.validateRecord(good()), []);
  assert.ok(L.validateRecord(Object.assign(good(), { placeName: ' ' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { story: '' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { basis: '' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { certainty: '確実' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { visibility: 'x' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { license: 'x' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { lon: '', lat: '' })).length === 1);
  assert.ok(L.validateRecord(Object.assign(good(), { lat: 99 })).length === 1);
});

test('createRecord: 新規は必ず未確認・サンプルでない、不正なら作らない', () => {
  const r = L.createRecord(good(), '2026-11-11T00:00:00.000Z');
  assert.ok(r.ok);
  assert.strictEqual(r.record.verified, false);
  assert.strictEqual(r.record.sample, false);
  assert.strictEqual(L.createRecord(Object.assign(good(), { story: '' }), 'x').ok, false);
  const anon = L.createRecord(Object.assign(good(), { teller: '' }), '2026-11-11T00:00:00.000Z');
  assert.strictEqual(anon.record.teller, '（匿名）');
  const ids = new Set([L.createRecord(good(), 't').record.id, L.createRecord(good(), 't').record.id]);
  assert.strictEqual(ids.size, 2);
});

test('公開条件: 未確認・非公開・利用不可・サンプルは公開分に入らない', () => {
  const base = L.createRecord(good(), '2026-11-11T00:00:00.000Z').record;
  assert.strictEqual(L.isPublishable(base), false);
  const v = L.setVerified(base, '確認役', 'now');
  assert.strictEqual(L.isPublishable(v), true);
  assert.strictEqual(L.isPublishable(Object.assign({}, v, { visibility: 'private' })), false);
  assert.strictEqual(L.isPublishable(Object.assign({}, v, { visibility: 'local' })), false);
  assert.strictEqual(L.isPublishable(Object.assign({}, v, { license: 'none' })), false);
  assert.strictEqual(L.isPublishable(Object.assign({}, v, { sample: true })), false);
  assert.strictEqual(base.verified, false, 'setVerified は元を変えない');
});

test('toGeoJSON: 公開分のみ／非公開は常に除外／座標は[lon,lat]', () => {
  const a = L.createRecord(good(), '2026-11-11T00:00:00.000Z').record;
  const b = L.setVerified(L.createRecord(good(), '2026-11-11T00:00:01.000Z').record, 'c', 'n');
  const c = Object.assign({}, b, { id: 'p', visibility: 'private' });
  const pub = L.toGeoJSON([a, b, c], { onlyPublishable: true });
  assert.strictEqual(pub.features.length, 1);
  assert.deepStrictEqual(pub.features[0].geometry.coordinates, [132.49, 34.48]);
  const all = L.toGeoJSON([a, b, c], {});
  assert.strictEqual(all.features.length, 2);
  assert.strictEqual(all.type, 'FeatureCollection');
  assert.ok(JSON.parse(JSON.stringify(all)).features[0].properties.placeName);
});

test('fmtDist', () => {
  assert.strictEqual(L.fmtDist(432), '430 m');
  assert.strictEqual(L.fmtDist(1500), '1.5 km');
});
