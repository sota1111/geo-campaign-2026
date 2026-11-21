/* 標準地ごとにまとめる・公示価格（XPT002）との突き合わせ。通信・ファイルには触れない純関数。
 * XCT001 は同じ標準地番号の鑑定評価書の記録を複数件返す（実データでは全て2件）ので、標準地番号ごとに1つにまとめる。 */
import { num } from './extract.mjs';

const rad = Math.PI / 180;
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/[\s　]+/g, ' ').trim());

/** 標準地番号ごとに1つにまとめる。鑑定評価手法の価格・路線価・還元利回りは、記録ごとの値の配列（null は値なし）で持つ。
 *  XCT001 の「公示価格」「1㎡当たりの価格」は画面に出さないので持たない */
export function groupParcels(points) {
  const by = new Map();
  for (const p of points) { if (!by.has(p.id)) by.set(p.id, []); by.get(p.id).push(p); }
  const out = [];
  for (const [id, rs] of by) {
    const r0 = rs[0];
    const pick = (k) => rs.map((r) => r[k] ?? null);
    out.push({
      id, lon: r0.lon, lat: r0.lat, use: r0.use, area: r0.area, lot: r0.lot, addr: r0.addr,
      zone: r0.zone, kenpei: r0.kenpei, yoseki: r0.yoseki, chiseki: r0.chiseki, genkyo: r0.genkyo,
      n: rs.length,
      rosenkaYear: rs.map((r) => r.rosenkaYear).find((y) => y && y !== '0') ?? '',
      rosenka: pick('rosenka'), hikaku: pick('hikaku'), shueki: pick('shueki'), rimawari: pick('rimawari'),
      koji: null,
    });
  }
  return out;
}

/** XPT002（地価公示・地価調査のポイント、GeoJSON）→ 地価公示の標準地の点。point_id で重複を除く */
export function extractKojiPoints(features) {
  const seen = new Map();
  for (const f of features ?? []) {
    const g = f?.geometry, p = f?.properties;
    if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates) || !p) continue;
    const lon = Number(g.coordinates[0]), lat = Number(g.coordinates[1]);
    const price = num(p.u_current_years_price_ja);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || price === null) continue;
    // land_price_type: 0 地価公示 / 1 地価調査（要求で地価公示だけに絞るが、念のためここでも除く）
    if (p.land_price_type !== undefined && String(p.land_price_type) === '1') continue;
    const id = String(p.point_id ?? `${lon},${lat}`);
    seen.set(id, {
      id, lon, lat, price,
      lotNo: text(p.standard_lot_number_ja),
      use: text(p.use_category_name_ja).replace(/^\d+,/, ''),
      change: num(p.year_on_year_change_rate),
    });
  }
  return [...seen.values()];
}

function dist(lon1, lat1, lon2, lat2) {
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}
export const MATCH_RADIUS_M = 50;

/** 標準地1つに当てる XPT002 の点を選ぶ。位置が MATCH_RADIUS_M 以内で、用途が分かれば同じもの。
 *  該当が無い、または最も近い2点がほぼ同じ距離で価格が違い決められない時は null（画面は「照合できませんでした」） */
export function matchKoji(parcel, kojiPoints) {
  const c = kojiPoints
    .map((k) => ({ k, d: dist(parcel.lon, parcel.lat, k.lon, k.lat) }))
    .filter((e) => e.d <= MATCH_RADIUS_M && (!e.k.use || !parcel.use || e.k.use === parcel.use))
    .sort((a, b) => a.d - b.d);
  if (!c.length) return null;
  if (c.length > 1 && c[1].d - c[0].d < 1 && c[1].k.price !== c[0].k.price) return null;
  const { k, d } = c[0];
  return { price: k.price, lotNo: k.lotNo, change: k.change, distM: Math.round(d) };
}

/** 全標準地に XPT002 の価格を当てる */
export function attachKoji(parcels, kojiPoints) {
  let matched = 0;
  const out = parcels.map((p) => { const koji = matchKoji(p, kojiPoints); if (koji) matched++; return { ...p, koji }; });
  return { parcels: out, matched };
}

/** 標準地の集計（取得ログ用）。各項目に値がある標準地の数（記録のどれかに値があれば数える） */
export function fillParcels(parcels) {
  const any = (a) => a.some((v) => v !== null);
  return {
    parcels: parcels.length, records: parcels.reduce((s, p) => s + p.n, 0),
    koji: parcels.filter((p) => p.koji).length, rosenka: parcels.filter((p) => any(p.rosenka)).length,
    hikaku: parcels.filter((p) => any(p.hikaku)).length, shueki: parcels.filter((p) => any(p.shueki)).length,
    all4: parcels.filter((p) => p.koji && any(p.rosenka) && any(p.hikaku) && any(p.shueki)).length,
  };
}

/** 標準地の位置があるタイルだけ（県全体は取らない） */
export function tilesOf(parcels, z) {
  const n = 2 ** z, set = new Set();
  for (const p of parcels) {
    const s = Math.sin(p.lat * rad);
    set.add(`${Math.floor(((p.lon + 180) / 360) * n)}/${Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)}`);
  }
  return [...set].map((k) => { const [x, y] = k.split('/').map(Number); return { x, y }; });
}
