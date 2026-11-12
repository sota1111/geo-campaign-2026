// アグレッサー失敗テスト（2026-11-13）。usage: node tests/aggressor_test.mjs  （proposal-alpha ディレクトリで。node 22）
// 「本来こうあるべき」を断言する。現行で FAIL するものが弱点。本体は修正しない（指摘のみ）。
// 報告: reports/aggressor/satellite-2026-alpha-20261113.md
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const L = require('../lib.js');
const load = (f, name) => { const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'), ctx); return JSON.parse(JSON.stringify(ctx.window[name])); };
const D = load('sample.js', 'SAMPLE'), CHM = load('real.js', 'CHM');
const APP = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const lat = (CHM.nw[1] + CHM.se[1]) / 2;
const cellM = 156543.03392 * Math.cos(lat * Math.PI / 180) / 65536 * (L.tileOf(CHM.se[0], lat, 16).wx - L.tileOf(CHM.nw[0], lat, 16).wx) / CHM.n;
const PRESET = [[110, 150], [80, 135], [55, 125], [40, 110]];

let pass = 0, fail = 0;
const t = (id, name, f) => { try { f(); pass++; console.log('ok  ', id, name); } catch (e) { fail++; console.log('FAIL', id, name, '\n     ', e.message.split('\n')[0]); } };

// 空データ・欠損
t('AG-1', '衛星指標が欠損した区間は「0点＝安全」にならない（欠損フラグか中間点が付く）', () => {
  const s = Object.assign({}, D.sections.find((x) => x.id === 'F2-04'), { p90: null, tallPct: null, change: undefined, terrain: undefined });
  const r = L.scoreSection(s, null, D.refYear);
  // 伐採履歴の不明には cutUnknown=4 の中間点があるのに、衛星指標の欠損は0点。雲・データ欠落の区間が最下位に沈む
  assert.ok(r.satScore > 0 || r.missing, 'satScore=' + r.satScore + '（欠損が最も安全側の扱い）');
});
t('AG-2', '区間0件でも順位付け・計画が落ちない', () => {
  assert.deepEqual(L.rank([], null, 2026, []), []);
  assert.equal(L.planRoute([], D.depot, 4).route.length, 0);
});
t('AG-3', '保存済みの重みが古い形式（キー欠落）でも順位付けが落ちない', () => {
  // app.js は localStorage の alpha-weights-v1 をそのまま使う。版を上げてキーが増えると画面全体が描画されない
  const old = JSON.parse(JSON.stringify(L.DEFAULT_WEIGHTS)); delete old.cutAge; delete old.customers;
  assert.doesNotThrow(() => L.rank(D.sections, old, D.refYear, []));
});
t('AG-4', '保存済みの重みが空オブジェクトでも落ちない', () => {
  assert.doesNotThrow(() => L.rank(D.sections, {}, D.refYear, []));
});

// 実データ⑤: データ外と樹木なしの区別
t('AG-5', '樹高マップの範囲外に引いた線は「樹木なし(0m)」ではなく「データ外」と分かる', () => {
  const r = L.alongLine(CHM, cellM, [[-50, -50], [-10, -60]], 15, 15, 100);
  // 現行: lengthM>0・cells=0・max=0・p90=0 を返し、画面は「最大0m」と表示する
  assert.ok(!(r.lengthM > 0 && r.cells === 0 && r.max === 0 && !r.outside), 'len=' + Math.round(r.lengthM) + ' cells=0 を 0m として返す');
});
t('AG-6', '一部が範囲外の線で、範囲外の100m区間が0mとして混ざらない', () => {
  const r = L.alongLine(CHM, cellM, [[-30, 100], [30, 100]], 15, 15, 100);
  const empty = r.chunks.filter((c) => c.cells === 0 && c.max === 0 && !c.outside).length;
  assert.equal(empty, 0, '範囲外の区間 ' + empty + ' 個が「0m」扱い');
});
t('AG-7', '線の両側の幅10mは、セル約' + cellM.toFixed(1) + 'mの格子で意味のある区別になっている（10mと25mで90%値が変わる）', () => {
  const a = L.alongLine(CHM, cellM, PRESET, 10, 15, 100), b = L.alongLine(CHM, cellM, PRESET, 25, 15, 100);
  // 10m幅は1セル未満。中心が約15m先のセルまで入り、さらにセルは12m角の90パーセンタイル。表示の「10m」と実際に見ている幅が違う
  assert.notEqual(a.p90, b.p90, '10m・25mとも90%値=' + a.p90 + 'm');
});
t('AG-8', '提案書の「約1m格子」を画面でも使っている（集約で分解能を捨てていない）', () => {
  assert.ok(cellM < 3, '画面の1セル=約' + cellM.toFixed(1) + 'm（12画素の90パーセンタイル）');
});
t('AG-9', '樹高0mのセルが「樹木なし」と「無効値」を区別できる', () => {
  // build_real.py は 0 を無効値と区別せず集約。窓の画素のうち樹高>0は約34%
  assert.ok('nodata' in CHM || 'mask' in CHM, 'CHM に無効値の情報がない（valid/total=' + (CHM.valid / CHM.total).toFixed(2) + '）');
});

// 極端な時刻
t('AG-10', '確認日の初期値は日本時間の日付（07:30 JST に前日にならない）', () => {
  const expr = (APP.match(/\$\('#r-date'\)\.value = ([^;]+);/) || [])[1];
  assert.ok(expr, '初期値の式が見つからない');
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-11-13T07:30:00+09:00'])); } }
  const v = vm.runInNewContext(expr, { Date: FakeDate });
  assert.equal(v, '2026-11-13', '初期値=' + v + '（toISOString は UTC）');
});
t('AG-11', '最新の現地確認は「確認日」が新しいものを採る（後から古い記録を入力しても上書きされない）', () => {
  const res = [{ siteId: 'F1-03', result: '要伐採', date: '2026-10-05' }, { siteId: 'F1-03', result: '問題なし', date: '2026-10-01' }];
  assert.equal(L.latestResult(res, 'F1-03').date, '2026-10-05');
});
t('AG-12', '基準年が固定値でない（2027年に開いても経過年数が正しい）', () => {
  assert.ok(!/refYear:\s*2026/.test(fs.readFileSync(new URL('../data/sample.js', import.meta.url), 'utf8')) || /getFullYear/.test(APP), 'refYear=2026 固定');
});
t('AG-13', '前回伐採が基準年より未来（入力ミス）を検出する', () => {
  const s = Object.assign({}, D.sections[0], { lastCut: 2030 });
  const p = L.scoreSection(s, null, 2026).parts.find((x) => /伐採/.test(x[0]));
  assert.ok(!/-\d+ 年/.test(p[0]), '表示: ' + p[0]);
});

// 集計
t('AG-14', '同じ区間の再訪は区分の確認件数を水増ししない', () => {
  const res = [1, 2, 3, 4, 5].map((i) => ({ siteId: 'F1-03', result: '要伐採', date: '2026-10-0' + i }));
  const st = L.hitStats(D.sections, res, 'change');
  assert.equal(st['倒木・裸地化の疑い'].n, 1, 'n=' + st['倒木・裸地化の疑い'].n + '（5件以上で率が表示される）');
});

console.log(`\n${pass} ok / ${fail} FAIL（FAIL が弱点。本体は未修正）`);
process.exitCode = fail ? 1 : 0;
