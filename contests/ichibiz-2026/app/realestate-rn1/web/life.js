/* 住む場所の先行き: 生活施設・物件・勤務先・通勤時間の純粋ロジック（ブラウザ・Node両対応）。DOM・ネットワークには触れない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Life = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PROPS = 10, MAX_WORKS = 2;
  // ---- 通勤時間の前提（画面にも同じ値を出す） ----
  /** 徒歩の分速（m）。「不動産の表示に関する公正競争規約施行規則」が徒歩所要時間の表示に使う基準（道路距離80mにつき1分） */
  const WALK_M_PER_MIN = 80;
  /** 直線距離から道路距離を見積もる係数。本リポジトリ contests/odpt-2026 の徒歩モデルと同じ仮定（出典のある統計ではない。実際の道路・坂・横断は未考慮） */
  const DETOUR = 1.25;
  /** 鉄道の仮定。いずれも出典のない仮定で、画面で表示する（速度は画面で変更できる）。駅間は直線×RAIL_DETOUR、待ち時間は固定 */
  const RAIL_SPEED_KMH = 30, RAIL_DETOUR = 1.2, RAIL_WAIT_MIN = 5;
  /** 最寄り駅まで徒歩（直線）でこれより遠いときは、鉄道の目安を出さない（駅が遠い・地域の外の可能性） */
  const MAX_STATION_M = 2000;

  // ---- 生活施設の種類 ----
  // src: 'osm' = amenities.json（OpenStreetMap, ODbL）、'mlit' = 同梱の国土数値情報（facilities.json。不動産情報ライブラリ経由）
  // glyph は色に頼らず種類を見分けるための1文字
  const LAYERS = [
    { id: 'super', label: 'スーパー', glyph: 'ス', color: '#1b7a3d', src: 'osm', on: true },
    { id: 'conv', label: 'コンビニ', glyph: 'コ', color: '#c2410c', src: 'osm', on: true },
    { id: 'station', label: '駅（鉄道）', glyph: '駅', color: '#1d4ed8', src: 'osm', on: true },
    { id: 'nursery', label: '保育園（保育所等）', glyph: '保', color: '#be185d', src: 'mlit', on: false },
    { id: 'kinder', label: '幼稚園・認定こども園', glyph: '幼', color: '#a16207', src: 'mlit', on: false },
    { id: 'elem', label: '小学校', glyph: '小', color: '#0e7490', src: 'mlit', on: false },
    { id: 'junior', label: '中学校', glyph: '中', color: '#6d28d9', src: 'mlit', on: false },
    { id: 'gakudo', label: '学童（放課後児童クラブ）', glyph: '学', color: '#b91c1c', src: 'osm', on: false },
    { id: 'hospital', label: '病院', glyph: '病', color: '#991b1b', src: 'mlit', on: false },
    { id: 'clinic', label: '診療所（歯科を除く）', glyph: '診', color: '#9f1239', src: 'mlit', on: false },
    { id: 'pharmacy', label: '薬局', glyph: '薬', color: '#0f766e', src: 'osm', on: false },
    { id: 'post', label: '郵便局', glyph: '郵', color: '#b45309', src: 'osm', on: false },
  ];
  // 「距離を出す」種類（物件ごとに最寄りを一覧にする）
  const NEAREST_IDS = ['nursery', 'kinder', 'elem', 'junior', 'gakudo', 'super', 'conv', 'station'];
  const DISTANCE_NOTE = '距離は直線距離です（道路に沿った距離ではありません）。徒歩の目安は直線距離×' + DETOUR + '÷分速' + WALK_M_PER_MIN + 'm で、あくまで目安です。';
  const SCHOOL_NOTE = '小学校・中学校は「近い学校」で、通学区域（学区）の学校とは限りません。学区は市区町村の教育委員会で確かめてください。';
  const OSM_NOTE = 'OpenStreetMap は有志が登録したデータで、登録漏れ・古い情報があります（無い＝存在しない、ではありません）。';
  const GAKUDO_NOTE = '学童（放課後児童クラブ）は、公的な全国の位置データを見つけられませんでした。OpenStreetMap で名称に「学童」「放課後児童」「児童クラブ」などを含むものだけを表示しており、実際の数よりかなり少ないとみられます。入所の可否・場所は市区町村に確かめてください。';
  const MLIT_NOTE = '小学校・中学校・保育園・幼稚園・病院・診療所は、国土数値情報（不動産情報ライブラリ経由。本アプリが既に使っているデータ）です。保育園は「保育所等」、幼稚園には「幼保連携型認定こども園」を含みます。義務教育学校は小学校・中学校の両方に含めます。';

  const rad = (d) => (d * Math.PI) / 180;
  function dist(lon1, lat1, lon2, lat2) {
    const R = 6371008.8, dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  const ok = (p) => p && Number.isFinite(p.lon) && Number.isFinite(p.lat);

  /** 同梱データから種類ごとの地点 [{lon,lat,name}] を作る。amenities は amenities.json（無ければ null）、fac は data.fac（無ければ undefined） */
  function buildLayers(amenities, fac) {
    const L = {}, status = {};
    for (const l of LAYERS) L[l.id] = [];
    for (const l of LAYERS) {
      if (l.src === 'osm') {
        const t = amenities && amenities.types && amenities.types[l.id];
        if (t && Array.isArray(t.items)) { L[l.id] = t.items.map((r) => ({ lon: r[0], lat: r[1], name: r[2] || '' })).filter(ok); status[l.id] = 'ok'; } else status[l.id] = 'none';
      }
    }
    const add = (id, list, pred) => { for (const x of list) if (pred(x) && ok(x)) L[id].push({ lon: x.lon, lat: x.lat, name: x.name || '' }); };
    const sc = fac && fac.schools, pre = fac && fac.preschools, med = fac && fac.medical;
    status.elem = sc ? 'ok' : 'none'; status.junior = sc ? 'ok' : 'none';
    status.nursery = pre ? 'ok' : 'none'; status.kinder = pre ? 'ok' : 'none';
    status.hospital = med ? 'ok' : 'none'; status.clinic = med ? 'ok' : 'none';
    if (sc) { add('elem', sc, (x) => x.kind === '小学校' || x.kind === '義務教育学校'); add('junior', sc, (x) => x.kind === '中学校' || x.kind === '義務教育学校'); }
    if (pre) { add('nursery', pre, (x) => x.kind === '保育所等'); add('kinder', pre, (x) => x.kind === '幼稚園' || x.kind === '幼保連携型認定こども園'); }
    if (med) { add('hospital', med, (x) => x.kind === '病院'); add('clinic', med, (x) => x.kind === '診療所'); }
    // 学童は取れた件数が0なら「位置データが見つからない」と画面に出す
    if (status.gakudo === 'ok' && !L.gakudo.length) status.gakudo = 'empty';
    return { layers: L, status };
  }

  /** 地点から種類ごとの最寄り。無ければ null */
  function nearest(layers, lon, lat, ids) {
    const out = {};
    for (const id of ids || NEAREST_IDS) {
      let best = null;
      for (const p of layers[id] || []) {
        const d = dist(lon, lat, p.lon, p.lat);
        if (!best || d < best.d) best = { d, name: p.name, lon: p.lon, lat: p.lat };
      }
      out[id] = best ? { name: best.name || '（名称なし）', m: Math.round(best.d), lon: best.lon, lat: best.lat } : null;
    }
    return out;
  }
  const walkMin = (straightM) => Math.max(1, Math.round((straightM * DETOUR) / WALK_M_PER_MIN));
  const fmtM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm');

  /** 2地点間の通勤時間の目安（分）。徒歩は直線×DETOUR÷80。鉄道は 最寄駅まで徒歩＋駅間（直線×RAIL_DETOUR÷速度）＋待ち＋最寄駅から徒歩。
   *  鉄道は路線のつながり・乗換を見ていない（同じ線で行けるとは限らない）ので「目安」。stations は地点配列 */
  function commute(from, to, stations, opts) {
    const speed = (opts && opts.speedKmh) || RAIL_SPEED_KMH;
    const straight = dist(from.lon, from.lat, to.lon, to.lat);
    const res = { straightM: Math.round(straight), walk: walkMin(straight), rail: null, best: null };
    const s1 = nearest({ s: stations || [] }, from.lon, from.lat, ['s']).s;
    const s2 = nearest({ s: stations || [] }, to.lon, to.lat, ['s']).s;
    if (s1 && s2 && s1.m <= MAX_STATION_M && s2.m <= MAX_STATION_M) {
      const ride = dist(s1.lon, s1.lat, s2.lon, s2.lat);
      const sameStation = ride < 50;
      const rideMin = sameStation ? 0 : Math.round(((ride * RAIL_DETOUR) / 1000 / speed) * 60 + RAIL_WAIT_MIN);
      const w1 = Math.round((s1.m * DETOUR) / WALK_M_PER_MIN), w2 = Math.round((s2.m * DETOUR) / WALK_M_PER_MIN);
      res.rail = { total: w1 + rideMin + w2, walkFrom: w1, from: s1.name, ride: rideMin, to: s2.name, walkTo: w2, same: sameStation };
    }
    res.best = res.rail && res.rail.total < res.walk ? { mode: 'rail', min: res.rail.total } : { mode: 'walk', min: res.walk };
    return res;
  }

  // ---- 住所検索（国土地理院）の結果の読み取り ----
  /** 国土地理院 AddressSearch の応答から候補 [{lon,lat,title}] を作る。入力が配列でなければ空 */
  function parseGsi(j) {
    if (!Array.isArray(j)) return [];
    const out = [];
    for (const f of j) {
      const c = f && f.geometry && f.geometry.coordinates;
      if (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])) out.push({ lon: c[0], lat: c[1], title: String((f.properties && f.properties.title) || '') });
    }
    return out;
  }

  // ---- 物件・勤務先（端末内保存） ----
  const KEY = 'rn1.places.v1';
  const empty = () => ({ props: [], works: [], speedKmh: RAIL_SPEED_KMH });
  function validPlace(p) {
    return p && typeof p === 'object' && Number.isFinite(p.lon) && Number.isFinite(p.lat) && p.lon > 120 && p.lon < 150 && p.lat > 20 && p.lat < 47;
  }
  /** 保存値を読み、形式が不正なものは捨てる。物件は MAX_PROPS 件、勤務先は MAX_WORKS 件まで */
  function sanitize(o) {
    const r = empty();
    if (!o || typeof o !== 'object') return r;
    const cl = (p) => ({ label: String(p.label || '').slice(0, 80), lon: p.lon, lat: p.lat, resolved: String(p.resolved || '').slice(0, 120) });
    if (Array.isArray(o.props)) r.props = o.props.filter(validPlace).slice(0, MAX_PROPS).map(cl);
    if (Array.isArray(o.works)) r.works = o.works.slice(0, MAX_WORKS).map((p) => (validPlace(p) ? cl(p) : null)); // 位置（A・B）を保つため、空きは null
    if (Number.isFinite(o.speedKmh) && o.speedKmh >= 10 && o.speedKmh <= 120) r.speedKmh = o.speedKmh;
    return r;
  }
  function addProp(state, p) {
    if (state.props.length >= MAX_PROPS) return { ok: false, reason: '物件は最大' + MAX_PROPS + '件までです。' };
    if (!validPlace(p)) return { ok: false, reason: '位置が不正です。' };
    state.props.push({ label: String(p.label || '').slice(0, 80), lon: p.lon, lat: p.lat, resolved: String(p.resolved || '').slice(0, 120) });
    return { ok: true };
  }
  /** 物件×勤務先の表（props.length × works.length）。stations は駅の地点配列 */
  function commuteTable(state, stations) {
    const ws = state.works.filter(Boolean);
    return state.props.map((p) => ws.map((w) => commute(p, w, stations, { speedKmh: state.speedKmh })));
  }

  return {
    MAX_PROPS, MAX_WORKS, WALK_M_PER_MIN, DETOUR, RAIL_SPEED_KMH, RAIL_DETOUR, RAIL_WAIT_MIN, MAX_STATION_M, LAYERS, NEAREST_IDS, DISTANCE_NOTE, SCHOOL_NOTE, OSM_NOTE, GAKUDO_NOTE, MLIT_NOTE, KEY,
    dist, buildLayers, nearest, walkMin, fmtM, commute, parseGsi, empty, validPlace, sanitize, addProp, commuteTable,
  };
});
