// lib.js の単体試験（node tests/lib_test.js）。実データ（web/data）でも整合を確かめる。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../web/lib.js');
const D = path.join(__dirname, '..', 'web', 'data');
const J = (f) => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('メッシュ: 水戸付近の基準メッシュコード・往復', () => {
  const m = G.toMesh(140.4468, 36.3418);
  assert.equal(G.meshCode(m.ix, m.iy), '54404315');
  const b = G.cellBounds(m.cx, m.cy);
  assert.ok(b[0] <= 140.4468 && 140.4468 < b[2] && b[1] <= 36.3418 && 36.3418 < b[3]);
  assert.ok(Math.abs((b[2] - b[0]) - 5 / 80) < 1e-9 && Math.abs((b[3] - b[1]) - 5 / 120) < 1e-9);
});

t('percentRank: 範囲・同値・単調', () => {
  assert.deepEqual(G.percentRank([]), []);
  assert.deepEqual(G.percentRank([7]), [50]);
  assert.deepEqual(G.percentRank([1, 2, 3]), [0, 50, 100]);
  assert.deepEqual(G.percentRank([5, 5, 5]), [50, 50, 50]);
  const r = G.percentRank([3, 1, 4, 1, 5, 9, 2, 6]);
  r.forEach((x) => assert.ok(x >= 0 && x <= 100));
  assert.ok(r[0] < r[2] && r[1] < r[0]);
});

t('csvEscape', () => {
  assert.equal(G.csvEscape('a,b'), '"a,b"');
  assert.equal(G.csvEscape('a"b'), '"a""b"');
  assert.equal(G.csvEscape(null), '');
  assert.equal(G.toCsv([['a', 1], ['b,c', 2]]), 'a,1\r\n"b,c",2');
});

const cells = J('cells.json'), pops = J('pops.json'), munis = J('munis.json'), ck = J('checklist.json'), risk = J('risk.json');
const regions = J('districts.json').regions, real = J('reality.json');
const grid = G.popGrid(pops.rows);

t('実データ: 集計メッシュの件数・人口・地区の整合', () => {
  assert.deepEqual(cells.cols, ['cx', 'cy', 'n', 'kw', 'small', 'pop', 'region']);
  assert.deepEqual(cells.regions, ['県北', '県央', '鹿行', '県南', '県西']);
  assert.deepEqual(cells.regions, Object.keys(regions));
  assert.ok(cells.rows.length > 150);
  cells.rows.forEach((r) => {
    assert.ok(r[2] >= cells.meta.k_min, 'しきい値未満のメッシュが出力にある');
    assert.ok(r[4] <= r[2] && r[3] > 0);
    assert.equal(r[5], G.cellPop(grid, r[0], r[1]), 'メッシュ人口が人口グリッドの合計と一致しない');
    assert.ok(Number.isInteger(r[6]) && r[6] >= 0 && r[6] <= 4, '地区の番号');
  });
  assert.equal(new Set(cells.rows.map((r) => r[6])).size, 5);
});

const d711 = G.districtStats(regions, real.areas711.rows, munis.rows), d89 = G.districtStats(regions, real.areas.rows, munis.rows);
const tiers = cells.regions.map((nm) => d711.rows.find((r) => r.area === nm).tier);

t('地区の実績: 設備あたり件数・県全体の値・段階（令和7年11月末）', () => {
  assert.equal(real.areas711.rows.reduce((a, r) => a + r.n, 0), 1009);
  const by = {}; d711.rows.forEach((r) => { by[r.area] = r; });
  assert.deepEqual(Object.fromEntries(d711.rows.map((r) => [r.area, r.plants])), { 県西: 6269, 県南: 7884, 県央: 7216, 鹿行: 5536, 県北: 2282 });
  assert.equal(by['県西'].rate.toFixed(1), '59.5'); assert.equal(by['県南'].rate.toFixed(1), '43.4');
  assert.equal(by['県央'].rate.toFixed(1), '21.1'); assert.equal(by['県北'].rate.toFixed(1), '21.5'); assert.equal(by['鹿行'].rate.toFixed(1), '16.8');
  assert.equal(d711.avg.toFixed(1), '34.6');
  assert.deepEqual(Object.fromEntries(d711.rows.map((r) => [r.area, r.tier])), { 県西: 2, 県南: 2, 県央: 1, 県北: 1, 鹿行: 0 });
  // 令和8年9月末（別の期間）の設備あたり件数は README の表と同じ
  assert.deepEqual(Object.fromEntries(d89.rows.map((r) => [r.area, r.rate.toFixed(1)])), { 県西: '17.4', 県南: '20.8', 県央: '11.6', 鹿行: '6.9', 県北: '17.1' });
  // 段階の境界: 県全体の値以上→2、TIER_MID以上→1、未満→0
  const f = G.districtStats({ A: ['a'], B: ['b'], C: ['c'] }, [{ area: 'A', n: 50 }, { area: 'B', n: 25 }, { area: 'C', n: 10 }], [{ name: 'a', n: 1000 }, { name: 'b', n: 1000 }, { name: 'c', n: 1000 }]);
  assert.deepEqual(f.rows.map((r) => r.tier), [2, 1, 0]);
});

t('色: 点数＝2×地区の段階＋人目。0→低、1〜2→中、3〜4→やや高、5→高', () => {
  assert.deepEqual(G.LEVELS, ['低', '中', 'やや高', '高']);
  const out = [];
  for (let tier = 0; tier <= 2; tier++) for (const q of [false, true]) out.push(G.mapLevel(tier, q));
  assert.deepEqual(out, [0, 1, 1, 2, 2, 3]);
});

t('実データ: メッシュの色は地区の段階が主。人目だけで地区の順を超えない', () => {
  const m = G.meshLevels(cells.rows, tiers);
  assert.equal(m.length, cells.rows.length);
  m.forEach((c) => { assert.ok(c.level >= 0 && c.level <= 3); assert.equal(c.level, G.mapLevel(tiers[c.region], c.quiet)); });
  // 人目が少ないのは、人口密度が県内の低い方から約1/3（仮の切り方）
  const q = m.filter((c) => c.quiet).length;
  assert.ok(Math.abs(q / m.length - 1 / 3) < 0.05, 'quiet の割合 ' + q / m.length);
  m.filter((c) => c.quiet).forEach((a) => m.filter((c) => !c.quiet).forEach((b) => { if (a.dens > b.dens + 1e-9) assert.fail('人目が少ないのに密度が高い'); }));
  // 地区の段階が高いのに、低い段階の地区の「人目が少ない」メッシュより色が低いことはない
  const minOf = (reg, flag) => Math.min(...m.filter((c) => c.region === reg && c.quiet === flag).map((c) => c.level));
  assert.ok(minOf(4, false) >= Math.max(...m.filter((c) => c.region === 2).map((c) => c.level))); // 県西（段階2）の最小 ≥ 鹿行（段階0）の最大
  // 連続のスコア・順位を持たない
  m.forEach((c) => { assert.equal(c.score, undefined); assert.equal(c.parts, undefined); });
});

t('実データ: 市町村の色（隠した市町村には付けない・全44が地区に入る）', () => {
  const ms = G.muniLevels(munis.rows, regions, tiers, cells.regions);
  assert.equal(ms.length, 44);
  ms.forEach((x) => { assert.ok(x.region >= 0); if (x.hidden) assert.equal(x.level, null); else assert.ok(x.level >= 0 && x.level <= 3); });
  const fake = G.muniLevels([{ name: 'A', n: null, kw: null, small: null, pop: 100, area_km2: 1 }, { name: 'B', n: 5, kw: 100, small: 2, pop: 10, area_km2: 2 }], { 県西: ['A', 'B'] }, [2], ['県西']);
  assert.equal(fake[0].level, null); assert.ok(fake[1].level != null);
});

t('順位相関: 同じ並びは+1・逆は-1・定数は null', () => {
  assert.ok(Math.abs(G.rankCorr([1, 2, 3, 4], [10, 20, 30, 40]) - 1) < 1e-9);
  assert.ok(Math.abs(G.rankCorr([1, 2, 3, 4], [4, 3, 2, 1]) + 1) < 1e-9);
  assert.equal(G.rankCorr([1, 1, 1], [1, 2, 3]), null);
  assert.equal(G.rankCorr([1, 2], [1, 2]), null);
});

t('実績との照合: README・画面に書いた値（地区ごとの色の平均と、別の期間・人目）', () => {
  const m = G.meshLevels(cells.rows, tiers), by = {};
  cells.regions.forEach((nm, i) => { const x = m.filter((c) => c.region === i); by[nm] = { mean: x.reduce((a, c) => a + c.level, 0) / x.length, quiet: x.filter((c) => c.quiet).length / x.length, n: x.length }; });
  const names = cells.regions;
  const rate711 = names.map((nm) => d711.rows.find((r) => r.area === nm).rate), rate89 = names.map((nm) => d89.rows.find((r) => r.area === nm).rate);
  const rho1 = G.rankCorr(rate711, names.map((nm) => by[nm].mean)), rho2 = G.rankCorr(rate89, names.map((nm) => by[nm].mean)), rho3 = G.rankCorr(rate711, names.map((nm) => by[nm].quiet));
  // 人目の少なさは地区どうしで被害率と逆向き（県西は被害率が最大なのに人目が少ないメッシュの割合が最小）
  assert.ok(rho3 < 0, 'rho3 ' + rho3);
  assert.equal(Math.min(...names.map((nm) => by[nm].quiet)), by['県西'].quiet);
  assert.ok(rho1 > 0.8, 'rho1 ' + rho1);
  console.log('照合: 色の平均×令和7年11月末 ' + rho1.toFixed(2) + ' ／ ×令和8年9月末 ' + rho2.toFixed(2) + ' ／ 人目の少ない割合×被害率 ' + rho3.toFixed(2));
  console.log('色の分布', JSON.stringify(Object.fromEntries(names.map((nm, i) => [nm, [0, 1, 2, 3].map((l) => m.filter((c) => c.region === i && c.level === l).length)]))));
  assert.equal(rho1.toFixed(2), process.env.EXPECT_RHO1 || rho1.toFixed(2));
});

const ctx = (extra) => Object.assign({ cells: cells.rows, pops: grid, items: ck.items, conds: risk.conds, tiers, regionNames: cells.regions }, extra || {});

t('診断: 位置→メッシュ→地区・人口、対策の未実施・不明、区分による項目の違い', () => {
  const items = ck.items;
  const base = { lon: 140.4468, lat: 36.3418, cls: 'unknown', answers: {}, cond: {} };
  const r0 = G.diagnose(base, ctx());
  assert.equal(r0.code.length, 8);
  assert.equal(r0.total, items.length);
  assert.equal(r0.done, 0); assert.equal(r0.notDone.length, 0); assert.equal(r0.unknown.length, items.length);
  assert.ok(r0.quietPos >= 0 && r0.quietPos <= 100);
  assert.ok(r0.region && r0.region.name && r0.region.tier >= 0);
  assert.equal(r0.localPop3km, undefined, '診断は約5kmメッシュの人口だけを使う');
  const ans = {}; items.forEach((it, i) => { ans[it.id] = i % 3 === 0 ? 'yes' : i % 3 === 1 ? 'no' : 'unknown'; });
  const r1 = G.diagnose({ ...base, answers: ans }, ctx());
  assert.equal(r1.done + r1.notDone.length + r1.unknown.length, r1.total);
  const low = G.diagnose({ ...base, cls: 'low' }, ctx()), high = G.diagnose({ ...base, cls: 'high' }, ctx()), sp = G.diagnose({ ...base, cls: 'special' }, ctx());
  [low, high, sp].forEach((r) => assert.ok(r.total < items.length && r.total >= 13));
  assert.ok(low.unknown.some((i) => i.id === 'pole_barrier') && !high.unknown.some((i) => i.id === 'pole_barrier'));
  assert.ok(high.unknown.some((i) => i.id === 'pcs_conduit') && sp.unknown.some((i) => i.id === 'hotspot'));
});

t('診断: 人口の少ない地点ほど人口密度が低く「人目が少ない」側（単調）', () => {
  const urban = G.diagnose({ lon: 140.1, lat: 36.08, cls: 'low', answers: {}, cond: {} }, ctx());
  const rural = G.diagnose({ lon: 140.35, lat: 36.75, cls: 'low', answers: {}, cond: {} }, ctx());
  assert.ok(rural.cellDensity < urban.cellDensity);
  assert.ok(rural.quietPos > urban.quietPos);
  assert.equal(rural.autoQuiet, true);
});

const cond = (id) => risk.conds.find((c) => c.id === id);
t('条件の判定: 本人の回答・対策の回答から導く・公開データから自動', () => {
  const ev = (cond_, cl, auto) => Object.fromEntries(G.evalConds(risk.conds, cond_, cl, auto).map((e) => [e.id, e.state + ':' + e.by]));
  // 何も答えない: 人目だけは公開データから自動、他は不明
  let e = ev({}, {}, true);
  assert.equal(e.quiet, 'risk:auto'); assert.equal(e.hidden, 'unknown:none'); assert.equal(e.nosec, 'unknown:none'); assert.equal(e.stock, 'unknown:none');
  assert.equal(ev({}, {}, false).quiet, 'ok:auto');
  // 本人の回答が自動より優先
  assert.equal(ev({ quiet: 'no' }, {}, true).quiet, 'ok:answer'); assert.equal(ev({ quiet: 'yes' }, {}, false).quiet, 'risk:answer');
  assert.equal(ev({ escape: 'yes', stock: 'no' }, {}).escape, 'risk:answer'); assert.equal(ev({ escape: 'yes', stock: 'no' }, {}).stock, 'ok:answer');
  // 防犯設備なし: どれも実施していない（1つ以上が「実施していない」）→当てはまる。1つでも実施→当てはまらない。全部不明→不明
  assert.equal(ev({}, { camera: 'no' }).nosec, 'risk:derived');
  assert.equal(ev({}, { camera: 'no', fence_sensor: 'yes' }).nosec, 'ok:derived');
  assert.equal(ev({}, { camera: 'unknown', alarm: 'unknown' }).nosec, 'unknown:none');
  assert.equal(ev({}, { camera: 'yes' }).nosec, 'ok:derived');
  // 転がし配管・保守: どちらかが「実施していない」→当てはまる。両方実施→当てはまらない。片方だけ実施→不明
  assert.equal(ev({}, { pipes_buried: 'no' }).exposed, 'risk:derived');
  assert.equal(ev({}, { pipes_buried: 'yes', collector_cover: 'yes' }).exposed, 'ok:derived');
  assert.equal(ev({}, { pipes_buried: 'yes' }).exposed, 'unknown:none');
  assert.equal(ev({}, { weed_fence: 'yes', patrol: 'no' }).upkeep, 'risk:derived');
  // 条件の設定: すべてに出典と「なぜ」がある。導く条件の項目はチェックリストに実在する
  const ids = new Set(ck.items.map((i) => i.id));
  risk.conds.forEach((c) => {
    assert.ok(c.why && c.why.length > 20 && c.src.length > 0, c.id);
    c.src.forEach((s) => assert.ok(risk.sources[s].url.startsWith('https://'), s));
    if (c.derive) c.derive.items.forEach((i) => assert.ok(ids.has(i), i));
    else assert.ok(c.ask || c.auto, c.id);
  });
  assert.equal(risk.conds.length, 7);
});

t('診断: 点数・色（下限と、わからない項目がすべて当てはまった場合の上限）', () => {
  const pt = { lon: 140.1, lat: 36.08, cls: 'unknown' };  // 県西側（段階は実データで確認）
  const a = G.diagnose({ ...pt, answers: {}, cond: {} }, ctx());
  assert.ok(a.scoreMax >= a.scoreMin && a.levelMax >= a.levelMin);
  assert.equal(a.scoreMax - a.scoreMin, a.unknownCount);
  assert.equal(a.riskCount + a.unknownCount + a.conds.filter((c) => c.state === 'ok').length, 7);
  // すべて「当てはまる」と答える／すべて問題なしと答えると、色の幅が閉じる
  const worst = {}; ['quiet', 'hidden', 'escape', 'stock'].forEach((k) => { worst[k] = 'yes'; });
  const wAns = {}; ['weed_fence', 'patrol', 'fence_sensor', 'machine_security', 'camera', 'alarm', 'pipes_buried', 'collector_cover'].forEach((k) => { wAns[k] = 'no'; });
  const w = G.diagnose({ ...pt, answers: wAns, cond: worst }, ctx());
  assert.equal(w.riskCount, 7); assert.equal(w.unknownCount, 0); assert.equal(w.levelMin, w.levelMax);
  assert.equal(w.scoreMin, G.W_REGION * w.region.tier + 7);
  const best = {}; ['quiet', 'hidden', 'escape', 'stock'].forEach((k) => { best[k] = 'no'; });
  const bAns = {}; ['weed_fence', 'patrol', 'pipes_buried', 'collector_cover'].forEach((k) => { bAns[k] = 'yes'; }); bAns.camera = 'yes';
  const b = G.diagnose({ ...pt, answers: bAns, cond: best }, ctx());
  assert.equal(b.riskCount, 0); assert.equal(b.unknownCount, 0); assert.equal(b.scoreMin, G.W_REGION * b.region.tier);
  assert.ok(w.levelMin > b.levelMin);
  // 色の切り方（仮）
  assert.deepEqual([0, 3, 4, 6, 7, 8, 9, 11].map(G.diagLevel), [0, 0, 1, 1, 2, 2, 3, 3]);
  // 規模の区分は点数に影響しない
  const lo = G.diagnose({ ...pt, cls: 'low', answers: {}, cond: {} }, ctx()), hi = G.diagnose({ ...pt, cls: 'special', answers: {}, cond: {} }, ctx());
  assert.equal(lo.scoreMin, hi.scoreMin);
});

t('診断: 公開メッシュでない地点は近くの公開メッシュの地区で代用（10km以内）、遠ければ地区なし', () => {
  const r = cells.rows[0];
  const own = G.regionAt(cells.rows, r[0], r[1]);
  assert.deepEqual(own, { idx: r[6], near: false });
  const used = new Set(cells.rows.map((x) => x[0] + ',' + x[1]));
  let hole = null;
  for (let dx = -2; dx <= 2 && !hole; dx++) for (let dy = -2; dy <= 2 && !hole; dy++) if (!used.has((r[0] + dx) + ',' + (r[1] + dy))) hole = [r[0] + dx, r[1] + dy];
  if (hole) { const g = G.regionAt(cells.rows, hole[0], hole[1]); assert.ok(g && g.near === true); }
  assert.equal(G.regionAt(cells.rows, 0, 0), null);
  // 地区なしでも診断は動く（地区の点数は下限で0、上限で最大4点を足す）
  const none = G.diagnose({ lon: 140.4468, lat: 36.3418, cls: 'unknown', answers: {}, cond: {} }, ctx({ cells: [] }));
  assert.equal(none.region, null); assert.equal(none.scoreMax - none.scoreMin, none.unknownCount + G.W_REGION * 2);
});

t('座標の入力: 全角を受け付け、カンマ・文字混じり・空は拒否', () => {
  assert.equal(G.parseCoord('36.34'), 36.34);
  assert.equal(G.parseCoord(' ３６．３４ '), 36.34);
  assert.equal(G.parseCoord('140'), 140);
  assert.equal(G.parseCoord('-1.5'), -1.5);
  ['36,34', '36.34abc', '', 'abc', '36.', '.5', '1e3', null, undefined, '36.3 4'].forEach((x) => assert.equal(G.parseCoord(x), null, String(x)));
});

t('県内判定: 県の陸域・湖沼の1kmメッシュ。海上・千葉・栃木・福島は外', () => {
  const land = G.landSet(J('land.json').rows);
  const at = (lat, lon) => { const m = G.toMesh(lon, lat); return land(m.ix, m.iy); };
  [[36.3418, 140.4468], [36.2913, 140.1517], [36.75, 140.35], [36.08, 140.1], [36.0, 140.3]].forEach(([a, o]) => assert.ok(at(a, o), a + ',' + o));
  [[36.0, 140.85], [35.75, 140.0], [36.95, 139.7], [37.1, 140.5], [34.0, 135.0], [36.3, 141.0]].forEach(([a, o]) => assert.ok(!at(a, o), a + ',' + o));
});

t('診断: 同じ約5kmメッシュの2点で結果が同じ（色・地区・人口）', () => {
  const m = G.toMesh(140.4468, 36.3418), b = G.cellBounds(m.cx, m.cy);
  const ans = { camera: 'no', pipes_buried: 'no' }, c = { hidden: 'yes' };
  const a = G.diagnose({ lon: b[0] + 0.004, lat: b[1] + 0.004, cls: 'unknown', answers: ans, cond: c }, ctx()), z = G.diagnose({ lon: b[2] - 0.004, lat: b[3] - 0.004, cls: 'unknown', answers: ans, cond: c }, ctx());
  assert.equal(a.code, z.code); assert.equal(a.cellPopulation, z.cellPopulation); assert.equal(a.quietPos, z.quietPos);
  assert.equal(a.scoreMin, z.scoreMin); assert.equal(a.scoreMax, z.scoreMax); assert.deepEqual(a.region, z.region);
  assert.equal(a.code, G.meshCode(m.cx * G.CELL, m.cy * G.CELL));
  const sea = G.diagnose({ lon: 140.85, lat: 36.0, cls: 'unknown', answers: {}, cond: {} }, ctx());
  assert.ok(sea.quietPos >= 0 && sea.quietPos <= 100 && sea.autoQuiet === true);
});

console.log('lib_test OK', n);
