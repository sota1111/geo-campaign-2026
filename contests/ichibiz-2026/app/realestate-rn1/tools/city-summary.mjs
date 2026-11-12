/* 提出文（problem.md）に書いた徳島市の人口の数字を、同梱データから再計算して表示する。ネットワーク・キー不要。
 *   node tools/city-summary.mjs
 * 数字の出どころ: 将来推計人口250mメッシュ（XKT013。国土数値情報「250mメッシュ別将来推計人口データ（R6国政局推計）」）のうち、市区町村コード 36201 のメッシュを合計（作成者の集計）。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const here = import.meta.dirname;
const Lib = createRequire(import.meta.url)('../web/lib.js');
const pop = JSON.parse(fs.readFileSync(path.join(here, '../web/data/population.json'), 'utf8'));
const code = '36201';
const meshes = pop.items.filter((m) => m.sc === code);
const s = Lib.sumMeshes(meshes, pop.years);
const [y0, y1, y2] = pop.years;
console.log(`徳島市（${code}）のメッシュ ${meshes.length}個、取得日 ${pop.fetchedAt}`);
for (const y of pop.years) console.log(`  ${y}年: 総数 ${Lib.fmtNum(s[y].p)}人 / 0〜14歳 ${Lib.fmtNum(s[y].a)}人 / 65歳以上 ${Lib.fmtNum(s[y].c)}人（${Lib.share(s[y], 'c').toFixed(1)}%）`);
console.log(`総数の増減（${y0}→${y2}年）: ${Lib.changePct(s[y0].p, s[y2].p).toFixed(1)}%`);
console.log(`0〜14歳の増減（${y0}→${y2}年）: ${Lib.changePct(s[y0].a, s[y2].a).toFixed(1)}%`);
console.log(`総数の増減（${y0}→${y1}年）: ${Lib.changePct(s[y0].p, s[y1].p).toFixed(1)}%`);
