// usage: node tests/lib_test.mjs  （proposal-alpha ディレクトリで。node 22）
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const L = require('../lib.js');
const load = (f, name) => { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'), ctx); return JSON.parse(JSON.stringify(ctx.window[name])); };
const D = load('sample.js', 'SAMPLE'), CHM = load('real.js', 'CHM');
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };
const sec = (id) => D.sections.find((s) => s.id === id);

// ---- 架空サンプル ----
t('サンプルは14区間・ID重複なし・すべて「架空」と明示', () => {
  assert.equal(D.sections.length, 14);
  assert.equal(new Set(D.sections.map((s) => s.id)).size, 14);
  D.sections.forEach((s) => assert.ok(/^架空/.test(s.name), s.id + ' の名称に「架空」がない'));
  assert.ok(/架空/.test(D.depot.name));
  assert.ok(/^\/\/ 架空サンプル/.test(fs.readFileSync(new URL('../data/sample.js', import.meta.url), 'utf8')));
});
t('点数は内訳の合計で、衛星・公開由来と事業者由来の合計に一致', () => {
  D.sections.forEach((s) => {
    const r = L.scoreSection(s, null, D.refYear);
    assert.equal(r.score, r.parts.reduce((a, p) => a + p[1], 0));
    assert.equal(r.score, r.satScore + r.opScore);
    assert.equal(r.parts.filter((p) => p[2] === 'sat').length, 4);
    assert.ok(r.parts.every((p) => p[1] >= 0));
  });
});
t('順位は点数降順・連番・同点は延長→IDで安定', () => {
  const r = L.rank(D.sections, null, D.refYear, []);
  assert.equal(r.length, 14);
  r.forEach((s, i) => { assert.equal(s.rank, i + 1); if (i) assert.ok(r[i - 1].score >= s.score); });
  assert.deepEqual(r.map((s) => s.id), L.rank(D.sections.slice().reverse(), null, D.refYear, []).map((s) => s.id));
});
t('谷筋・倒木疑い・避難所・過去の倒木がそろう F1-03 が1位、低木の平地 F3-01 は下位', () => {
  const r = L.rank(D.sections, null, D.refYear, []);
  assert.equal(r[0].id, 'F1-03');
  assert.ok(r.find((s) => s.id === 'F3-01').rank >= 12);
});
t('事業者データを重ねると、病院を含む F2-01 の順位が衛星のみより上がる', () => {
  const full = L.rank(D.sections, null, D.refYear, []).find((s) => s.id === 'F2-01').rank;
  const sat = L.rank(D.sections, null, D.refYear, [], true).find((s) => s.id === 'F2-01').rank;
  assert.ok(full < sat, `full=${full} sat=${sat}`);
});
t('衛星のみの並べ替えは事業者由来の点数を含まない', () => {
  L.rank(D.sections, null, D.refYear, [], true).forEach((s) => assert.equal(s.score, s.satScore));
});
t('重みを変えると順位が変わる（倒木疑いの重みを0に）', () => {
  const w = JSON.parse(JSON.stringify(L.DEFAULT_WEIGHTS)); w.change['倒木・裸地化の疑い'] = 0;
  const a = L.rank(D.sections, null, D.refYear, []).find((s) => s.id === 'F2-03').score;
  const b = L.rank(D.sections, w, D.refYear, []).find((s) => s.id === 'F2-03').score;
  assert.equal(a - b, 25);
});
t('伐採履歴なしは仮の中間点、前回伐採が古いほど加点', () => {
  const base = { p90: 0, tallPct: 0, change: '変化なし', terrain: '平地', customers: 0, facility: 'なし', road: '道路なし', pastFall: false };
  const c = (lastCut) => L.scoreSection(Object.assign({}, base, { lastCut }), null, 2026).score;
  assert.equal(c(null), 4); assert.equal(c(2024), 0); assert.equal(c(2020), 4); assert.equal(c(2014), 8);
});
t('最新の現地確認が台帳に戻る（後の記録が優先）', () => {
  const res = [{ siteId: 'F1-03', result: '要継続観察', date: '2026-10-01' }, { siteId: 'F1-03', result: '要伐採', date: '2026-10-05' }];
  assert.equal(L.rank(D.sections, null, D.refYear, res).find((s) => s.id === 'F1-03').latest.result, '要伐採');
});
t('巡視計画: 上位n区間をすべて回り、周回距離は区間の和と一致', () => {
  const r = L.rank(D.sections, null, D.refYear, []);
  const p = L.planRoute(r, D.depot, 4);
  assert.deepEqual(new Set(p.route.map((s) => s.id)), new Set(r.slice(0, 4).map((s) => s.id)));
  let tot = 0, cur = [D.depot.x, D.depot.y];
  p.route.forEach((s) => { tot += L.dist(cur, L.mid(s)); cur = L.mid(s); }); tot += L.dist(cur, [D.depot.x, D.depot.y]);
  assert.ok(Math.abs(tot - p.total) < 1e-9);
  assert.equal(L.planRoute(r, D.depot, 0).route.length, 0);
});
t('集計: 区分ごとの件数と要伐採数', () => {
  const res = [{ siteId: 'F1-03', result: '要伐採' }, { siteId: 'F2-03', result: '問題なし' }, { siteId: 'F1-02', result: '要伐採' }, { siteId: 'XX', result: '要伐採' }];
  const st = L.hitStats(D.sections, res, 'change');
  assert.deepEqual(st['倒木・裸地化の疑い'], { n: 2, hit: 1 });
  assert.deepEqual(st['変化なし'], { n: 1, hit: 1 });
});
t('CSV: 式として解釈される先頭文字を無効化し、引用符を二重化', () => {
  assert.equal(L.csvCell('=1+1'), "'=1+1");
  assert.equal(L.csvCell('a"b'), '"a""b"');
  assert.equal(L.csvCell('a,b'), '"a,b"');
  assert.ok(L.toCSV(['x'], [['y']]).startsWith('﻿'));
});

// ---- 線沿いの集計（合成データ） ----
t('alongLine: 線が高木帯を横切る区間だけ最大値が出る', () => {
  const n = 40, h = Array.from({ length: n }, () => Array(n).fill(0));
  for (let r = 0; r < n; r++) for (let c = 20; c < 24; c++) h[r][c] = 20;
  const r = L.alongLine({ n, h }, 10, [[2, 20], [38, 20]], 10, 15, 100);
  assert.equal(Math.round(r.lengthM), 360);
  assert.equal(r.max, 20);
  assert.equal(r.chunks.length, 4);
  assert.equal(r.chunks[0].max, 0);       // 0〜100m（列2〜12）は樹木なし
  assert.equal(r.chunks[1].max, 20);      // 列20〜24 は 100〜220 m の位置
  assert.ok(r.tallShare > 0 && r.tallShare < 0.5);
});
t('alongLine: 高木のしきい値で割合が変わり、長さ0は空の結果', () => {
  const n = 20, h = Array.from({ length: n }, () => Array(n).fill(12));
  assert.equal(L.alongLine({ n, h }, 10, [[2, 10], [18, 10]], 10, 15, 100).tallShare, 0);
  assert.equal(L.alongLine({ n, h }, 10, [[2, 10], [18, 10]], 10, 10, 100).tallShare, 1);
  assert.equal(L.alongLine({ n, h }, 10, [[5, 5]], 10, 15, 100).cells, 0);
});
t('tileOf: 既知の点（経度0・緯度0 の z=1）はタイル(1,1)', () => {
  const r = L.tileOf(0, 0, 1); assert.equal(r.x, 1); assert.equal(r.y, 1);
});

// ---- 実データ（Meta・WRI 樹高マップの窓） ----
t('実データ: 200×200セル・整数・0〜40m・樹木ありの割合が妥当・東京タイルの範囲内', () => {
  assert.equal(CHM.n, 200); assert.equal(CHM.h.length, 200);
  CHM.h.forEach((row) => { assert.equal(row.length, 200); row.forEach((v) => assert.ok(Number.isInteger(v) && v >= 0 && v <= 40)); });
  const frac = CHM.h.flat().filter((v) => v > 0).length / 40000;
  assert.ok(frac > 0.2 && frac < 0.7, 'frac=' + frac);
  assert.ok(CHM.nw[0] > 139.219 && CHM.se[0] < 139.922 && CHM.se[1] > 35.461 && CHM.nw[1] < 36.031);
  assert.ok(CHM.nw[0] < CHM.se[0] && CHM.nw[1] > CHM.se[1]);
});
t('実データ: 出典・撮影日・取得日・ライセンスの記載', () => {
  assert.ok(/CC BY 4\.0/.test(CHM.source) && /Meta/.test(CHM.source) && /WRI/.test(CHM.source));
  assert.match(CHM.acq, /^\d{4}-\d{2}-\d{2}$/); assert.match(CHM.fetched, /^\d{4}-\d{2}-\d{2}$/);
});
t('実データ: 例の線で集計でき、結果が範囲内', () => {
  const lat = (CHM.nw[1] + CHM.se[1]) / 2;
  const wpx = L.tileOf(CHM.se[0], lat, 16).wx - L.tileOf(CHM.nw[0], lat, 16).wx;
  const cellM = 156543.03392 * Math.cos(lat * Math.PI / 180) / 65536 * wpx / CHM.n;
  assert.ok(cellM > 10 && cellM < 14, 'cellM=' + cellM);
  const r = L.alongLine(CHM, cellM, [[110, 150], [80, 135], [55, 125], [40, 110]], 15, 15, 100);
  assert.ok(r.lengthM > 800 && r.lengthM < 1200, 'len=' + r.lengthM);
  assert.ok(r.cells > 50 && r.max >= 0 && r.max <= 40 && r.tallShare >= 0 && r.tallShare <= 1);
  assert.ok(r.chunks.length >= 8);
  assert.ok(r.max >= 15 && r.tallShare > 0.1, "例の線は高木のある所を通る");
});
console.log(`\n${n} tests passed`);
