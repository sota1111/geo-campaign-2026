import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = createRequire(import.meta.url)(path.join(root, 'nat-lib.js'));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('data/nat.js'), ctx);
vm.runInContext(read('data/nat_geo.js'), ctx);
const NAT = ctx.window.SUGI_NAT, GEO = ctx.window.SUGI_NAT_GEO, U = NAT.u, M = NAT.meta;
const cells = L.decodeCells(NAT);
const NU = U.code.length;

test('全国データ: 市町村の件数・境界との対応・各列の長さ', () => {
  assert.ok(NU >= 1700 && NU <= 1800, '市町村数 ' + NU);
  assert.equal(M.units, NU);
  for (const k of ['name', 'pref', 'pop', 'lat', 'lon', 'ha', 'ha26', 'ha21', 'tree', 'land', 'area', 'jouyo', 'priv']) assert.equal(U[k].length, NU, k);
  assert.equal(GEO.features.length, NU);
  GEO.features.forEach((f, i) => assert.equal(f.id, i));
  assert.equal(M.prefs.length, 47);
});
test('全国データ: 森林簿のスギ人工林・人口・譲与額の合計が桁として妥当（出典の値と突き合わせ）', () => {
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  assert.ok(sum(U.ha) > 3.0e6 && sum(U.ha) < 5.5e6, 'スギ人工林 ' + sum(U.ha));
  assert.ok(sum(U.ha26) <= sum(U.ha) && sum(U.ha21) >= sum(U.ha26) && sum(U.ha21) <= sum(U.ha));
  assert.ok(sum(U.pop) > 1.24e8 && sum(U.pop) <= 1.2615e8, '人口 ' + sum(U.pop)); // 令和2年国勢調査 126,146,099人（北方領土等を除く）
  assert.ok(M.pop_lost / 126146099 < 0.003);
  assert.ok(M.jouyo_matched >= 1700 && M.jouyo_matched <= M.jouyo_rows);
  assert.equal(M.jouyo_total_k, 56601856); // 総務省 令和6年度 市区町村計（千円）
  assert.ok(M.lost_ha / sum(U.ha) < 0.01, '市町村に割り当てられなかったスギ人工林が1%未満');
});
test('1kmの格子: 件数・面積の合計が市町村の表と一致し、位置が日本の範囲にある', () => {
  assert.equal(cells.n, M.n_cells);
  const s26 = (a) => a.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(s26(cells.ha26) - s26(U.ha26)) / s26(U.ha26) < 1e-3);
  assert.ok(Math.abs(s26(cells.ha21) - s26(U.ha21)) / s26(U.ha21) < 1e-3);
  for (let i = 0; i < cells.n; i += 101) {
    assert.ok(cells.lat[i] > 24 && cells.lat[i] < 46 && cells.lon[i] > 122 && cells.lon[i] < 146.5);
    assert.ok(cells.u[i] < NU);
  }
});
test('主な市町村: 世田谷区は人口が多くスギ人工林がほぼ無い。奥多摩町・川場村にはスギ人工林がある', () => {
  const ix = (n) => U.name.indexOf(n);
  assert.ok(ix('世田谷区') >= 0 && ix('川場村') >= 0 && ix('奥多摩町') >= 0);
  assert.ok(U.pop[ix('世田谷区')] > 800000 && U.ha26[ix('世田谷区')] < 10);
  assert.ok(U.ha26[ix('川場村')] > 100 && U.ha26[ix('奥多摩町')] > 1000);
  assert.ok(U.jouyo[ix('世田谷区')] > 0 && U.jouyo[ix('川場村')] > 0);
});

// ---- 配分の計算 ----
function toy() {
  // 都市(0)と、圏内の候補が3つ、圏外が1つ
  const U2 = { ha26: [0, 100, 300, 600, 900], ha21: [0, 150, 350, 650, 900], jouyo: [500, 100, 100, 300, -1] };
  const c = { n: 4, u: new Uint16Array([1, 2, 3, 4]), lat: new Float32Array([35.0, 35.1, 35.2, 38.0]), lon: new Float32Array([139.0, 139.0, 139.0, 139.0]), ha26: new Float32Array([100, 300, 600, 900]), ha21: new Float32Array([150, 350, 650, 900]) };
  return { U2, c };
}
test('圏内の集計: 半径で入る・入らないが分かれ、近さ重みは1−距離÷半径', () => {
  const { c } = toy();
  const r = L.reach(c, 5, 35.0, 139.0, 50, 26);
  assert.ok(Math.abs(r.inHa[1] - 100) < 1e-6 && Math.abs(r.inHa[2] - 300) < 1e-6);
  assert.equal(r.inHa[3], 600 * (L.distKm(35, 139, 35.2, 139) <= 50 ? 1 : 0));
  assert.equal(r.inHa[4], 0);
  const d = L.distKm(35, 139, 35.1, 139);
  assert.ok(Math.abs(r.near[2] - 300 * (1 - d / 50)) < 0.01 && Math.abs(r.near[1] - 100) < 1e-6);
  const r2 = L.reach(c, 5, 35.0, 139.0, 20, 26);
  assert.ok(r2.inHa[3] === 0 && r2.inHa[2] > 0);
  const r21 = L.reach(c, 5, 35.0, 139.0, 50, 21);
  assert.ok(Math.abs(r21.inHa[1] - 150) < 1e-6 && Math.abs(r21.inHa[2] - 350) < 1e-6);
});
test('配分: どのルールも比率の合計が1で、都市自身は候補に入らず、D は現行の譲与額に比例', () => {
  const { U2, c } = toy();
  const r = L.reach(c, 5, 35.0, 139.0, 100, 26);
  const cand = L.candidates(r, 0, 10);
  assert.ok(!cand.includes(0) && cand.includes(1) && cand.includes(2) && cand.includes(3));
  const sh = L.shares(U2, cand, r, 26, 50);
  for (const k of Object.keys(sh)) assert.ok(Math.abs(sh[k].reduce((s, x) => s + x, 0) - 1) < 1e-9, k);
  // D: 譲与額 100:100:300（候補の並びは 1,2,3 または 1,2,3,4）
  const ci = (u) => cand.indexOf(u);
  assert.ok(Math.abs(sh.cur[ci(1)] / sh.cur[ci(2)] - 1) < 1e-9 && Math.abs(sh.cur[ci(3)] / sh.cur[ci(1)] - 3) < 1e-9);
  // 譲与額が不明(-1)の市町村は D では0
  if (cand.includes(4)) assert.equal(sh.cur[cand.indexOf(4)], 0);
  // E は A と D の混合。100%なら A、0%なら D
  const a = L.shares(U2, cand, r, 26, 100), d = L.shares(U2, cand, r, 26, 0);
  assert.deepEqual(a.mix.map((x) => +x.toFixed(9)), a.in.map((x) => +x.toFixed(9)));
  assert.deepEqual(d.mix.map((x) => +x.toFixed(9)), d.cur.map((x) => +x.toFixed(9)));
  const s = L.summarize(sh);
  for (const rule of L.RULES) { assert.ok(s[rule.id].top3 > 0 && s[rule.id].top3 <= 1 + 1e-9); assert.ok(s[rule.id].shift >= 0 && s[rule.id].shift <= 1); }
  assert.ok(s.cur.shift < 1e-12);
});
test('実データで世田谷区を選んだとき: 50km圏に候補があり、配分額の合計が予算に一致する', () => {
  const j = U.name.indexOf('世田谷区');
  const rr = L.reach(cells, NU, U.lat[j], U.lon[j], 50, 26);
  const cand = L.candidates(rr, j, 10);
  assert.ok(cand.length >= 10, '候補 ' + cand.length);
  const names = cand.map((k) => U.name[k]);
  assert.ok(names.includes('青梅市') || names.includes('奥多摩町') || names.includes('飯能市'));
  const sh = L.shares(U, cand, rr, 26, 50);
  for (const rule of L.RULES) assert.ok(Math.abs(10000 * sh[rule.id].reduce((s, x) => s + x, 0) - 10000) < 1e-6);
  const r100 = L.reach(cells, NU, U.lat[j], U.lon[j], 100, 26);
  assert.ok(L.candidates(r100, j, 10).length >= cand.length);
});
test('仮置きの値: 半径の初期値は国の目安の50km。ルールは5つ', () => {
  assert.equal(L.DEFAULTS.radiusKm, 50);
  assert.ok(L.RADII.includes(50));
  assert.deepEqual(L.RULES.map((r) => r.id), ['in', 'near', 'all', 'cur', 'mix']);
});

// ---- 画面の表示規約 ----
test('画面: 実データ・仮置きの明示、出典、制度の事実、外部送信なし、効果の数値なし', () => {
  const html = read('index.html'), app = read('nat.js'), css = read('nat.css');
  const t = html + app;
  assert.ok(html.includes('実データ') && html.includes('仮置き'));
  assert.ok(!/<script[^>]+src="https?:/.test(html));
  assert.ok(!/XMLHttpRequest|sendBeacon|method:\s*'POST'/.test(app));
  assert.ok(!/#0f0|#00ff00/.test(css));
  for (const s of ['林野庁', '国土数値情報', 'e-Stat', '総務省', 'WorldCover', '地理院']) assert.ok(t.includes(s), s);
  assert.ok(html.includes('市町村どうしの資金移転ではありません') && html.includes('未確認'));
  assert.ok(html.includes('適正かは示しません'));
  assert.ok(t.includes('樹種') && t.includes('林齢') && t.includes('分からない'));
  assert.ok(!/効果|花粉量|%減る|％減る/.test(html.replace('効果の数値', '')));
  assert.ok(!/最適|適正額/.test(html.replace('適正かは示しません', '')));
  assert.ok(!/最適|適正額/.test(app.replace(/適正・最適かは示しません/g, '')));
  assert.ok(app.includes('資金を直接渡す制度ではありません') && app.includes('本文は未読'));
});
test('画面: 関東版・青梅版は残っており、全国版から関東版へ行ける', () => {
  assert.ok(fs.existsSync(path.join(root, 'kanto.html')) && fs.existsSync(path.join(root, 'ome.html')));
  assert.ok(read('index.html').includes('href="kanto.html"'));
  assert.ok(read('ome.html').includes('href="kanto.html"'));
});
