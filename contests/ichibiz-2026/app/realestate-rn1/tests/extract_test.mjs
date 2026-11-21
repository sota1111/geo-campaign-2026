// 実行: node --test contests/ichibiz-2026/app/realestate-rn1/tests/
// API 応答の整形（tools/extract.mjs）を、小さな見本の応答で検査する。ネットワーク・APIキー不要。
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  meshCenter, roundRing, polysOf, extractPlan, extractMesh, extractSchools, extractPreschools, extractMedical, extractElderCare,
  extractSchoolDistricts, extractAreas, rasterize, tilesFor, POP_YEARS,
  rasterizeLevels, rleEncode, extractFloodLevels, extractLeveledByLabel, extractLiquefaction, FLOOD_RANKS,
  extractZoning, extractAreaClass, countByCity, makeMask, clipPoints, clipPolys, LevelRaster, inCodes,
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

test('区分つき格子: 連長符号化の往復、重なる所は大きい区分、洪水ランク・津波ラベル・液状化の区分', () => {
  const a = new Uint8Array(1000); a.fill(2, 10, 700); a[999] = 255;
  const back = Lib.rleDecode(rleEncode(a), 1000);
  assert.deepStrictEqual([...back], [...a]);
  assert.strictEqual(Lib.rleDecode(rleEncode(a), 999), null);
  const fl = extractFloodLevels([
    { properties: { A31a_205: 2 }, geometry: poly(0.1, 0.1, 0.5) },
    { properties: { A31a_205: 4 }, geometry: poly(0.3, 0.3, 0.5) },
    { properties: { A31a_205: 9 }, geometry: poly(0.9, 0.9, 0.05) },
  ], 5);
  assert.strictEqual(fl.labels[4], FLOOD_RANKS[4]);
  assert.strictEqual(fl.labels[7], '浸水深の区分なし');
  const r = Lib.decodeRaster(rasterizeLevels(fl.items, [0, 0, 1, 1], fl.labels, 0.01, 0.01));
  assert.strictEqual(Lib.levelAt(r, 0.15, 0.15), 2);
  assert.strictEqual(Lib.levelAt(r, 0.5, 0.5), 4);
  assert.strictEqual(Lib.levelAt(r, 0.925, 0.925), 7);
  assert.strictEqual(Lib.levelAt(r, 0.05, 0.05), 0);
  const ts = extractLeveledByLabel([
    { properties: { A40_003: '10m以上 ～ 20m未満' }, geometry: poly(0, 0, 1) },
    { properties: { A40_003: '2m以上 ～ 3m未満' }, geometry: poly(2, 2, 1) },
    { properties: {}, geometry: poly(5, 5, 1) },
  ], (p) => p.A40_003);
  assert.deepStrictEqual(ts.labels, { 1: '2m以上〜3m未満', 2: '10m以上〜20m未満' });
  assert.strictEqual(ts.items.length, 2);
  const sg = extractLeveledByLabel([{ properties: { A: '0.3m以上0.5m未満' }, geometry: poly(0, 0, 1) }, { properties: { A: '0.3m未満' }, geometry: poly(2, 2, 1) }, { properties: { A: '1m以上3m未満' }, geometry: poly(4, 4, 1) }], (p) => p.A);
  assert.deepStrictEqual(Object.values(sg.labels), ['0.3m未満', '0.3m以上0.5m未満', '1m以上3m未満']);
  const lq = extractLiquefaction([{ properties: { liquefaction_tendency_level: 3, note: 'やや液状化しやすい' }, geometry: poly(0, 0, 1) }, { properties: { note: 'x' }, geometry: poly(2, 2, 1) }]);
  assert.deepStrictEqual(lq.labels, { 3: 'やや液状化しやすい' });
  assert.strictEqual(lq.items.length, 1);
});

// ---- 東京23区・大阪市の追加分 ----
test('XKT002 用途地域: 地域の市区町村コードだけ残し、市区町村・用途・容積率・建蔽率ごとにまとめる', () => {
  const z = (code, name, far, bcr, g) => ({ properties: { city_code: code, city_name: code === '13101' ? '千代田区' : '他', use_area_ja: name, youto_id: 10, u_floor_area_ratio_ja: far, u_building_coverage_ratio_ja: bcr }, geometry: g });
  const r = extractZoning([z('13101', '商業地域', '600%', '80%', poly(0, 0, 1)), z('13101', '商業地域', '600%', '80%', poly(5, 5, 1)), z('13101', '商業地域', '400%', '80%', poly(9, 9, 1)), z('14130', '商業地域', '600%', '80%', poly(0, 0, 1)), { properties: { city_code: '13101', use_area_ja: '' }, geometry: poly(0, 0, 1) }], ['13101', '13102']);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r.find((e) => e.far === '600%').polys.length, 2);
  assert.strictEqual(r[0].city, '千代田区');
  assert.strictEqual(extractZoning([z('14130', 'x', '', '', poly(0, 0, 1))], ['13101']).length, 0);
  assert.strictEqual(extractZoning([z('14130', 'x', '', '', poly(0, 0, 1))]).length, 1); // codes なしは絞らない
});

test('XKT001 区域区分: 区分名ごとにまとめ、地域外は除く', () => {
  const a = (code, id, name, g) => ({ properties: { city_code: code, city_name: 'c', kubun_id: id, area_classification_ja: name }, geometry: g });
  const r = extractAreaClass([a('27100', 21, '都市計画区域', poly(0, 0, 1)), a('27100', 21, '都市計画区域', poly(3, 3, 1)), a('27100', 22, '市街化区域', poly(0, 0, 1)), a('28202', 21, '都市計画区域', poly(0, 0, 1))], ['27100']);
  assert.deepStrictEqual(r.map((e) => [e.id, e.name, e.polys.length]), [[21, '都市計画区域', 2], [22, '市街化区域', 1]]);
});

test('countByCity: XKT003 の応答を市区町村ごとに数える（取得結果の記録用）', () => {
  assert.deepStrictEqual(countByCity([{ properties: { city_code: '27140', city_name: '堺市' } }, { properties: { city_code: '27140', city_name: '堺市' } }, { properties: null }, { properties: { city_code: '27203', city_name: '豊中市' } }]), { '27140 堺市': 2, '27203 豊中市': 1 });
  assert.deepStrictEqual(countByCity([]), {});
});

test('福祉施設: codes を渡すと、自治体コード（P14_003）が地域内のものだけ残る（隣の自治体・コードが県だけのものは入れない）', () => {
  const pt = (c) => ({ properties: { P14_005: '02', P14_006_name_ja: '老人福祉センター', P14_008_ja: 'N' + c, P14_003: c }, geometry: { type: 'Point', coordinates: [135.5, 34.7] } });
  const rows = [pt('27127'), pt('27000'), pt('27203'), pt('')];
  assert.deepStrictEqual(extractElderCare(rows, ['27100', '27127']).map((x) => x.name), ['N27127']);
  assert.strictEqual(extractElderCare(rows).length, 4);
  assert.ok(inCodes(['13101'], '13101') && !inCodes(['13101'], '1310'));
});

test('地域の内側（mask）: 点・多角形を地域の外から除く。境界の隣のセルは内側に数える', () => {
  const m = makeMask([[sq(0, 0, 1)]], [0, 0, 2, 2], 0.01, 0.01);
  assert.ok(m.has(0.5, 0.5) && !m.has(1.5, 1.5));
  assert.strictEqual(m.cells, 100 * 100); // 1度×1度を 0.01度の格子で数える
  assert.ok(m.near(1.005, 0.5) && !m.near(1.5, 0.5)); // 境界の1セル外は内側扱い
  assert.deepStrictEqual(clipPoints([{ lon: 0.5, lat: 0.5 }, { lon: 1.5, lat: 1.5 }], m).length, 1);
  assert.strictEqual(clipPolys([[sq(0.2, 0.2, 0.3)], [sq(1.2, 1.2, 0.3)]], m).length, 1);
});

test('LevelRaster: 全部の多角形から作った格子（rasterizeLevels）と、タイルごとに書き足した格子が一致する（津波ラベル・洪水ランク）', () => {
  const feats = [
    { properties: { A40_003: '10m以上 ～ 20m未満' }, geometry: poly(0.1, 0.1, 0.5) },
    { properties: { A40_003: '2m以上 ～ 3m未満' }, geometry: poly(0.3, 0.3, 0.5) },
    { properties: { A40_003: '0.3m未満' }, geometry: poly(0.6, 0.6, 0.3) },
    { properties: { A40_003: '2m以上 ～ 3m未満' }, geometry: poly(0.2, 0.7, 0.2) },
  ];
  const bbox = [0, 0, 1, 1];
  const whole = extractLeveledByLabel(feats, (p) => p.A40_003);
  const expect = Lib.decodeRaster(rasterizeLevels(whole.items, bbox, whole.labels, 0.01, 0.01));
  const acc = new LevelRaster(bbox, 0.01, 0.01);
  for (const f of feats) { // 1件ずつ（タイルごとの取り込みを模す）
    const rows = [];
    for (const rings of polysOf(f.geometry, 4)) rows.push({ rings, label: f.properties.A40_003.replace(/\s+/g, '').replace(/～/g, '〜') });
    acc.addLabeled(rows);
  }
  const got = acc.finish();
  assert.deepStrictEqual(got.labels, whole.labels);
  assert.deepStrictEqual(got.lv, rasterizeLevels(whole.items, bbox, whole.labels, 0.01, 0.01).lv);
  assert.strictEqual(got.cells, expect.levels.filter(Boolean).length);
  // 洪水ランク（coded）と mask
  const fl = extractFloodLevels([{ properties: { A31a_205: 2 }, geometry: poly(0.1, 0.1, 0.5) }, { properties: { A31a_205: 4 }, geometry: poly(0.3, 0.3, 0.5) }], 5);
  const a2 = new LevelRaster(bbox, 0.01, 0.01); a2.addCoded(fl.items, fl.labels);
  const mask = makeMask([[sq(0, 0, 0.4)]], bbox, 0.01, 0.01);
  const masked = Lib.decodeRaster(a2.finish(mask));
  assert.strictEqual(Lib.levelAt(masked, 0.35, 0.35), 4);
  assert.strictEqual(Lib.levelAt(masked, 0.55, 0.55), 0); // 地域の外は区域外にする
  assert.strictEqual(Lib.levelAt(masked, 0.15, 0.15), 2);
});
