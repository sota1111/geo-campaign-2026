// usage: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ageNorm, satNorm, segScore, rank, selectByBudget, totalKm, auc, calibrate, exclusionAccuracy, topShift, AGE_UNKNOWN } from '../logic.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/toyonaka.json', import.meta.url)));
const cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]));

test('正規化は0〜1に収まる', () => {
  assert.equal(ageNorm(2026), 0); assert.equal(ageNorm(1900), 1); assert.equal(ageNorm(1996), 0.5);
  assert.equal(satNorm(0), 0); assert.equal(satNorm(-20), 1); assert.equal(satNorm(4), 0); assert.equal(satNorm(-4), 0.5);
});

test('点数: w=0で台帳のみ、w=1で衛星のみ', () => {
  const s = { cell: 'A3', year: 1966 };
  assert.equal(segScore(s, { A3: 0.2 }, 0), 1);
  assert.equal(segScore(s, { A3: 0.2 }, 1), 0.2);
  const m = segScore(s, { A3: 0.5 }, 0.5); assert.equal(m, 0.75);
});

test('竣工年が不明(null)の古さは中立の0.5', () => {
  assert.equal(AGE_UNKNOWN, 0.5);
  assert.equal(ageNorm(null), 0.5); assert.equal(ageNorm(undefined), 0.5);
  assert.equal(segScore({ cell: 'A', year: null }, { A: 0 }, 0), 0.5);
});

test('topShift: 衛星が全区画で同じ値なら台帳のみと順位は変わらない／区画で差があれば入れ替わる', () => {
  const segs = [];
  for (let i = 0; i < 30; i++) segs.push({ id: 'S' + String(i).padStart(2, '0'), cls: 'life', surveyed: false, cell: i < 15 ? 'A' : 'B', year: 1960 + i, lenM: 50 });
  assert.equal(topShift(segs, { A: 0.2, B: 0.2 }, 1, 10), 0);
  assert.ok(topShift(segs, { A: 0, B: 1 }, 1, 10) > 0);
});

test('rank は降順で、同点はidで安定', () => {
  const r = rank(data.segments, cellSat, 0.5);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  assert.deepEqual(rank(data.segments, cellSat, 0.5).map((x) => x.id), r.map((x) => x.id));
});

test('selectByBudget: 未調査の生活道路のみ・予算内・上位優先', () => {
  const r = rank(data.segments, cellSat, 0.5);
  const ids = selectByBudget(r, 3);
  const set = new Set(ids);
  assert.ok(ids.length > 0);
  assert.ok(totalKm(data.segments, set) <= 3);
  for (const id of ids) { const s = data.segments.find((x) => x.id === id); assert.equal(s.cls, 'life'); assert.equal(s.surveyed, false); }
  assert.equal(selectByBudget(r, 0).length, 0);
  // 最上位の候補は必ず含まれる（1区間は3kmより短い）
  const top = r.find((s) => s.cls === 'life' && !s.surveyed);
  assert.ok(set.has(top.id));
});

test('auc: 完全分離=1、逆=0、同点=0.5、片側なし=null', () => {
  assert.equal(auc([{ hit: true, score: 2 }, { hit: false, score: 1 }]), 1);
  assert.equal(auc([{ hit: true, score: 1 }, { hit: false, score: 2 }]), 0);
  assert.equal(auc([{ hit: true, score: 1 }, { hit: false, score: 1 }]), 0.5);
  assert.equal(auc([{ hit: true, score: 1 }]), null);
});

test('calibrate: 衛星が当たるデータでは衛星の重みが大きくなる／データ不足はnull', () => {
  const cs = { A: 1, B: 0 };
  // 台帳の古さは無関係（同じ年）、区画Aだけ空洞
  const sc = [];
  for (let i = 0; i < 5; i++) { sc.push({ cell: 'A', year: 1990 + i, hit: true }); sc.push({ cell: 'B', year: 1990 + i, hit: false }); }
  const c = calibrate(sc, cs);
  assert.ok(c.w >= 0.5);
  assert.equal(c.satOnly, 1);
  const few = calibrate(sc.slice(0, 4), cs);
  assert.equal(few.w, null); assert.equal(few.reason, 'データ不足');
});

test('calibrate: 台帳が当たるデータでは衛星の重みが小さくなる', () => {
  const cs = { A: 0.5, B: 0.5 };
  const sc = [];
  for (let i = 0; i < 5; i++) { sc.push({ cell: 'A', year: 1962, hit: true }); sc.push({ cell: 'B', year: 2020, hit: false }); }
  assert.ok(calibrate(sc, cs).w <= 0.5);
});

test('exclusionAccuracy: 下位半分の異常なし割合。件数不足はnull', () => {
  const cs = { A: 0 };
  const sc = [];
  for (let i = 0; i < 10; i++) sc.push({ cell: 'A', year: 1970 + i * 4, hit: i < 5 });
  const e = exclusionAccuracy(sc, cs, 0);
  assert.equal(e.n, 5); assert.equal(e.rate, 1);
  assert.equal(exclusionAccuracy(sc.slice(0, 6), cs, 0), null);
});

test('実データ（豊中市北東部）の整合性', () => {
  assert.ok(data.note.includes('実データ') && data.note.includes('架空'));
  const sat = data.satellite;
  assert.equal(sat.class_width_mm_yr, 3.75); assert.equal(sat.classes, 16);
  assert.ok(!JSON.stringify(sat).includes('Sentinel'));
  const ids = new Set(data.segments.map((s) => s.id));
  assert.equal(ids.size, data.segments.length);
  const cells = new Map(data.cells.map((c) => [c.id, c]));
  for (const c of data.cells) {
    assert.ok(Number.isInteger(c.k) && c.k >= 0 && c.k < 16);
    assert.ok(Math.abs(c.disp - (-30 + 3.75 * (c.k + 0.5))) < 1e-9);       // 階級の中央値
    assert.ok(Math.abs(c.range[1] - c.range[0] - 3.75) < 1e-9);             // 階級幅
    assert.equal(c.ring.length, 5);
  }
  const [w, s, e, n] = data.area.bbox;
  for (const sg of data.segments) {
    assert.ok(cells.has(sg.cell)); assert.ok(sg.lenM > 0); assert.equal(sg.coords.length, 2);
    assert.ok(['life', 'arterial', 'noledger'].includes(sg.cls));
    for (const [lo, la] of sg.coords) assert.ok(lo > w - 0.002 && lo < e + 0.002 && la > s - 0.002 && la < n + 0.002);
    if (sg.cls === 'life') assert.ok(sg.year === null || (sg.year >= 1900 && sg.year <= 2026));
    if (sg.cls === 'noledger') assert.equal(sg.surveyed, false);
    if (sg.cls === 'arterial') assert.equal(sg.surveyed, true);
  }
  assert.ok(data.segments.filter((s) => s.cls === 'life' && !s.surveyed).length > 500);
  // 統計と本体の一致、突き合わせ率の根拠
  const st = data.stats, by = (c) => data.segments.filter((s) => s.cls === c).length;
  assert.equal(st.segments, data.segments.length);
  assert.equal(st.segments_by_cls.life, by('life')); assert.equal(st.segments_by_cls.arterial, by('arterial')); assert.equal(st.segments_by_cls.noledger, by('noledger'));
  const r15 = st.match_rate_by_threshold['15m'];
  assert.ok(r15.matched <= r15.of && Math.abs(r15.rate - r15.matched / r15.of) < 1e-3);
  assert.equal(st.life_year_unknown, data.segments.filter((s) => s.cls === 'life' && s.year === null).length);
  assert.equal(st.cells_with_roads, data.cells.length);
});

test('実データで衛星の点数が効きにくい（階級が少なく同点が多い）', () => {
  const ks = new Set(data.cells.map((c) => c.k));
  assert.ok(ks.size <= 3);
  const r = rank(data.segments, cellSat, 1).filter((s) => s.cls === 'life' && !s.surveyed);
  assert.ok(new Set(r.map((s) => s.score)).size <= ks.size);     // 衛星のみの点数は階級の数だけ
  assert.ok(Math.max(...Object.values(cellSat)) < 0.5);          // どの区画も衛星の点数は小さい
});
