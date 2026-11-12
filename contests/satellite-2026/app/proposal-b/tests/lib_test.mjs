// usage: node tests/lib_test.mjs  （proposal-b ディレクトリで）
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const L = require('../lib.js');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../data/sample.js', import.meta.url), 'utf8'), ctx);
const D = JSON.parse(JSON.stringify(ctx.window.SAMPLE));
let n = 0; const t = (name, f) => { f(); n++; console.log('ok', name); };

t('スコアは内訳の合計で、負にならない', () => {
  const s = D.sites[0]; const r = L.scoreSite(s, null, D.refDate);
  assert.equal(r.score, r.parts.reduce((a, p) => a + p[1], 0));
  const low = { change: '植生消失', terrain: '平地', permit: '許可・届出あり', zone: '区域外', detected: D.refDate, seasonal: true };
  assert.equal(L.scoreSite(low, null, D.refDate).score, 0);
});
t('順位は点数降順・連番・同点はIDで安定', () => {
  const r = L.rank(D.sites, null, D.refDate, []);
  assert.equal(r.length, D.sites.length);
  r.forEach((s, i) => { assert.equal(s.rank, i + 1); if (i) assert.ok(r[i - 1].score >= s.score); });
});
t('谷埋め・許可なしの新設が、許可ありの平地より上', () => {
  const r = L.rank(D.sites, null, D.refDate, []);
  assert.ok(r.find((s) => s.id === 'A-01').rank < r.find((s) => s.id === 'B-02').rank);
});
t('季節変動フラグで減点される', () => {
  const r = L.rank(D.sites, null, D.refDate, []);
  assert.ok(r.find((s) => s.id === 'B-01').parts.some((p) => p[1] < 0));
});
t('重みの変更が順位に反映される', () => {
  const w = JSON.parse(JSON.stringify(L.DEFAULT_WEIGHTS)); w.change['変位'] = 50;
  const a = L.rank(D.sites, null, D.refDate, []).find((s) => s.id === 'A-03').score;
  const b = L.rank(D.sites, w, D.refDate, []).find((s) => s.id === 'A-03').score;
  assert.equal(b - a, 30);
});
t('巡視結果が台帳に戻る（最新の記録）', () => {
  const res = [{ siteId: 'A-01', date: '2026-11-11', result: '要継続観察' }, { siteId: 'A-01', date: '2026-11-12', result: '是正対象' }];
  assert.equal(L.rank(D.sites, null, D.refDate, res).find((s) => s.id === 'A-01').latest.result, '是正対象');
});
t('巡視ルートは上位N件を全て一度だけ訪れる', () => {
  const r = L.rank(D.sites, null, D.refDate, []); const p = L.planRoute(r, D.origin, 4);
  assert.deepEqual(p.route.map((s) => s.id).sort(), r.slice(0, 4).map((s) => s.id).sort());
  assert.ok(p.total > 0); assert.equal(L.planRoute(r, D.origin, 0).route.length, 0);
});
t('種別ごとの集計', () => {
  const st = L.hitStats(D.sites, [{ siteId: 'A-01', result: '是正対象' }, { siteId: 'B-03', result: '問題なし' }, { siteId: 'XX', result: '是正対象' }]);
  assert.deepEqual(st['新設'], { n: 2, hit: 1 });
});
t('CSV: BOM・引用符・数式の無効化', () => {
  assert.equal(L.csvCell('a,b'), '"a,b"'); assert.equal(L.csvCell('=1+1'), "'=1+1"); assert.equal(L.csvCell('x"y'), '"x""y"');
  assert.ok(L.toCSV(['a'], [['b']]).startsWith('﻿'));
});
t('サンプルデータは架空と明記され、座標が地図内', () => {
  assert.ok(D.notice.includes('架空'));
  D.sites.forEach((s) => { assert.ok(s.x >= 0 && s.x <= 600 && s.y >= 0 && s.y <= 400); assert.ok(s.detected <= D.refDate); });
  assert.equal(new Set(D.sites.map((s) => s.id)).size, D.sites.length);
});

// ---- 実データ版 ----
const rctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../data/real.js', import.meta.url), 'utf8'), rctx);
const R = JSON.parse(JSON.stringify(rctx.window.REAL));
t('実データ: 件数・必須項目・ID一意', () => {
  assert.equal(R.city, '横須賀市'); assert.equal(R.sites.length, 716);
  assert.equal(new Set(R.sites.map((s) => s.id)).size, R.sites.length);
  R.sites.forEach((s) => {
    assert.ok(s.id.startsWith('横須賀市')); assert.ok(['谷埋め型', '腹付け型', '区分なし'].includes(s.type));
    assert.ok(s.lon > 139.5 && s.lon < 139.8 && s.lat > 35.1 && s.lat < 35.4);
    assert.ok(s.areaM2 > 0 && s.ring.length >= 4);
    assert.ok(['宅地造成等工事規制区域', '特定盛土等規制区域', '区域外'].includes(s.zone));
  });
});
t('実データ: DEM指標は妥当な範囲、算出不可は null/未定義で推測値なし', () => {
  const d = R.sites.filter((s) => s.reliefM != null);
  assert.ok(d.length > 700);
  d.forEach((s) => { assert.ok(s.reliefM >= 0 && s.reliefM < 300); assert.ok(s.slopeDeg >= 0 && s.slopeDeg < 90); assert.ok(['5m', '10m'].includes(s.demRes)); });
  R.sites.filter((s) => s.reliefM == null).forEach((s) => assert.ok(s.slopeDeg == null && s.elevM == null));
});
t('実データ: 規制区域のポリゴンと出典情報', () => {
  assert.ok(R.zones.length > 0); R.zones.forEach((z) => { assert.ok(z.ring.length >= 4); assert.ok(z.notice); });
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(R.fetched));
});
t('実データのスコア: 衛星由来は null で点数に含めない・内訳の合計と一致', () => {
  const s = R.sites.find((x) => x.reliefM != null);
  const r = L.scoreReal(s);
  assert.equal(r.parts[0][1], null); assert.ok(r.parts[0][0].includes('未接続'));
  assert.equal(r.score, r.parts.reduce((a, p) => a + (p[1] || 0), 0));
  const noDem = L.scoreReal({ type: '区分なし', zone: '区域外', areaM2: 100 });
  assert.equal(noDem.score, 0);
});
t('実データのスコア: 谷埋め型・急傾斜・大面積が上位', () => {
  const a = L.scoreReal({ type: '谷埋め型', zone: '宅地造成等工事規制区域', areaM2: 20000, reliefM: 30, slopeDeg: 20 }).score;
  const b = L.scoreReal({ type: '腹付け型', zone: '宅地造成等工事規制区域', areaM2: 500, reliefM: 3, slopeDeg: 3 }).score;
  assert.ok(a > b); assert.equal(L.band(null, [[1, 5]]), 0);
});
t('実データの順位: 連番・降順・重み変更が型の点数に反映', () => {
  const r = L.rank(R.sites, null, R.fetched, [], 'real');
  r.forEach((s, i) => { assert.equal(s.rank, i + 1); if (i) assert.ok(r[i - 1].score >= s.score); });
  const w = JSON.parse(JSON.stringify(L.DEFAULT_WEIGHTS_REAL)); w.type['腹付け型'] = 40;
  const id = R.sites.find((s) => s.type === '腹付け型').id;
  const a = L.rank(R.sites, null, R.fetched, [], 'real').find((s) => s.id === id).score;
  assert.equal(L.rank(R.sites, w, R.fetched, [], 'real').find((s) => s.id === id).score - a, 25);
});
t('型ごとの集計（key 指定）', () => {
  const st = L.hitStats(R.sites, [{ siteId: R.sites[0].id, result: '是正対象' }], 'type');
  assert.deepEqual(st[R.sites[0].type], { n: 1, hit: 1 });
});
t('地理院タイル座標の変換', () => {
  const x = L.tileOf(139.6722, 35.2814, 17); assert.ok(x.px >= 0 && x.px < 256 && x.py >= 0 && x.py < 256);
  assert.ok(Math.abs(L.tileOf(0, 0, 1).x - 1) < 1e-9); // 赤道・経度0は z1 のタイル x=1
});
console.log(n + ' tests passed');
