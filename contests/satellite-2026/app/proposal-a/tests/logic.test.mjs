// usage: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ageNorm, satNorm, segScore, rank, selectByBudget, totalKm, auc, calibrate, exclusionAccuracy } from '../logic.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/sample.json', import.meta.url)));
const cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]));

test('正規化は0〜1に収まる', () => {
  assert.equal(ageNorm(2026), 0); assert.equal(ageNorm(1900), 1); assert.equal(ageNorm(1996), 0.5);
  assert.equal(satNorm(0), 0); assert.equal(satNorm(-20), 1); assert.equal(satNorm(4), 0); assert.equal(satNorm(-4), 0.5);
});

test('点数: w=0で台帳のみ、w=1で衛星のみ', () => {
  const s = { cell: 'A3', year: 1966 };
  assert.equal(segScore(s, cellSat, 0), 1);
  assert.equal(segScore(s, cellSat, 1), cellSat.A3);
  const m = segScore(s, { A3: 0.5 }, 0.5); assert.equal(m, 0.75);
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

test('サンプルデータの整合性', () => {
  assert.ok(data.note.includes('架空'));
  const ids = new Set(data.segments.map((s) => s.id));
  assert.equal(ids.size, data.segments.length);
  const cells = new Set(data.cells.map((c) => c.id));
  for (const s of data.segments) { assert.ok(cells.has(s.cell)); assert.ok(s.lenM > 0); assert.equal(s.coords.length, 2); }
  assert.ok(data.segments.filter((s) => s.cls === 'life' && !s.surveyed).length > 50);
});
