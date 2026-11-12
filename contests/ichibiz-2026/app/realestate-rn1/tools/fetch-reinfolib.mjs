/* 不動産情報ライブラリ（国土交通省）の API から、徳島市周辺の12項目を取得して web/data/ に書く前処理。
 * ブラウザからは API を呼ばない（キーが公開されるため。公式もブラウザからのリクエストを勧めていない）。公開前に手元で1回実行する。
 *
 *   node --env-file=<.envのパス> tools/fetch-reinfolib.mjs            # 取得して web/data/ に書く
 *   node tools/fetch-reinfolib.mjs --check                           # キー不要。取得する範囲と本数だけ表示（通信しない）
 *   node --env-file=... tools/fetch-reinfolib.mjs --only XKT003,XKT013   # 項目を絞る（書くのは取れた項目だけ。他は前回の結果を残す）
 *   --out <フォルダ>   出力先を変える（既定は web/data。試験用）
 *
 * キーは環境変数 REINFOLIB_API_KEY だけから読む（--env-file は .env を環境変数にするだけ。このスクリプトは .env を開かない）。
 * キーはファイル・ログ・例外メッセージのどこにも出さない。通信は GET のみ。取得できなかった項目は理由を manifest.json に残し、画面は「未取得」と表示する。 */
import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATOR, SOURCE, POP_YEARS, tilesFor,
  extractPlan, extractMesh, extractSchools, extractPreschools, extractMedical, extractElderCare, extractSchoolDistricts, extractAreas, rasterizeLevels, extractFloodLevels, extractLeveledByLabel, extractLiquefaction,
} from './extract.mjs';

const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const outDir = path.resolve(opt('--out') ?? path.join(here, '../web/data'));

const CITY = { code: '36201', name: '徳島市' };
// 徳島市周辺。南端は 33.95（徳島市の最南のメッシュ中心は北緯33.957。以前の 33.98 では南部の校区が切れていた）
const BBOX = [134.42, 33.95, 134.66, 34.16];
const raster = (r, bbox = BBOX) => [rasterizeLevels(r.items, bbox, r.labels)];
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const DELAY_MS = 300;
const key = process.env.REINFOLIB_API_KEY;

function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n) };
}

// 項目の定義。z は公式の指定範囲（XKT026・XKT028 は 14〜15、他は 11〜15）。点・小さな多角形は z13（本数が少ない）。
const LAYERS = [
  { api: 'XKT003', label: '立地適正化計画', z: 13, file: 'plan.json', make: extractPlan },
  { api: 'XKT013', label: '将来推計人口（250mメッシュ）', z: 13, file: 'population.json', make: extractMesh },
  { api: 'XKT004', label: '小学校区', z: 13, file: 'districts.json', make: extractSchoolDistricts },
  { api: 'XKT006', label: '学校（小・中学校）', z: 13, file: 'facilities.json', part: 'schools', make: extractSchools },
  { api: 'XKT007', label: '保育園・幼稚園等', z: 13, file: 'facilities.json', part: 'preschools', make: extractPreschools },
  { api: 'XKT010', label: '医療機関', z: 13, file: 'facilities.json', part: 'medical', make: extractMedical },
  { api: 'XKT011', label: '福祉施設（老人福祉施設）', z: 13, file: 'facilities.json', part: 'elder', make: extractElderCare },
  { api: 'XKT029', label: '土砂災害警戒区域', z: 13, file: 'hazards.json', part: 'sediment', make: (f) => extractAreas(f, 4) },
  { api: 'XKT026', label: '洪水浸水想定区域（想定最大規模）', z: 14, file: 'hazards.json', part: 'flood', make: (f) => raster(extractFloodLevels(f, 5)), countOf: (rows) => rows[0].cells },
  { api: 'XKT028', label: '津波浸水想定', z: 14, file: 'hazards.json', part: 'tsunami', make: (f) => raster(extractLeveledByLabel(f, (p) => p.A40_003, 5)), countOf: (rows) => rows[0].cells },
  { api: 'XKT027', label: '高潮浸水想定区域', z: 13, file: 'hazards.json', part: 'surge', make: (f) => raster(extractLeveledByLabel(f, (p) => p.A49_003, 5)), countOf: (rows) => rows[0].cells },
  { api: 'XKT025', label: '液状化の発生傾向（地形区分に基づく）', z: 13, file: 'hazards.json', part: 'liquefaction', make: (f) => raster(extractLiquefaction(f, 5)), countOf: (rows) => rows[0].cells },
];
const only = (opt('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const targets = LAYERS.filter((l) => !only.length || only.includes(l.api));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class ApiError extends Error {}

async function get(api, params) {
  const url = `${BASE}${api}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res = null;
    try {
      res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
    } catch { /* 通信失敗は再試行（エラー内容にURL・ヘッダが入りうるので出さない） */ }
    if (res?.ok) { await sleep(DELAY_MS); return res.json(); }
    if (res && res.status !== 429 && res.status < 500) {
      // 401/403=キーが無効・未承認、400=パラメータ。再試行しても同じなので止める（応答本文は出さない）
      throw new ApiError(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? '（キーが無効、または未承認の可能性）' : '（パラメータ・ズームの範囲を確認）'}`);
    }
    await sleep(1000 * attempt * attempt);
  }
  throw new ApiError('接続できませんでした（6回失敗。429＝アクセス集中を含む）');
}

async function fetchLayer(l) {
  const tiles = tilesFor(BBOX, l.z, tileOf);
  const feats = [];
  for (const [i, t] of tiles.entries()) {
    const j = await get(l.api, { response_format: 'geojson', z: String(l.z), x: String(t.x), y: String(t.y) });
    feats.push(...(j?.features ?? []));
    if (i % 20 === 19) console.log(`  ${l.api}: ${i + 1}/${tiles.length} タイル`);
  }
  const rows = l.make(feats);
  if (!rows.length || (l.countOf && !l.countOf(rows))) throw new ApiError('応答は取れたが、対象範囲のデータが0件');
  return { rows, tiles: tiles.length, received: feats.length };
}

async function main() {
  console.log('取得予定:');
  for (const l of targets) console.log(`  ${l.api} ${l.label}: z${l.z}・${tilesFor(BBOX, l.z, tileOf).length}タイル → ${l.file}`);
  console.log(`出力先: ${path.relative(process.cwd(), outDir) || '.'}（約0.3秒間隔のGET）`);
  if (flag('--check')) return;
  if (!key) {
    console.error('環境変数 REINFOLIB_API_KEY がありません。node --env-file=<.envのパス> で渡してください（README.md）。');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')); } catch { return null; } };
  const manifest = readJson('manifest.json') ?? { layers: {} };
  const today = new Date().toISOString().slice(0, 10);
  const files = { 'plan.json': null, 'population.json': null, 'districts.json': null, 'facilities.json': null, 'hazards.json': null };
  for (const f of Object.keys(files)) files[f] = only.length ? (readJson(f) ?? {}) : {};
  const failed = [];

  for (const l of targets) {
    console.log(`${l.api} ${l.label} を取得中…`);
    try {
      const { rows, tiles, received } = await fetchLayer(l);
      const f = files[l.file];
      if (l.part) f[l.part] = l.countOf ? rows[0] : rows; else f.items = rows;
      manifest.layers[l.api] = { label: l.label, status: 'ok', file: l.file, part: l.part ?? null, z: l.z, tiles, received, count: l.countOf ? l.countOf(rows) : rows.length, fetchedAt: today };
      console.log(`  取得: ${received}件を受信 → ${l.countOf ? l.countOf(rows) + 'セル（約18m格子）' : rows.length + '件'}を保存`);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      failed.push(l.api);
      manifest.layers[l.api] = { label: l.label, status: 'failed', reason: e.message, file: l.file, part: l.part ?? null, z: l.z, fetchedAt: today };
      if (l.part && files[l.file]) delete files[l.file][l.part];
      console.error(`  失敗: ${e.message}`);
      if (/HTTP 40[13]/.test(e.message)) break; // キーの問題は他のAPIでも同じ
    }
  }
  const header = { generator: GENERATOR, source: SOURCE, fetchedAt: today, city: CITY, bbox: BBOX };
  for (const [f, body] of Object.entries(files)) {
    const used = LAYERS.some((l) => l.file === f && manifest.layers[l.api]?.status === 'ok');
    if (!used) { if (fs.existsSync(path.join(outDir, f))) fs.rmSync(path.join(outDir, f)); continue; }
    const extra = f === 'population.json' ? { years: POP_YEARS, fields: ['総数(PT00)', '0〜14歳(PTA)', '65歳以上(PTC)', '75歳以上(PTD)'] } : {};
    fs.writeFileSync(path.join(outDir, f), JSON.stringify({ ...body, ...header, ...extra }));
  }
  manifest.generator = GENERATOR; manifest.source = SOURCE; manifest.city = CITY; manifest.bbox = BBOX; manifest.fetchedAt = today;
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  for (const f of fs.readdirSync(outDir)) console.log(`  ${f}: ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)}KB`);
  if (failed.length) { console.error(`取得できなかった項目: ${failed.join('・')}`); process.exit(1); }
}
await main();
