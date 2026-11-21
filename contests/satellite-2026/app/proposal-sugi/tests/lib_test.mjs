// node --test tests/ で実行（ブラウザ・ネット不要）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const require = createRequire(import.meta.url);
const L = require(path.join(root, 'lib.js'));
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'data/data.js'), 'utf8'), ctx);
const D = ctx.window.SUGI;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const uniform = () => new Array(16).fill(1 / 16);
const only = (i) => { const f = new Array(16).fill(0); f[i] = 1; return f; };
const cell = { lat: 35.8, lon: 139.25, ha: 10 };
const dLat = (m) => 35.8 + m / 111320; // m メートル北の緯度

test('風下の向き: 区画の真北にいる人口は、南風（風が南から吹く）のとき風下', () => {
  const pop = [[dLat(1000), 139.25, 100]];
  const south = L.evaluate(cell, pop, { freq: only(8) }, { radiusKm: 3, useWind: true });
  const north = L.evaluate(cell, pop, { freq: only(0) }, { radiusKm: 3, useWind: true });
  assert.equal(south.down, 100 * 16);
  assert.equal(north.down, 0);
});
test('風向を使わない場合は半径内の人口そのもの。半径外は数えない', () => {
  const pop = [[dLat(1000), 139.25, 100], [dLat(4000), 139.25, 500]];
  const r = L.evaluate(cell, pop, { freq: only(0) }, { radiusKm: 3, useWind: false });
  assert.equal(r.within, 100);
  assert.equal(r.down, 100);
  assert.equal(L.evaluate(cell, pop, { freq: uniform() }, { radiusKm: 5, useWind: false }).within, 600);
});
test('方角別の人口の合計は半径内の人口に等しい', () => {
  const pop = D.pop.slice(0, 2000);
  const r = L.evaluate({ lat: 35.8, lon: 139.25 }, pop, D.meta.wind, { radiusKm: 5, useWind: true });
  assert.equal(r.byDir.reduce((a, b) => a + b, 0), r.within);
});
test('windIndexFor / dirIndex', () => {
  assert.equal(L.windIndexFor(0), 8);
  assert.equal(L.windIndexFor(90), 12);
  assert.equal(L.dirIndex(0), 0);
  assert.equal(L.dirIndex(359), 0);
  assert.equal(L.dirIndex(90), 4);
});
test('実データで順位が降順・連番になる', () => {
  const R = L.buildRows(D, {});
  assert.equal(R.rows.length, D.cells.length);
  R.ranked.forEach((r, i) => { assert.equal(r.rank, i + 1); if (i) assert.ok(R.ranked[i - 1].index >= r.index); });
  assert.ok(R.ranked[0].index > 0);
});
test('並び順の切り替えと、冬の緑が弱い区画の除外', () => {
  const byHa = L.buildRows(D, { sortKey: 'ha' });
  assert.ok(byHa.ranked[0].ha >= byHa.ranked[10].ha);
  const all = L.buildRows(D, {}), ex = L.buildRows(D, { excludeWeak: true });
  const weak = all.rows.filter((r) => r.weak === true).length;
  assert.ok(weak > 0);
  assert.equal(ex.ranked.length, all.rows.length - weak);
  assert.ok(ex.rows.filter((r) => r.weak === true).every((r) => r.rank === null));
});
test('風向を使うかどうかで順位が変わりうる（結果が同一ではない）', () => {
  const a = L.buildRows(D, { useWind: true }).ranked.slice(0, 30).map((r) => r.code).join();
  const b = L.buildRows(D, { useWind: false }).ranked.slice(0, 30).map((r) => r.code).join();
  assert.notEqual(a, b);
});
test('CSV: BOM・列数・エスケープ・式の無効化', () => {
  assert.equal(L.csvCell('a,b'), '"a,b"');
  assert.equal(L.csvCell('x"y'), '"x""y"');
  assert.equal(L.csvCell('=1+1'), "'=1+1");
  assert.equal(L.csvCell(-3), '-3');
  assert.equal(L.csvCell(null), '');
  const R = L.buildRows(D, {});
  const csv = L.toCsv(R.ranked.slice(0, 3), R.params, D.meta);
  assert.ok(csv.startsWith('﻿順位,'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 1 + 3 + 1);
  const count = (s) => { let n = 1, q = false; for (const ch of s) { if (ch === '"') q = !q; else if (ch === ',' && !q) n++; } return n; };
  assert.equal(count(lines[1]), count(lines[0]));
  assert.equal(count(lines[0]), 12);
  assert.ok(lines[4].includes('半径3km'));
});
test('データの整合: 範囲・コード・風向・衛星の出典', () => {
  const [x0, y0, x1, y1] = D.meta.bbox;
  assert.equal(D.cells.length, D.geo.features.length);
  const seen = new Set();
  for (const [code, ha, w, s, lat, lon] of D.cells) {
    assert.match(code, /^\d{9}$/);
    assert.ok(!seen.has(code)); seen.add(code);
    assert.ok(ha > 0 && ha < 30);
    assert.ok(lat >= y0 && lat <= y1 && lon >= x0 && lon <= x1);
    for (const v of [w, s]) assert.ok(v === null || (v > -1 && v < 1));
  }
  assert.ok(D.geo.features.every((f) => seen.has(f.properties.code)));
  const sum = D.meta.wind.freq.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01);
  assert.equal(D.meta.wind.freq.length, 16);
  assert.ok(D.pop.length > 1000 && D.pop.every((p) => p[2] >= 0 && Number.isFinite(p[0]) && Number.isFinite(p[1])));
  assert.match(D.meta.scenes.w.id, /^S2[AB]_54SUE_/);
  assert.match(D.meta.scenes.s.id, /^S2[AB]_54SUE_/);
});
test('画面の表示規約: 実データ・仮置きの明示、外部送信なし、色の指定', () => {
  const html = read('index.html'), app = read('app.js');
  assert.ok(html.includes('実データ') && html.includes('仮置き'));
  assert.ok(!/<script[^>]+src="https?:/.test(html));
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|method:\s*'POST'/.test(app));
  assert.ok(!/#0f0|#00ff00|green/.test(read('style.css')));
});
