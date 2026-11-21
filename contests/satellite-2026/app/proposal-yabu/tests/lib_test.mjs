// node tests/lib_test.mjs   （node 22。ロジックとデータの整合性）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const L = require(path.join(root, 'lib.js'));
const D = JSON.parse(fs.readFileSync(path.join(root, 'data/yabu.json'), 'utf8'));
const W = L.normalizeWeights(null);
const mk = (o) => ({ id: 'Y001', lat: 35.5, lon: 135.1, ring: [], ndvi_g: 0.7, ndvi_w: 0.3, edge: 0.3, d_house: 100, n_house300: 5, d_school: 500, school: '校', n_sight500: 10, n_sight500_recent: 5, n_sight500_village: 4, last_year: 2018, ...o });

test('重みの初期値は合計100・衛星由来は3項目', () => {
  assert.equal(L.KEYS.reduce((a, k) => a + W[k], 0), 100);
  assert.deepEqual(L.SAT_KEYS, ['edge', 'veg', 'drop']);
});
test('重みの正規化: 壊れた値は初期値に戻る', () => {
  const w = L.normalizeWeights({ edge: -5, veg: 'x', drop: 999, sight: 7 });
  assert.equal(w.edge, W.edge); assert.equal(w.veg, W.veg); assert.equal(w.drop, W.drop); assert.equal(w.sight, 7);
  assert.deepEqual(L.normalizeWeights('abc'), W);
});
test('素点は0〜1に収まる（極端な値でも）', () => {
  for (const c of [mk({ edge: 5, ndvi_g: 2, ndvi_w: -1, d_house: -10, n_sight500: 9999, n_house300: 999, d_school: 0 }), mk({ edge: 0, ndvi_g: 0, ndvi_w: 1, d_house: 9999, n_sight500: 0, n_house300: 0, d_school: null })]) {
    Object.values(L.unit(c)).forEach((v) => assert.ok(v >= 0 && v <= 1, String(v)));
  }
});
test('点数は目撃が多く建物に近いほど高い（他が同じなら）', () => {
  const a = L.scoreOf(mk({ n_sight500: 30, d_house: 50 }), W, false).total, b = L.scoreOf(mk({ n_sight500: 2, d_house: 350 }), W, false).total;
  assert.ok(a > b);
});
test('衛星のみの点数は重ねる要素を含まない', () => {
  const c = mk({ n_sight500: 40, d_house: 0, n_house300: 30, d_school: 0 });
  const s = L.scoreOf(c, W, true);
  assert.equal(s.use, s.sat);
  assert.ok(s.sat <= W.edge + W.veg + W.drop + 1e-9);
  assert.ok(L.scoreOf(c, W, false).total > s.sat);
});
test('順位: 1位から連番・同点はID順・衛星のみ順位も付く', () => {
  const cells = [mk({ id: 'Y002' }), mk({ id: 'Y001' }), mk({ id: 'Y003', n_sight500: 40, d_house: 5 })];
  const r = L.rank(cells, W, [], false);
  assert.deepEqual(r.map((c) => c.id), ['Y003', 'Y001', 'Y002']);
  assert.deepEqual(r.map((c) => c.rank), [1, 2, 3]);
  r.forEach((c) => assert.ok(c.satRank >= 1 && c.satRank <= 3));
});
test('衛星のみモードでは目撃が多くても順位が上がらない', () => {
  const cells = [mk({ id: 'Y001', edge: 0.2, n_sight500: 40 }), mk({ id: 'Y002', edge: 0.5, n_sight500: 0 })];
  assert.equal(L.rank(cells, W, [], false)[0].id, 'Y001');
  assert.equal(L.rank(cells, W, [], true)[0].id, 'Y002');
});
test('根拠は7項目あり、点数の合計が総点に一致し、数値が文章に入る', () => {
  const c = mk({});
  const rs = L.reasons(c, W);
  assert.equal(rs.length, 7);
  assert.ok(Math.abs(rs.reduce((a, r) => a + r.pts, 0) - L.scoreOf(c, W, false).total) < 0.2);
  assert.match(rs.find((r) => r.label.includes('目撃')).text, /10 件/);
  assert.match(rs.find((r) => r.label.includes('学校')).text, /校/);
});
test('記録の整形: 不正な行を捨て、長さを切る', () => {
  const ok = { cellId: 'Y010', date: '2026-11-15', who: 'a'.repeat(100), result: L.RESULTS[0], memo: 'm'.repeat(500) };
  const out = L.sanitizeResults([ok, { ...ok, cellId: 'X1' }, { ...ok, date: '2026-13-40' }, { ...ok, result: 'ぜんぜん別' }, null, 5]);
  assert.equal(out.length, 1); assert.equal(out[0].who.length, 40); assert.equal(out[0].memo.length, 200);
  assert.deepEqual(L.sanitizeResults('x'), []); assert.deepEqual(L.sanitizeResults(null), []);
});
test('最新の確認が優先される', () => {
  const m = L.latestResults([{ cellId: 'Y001', date: '2026-10-01', result: L.RESULTS[0] }, { cellId: 'Y001', date: '2026-11-01', result: L.RESULTS[1] }]);
  assert.equal(m.Y001.result, L.RESULTS[1]);
});
test('CSV: 引用・改行・式の無効化・BOM', () => {
  assert.equal(L.cell('a,b'), '"a,b"'); assert.equal(L.cell('He said "x"'), '"He said ""x"""'); assert.equal(L.cell('a\nb'), '"a\nb"');
  assert.equal(L.cell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(L.cell('-1+1'), "'-1+1"); assert.equal(L.cell(-3), '-3'); assert.equal(L.cell(null), '');
  const t = L.toCsv(['a', 'b'], [[1, 'x,y']]);
  assert.ok(t.startsWith('﻿')); assert.ok(t.endsWith('\r\n')); assert.ok(t.includes('1,"x,y"'));
});
test('計画: 「藪ではない」は除かれ、上位n件・列数がヘッダと一致', () => {
  const cells = [mk({ id: 'Y001', n_sight500: 40 }), mk({ id: 'Y002', n_sight500: 20 }), mk({ id: 'Y003', n_sight500: 5 })];
  const res = [{ cellId: 'Y001', date: '2026-11-01', who: 'a', result: L.EXCLUDE_RESULT, memo: '水田' }];
  const rows = L.planRows(L.rank(cells, W, res, false), 2);
  assert.deepEqual(rows.map((r) => r[1]), ['Y002', 'Y003']);
  rows.forEach((r) => assert.equal(r.length, L.PLAN_HEADER.length));
  assert.equal(rows[0][12], '未確認'); assert.equal(rows[0][15], ''); assert.equal(rows[0][16], '');
});
test('記録CSVに「デモ入力」の注記が付く', () => {
  const rows = L.recordRows([{ cellId: 'Y001', date: '2026-11-01', who: 'a', result: L.RESULTS[0], memo: '' }]);
  assert.match(rows[0][5], /デモ/); assert.equal(rows[0].length, L.RECORD_HEADER.length);
});

// ---- データの整合性 ----
test('データ: 区画の件数・ID・範囲', () => {
  assert.ok(D.cells.length >= 300);
  assert.equal(new Set(D.cells.map((c) => c.id)).size, D.cells.length);
  const [w, s, e, n] = D.meta.bbox;
  D.cells.forEach((c) => {
    assert.match(c.id, /^Y\d{3}$/);
    assert.ok(c.lon >= w - 0.01 && c.lon <= e + 0.01 && c.lat >= s - 0.01 && c.lat <= n + 0.01, c.id);
    assert.equal(c.ring.length, 5); assert.deepEqual(c.ring[0], c.ring[4]);
  });
});
test('データ: 数値の範囲（NDVI・林縁度・距離・件数）', () => {
  D.cells.forEach((c) => {
    assert.ok(c.ndvi_g >= 0.5 && c.ndvi_g <= 1, c.id); assert.ok(c.ndvi_w >= -0.2 && c.ndvi_w <= 1, c.id);
    assert.ok(c.edge >= 0.1 && c.edge <= 1, c.id); assert.ok(c.d_house >= 0 && c.d_house <= 400, c.id);
    assert.ok(c.n_sight500 >= c.n_sight500_recent && c.n_sight500 >= c.n_sight500_village, c.id);
    assert.ok(c.d_school == null || c.d_school >= 0, c.id);
  });
});
test('データ: 出典と取得条件がメタ情報に入っている・架空データの印がない', () => {
  assert.equal(D.meta.scenes.green.date, '2026-05-17'); assert.equal(D.meta.scenes.winter.date, '2026-02-21');
  assert.deepEqual(D.meta.sight_years, [2009, 2018]);
  assert.ok(D.meta.osm_timestamp.startsWith('2026-'));
  assert.equal(D.sights.length, D.meta.n_sights); assert.equal(D.houses.length, D.meta.n_houses);
  assert.ok(D.schools.length >= 10);
});
test('データ: 全区画を順位付けして点数が0〜100、順位が連番', () => {
  const r = L.rank(D.cells, W, [], false);
  r.forEach((c, i) => { assert.equal(c.rank, i + 1); assert.ok(c.score >= 0 && c.score <= 100.0001, c.id); });
  assert.ok(r[0].score > r[r.length - 1].score);
  assert.ok(r.slice(0, 20).every((c) => c.n_sight500 > 0), '上位に目撃ゼロの区画が入らない');
});
test('画面ファイル: 必須の注記（架空でない・最新でない・仮置き）と出典が入っている', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const w of ['架空のデータは使っていません', '最新ではありません', '仮置き', 'Sentinel-2', 'OpenStreetMap', '京都府']) assert.ok(html.includes(w), w);
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.ok(!/https?:\/\/(?!cyberjapandata\.gsi\.go\.jp|maps\.gsi\.go\.jp)/.test(app.replace(/\/\/.*$/gm, '')), '外部URLは地理院タイルのみ');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(app), '外部送信なし');
});

// ---- 出没しやすさ（論文ベース）----
test('出没しやすさ: 林縁20m・100m の選択度が論文の値（3.74・1.81）と一致する', () => {
  assert.ok(Math.abs(L.habSelect(20, false) - 3.74) < 1e-9);
  assert.ok(Math.abs(L.habSelect(100, false) - 1.81) < 0.01);
  assert.equal(L.habSelect(10, true), 21.45);       // 川に接する林縁
  assert.ok(L.habSelect(300, false) < L.habSelect(100, false) && L.habSelect(300, false) >= 1);
});
test('出没しやすさ: 等級は選択度の境目（3.74・1.81）で分かれ、集落係数・市街地係数が掛かる', () => {
  assert.equal(L.habTier(3.74), 2); assert.equal(L.habTier(3.73), 1); assert.equal(L.habTier(1.81), 1); assert.equal(L.habTier(1.8), 0);
  assert.equal(L.habTier(L.habScore(L.habSelect(20, false), 400, false)), 2);   // 林縁20m・人家500m圏内 = 高
  assert.equal(L.habTier(L.habScore(L.habSelect(20, false), 800, false)), 1);   // 人家から遠い = 中に下がる
  assert.equal(L.habTier(L.habScore(L.habSelect(100, false), 800, false)), 0);
  assert.equal(L.habTier(L.habScore(L.habSelect(20, false), 100, true)), 1);    // 市街地 = 下がる
});
test('出没しやすさ: データの整合（候補区画すべてに付与・検証値が揃う・基準との比較がある）', () => {
  const Hb = JSON.parse(fs.readFileSync(path.join(root, 'data/habitat.json'), 'utf8'));
  assert.equal(Object.keys(Hb.cand).length, D.cells.length);
  D.cells.forEach((c) => { const v = Hb.cand[c.id]; assert.ok(v && v[0] >= 0 && v[0] <= 2, c.id); assert.equal(L.habTier(v[1]), v[0], c.id); });
  assert.ok(Hb.show.every((h) => h[2] >= 1) && Hb.show.length > 0);
  assert.ok(Math.abs(Hb.meta.r100 - 1.81) < 0.01);
  for (const p of ['all', 'all_no2010', 'first', 'first_no2010', 'second']) for (const z of ['land', 'near500']) {
    const e = Hb.val[p + '|' + z]; assert.ok(e, p + z);
    for (const k of ['S', 'R', 'base']) assert.ok(e.auc[k] >= 0 && e.auc[k] <= 1, p + z + k);
    assert.equal(['高', '中', '低'].reduce((a, t) => a + e.tiers[t].n_cells, 0), e.n_cells);
  }
  const js = fs.readFileSync(path.join(root, 'data/habitat.js'), 'utf8');
  assert.ok(js.startsWith('window.HABITAT='));
});
test('画面ファイル: 検証の折りたたみ・目撃の偏りの注記・出典（Takahata）が入っている', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.ok(html.includes('この判定は当たっているか') && html.includes('人の多い所に偏ります'));
  assert.ok(app.includes('Takahata ほか 2014') && app.includes('人家からの距離だけ'));
});
