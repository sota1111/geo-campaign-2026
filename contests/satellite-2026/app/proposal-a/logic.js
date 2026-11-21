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
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
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
