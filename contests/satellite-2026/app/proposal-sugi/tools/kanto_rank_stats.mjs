// 区分1の中の順位の集計と、東京都12地点（9年）との照合を表示する（画面と同じ kanto-lib.js を使う）。
// 使い方: node tools/kanto_rank_stats.mjs [R=20] [林齢=26]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = createRequire(import.meta.url)(path.join(root, 'kanto-lib.js'));
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['data/kanto.js', 'data/pop.js', 'data/verify9.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const D = ctx.window.SUGI_KANTO, POP = ctx.window.SUGI_POP, V9 = ctx.window.SUGI_VERIFY9;
const R0 = +(process.argv[2] || 20), age = +(process.argv[3] || 26);
const base = Object.assign({}, K.DEFAULTS, { age });
const cls = K.classifyAll(D, base);
const fx = (v) => (v == null ? '—' : v.toFixed(2));
for (const R of K.RANK_RADII) {
  const p = Object.assign({}, base, { rankKm: R }), sc = K.scores(D, POP, p, cls), rb = K.rankBands(D, cls, sc.S), bs = K.bandSummary(D, cls, rb.band);
  console.log(`R=${R}km 区分1の帯(ha) 上位10%/10〜30%/30〜60%/残り:`, bs.tot.slice(1).map(Math.round).join(' / '));
  D.meta.prefs.forEach((n, i) => console.log('  ', n, bs.byPref[i].slice(1).map(Math.round).join(' / ')));
  const site = (s) => K.siteScore(D, sc.S, s.lon, s.lat, R);
  const mat = (i) => (age === 21 ? D.cells.n21[i] : D.cells.n26[i]) * K.CELL_HA;
  const yr = V9.years.map((y, j) => K.spearman(V9.sites.map((s) => s.byYear[j]), V9.sites.map(site)));
  console.log(`  rho 9年平均 ${fx(K.spearman(V9.sites.map((s) => s.mean9), V9.sites.map(site)))} 回帰係数 ${fx(K.spearman(V9.sites.map((s) => s.coef), V9.sites.map(site)))} 各年 ${yr.map(fx).join(' ')} 人口なし(9年平均) ${fx(K.spearman(V9.sites.map((s) => s.mean9), V9.sites.map((s) => K.haWithin(D, s.lon, s.lat, R, mat))))}`);
  if (R === R0) {
    const top = D.munis.map((m, i) => ({ n: m[0] + '(' + D.meta.prefs[m[1]] + ')', v: bs.byMuni[i] })).sort((a, b) => b.v[1] - a.v[1]).slice(0, 15);
    console.log('  上位10%の面積が大きい市町村:', top.map((t) => `${t.n} ${Math.round(t.v[1])}ha`).join('、'));
  }
}
