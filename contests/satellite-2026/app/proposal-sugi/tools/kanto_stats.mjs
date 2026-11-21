// 区分ごとの面積などを表示する（README・報告用）。使い方: node tools/kanto_stats.mjs [傾斜しきい値] [林齢 26|21] [まとまり ha]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = createRequire(import.meta.url)(path.join(root, 'kanto-lib.js'));
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'data/kanto.js'), 'utf8'), ctx);
const D = ctx.window.SUGI_KANTO;
const p = Object.assign({}, L.DEFAULTS);
if (process.argv[2]) p.slopeMax = +process.argv[2];
if (process.argv[3]) p.age = +process.argv[3];
if (process.argv[4]) p.minHa = +process.argv[4];
const cls = L.classifyAll(D, p);
const S = L.summarize(D, cls);
const r = (x) => Math.round(x).toLocaleString();
console.log('params', JSON.stringify(p));
console.log('区分 ha', Object.fromEntries(Object.entries(S.tot).map(([k, v]) => [k, r(v)])), 'メッシュ数', JSON.stringify(S.cnt));
D.meta.prefs.forEach((n, i) => {
  const b = S.byPref[i];
  console.log(n, '全スギ', r(b.all), '26+', r(b.mature26), '21+', r(b.mature21), [1, 2, 3, 4].map((k) => k + ':' + r(b[k])).join(' '));
});
const c = D.cells;
// 林野庁の重点区域の面積（表の値）と、重点区域の市町村内・50km圏内のスギ人工林面積（この地図の集計）の比較
const zone = D.meta.prefs.map(() => ({ inZone: 0, in50: 0, in50notZone: 0, both: 0 }));
for (let i = 0; i < c.n.length; i++) {
  const m = D.munis[c.muni[i]], z = zone[m[1]], ha = c.n[i] * 0.04, a = m[2] === 1, b = c.dist[i] <= 50;
  if (a) z.inZone += ha;
  if (b) z.in50 += ha;
  if (b && !a) z.in50notZone += ha;
  if (a && b) z.both += ha;
}
D.meta.prefs.forEach((n, i) => console.log(n, '重点区域の市町村内', r(zone[i].inZone), '50km圏内', r(zone[i].in50), '圏内だが表にない市町村', r(zone[i].in50notZone), '両方', r(zone[i].both)));
const sl = Array.from(c.slope).filter((v) => v >= 0).sort((a, b) => a - b);
console.log('slope quantiles(10,25,50,75,90)', [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => sl[Math.floor(sl.length * q)]), 'unknown', c.slope.filter((v) => v < 0).length);
let tn = 0, tn26 = 0, tunk = 0;
for (let i = 0; i < c.n.length; i++) { tn += c.n[i]; tn26 += c.n26[i]; tunk += c.nunk[i]; }
console.log('total ha', r(tn * 0.04), '26+ share', (tn26 / tn).toFixed(3), 'unk share', (tunk / tn).toFixed(4));
