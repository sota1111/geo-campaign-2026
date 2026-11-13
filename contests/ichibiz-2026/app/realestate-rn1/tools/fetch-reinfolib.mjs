/* 不動産情報ライブラリ（国土交通省）の API から、地域（徳島市・東京23区・大阪市）周辺の項目を取得して web/data/<地域>/ に書く前処理。
 * ブラウザからは API を呼ばない（キーが公開されるため。公式もブラウザからのリクエストを勧めていない）。公開前に手元で実行する。
 *
 *   node --env-file=<.envのパス> tools/fetch-reinfolib.mjs --region tokyo23   # 取得して web/data/tokyo23/ に書く（地域: tokushima（既定）・tokyo23・osaka）
 *   node tools/fetch-reinfolib.mjs --region osaka --check                      # キー不要。取得する範囲と本数だけ表示（通信しない）
 *   node --env-file=... tools/fetch-reinfolib.mjs --region osaka --only XKT003,XKT013   # 項目を絞る（書くのは取れた項目だけ。他は前回の結果を残す）
 *   --out <フォルダ>   出力先を変える（既定は web/data/<地域>。試験用）
 *
 * キーは環境変数 REINFOLIB_API_KEY だけから読む（--env-file は .env を環境変数にするだけ。このスクリプトは .env を開かない）。
 * キーはファイル・ログ・例外メッセージのどこにも出さない。通信は GET のみ（約0.3秒間隔。429 は待って再試行）。
 * 取得できなかった項目は理由を manifest.json に残し、画面は「未取得」と表示する。応答は取れたが対象範囲が0件の項目は status: 'empty'（画面は「データ無し」。「該当なし」とは書かない）。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  GENERATOR, SOURCE, POP_YEARS, tilesFor, inCodes, countByCity, makeMask, clipPoints, clipPolys, LevelRaster,
  extractPlan, extractMesh, extractSchools, extractPreschools, extractMedical, extractElderCare, extractSchoolDistricts, extractAreas,
  extractFloodLevels, extractLeveledByLabel, extractLiquefaction, extractZoning, extractAreaClass,
} from './extract.mjs';

const Lib = createRequire(import.meta.url)('../web/lib.js');
const here = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const regionId = opt('--region', 'tokushima');
const REGION = Lib.REGIONS[regionId];
if (!REGION) { console.error(`--region は ${Object.keys(Lib.REGIONS).join('・')} のどれか`); process.exit(2); }
const outDir = path.resolve(opt('--out') ?? path.join(here, '../web/data', REGION.dir));
const BBOX = REGION.bbox;
const CITY = { code: REGION.codes[0], name: REGION.name };
const CODES = REGION.codes;
const BASE = process.env.REINFOLIB_BASE_URL || 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
const DELAY_MS = 300;
/** 地域の内側に残った格子がこれ未満（約1.6万m²未満）なら、区域とは扱わない（clip の地域のみ） */
const MIN_CELLS = 50;
const key = process.env.REINFOLIB_API_KEY;

function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n) };
}

// 地域の内側だけを同梱する地域（clip）では、XKT001（都市計画区域）の多角形を格子にした「地域の内側」で、施設・災害の区域を絞る
// （隣の自治体のデータには、利用条件が非商用のものがある。徳島市は従来どおり絞らない＝取得済みのデータを変えない）
let mask = null;
const clipOn = () => {
  if (!REGION.clip) return false;
  if (!mask) throw new ApiError('地域の内側（XKT001 の都市計画区域）が取れていないため、隣の自治体のデータを除けない');
  return true;
};
const clipPts = (rows) => (clipOn() ? clipPoints(rows, mask) : rows);
const clipAreas = (polys) => (clipOn() ? clipPolys(polys, mask) : polys);

// 項目の定義。z は公式の指定範囲（XKT026・XKT028 は 14〜15、他は 11〜15）。点・小さな多角形は z13（本数が少ない）。
// raster: タイルごとに格子へ書き足す（多角形を全部メモリに置かない）。ingest(acc, features) が acc（LevelRaster）に書く
const LAYERS = [
  ...(REGION.zoning ? [
    // 地域の内側（mask）の元になるので最初に取る
    { api: 'XKT001', label: '都市計画区域・区域区分', z: 13, file: 'zoning.json', part: 'areas', make: (f) => extractAreaClass(f, CODES), afterMake: (rows) => { mask = makeMask(rows.flatMap((e) => e.polys), BBOX); } },
    { api: 'XKT002', label: '用途地域', z: 13, file: 'zoning.json', part: 'use', make: (f) => extractZoning(f, CODES) },
  ] : []),
  { api: 'XKT003', label: '立地適正化計画', z: 13, file: 'plan.json', make: (f) => (REGION.clip ? extractPlan(f).filter((e) => inCodes(CODES, e.cityCode)) : extractPlan(f)), byCity: true },
  { api: 'XKT013', label: '将来推計人口（250mメッシュ）', z: 13, file: 'population.json', make: extractMesh },
  { api: 'XKT004', label: '小学校区', z: 13, file: 'districts.json', make: (f) => (REGION.clip ? extractSchoolDistricts(f).filter((e) => inCodes(CODES, e.city)) : extractSchoolDistricts(f)) },
  { api: 'XKT006', label: '学校（小・中学校）', z: 13, file: 'facilities.json', part: 'schools', make: (f) => clipPts(extractSchools(f)) },
  { api: 'XKT007', label: '保育園・幼稚園等', z: 13, file: 'facilities.json', part: 'preschools', make: (f) => clipPts(extractPreschools(f)) },
  { api: 'XKT010', label: '医療機関', z: 13, file: 'facilities.json', part: 'medical', make: (f) => clipPts(extractMedical(f)) },
  { api: 'XKT011', label: '福祉施設（老人福祉施設）', z: 13, file: 'facilities.json', part: 'elder', make: (f) => clipPts(extractElderCare(f, REGION.clip ? CODES : null)) },
  { api: 'XKT029', label: '土砂災害警戒区域', z: 13, file: 'hazards.json', part: 'sediment', make: (f) => clipAreas(extractAreas(f, 4)) },
  { api: 'XKT026', label: '洪水浸水想定区域（想定最大規模）', z: 14, file: 'hazards.json', part: 'flood', raster: true, ingest: (acc, f) => { const r = extractFloodLevels(f, 5); acc.addCoded(r.items, r.labels); } },
  { api: 'XKT028', label: '津波浸水想定', z: 14, file: 'hazards.json', part: 'tsunami', raster: true, ingest: (acc, f) => { acc.addLabeled(labeledRows(f, (p) => p.A40_003)); } },
  { api: 'XKT027', label: '高潮浸水想定区域', z: 13, file: 'hazards.json', part: 'surge', raster: true, ingest: (acc, f) => { acc.addLabeled(labeledRows(f, (p) => p.A49_003)); } },
  { api: 'XKT025', label: '液状化の発生傾向（地形区分に基づく）', z: 13, file: 'hazards.json', part: 'liquefaction', raster: true, ingest: (acc, f) => { const r = extractLiquefaction(f, 5); acc.addCoded(r.items, r.labels); } },
];
/** 浸水深の区分名（A40_003 など）ごとの多角形。extractLeveledByLabel と同じ整形（区分名の空白除去・「～」→「〜」）を、番号を振る前の形で返す */
function labeledRows(features, getLabel) {
  const rows = [];
  for (const f of features) {
    const label = String(getLabel(f?.properties ?? {}) ?? '').trim().replace(/\s+/g, '').replace(/～/g, '〜');
    if (!label) continue;
    for (const rings of extractAreas([f], 4)) rows.push({ rings, label });
  }
  return rows;
}
const only = (opt('--only') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const targets = LAYERS.filter((l) => !only.length || only.includes(l.api));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class ApiError extends Error {}

async function get(api, params) {
  const url = `${BASE}${api}?${new URLSearchParams(params)}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let res = null;
    try {
      res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key }, signal: AbortSignal.timeout(90000) });
    } catch { /* 通信失敗は再試行（エラー内容にURL・ヘッダが入りうるので出さない） */ }
    if (res?.ok) {
      try { const j = await res.json(); await sleep(DELAY_MS); return j; } catch { /* 本文の読み取り失敗は再試行 */ }
    } else if (res && res.status !== 429 && res.status < 500) {
      // 401/403=キーが無効・未承認、400=パラメータ。再試行しても同じなので止める（応答本文は出さない）
      throw new ApiError(`HTTP ${res.status}${res.status === 401 || res.status === 403 ? '（キーが無効、または未承認の可能性）' : '（パラメータ・ズームの範囲を確認）'}`);
    }
    await sleep(1000 * attempt * attempt); // 429（アクセス集中）や5xxは、待ちを延ばして再試行
  }
  throw new ApiError('接続できませんでした（6回失敗。429＝アクセス集中を含む）');
}

async function fetchLayer(l) {
  const tiles = tilesFor(BBOX, l.z, tileOf);
  const feats = [];
  let received = 0, byCity = null;
  const acc = l.raster ? new LevelRaster(BBOX) : null;
  const cityCount = {};
  for (const [i, t] of tiles.entries()) {
    const j = await get(l.api, { response_format: 'geojson', z: String(l.z), x: String(t.x), y: String(t.y) });
    const fs_ = j?.features ?? [];
    received += fs_.length;
    if (l.byCity) for (const [k, v] of Object.entries(countByCity(fs_))) cityCount[k] = (cityCount[k] || 0) + v;
    if (acc) l.ingest(acc, fs_); else feats.push(...fs_);
    if (i % 20 === 19) console.log(`  ${l.api}: ${i + 1}/${tiles.length} タイル`);
  }
  if (l.byCity) byCity = cityCount;
  let rows;
  if (acc) { const r = acc.finish(clipOn() ? mask : null); rows = r.cells ? [r] : []; } else rows = l.make(feats);
  if (l.afterMake) l.afterMake(rows);
  return { rows, tiles: tiles.length, received, byCity };
}

async function main() {
  console.log(`地域: ${REGION.name}（${regionId}）範囲 ${BBOX.join(',')}`);
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
  const files = {};
  for (const l of LAYERS) files[l.file] ??= only.length ? (readJson(l.file) ?? {}) : {};
  // 一部の項目だけ取り直す時も、地域の内側（mask）は保存済みの区域区分から作る
  if (REGION.clip && !mask && files['zoning.json']?.areas) mask = makeMask(files['zoning.json'].areas.flatMap((e) => e.polys), BBOX);
  const failed = [];

  const header = { generator: GENERATOR, source: SOURCE, fetchedAt: today, region: regionId, city: CITY, bbox: BBOX };
  const flush = () => {
    for (const [f, body] of Object.entries(files)) {
      const used = LAYERS.some((l) => l.file === f && manifest.layers[l.api]?.status === 'ok');
      if (!used) { if (fs.existsSync(path.join(outDir, f))) fs.rmSync(path.join(outDir, f)); continue; }
      const extra = f === 'population.json' ? { years: POP_YEARS, fields: ['総数(PT00)', '0〜14歳(PTA)', '65歳以上(PTC)', '75歳以上(PTD)'] } : {};
      fs.writeFileSync(path.join(outDir, f), JSON.stringify({ ...body, ...header, ...extra }));
    }
    manifest.generator = GENERATOR; manifest.source = SOURCE; manifest.region = regionId; manifest.city = CITY; manifest.bbox = BBOX; manifest.fetchedAt = today;
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  };

  for (const l of targets) {
    console.log(`${l.api} ${l.label} を取得中…`);
    try {
      const { rows, tiles, received, byCity } = await fetchLayer(l);
      const f = files[l.file];
      const rawCount = l.raster ? (rows[0]?.cells ?? 0) : rows.length;
      // 地域の内側で数セルだけ残る格子は、隣の自治体の区域が境界のセルにかかっただけ（例: 東京23区の津波。応答は千葉・神奈川の海岸ばかりで、23区の内側は1セル）。区域とは扱わず「データ無し」にする
      const artifact = !!(l.raster && REGION.clip && rawCount > 0 && rawCount < MIN_CELLS);
      const count = artifact ? 0 : rawCount;
      if (!count) {
        // 応答は取れたが対象範囲のデータが0件。「該当なし」ではなく「データ無し」として残す（区域が無いのか、収録が無いのかは、この取得では区別できない）
        manifest.layers[l.api] = { label: l.label, status: 'empty', reason: REGION.clip ? `取得はできたが、${REGION.name}の分は0件${artifact ? `（内側に残ったのは${rawCount}セルだけで、隣の自治体の区域が境界にかかった誤差とみなす）` : ''}（取得範囲の全体で${received}件を受信。隣の自治体の分は同梱しない）` : `取得はできたが、対象範囲（${received}件を受信）に区域のデータが0件`, file: l.file, part: l.part ?? null, z: l.z, tiles, received, count: 0, fetchedAt: today, ...(byCity ? { byCity } : {}) };
        if (l.part && f) delete f[l.part];
        console.log(`  データ無し: ${received}件を受信 → 対象範囲は0件`);
      } else {
        if (l.part) f[l.part] = l.raster ? rows[0] : rows; else f.items = rows;
        manifest.layers[l.api] = { label: l.label, status: 'ok', file: l.file, part: l.part ?? null, z: l.z, tiles, received, count, fetchedAt: today, ...(byCity ? { byCity } : {}) };
        console.log(`  取得: ${received}件を受信 → ${l.raster ? count + 'セル（約18m格子）' : count + '件'}を保存`);
      }
      if (byCity) console.log(`  受信の内訳（市区町村）: ${JSON.stringify(byCity)}`);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      failed.push(l.api);
      manifest.layers[l.api] = { label: l.label, status: 'failed', reason: e.message, file: l.file, part: l.part ?? null, z: l.z, fetchedAt: today };
      if (l.part && files[l.file]) delete files[l.file][l.part];
      console.error(`  失敗: ${e.message}`);
      if (/HTTP 40[13]/.test(e.message)) break; // キーの問題は他のAPIでも同じ
    }
    flush(); // 1項目ごとに書く（長い取得の途中で止まっても、取れた項目は残る）
  }
  flush();
  for (const f of fs.readdirSync(outDir)) console.log(`  ${f}: ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)}KB`);
  if (failed.length) { console.error(`取得できなかった項目: ${failed.join('・')}`); process.exit(1); }
}
await main();
