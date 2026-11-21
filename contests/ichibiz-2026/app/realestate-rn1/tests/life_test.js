// 実行: node --test contests/ichibiz-2026/app/realestate-rn1/tests/life_test.js
// 生活施設・物件（10件上限）・勤務先・通勤時間・施設までの距離（web/life.js）を、同梱データで検査する。ネットワーク不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Life = require('../web/life.js');
const DATA = path.join(__dirname, '../web/data');
const rd = (region, f) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, region, f), 'utf8')); } catch (e) { return null; } };
const layersOf = (region) => {
  const fac = rd(region, 'facilities.json');
  return Life.buildLayers(rd(region, 'amenities.json'), fac);
};

test('住所は最大10件: 11件目は追加されず、理由が返る', () => {
  const st = Life.empty();
  for (let i = 0; i < 10; i++) assert.ok(Life.addProp(st, { label: 'p' + i, lon: 134.55 + i * 0.001, lat: 34.07 }).ok);
  const r = Life.addProp(st, { label: 'p10', lon: 134.56, lat: 34.07 });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /10件/);
  assert.strictEqual(st.props.length, 10);
});

test('保存値の読み込み: 不正な位置は捨て、物件は10件・勤務先は2か所に切る。勤務先の位置（A・B）は保つ', () => {
  const props = Array.from({ length: 15 }, (_, i) => ({ label: 'x' + i, lon: 134.5, lat: 34.0 }));
  props.splice(3, 0, { lon: 'a', lat: 1 }, null, { lon: 0, lat: 0 });
  const s = Life.sanitize({ props, works: [null, { lon: 134.5, lat: 34.1, label: 'B' }, { lon: 134.5, lat: 34.1 }], speedKmh: 40 });
  assert.strictEqual(s.props.length, 10);
  assert.strictEqual(s.works.length, 2);
  assert.strictEqual(s.works[0], null);
  assert.strictEqual(s.works[1].label, 'B');
  assert.strictEqual(s.speedKmh, 40);
  assert.deepStrictEqual(Life.sanitize('壊れた'), Life.empty());
  assert.strictEqual(Life.sanitize({ speedKmh: 9999 }).speedKmh, Life.RAIL_SPEED_KMH);
});

test('国土地理院の住所検索の応答: 候補を読み取り、不正な応答は空', () => {
  const j = [{ geometry: { coordinates: [134.5547, 34.0701], type: 'Point' }, type: 'Feature', properties: { title: '徳島市役所' } }, { geometry: { coordinates: ['x', 1] }, properties: { title: '壊れ' } }, null];
  const c = Life.parseGsi(j);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].title, '徳島市役所');
  assert.deepStrictEqual(Life.parseGsi({}), []);
  assert.deepStrictEqual(Life.parseGsi(null), []);
});

test('通勤時間（徒歩）: 直線1000m → 1000×1.25÷80 = 約16分', () => {
  const a = { lon: 134.55, lat: 34.07 };
  const dLon = 1000 / (111320 * Math.cos((34.07 * Math.PI) / 180));
  const b = { lon: 134.55 + dLon, lat: 34.07 };
  const c = Life.commute(a, b, [], {});
  assert.ok(Math.abs(c.straightM - 1000) < 5, String(c.straightM));
  assert.strictEqual(c.walk, 16);
  assert.strictEqual(c.rail, null);
  assert.strictEqual(c.best.mode, 'walk');
});

test('通勤時間（鉄道＋徒歩）: 駅までの徒歩＋乗車（直線×1.2÷速度＋待ち）＋徒歩。速度を変えると乗車が変わる', () => {
  const lat = 34.07, per = (m) => m / (111320 * Math.cos((lat * Math.PI) / 180));
  const home = { lon: 134.5, lat }, st1 = [{ lon: 134.5 + per(400), lat, name: 'A駅' }, { lon: 134.5 + per(10400), lat, name: 'B駅' }];
  const work = { lon: 134.5 + per(10800), lat };
  const c = Life.commute(home, work, st1, { speedKmh: 30 });
  // 徒歩: round(400×1.25/80)=6、乗車: 10000×1.2÷1000÷30×60 + 5 = 24+5 = 29、徒歩 6
  assert.strictEqual(c.rail.walkFrom, 6);
  assert.strictEqual(c.rail.ride, 29);
  assert.strictEqual(c.rail.walkTo, 6);
  assert.strictEqual(c.rail.total, 41);
  assert.strictEqual(c.best.mode, 'rail'); // 徒歩は 10800×1.25÷80 = 169分
  assert.strictEqual(Life.commute(home, work, st1, { speedKmh: 60 }).rail.ride, 17);
  // 同じ駅が最寄りなら乗車なし
  const same = Life.commute(home, { lon: 134.5 + per(800), lat }, st1, {});
  assert.ok(same.rail.same); assert.strictEqual(same.rail.ride, 0);
  // 最寄駅が2000mを超えるときは鉄道を出さない
  assert.strictEqual(Life.commute({ lon: 134.5, lat: lat + 0.1 }, work, st1, {}).rail, null);
});

test('通勤時間の表: 物件×勤務先（10×2）', () => {
  const st = Life.empty();
  for (let i = 0; i < 10; i++) Life.addProp(st, { label: 'p' + i, lon: 134.5 + i * 0.002, lat: 34.07 });
  st.works = [{ label: 'A', lon: 134.55, lat: 34.07 }, { label: 'B', lon: 134.52, lat: 34.08 }];
  const t = Life.commuteTable(st, []);
  assert.strictEqual(t.length, 10);
  assert.ok(t.every((r) => r.length === 2 && r.every((c) => c.walk >= 1)));
});

for (const region of ['tokushima', 'tokyo23', 'osaka']) {
  test('生活施設の読み込み（' + region + '）: 種類ごとの件数・出典・名称・範囲', () => {
    const am = rd(region, 'amenities.json');
    assert.ok(am, 'amenities.json がある');
    assert.strictEqual(am.license, 'ODbL');
    assert.match(am.source, /OpenStreetMap/);
    const b = layersOf(region);
    for (const id of ['super', 'conv', 'station', 'nursery', 'kinder', 'elem', 'junior']) {
      assert.strictEqual(b.status[id], 'ok', id);
      assert.ok(b.layers[id].length > 0, region + ' ' + id + ' 0件');
    }
    const [w, s, e, n] = am.bbox;
    for (const id of ['super', 'conv', 'station']) for (const p of b.layers[id]) assert.ok(p.lon >= w - 0.02 && p.lon <= e + 0.02 && p.lat >= s - 0.02 && p.lat <= n + 0.02, id);
    // 学童は、見つかった件数だけ（0件なら empty として画面に「位置データが見つからない」と出る）
    assert.ok(['ok', 'empty'].includes(b.status.gakudo));
  });
}

test('最寄りの施設と距離（徳島駅付近）: 駅は徳島駅まで近く、距離は直線距離で昇順の最小', () => {
  const b = layersOf('tokushima');
  const n = Life.nearest(b.layers, 134.5513, 34.0745);
  assert.ok(n.station && n.station.m < 400, JSON.stringify(n.station));
  assert.match(n.station.name, /徳島/);
  for (const id of ['super', 'conv', 'elem', 'junior', 'nursery', 'kinder']) {
    assert.ok(n[id], id);
    const best = Math.min(...b.layers[id].map((p) => Life.dist(134.5513, 34.0745, p.lon, p.lat)));
    assert.ok(Math.abs(n[id].m - Math.round(best)) <= 1, id);
  }
});

test('施設の分類: 小学校・中学校は義務教育学校を両方に含み、保育園と幼稚園（認定こども園を含む）を分ける', () => {
  const fac = { schools: [{ kind: '小学校', name: 'a', lon: 1 + 134, lat: 34 }, { kind: '中学校', name: 'b', lon: 134, lat: 34 }, { kind: '義務教育学校', name: 'c', lon: 134, lat: 34 }], preschools: [{ kind: '保育所等', name: 'h', lon: 134, lat: 34 }, { kind: '幼稚園', name: 'y', lon: 134, lat: 34 }, { kind: '幼保連携型認定こども園', name: 'k', lon: 134, lat: 34 }], medical: [{ kind: '病院', name: 'x', lon: 134, lat: 34 }, { kind: '歯科診療所', name: 'd', lon: 134, lat: 34 }, { kind: '診療所', name: 'c', lon: 134, lat: 34 }] };
  const b = Life.buildLayers(null, fac);
  assert.strictEqual(b.layers.elem.length, 2); assert.strictEqual(b.layers.junior.length, 2);
  assert.strictEqual(b.layers.nursery.length, 1); assert.strictEqual(b.layers.kinder.length, 2);
  assert.strictEqual(b.layers.hospital.length, 1); assert.strictEqual(b.layers.clinic.length, 1); // 歯科は含めない
  assert.strictEqual(b.status.super, 'none'); // OSMが無ければ「データなし」
  assert.strictEqual(Life.nearest(b.layers, 134, 34, ['super']).super, null);
});

test('注意書き: 学区とは限らない・直線距離・登録漏れ・学童の位置データなし', () => {
  assert.match(Life.SCHOOL_NOTE, /学区.*とは限りません/);
  assert.match(Life.DISTANCE_NOTE, /直線距離/);
  assert.match(Life.OSM_NOTE, /登録漏れ/);
  assert.match(Life.GAKUDO_NOTE, /見つけられませんでした/);
});

test('画面に出典・ODbL・著作権リンクがある', () => {
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.match(html, /ODbL/);
  assert.match(html, /https:\/\/www\.openstreetmap\.org\/copyright/);
  assert.match(html, /msearch\.gsi\.go\.jp/);
});
