/* 不動産情報ライブラリ（国土交通省）の鑑定評価書情報API（XCT001）から、福岡県の標準地（住宅地・商業地）を取得し、
 * 画面に要る項目だけを web/data/fukuoka.json に書く前処理。ブラウザからは API を呼ばない（キーが公開されるため）。
 *
 *   cd /home/ubuntu/dev/2026/geo-campaign-2026 && node --env-file=<環境ファイル> contests/ichibiz-2026/app/realestate-a4/tools/fetch.mjs
 *   node contests/ichibiz-2026/app/realestate-a4/tools/fetch.mjs --check     # 通信しない。取得する内容・出力先・キーの有無（真偽のみ）だけ表示
 *   --year 2025   価格時点（既定 2025。API が指定できるのは直近5年）
 *   --out <ファイル>   出力先を変える（既定 web/data/fukuoka.json）
 *
 * キーは環境変数 REINFOLIB_API_KEY だけから読む（--env-file は環境ファイルを環境変数にするだけ。このスクリプトはそのファイルを開かない）。
 * キーはファイル・ログ・例外メッセージのどこにも出さない。通信は GET のみ。要求の間隔は 500ms 以上。
 * 生の応答は保存しない（取り出した項目だけを書く）。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GENERATOR, SOURCE, extractPoint, recordsOf, fill, indexOf, FIELDS } from './extract.mjs';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const PREF = { code: '40', name: '福岡県' };
const DIVISIONS = [{ code: '00', name: '住宅地' }, { code: '05', name: '商業地' }];
const YEAR = Number(opt('--year', '2025'));
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const DELAY_MS = 500;
const out = path.resolve(opt('--out') ?? path.join(here, '../web/data/fukuoka.json'));
const key = process.env.REINFOLIB_API_KEY;

if (!Number.isInteger(YEAR) || YEAR < 2022 || YEAR > 2026) { console.error('--year は 2022〜2026（APIの指定範囲）'); process.exit(2); }

if (flag('--check')) {
  console.log('取得内容: XCT001（鑑定評価書情報）', PREF.name, `${YEAR}年`, DIVISIONS.map((d) => `${d.name}(${d.code})`).join('・'));
  console.log(`要求回数: ${DIVISIONS.length}回（GET）。間隔 ${DELAY_MS}ms 以上`);
  console.log('出力先:', out);
  console.log('REINFOLIB_API_KEY:', key ? 'あり' : 'なし（実取得には必要）');
  process.exit(0);
}
if (!key) { console.error('環境変数 REINFOLIB_API_KEY がありません。--env-file を付けて実行してください（--check は不要）'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(params) {
  const url = `${BASE}XCT001?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res = null;
    try { res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key, 'Accept-Encoding': 'gzip' } }); } catch { /* 再試行 */ }
    if (res?.ok) {
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf); // 自動で展開されない場合
      await sleep(DELAY_MS);
      return JSON.parse(buf.toString('utf8'));
    }
    if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`XCT001 が HTTP ${res.status} を返しました（${res.status === 401 || res.status === 403 ? 'キーが無効、または未承認の可能性' : 'パラメータを確認'}）`);
    }
    await sleep(1500 * attempt);
  }
  throw new Error('XCT001 に接続できませんでした（4回失敗）');
}

const points = [];
const counts = {};
for (const d of DIVISIONS) {
  const json = await get({ year: String(YEAR), area: PREF.code, division: d.code });
  const recs = recordsOf(json);
  let skipped = 0;
  for (const r of recs) { const p = extractPoint(r, d.name); if (p) points.push(p); else skipped++; }
  counts[d.name] = { received: recs.length, skipped };
  console.log(`  XCT001 ${PREF.name} ${YEAR}年 ${d.name}: 受信 ${recs.length}件、位置・価格が取れず除外 ${skipped}件`);
  if (recs.length && skipped === recs.length) {
    // 項目名が想定と違う疑い。値は出さず、項目名だけ出す（診断用）
    console.error('  全件が除外されました。1件目の項目名（値は出さない）:', [...indexOf(recs[0]).keys()].join(' / '));
    console.error('  想定する項目名:', Object.values(FIELDS).join(' / '));
    process.exit(1);
  }
}
const f = fill(points);
console.log('  値のある件数:', JSON.stringify(f));
if (!points.length || (f.price === 0 && f.rosenka === 0 && f.hikaku === 0 && f.shueki === 0)) { console.error('価格が1つも取れませんでした。書き出しません'); process.exit(1); }

const data = {
  generator: GENERATOR, source: SOURCE, fetchedAt: new Date().toISOString().slice(0, 10),
  pref: PREF, year: YEAR, counts, fill: f,
  points,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out + '.tmp', JSON.stringify(data));
fs.renameSync(out + '.tmp', out);
console.log(`書き出しました: ${out}（${points.length}件、${(fs.statSync(out).size / 1024).toFixed(0)}KB）`);
