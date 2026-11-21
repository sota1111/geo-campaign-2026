/* 不動産情報ライブラリ（国土交通省）XIT001（不動産価格（取引価格）情報）から、東京都の「中古マンション等」を四半期ごとに取り、
 * 23区×四半期の件数・中央値などに集計して web/data/price.json に書く前処理。ブラウザからは API を呼ばない（キーが公開されるため）。
 *
 *   cd /home/ubuntu/dev/2026/geo-campaign-2026 && node --env-file=.env contests/ichibiz-2026/app/realestate-timeline/tools/fetch.mjs
 *   node contests/ichibiz-2026/app/realestate-timeline/tools/fetch.mjs --check   # 通信しない。取得内容・回数・出力先・キーの有無（真偽のみ）
 *   --survey         全期間を取り、間取り・地区名の分布と、年の幅×件数基準ごとの「件数が少ない」割合を出して終了（何も書かない）
 *   --probe          直近の1四半期だけを取り、項目名・Type の種類・件数の診断を出して終了（何も書かない）
 *   --from 2005Q3    最初の四半期（既定 2005Q3。取引価格は2005年第3四半期から）
 *   --to 2026Q4      最後の四半期（既定 2026Q4。まだ公開されていない四半期は0件で返るので、末尾の0件が続いた時点で打ち切る）
 *   --out <ファイル>  出力先を変える（既定 web/data/price.json）
 *
 * キーは環境変数 REINFOLIB_API_KEY だけから読む。キーはファイル・ログ・例外メッセージのどこにも出さない。通信は GET のみ。
 * 要求の間隔は 500ms 以上。生の応答は保存しない（集計だけを書く）。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { WARD_CODES, TYPE_MANSION, AREA_MIN, AREA_MAX, LOW_N, toTrade, aggregate, aggregateYears, quarterKey, PLAN_GROUPS } from './aggregate.mjs';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const parseQ = (s) => { const m = /^(\d{4})Q([1-4])$/.exec(s); if (!m) { console.error(`四半期は 2005Q3 の形式で: ${s}`); process.exit(2); } return { y: Number(m[1]), q: Number(m[2]) }; };

const FROM = parseQ(opt('--from', '2005Q3'));
const TO = parseQ(opt('--to', '2026Q4'));
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const DELAY_MS = 500;
const AREA_CODE = '13'; // 東京都（1回で都内全域が返る。23区だけを残す）
const out = path.resolve(opt('--out') ?? path.join(here, '../web/data/price.json'));
const key = process.env.REINFOLIB_API_KEY;

const quarters = [];
for (let y = FROM.y, q = FROM.q; y < TO.y || (y === TO.y && q <= TO.q); q === 4 ? (y++, q = 1) : q++) quarters.push({ y, q });

if (flag('--check')) {
  console.log(`取得内容: XIT001（取引価格のみ priceClassification=01）東京都 ${quarterKey(FROM.y, FROM.q)}〜${quarterKey(TO.y, TO.q)} の ${quarters.length} 四半期 = 最大 ${quarters.length} 回`);
  console.log(`集計: Type=「${TYPE_MANSION}」・23区（${WARD_CODES[0]}〜${WARD_CODES[22]}）・面積 ${AREA_MIN}〜${AREA_MAX}㎡の記録を、区×四半期で件数・㎡単価・総額・面積・築年数の中央値などに`);
  console.log(`通信はすべて GET。要求の間隔 ${DELAY_MS}ms 以上。出力先: ${out}`);
  console.log('REINFOLIB_API_KEY:', key ? 'あり' : 'なし（実取得には必要）');
  process.exit(0);
}
if (!key) { console.error('環境変数 REINFOLIB_API_KEY がありません。--env-file を付けて実行してください（--check は不要）'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = {};
const tally = (s) => { status[s] = (status[s] ?? 0) + 1; };
async function get(params) {
  const url = `${BASE}XIT001?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res = null;
    try { res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key, 'Accept-Encoding': 'gzip' } }); } catch { /* 再試行 */ }
    tally(res ? res.status : '通信失敗');
    if (res?.ok) {
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
      await sleep(DELAY_MS);
      return JSON.parse(buf.toString('utf8'));
    }
    if (res && res.status === 404) { await sleep(DELAY_MS); return { data: [] }; } // その四半期のデータが無い
    if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`XIT001 が HTTP ${res.status} を返しました（${res.status === 401 || res.status === 403 ? 'キーが無効、または未承認の可能性' : 'パラメータを確認'}）`);
    }
    await sleep(1500 * attempt);
  }
  throw new Error('XIT001 に接続できませんでした（4回失敗）');
}
const recordsOf = (j) => (Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : []);
const params = ({ y, q }) => ({ year: String(y), quarter: String(q), area: AREA_CODE, priceClassification: '01' });

if (flag('--probe')) {
  const last = quarters[quarters.length - 1];
  console.log(`--probe: XIT001 東京都 ${quarterKey(last.y, last.q)} を1回だけ取得します`);
  const recs = recordsOf(await get(params(last)));
  const types = {};
  for (const r of recs) types[r.Type] = (types[r.Type] ?? 0) + 1;
  const usable = recs.map(toTrade).filter(Boolean);
  console.log(`  受信 ${recs.length}件。Type ごとの件数:`, JSON.stringify(types));
  console.log(`  使える中古マンション等（23区）: ${usable.length}件`);
  console.log('  1件目の項目名（値は出さない）:', recs[0] ? Object.keys(recs[0]).join(' / ') : '（なし）');
  console.log('  HTTP ステータスの回数:', JSON.stringify(status));
  console.log('  何も書いていません');
  process.exit(0);
}

const trades = [];
const rawPlans = {};
const perQuarter = {};
let emptyRun = 0;
for (const qq of quarters) {
  const recs = recordsOf(await get(params(qq)));
  const k = quarterKey(qq.y, qq.q);
  for (const r of recs) if (toTrade(r)) rawPlans[String(r.FloorPlan ?? '')] = (rawPlans[String(r.FloorPlan ?? '')] ?? 0) + 1;
  const used = recs.map(toTrade).filter(Boolean);
  perQuarter[k] = { received: recs.length, used: used.length };
  trades.push(...used);
  console.log(`  ${k}: 受信 ${recs.length}件、使える中古マンション等（23区）${used.length}件`);
  emptyRun = recs.length ? 0 : emptyRun + 1;
  if (emptyRun >= 2) { console.log('  2四半期続けて0件のため、ここで打ち切ります（まだ公開されていない四半期）'); break; }
}
if (!trades.length) { console.error('使える取引が1件も取れませんでした。書き出しません'); process.exit(1); }

if (flag('--survey')) {
  const top = Object.entries(rawPlans).sort((a, b) => b[1] - a[1]);
  console.log('間取り（FloorPlan の原文）の件数 上位40:', top.slice(0, 40).map(([k, v]) => `${k || '(空)'}=${v}`).join(' / '));
  const withD = trades.filter((t) => t.district);
  console.log(`使えた取引 ${trades.length}件、地区名あり ${withD.length}件、地区名の種類（区×名）${new Set(withD.map((t) => t.code + '|' + t.district)).size}`);
  console.log('間取りのまとめ方ごとの件数:', PLAN_GROUPS.map((g) => `${g.label}=${trades.filter((t) => g.key === 'all' || t.plan === g.key).length}`).join(' / '));
  const years = [...new Set(trades.map((t) => t.year))].sort();
  const names = new Map(); for (const t of withD) names.set(t.code + '|' + t.district, (names.get(t.code + '|' + t.district) ?? 0) + 1);
  console.log('地区名の例（件数の多い順20）:', [...names].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}=${v}`).join(' / '));
  console.log('地区名の例（ランダムに近い40）:', [...names.keys()].filter((_, i) => i % 60 === 0).join(' / '));
  for (const win of [1, 3, 5]) {
    const a = aggregateYears(trades, { scope: 'district', win, years });
    for (const lowN of [5, 10, 20, 30]) {
      const row = [];
      for (const g of PLAN_GROUPS) {
        let cells = 0, low = 0, nIn = 0, nLow = 0;
        for (const [k, v] of a) { if (!k.split('|')[2] || k.split('|')[2] !== g.key) continue; cells++; nIn += v.n; if (v.n < lowN) { low++; nLow += v.n; } }
        row.push(`${g.label}: 値あり${cells}セル 少${(100 * low / Math.max(1, cells)).toFixed(0)}%`);
      }
      console.log(`年の幅${win} 基準${lowN}件未満 → ${row.join(' | ')}`);
    }
  }
  console.log('HTTP ステータスの回数:', JSON.stringify(status)); console.log('何も書いていません'); process.exit(0);
}
const agg = aggregate(trades);
const qKeys = [...new Set(trades.map((t) => t.key))].sort();
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const wards = {};
for (const code of WARD_CODES) {
  // 配列は quarters と同じ並び。[件数, ㎡単価の中央値(万円/㎡), 25%点, 75%点, 総額の中央値(万円), 面積の中央値(㎡), 築年数の中央値] 。その四半期に無ければ null
  wards[code] = qKeys.map((k) => {
    const a = agg.get(`${code}|${k}`);
    return a ? [a.n, r1(a.unit / 1e4), r1(a.unitP25 / 1e4), r1(a.unitP75 / 1e4), Math.round(a.price / 1e4), Math.round(a.area), a.age === null ? null : Math.round(a.age)] : null;
  });
}
const data = {
  source: '国土交通省 不動産情報ライブラリ XIT001（不動産価格（取引価格）情報）の「中古マンション等」を加工して作成',
  fetchedAt: new Date().toISOString().slice(0, 10),
  fields: ['件数', '㎡単価の中央値(万円/㎡)', '㎡単価の25%点', '㎡単価の75%点', '取引総額の中央値(万円)', '面積の中央値(㎡)', '築年数の中央値(年)'],
  filter: { type: TYPE_MANSION, priceClassification: '取引価格のみ', areaM2: [AREA_MIN, AREA_MAX], lowN: LOW_N },
  totalUsed: trades.length,
  quarters: qKeys,
  wards,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out + '.tmp', JSON.stringify(data));
fs.renameSync(out + '.tmp', out);
console.log(`HTTP ステータスの回数: ${JSON.stringify(status)}`);
console.log(`書き出しました: ${out}（${qKeys.length}四半期、使えた取引 ${trades.length}件、${(fs.statSync(out).size / 1024).toFixed(0)}KB）`);
