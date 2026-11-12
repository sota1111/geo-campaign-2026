/* API 応答（GeoJSON の features）を、画面が読む小さな形に整える関数。ネットワーク・ファイルには触れない（テストから呼べる）。
 * 取得スクリプト（fetch-reinfolib.mjs）と tests/extract_test.mjs が使う。 */

export const GENERATOR = 'fetch-reinfolib.mjs';
export const SOURCE = '国土交通省 不動産情報ライブラリ';
/** 将来人口で残す年。API の年齢別人口（PT00・PTA・PTC・PTD）は 2025 年以降（推計）。2025 年を起点に、約10年後・約25年後を見る */
export const POP_YEARS = [2025, 2035, 2050];

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/** 座標を小数 prec 桁に丸め、連続する同一点を除く */
export function roundRing(ring, prec = 5) {
  const out = [];
  for (const c of ring) {
    const p = [+c[0].toFixed(prec), +c[1].toFixed(prec)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}
/** Polygon / MultiPolygon → [[ring,...], ...]（多角形の配列。各多角形は外周＋穴）。4点未満の環は捨てる */
export function polysOf(geom, prec = 5) {
  if (!geom) return [];
  let polys;
  if (geom.type === 'Polygon') polys = [geom.coordinates];
  else if (geom.type === 'MultiPolygon') polys = geom.coordinates;
  else return [];
  const out = [];
  for (const poly of polys) {
    const rings = poly.map((r) => roundRing(r, prec)).filter((r) => r.length >= 4);
    if (rings.length) out.push(rings);
  }
  return out;
}

/** 地域メッシュコード（250m 分割、10桁）→ 中心の経緯度。標準地域メッシュ（JIS X 0410）と分割地域メッシュの規則による */
export function meshCenter(code) {
  const s = String(code);
  if (!/^\d{10}$/.test(s)) return null;
  const d = (i) => Number(s[i]);
  const p = Number(s.slice(0, 2)), u = Number(s.slice(2, 4));
  let lat = p / 1.5, lon = u + 100;
  lat += d(4) / 12; lon += d(5) / 8;
  lat += d(6) / 120; lon += d(7) / 80;
  const h500 = d(8) - 1, h250 = d(9) - 1; // 1=南西 2=南東 3=北西 4=北東
  if (h500 < 0 || h500 > 3 || h250 < 0 || h250 > 3) return null;
  lat += (h500 >> 1) / 240; lon += (h500 & 1) / 160;
  lat += (h250 >> 1) / 480; lon += (h250 & 1) / 320;
  return { lon: +(lon + 1 / 640).toFixed(5), lat: +(lat + 1 / 960).toFixed(5) };
}

/** XKT003 立地適正化計画 → 区域コード（kubun_id）ごとの多角形。区域名・告示日・設定者も残す */
export function extractPlan(features) {
  const byKubun = new Map();
  for (const f of features) {
    const p = f?.properties;
    if (!p) continue;
    const id = num(p.kubun_id);
    const polys = polysOf(f.geometry);
    if (id == null || !polys.length) continue;
    const key = `${str(p.city_code)}:${id}`;
    const e = byKubun.get(key) ?? { cityCode: str(p.city_code), city: str(p.city_name), id, name: str(p.kubun_name_ja) || str(p.area_classification_ja), decided: '', maker: '', polys: [] };
    const dd = str(p.decision_date);
    if (dd && dd > e.decided) e.decided = dd;
    if (!e.maker && str(p.decision_maker)) e.maker = str(p.decision_maker);
    e.polys.push(...polys);
    byKubun.set(key, e);
  }
  return [...byKubun.values()].sort((a, b) => a.cityCode.localeCompare(b.cityCode) || a.id - b.id);
}

/** XKT013 将来推計人口250mメッシュ → メッシュごとの [経度, 緯度, 市区町村コード, 年ごとの総数・0〜14歳・65歳以上・75歳以上]
 * 総数は PT00（秘匿処理あり）、年齢区分は PTA・PTC・PTD。空欄は 0 とみなす。MESH_ID で重複（タイルの境界で分かれた分）を除く */
export function extractMesh(features, years = POP_YEARS) {
  const seen = new Map();
  for (const f of features) {
    const p = f?.properties;
    if (!p || seen.has(p.MESH_ID)) continue;
    const c = meshCenter(p.MESH_ID);
    if (!c) continue;
    const row = [];
    let any = false;
    for (const y of years) {
      for (const k of ['PT00', 'PTA', 'PTC', 'PTD']) {
        const v = num(p[`${k}_${y}`]);
        if (v != null) any = true;
        row.push(v == null ? 0 : +v.toFixed(1));
      }
    }
    if (!any) continue;
    seen.set(p.MESH_ID, { id: String(p.MESH_ID), lon: c.lon, lat: c.lat, sc: str(p.SHICODE), v: row });
  }
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

const pointOf = (f) => {
  const g = f?.geometry;
  if (!g || g.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates;
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon: +lon.toFixed(5), lat: +lat.toFixed(5) } : null;
};
function dedupe(rows) {
  const m = new Map();
  for (const r of rows) m.set(`${r.kind}|${r.name}|${r.lon}|${r.lat}`, r);
  return [...m.values()].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
}

/** XKT006 学校 → 小学校・中学校・義務教育学校（休校・廃校でないもの）の点 */
export function extractSchools(features) {
  const KEEP = new Set(['小学校', '中学校', '義務教育学校']);
  const rows = [];
  for (const f of features) {
    const p = f?.properties, pt = pointOf(f);
    if (!p || !pt) continue;
    const kind = str(p.P29_003_name_ja);
    if (!KEEP.has(kind) || !str(p.P29_004_ja)) continue;
    rows.push({ kind, name: str(p.P29_004_ja), ...pt });
  }
  return dedupe(rows);
}
/** XKT007 保育園・幼稚園等 → 点。休校（closeSchoolCode が 0 以外）は除く。分類名が無い保育園は「保育所等」 */
export function extractPreschools(features) {
  const rows = [];
  for (const f of features) {
    const p = f?.properties, pt = pointOf(f);
    if (!p || !pt || !str(p.preSchoolName_ja)) continue;
    if (p.closeSchoolCode != null && num(p.closeSchoolCode) !== 0) continue;
    rows.push({ kind: str(p.schoolClassCode_name_ja) || '保育所等', name: str(p.preSchoolName_ja), ...pt });
  }
  return dedupe(rows);
}
/** XKT010 医療機関 → 病院・診療所・歯科診療所の点 */
export function extractMedical(features) {
  const rows = [];
  for (const f of features) {
    const p = f?.properties, pt = pointOf(f);
    if (!p || !pt || !str(p.P04_002_ja)) continue;
    rows.push({ kind: str(p.P04_001_name_ja) || '医療機関', name: str(p.P04_002_ja), ...pt });
  }
  return dedupe(rows);
}
/** XKT011 福祉施設 → 老人福祉施設（大分類コード 02）の点 */
export function extractElderCare(features) {
  const rows = [];
  for (const f of features) {
    const p = f?.properties, pt = pointOf(f);
    if (!p || !pt || str(p.P14_005) !== '02' || !str(p.P14_008_ja)) continue;
    rows.push({ kind: str(p.P14_006_name_ja) || str(p.P14_005_name_ja), name: str(p.P14_008_ja), ...pt });
  }
  return dedupe(rows);
}

/** XKT004 小学校区 → 学校ごとの多角形（学校コード A27_003 でまとめる） */
export function extractSchoolDistricts(features) {
  const m = new Map();
  for (const f of features) {
    const p = f?.properties;
    const polys = polysOf(f?.geometry);
    if (!p || !polys.length || !str(p.A27_004_ja)) continue;
    const key = str(p.A27_003) || str(p.A27_004_ja);
    const e = m.get(key) ?? { code: str(p.A27_003), name: str(p.A27_004_ja), city: str(p.A27_001), polys: [] };
    e.polys.push(...polys);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

/** 多角形だけを残す（XKT029 土砂災害警戒区域・XKT026 洪水浸水想定区域）。座標は小数4桁（約10m）に丸める */
export function extractAreas(features, prec = 4) {
  const polys = [];
  for (const f of features) polys.push(...polysOf(f?.geometry, prec));
  return polys;
}

/** 洪水浸水想定区域のように多角形が非常に多い（徳島市周辺で約7.5万片・3,400万字）項目は、格子（約18m）に変換して同梱する。
 * 各セルの中心が多角形の内側ならオン（外周と穴は偶奇で判定）。細く短い多角形（セルの幅より狭いもの）は落ちることがある。
 * 返り値: { west, north, dx, dy, w, h, bits（1セル1ビット、行ごとに左から。base64）, polys（入力の多角形数）, cells（オンのセル数） } */
export function rasterize(polys, bbox, dx = 0.0002, dy = 0.00016) {
  const [west, south, east, north] = bbox;
  const w = Math.ceil((east - west) / dx), h = Math.ceil((north - south) / dy);
  const grid = new Uint8Array(Math.ceil((w * h) / 8));
  let cells = 0;
  for (const rings of polys) {
    let minLat = Infinity, maxLat = -Infinity;
    for (const r of rings) for (const c of r) { if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1]; }
    const r0 = Math.max(0, Math.ceil((north - maxLat) / dy - 0.5)), r1 = Math.min(h - 1, Math.floor((north - minLat) / dy - 0.5));
    for (let row = r0; row <= r1; row++) {
      const lat = north - (row + 0.5) * dy;
      const xs = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const yi = ring[i][1], yj = ring[j][1];
          if (yi > lat !== yj > lat) xs.push(ring[i][0] + ((lat - yi) / (yj - yi)) * (ring[j][0] - ring[i][0]));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - west) / dx - 0.5)), c1 = Math.min(w - 1, Math.floor((xs[k + 1] - west) / dx - 0.5));
        for (let col = c0; col <= c1; col++) {
          const idx = row * w + col;
          if (!(grid[idx >> 3] & (1 << (idx & 7)))) { grid[idx >> 3] |= 1 << (idx & 7); cells++; }
        }
      }
    }
  }
  return { west, north, dx, dy, w, h, bits: Buffer.from(grid).toString('base64'), polys: polys.length, cells };
}

/** 「x,y」の組をタイルの範囲から作る（bbox = [西, 南, 東, 北]） */
export function tilesFor(bbox, z, tileOf) {
  const a = tileOf(bbox[0], bbox[3], z), b = tileOf(bbox[2], bbox[1], z);
  const t = [];
  for (let x = a.x; x <= b.x; x++) for (let y = a.y; y <= b.y; y++) t.push({ x, y });
  return t;
}
