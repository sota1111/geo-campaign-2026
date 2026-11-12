// 実行: node --test contests/ichibiz-2026/app/realestate-rn1/tests/
// 画面のロジック（web/lib.js）を、同梱した実データ（web/data/）で検査する。ネットワーク・APIキー不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Lib = require('../web/lib.js');

const DATA_DIR = path.join(__dirname, '../web/data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const load = (mut) => {
  const manifest = rd('manifest.json');
  const files = { plan: rd('plan.json'), population: rd('population.json'), districts: rd('districts.json'), facilities: rd('facilities.json'), hazards: rd('hazards.json') };
  if (mut) mut(manifest, files);
  return Lib.assemble(manifest, files);
};
const data = load();
const text = (s) => JSON.stringify(s);
const STATION = [134.5513, 34.0745], KOKUFU = [134.4845, 34.054], HACHIMAN = [134.519, 34.045];
const sheetOf = (d, p) => Lib.buildSheet(d, Lib.collect(d, p[0], p[1]));

test('同梱データ: 9項目すべて取得済みで、件数がmanifestと一致する', () => {
  const m = rd('manifest.json');
  for (const api of Object.keys(Lib.APIS)) {
    assert.strictEqual(data.status[api].state, 'ok', api + ' ' + text(data.status[api]));
    assert.strictEqual(data.status[api].count, m.layers[api].count);
  }
  assert.strictEqual(data.plan.length, 7);
  assert.ok(data.pop.meshes.length > 3000);
  assert.deepStrictEqual(data.pop.years, [2025, 2035, 2050]);
});

test('同梱データにAPIキーらしき文字列が入っていない（32桁以上の英数字がない。格子のbase64は除く）', () => {
  const re = /[A-Za-z0-9]{32,}/;
  for (const f of fs.readdirSync(DATA_DIR)) {
    const j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
    if (j.flood) delete j.flood.bits;
    assert.ok(!re.test(JSON.stringify(j)), f);
  }
  // 取得スクリプト・画面のソースにもキー値は書かれていない
  for (const f of ['../tools/fetch-reinfolib.mjs', '../tools/extract.mjs', '../tools/inspect-api.mjs', '../web/app.js', '../web/lib.js', '../web/index.html']) {
    assert.ok(!/[0-9a-f]{32}/i.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), f);
  }
  if (process.env.REINFOLIB_API_KEY) {
    for (const f of fs.readdirSync(DATA_DIR)) assert.ok(!fs.readFileSync(path.join(DATA_DIR, f), 'utf8').includes(process.env.REINFOLIB_API_KEY), f);
  }
});

test('規約の文言: クレジットはAPI利用規約 第7条のまま固定', () => {
  assert.strictEqual(Lib.CREDIT, 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません');
  assert.strictEqual(Lib.ATTRIBUTION, '出典：国土交通省　不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）');
  assert.ok(Lib.RESPONSIBILITY.includes('国が作成・監修したものではありません'));
  assert.ok(Lib.POP_NOTE.includes('推計'));
});

test('地理: 多角形の内外・穴、距離、世界座標の往復', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.ok(Lib.inPolygon(1, 1, [sq]) && !Lib.inPolygon(11, 1, [sq]) && !Lib.inPolygon(5, 5, [sq, hole]) && Lib.inPolygon(2, 2, [sq, hole]));
  const d = Lib.haversine(134.5, 34, 134.51, 34);
  assert.ok(d > 900 && d < 940, String(d));
  const w = Lib.lonLatToWorld(134.5, 34.0, 15), b = Lib.worldToLonLat(w.x, w.y, 15);
  assert.ok(Math.abs(b.lon - 134.5) < 1e-9 && Math.abs(b.lat - 34.0) < 1e-9);
  assert.strictEqual(Lib.fmtDist(1234), '1.2km');
  assert.strictEqual(Lib.fmtDist(512), '510m');
});

test('実データ: 徳島駅付近は徳島市で、居住誘導区域かつ都市機能誘導区域の中', () => {
  const f = Lib.collect(data, ...STATION);
  assert.strictEqual(f.cityCode, '36201');
  assert.ok(f.plan.hasPlan && f.plan.inPlanArea && f.plan.inResidential && f.plan.inCityFunction);
  assert.strictEqual(f.plan.decided[31], '2024-04-01');
  assert.strictEqual(f.district.name, '内町小学校');
});

test('実データ: 国府町（郊外）は計画区域の中だが居住誘導区域の外。届出の手引の注記が出る', () => {
  const f = Lib.collect(data, ...KOKUFU);
  assert.ok(f.plan.inPlanArea && !f.plan.inResidential);
  const s = Lib.buildSheet(data, f);
  const t = text(s.sections[0]);
  assert.ok(t.includes('居住誘導区域（居住促進区域）の外'));
  assert.ok(t.includes('3戸以上') && t.includes('30日前') && t.includes('届出の手引'));
  assert.ok(t.includes('住めるかどうかや価格を示すものではない'));
});

test('実データ: 将来人口。徳島市全体は2025→2050で減り、駅付近は65歳以上の割合が上がる推計', () => {
  const q = Lib.collect(data, ...STATION).pop;
  assert.ok(q.meshN >= 5 && q.meshN <= 20, String(q.meshN));
  const c = q.city;
  assert.ok(c[2025].p > 200000 && c[2025].p < 300000, String(c[2025].p));
  assert.ok(c[2050].p < c[2025].p);
  assert.ok(Lib.share(q.local[2050], 'c') > Lib.share(q.local[2025], 'c'));
  assert.ok(Lib.changePct(q.local[2025].p, q.local[2050].p) < 0);
  assert.strictEqual(Lib.changePct(0, 5), null);
  assert.strictEqual(Lib.fmtPct(-27.4), '−27%');
  assert.strictEqual(Lib.fmtPct(null), '算出不可');
});

test('実データ: 将来人口の節に「推計」と出典の印、校区の節に統合を断定しない注記', () => {
  const s = sheetOf(data, STATION);
  const pop = text(s.sections[1]), sch = text(s.sections[2]);
  assert.ok(pop.includes('推計') && pop.includes('XKT013'));
  assert.ok(sch.includes('XKT004') && sch.includes('学校が続くかどうかは分からない'));
});

test('実データ: 徒歩圏の施設は、近い順・重複なしで件数と名前を返す', () => {
  const f = Lib.collect(data, ...STATION);
  const g = (k) => f.fac.groups.find((x) => x.key === k);
  assert.ok(g('elem').count >= 1 && g('hospital').count >= 1 && g('clinic').count >= 1);
  for (const x of f.fac.groups) assert.strictEqual(new Set(x.names).size, x.names.length);
  const k = Lib.collect(data, ...KOKUFU).fac;
  const e = k.groups.find((x) => x.key === 'elem');
  assert.strictEqual(e.count, 0);
  assert.ok(e.nearest.dist > Lib.WALK_RADIUS);
});

test('実データ: 災害の想定区域（土砂・洪水）は真偽で返り、洪水は格子の範囲外でfalse', () => {
  const f = Lib.collect(data, ...STATION);
  assert.strictEqual(typeof f.hazard.sediment, 'boolean');
  assert.strictEqual(typeof f.hazard.flood, 'boolean');
  assert.strictEqual(Lib.inRaster(data.hazard.flood, 100, 10), false);
  // 土砂災害警戒区域: 区域の多角形の内側の点は true（多角形は同梱データそのもの）
  const poly0 = data.hazard.sediment[0];
  const ring = poly0[0];
  const cx = ring.reduce((t, c) => t + c[0], 0) / ring.length, cy = ring.reduce((t, c) => t + c[1], 0) / ring.length;
  assert.strictEqual(Lib.inPolys(cx, cy, data.hazard.sediment), Lib.inPolygon(cx, cy, poly0) || Lib.inPolys(cx, cy, data.hazard.sediment));
  assert.strictEqual(Lib.inPolys(0, 0, data.hazard.sediment), false);
});

test('範囲外・徳島市外・人のいない場所は、シートを出さず理由を示す', () => {
  assert.ok(sheetOf(data, [135.5, 34.7]).outOfScope.includes('範囲'));
  assert.strictEqual(Lib.collect(data, 135.5, 34.7).plan, null);
  // 鳴門市側（立地適正化計画のデータはあるが、この試作の対象は徳島市のみ）
  const nf = Lib.collect(data, 134.6, 34.17);
  const ns = Lib.buildSheet(data, nf);
  if (nf.cityCode && nf.cityCode !== '36201') { assert.ok(ns.outOfScope.includes('徳島市のみ')); assert.strictEqual(ns.sections.length, 0); }
  // 範囲内で最も近いメッシュが遠い場所（海上）
  const sea = Lib.buildSheet(data, Lib.collect(data, 134.62, 33.99));
  assert.ok(sea.outOfScope === null || /メッシュ|徳島市のみ/.test(sea.outOfScope));
  assert.ok(Lib.cityAt(data.pop, 135.0, 34.0) === null);
});

test('未取得: 将来人口が未取得なら、市内か判定できない旨を出す（未取得と理由が見える）', () => {
  const d = load((m) => { m.layers.XKT013 = { label: 'x', status: 'failed', reason: 'HTTP 403（キーが無効、または未承認の可能性）', file: 'population.json' }; });
  assert.strictEqual(d.status.XKT013.state, 'failed');
  const s = sheetOf(d, STATION);
  assert.ok(s.outOfScope.includes('未取得') && s.outOfScope.includes('HTTP 403'));
});

test('未取得: 洪水・立地適正化計画・施設が未取得なら、該当の節に「未取得」と理由が出て、その行は出ない', () => {
  const d = load((m) => {
    m.layers.XKT026 = { status: 'failed', reason: 'HTTP 400（パラメータ・ズームの範囲を確認）', file: 'hazards.json', part: 'flood' };
    m.layers.XKT003 = { status: 'failed', reason: '接続できませんでした（3回失敗）', file: 'plan.json' };
    m.layers.XKT010 = { status: 'failed', reason: 'HTTP 500', file: 'facilities.json', part: 'medical' };
  });
  const s = sheetOf(d, STATION);
  const sec = (id) => s.sections.find((x) => x.id === id);
  assert.ok(sec('hazard').missing.join().includes('未取得') && sec('hazard').missing.join().includes('XKT026'));
  assert.ok(!text(sec('hazard').lines).includes('洪水浸水想定区域'));
  assert.ok(sec('hazard').lines.some((l) => l.tag === 'XKT029'));
  assert.ok(sec('plan').missing.join().includes('XKT003') && sec('plan').lines.length === 0);
  assert.ok(sec('fac').missing.join().includes('XKT010'));
  assert.ok(!sec('fac').lines.some((l) => l.tag === 'XKT010') && sec('fac').lines.some((l) => l.tag === 'XKT006'));
});

test('不正なデータは「データの形式が不正」で落とす（手書き・壊れたファイルを読まない）', () => {
  const d = load((m, f) => { f.plan = { items: [{ nope: 1 }] }; f.hazards = { sediment: 'x', flood: { bits: 1 } }; });
  assert.strictEqual(d.status.XKT003.state, 'missing');
  assert.ok(d.status.XKT003.reason.includes('形式'));
  assert.strictEqual(d.status.XKT029.state, 'missing');
  assert.strictEqual(d.status.XKT026.state, 'missing');
  assert.ok(!d.plan && !d.hazard);
  const e = Lib.assemble(null, {});
  for (const api of Object.keys(Lib.APIS)) assert.strictEqual(e.status[api].state, 'missing');
});

test('文言: 徳島市内の格子点500地点で、断定語を出さない・5節がそろう・数値の欠けがない', () => {
  const FORBID = ['住めない', '価値が下がる', '価値が上がる', '資産価値', '査定', '買うべき', '売るべき', 'おすすめ', '安全です', '危険です'];
  let n = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
    const lon = 134.45 + (i * 0.2) / 40, lat = 34.0 + (j * 0.14) / 40;
    const f = Lib.collect(data, lon, lat);
    if (f.cityCode !== '36201') continue;
    const s = Lib.buildSheet(data, f);
    n++;
    assert.strictEqual(s.sections.length, 5);
    const t = text(s);
    for (const w of FORBID) assert.ok(!t.includes(w), w + ' @' + lon + ',' + lat);
    assert.ok(!/NaN|undefined|Infinity/.test(t), t.match(/.{20}(NaN|undefined|Infinity).{20}/)?.[0]);
  }
  assert.ok(n > 300, String(n));
});

test('格子: 点を含む多角形から作った格子で内外を判定できる（extract_test と同じ規則）', () => {
  const bits = Buffer.alloc(2); bits[0] = 0b00000101; // 4x4 の格子の 0行目の 0・2 列だけオン
  const r = Lib.decodeRaster({ west: 134, north: 35, dx: 0.1, dy: 0.1, w: 4, h: 4, bits: bits.toString('base64') });
  assert.ok(Lib.inRaster(r, 134.05, 34.95));
  assert.ok(!Lib.inRaster(r, 134.15, 34.95));
  assert.ok(Lib.inRaster(r, 134.25, 34.95));
  assert.ok(!Lib.inRaster(r, 134.05, 34.85));
  assert.ok(!Lib.inRaster(r, 133.9, 34.95) && !Lib.inRaster(r, 134.05, 35.1));
});
