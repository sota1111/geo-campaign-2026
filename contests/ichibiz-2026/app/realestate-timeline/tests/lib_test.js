const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../web/lib.js');

const dir = path.join(__dirname, '../web/data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const D = L.validate(read('price-districts.json'), read('rent.json'), read('districts.json'));

test('実データが検証を通り、23区・935地区（取引のある860地区）・18年・4調査年', () => {
  assert.ok(D);
  assert.equal(D.wards.length, 23);
  assert.equal(D.districts.length, 935);
  assert.equal(D.districts.filter((d) => d.pname).length, 860);
  assert.equal(D.price.years[0], 2009);
  assert.equal(D.price.years.at(-1), 2026);
  assert.equal(D.price.plans.length, 5);
  assert.deepEqual(D.rent.years, ['2008', '2013', '2018', '2023']);
  assert.equal(D.price.filter.lowN, 10);
  assert.equal(D.price.filter.minN, 3);
});

test('地区名の突き合わせ率が境界ファイルの記載どおり', () => {
  const m = D.geo.match;
  assert.equal(m.priceDistricts, 860);
  assert.equal(m.matched, 860);
  assert.equal(m.unmatched, 0);
  assert.equal(m.boundaryWithoutPrice, 75);
  let n = 0;
  for (const d of D.districts) if (d.pname) { assert.ok(D.price.districts[d.code][d.pname], d.key); n++; }
  assert.equal(n, 860);
  let priceNames = 0; for (const c in D.price.districts) priceNames += Object.keys(D.price.districts[c]).length;
  assert.equal(priceNames, 860);
});

test('色の階級: 境界は上の階級に入る。値なしは -1', () => {
  const b = L.MODES.price.breaks;
  assert.equal(L.classOf(39.9, b), 0);
  assert.equal(L.classOf(40, b), 1);
  assert.equal(L.classOf(170, b), 6);
  assert.equal(L.classOf(null, b), -1);
  assert.equal(L.PALETTE.length, b.length + 1);
  assert.equal(L.classLabel(0, b), '40未満');
  assert.equal(L.classLabel(6, b), '170以上');
});

test('家賃の調査年: その年の末までの最新の調査', () => {
  const ys = ['2008', '2013', '2018', '2023'];
  assert.equal(L.surveyYearFor(2007, ys), null);
  assert.equal(L.surveyYearFor(2009, ys), '2008');
  assert.equal(L.surveyYearFor(2013, ys), '2013');
  assert.equal(L.surveyYearFor(2026, ys), '2023');
  assert.equal(L.rentAt(D.rent, '13103', 2026).year, '2023');
  assert.equal(L.rentAt(D.rent, '13103', 2009).year, '2008');
});

test('窓の表示: 最初は公開開始の四半期から、最後は6月まで', () => {
  assert.equal(L.windowLabel(D.price, 0), '2005年第3四半期〜2009年');
  assert.equal(L.windowLabel(D.price, 1), '2006年〜2010年');
  assert.equal(L.windowLabel(D.price, 17), '2022年〜2026年6月');
});

test('地区のセル: 件数で none / few / low / ok に分かれ、値は few では出さない', () => {
  const x = (() => { const d = D.byKey.get('13104|西新宿'); return L.districtCell(D.price, d.code, d.pname, 0, 17); })();
  assert.deepEqual({ n: x.n, v: x.value, s: x.state }, { n: 432, v: 130, s: 'ok' });
  assert.equal(L.districtCell(D.price, '13104', null, 0, 17).state, 'none'); // 取引のない町名
  const counts = { ok: 0, low: 0, few: 0, none: 0 };
  for (const pi of [1, 2, 3, 4]) for (const d of D.districts) for (let y = 0; y < 18; y++) {
    const c = L.districtCell(D.price, d.code, d.pname, pi, y);
    counts[c.state]++;
    if (c.state === 'none') assert.equal(c.n, 0);
    if (c.state === 'few') { assert.ok(c.n >= 1 && c.n < 3); assert.equal(c.value, null); assert.equal(c.cls, -1); }
    if (c.state === 'low') { assert.ok(c.n >= 3 && c.n < 10); assert.ok(c.value > 0); assert.equal(c.low, true); }
    if (c.state === 'ok') { assert.ok(c.n >= 10); assert.ok(c.value > 0); }
  }
  assert.deepEqual(counts, { ok: 29676, low: 17085, few: 7163, none: 13396 }); // 4つの間取り区分 × 935地区 × 18年 = 67,320セル
});

test('間取りごとの件数: 4区分の合計は「すべて」を超えない（間取り不明・特殊は「すべて」だけ）', () => {
  for (const d of D.districts.filter((x) => x.pname)) for (let y = 0; y < 18; y++) {
    const all = L.districtCell(D.price, d.code, d.pname, 0, y).n;
    let sum = 0; for (let pi = 1; pi <= 4; pi++) sum += L.districtCell(D.price, d.code, d.pname, pi, y).n;
    assert.ok(sum <= all, d.key + y);
  }
});

test('区のセル・順位・状態の数', () => {
  const w = L.wardCell(D.price, '13103', 0, 17);
  assert.ok(w.n > 1000 && w.unit > 100 && w.state === 'ok');
  const r = L.ranking(D, 0, 17);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].value >= r[i].value);
  assert.ok(r.every((x) => x.state === 'ok'));
  const c = L.stateCounts(D, 0, 17);
  assert.equal(c.ok + c.low + c.few + c.none, 935);
  assert.equal(L.wardRanking(D, 17).length, 23);
  assert.equal(L.cellFor('rent', D, D.wardByCode.get('13103'), 0, 17).year, '2023');
});

test('詳細（四分位）: 区ごとのファイルが地図用の地区一覧と整合する', () => {
  const det = read('detail/13104.json');
  assert.equal(det.code, '13104');
  const x = L.detailAt(det, '西新宿', 0, 17);
  assert.ok(x.p25 < 130 && 130 < x.p75);
  assert.equal(x.area, 25);
  for (const code of D.wards.map((w) => w.code)) {
    const f = read('detail/' + code + '.json');
    assert.deepEqual(Object.keys(f.districts).sort(), Object.keys(D.price.districts[code]).sort());
  }
});

test('境界: 地区と区が見つかり、海の上は無し。代表点は自分の区の中にある', () => {
  assert.equal(L.districtAt(D, 139.6948, 35.6896)?.key, '13104|西新宿'); // 新宿駅の西
  assert.equal(L.wardAt(D, 139.7454, 35.6586)?.name, '港区');           // 東京タワー付近
  assert.equal(L.districtAt(D, 139.9, 35.55), null);
  assert.equal(L.wardAt(D, 139.9, 35.55), null);
  for (const d of D.districts) assert.equal(L.wardAt(D, d.lp.lon, d.lp.lat)?.code, d.code, d.key);
  const ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(L.pointInRings(5, 5, [ring, hole]), false); // 穴の中は外
  assert.equal(L.pointInRings(2, 2, [ring, hole]), true);
});

test('グラフの座標: null で線が切れる。帯は閉じる', () => {
  assert.equal(L.linePath([{ x: 0, y: 1 }, null, { x: 2, y: 3 }]), 'M0.0 1.0M2.0 3.0');
  const top = [{ x: 0, y: 0 }, { x: 1, y: 0 }], bot = [{ x: 0, y: 2 }, { x: 1, y: 2 }];
  assert.match(L.bandPath(top, bot), /Z$/);
  assert.deepEqual(L.niceTicks(0, 100, 4), [0, 25, 50, 75, 100]);
});

test('文言: 件数が少ない・データなし・禁止語を使わない', () => {
  assert.match(L.cellText('price', '西新宿', { value: 130, n: 432, low: false, state: 'ok' }, D.price), /130万円\/㎡（432件）/);
  assert.match(L.cellText('price', 'x', { value: null, n: 2, state: 'few' }, D.price), /データなし（2件のみ。3件未満は中央値を出さない）/);
  assert.match(L.cellText('price', 'x', { value: null, n: 0, state: 'none' }, D.price), /データなし（0件）/);
  assert.match(L.lowText(7, 10), /件数が少ない（7件。10件未満）/);
  const texts = [L.NOTICE, L.PROCESSED, L.RESPONSIBILITY, L.ATTRIBUTION_RENT, L.ATTRIBUTION_BOUNDARY].join('');
  assert.ok(!/査定|適正価格/.test(texts));
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(!/<title>[^<]*不動産情報ライブラリ/.test(html) && !/<h1>[^<]*不動産情報ライブラリ/.test(html));
  assert.ok(!/査定|適正価格/.test(html));
  const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  assert.ok(!/査定|適正価格/.test(app));
});

test('利用規約の文言（クレジット）が変わっていない。境界の出典に e-Stat と加工の旨', () => {
  assert.equal(L.CREDIT, 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません');
  assert.equal(L.CREDIT_ESTAT, 'このサービスは、統計ダッシュボードのAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません');
  assert.match(L.ATTRIBUTION_BOUNDARY, /政府統計の総合窓口\(e-Stat\)（https:\/\/www\.e-stat\.go\.jp\/）/);
  assert.match(L.ATTRIBUTION_BOUNDARY, /加工して作成/);
});

test('データの大きさ: ブラウザで重くならない範囲（初回読み込み1MB未満、区ごとの詳細は100KB未満）', () => {
  const size = (f) => fs.statSync(path.join(dir, f)).size;
  const first = size('price-districts.json') + size('districts.json') + size('rent.json');
  assert.ok(first < 1024 * 1024, 'first ' + first);
  for (const w of D.wards) assert.ok(size('detail/' + w.code + '.json') < 100 * 1024, w.code);
});
