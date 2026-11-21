// 評価ループ第1回で足したロジックの検査（実行: node --test tests/evalloop_test.js）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Life = require('../web/life.js');
const Lib = require('../web/lib.js');

test('通勤の表示: 徒歩60分超は「現実的でない」扱い、徒歩が鉄道以下・最寄駅が同じなら徒歩だけ', () => {
  assert.deepStrictEqual(Life.commuteSummary({ walk: 103, rail: null }).walkOver, true);
  const r = Life.commuteSummary({ walk: 103, rail: { total: 27, same: false } });
  assert.strictEqual(r.mode, 'rail'); assert.strictEqual(r.showWalk, false);
  assert.strictEqual(Life.commuteSummary({ walk: 1, rail: { total: 18, same: true } }).mode, 'walk');
  assert.strictEqual(Life.commuteSummary({ walk: 20, rail: { total: 25, same: false } }).mode, 'walk');
});
test('学童（収録が少ない種類）は距離を数字で比べさせない', () => {
  const g = Life.LAYERS.find((l) => l.id === 'gakudo');
  assert.strictEqual(Life.nearCell(g, { m: 9400 }).kind, 'sparse-far');
  assert.strictEqual(Life.nearCell(g, { m: 800 }).kind, 'sparse');
  assert.strictEqual(Life.nearCell(Life.LAYERS[0], { m: 800 }).kind, 'ok');
});
test('同じ位置の物件は追加しない', () => {
  const st = Life.empty();
  assert.ok(Life.addProp(st, { label: 'a', lon: 134.55, lat: 34.07 }).ok);
  const r = Life.addProp(st, { label: 'b', lon: 134.5501, lat: 34.0701 });
  assert.strictEqual(r.ok, false); assert.match(r.reason, /すでに/);
  assert.strictEqual(st.props.length, 1);
});
test('住所: 市区町村の代表点だけの結果と、入力と違う町名を見分ける', () => {
  for (const t of ['徳島県徳島市', '東京都千代田区', '大阪府大阪市北区']) assert.ok(Life.isCoarse(t), t);
  for (const t of ['徳島県徳島市国府町', '徳島県阿波市市場町']) assert.ok(!Life.isCoarse(t), t);
  assert.ok(Life.addressMismatch('徳島市応神町', '徳島県徳島市川内町'));
  assert.ok(!Life.addressMismatch('徳島市幸町2丁目', '徳島県徳島市幸町二丁目'));
  assert.strictEqual(Life.altQuery('JR徳島駅'), '徳島駅');
});
test('シートの要約: 区域・人口・災害を事実で出し、断定の語を使わない', () => {
  const dir = path.join(__dirname, '../web/data/tokushima');
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const d = Lib.assemble(rd('manifest.json'), { plan: rd('plan.json'), population: rd('population.json'), districts: rd('districts.json'), facilities: rd('facilities.json'), hazards: rd('hazards.json') }, Lib.REGIONS.tokushima);
  const s = Lib.sheetSummary(d, Lib.collect(d, 134.5513, 34.0745));
  const t = JSON.stringify(s);
  assert.ok(t.includes('居住誘導区域') && t.includes('2025→2050年') && t.includes('洪水'));
  assert.ok(!/安全|危険|最適|査定|適正料金/.test(t));
});
test('画面: 比較表・地図の全件表示・計算方法は既定で閉じる', () => {
  const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
  assert.ok(app.includes('function nearTable') && app.includes('function fitAll'));
  assert.ok(/<details class="assump">/.test(html));
  assert.ok(!html.includes('動く最小限のデモ'));
});
