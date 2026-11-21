// 実行: node --test contests/ichibiz-2026/app/realestate-a4/tests/lib_test.js contests/ichibiz-2026/app/realestate-a4/tests/extract_test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { extractPoint, num, recordsOf, fill, indexOf, FIELDS } from '../tools/extract.mjs';

const rec = {
  '価格時点': '2025', '標準地番号　市区町村コード　県コード': '40', '標準地番号　市区町村コード　市区町村コード': '131',
  '標準地番号　地域名': '天神', '標準地番号　用途区分': '商業地', '標準地番号　連番': '3',
  '公示価格': '1000000', '路線価　年': '2025', '路線価　相続税路線価': '800000',
  '鑑定評価手法の適用 取引事例比較法比準価格': '1010000', '鑑定評価手法の適用 収益還元法 収益価格': '990000',
  '収益価格算定内訳還元利回り': '4.1', '位置座標　緯度': '33.59', '位置座標　経度': '130.4',
  '標準地　所在地　所在地番': '天神1丁目1番1', '標準地　法令上の規制等　用途地域': '商業地域', '標準地　法令上の規制等　指定建ぺい率': '80', '標準地　法令上の規制等　指定容積率': '800',
};

test('項目名の空白（半角・全角）の揺れを吸収して取り出す', () => {
  const p = extractPoint(rec);
  assert.strictEqual(p.price, 1000000);
  assert.strictEqual(p.rosenka, 800000);
  assert.strictEqual(p.hikaku, 1010000);
  assert.strictEqual(p.shueki, 990000);
  assert.strictEqual(p.rimawari, 4.1);
  assert.strictEqual(p.lon, 130.4);
  assert.strictEqual(p.use, '商業地');
  assert.strictEqual(p.id, '131-天神-商業地-3');
  assert.strictEqual(p.zone, '商業地域');
});
test('別名（旧想定の項目名・建蔽率の表記）でも取り出せる', () => {
  const old = { ...rec };
  delete old['位置座標　緯度']; delete old['位置座標　経度']; delete old['標準地　法令上の規制等　指定建ぺい率'];
  const p = extractPoint({ ...old, '緯度': '33.59', '経度': '130.4', '標準地　法令上の規制等　指定建蔽率': '80' });
  assert.strictEqual(p.lat, 33.59); assert.strictEqual(p.kenpei, 80);
});
test('値なし（空・ハイフン・0）は null', () => {
  assert.strictEqual(num(''), null); assert.strictEqual(num('-'), null); assert.strictEqual(num('0'), null); assert.strictEqual(num(undefined), null);
  assert.strictEqual(num('1,234'), 1234);
  const p = extractPoint({ ...rec, '鑑定評価手法の適用 収益還元法 収益価格': '0', '収益価格算定内訳還元利回り': '0' });
  assert.strictEqual(p.shueki, null); assert.strictEqual(p.rimawari, null);
});
test('位置が無い・日本の外・価格が全て空の件は除く', () => {
  assert.strictEqual(extractPoint({ ...rec, '位置座標　緯度': '' }), null);
  assert.strictEqual(extractPoint({ ...rec, '位置座標　緯度': '0.5' }), null);
  const none = { ...rec, '公示価格': '0', '路線価　相続税路線価': '', '鑑定評価手法の適用 取引事例比較法比準価格': '-', '鑑定評価手法の適用 収益還元法 収益価格': '0' };
  assert.strictEqual(extractPoint(none), null);
});
test('公示価格が空なら 1㎡当たりの価格で補う。用途が無ければ要求した用途名', () => {
  const r2 = { ...rec, '公示価格': '', '1㎡当たりの価格': '999', '標準地番号　用途区分': '' };
  const p = extractPoint(r2, '住宅地');
  assert.strictEqual(p.price, 999); assert.strictEqual(p.use, '住宅地');
});
test('応答は {data:[...]} でも配列でもよい。集計', () => {
  assert.strictEqual(recordsOf({ data: [1, 2] }).length, 2);
  assert.strictEqual(recordsOf([1]).length, 1);
  assert.strictEqual(recordsOf(null).length, 0);
  const f = fill([extractPoint(rec), extractPoint({ ...rec, '鑑定評価手法の適用 収益還元法 収益価格': '0' })]);
  assert.deepStrictEqual([f.total, f.price, f.shueki], [2, 2, 1]);
});
test('取り出すのは画面に要る項目だけ（生データの全量を持ち込まない）', () => {
  assert.ok(Object.keys(extractPoint(rec)).length <= 20);
  assert.ok(indexOf(rec).has(FIELDS.hikaku));
});
