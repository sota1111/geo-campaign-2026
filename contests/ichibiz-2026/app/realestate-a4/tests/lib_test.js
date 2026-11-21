// 実行: node --test contests/ichibiz-2026/app/realestate-a4/tests/lib_test.js contests/ichibiz-2026/app/realestate-a4/tests/extract_test.mjs contests/ichibiz-2026/app/realestate-a4/tests/parcels_test.mjs
// 画面のロジック（web/lib.js）の単体テスト。ネットワーク・APIキー不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Lib = require('../web/lib.js');

const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sample.json'), 'utf8'));
const TENJIN = [130.3988, 33.5902];
const P = (o) => Object.assign({ id: 'x', lon: 130, lat: 33, use: '住宅地', n: 2, rosenka: [null, null], hikaku: [null, null], shueki: [null, null], rimawari: [null, null], koji: null }, o);
const rowOf = (p, key) => Lib.priceRows(p).find((r) => r.key === key);

test('距離順: 近い順に並び、件数で切る。1地点＝1件', () => {
  const r = Lib.nearest(sample.parcels, TENJIN[0], TENJIN[1], { n: 3 });
  assert.strictEqual(r.length, 3);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].distance <= r[i].distance);
  assert.deepStrictEqual(r.map((e) => e.parcel), [1, 2, 3]);
  assert.ok(r[0].distance < 5);
});
test('距離順: 用途で絞れる。同距離は id 順で安定。座標なし・空でも落ちない', () => {
  const r = Lib.nearest(sample.parcels, TENJIN[0], TENJIN[1], { n: 5, uses: ['商業地'] });
  assert.ok(r.length && r.every((e) => e.point.use === '商業地'));
  assert.deepStrictEqual(Lib.nearest([P({ id: 'b' }), P({ id: 'a' })], 130, 33).map((e) => e.point.id), ['a', 'b']);
  assert.deepStrictEqual(Lib.nearest([P({ lon: null })], 130, 33), []);
  assert.deepStrictEqual(Lib.nearest(undefined, 130, 33), []);
});
test('haversine: 既知の距離（緯度1度 ≒ 111km）', () => {
  assert.ok(Math.abs(Lib.haversine(130, 33, 130, 34) - 111195) < 300);
  assert.strictEqual(Lib.haversine(130, 33, 130, 33), 0);
});

test('価格の並べ方: 公示→路線価→取引事例→収益の順', () => {
  const rows = Lib.priceRows(sample.parcels[0]);
  assert.deepStrictEqual(rows.map((r) => r.key), ['koji', 'rosenka', 'hikaku', 'shueki']);
  assert.deepStrictEqual(rows.map((r) => r.label), ['公示価格', '相続税路線価', '取引事例比較法比準価格', '収益価格']);
  assert.strictEqual(rows[0].text, '100,000円/㎡');
});
test('公示価格: XPT002 の当年価格だけを出し、出典を添える', () => {
  const r = rowOf(P({ koji: { price: 1234000, lotNo: '福岡中央5-9' } }), 'koji');
  assert.strictEqual(r.text, '1,234,000円/㎡');
  assert.strictEqual(r.extra, '出典: 地価公示（不動産情報ライブラリ XPT002 の当年価格）');
  // 画面は XCT001 の「公示価格」「1㎡当たりの価格」を持たない（price があっても使わない）
  assert.strictEqual(rowOf(P({ price: 999999 }), 'koji').value, null);
});
test('突き合わせできない地点: 「公示価格: 照合できませんでした」', () => {
  const r = rowOf(P({ koji: null }), 'koji');
  assert.strictEqual(r.text, '照合できませんでした');
  assert.strictEqual(r.bar, 0);
  assert.ok(r.extra.includes('突き合わせできませんでした'));
  assert.ok(Lib.cardHtml({ point: P({ koji: null }), distance: 1 }, 1).includes('公示価格'));
});
test('鑑定評価書の記録2件: 値が違えば「A／B」、同じなら1つ', () => {
  const diff = rowOf(P({ hikaku: [7000000, 7050000] }), 'hikaku');
  assert.strictEqual(diff.text, '7,000,000／7,050,000円/㎡');
  assert.strictEqual(diff.extra, '鑑定評価書の記録2件（値が異なります）');
  assert.strictEqual(diff.value, 7050000);
  const same = rowOf(P({ hikaku: [7000000, 7000000] }), 'hikaku');
  assert.strictEqual(same.text, '7,000,000円/㎡');
  assert.strictEqual(same.extra, '鑑定評価書の記録2件（同じ値）');
});
test('鑑定評価書の記録: 片方だけ値がある・両方なし・記録1件', () => {
  const one = rowOf(P({ shueki: [null, 6000000] }), 'shueki');
  assert.strictEqual(one.text, '6,000,000円/㎡');
  assert.ok(one.extra.includes('2件のうち1件に値があります'));
  const none = rowOf(P({ shueki: [null, null] }), 'shueki');
  assert.deepStrictEqual([none.text, none.extra], ['データなし', Lib.MISSING_NOTE]);
  const single = rowOf(P({ n: 1, hikaku: [5000000] }), 'hikaku');
  assert.strictEqual(single.extra, '');
});
test('路線価は年を添える。収益価格は還元利回り（記録ごと。違えば並べる）', () => {
  assert.strictEqual(rowOf(P({ rosenka: [10, 10], rosenkaYear: '2024' }), 'rosenka').extra, '2024年分。鑑定評価書の記録2件（同じ値）');
  assert.strictEqual(rowOf(P({ shueki: [100, 100], rimawari: [3.2, 3.3] }), 'shueki').extra, '還元利回り 3.2%／3.3%。鑑定評価書の記録2件（同じ値）');
  assert.ok(rowOf(P({ shueki: [100, 100] }), 'shueki').extra.startsWith('還元利回り データなし'));
});
test('棒は最大（記録が複数なら高い方）を100とした割合', () => {
  const rows = Lib.priceRows(P({ koji: { price: 100 }, rosenka: [80, 80], hikaku: [150, 200], shueki: [null, null] }));
  assert.deepStrictEqual(rows.map((r) => r.bar), [50, 40, 100, 0]);
});
test('還元利回り: 割合は%に、%値はそのまま、空は出さない', () => {
  assert.strictEqual(Lib.rateText(0.045), '4.5%');
  assert.strictEqual(Lib.rateText(4.5), '4.5%');
  assert.strictEqual(Lib.rateText(0), null);
  assert.strictEqual(Lib.rateText(null), null);
});
test('4つそろう標準地だけに絞れる。カードにそろい具合を出す', () => {
  const full = (id, lon) => P({ id, lon, koji: { price: 1 }, rosenka: [1, 1], hikaku: [1, 1], shueki: [1, 1] });
  const pts = [full('a', 130), P({ id: 'b', lon: 130.0001, koji: { price: 1 }, rosenka: [null, null], hikaku: [1, 1], shueki: [1, 1] }), full('c', 130.01)];
  assert.deepStrictEqual(Lib.nearest(pts, 130.0001, 33).map((e) => e.point.id), ['b', 'a', 'c']);
  assert.deepStrictEqual(Lib.nearest(pts, 130.0001, 33, { complete: true }).map((e) => e.point.id), ['a', 'c']);
  assert.ok(Lib.cardHtml({ point: pts[0], distance: 1 }, 1).includes('4つの価格がそろっています'));
  assert.ok(Lib.cardHtml({ point: pts[1], distance: 1 }, 1).includes('4つのうち 1 つはデータなし・照合できず'));
  assert.strictEqual(Lib.hasAll(P({ koji: null, rosenka: [1], hikaku: [1], shueki: [1] })), false);
});
test('標準地番号: 公示のデータの番号があればそれ、無ければ作成者による表記', () => {
  assert.strictEqual(Lib.parcelNoLine(P({ id: '133-福岡中央-商業地-9', area: '福岡中央', use: '商業地', koji: { price: 1, lotNo: '福岡中央5-9' } })), '標準地番号: 福岡中央5-9');
  assert.strictEqual(Lib.parcelNoLine(P({ id: '133-福岡中央-商業地-9', area: '福岡中央', use: '商業地' })), '標準地番号（作成者による表記）: 福岡中央 商業地 9');
});
test('カードは1地点1枚で、記録2件の説明を添える（断定しない）', () => {
  const html = Lib.cardHtml({ point: P({ id: 'q', area: 'A', n: 2 }), distance: 100, parcel: 1 }, 1);
  assert.ok(html.includes('この標準地には鑑定評価書の記録が2件あります。地価公示では、1つの標準地を2人の鑑定評価員が評価する制度です（国土交通省）。'));
  assert.ok(!html.includes('2人分'));
  assert.ok(!Lib.cardHtml({ point: P({ n: 1 }), distance: 1 }, 1).includes('記録が1件'));
  assert.strictEqual((Lib.cardHtml({ point: P({}), distance: 1 }, 1).match(/<article/g) || []).length, 1);
});

test('規約の文言を固定: クレジット・出典・責任・併記', () => {
  assert.strictEqual(Lib.CREDIT, 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません');
  assert.strictEqual(Lib.ATTRIBUTION, '出典：国土交通省　不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）');
  assert.ok(Lib.PROCESSED.includes('国土交通省') && Lib.PROCESSED.includes('作成者が'));
  assert.ok(Lib.RESPONSIBILITY.includes('表示内容の責任は作成者が負います') && Lib.RESPONSIBILITY.includes('国が作成・監修したものではありません'));
  assert.strictEqual(Lib.NOTICE, '標準地の価格であり、あなたの土地の価格ではありません');
  assert.strictEqual(Lib.KOJI_SOURCE, '地価公示（不動産情報ライブラリ XPT002 の当年価格）');
});
test('禁止表現（査定・適正価格・相場より）が出ない。サービス名にライブラリ名を入れない', () => {
  const r = Lib.nearest(sample.parcels, TENJIN[0], TENJIN[1], { n: 5 });
  const all = r.map((e, i) => Lib.cardHtml(e, i + 1)).join('') + Lib.legendHtml() + Lib.summaryText(r) +
    [Lib.CREDIT, Lib.ATTRIBUTION, Lib.PROCESSED, Lib.RESPONSIBILITY, Lib.NOTICE].join('');
  assert.ok(Lib.cardHtml(r[0], 1).includes(Lib.NOTICE));
  for (const w of ['査定', '適正価格', '相場より', '割安', '割高']) assert.ok(!all.includes(w), w);
  for (const f of ['index.html', 'app.js']) {
    const t = fs.readFileSync(path.join(__dirname, '../web', f), 'utf8');
    for (const w of ['査定', '適正価格', '相場より']) assert.ok(!t.includes(w), f + ' ' + w);
  }
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(!/<title>[^<]*不動産情報ライブラリ/.test(html) && !/<h1>[^<]*不動産情報ライブラリ/.test(html));
});
test('HTMLエスケープ', () => {
  assert.ok(!Lib.cardHtml({ point: P({ id: '<x>', addr: '<script>alert(1)</script>' }), distance: 10 }, 1).includes('<script>'));
});
test('見出し文・読み込み案内: 地点とデータの件数を分ける', () => {
  assert.ok(Lib.summaryText([{ point: {}, distance: 5000 }]).includes('離れています'));
  assert.ok(!Lib.summaryText([{ point: {}, distance: 500 }]).includes('離れています'));
  assert.strictEqual(Lib.summaryText([]), '近くの標準地が見つかりませんでした。');
  assert.ok(Lib.summaryText([{ point: {}, distance: 1 }, { point: {}, distance: 2 }], { complete: true }).includes('近い順に 2 地点の標準地です（4つの価格がそろう標準地だけ）'));
  assert.strictEqual(Lib.loadedText({ pref: { name: '福岡県' }, parcels: [{ n: 2 }, { n: 2 }, { n: 1 }] }), '同梱データ: 福岡県 標準地 3 地点（鑑定評価書の記録 5 件）。');
  assert.strictEqual(Lib.distText(450), '450m');
  assert.strictEqual(Lib.distText(1500), '1.5km');
});
test('データ検証（version 2 の parcels だけ受け付ける）', () => {
  assert.ok(Lib.validate(sample));
  assert.strictEqual(Lib.validate({ version: 2, parcels: [] }), null);
  assert.strictEqual(Lib.validate({ points: [{}], fetchedAt: '2026-01-01' }), null);
  assert.strictEqual(Lib.validate(null), null);
  assert.strictEqual(sample.provisional, true);
});
test('実データ（web/data/fukuoka.json があれば）: 形式・座標・還元利回りの単位・重複なし', () => {
  const f = path.join(__dirname, '../web/data/fukuoka.json');
  if (!fs.existsSync(f)) return;
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(Lib.validate(d));
  assert.strictEqual(new Set(d.parcels.map((p) => p.id)).size, d.parcels.length);
  assert.ok(d.parcels.every((p) => p.lat > 32 && p.lat < 35 && p.lon > 129 && p.lon < 132));
  const r = d.parcels.flatMap((p) => p.rimawari).filter((v) => v !== null);
  assert.ok(r.length && r.every((v) => v >= 1 && v <= 15));
  assert.strictEqual(Lib.nearest(d.parcels, 130.3988, 33.5902).length, 5);
});
