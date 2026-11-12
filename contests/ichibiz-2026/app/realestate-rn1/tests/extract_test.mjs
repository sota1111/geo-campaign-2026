// 実行: node --test contests/ichibiz-2026/app/realestate-rn1/tests/
// API 応答の整形（tools/extract.mjs）を、小さな見本の応答で検査する。ネットワーク・APIキー不要。
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  meshCenter, roundRing, polysOf, extractPlan, extractMesh, extractSchools, extractPreschools, extractMedical, extractElderCare,
  extractSchoolDistricts, extractAreas, rasterize, tilesFor, POP_YEARS,
} from '../tools/extract.mjs';

const Lib = createRequire(import.meta.url)('../web/lib.js');
const sq = (x, y, s = 1) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const poly = (x, y, s) => ({ type: 'Polygon', coordinates: [sq(x, y, s)] });

test('地域メッシュコード: 実際の応答のポリゴン中心と一致する（徳島市の161区画で最大差0.00001度。2026-11-12 に確認）', () => {
  assert.deepStrictEqual(meshCenter('5134140223'), { lon: 134.53281, lat: 34.08646 });
  assert.deepStrictEqual(meshCenter('5134140123'), { lon: 134.52031, lat: 34.08646 });
  assert.strictEqual(meshCenter('123'), null);
  assert.strictEqual(meshCenter('5134140205'), null);
});

test('座標の丸めと連続する同一点の除去、4点未満の環の除去', () => {
  assert.deepStrictEqual(roundRing([[1.123456, 2.123456], [1.123457, 2.123458], [3, 4]], 5), [[1.12346, 2.12346], [3, 4]]);
  assert.deepStrictEqual(polysOf({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] }), []);
  assert.strictEqual(polysOf({ type: 'Point', coordinates: [0, 0] }).length, 0);
  assert.strictEqual(polysOf({ type: 'MultiPolygon', coordinates: [[sq(0, 0)], [sq(5, 5)]] }).length, 2);
});

test('XKT003: 区域コードごとにまとめ、最新の設定日・設定者を残す', () => {
  const f = (id, name, dd, g) => ({ properties: { city_code: '36201', city_name: '徳島市', kubun_id: id, kubun_name_ja: name, decision_date: dd, decision_maker: dd ? '徳島市' : '' }, geometry: g });
  const r = extractPlan([f(31, '居住誘導区域', '2024-04-01', poly(0, 0, 1)), f(31, '居住誘導区域', '', poly(5, 5, 1)), f(0, '立地適正化計画区域', '', poly(0, 0, 9)), { properties: null }, f('x', 'x', '', poly(0, 0, 1))]);
  assert.strictEqual(r.length, 2);
  const res = r.find((e) => e.id === 31);
  assert.strictEqual(res.polys.length, 2);
  assert.strictEqual(res.decided, '2024-04-01');
  assert.strictEqual(res.maker, '徳島市');
});

test('XKT013: メッシュで重複除去、年ごとの4値（総数・0〜14歳・65歳以上・75歳以上）、空欄は0、値が全く無いメッシュは捨てる', () => {
  assert.deepStrictEqual(POP_YEARS, [2025, 2035, 2050]);
  const p = (id, o) => ({ properties: Object.assign({ MESH_ID: id, SHICODE: '36201' }, o) });
  const full = { PT00_2025: 100.04, PTA_2025: 10, PTC_2025: 40, PTD_2025: 20, PT00_2035: 90, PTA_2035: 8, PTC_2035: 42, PTD_2035: 25, PT00_2050: 70, PTA_2050: 5, PTC_2050: 40, PTD_2050: 28 };
  const r = extractMesh([p('5134140223', full), p('5134140223', full), p('5134140123', { PT00_2025: '' }), p('5134140213', { PT00_2025: 5 })]);
  assert.strictEqual(r.length, 2);
  assert.deepStrictEqual(r[1].v.slice(0, 4), [100, 10, 40, 20]);
  assert.strictEqual(r[1].v.length, 12);
  assert.strictEqual(r.find((m) => m.id === '5134140213').v[1], 0);
});

test('施設: 学校は小・中・義務教育のみ、保育園等は休校を除く、医療は種別を残す、福祉は老人福祉施設（大分類02）のみ', () => {
  const pt = (props) => ({ properties: props, geometry: { type: 'Point', coordinates: [134.55, 34.07] } });
  assert.deepStrictEqual(extractSchools([pt({ P29_003_name_ja: '小学校', P29_004_ja: 'A小' }), pt({ P29_003_name_ja: '高等学校', P29_004_ja: 'B高' }), pt({ P29_003_name_ja: '中学校', P29_004_ja: '' })]).map((x) => x.name), ['A小']);
  assert.deepStrictEqual(extractPreschools([pt({ preSchoolName_ja: 'C園', schoolClassCode_name_ja: '幼稚園', closeSchoolCode: 0 }), pt({ preSchoolName_ja: 'D園', closeSchoolCode: 1 }), pt({ preSchoolName_ja: 'E所' })]).map((x) => x.kind + x.name), ['幼稚園C園', '保育所等E所']);
  assert.deepStrictEqual(extractMedical([pt({ P04_001_name_ja: '病院', P04_002_ja: 'F病院' })]).map((x) => x.kind), ['病院']);
  assert.deepStrictEqual(extractElderCare([pt({ P14_005: '02', P14_006_name_ja: '老人福祉センター', P14_008_ja: 'G' }), pt({ P14_005: '05', P14_008_ja: 'H' })]).map((x) => x.name), ['G']);
  assert.strictEqual(extractMedical([{ properties: { P04_002_ja: 'X' }, geometry: { type: 'Polygon', coordinates: [] } }]).length, 0);
});

test('XKT004: 学校コードで校区の多角形をまとめる', () => {
  const f = (code, name, g) => ({ properties: { A27_003: code, A27_004_ja: name, A27_001: '36201' }, geometry: g });
  const r = extractSchoolDistricts([f('B1', '内町小学校', poly(0, 0, 1)), f('B1', '内町小学校', poly(2, 2, 1)), f('B2', '八万小学校', poly(5, 5, 1))]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.find((e) => e.code === 'B1').polys.length, 2);
});

test('格子化: 多角形の内側のセルだけがオン、穴は抜ける、範囲外はオフ。Lib.inRaster と読み書きが一致する', () => {
  const bbox = [0, 0, 1, 1];
  const outer = sq(0.1, 0.1, 0.5), hole = sq(0.3, 0.3, 0.1);
  const r = rasterize([[outer, hole]], bbox, 0.01, 0.01);
  assert.strictEqual(r.w, 100);
  assert.strictEqual(r.polys, 1);
  const g = Lib.decodeRaster(r);
  assert.ok(Lib.inRaster(g, 0.15, 0.15));
  assert.ok(!Lib.inRaster(g, 0.35, 0.35));
  assert.ok(!Lib.inRaster(g, 0.8, 0.8));
  assert.ok(!Lib.inRaster(g, 0.05, 0.15));
  // セル数は面積の目安（0.5×0.5 − 0.1×0.1 = 0.24 → 2400セル）に近い
  assert.ok(Math.abs(r.cells - 2400) <= 60, String(r.cells));
  // 内外判定は多角形の判定と、格子の細かさの範囲で一致する
  let mism = 0, seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 500; i++) {
    const lon = rnd(), lat = rnd();
    if (Lib.inPolygon(lon, lat, [outer, hole]) !== Lib.inRaster(g, lon, lat)) mism++;
  }
  assert.ok(mism <= 25, String(mism));
});

test('多角形だけを残す関数とタイル範囲', () => {
  assert.strictEqual(extractAreas([{ geometry: poly(0, 0, 1) }, { geometry: { type: 'Point', coordinates: [0, 0] } }]).length, 1);
  const tileOf = (lon, lat, z) => ({ x: Math.floor(lon), y: Math.floor(-lat) });
  const t = tilesFor([0, -3, 2, 0], 13, tileOf);
  assert.strictEqual(t.length, 3 * 4);
});
