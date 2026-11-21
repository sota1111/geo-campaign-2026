/* 不動産情報ライブラリ（国土交通省）から、福岡県の標準地（住宅地・商業地）を取得し、画面に要る項目だけを
 * web/data/fukuoka.json に書く前処理。ブラウザからは API を呼ばない（キーが公開されるため）。
 *   1. XCT001（鑑定評価書情報）: 取引事例比較法比準価格・収益価格・還元利回り・相続税路線価など。標準地番号ごとに1つにまとめる
 *   2. XPT002（地価公示・地価調査のポイント）: 公示価格として出す（地価公示だけを使う）「当年価格」。1の標準地の位置があるタイルだけを取り、位置で突き合わせる
 *
 *   cd /home/ubuntu/dev/2026/geo-campaign-2026 && node --env-file=<環境ファイル> contests/ichibiz-2026/app/realestate-a4/tools/fetch.mjs
 *   node contests/ichibiz-2026/app/realestate-a4/tools/fetch.mjs --check     # 通信しない。取得内容・要求回数の見込み・出力先・キーの有無（真偽のみ）を表示
 *   --probe   本取得の前の試し。福岡市中心の XPT002 を1タイルだけ取り、診断（項目名・件数・読めた価格の数）を出して終了。何も書かない
 *   --year 2025   価格時点（既定 2025。XCT001 が指定できるのは直近5年）
 *   --out <ファイル>   出力先を変える（既定 web/data/fukuoka.json）
 *
 * キーは環境変数 REINFOLIB_API_KEY だけから読む（--env-file は環境ファイルを環境変数にするだけ。このスクリプトはそのファイルを開かない）。
 * キーはファイル・ログ・例外メッセージのどこにも出さない。通信は GET のみ。要求の間隔は 500ms 以上。
 * 生の応答は保存しない（取り出した項目だけを書く）。 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GENERATOR, SOURCE, extractPoint, recordsOf, indexOf, FIELDS } from './extract.mjs';
import { groupParcels, extractKojiPoints, attachKoji, fillParcels, tilesOf, diagnoseXpt, MATCH_RADIUS_M } from './parcels.mjs';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const PREF = { code: '40', name: '福岡県' };
const DIVISIONS = [{ code: '00', name: '住宅地' }, { code: '05', name: '商業地' }];
const YEAR = Number(opt('--year', '2025'));
const Z = 13; // XPT002 は 13〜15。最小の 13（タイル数が最も少ない）
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const DELAY_MS = 500;
const out = path.resolve(opt('--out') ?? path.join(here, '../web/data/fukuoka.json'));
const key = process.env.REINFOLIB_API_KEY;

if (!Number.isInteger(YEAR) || YEAR < 2022 || YEAR > 2026) { console.error('--year は 2022〜2026（APIの指定範囲）'); process.exit(2); }

if (flag('--check')) {
  console.log('取得内容:');
  console.log(`  1. XCT001（鑑定評価書情報）${PREF.name} ${YEAR}年 ${DIVISIONS.map((d) => `${d.name}(${d.code})`).join('・')}: ${DIVISIONS.length}回`);
  // 前回の出力（あれば）から、XPT002 で取るタイル数を見積もる（標準地の位置があるタイルだけを取る）
  let est = '前回の出力が無いため見積もれません（標準地の位置があるタイルだけを取ります。福岡県の前回実績では約150タイル）';
  try {
    const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
    const ps = prev.parcels ?? prev.points ?? [];
    if (ps.length) est = `約${tilesOf(ps, Z).length}タイル（前回の出力の標準地 ${new Set(ps.map((p) => p.id)).size} 地点の位置から見積もり）`;
  } catch { /* 前回の出力なし */ }
  console.log(`  2. XPT002（地価公示・地価調査のポイント。地価公示だけを使う）${YEAR}年 z${Z}: ${est}`);
  console.log(`通信はすべて GET。要求の間隔 ${DELAY_MS}ms 以上。所要はおよそ（要求回数 × 0.5秒 + 応答時間）`);
  console.log('出力先:', out);
  console.log('REINFOLIB_API_KEY:', key ? 'あり' : 'なし（実取得には必要）');
  process.exit(0);
}
if (!key) { console.error('環境変数 REINFOLIB_API_KEY がありません。--env-file を付けて実行してください（--check は不要）'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = {}; // HTTP ステータスごとの回数（診断用）
const tally = (s) => { status[s] = (status[s] ?? 0) + 1; };
async function get(endpoint, params) {
  const url = `${BASE}${endpoint}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    let res = null;
    try { res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key, 'Accept-Encoding': 'gzip' } }); } catch { /* 再試行 */ }
    if (res) tally(res.status); else tally('通信失敗');
    if (res?.ok) {
      let buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf); // 自動で展開されない場合
      await sleep(DELAY_MS);
      return JSON.parse(buf.toString('utf8'));
    }
    if (res && res.status === 404 && endpoint === 'XPT002') { await sleep(DELAY_MS); return { features: [] }; } // 標準地が無いタイル（件数は status に数える）
    if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`${endpoint} が HTTP ${res.status} を返しました（${res.status === 401 || res.status === 403 ? 'キーが無効、または未承認の可能性' : 'パラメータを確認'}）`);
    }
    await sleep(1500 * attempt);
  }
  throw new Error(`${endpoint} に接続できませんでした（4回失敗）`);
}

const XPT_PARAMS = (x, y) => ({ response_format: 'geojson', z: String(Z), x: String(x), y: String(y), year: String(YEAR) }); // priceClassification は付けない（地価公示／地価調査は返る項目 land_price_type で分ける）
function printDiag(label, feats) {
  const d = diagnoseXpt(feats);
  console.log(`  [診断] ${label}: features ${d.features}（Point ${d.points}）、価格（u_current_years_price_ja）を数として読めた ${d.priceReadable} 件`);
  console.log('  [診断] 地価区分 land_price_type ごとの件数（0=地価公示, 1=都道府県地価調査）:', JSON.stringify(d.typeCounts));
  console.log('  [診断] 1件目の properties の項目名（値は出さない）:', d.keys.join(' / ') || '（なし）');
  if (d.missingKeys.length) console.log('  [診断] 想定していて見つからない項目名:', d.missingKeys.join(' / '));
  console.log('  [診断] HTTP ステータスの回数:', JSON.stringify(status));
}

if (flag('--probe')) {
  // 福岡市中心（130.4017, 33.5902）の z13 タイル1つ
  const n = 2 ** Z, s = Math.sin(33.5902 * Math.PI / 180);
  const x = Math.floor(((130.4017 + 180) / 360) * n), y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  console.log(`--probe: XPT002 ${YEAR}年 z${Z} タイル ${x}/${y}（福岡市中心）を1回だけ取得します`);
  const j = await get('XPT002', XPT_PARAMS(x, y));
  printDiag('福岡市中心の1タイル', j.features ?? []);
  const k = extractKojiPoints(j.features ?? []);
  console.log(`  地価公示として抽出できた標準地: ${k.length} 点（0 なら上の診断で原因を確認）`);
  console.log('  何も書いていません。問題なければ --probe を外して本取得してください');
  process.exit(k.length ? 0 : 1);
}

// ---- 1. XCT001 ----
const records = [];
const counts = {};
for (const d of DIVISIONS) {
  const json = await get('XCT001', { year: String(YEAR), area: PREF.code, division: d.code });
  const recs = recordsOf(json);
  let skipped = 0;
  for (const r of recs) { const p = extractPoint(r, d.name); if (p) records.push(p); else skipped++; }
  counts[d.name] = { received: recs.length, skipped };
  console.log(`  XCT001 ${PREF.name} ${YEAR}年 ${d.name}: 受信 ${recs.length}件、位置・価格が取れず除外 ${skipped}件`);
  if (recs.length && skipped === recs.length) {
    console.error('  全件が除外されました。1件目の項目名（値は出さない）:', [...indexOf(recs[0]).keys()].join(' / '));
    console.error('  想定する項目名:', Object.values(FIELDS).join(' / '));
    process.exit(1);
  }
}
if (!records.length) { console.error('標準地が1つも取れませんでした。書き出しません'); process.exit(1); }
const grouped = groupParcels(records);
console.log(`  標準地番号で ${grouped.length} 地点にまとめました（記録 ${records.length} 件）`);

// ---- 2. XPT002（公示価格） ----
const tiles = tilesOf(grouped, Z);
console.log(`  XPT002: ${tiles.length}タイルを取得します（約 ${Math.ceil((tiles.length * (DELAY_MS + 300)) / 1000)} 秒）`);
const feats = [];
for (const [i, t] of tiles.entries()) {
  const j = await get('XPT002', XPT_PARAMS(t.x, t.y));
  feats.push(...(j.features ?? []));
  if (i % 20 === 19) console.log(`  XPT002 ${i + 1}/${tiles.length} タイル`);
}
console.log(`  XPT002 HTTP ステータスの回数: ${JSON.stringify(status)}、features 総数 ${feats.length}`);
const kojiPoints = extractKojiPoints(feats);
console.log(`  XPT002: 地価公示の標準地 ${kojiPoints.length} 点を受信`);
if (!kojiPoints.length) {
  printDiag('取得した全タイル', feats);
  console.error('XPT002 から地価公示の標準地が取れませんでした。書き出しません（上の診断を共有してください）');
  process.exit(1);
}
const { parcels, matched } = attachKoji(grouped, kojiPoints);
const f = fillParcels(parcels);
console.log(`  突き合わせ（位置 ${MATCH_RADIUS_M}m 以内・用途が同じ）: ${matched}/${parcels.length} 地点で公示価格を当てられました`);
console.log('  値のある標準地数:', JSON.stringify(f));

const data = {
  generator: GENERATOR, version: 2, source: SOURCE, fetchedAt: new Date().toISOString().slice(0, 10),
  pref: PREF, year: YEAR, counts, fill: f,
  koji: { source: '不動産情報ライブラリ XPT002（地価公示）の当年価格', points: kojiPoints.length, matched },
  parcels,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out + '.tmp', JSON.stringify(data));
fs.renameSync(out + '.tmp', out);
console.log(`書き出しました: ${out}（${parcels.length}地点、${(fs.statSync(out).size / 1024).toFixed(0)}KB）`);
