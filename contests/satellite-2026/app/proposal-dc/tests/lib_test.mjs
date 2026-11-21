// node --test tests/lib_test.mjs   （node 22。ロジックとデータの整合性）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const L = require(path.join(root, 'lib.js'));
const src = fs.readFileSync(path.join(root, 'data/dc.js'), 'utf8');
const D = JSON.parse(src.replace(/^window\.DC_DATA=/, '').replace(/;\s*$/, ''));
const g = D.grid;
const N = g.nx * g.ny;
const mx = (a) => a.reduce((m, v) => (v > m ? v : m), 0);
const LY = Object.fromEntries(Object.entries(D.layers).map(([k, v]) => [k, L.decodeRle(v, N)]));

test('RLE: 往復できる・長さが合わないと例外', () => {
  const a = L.decodeRle([0, 3, 5, 2, 0, 1], 6);
  assert.deepEqual([...a], [0, 0, 0, 5, 5, 0]);
  assert.throws(() => L.decodeRle([1, 2], 5));
});

test('格子: 角と範囲外・中心の往復', () => {
  assert.equal(L.cellOf(g, g.w - 0.001, g.s + 0.1), null);
  assert.equal(L.cellOf(g, g.w + 0.0001, g.n - 0.0001).idx, 0);
  const c = L.cellOf(g, 130.75, 33.8);
  const [x, y] = L.cellCenter(g, c.i, c.j);
  assert.ok(Math.abs(x - 130.75) <= g.d / 2 + 1e-9 && Math.abs(y - 33.8) <= g.d / 2 + 1e-9);
});

test('距離: 緯度 0.01 度は約 1.11 km、線分への距離は垂線', () => {
  assert.ok(Math.abs(L.haversine(130.7, 33.7, 130.7, 33.71) - 1111) < 10);
  const d = L.distToSegment(130.7, 33.8, 130.69, 33.8005, 130.71, 33.8005);
  assert.ok(Math.abs(d - 55) < 3, String(d));
});

test('円の格子と輪郭の格子の数が面積に近い', () => {
  const cells = L.cellsInDisk(g, 130.75, 33.8, 500);
  const area = cells.length * g.d * 92300 * g.d * 111000;
  assert.ok(Math.abs(area - Math.PI * 500 * 500) / (Math.PI * 500 * 500) < 0.15, String(area));
  const sq = [[130.75, 33.8], [130.752, 33.8], [130.752, 33.802], [130.75, 33.802]];
  const n = L.cellsInRing(g, sq).length;
  assert.ok(n >= 60 && n <= 68, String(n)); // 0.002 度 / 0.00025 度 = 8 → 64
});

test('干渉SAR: 階級の範囲は 3.75 mm/年幅で -30〜+30', () => {
  assert.deepEqual(L.insarRange(0), [-30, -26.25]);
  assert.deepEqual(L.insarRange(7), [-3.75, 0]);
  assert.deepEqual(L.insarRange(15), [26.25, 30]);
  assert.equal(L.fmtRange([-3.75, 0]), '-3.75〜0 mm/年');
});

test('集計: 浸水・土砂・津波は該当と非該当を分ける', () => {
  const a = new Uint8Array(10); a[2] = 3; a[3] = 5;
  const f = L.summarizeFlood(a, [0, 1, 2, 3]);
  assert.equal(f.hit, true); assert.equal(f.max, 5); assert.equal(f.share, 50); assert.equal(f.label, L.FLOOD_RANK[5]);
  assert.equal(L.summarizeFlood(a, [0, 1]).hit, false);
  const s = new Uint8Array(4); s[1] = 2 | (1 << 2); s[2] = 1 | (2 << 2);
  const r = L.summarizeSlide(s, [0, 1, 2, 3]);
  assert.equal(r.zone, 2); assert.deepEqual(r.types, ['急傾斜地の崩壊', '土石流']); assert.equal(r.share, 50);
  const t = L.summarizeDepth(new Uint8Array([0, 2]), [0, 1], ['a', 'b', 'c']);
  assert.equal(t.label, 'b');
});

test('集計: 干渉SARは最頻の階級・値なしは0%・混在を示す', () => {
  const a = new Uint8Array([0, 8, 8, 9]);
  const r = L.summarizeInsar(a, [0, 1, 2, 3]);
  assert.equal(r.k, 7); assert.equal(r.valid, 3); assert.equal(r.mixed, true);
  assert.equal(L.summarizeInsar(a, [0]).valid, 0);
});

test('集計: 地表面温度の符号と中央値', () => {
  assert.equal(L.lstFromCode(1), 10); assert.equal(L.lstFromCode(0), null); assert.equal(L.lstFromCode(61), 40);
  const r = L.summarizeLst(new Uint8Array([0, 61, 63, 65]), [0, 1, 2, 3]);
  assert.equal(r.median, 41); assert.equal(r.valid, 3);
});

test('電圧の読み取りと最寄りの変電所', () => {
  assert.equal(L.maxVoltage('220000;66000'), 220000);
  assert.equal(L.maxVoltage(''), 0);
  const subs = [{ lon: 130.70, lat: 33.80, voltage: '6600', name: 'a' }, { lon: 130.72, lat: 33.80, voltage: '154000', name: 'b' }];
  assert.equal(L.nearestSubstation(subs, 130.701, 33.8, 0).s.name, 'a');
  assert.equal(L.nearestSubstation(subs, 130.701, 33.8, 66000).s.name, 'b');
  assert.equal(L.nearestSubstation([], 130.7, 33.8, 0), null);
});

test('データの整合: 格子の大きさ・層・場面', () => {
  assert.equal(g.nx * g.d, +(g.e - g.w).toFixed(6));
  for (const k of ['flood', 'slide', 'tsunami', 'surge', 'sub', 'lst', 'land', 'chg']) assert.equal(LY[k].length, N, k);
  assert.ok(D.stats.insar_valid > 0.5, '干渉SARが範囲の半分以上にある');
  assert.ok(D.stats.lst_valid > 0.5);
  assert.ok(mx(LY.flood) <= 6 && mx(LY.sub) <= 16 && mx(LY.land) <= 5 && mx(LY.chg) <= 1);
  assert.ok(D.labels.tsunami.length >= 1 && D.labels.surge.length >= 1);
  assert.ok(mx(LY.tsunami) <= D.labels.tsunami.length && mx(LY.surge) <= D.labels.surge.length);
});

test('データの整合: 候補地は範囲内で、輪郭に格子があり、番号が一意', () => {
  assert.ok(D.candidates.length >= 10);
  const ids = new Set(D.candidates.map((c) => c.id));
  assert.equal(ids.size, D.candidates.length);
  for (const c of D.candidates) {
    assert.ok(c.lon > g.w && c.lon < g.e && c.lat > g.s && c.lat < g.n, c.id);
    assert.ok(['dev', 'idle'].includes(c.kind));
    assert.ok(c.ha >= 2, c.id);
    assert.ok(c.ndvi > -1 && c.ndvi < 1 && c.pndvi > -1 && c.pndvi < 1, c.id + ' 植生指数が -1〜1 の外');
    const cells = L.cellsInRing(g, c.ring);
    assert.ok(cells.length >= 10, c.id + ' の格子が少ない');
    // 面積が合う（輪郭は単純化してあるので ±40%）
    const ha = (cells.length * g.d * 92300 * g.d * 111000) / 1e4;
    assert.ok(Math.abs(ha - c.ha) / c.ha < 0.4, `${c.id}: ${ha.toFixed(1)} vs ${c.ha}`);
  }
  assert.ok(D.candidates.some((c) => c.kind === 'dev'));
});

test('確認項目: 8 項目が出て、どれにも点数・順位・「適地」の語がない', () => {
  const c = D.candidates[0];
  const rows = L.buildChecks(D, LY, { lon: c.lon, lat: c.lat, cells: L.cellsInRing(g, c.ring) });
  assert.deepEqual(rows.map((r) => r.key), ['flood', 'slide', 'tsunami', 'surge', 'insar', 'lst', 'power', 'land']);
  for (const r of rows) {
    assert.ok(['hit', 'none', 'info', 'nodata'].includes(r.status));
    assert.ok(r.src.name && r.src.url && r.src.lic, r.key + ' に出典');
    assert.ok(!/点|位|最適|適地|安全/.test(r.value + r.label), r.key + ' の文言: ' + r.value);
  }
});

test('確認項目: 指した地点（円）でも動く。範囲外の近くでも落ちない', () => {
  for (const [lon, lat] of [[130.75, 33.8], [130.631, 33.691], [130.909, 33.929]]) {
    const cells = L.cellsInDisk(g, lon, lat, L.CLICK_RADIUS_M);
    assert.ok(cells.length >= 1);
    const rows = L.buildChecks(D, LY, { lon, lat, cells });
    assert.equal(rows.length, 8);
  }
});

test('文言: 場面の ID と日付、出典の表記が定義されている', () => {
  assert.match(L.SCENES.s2_now.id, /^S2[ABC]_52SFC_20260823/);
  assert.match(L.SCENES.landsat.id, /^LC09_L2SP_113036_20260822/);
  assert.match(L.SCENES.insar.credit, /国土地理院/);
  assert.match(L.SCENES.s2_now.credit, /Copernicus Sentinel/);
  assert.match(L.SCENES.landsat.credit, /U\.S\. Geological Survey/);
  assert.match(L.SRC.flood.lic, /CC BY 4\.0/);
  assert.match(L.SRC.sub.lic, /ODbL/);
});
