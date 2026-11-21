// 衛星データ（data/sat.js）の被覆と、要確認・伐採候補の件数を表示する。使い方: node tools/kanto_sat_stats.mjs [冬NDVI] [候補ha]
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const K = createRequire(import.meta.url)(path.join(root, 'kanto-lib.js'));
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of ['data/kanto.js', 'data/pop.js', 'data/sat.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
const D = ctx.window.SUGI_KANTO, POP = ctx.window.SUGI_POP, SAT = ctx.window.SUGI_SAT;
const p = Object.assign({}, K.DEFAULTS, { winterMin: +(process.argv[2] || K.DEFAULTS.winterMin), cutMinHa: +(process.argv[3] || K.DEFAULTS.cutMinHa) });
const cls = K.classifyAll(D, p), sc = K.scores(D, POP, p, cls), rb = K.rankBands(D, cls, sc.S);
const ss = K.satSummary(D, SAT, p, cls, rb.band);
const f = (v) => Math.round(v).toLocaleString('ja-JP');
console.log('しきい値 冬NDVI', p.winterMin, '候補', p.cutMinHa, 'ha');
console.log('区分1 ha', f(ss.tot.all), '衛星で見えた ha', f(ss.tot.seen), '要確認 ha', f(ss.tot.check), '伐採候補の面積 ha', f(ss.tot.cut), '候補メッシュ数', ss.tot.cutCells);
let nChk = 0, nSeen = 0, n1 = 0; const h = new Array(12).fill(0);
const pr = D.meta.prefs.map(() => [0, 0, 0, 0]);
for (let i = 0; i < cls.length; i++) {
  if (cls[i] !== 1) continue;
  n1++; const s = K.satInfo(SAT, i, p), q = pr[D.munis[D.cells.muni[i]][1]];
  q[0]++;
  if (s.ndvi != null) { nSeen++; q[1]++; if (s.check) { nChk++; q[2]++; } if (s.cut) q[3]++; h[Math.min(11, Math.max(0, Math.floor((s.ndvi + 0.2) * 10)))]++; }
}
console.log('区分1 メッシュ', n1, '見えた', nSeen, '要確認メッシュ', nChk);
console.log('冬NDVI分布(-0.2から0.1刻み)', h.join(' '));
D.meta.prefs.forEach((n, i) => console.log(' ', n, '区分1メッシュ', pr[i][0], '見えた', pr[i][1], '要確認', pr[i][2], '候補', pr[i][3]));
ss.byBand.slice(1).forEach((o, b) => console.log(' 帯', b + 1, '区分1ha', f(o.all), '要確認ha', f(o.check), '候補ha', f(o.cut)));
