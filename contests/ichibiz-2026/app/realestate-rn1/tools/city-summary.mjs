/* 提出文（problem.md など）に書く地域の人口の数字を、同梱データから再計算して表示する。ネットワーク・キー不要。
 *   node tools/city-summary.mjs [--region tokushima|tokyo23|osaka]      （既定は tokushima。--by-city で区ごとの内訳も表示）
 * 数字の出どころ: 将来推計人口250mメッシュ（XKT013。国土数値情報「250mメッシュ別将来推計人口データ（R6国政局推計）」）のうち、
 * 地域の市区町村コード（web/lib.js の REGIONS.codes。東京23区は 13101〜13123、大阪市は区のコード）のメッシュを合計（作成者の集計）。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const here = import.meta.dirname;
const Lib = createRequire(import.meta.url)('../web/lib.js');
const args = process.argv.slice(2);
const rid = args.includes('--region') ? args[args.indexOf('--region') + 1] : 'tokushima';
const region = Lib.REGIONS[rid];
if (!region) { console.error(`--region は ${Object.keys(Lib.REGIONS).join('・')}`); process.exit(2); }
const pop = JSON.parse(fs.readFileSync(path.join(here, '../web/data', region.dir, 'population.json'), 'utf8'));
const [y0, y1, y2] = pop.years;
const show = (label, meshes) => {
  const s = Lib.sumMeshes(meshes, pop.years);
  console.log(`${label}のメッシュ ${meshes.length}個`);
  for (const y of pop.years) console.log(`  ${y}年: 総数 ${Lib.fmtNum(s[y].p)}人 / 0〜14歳 ${Lib.fmtNum(s[y].a)}人 / 65歳以上 ${Lib.fmtNum(s[y].c)}人（${Lib.share(s[y], 'c').toFixed(1)}%）`);
  console.log(`  総数の増減（${y0}→${y2}年）: ${Lib.changePct(s[y0].p, s[y2].p).toFixed(1)}%`);
  console.log(`  0〜14歳の増減（${y0}→${y2}年）: ${Lib.changePct(s[y0].a, s[y2].a).toFixed(1)}%`);
  console.log(`  総数の増減（${y0}→${y1}年）: ${Lib.changePct(s[y0].p, s[y1].p).toFixed(1)}%`);
};
console.log(`${region.whole.replace('全体', '')}（${rid}）、取得日 ${pop.fetchedAt}`);
show(region.whole, pop.items.filter((m) => Lib.regionHas(region, m.sc)));
if (args.includes('--by-city')) for (const c of region.codes) { const ms = pop.items.filter((m) => m.sc === c); if (ms.length) show(c, ms); }
