// 二段階調査のロジック（純関数）。ブラウザ（ES module）と node --test の両方から読む。
// 点数は「衛星の階級（国土地理院の干渉SAR成果）」と「下水道台帳の竣工年（豊中市）」から計算する。
// ただし較正に使う空洞の有無（sim_cavity）は乱数による架空の結果なので、AUC などの数字は実在の精度・効果を示さない。

export const NOW_YEAR = 2026;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** 管の経過年数 → 0〜1（60年で1。この上限は画面上の便宜的な正規化で、標準耐用年数50年とは別） */
/** 竣工年が台帳で不明（9999 等）・紐づかない管の古さの扱い。独立区分として中立の 0.5 を置く（画面では「不明」と表示）。 */
export const AGE_UNKNOWN = 0.5;
export const ageNorm = (year, now = NOW_YEAR) => (year == null ? AGE_UNKNOWN : clamp01((now - year) / 60));

/** 地表変位（階級の中央値 mm/年, 負=沈下）→ 0〜1（-8mm/年以下で1。デモ上の便宜的な正規化）。
 *  衛星の値は 3.75 mm/年幅の階級としてしか分からないので、入力は階級の中央値。 */
export const satNorm = (dispMmYr) => clamp01(-dispMmYr / 8);

/** 区間の点数。w は衛星指標の重み（0=台帳のみ, 1=衛星のみ）。cellSat は 区画ID→0〜1。 */
export function segScore(seg, cellSat, w) {
  return w * cellSat[seg.cell] + (1 - w) * ageNorm(seg.year);
}

/** 全区間を点数付けして降順に並べる。 */
export function rank(segs, cellSat, w) {
  return segs
    .map((s) => ({ ...s, score: segScore(s, cellSat, w) }))
    .sort(byScore);
}

/** 並べ方: 点数の高い順。同点（差 1e-9 未満）は竣工年の古い順（不明は後ろ）、さらに区間ID順。 */
const yearKey = (y) => (y == null ? 99999 : y);
export function byScore(a, b) {
  if (Math.abs(b.score - a.score) > 1e-9) return b.score - a.score;
  return yearKey(a.year) - yearKey(b.year) || a.id.localeCompare(b.id);
}

/** 未調査の生活道路の上位から、予算（km）を超えない範囲で貪欲に選ぶ。 */
export function selectByBudget(ranked, budgetKm) {
  const out = [];
  let m = 0;
  for (const s of ranked) {
    if (s.cls !== 'life' || s.surveyed) continue;
    if ((m + s.lenM) / 1000 > budgetKm) continue;
    out.push(s.id);
    m += s.lenM;
  }
  return out;
}

export const totalKm = (segs, ids) => segs.filter((s) => ids.has(s.id)).reduce((a, s) => a + s.lenM, 0) / 1000;

/** AUC（陽性の点数が陰性より高い確率。同点は0.5）。陽性か陰性が無ければ null。 */
export function auc(items) {
  const pos = items.filter((x) => x.hit), neg = items.filter((x) => !x.hit);
  if (!pos.length || !neg.length) return null;
  let s = 0;
  for (const p of pos) for (const n of neg) s += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
  return s / (pos.length * neg.length);
}

/** 調査済みの区間（hit=空洞あり）を、重み w で点数付けして AUC を返す。 */
export function aucAt(scanned, cellSat, w) {
  return auc(scanned.map((s) => ({ hit: s.hit, score: segScore(s, cellSat, w) })));
}

/** 重みを0〜1（0.1刻み）で探し、AUCが最大の重みを返す。最大が複数なら 0.5 に近い方（極端な重みを避ける）。
 *  陽性・陰性のどちらかが minEach 未満なら「データ不足」として w=null を返す。 */
export function calibrate(scanned, cellSat, minEach = 3) {
  const pos = scanned.filter((s) => s.hit).length, neg = scanned.length - pos;
  if (pos < minEach || neg < minEach) return { w: null, reason: 'データ不足', pos, neg, table: [] };
  const table = [];
  for (let i = 0; i <= 10; i++) { const w = i / 10; table.push({ w, auc: aucAt(scanned, cellSat, w) }); }
  const best = Math.max(...table.map((t) => t.auc));
  const cands = table.filter((t) => Math.abs(t.auc - best) < 1e-12);
  cands.sort((a, b) => Math.abs(a.w - 0.5) - Math.abs(b.w - 0.5) || a.w - b.w);
  return { w: cands[0].w, reason: null, pos, neg, table, ledgerOnly: table[0].auc, satOnly: table[10].auc };
}

/** 重みを変える条件（仮の基準。画面に明示する）: 最良の重みの AUC が MIN_AUC 以上、かつ今の重みより MIN_GAIN 以上高いこと。
 *  満たさなければ重みは今のまま（当てずっぽうに近い結果で重みを動かさない）。 */
export const MIN_AUC = 0.6;
export const MIN_GAIN = 0.05;
/** 較正の結果から、次回に使う重みを決める。戻り値 { w, adopt, reason, best, cur }。
 *  reason: 'short'（結果不足）/ 'low'（最良でも MIN_AUC 未満）/ 'small'（今の重みとの差が MIN_GAIN 未満）/ 'same'（今の重みが最良）/ null（更新） */
export function adoptWeight(cal, scanned, cellSat, curW, minAuc = MIN_AUC, minGain = MIN_GAIN) {
  if (!cal || cal.w === null) return { w: curW, adopt: false, reason: 'short', best: null, cur: null, capped: false, weak: false };
  const best = aucAt(scanned, cellSat, cal.w), cur = aucAt(scanned, cellSat, curW);
  const weak = best < WEAK_AUC || scanned.length < MIN_LABELS;
  if (Math.abs(cal.w - curW) < 1e-9) return { w: curW, adopt: false, reason: 'same', best, cur, capped: false, weak };
  if (best < minAuc) return { w: curW, adopt: false, reason: 'low', best, cur, capped: false, weak };
  if (best - cur < minGain) return { w: curW, adopt: false, reason: 'small', best, cur, capped: false, weak };
  // 1回の較正で動かす幅は MAX_STEP まで（少数・弱い結果で台帳の根拠を一度に捨てないため）
  const d = cal.w - curW, capped = Math.abs(d) > MAX_STEP + 1e-9;
  const w = capped ? Math.round((curW + Math.sign(d) * MAX_STEP) * 10) / 10 : cal.w;
  return { w, adopt: true, reason: null, best, cur, capped, weak };
}
/** 1回の較正で重みを動かす上限（仮の基準）。 */
export const MAX_STEP = 0.3;
/** これより弱い・少ない結果では、更新しても注意を出す（仮の基準）。 */
export const WEAK_AUC = 0.7;
export const MIN_LABELS = 20;

/** 除外の精度: 点数が下位の半分を「異常なし」と判定したとき、その中で実際に異常なしだった割合。
 *  下位半分の件数が minN 未満なら null。 */
export function exclusionAccuracy(scanned, cellSat, w, minN = 5) {
  const arr = scanned.map((s) => ({ hit: s.hit, score: segScore(s, cellSat, w) })).sort((a, b) => a.score - b.score);
  const low = arr.slice(0, Math.floor(arr.length / 2));
  if (low.length < minN) return null;
  const ok = low.filter((x) => !x.hit).length;
  return { n: low.length, ok, rate: ok / low.length };
}

/** 重み w で並べたときの上位 n 区間（未調査の生活道路）のうち、台帳のみ（w=0）の上位 n 区間に無いものの数。
 *  衛星の点数がどれだけ順位を動かしているかを見るための指標。 */
export function topShift(segs, cellSat, w, n = 20) {
  const top = (ww) => rank(segs, cellSat, ww).filter((s) => s.cls === 'life' && !s.surveyed).slice(0, n).map((s) => s.id);
  const base = new Set(top(0));
  return top(w).filter((id) => !base.has(id)).length;
}

// ---------------------------------------------------------------------------
// 調査結果（空洞あり/なし）の CSV の取り込み。処理はブラウザ内だけ。
// 受け付ける書き方は2つ（GMS3 の出力書式は未確認のため、どちらでも受けられるようにしてある）:
//   (1) 区間ID ＋ 空洞あり/なし        例: segment_id,cavity
//   (2) 緯度・経度の点 ＋ 空洞あり/なし  例: lat,lon,cavity   （近い区間に結び付ける）
// ---------------------------------------------------------------------------

export const LINK_MAX_M = 20; // 点を区間に結び付ける最大距離（m）。デモ上の仮の値

const COL_ID = ['segment_id', 'segmentid', 'id', '区間id', '区間', '区間番号'];
const COL_LAT = ['lat', 'latitude', '緯度', 'y'];
const COL_LON = ['lon', 'lng', 'long', 'longitude', '経度', 'x'];
const COL_RES = ['cavity', 'result', 'hit', '空洞', '空洞の有無', '空洞有無', '結果', '有無'];
const YES = new Set(['1', 'true', 'yes', 'y', 'あり', '有', '有り', '空洞あり', '空洞有り', '空洞有', '疑い', '疑いあり', 'hit', 'positive', 'pos']);
const NO = new Set(['0', 'false', 'no', 'n', 'なし', '無', '無し', '空洞なし', '空洞無し', '空洞無', '異常なし', '異常無し', 'none', 'ok', 'negative', 'neg']);
const squash = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s　]/g, '');

/** 空洞の有無の表記を true/false にする。分からなければ null。 */
export function parseCavity(v) {
  const k = squash(v);
  if (YES.has(k)) return true;
  if (NO.has(k)) return false;
  return null;
}

/** 最小の CSV パーサ（カンマまたはタブ区切り、引用符、BOM、CRLF）。行（文字列の配列）の配列を返す。 */
export function parseCsv(text) {
  const t = String(text).replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  const flush = () => { row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; flush(); }
    else cell += c;
  }
  if (cell !== '' || row.length) flush();
  return rows;
}

const findCol = (hdr, names) => hdr.findIndex((h) => names.includes(h));

/** 点（経度・緯度）から区間（2点の線分）までの距離（m）。区間の近くだけで使う平面近似。 */
export function distToSegM(lon, lat, coords) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const px = lon * kx, py = lat * ky;
  const [a, b] = coords;
  const ax = a[0] * kx, ay = a[1] * ky, bx = b[0] * kx, by = b[1] * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 点に最も近い区間（台帳なしの道路は除く）。しきい値より遠ければ null。 */
export function nearestSegment(lon, lat, segs, maxM = LINK_MAX_M) {
  let best = null, bd = maxM;
  for (const s of segs) {
    if (s.cls === 'noledger') continue;
    const d = distToSegM(lon, lat, s.coords);
    if (d <= bd) { bd = d; best = s; }
  }
  return best ? { seg: best, distM: bd } : null;
}

const EMPTY_SUMMARY = { rows: 0, byId: 0, byPoint: 0, unknownId: 0, unmatched: 0, invalid: 0, blank: 0, merged: 0, conflicts: 0, segments: 0, hit: 0, none: 0 };

/**
 * 調査結果の CSV を、区間ごとの空洞の有無（Map: 区間ID → true/false）にする。
 * 1つの区間に複数行（または複数の点）があるときは「1つでもあり」なら あり。
 * 戻り値: { error: string|null, results: Map, summary }
 */
export function parseOutcomes(text, segs, { maxM = LINK_MAX_M } = {}) {
  const fail = (error) => ({ error, results: new Map(), summary: { ...EMPTY_SUMMARY } });
  const rows = parseCsv(text);
  if (rows.length < 2) return fail('見出し行とデータ行が必要です。');
  const hdr = rows[0].map(squash);
  const ci = findCol(hdr, COL_ID), cla = findCol(hdr, COL_LAT), clo = findCol(hdr, COL_LON), cr = findCol(hdr, COL_RES);
  if (cr < 0) return fail('空洞の有無の列がありません（見出し: cavity / 空洞 / 結果 など）。');
  if (ci < 0 && (cla < 0 || clo < 0)) return fail('区間ID の列（segment_id / 区間ID）か、緯度・経度の列（lat,lon / 緯度,経度）が必要です。');
  const byId = new Map(segs.map((s) => [s.id, s]));
  const sm = { ...EMPTY_SUMMARY };
  const seen = new Map(); // 区間ID -> Set(true/false)
  for (const r of rows.slice(1)) {
    sm.rows++;
    // 空洞の列が空欄の行は「未記入」として読み飛ばす（書き出した CSV に一部だけ記入して戻す使い方のため）
    if (squash(r[cr]) === '') { sm.blank++; continue; }
    const v = parseCavity(r[cr]);
    if (v === null) { sm.invalid++; continue; }
    let id = null;
    const rawId = ci >= 0 ? (r[ci] || '').trim() : '';
    if (rawId) {
      const s = byId.get(rawId);
      if (!s) { sm.unknownId++; continue; }
      id = s.id; sm.byId++;
    } else if (cla >= 0 && clo >= 0) {
      const sLat = (r[cla] || '').trim(), sLon = (r[clo] || '').trim();
      const lat = Number(sLat), lon = Number(sLon);
      if (sLat === '' || sLon === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) { sm.invalid++; continue; }
      const n = nearestSegment(lon, lat, segs, maxM);
      if (!n) { sm.unmatched++; continue; }
      id = n.seg.id; sm.byPoint++;
    } else { sm.invalid++; continue; }
    if (!seen.has(id)) seen.set(id, new Set()); else sm.merged++;
    seen.get(id).add(v);
  }
  const results = new Map();
  for (const [id, set] of seen) {
    if (set.size > 1) sm.conflicts++;
    results.set(id, set.has(true));
  }
  sm.segments = results.size;
  sm.hit = [...results.values()].filter(Boolean).length;
  sm.none = sm.segments - sm.hit;
  return { error: null, results, summary: sm };
}

/** 区間と結果（Map）から、較正に使う形（hit 付き）を作る。 */
export const scannedFrom = (segs, results) => segs.filter((s) => results.has(s.id)).map((s) => ({ ...s, hit: results.get(s.id) }));

/** 選んだ区間の「まとまり」の数。端点どうしが gapM 以内の区間を同じまとまりとする（現場で続けて走れる塊の目安。gapM は画面に明示する仮の値）。 */
export const CLUSTER_GAP_M = 150;
export function clusterCount(segs, ids, gapM = CLUSTER_GAP_M) {
  const sel = segs.filter((s) => ids.has(s.id));
  const par = sel.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  const near = (a, b) => a.coords.some((p) => b.coords.some((q) => {
    const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
    return Math.hypot((p[0] - q[0]) * kx, (p[1] - q[1]) * 110540) <= gapM;
  }));
  for (let i = 0; i < sel.length; i++) for (let j = i + 1; j < sel.length; j++) if (near(sel[i], sel[j])) par[find(i)] = find(j);
  return new Set(sel.map((_, i) => find(i))).size;
}
