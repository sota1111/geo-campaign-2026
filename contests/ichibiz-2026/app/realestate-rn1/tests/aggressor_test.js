// アグレッサーの失敗テスト（ichibiz-2026 不動産部門・新案 RN1「住む場所の先行き」: lib.js と同梱データ）。2026-11-13
// usage: node --test contests/ichibiz-2026/app/realestate-rn1/tests/aggressor_test.js
//   環境変数 RN1_APP でアプリの場所を変えられる（既定: contests/ichibiz-2026/app/realestate-rn1）。
// アグレッサー作成のものを、工兵が app/realestate-rn1/tests/ へ移した（APP の既定値だけ変更。テストの中身は A1 の判定式の修正を除き同じ）。
// 「NG想定」のテストは、現行の実装・同梱データで落ちることを意図している（弱点の再現）。落ちなくなれば解消。
// 番号は reports/aggressor/ichibiz-2026-realestate-rn1-20261113.md の「追加したテスト」に対応。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(process.env.RN1_APP || path.join(__dirname, '..'));
const Lib = require(path.join(APP, 'web', 'lib.js'));
const DATA_DIR = path.join(APP, 'web', 'data', 'tokushima');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const load = (mut) => {
  const manifest = rd('manifest.json');
  const files = { plan: rd('plan.json'), population: rd('population.json'), districts: rd('districts.json'), facilities: rd('facilities.json'), hazards: rd('hazards.json') };
  if (mut) mut(manifest, files);
  return Lib.assemble(manifest, files);
};
const data = load();
const CITY = '36201';
const sheetOf = (d, f) => Lib.buildSheet(d, f);
const sheetText = (d, lon, lat) => JSON.stringify(Lib.buildSheet(d, Lib.collect(d, lon, lat)));
const hazardText = (d, f) => JSON.stringify(sheetOf(d, f).sections.find((s) => s.id === 'hazard'));

let _pts = new Map();
function cityPoints(step = 0.0025) {
  if (_pts.has(step)) return _pts.get(step);
  const out = [];
  for (let lon = 134.42; lon <= 134.66; lon += step) for (let lat = 33.98; lat <= 34.16; lat += step * 0.8) {
    const f = Lib.collect(data, lon, lat);
    if (f.cityCode === CITY) out.push(f);
  }
  _pts.set(step, out);
  return out;
}

// ---- A1 取得範囲（z13タイル）が徳島市の南端を切っている ----
test('A1 NG想定: 徳島市の小学校区が、取得したタイルの南端（北緯約33.9798度）で切れていない', () => {
  // 取得範囲の南端（manifest の bbox の南端を含むタイルの南の縁）。元の式は「南端が縁より南にある校区」も切れていると数えてしまうため、縁との距離の絶対値で判定する
  const tileSouth = Lib.worldToLonLat(0, Math.floor(Lib.lonLatToWorld(134.5, data.bbox[1], 13).y) + 1, 13).lat;
  const clipped = [];
  for (const d of data.districts.filter((e) => e.city === CITY)) {
    let mn = Infinity;
    for (const p of d.polys) for (const r of p) for (const c of r) mn = Math.min(mn, c[1]);
    if (Math.abs(mn - tileSouth) < 0.0002) clipped.push(d.name + '（南端 ' + mn.toFixed(4) + '）');
  }
  // 現状: 宮井小学校区が 33.9798 で切れる。市の南部はシートが出ず、problem.md の「徳島市の人口」（1,682メッシュの合計）も南部を含まない
  assert.deepStrictEqual(clipped, [], '徳島市の校区がデータ範囲の端で切れている: ' + clipped.join('、'));
});

// ---- A2 人口が少ない場所で「−100%」をそのまま出す ----
test('A2 NG想定: 市内のどの地点でも、周辺人口の増減率に「−100%」を出さない', () => {
  const bad = [];
  for (const f of cityPoints()) if (/人口（推計）[^"]*−100%/.test(sheetText(data, f.lon, f.lat))) bad.push(f.lon.toFixed(4) + ',' + f.lat.toFixed(4));
  assert.strictEqual(bad.length, 0, '「−100%」が出る市内の地点 ' + bad.length + '件（例: ' + bad.slice(0, 3).join(' / ') + '）');
});

test('A2b NG想定: 65歳以上の割合に「算出不可」を出さない（2050年の推計人口0人の地点）', () => {
  const bad = cityPoints().filter((f) => /65歳以上の割合[^"]*算出不可/.test(sheetText(data, f.lon, f.lat)));
  assert.strictEqual(bad.length, 0, '「算出不可」が出る市内の地点 ' + bad.length + '件');
});

// ---- A3 災害の節が、徳島で最も問われる津波・高潮に触れない ----
test('A3 NG想定: 災害の節が、津波・高潮の想定（XKT028・XKT027）を扱うか、扱っていないことを明記する', () => {
  const hz = hazardText(data, Lib.collect(data, 134.5513, 34.0745));
  assert.ok(/津波/.test(hz) && /高潮/.test(hz), '災害の節に「津波」「高潮」の語がない（洪水と土砂だけで「災害の想定区域」と題している）');
});

// ---- A4 土砂災害の警戒区域と特別警戒区域を区別しない ----
test('A4 NG想定: 土砂災害の行が、特別警戒区域を区別するか、区別していないことをシートに明記する', () => {
  const pts = cityPoints(0.0015).filter((f) => f.hazard && f.hazard.sediment);
  assert.ok(pts.length > 0, '土砂災害警戒区域の中の市内の点が見つからない');
  assert.ok(/特別警戒/.test(hazardText(data, pts[0])), '土砂災害の行に「特別警戒区域」の扱いが出ない（README の限界にだけ書かれている）');
});

// ---- A5 洪水の約18m格子: 境界付近でも内外を言い切る ----
test('A5 NG想定: 指した点の約20m以内に洪水の格子の内外の境界がある時は「境界付近」と出す', () => {
  const r = data.hazard.flood;
  let found = null;
  for (const f of cityPoints(0.0013)) {
    const v = Lib.inRaster(r, f.lon, f.lat);
    let mixed = false;
    for (const a of [-0.00022, 0, 0.00022]) for (const b of [-0.00018, 0, 0.00018]) if (Lib.inRaster(r, f.lon + a, f.lat + b) !== v) mixed = true;
    if (mixed) { found = f; break; }
  }
  assert.ok(found, '境界付近の点が見つからない');
  assert.ok(/境界付近にある|境界の近く/.test(hazardText(data, found)), '境界から20m以内の点でも「想定区域の中にある／外にある」と言い切る（' + found.lon.toFixed(5) + ',' + found.lat.toFixed(5) + '）');
});

test('A5b NG想定: 8方向を浸水想定に囲まれた1セルの穴（居住誘導区域内）で「想定区域の外にある」と出さない', () => {
  const r = data.hazard.flood;
  const g = (row, col) => Lib.cellOn(r, row * r.w + col); // 格子の内部形式（bits→lv）が変わったため、Lib.cellOn 経由に変更
  let hit = null;
  outer: for (let row = 1; row < r.h - 1; row++) for (let col = 1; col < r.w - 1; col++) {
    if (g(row, col)) continue;
    let all = true;
    for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if ((a || b) && !g(row + a, col + b)) all = false;
    if (!all) continue;
    const lon = r.west + (col + 0.5) * r.dx, lat = r.north - (row + 0.5) * r.dy;
    const f = Lib.collect(data, lon, lat);
    if (f.cityCode === CITY && f.plan && f.plan.inResidential) { hit = f; break outer; }
  }
  assert.ok(hit, '居住誘導区域内の1セルの穴が見つからない');
  assert.ok(!/洪水浸水想定区域（想定最大規模）: 想定区域の外にある/.test(hazardText(data, hit)), '周囲8セルがすべて浸水想定なのに「外にある」と出る（' + hit.lon.toFixed(5) + ',' + hit.lat.toFixed(5) + '）。原データの穴か変換の副作用かは未判定');
});

// ---- A6 市の判定が最寄りのメッシュ中心で決まる ----
function districtScan(fn) {
  const tk = data.districts.filter((e) => e.city === CITY);
  for (let lon = 134.42; lon <= 134.66; lon += 0.002) for (let lat = 33.981; lat <= 34.16; lat += 0.0016) {
    const d = tk.find((e) => Lib.inPolys(lon, lat, e.polys));
    if (d) fn(lon, lat, d, Lib.cityAt(data.pop, lon, lat));
  }
}
test('A6 NG想定: 徳島市の小学校区（国土数値情報）の中の点は、別の市町村と判定されない', () => {
  const bad = [];
  districtScan((lon, lat, d, c) => { if (c && c !== CITY) bad.push(lon.toFixed(4) + ',' + lat.toFixed(4) + ' ' + d.name + '→' + c); });
  assert.strictEqual(bad.length, 0, '徳島市の校区の中なのに「別の市町村」と出る点 ' + bad.length + '件（例: ' + bad.slice(0, 3).join(' / ') + '）');
});

test('A6b NG想定: 徳島市の校区の中で、シートが出ない（250m以内に人口メッシュがない）点が1割未満', () => {
  let tot = 0, none = 0;
  districtScan((lon, lat, d, c) => { tot++; if (c === null) none++; });
  // 現状: 約22%。区域・災害の行も含めてシート全体が出ず「人が住む場所を指してください」になる
  assert.ok(none / tot < 0.1, '市内の ' + ((none / tot) * 100).toFixed(1) + '% の点でシートが出ない（' + none + '/' + tot + '）');
});

// ---- A7 年次が増えた時に「最も先の年」で比べない ----
test('A7 NG想定: 将来人口の年次が5つに増えても、最も先の年（2050）で比べる', () => {
  const d = load((m, f) => {
    const p = f.population;
    p.years = [2025, 2030, 2035, 2040, 2050];
    for (const it of p.items) { const v = it.v; it.v = [...v.slice(0, 4), ...v.slice(0, 4), ...v.slice(4, 8), ...v.slice(4, 8), ...v.slice(8, 12)]; }
  });
  assert.ok(/→ 2050年/.test(sheetText(d, 134.5513, 34.0745)), '年次が増えると3番目の年（2035）で比べる（lib.js popSection の const [y0, y1, y2] = q.years）');
});

// ---- A8 市区町村コードの欠けたデータを受け入れる ----
test('A8 NG想定: 将来人口のメッシュに市区町村コード（sc）が無ければ、形式不正として未取得にする', () => {
  const d = load((m, f) => { for (const it of f.population.items) delete it.sc; });
  assert.notStrictEqual(d.status.XKT013.state, 'ok', 'sc の無いデータを受け入れ、全地点で「近くに人口の推計があるメッシュがありません（海・川・山林など）」と案内する');
});

// ---- 以下は現状で通る頑健性の確認（回帰防止） ----
test('頑健: 非数・極端な座標・範囲の角でも例外を出さない', () => {
  for (const [lon, lat] of [[NaN, NaN], [180, 90], [-180, -90], [Infinity, 0], [134.42, 33.98], [134.66, 34.16]]) {
    const s = sheetOf(data, Lib.collect(data, lon, lat));
    assert.ok(s.outOfScope || s.sections.length === 5, String([lon, lat]));
  }
});

test('頑健: 空のmanifest・空の配列でも例外を出さず、未取得として扱う', () => {
  const d1 = Lib.assemble({ layers: {} }, {});
  for (const api of Object.keys(Lib.APIS)) assert.notStrictEqual(d1.status[api].state, 'ok');
  const d2 = load((m, f) => { f.plan.items = []; f.population.items = []; f.districts.items = []; f.facilities.schools = []; f.hazards.sediment = []; });
  for (const api of ['XKT003', 'XKT013', 'XKT004', 'XKT006', 'XKT029']) assert.strictEqual(d2.status[api].state, 'missing', api);
  const s = sheetOf(d2, Lib.collect(d2, 134.5513, 34.0745));
  assert.ok(s.outOfScope && s.outOfScope.includes('未取得'));
});

test('頑健: 断定語・資産価値の語（価値・資産・値下がり・おすすめ・危険）を市内の全格子点で出さない', () => {
  const re = /資産価値|値下がり|値上がり|おすすめ|買うべき|危険です|安全です|住めない/;
  const bad = cityPoints().filter((f) => re.test(sheetText(data, f.lon, f.lat)));
  assert.strictEqual(bad.length, 0, bad.length + '件');
});
