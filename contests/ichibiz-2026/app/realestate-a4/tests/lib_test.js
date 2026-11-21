// 実行: node --test contests/ichibiz-2026/app/realestate-a4/tests/
// 画面のロジック（web/lib.js）の単体テスト。ネットワーク・APIキー不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Lib = require('../web/lib.js');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample.json'), 'utf8'));
const TENJIN = [130.3988, 33.5902];

test('距離順: 近い順に並び、件数で切る', () => {
  const r = Lib.nearest(sample.points, TENJIN[0], TENJIN[1], { n: 3 });
  assert.strictEqual(r.length, 3);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].distance <= r[i].distance);
  assert.strictEqual(r[0].point.area, '仮データA');
  assert.ok(r[0].distance < 5);
});
test('距離順: 用途で絞れる。同距離は id 順で安定', () => {
  const r = Lib.nearest(sample.points, TENJIN[0], TENJIN[1], { n: 5, uses: ['商業地'] });
  assert.ok(r.length && r.every((e) => e.point.use === '商業地'));
  const same = [{ id: 'b', lon: 130, lat: 33, use: '住宅地' }, { id: 'a', lon: 130, lat: 33, use: '住宅地' }];
  assert.deepStrictEqual(Lib.nearest(same, 130, 33).map((e) => e.point.id), ['a', 'b']);
});
test('距離順: 座標が無い点は除く。空配列でも落ちない', () => {
  assert.deepStrictEqual(Lib.nearest([{ id: 'x', lon: null, lat: 33 }], 130, 33), []);
  assert.deepStrictEqual(Lib.nearest(undefined, 130, 33), []);
});
test('haversine: 既知の距離（緯度1度 ≒ 111km）', () => {
  const d = Lib.haversine(130, 33, 130, 34);
  assert.ok(Math.abs(d - 111195) < 300, String(d));
  assert.strictEqual(Lib.haversine(130, 33, 130, 33), 0);
});

test('価格の並べ方: 公示→路線価→取引事例→収益の順で、同じ単位', () => {
  const rows = Lib.priceRows(sample.points[0]);
  assert.deepStrictEqual(rows.map((r) => r.key), ['price', 'rosenka', 'hikaku', 'shueki']);
  assert.deepStrictEqual(rows.map((r) => r.label), ['公示価格', '相続税路線価', '取引事例比較法比準価格', '収益価格']);
  assert.ok(rows.every((r) => r.text.endsWith('円/㎡')));
  assert.strictEqual(rows[0].text, '100,000円/㎡');
});
test('価格の並べ方: 棒は最大を100とした割合', () => {
  const rows = Lib.priceRows({ price: 100, rosenka: 80, hikaku: 200, shueki: null });
  assert.deepStrictEqual(rows.map((r) => r.bar), [50, 40, 100, 0]);
});
test('空値: 行は残し「データなし」。0・負・文字列は値なし扱い', () => {
  const rows = Lib.priceRows({ price: 100, rosenka: null, hikaku: 0, shueki: '123' });
  assert.strictEqual(rows.length, 4);
  assert.deepStrictEqual(rows.map((r) => r.text), ['100円/㎡', 'データなし', 'データなし', 'データなし']);
  const none = Lib.priceRows({});
  assert.ok(none.every((r) => r.text === 'データなし' && r.bar === 0));
});
test('還元利回り: 割合は%に、%値はそのまま、空は出さない', () => {
  assert.strictEqual(Lib.rateText(0.045), '4.5%');
  assert.strictEqual(Lib.rateText(4.5), '4.5%');
  assert.strictEqual(Lib.rateText(0), null);
  assert.strictEqual(Lib.rateText(null), null);
  const r = Lib.priceRows({ price: 1, shueki: 100, rimawari: 0.045 });
  assert.strictEqual(r[3].extra, '還元利回り 4.5%');
  assert.strictEqual(Lib.priceRows({ price: 1, shueki: 100 })[3].extra, '還元利回り データなし');
  assert.strictEqual(Lib.priceRows({ price: 1 })[3].extra, Lib.MISSING_NOTE);
});
test('値が無い行には、国のデータに記載が無い旨を添える（原因は断定しない）', () => {
  const rows = Lib.priceRows({ price: 100 });
  assert.ok(rows.slice(1).every((r) => r.extra === '国のデータにこの標準地の値の記載がありません'));
  assert.strictEqual(rows[0].extra, '');
});
test('4つそろう標準地だけに絞れる。カードにそろい具合を出す', () => {
  const pts = [
    { id: 'a', lon: 130, lat: 33, use: '住宅地', price: 1, rosenka: 1, hikaku: 1, shueki: 1 },
    { id: 'b', lon: 130.0001, lat: 33, use: '住宅地', price: 1, rosenka: null, hikaku: 1, shueki: 1 },
    { id: 'c', lon: 130.01, lat: 33, use: '住宅地', price: 1, rosenka: 1, hikaku: 1, shueki: 1 },
  ];
  assert.deepStrictEqual(Lib.nearest(pts, 130.0001, 33).map((e) => e.point.id), ['b', 'a', 'c']);
  assert.deepStrictEqual(Lib.nearest(pts, 130.0001, 33, { complete: true }).map((e) => e.point.id), ['a', 'c']);
  assert.ok(Lib.cardHtml({ point: pts[0], distance: 1 }, 1).includes('4つの価格がそろっています'));
  assert.ok(Lib.cardHtml({ point: pts[1], distance: 1 }, 1).includes('4つのうち 1 つはデータなし'));
});
test('実データ（web/data/fukuoka.json があれば）: 形式・座標・還元利回りの単位', () => {
  const f = path.join(__dirname, '../web/data/fukuoka.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(Lib.validate(d));
  assert.ok(d.points.every((p) => p.lat > 32 && p.lat < 35 && p.lon > 129 && p.lon < 132), '福岡県の範囲の10進度');
  const r = d.points.filter((p) => p.rimawari !== null).map((p) => p.rimawari);
  assert.ok(r.length && r.every((v) => v >= 1 && v <= 15), '還元利回りは%の値');
  assert.match(Lib.rateText(r[0]), /^\d+(\.\d+)?%$/);
  const near = Lib.nearest(d.points, 130.3988, 33.5902);
  assert.strictEqual(new Set(near.map((e) => e.point.id)).size, 5);
  assert.ok(near.length >= 5 && near.length <= 10);
});
test('路線価は年を添える', () => {
  assert.strictEqual(Lib.priceRows({ rosenka: 10, rosenkaYear: '2025' })[1].extra, '2025年分');
});

test('規約の文言を固定: クレジット・出典・責任・併記', () => {
  assert.strictEqual(Lib.CREDIT, 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません');
  assert.strictEqual(Lib.ATTRIBUTION, '出典：国土交通省　不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）');
  assert.ok(Lib.PROCESSED.includes('国土交通省') && Lib.PROCESSED.includes('作成者が'));
  assert.ok(Lib.RESPONSIBILITY.includes('表示内容の責任は作成者が負います') && Lib.RESPONSIBILITY.includes('国が作成・監修したものではありません'));
  assert.strictEqual(Lib.NOTICE, '標準地の価格であり、あなたの土地の価格ではありません');
});
test('カードに併記が入り、禁止表現（査定・適正価格・相場より）が出ない', () => {
  const r = Lib.nearest(sample.points, TENJIN[0], TENJIN[1], { n: 5 });
  const all = r.map((e, i) => Lib.cardHtml(e, i + 1)).join('') + Lib.legendHtml() + Lib.summaryText(r) +
    [Lib.CREDIT, Lib.ATTRIBUTION, Lib.PROCESSED, Lib.RESPONSIBILITY, Lib.NOTICE].join('');
  assert.ok(Lib.cardHtml(r[0], 1).includes(Lib.NOTICE));
  for (const w of ['査定', '適正価格', '相場より', '割安', '割高']) assert.ok(!all.includes(w), w);
  for (const f of ['index.html', 'app.js']) {
    const t = fs.readFileSync(path.join(__dirname, '../web', f), 'utf8');
    for (const w of ['査定', '適正価格', '相場より']) assert.ok(!t.includes(w), f + ' ' + w);
  }
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(!/<title>[^<]*不動産情報ライブラリ/.test(html) && !/<h1>[^<]*不動産情報ライブラリ/.test(html), 'サービス名に同ライブラリ名を入れない');
});
test('HTMLエスケープ', () => {
  const html = Lib.cardHtml({ point: { id: '<x>', lon: 1, lat: 1, addr: '<script>alert(1)</script>', price: 1 }, distance: 10 }, 1);
  assert.ok(!html.includes('<script>'));
});
test('近くに標準地が無い時の注意', () => {
  assert.ok(Lib.summaryText([{ point: {}, distance: 5000 }]).includes('離れています'));
  assert.ok(!Lib.summaryText([{ point: {}, distance: 500 }]).includes('離れています'));
  assert.strictEqual(Lib.summaryText([]), '近くの標準地が見つかりませんでした。');
  assert.strictEqual(Lib.loadedText({ pref: { name: '福岡県' }, points: [{ id: 'a' }, { id: 'a' }, { id: 'b' }] }), '同梱データ: 福岡県 標準地 2 地点（データ 3 件）。');
  assert.ok(Lib.legendHtml().includes('最も高い価格を100%とした長さ'));
  assert.strictEqual(Lib.distText(450), '450m');
  assert.strictEqual(Lib.distText(1500), '1.5km');
});
test('同じ標準地番号のレコードは続けて返し、標準地の数（番号の数）で件数を切る', () => {
  const mk = (id, lon, v) => ({ id, lon, lat: 33, use: '商業地', area: '福岡中央', price: v, rosenka: 1, hikaku: 1, shueki: 1 });
  const pts = [mk('133-福岡中央-商業地-9', 130.0001, 1), mk('133-福岡中央-商業地-9', 130.0001, 2), mk('133-福岡中央-商業地-1', 130.001, 3), mk('133-福岡中央-商業地-2', 130.01, 4)];
  const r = Lib.nearest(pts, 130, 33, { n: 2 });
  assert.deepStrictEqual(r.map((e) => [e.parcel, e.part, e.parts]), [[1, 1, 2], [1, 2, 2], [2, 1, 1]]);
  assert.strictEqual(Lib.parcelNo(pts[0]), '福岡中央 商業地 9');
  const h = Lib.cardHtml(r[1], 2);
  assert.ok(h.includes('標準地番号（作成者による表記）: 福岡中央 商業地 9') && h.includes('同じ標準地番号のデータ 2 件中の 2 件目'));
  assert.ok(!Lib.cardHtml(r[2], 3).includes('件中の'));
  assert.ok(Lib.summaryText(r).includes('近い順に 2 地点の標準地です') && Lib.summaryText(r).includes('データは 3 件') && Lib.summaryText(r, { complete: true }).includes('4つの価格がそろう標準地だけ'));
});
test('データ検証', () => {
  assert.ok(Lib.validate(sample));
  assert.strictEqual(Lib.validate({ points: [] }), null);
  assert.strictEqual(Lib.validate({ points: [{}], fetchedAt: 'x' }), null);
  assert.strictEqual(Lib.validate(null), null);
});
test('仮データは明示されている', () => { assert.strictEqual(sample.provisional, true); });
