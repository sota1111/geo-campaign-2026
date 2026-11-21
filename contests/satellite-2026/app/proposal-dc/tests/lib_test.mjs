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

// ---- 優先値（利用者の重みによる一次スクリーニングの目安）----
const W = L.defaultWeights();
const allF = (v) => Object.assign(Object.fromEntries(L.FACTOR_KEYS.map((k) => [k, v])), { hz: 0 });

test('優先値: 初期の重みは 8 要素とも 5（均等）', () => {
  assert.deepEqual(Object.keys(W), L.FACTOR_KEYS);
  assert.ok(Object.values(W).every((w) => w === 5));
});

test('優先値: 重み付き平均（手計算と一致）・寄与の合計が優先値', () => {
  const f = allF(0); f.flood = 1; f.lst = 0.5;
  const r = L.priorityOf(f, { ...W, flood: 3, lst: 1, slide: 0, tsunami: 0, surge: 0, insar: 0, power: 0, land: 0 });
  assert.ok(Math.abs(r.value - (100 * (3 * 1 + 1 * 0.5)) / 4) < 1e-9, String(r.value)); // 87.5
  assert.ok(Math.abs(r.parts.reduce((a, p) => a + (p.contrib || 0), 0) - r.value) < 1e-9);
  const eq = L.priorityOf(allF(0.4), W);
  assert.ok(Math.abs(eq.value - 40) < 1e-9);
});

test('優先値: 重み 0 の要素は計算から外れる（値が何でも結果が変わらない）', () => {
  const a = allF(1), b = allF(1); b.flood = 0;
  const w = { ...W, flood: 0 };
  assert.equal(L.priorityOf(a, w).value, L.priorityOf(b, w).value);
  assert.notEqual(L.priorityOf(a, W).value, L.priorityOf(b, W).value);
  assert.equal(L.priorityOf(b, w).parts.find((p) => p.key === 'flood').used, false);
});

test('優先値: 重みがすべて 0 なら値なし（0 除算にならない）。負・非数の重みは 0 扱い', () => {
  const z = Object.fromEntries(L.FACTOR_KEYS.map((k) => [k, 0]));
  const r = L.priorityOf(allF(1), z);
  assert.equal(r.value, null); assert.equal(r.excluded, false);
  assert.equal(L.priorityOf(allF(1), { ...z, flood: -3, lst: NaN }).value, null);
});

test('優先値: 値のない要素（null）は分母からも外す（0 点扱いにしない）', () => {
  const f = allF(0.8); f.insar = null;
  assert.ok(Math.abs(L.priorityOf(f, W).value - 80) < 1e-9);
  assert.equal(L.priorityOf(f, W).parts.find((p) => p.key === 'insar').used, false);
});

test('優先値: 重みを増やした要素の望ましさが高ければ優先値は上がり、低ければ下がる', () => {
  const f = allF(0.5); f.flood = 1; f.slide = 0;
  const base = L.priorityOf(f, W).value;
  assert.ok(L.priorityOf(f, { ...W, flood: 10 }).value > base);
  assert.ok(L.priorityOf(f, { ...W, slide: 10 }).value < base);
  assert.ok(base >= 0 && base <= 100);
});

test('優先値: 「除外」は区域が半分以上の格子だけ。切替がなければ除外しない', () => {
  const f = allF(0.5); f.hz = 0.5;
  assert.equal(L.priorityOf(f, W, { exclude: true }).excluded, true);
  assert.equal(L.priorityOf(f, W, { exclude: true }).value, null);
  assert.ok(L.priorityOf(f, W, {}).value > 0);
  f.hz = 0.49;
  assert.ok(L.priorityOf(f, W, { exclude: true }).value > 0);
});

test('変換: 距離・温度・沈下の階級に対して望ましさは単調（遠い・熱い・動きが大きいほど下がる）で 0〜1', () => {
  let prev = 2;
  for (const d of [0, 200, 500, 1000, 2500, 5000, 9000]) { const v = L.powerDesir(d); assert.ok(v <= prev && v >= 0 && v <= 1); prev = v; }
  assert.equal(L.powerDesir(500), 1); assert.equal(L.powerDesir(5000), 0);
  prev = 2;
  for (const t of [25, 31, 35, 40, 50.1, 60]) { const v = L.lstDesir(t, 31, 50.1); assert.ok(v <= prev && v >= 0 && v <= 1); prev = v; }
  assert.equal(L.lstDesir(31, 31, 50.1), 1); assert.equal(L.lstDesir(50.1, 31, 50.1), 0);
  // 干渉SAR: 符号 8・9（±3.75 mm/年以内）が 1。0 から離れるほど下がり、±15 mm/年以上で 0。沈下側・隆起側で対称
  assert.equal(L.insarDesir(8), 1); assert.equal(L.insarDesir(9), 1);
  for (let c = 1; c <= 7; c++) assert.ok(L.insarDesir(c) <= L.insarDesir(c + 1), `沈下側 ${c}`);
  for (let c = 9; c <= 15; c++) assert.ok(L.insarDesir(c) >= L.insarDesir(c + 1), `隆起側 ${c}`);
  assert.equal(L.insarDesir(1), 0); assert.equal(L.insarDesir(16), 0);
  for (let c = 1; c <= 16; c++) assert.ok(Math.abs(L.insarDesir(c) - L.insarDesir(17 - c)) < 1e-9);
});

test('範囲の望ましさ: 区域内=0・外=1、2020 植生→2026 裸地等は土地で 1、植生は 0.2', () => {
  const n = 4, ly = Object.fromEntries(Object.keys(LY).map((k) => [k, new Uint8Array(n)]));
  const data = { stats: D.stats, substations: [{ lon: 130.7, lat: 33.8, voltage: '66000' }], lines: [] };
  const cells = [0, 1, 2, 3];
  ly.flood[0] = 1; ly.flood[1] = 2; // 4 格子のうち 2 つが洪水の区域内
  ly.land.fill(1); // 植生
  let f = L.factorsOfCells(data, ly, cells, 130.7, 33.8);
  assert.equal(f.flood, 0.5); assert.equal(f.slide, 1); assert.equal(f.tsunami, 1); assert.equal(f.surge, 1);
  assert.equal(f.hz, 0.5); assert.ok(Math.abs(f.land - 0.2) < 1e-9);
  assert.equal(f.insar, null); assert.equal(f.lst, null); // 値なしは null
  assert.equal(f.power, 1); // 変電所の真上
  ly.land.fill(2); ly.chg[0] = 1;
  f = L.factorsOfCells(data, ly, cells, 130.7, 33.8);
  assert.ok(Math.abs(f.land - (1 + 0.8 * 3) / 4) < 1e-9);
  assert.equal(L.factorsOfCells({ ...data, substations: [] }, ly, cells, 130.7, 33.8).power, null);
});

test('格子: 全体の優先値（約 250 m 区画）。重みで値が変わり、重み 0 の要素は影響しない', () => {
  const fg = L.buildFactorGrid(D, LY);
  assert.equal(fg.nbx * L.PRI.B, g.nx); assert.equal(fg.nby * L.PRI.B, g.ny);
  const p = L.priorityGrid(fg, W, {});
  assert.equal(p.length, fg.nbx * fg.nby);
  const vals = [...p].filter((v) => !Number.isNaN(v));
  assert.ok(vals.length > 0.95 * p.length && vals.every((v) => v >= 0 && v <= 100));
  const only = (k) => Object.fromEntries(L.FACTOR_KEYS.map((x) => [x, x === k ? 7 : 0]));
  const pf = L.priorityGrid(fg, only('flood'), {});
  assert.deepEqual([...pf], [...L.priorityGrid(fg, { ...only('flood'), flood: 1 }, {})]); // 単独なら重みの大きさに依らない
  assert.notDeepEqual([...pf], [...L.priorityGrid(fg, only('lst'), {})]);
  const ex = L.priorityGrid(fg, W, { exclude: true });
  assert.ok([...ex].some((v) => v === -1) && [...ex].every((v, i) => v === -1 || Object.is(v, p[i])));
  const edges = L.priEdges(p);
  assert.equal(edges.length, 4); assert.ok(edges.every((e, i) => i === 0 || e >= edges[i - 1]));
  assert.equal(L.priBin(edges[0] - 1, edges), 0); assert.equal(L.priBin(101, edges), 4);
});

test('格子: 区画の位置と中心・地点の区画', () => {
  const b = L.blockOf(g, L.PRI.B, 130.75, 33.8);
  const [x, y] = L.blockCenter(g, L.PRI.B, b.bi, b.bj);
  assert.ok(Math.abs(x - 130.75) <= (g.d * L.PRI.B) / 2 + 1e-9 && Math.abs(y - 33.8) <= (g.d * L.PRI.B) / 2 + 1e-9);
  assert.equal(L.blockCells(g, L.PRI.B, b.bi, b.bj).length, L.PRI.B * L.PRI.B);
  assert.equal(L.blockOf(g, L.PRI.B, 129, 33.8), null);
});
