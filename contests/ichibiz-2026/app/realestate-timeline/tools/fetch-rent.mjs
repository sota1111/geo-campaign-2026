/* 総務省統計局「社会・人口統計体系」の指標「専用住宅の1畳当たり家賃」（元は住宅・土地統計調査）を、東京23区ぶん
 * 政府統計の総合窓口（e-Stat）の統計ダッシュボードAPIから取り、web/data/rent.json に書く前処理。
 *   node contests/ichibiz-2026/app/realestate-timeline/tools/fetch-rent.mjs
 *   --check   通信しない。取得内容・回数・出力先を表示
 * 統計ダッシュボードAPIは利用登録・キーが要らない（e-Stat の API 機能の appId とは別）。通信は GET のみ・要求の間隔 500ms 以上。
 * 生の応答は保存しない。指標コード 0801050100000010000、地域階級 4（市区町村）、周期 3（年）。 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const INDICATOR = '0801050100000010000';
const API = 'https://dashboard.e-stat.go.jp/api/1.0/Json/getData';
const WARDS = Array.from({ length: 23 }, (_, i) => String(13101 + i));
const out = path.resolve(import.meta.dirname, '../web/data/rent.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.includes('--check')) {
  console.log(`取得内容: 統計ダッシュボードAPI getData 指標 ${INDICATOR}（専用住宅の1畳当たり家賃）、市区町村 ${WARDS.length}区 × 1回 = ${WARDS.length}回、間隔 500ms`);
  console.log('出力先:', out);
  process.exit(0);
}

const years = new Set();
const wards = {};
let name = '';
for (const code of WARDS) {
  const url = `${API}?${new URLSearchParams({ Lang: 'JP', IndicatorCode: INDICATOR, RegionalRank: '4', RegionCode: code, MetaGetFlg: 'Y', Cycle: '3' })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`統計ダッシュボードAPI が HTTP ${res.status} を返しました（${code}）`);
  const j = (await res.json()).GET_STATS;
  if (j.RESULT.status !== '0') throw new Error(`統計ダッシュボードAPI エラー: ${j.RESULT.errorMsg}`);
  const sd = j.STATISTICAL_DATA;
  const cls = sd.CLASS_INF.CLASS_OBJ.find((o) => o['@id'] === 'regionCode').CLASS;
  name = (Array.isArray(cls) ? cls[0] : cls)['@name'];
  const rows = sd.DATA_INF?.DATA_OBJ ?? [];
  wards[code] = {};
  for (const o of rows) {
    const v = o.VALUE, y = /^(\d{4})CY00$/.exec(v['@time'])?.[1];
    const n = Number(v.$);
    if (y && Number.isFinite(n)) { wards[code][y] = n; years.add(y); }
  }
  console.log(`  ${code} ${name}: ${Object.keys(wards[code]).join('・')}年`);
  await sleep(500);
}
const ys = [...years].sort();
const data = {
  source: '総務省統計局「社会・人口統計体系」指標「専用住宅の1畳当たり家賃」（基は総務省「住宅・土地統計調査」）。政府統計の総合窓口（e-Stat）の統計ダッシュボードAPIから取得して加工して作成',
  indicator: INDICATOR,
  unit: '円/畳（専用住宅。公営・公社・民営・給与住宅などの借家全体）',
  fetchedAt: new Date().toISOString().slice(0, 10),
  years: ys,
  wards: Object.fromEntries(WARDS.map((c) => [c, ys.map((y) => wards[c][y] ?? null)])),
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));
console.log(`書き出しました: ${out}（${ys.join('・')}年）`);
