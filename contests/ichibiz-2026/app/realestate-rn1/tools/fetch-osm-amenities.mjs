// 生活に必要な場所（スーパー・コンビニ・駅など）を OpenStreetMap から取得し、地域ごとの静的 JSON にする（ビルド時のみ。画面からは呼ばない）。
// 通信は Overpass API への GET のみ（User-Agent を付ける）。データは © OpenStreetMap contributors（ODbL）。
// usage: node tools/fetch-osm-amenities.mjs [tokushima|tokyo23|osaka ...]   出力: web/data/<地域>/amenities.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const UA = 'geo-campaign-2026-build/1.0 (ichibiz-2026 realestate-rn1 build-time fetch; GET only)';
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const BBOX = { tokushima: [134.42, 33.95, 134.66, 34.16], tokyo23: [139.55, 35.51, 139.93, 35.84], osaka: [135.36, 34.57, 135.62, 34.78] };
// 種類 id → Overpass の条件（複数可）
const TYPES = {
  super: { label: 'スーパー', q: ['["shop"="supermarket"]'] },
  conv: { label: 'コンビニ', q: ['["shop"="convenience"]'] },
  station: { label: '駅（鉄道）', q: ['["railway"="station"]', '["railway"="halt"]'] },
  // 病院・診療所・学校・保育所・幼稚園は、既に同梱している国土数値情報（facilities.json）を使うので、OSM からは取らない。
  // 学童（放課後児童クラブ）は公的な全国の位置データが見つからないため、OSM の名称・タグに「学童」「放課後児童」「児童クラブ」「放課後」を含むものだけを取る（登録漏れが多い見込み）
  gakudo: { label: '学童（放課後児童クラブ）', q: ['["name"~"学童|放課後児童|児童クラブ|放課後クラブ|放課後子ども"]["amenity"]', '["name"~"学童|放課後児童|児童クラブ|放課後クラブ|放課後子ども"]["office"]', '["after_school"="yes"]', '["childcare"="after_school"]', '["school:type"~"after_school"]'] },
  post: { label: '郵便局', q: ['["amenity"="post_office"]'] },
  pharmacy: { label: '薬局', q: ['["amenity"="pharmacy"]'] },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function overpass(ql) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const ep of ENDPOINTS) {
      try {
        const r = await fetch(ep + '?data=' + encodeURIComponent(ql), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(150000) });
        if (r.ok) return await r.json();
        last = 'HTTP ' + r.status;
      } catch (e) { last = String(e); }
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error('Overpass 失敗: ' + last);
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;
async function region(id) {
  const [w, s, e, n] = BBOX[id], bb = `(${s},${w},${n},${e})`;
  const out = { region: id, source: 'OpenStreetMap（Overpass API）', license: 'ODbL', bbox: BBOX[id], fetchedAt: new Date().toISOString().slice(0, 10), types: {} };
  for (const [t, def] of Object.entries(TYPES)) {
    const ql = '[out:json][timeout:120];(' + def.q.map((c) => `nwr${c}${bb};`).join('') + ');out center tags;';
    const j = await overpass(ql);
    const seen = new Set(), rows = [];
    for (const el of j.elements) {
      const lon = el.lon ?? el.center?.lon, lat = el.lat ?? el.center?.lat;
      if (lon == null || lat == null) continue;
      if (lon < w || lon > e || lat < s || lat > n) continue; // 範囲外（路線の関係などの中心が遠い）は捨てる
      const name = (el.tags && (el.tags.name || el.tags['name:ja'])) || '';
      const key = (t === 'station' ? name : '') + '|' + r5(lon) + '|' + r5(lat);
      if (seen.has(key)) continue; seen.add(key);
      rows.push([r5(lon), r5(lat), name]);
    }
    // 駅は同名で近接（約300m以内）する複数ノード（ホーム別など）を1つにまとめる
    let res = rows;
    if (t === 'station') {
      res = [];
      for (const r of rows) {
        const dup = res.find((q) => q[2] && q[2] === r[2] && Math.abs(q[0] - r[0]) < 0.004 && Math.abs(q[1] - r[1]) < 0.003);
        if (!dup) res.push(r);
      }
    }
    out.types[t] = { label: def.label, count: res.length, items: res };
    console.log(id, t, res.length);
    await sleep(1500);
  }
  fs.writeFileSync(path.join(here, '..', 'web', 'data', id, 'amenities.json'), JSON.stringify(out));
}
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BBOX);
for (const id of ids) await region(id);
