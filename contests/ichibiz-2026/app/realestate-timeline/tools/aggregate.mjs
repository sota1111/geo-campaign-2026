/* XIT001（不動産価格情報）の記録を、四半期×区で集計する純粋関数。通信・書き込みはしない（試験できるように分けてある）。 */

export const WARD_CODES = Array.from({ length: 23 }, (_, i) => String(13101 + i));
export const TYPE_MANSION = '中古マンション等';
export const AREA_MIN = 10;   // ㎡。これ未満は事務所・倉庫の一部などの可能性があり除く
export const AREA_MAX = 300;  // ㎡。XIT001 は 2000㎡以上を「2000㎡以上」と丸めるため、極端な大面積も除く
export const LOW_N = 10;      // 件。1四半期・1区でこれ未満は「件数が少ない」

export const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };

/** "2024年第3四半期" → {year:2024, q:3}。読めなければ null */
export function parsePeriod(s) {
  const m = /^(\d{4})年第([1-4])四半期$/.exec(String(s ?? '').trim());
  return m ? { year: Number(m[1]), q: Number(m[2]) } : null;
}
export const quarterKey = (year, q) => `${year}Q${q}`;

const ERA = { 令和: 2018, 平成: 1988, 昭和: 1925, 大正: 1911, 明治: 1867 };
/** "平成25年" → 2013。"戦前" など読めない・西暦に直せないものは null */
export function parseBuiltYear(s) {
  const t = String(s ?? '').trim();
  let m = /^(令和|平成|昭和|大正|明治)(元|\d{1,2})年$/.exec(t);
  if (m) return ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2]));
  m = /^(\d{4})年$/.exec(t);
  return m ? Number(m[1]) : null;
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
/** 線形補間の分位点（p は 0〜1） */
export function quantile(xs, p) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** 1件を使える形にする。中古マンション等でない・区外・価格や面積が読めない・面積が範囲外は null */
export function toTrade(r) {
  if (r?.Type !== TYPE_MANSION) return null;
  const code = String(r.MunicipalityCode ?? '');
  if (!WARD_CODES.includes(code)) return null;
  const p = parsePeriod(r.Period);
  const price = num(r.TradePrice), area = num(r.Area);
  if (!p || !price || !area || price <= 0 || area < AREA_MIN || area > AREA_MAX) return null;
  const built = parseBuiltYear(r.BuildingYear);
  const age = built && built <= p.year ? p.year - built : null;
  return { code, key: quarterKey(p.year, p.q), price, area, unit: price / area, age };
}

/** 区×四半期に集計する。unit は円/㎡、price は円、area は㎡。n は使えた件数 */
export function aggregate(trades) {
  const g = new Map(); // `${code}|${key}` → trades[]
  for (const t of trades) { const k = `${t.code}|${t.key}`; if (!g.has(k)) g.set(k, []); g.get(k).push(t); }
  const out = new Map();
  for (const [k, ts] of g) {
    const units = ts.map((t) => t.unit), ages = ts.map((t) => t.age).filter((a) => a !== null);
    out.set(k, {
      n: ts.length,
      unit: median(units), unitP25: quantile(units, 0.25), unitP75: quantile(units, 0.75),
      price: median(ts.map((t) => t.price)), area: median(ts.map((t) => t.area)),
      age: ages.length ? median(ages) : null,
    });
  }
  return out;
}
