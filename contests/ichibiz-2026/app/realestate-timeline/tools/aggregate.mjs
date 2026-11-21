/* XIT001（不動産価格情報）の記録を、四半期×区で集計する純粋関数。通信・書き込みはしない（試験できるように分けてある）。 */

export const WARD_CODES = Array.from({ length: 23 }, (_, i) => String(13101 + i));
export const TYPE_MANSION = '中古マンション等';
export const AREA_MIN = 10;   // ㎡。これ未満は事務所・倉庫の一部などの可能性があり除く
export const AREA_MAX = 300;  // ㎡。XIT001 は 2000㎡以上を「2000㎡以上」と丸めるため、極端な大面積も除く
export const LOW_N = 30;      // 件。1四半期・1区でこれ未満は「件数が少ない」（作成者の基準。実データで全1,932区四半期のうち12が該当）

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
  return { code, key: quarterKey(p.year, p.q), year: p.year, district: String(r.DistrictName ?? '').trim(), plan: floorGroup(r.FloorPlan), price, area, unit: price / area, age };
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

// ---- 間取り（FloorPlan）を件数が足りる粒度にまとめる ----
export const PLAN_GROUPS = [
  { key: 'all', label: 'すべて', note: '間取りを問わない（間取りが空・特殊なものも含む）' },
  { key: 'p1', label: '1R〜1DK', note: 'ワンルーム・1R・1K・1DK' },
  { key: 'p2', label: '1LDK〜2DK', note: '1LDK・2K・2DK（1LDK+S などを含む）' },
  { key: 'p3', label: '2LDK〜3DK', note: '2LDK・3K・3DK（2LDK+S などを含む）' },
  { key: 'p4', label: '3LDK以上', note: '3LDK・4K以上の部屋数が多いもの' },
];
/** FloorPlan（"１ＬＤＫ"・"ワンルーム" など）→ 'p1'〜'p4'。読めない・オープンフロア・メゾネットなどは null（「すべて」にだけ入る） */
export function floorGroup(raw) {
  const t = String(raw ?? '').normalize('NFKC').replace(/\s/g, '').toUpperCase();
  if (!t) return null;
  if (t.startsWith('ワンルーム')) return 'p1';
  const m = /^(\d)(LDK|DK|K|R)/.exec(t);
  if (!m) return null;
  const rooms = Number(m[1]), kind = m[2];
  if (rooms === 1) return kind === 'LDK' ? 'p2' : 'p1';           // 1R・1K・1DK / 1LDK
  if (rooms === 2) return kind === 'LDK' ? 'p3' : 'p2';           // 2K・2DK / 2LDK
  if (rooms === 3) return kind === 'LDK' ? 'p4' : 'p3';           // 3K・3DK / 3LDK
  return 'p4';                                                     // 4部屋以上
}
const planKeys = (t) => (t.plan ? ['all', t.plan] : ['all']);

/** 範囲×間取り×年の集計。win は「その年を末尾とする直近の年数」（1 なら単年）。
 *  scope は 'district'（区コード|地区名）か 'ward'（区コード）。戻り値: Map(`${scopeKey}|${plan}|${year}` → 統計) */
export function aggregateYears(trades, { scope = 'district', win = 1, years } = {}) {
  const g = new Map(); // `${scopeKey}|${plan}` → year → trades[]
  for (const t of trades) {
    if (scope === 'district' && !t.district) continue;
    const sk = scope === 'district' ? `${t.code}|${t.district}` : t.code;
    for (const pk of planKeys(t)) {
      const k = `${sk}|${pk}`;
      if (!g.has(k)) g.set(k, new Map());
      const ym = g.get(k);
      if (!ym.has(t.year)) ym.set(t.year, []);
      ym.get(t.year).push(t);
    }
  }
  const out = new Map();
  for (const [k, ym] of g) {
    for (const y of years) {
      const ts = [];
      for (let yy = y - win + 1; yy <= y; yy++) if (ym.has(yy)) ts.push(...ym.get(yy));
      if (!ts.length) continue;
      const units = ts.map((t) => t.unit), ages = ts.map((t) => t.age).filter((a) => a !== null);
      out.set(`${k}|${y}`, { n: ts.length, unit: median(units), p25: quantile(units, 0.25), p75: quantile(units, 0.75), area: median(ts.map((t) => t.area)), age: ages.length ? median(ages) : null });
    }
  }
  return out;
}
