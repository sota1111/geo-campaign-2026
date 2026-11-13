/* 住む場所の先行きシート: 純粋ロジック（ブラウザ・Node両対応）。DOM・ネットワークには触れない。
 * 入力は同梱データ（data/*.json。不動産情報ライブラリのAPIから tools/fetch-reinfolib.mjs が取得）と、指した位置。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 利用規約が求める表示（https://www.reinfolib.mlit.go.jp/help/termsOfUse/ 、2026-11-12 閲覧。文言は規約のまま。変えない） ----
  const REINFOLIB_URL = 'https://www.reinfolib.mlit.go.jp/';
  /** API利用規約 第7条のクレジット */
  const CREDIT = 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません';
  /** 利用規約（PDL1.0 重要情報(1)）の出典の記載例 */
  const ATTRIBUTION = '出典：国土交通省　不動産情報ライブラリ（' + REINFOLIB_URL + '）';
  /** 加工した旨（利用したコンテンツの名称と、作成者が加工した旨） */
  const PROCESSED = '「都市計画決定GISデータ（立地適正化計画）」「国土数値情報（将来推計人口250mメッシュ・小学校区・学校・保育園・幼稚園等・医療機関・福祉施設・土砂災害警戒区域・洪水浸水想定区域・高潮浸水想定区域・津波浸水想定）」「地形区分に基づく液状化の発生傾向図」（いずれも国土交通省）をもとに、作成者が位置の照合・集計をして作成';
  /** 国土数値情報の利用規約 第1条1)ア：出典（ダウンロードサイト名と当該ページのURL）と加工の旨 */
  const NLNI_URL = 'https://nlftp.mlit.go.jp/ksj/';
  const NLNI_SOURCE = '出典：国土交通省 国土数値情報ダウンロードサイト（' + NLNI_URL + '。各データのページは同サイトの「データ一覧」にある。例: 将来推計人口 ' + NLNI_URL + 'gml/datalist/KsjTmplt-mesh250r6.html、小学校区 ' + NLNI_URL + 'gml/datalist/KsjTmplt-A27-2023.html、洪水浸水想定区域 ' + NLNI_URL + 'gml/datalist/KsjTmplt-A31b-2024.html）。作成者が加工して表示している（不動産情報ライブラリのAPI経由で取得）';
  const NLNI_SHORT = '出典：国土交通省 国土数値情報ダウンロードサイト（' + NLNI_URL + '）。作成者が加工';
  /** 原典の注意書き（津波・液状化。シートの災害の節に出す） */
  const TSUNAMI_NOTE = '津波浸水想定の注意（原典）: 実際の津波は、この想定よりも大きくなる場合がある。';
  const LIQ_NOTE = '液状化の注意（原典）: 250mメッシュの傾向で、明確な境界線や、特定の地震・震度の危険度を示すものではない。約18m格子でも20m程度の精度はない。';
  const SCHOOL_FAC_NOTE = '原典の注意: 小学校区は公式な資料ではなく、福祉施設の位置は正確ではない。';
  const ORIG_NOTES = TSUNAMI_NOTE + LIQ_NOTE + '洪水は、支川の氾濫・高潮・内水による氾濫等を考慮していない想定である。' + SCHOOL_FAC_NOTE;
  /** API利用規約 第8条(1)：作成者の責任の所在と、国が作成・監修したものではない旨 */
  const RESPONSIBILITY = 'このアプリは作成者が開発・運営し、表示内容の責任は作成者が負います（国が作成・監修したものではありません）。表示は参考情報で、判断は利用者が行ってください（重要事項説明などの手続きには使えません）';
  /** 将来人口は推計である旨 */
  const POP_NOTE = '将来人口は国土政策局による推計（令和2年国勢調査に基づく）で、実際の人口ではありません。メッシュ単位の値は誤差が大きいため、半径内の合計で見ています';

  /** 加工した旨。用途地域・区域区分を使う地域は、その名称も入れる */
  const processedFor = (region) => (region && region.zoning ? PROCESSED.replace('「都市計画決定GISデータ（立地適正化計画）」', '「都市計画決定GISデータ（立地適正化計画・用途地域・都市計画区域）」') : PROCESSED);
  /** 地域ごとのデータの扱い（フッターに出す） */
  const regionNote = (region) => region.id === 'tokushima'
    ? '徳島市周辺の長方形の範囲を取得し、市の外のデータ（鳴門市・阿南市など）も含む。シートを出すのは徳島市の中の位置だけ。'
    : region.name + 'の内側（都市計画区域の範囲）だけを同梱し、隣の自治体の施設・災害の区域は含めない（境界の近くでは、隣の自治体の施設を徒歩圏に数えない）。立地適正化計画のデータが無い区（市）は、用途地域・区域区分を代わりに示す。将来人口は隣の市区町村のメッシュも含む（半径500mの集計のため）。';
  const PLAN_PDF = 'https://www.city.tokushima.tokushima.jp/shisei/machi_keikaku/townplanning/loa_rat_plan/ricchi_todokede.files/todokede_tebiki_2025.4.pdf';
  const PLAN_PAGE = 'https://www.city.tokushima.tokushima.jp/shisei/machi_keikaku/townplanning/loa_rat_plan/';
  /** 徒歩圏の半径（m。直線距離）。不動産の表示に関する公正競争規約は徒歩1分=80m（道路距離）としている。10分=800m */
  const WALK_RADIUS = 800;
  /** 少人数の目安。周辺の基準年（2025年）の推計人口がこれ未満なら、増減率を出さない */
  const SMALL_POP = 100;
  /** 0〜14歳の人数の目安。基準年がこれ未満なら増減率を出さない */
  const SMALL_CHILD = 30;
  /** 将来人口を集計する半径（m） */
  const POP_RADIUS = 500;
  /** 地図で指した位置のメッシュを探す上限（m）。250mメッシュの対角の半分（約177m）より少し大きい */
  const MESH_SNAP = 250;

  // ---- 対象地域 ----
  // 地域ごとに同梱データを分け（web/data/<dir>/）、選んだ地域だけ読み込む。bbox は取得範囲（西・南・東・北）。
  // codes は地域に含める市区町村コード。groupKey があれば、計画・用途地域の照合では全コードをそのキーにまとめる
  // （大阪市は、人口・施設は区のコード 27102〜27128、都市計画決定GISデータは市のコード 27100 で返る。2026-11-14 の実応答）。
  // zoning は、立地適正化計画が無い区（市）の代用に用途地域（XKT002）・区域区分（XKT001）を同梱するか。clip は、隣の自治体のデータを同梱しない（地域の内側だけ）か
  const seq = (a, b, pre) => Array.from({ length: b - a + 1 }, (_, i) => pre + (a + i));
  const OSAKA_WARDS = [2, 3, 4, 6, 7, 8, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28].map((n) => '271' + String(n).padStart(2, '0'));
  const REGIONS = {
    tokushima: {
      id: 'tokushima', dir: 'tokushima', name: '徳島市', whole: '徳島市全体', unit: '市', codes: ['36201'], zoning: false, clip: false,
      bbox: [134.42, 33.95, 134.66, 34.16], view: { lon: 134.5548, lat: 34.0703, z: 14 }, zoomMin: 11,
      examples: [{ label: '徳島駅付近', lon: 134.5513, lat: 34.0745 }, { label: '国府町（郊外）', lon: 134.4845, lat: 34.0540 }, { label: '八万町（郊外）', lon: 134.5190, lat: 34.0450 }],
      search: '徳島市役所、徳島市国府町府中',
    },
    tokyo23: {
      id: 'tokyo23', dir: 'tokyo23', name: '東京23区', whole: '東京23区全体', unit: '区', codes: seq(101, 123, '13'), zoning: true, clip: true,
      bbox: [139.55, 35.51, 139.93, 35.84], view: { lon: 139.7671, lat: 35.6812, z: 13 }, zoomMin: 11,
      examples: [{ label: '東京駅付近（千代田区）', lon: 139.7671, lat: 35.6812 }, { label: '下北沢（世田谷区）', lon: 139.6680, lat: 35.6613 }, { label: '葛西（江戸川区）', lon: 139.8723, lat: 35.6637 }, { label: '北千住（足立区）', lon: 139.8049, lat: 35.7497 }],
      search: '東京都庁、世田谷区役所',
    },
    osaka: {
      id: 'osaka', dir: 'osaka', name: '大阪市', whole: '大阪市全体', unit: '市', codes: ['27100'].concat(OSAKA_WARDS), groupKey: '27100', zoning: true, clip: true,
      bbox: [135.36, 34.57, 135.62, 34.78], view: { lon: 135.4959, lat: 34.7025, z: 13 }, zoomMin: 11,
      examples: [{ label: '大阪駅付近（北区）', lon: 135.4959, lat: 34.7025 }, { label: '天王寺駅付近', lon: 135.5139, lat: 34.6465 }, { label: '平野区（郊外寄り）', lon: 135.5470, lat: 34.6150 }, { label: '住之江区（湾岸）', lon: 135.4760, lat: 34.6070 }],
      search: '大阪市役所、大阪城',
    },
  };
  const DEFAULT_REGION = 'tokushima';
  const regionHas = (region, code) => !!region && region.codes.indexOf(String(code)) >= 0;
  /** 計画・用途地域の照合に使う市区町村コード（大阪市は区のコードを市のコードにまとめる） */
  const planKey = (region, code) => (region && region.groupKey && regionHas(region, code) ? region.groupKey : String(code));

  // ---- 地理 ----
  function lonLatToWorld(lon, lat, z) {
    const n = Math.pow(2, z);
    const x = ((lon + 180) / 360) * n;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    return { x, y };
  }
  function worldToLonLat(x, y, z) {
    const n = Math.pow(2, z);
    return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
  }
  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function inRing(lon, lat, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inPolygon(lon, lat, rings) {
    if (!rings || !rings.length || !inRing(lon, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k])) return false;
    return true;
  }
  function inPolys(lon, lat, polys) {
    for (const p of polys || []) if (inPolygon(lon, lat, p)) return true;
    return false;
  }
  function inBBox(bbox, lon, lat) {
    return !!bbox && lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
  }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.max(10, Math.round(m / 10) * 10) + 'm'; }

  // ---- データの読み込み結果の検証 ----
  // 項目（API）ごとの状態: ok（取得して同梱済み）／failed（取得を試みたが失敗。理由つき）／missing（同梱データなし・形が違う）
  const APIS = {
    XKT003: { label: '立地適正化計画', name: '都市計画決定GISデータ（立地適正化計画）' },
    XKT013: { label: '将来推計人口（250mメッシュ）', name: '国土数値情報（将来推計人口250mメッシュ）' },
    XKT004: { label: '小学校区', name: '国土数値情報（小学校区）' },
    XKT006: { label: '学校', name: '国土数値情報（学校）' },
    XKT007: { label: '保育園・幼稚園等', name: '国土数値情報（保育園・幼稚園等）' },
    XKT010: { label: '医療機関', name: '国土数値情報（医療機関）' },
    XKT011: { label: '福祉施設', name: '国土数値情報（福祉施設）' },
    XKT029: { label: '土砂災害警戒区域', name: '国土数値情報（土砂災害警戒区域）' },
    XKT026: { label: '洪水浸水想定区域', name: '国土数値情報（洪水浸水想定区域（想定最大規模））' },
    XKT028: { label: '津波浸水想定', name: '国土数値情報（津波浸水想定）' },
    XKT027: { label: '高潮浸水想定区域', name: '国土数値情報（高潮浸水想定区域）' },
    XKT025: { label: '液状化の発生傾向', name: '国土交通省都市局（地形区分に基づく液状化の発生傾向図）' },
  };
  /** 立地適正化計画が無い区（市）の代用（東京23区・大阪市）。用途地域・区域区分。地域の zoning が true の時だけ使う */
  const ZONING_APIS = {
    XKT002: { label: '用途地域', name: '都市計画決定GISデータ（用途地域）' },
    XKT001: { label: '都市計画区域・区域区分', name: '都市計画決定GISデータ（都市計画区域・区域区分）' },
  };
  const apisFor = (region) => Object.assign({}, APIS, region && region.zoning ? ZONING_APIS : {});
  const isArr = Array.isArray;
  function validZoning(a) { return isArr(a) && a.length && a.every((e) => e && typeof e.cityCode === 'string' && e.name && isArr(e.polys)); }
  function validPlan(d) { return d && isArr(d.items) && d.items.length && d.items.every((e) => e && typeof e.id === 'number' && isArr(e.polys)); }
  function validPop(d) { return d && isArr(d.years) && isArr(d.items) && d.items.length && d.items.every((m) => m && typeof m.sc === 'string' && m.sc && isArr(m.v) && m.v.length === d.years.length * 4); }
  function validDistricts(d) { return d && isArr(d.items) && d.items.length && d.items.every((e) => e && e.name && isArr(e.polys)); }
  function validPoints(a) { return isArr(a) && a.length && a.every((p) => p && typeof p.lon === 'number' && typeof p.lat === 'number' && p.name); }
  function validAreas(a) { return isArr(a) && a.length && a.every(isArr); }
  const rasterBase = (r) => !!r && r.w > 0 && r.h > 0 && r.dx > 0 && r.dy > 0 && typeof r.west === 'number' && typeof r.north === 'number';
  /** 格子の形式: bits（1セル1ビット。区域の内外のみ）または lv（セルごとの区分の連長符号化。0=区域外） */
  function validRaster(r) {
    if (!rasterBase(r)) return false;
    if (typeof r.lv === 'string') return !!r.labels && typeof r.labels === 'object';
    return typeof r.bits === 'string' && r.bits.length >= Math.floor((Math.ceil((r.w * r.h) / 8) * 4) / 3);
  }
  /** 連長符号化（値1バイト＋長さ。tools/extract.mjs の rleEncode と対）を total バイトに戻す。形式が不正なら null */
  function rleDecode(b64, total) {
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const out = new Uint8Array(total);
    let p = 0, o = 0;
    while (p < bin.length) {
      const v = bin.charCodeAt(p++);
      let n = 0, sh = 0, c;
      do { if (p >= bin.length) return null; c = bin.charCodeAt(p++); n += (c & 127) * Math.pow(2, sh); sh += 7; } while (c & 128);
      if (o + n > total) return null;
      out.fill(v, o, o + n); o += n;
    }
    return o === total ? out : null;
  }
  /** 格子を使える形にする。lv 形式は levels（セルごとの区分）、bits 形式は grid（ビット列）。壊れていれば null */
  function decodeRaster(r) {
    if (typeof r.lv === 'string') {
      const levels = rleDecode(r.lv, r.w * r.h);
      return levels ? Object.assign({}, r, { levels: levels }) : null;
    }
    const bin = typeof atob === 'function' ? atob(r.bits) : Buffer.from(r.bits, 'base64').toString('binary');
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return Object.assign({}, r, { grid: a });
  }
  function cellIndex(r, lon, lat) {
    const col = Math.floor((lon - r.west) / r.dx), row = Math.floor((r.north - lat) / r.dy);
    if (!(col >= 0 && row >= 0 && col < r.w && row < r.h)) return -1;
    return row * r.w + col;
  }
  /** セルがオンか（描画用） */
  function cellOn(r, idx) { return r.levels ? r.levels[idx] > 0 : !!(r.grid[idx >> 3] & (1 << (idx & 7))); }
  /** 指した位置のセルの区分（0=区域外・範囲外。bits 形式は区域内=1） */
  function levelAt(r, lon, lat) {
    const idx = cellIndex(r, lon, lat);
    if (idx < 0) return 0;
    return r.levels ? r.levels[idx] : (r.grid[idx >> 3] >> (idx & 7)) & 1;
  }
  /** 格子の中に入るか。範囲外は false */
  function inRaster(r, lon, lat) { return levelAt(r, lon, lat) > 0; }
  /** 位置の約20m以内（隣のセルまで）に、区域の内外の境界があるか。maxLevel は周囲の最大の区分 */
  function rasterAround(r, lon, lat) {
    const c = levelAt(r, lon, lat) > 0;
    let mixed = false, maxLevel = 0;
    for (const a of [-1.1, 0, 1.1]) for (const b of [-1.1, 0, 1.1]) {
      const v = levelAt(r, lon + a * r.dx, lat + b * r.dy);
      if ((v > 0) !== c) mixed = true;
      if (v > maxLevel) maxLevel = v;
    }
    return { level: levelAt(r, lon, lat), mixed: mixed, maxLevel: maxLevel };
  }

  /** manifest と各ファイルの内容から、使える項目だけを残した data を作る。status は画面の「未取得」表示に使う。 */
  function assemble(manifest, files, region) {
    region = region || REGIONS[DEFAULT_REGION];
    const apis = apisFor(region);
    const status = {};
    const m = (manifest && manifest.layers) || {};
    for (const api of Object.keys(apis)) {
      const e = m[api];
      if (e && e.status === 'ok') status[api] = { state: 'ok', count: e.count, fetchedAt: e.fetchedAt };
      // empty: 取得はできたが、対象範囲のデータが0件（「該当なし」ではない。区域が無いのか、収録が無いのかは区別できない）
      else if (e && e.status === 'empty') status[api] = { state: 'empty', reason: e.reason || '取得はできたが、対象範囲のデータが0件', fetchedAt: e.fetchedAt };
      else status[api] = { state: e ? 'failed' : 'missing', reason: e && e.reason ? e.reason : e ? '取得に失敗しました' : '同梱データがありません' };
    }
    const f = files || {};
    const data = { status, region, fetchedAt: (manifest && manifest.fetchedAt) || null, city: (manifest && manifest.city) || { code: region.codes[0], name: region.name }, bbox: (manifest && manifest.bbox) || null };
    const drop = (api, reason) => { status[api] = { state: 'missing', reason: reason }; };
    if (status.XKT003.state === 'ok') { if (validPlan(f.plan)) data.plan = f.plan.items; else drop('XKT003', 'データの形式が不正です'); }
    if (status.XKT013.state === 'ok') { if (validPop(f.population)) data.pop = { years: f.population.years, meshes: f.population.items }; else drop('XKT013', 'データの形式が不正です'); }
    if (status.XKT004.state === 'ok') { if (validDistricts(f.districts)) data.districts = f.districts.items; else drop('XKT004', 'データの形式が不正です'); }
    const fac = f.facilities || {};
    for (const [api, part] of [['XKT006', 'schools'], ['XKT007', 'preschools'], ['XKT010', 'medical'], ['XKT011', 'elder']]) {
      if (status[api].state !== 'ok') continue;
      if (validPoints(fac[part])) (data.fac = data.fac || {})[part] = fac[part]; else drop(api, 'データの形式が不正です');
    }
    const hz = f.hazards || {};
    for (const [api, part] of [['XKT029', 'sediment'], ['XKT026', 'flood'], ['XKT028', 'tsunami'], ['XKT027', 'surge'], ['XKT025', 'liquefaction']]) {
      if (status[api].state !== 'ok') continue;
      if (part === 'sediment') { if (validAreas(hz[part])) (data.hazard = data.hazard || {})[part] = hz[part]; else drop(api, 'データの形式が不正です'); continue; }
      const dr = validRaster(hz[part]) ? decodeRaster(hz[part]) : null;
      if (dr) (data.hazard = data.hazard || {})[part] = dr; else drop(api, 'データの形式が不正です');
    }
    if (region.zoning) {
      const z = f.zoning || {};
      for (const [api, part] of [['XKT002', 'use'], ['XKT001', 'areas']]) {
        if (status[api].state !== 'ok') continue;
        if (validZoning(z[part])) (data.zoning = data.zoning || {})[part] = z[part]; else drop(api, 'データの形式が不正です');
      }
    }
    // 市区町村の判定に小学校区（市区町村コードつき）も使う
    if (data.pop && data.districts) data.pop.districts = data.districts;
    return data;
  }

  // ---- 位置の照合 ----
  /** 指した位置の市区町村コード。まず小学校区の多角形（A27_001 の市区町村コード。pop.districts にあれば）、無ければ将来人口メッシュ（SHICODE つき）のうち最も近い中心を MESH_SNAP 以内で探す。どちらも無い場所（海・川・無人地帯）は null */
  function cityAt(pop, lon, lat) {
    if (!pop) return null;
    for (const d of pop.districts || []) if (d.city && inPolys(lon, lat, d.polys)) return String(d.city);
    let best = null;
    for (const m of pop.meshes) {
      const d = haversine(lon, lat, m.lon, m.lat);
      if (d <= MESH_SNAP && (!best || d < best.d)) best = { d, sc: m.sc };
    }
    return best ? best.sc : null;
  }

  const PLAN_KUBUN = { 0: '立地適正化計画区域', 31: '居住誘導区域', 32: '都市機能誘導区域' };
  /** 立地適正化計画の区域との重なり。cityCode の計画が同梱データに無い場合は hasPlan:false */
  function planAt(plan, cityCode, lon, lat) {
    const mine = plan.filter((e) => e.cityCode === cityCode);
    if (!mine.length) return { hasPlan: false };
    const hit = mine.filter((e) => inPolys(lon, lat, e.polys));
    const byId = (id) => hit.find((e) => e.id === id);
    const res = { hasPlan: true, inPlanArea: !!byId(0), inResidential: !!byId(31), inCityFunction: !!byId(32), other: [], decided: {}, maker: '' };
    for (const e of mine) {
      if (e.decided) res.decided[e.id] = e.decided;
      if (e.maker && !res.maker) res.maker = e.maker;
    }
    for (const e of hit) if (!(e.id in PLAN_KUBUN)) res.other.push(e.name);
    res.hasResidentialLayer = mine.some((e) => e.id === 31);
    res.hasCityFunctionLayer = mine.some((e) => e.id === 32);
    return res;
  }

  /** 将来人口: 半径内（メッシュ中心が入るもの）の合計と、同じ市の全メッシュの合計。各年 {p:総数, a:0〜14歳, c:65歳以上, d:75歳以上} */
  function sumMeshes(meshes, years) {
    const out = {};
    years.forEach((y, i) => { out[y] = { p: 0, a: 0, c: 0, d: 0 }; for (const m of meshes) { const o = out[y]; o.p += m.v[i * 4]; o.a += m.v[i * 4 + 1]; o.c += m.v[i * 4 + 2]; o.d += m.v[i * 4 + 3]; } });
    return out;
  }
  function popAround(pop, cityCode, lon, lat, radius) {
    const r = radius || POP_RADIUS;
    const near = pop.meshes.filter((m) => haversine(lon, lat, m.lon, m.lat) <= r);
    // cityCode は市区町村コードの文字列、または地域（東京23区・大阪市は区のコードの集まり）
    const inCity = typeof cityCode === 'string' ? (sc) => sc === cityCode : (sc) => regionHas(cityCode, sc);
    const city = pop.meshes.filter((m) => inCity(m.sc));
    return { radius: r, meshN: near.length, years: pop.years, local: sumMeshes(near, pop.years), city: sumMeshes(city, pop.years), cityMeshN: city.length };
  }
  /** 増減率（%）。基準が 0 以下なら null */
  function changePct(a, b) { return a > 0 ? ((b - a) / a) * 100 : null; }
  function fmtPct(v) { return v == null ? '算出不可' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(0) + '%'; }
  function fmtNum(n) { return Math.round(n).toLocaleString('ja-JP'); }
  /** 65歳以上の割合（%） */
  function share(o, k) { return o.p > 0 ? (o[k] / o.p) * 100 : null; }

  /** 小学校区: 指した位置を含む学区と、その学区に中心が入るメッシュの合計 */
  function districtAt(districts, pop, lon, lat) {
    const d = districts.find((e) => inPolys(lon, lat, e.polys));
    if (!d) return null;
    const res = { name: d.name, code: d.code };
    if (pop) {
      const ms = pop.meshes.filter((m) => inPolys(m.lon, m.lat, d.polys));
      res.meshN = ms.length;
      res.sums = sumMeshes(ms, pop.years);
    }
    return res;
  }

  /** 徒歩圏の施設の種類。part は同梱データの区分（schools・preschools・medical・elder）、kinds は kind の絞り込み（null は全部） */
  const FAC_GROUPS = [
    { key: 'elem', label: '小学校', part: 'schools', kinds: ['小学校', '義務教育学校'] },
    { key: 'junior', label: '中学校', part: 'schools', kinds: ['中学校', '義務教育学校'] },
    { key: 'pre', label: '保育園・幼稚園等', part: 'preschools', kinds: null },
    { key: 'hospital', label: '病院', part: 'medical', kinds: ['病院'] },
    { key: 'clinic', label: '診療所（歯科を除く）', part: 'medical', kinds: ['診療所'] },
    { key: 'elder', label: '老人福祉施設', part: 'elder', kinds: null },
  ];
  /** 徒歩圏（radius m）の施設: 種類ごとに {label, count, names（近い順に最大3）, nearest:{name, dist}|null}。同梱データのない種類は have:false */
  function facilitiesAround(fac, lon, lat, radius) {
    const r = radius || WALK_RADIUS;
    const out = [];
    for (const g of FAC_GROUPS) {
      const list = fac && fac[g.part];
      if (!list) { out.push({ key: g.key, label: g.label, have: false }); continue; }
      const rows = list.filter((p) => !g.kinds || g.kinds.includes(p.kind)).map((p) => ({ p, d: haversine(lon, lat, p.lon, p.lat) })).sort((a, b) => a.d - b.d);
      const within = rows.filter((x) => x.d <= r);
      out.push({ key: g.key, label: g.label, have: true, count: new Set(within.map((x) => x.p.name)).size, names: [...new Set(within.map((x) => x.p.name))].slice(0, 3), distinct: new Set(within.map((x) => x.p.name)).size, nearest: rows[0] ? { name: rows[0].p.name, dist: rows[0].d } : null });
    }
    return { radius: r, groups: out };
  }

  /** 指した位置 → 各項目の結果（facts）。取れない項目（データなし）は null のまま */
  function collect(data, lon, lat) {
    const f = { lon, lat, inBBox: inBBox(data.bbox, lon, lat), cityCode: null, plan: null, zoning: null, pop: null, district: null, fac: null, hazard: null };
    if (!f.inBBox) return f;
    f.cityCode = data.pop ? cityAt(data.pop, lon, lat) : null;
    if (!regionHas(data.region, f.cityCode)) return f; // 対象は選んだ地域（徳島市・東京23区・大阪市）のみ
    const key = planKey(data.region, f.cityCode);
    if (data.plan) f.plan = planAt(data.plan, key, lon, lat);
    else if (data.status.XKT003.state === 'empty') f.plan = { hasPlan: false }; // 取得できたが0件: 計画のデータが無い（用途地域の代用を出す）
    if (data.zoning) f.zoning = zoningAt(data.zoning, key, lon, lat);
    if (data.pop) f.pop = popAround(data.pop, data.region, lon, lat, POP_RADIUS);
    if (data.districts) f.district = districtAt(data.districts, data.pop, lon, lat) || { name: null };
    if (data.fac) f.fac = facilitiesAround(data.fac, lon, lat, WALK_RADIUS);
    if (data.hazard) {
      f.hazard = {};
      if (data.hazard.sediment) f.hazard.sediment = inPolys(lon, lat, data.hazard.sediment);
      for (const part of ['flood', 'tsunami', 'surge', 'liquefaction']) if (data.hazard[part]) f.hazard[part] = rasterAround(data.hazard[part], lon, lat);
    }
    return f;
  }

  // ---- 1枚シート ----
  const UNFETCHED = '未取得';
  const NODATA = 'データ無し';
  /** 未取得（取得に失敗）・データ無し（取得できたが0件）の項目。どちらも「該当なし」とは書かない */
  const unfetched = (data, apis) => apis.filter((a) => data.status[a].state !== 'ok').map((a) => apisFor(data.region)[a].label + '（' + a + '）は' + (data.status[a].state === 'empty' ? NODATA + '（取得できたが0件。区域が無い、または収録が無い）' : UNFETCHED + '（' + data.status[a].reason + '）'));
  const ok = (data, a) => data.status[a].state === 'ok';
  /** 周辺と市全体の差（ポイント）を、評価語（「大きい・小さい」）を使わずに述べる */
  const gap = (loc, city) => {
    if (loc == null || city == null) return '';
    const d = Math.round(loc - city);
    return d === 0 ? '市全体と同じ値' : '市全体との差は ' + (d > 0 ? '+' : '−') + Math.abs(d) + ' ポイント';
  };
  /** 少人数の時は割合を出さず、この文言にする */
  const SMALL_TEXT = '人数が少なく比較に向かない';
  /** 年次: 先頭を基準、末尾を先の年、その間で基準の10年後に最も近い年を中間にする */
  function pickYears(years) {
    const y0 = years[0], y2 = years[years.length - 1];
    let y1 = years[Math.min(1, years.length - 1)];
    for (const y of years.slice(1, -1)) if (Math.abs(y - (y0 + 10)) < Math.abs(y1 - (y0 + 10))) y1 = y;
    return [y0, y1, y2];
  }

  /** 用途地域・区域区分: 指した位置を含むもの。cityKey は planKey の値（大阪市は 27100） */
  function zoningAt(zoning, cityKey, lon, lat) {
    const pick = (list) => (list || []).filter((e) => e.cityCode === cityKey);
    const use = pick(zoning.use), areas = pick(zoning.areas);
    const seen = new Set();
    const hitUse = [];
    for (const e of use) if (inPolys(lon, lat, e.polys)) { const k = e.name + '|' + e.far + '|' + e.bcr; if (!seen.has(k)) { seen.add(k); hitUse.push({ name: e.name, far: e.far, bcr: e.bcr }); } }
    const hitAreas = [...new Set(areas.filter((e) => inPolys(lon, lat, e.polys)).map((e) => e.name))];
    const any = use[0] || areas[0];
    return { hasUse: !!zoning.use && use.length > 0, hasAreas: !!zoning.areas && areas.length > 0, use: hitUse, areas: hitAreas, cityName: any ? any.city : '' };
  }

  const unitOf = (region) => (region.unit === '区' ? '区' : '市');
  function planSection(data, f) {
    const region = data.region, tk = region.id === 'tokushima', u = unitOf(region);
    // 立地適正化計画が「データ無し」（取得できたが0件）の地域は、用途地域の代用を示すので、「データ無し」の行は出さない
    const planApis = ['XKT003'].filter((a) => !(region.zoning && data.status[a].state === 'empty'));
    const sec = { id: 'plan', title: '1. 市の計画：立地適正化計画の区域か', apis: ['XKT003', 'XKT013'], lines: [], ask: [], missing: unfetched(data, planApis) };
    const p = f.plan;
    if (!(p && p.hasPlan) && region.zoning && f.zoning) return zoningSection(data, f, sec);
    if (!p) return sec;
    if (!p.hasPlan) { sec.lines.push({ tag: 'XKT003', text: 'この市の立地適正化計画の区域は、取得したデータにありません（計画がない、または未登録の可能性）。' }); sec.ask.push('市の都市計画課に、立地適正化計画の有無を聞く。'); return sec; }
    const ymd = (id) => (p.decided[id] ? '（データ上の区域設定日 ' + p.decided[id] + '）' : '');
    // 徳島市の呼び方・届出の手引の引用は、徳島市のシートだけに出す
    if (p.inResidential) sec.lines.push({ tag: 'XKT003', text: '居住誘導区域の中にある' + ymd(31) + '。' + (tk ? '徳島市はこれを「居住促進区域」と呼び、人口密度を維持して生活サービスやコミュニティを続けたい区域として定めている（市の届出の手引）。' : '') });
    else if (p.inPlanArea) sec.lines.push({ tag: 'XKT003', text: '立地適正化計画の区域の中だが、居住誘導区域' + (tk ? '（居住促進区域）' : '') + 'の外にある。' });
    else sec.lines.push({ tag: 'XKT003', text: '立地適正化計画の区域の外にある。' });
    if (p.inCityFunction) sec.lines.push({ tag: 'XKT003', text: '都市機能誘導区域の中にある' + ymd(32) + '。医療・福祉・商業などの施設を集めたい区域。' });
    for (const n of p.other) sec.lines.push({ tag: 'XKT003', text: n + 'の中にある。' });
    if (!p.inResidential && tk) sec.lines.push({ tag: '市の資料', text: '区域の外でも住むことはできる。居住促進区域の外で3戸以上の住宅を建てる開発・建築などは、着手の30日前までに市への届出が必要（徳島市「立地適正化計画 届出の手引」令和7年4月 p.2〜3）。1戸・2戸の住宅の建築は、手引の届出対象の例に入っていない（1,000㎡以上の開発を除く）。届出が要るかどうかは、市の都市計画課か宅地建物取引業者に確かめる。' });
    if (!p.inResidential && !tk) sec.lines.push({ tag: '注意', text: '区域の外でも住むことはできる。区域の外での届出などが要るかは、' + u + 'の都市計画の担当課か宅地建物取引業者に確かめる。' });
    sec.lines.push({ tag: '注意', text: '区域の内外は、住めるかどうかや価格を示すものではない。' + (tk ? '市' : u) + 'が公表する図が正で、この画面は参考。' });
    sec.ask.push((tk ? '市' : u) + 'の都市計画' + (tk ? '課' : 'の担当課') + 'に、この場所の区域指定と、区域の見直しの予定を聞く。');
    return sec;
  }
  /** 立地適正化計画のデータが無い区（市）: 用途地域（XKT002）・区域区分（XKT001）を代わりに示す。用途地域は建築の規制で、居住を誘導する区域ではない */
  function zoningSection(data, f, sec) {
    const region = data.region, u = unitOf(region), z = f.zoning;
    sec.title = '1. 土地利用の規制：用途地域・区域区分（この' + u + 'は立地適正化計画のデータが無い）';
    sec.apis = ['XKT002', 'XKT001', 'XKT013'];
    sec.missing = sec.missing.concat(unfetched(data, ['XKT002', 'XKT001']));
    const place = z.cityName ? '（' + z.cityName + '）' : '';
    sec.lines.push({ tag: 'XKT003', text: 'この' + u + place + 'は立地適正化計画のデータが無いため、用途地域を示す。用途地域は建てられる建物の規制で、居住を誘導する区域ではない。' });
    if (data.status.XKT002.state === 'ok') {
      if (z.use.length) sec.lines.push({ tag: 'XKT002', text: '用途地域: ' + z.use.map((e) => e.name + (e.far || e.bcr ? '（' + (e.far ? '容積率 ' + e.far : '') + (e.far && e.bcr ? '、' : '') + (e.bcr ? '建蔽率 ' + e.bcr : '') + '）' : '')).join(' ／ ') + (z.use.length > 1 ? '（境界付近で、2つの用途地域が重なって見える。どちらかは確かめが必要）' : '') + '。' });
      else sec.lines.push({ tag: 'XKT002', text: '用途地域: この位置は、取得したデータの用途地域に入っていない（用途地域の指定がない場所、公園・水面、またはデータの切れ目の可能性）。' });
    }
    if (data.status.XKT001.state === 'ok') {
      if (z.areas.length) sec.lines.push({ tag: 'XKT001', text: '区域区分（都市計画区域）: ' + z.areas.join('・') + '。' });
      else sec.lines.push({ tag: 'XKT001', text: '区域区分（都市計画区域）: この位置は、取得したデータの区域に入っていない。' });
    }
    sec.lines.push({ tag: '注意', text: '用途地域は建築の規制で、住めるかや価格を示さない。国の整備データ（令和7年度）を座標約1mに丸めており、' + u + 'の公表図が正。境界付近は要確認。' });
    sec.ask.push(u + 'の都市計画の担当課に、この場所の用途地域と、立地適正化計画の策定の予定を聞く。');
    return sec;
  }

  function popSection(data, f) {
    const sec = { id: 'pop', title: '2. 周りの将来人口（推計）', apis: ['XKT013'], lines: [], ask: [], missing: unfetched(data, ['XKT013']) };
    const q = f.pop;
    if (!q) return sec;
    const [y0, y1, y2] = pickYears(q.years), L = q.local, C = q.city;
    if (!q.meshN) { sec.lines.push({ tag: 'XKT013', text: '半径' + q.radius + 'm に推計人口のあるメッシュがありません（人のいない場所、または対象外）。この節の数字は出せません。' }); return sec; }
    const small = L[y0].p < SMALL_POP || L[y2].p <= 0;
    const lc = small ? null : changePct(L[y0].p, L[y2].p), cc = changePct(C[y0].p, C[y2].p);
    const head = '半径' + q.radius + 'm（250mメッシュ' + q.meshN + '個）の人口（推計）: ' + y0 + '年 ' + fmtNum(L[y0].p) + '人 → ' + y1 + '年 ' + fmtNum(L[y1].p) + '人 → ' + y2 + '年 ' + fmtNum(L[y2].p) + '人';
    if (small) {
      sec.lines.push({ tag: 'XKT013', text: head + '。周辺の人数が少なく（' + y0 + '年で' + SMALL_POP + '人未満、または' + y2 + '年の推計が0人）、増減率は' + SMALL_TEXT + 'ため出さない。' });
    } else {
      sec.lines.push({ tag: 'XKT013', text: head + '（' + y0 + '→' + y1 + '年 ' + fmtPct(changePct(L[y0].p, L[y1].p)) + '、' + y0 + '→' + y2 + '年 ' + fmtPct(lc) + '）。' });
      sec.lines.push({ tag: '作成者の集計', text: '' + data.region.whole + 'は' + y0 + '→' + y2 + '年で ' + fmtPct(cc) + '。周辺は ' + fmtPct(lc) + '（' + gap(lc, cc) + '）。' });
      const s0 = share(L[y0], 'c'), s2 = share(L[y2], 'c'), cs0 = share(C[y0], 'c'), cs2 = share(C[y2], 'c');
      const sp = (v) => (v == null ? '—' : v.toFixed(0) + '%');
      if (s0 != null && s2 != null) sec.lines.push({ tag: 'XKT013', text: '65歳以上の割合: ' + y0 + '年 ' + sp(s0) + ' → ' + y2 + '年 ' + sp(s2) + '（' + data.region.whole + 'は ' + sp(cs0) + ' → ' + sp(cs2) + '）。' });
      if (L[y0].a >= SMALL_CHILD && L[y2].a > 0) sec.lines.push({ tag: 'XKT013', text: '0〜14歳: ' + y0 + '年 ' + fmtNum(L[y0].a) + '人 → ' + y2 + '年 ' + fmtNum(L[y2].a) + '人（' + fmtPct(changePct(L[y0].a, L[y2].a)) + '）。' });
      else if (L[y0].a > 0) sec.lines.push({ tag: 'XKT013', text: '0〜14歳: ' + y0 + '年 ' + fmtNum(L[y0].a) + '人 → ' + y2 + '年 ' + fmtNum(L[y2].a) + '人（人数が少なく比較に向かないため、増減率は出さない）。' });
    }
    const subst = data.region.zoning && !(f.plan && f.plan.hasPlan); // 立地適正化計画の代わりに用途地域を示している
    sec.lines.push({ tag: '注意', text: (subst ? '1の用途地域・区域区分と人口の増減は、別々の事実を並べたもので、関係（この用途地域だから減る、など）は示さない。' : '1の区域の内外と人口の増減は、別々の事実を並べたもので、関係（区域の外だから減る、など）は示さない。') + '将来人口は推計で、実際の人口ではない（下の注記）。' });
    sec.ask.push('市に、この地区の将来人口の見通しと、公共施設や公共交通の見直しの予定があるかを聞く。');
    return sec;
  }

  function schoolSection(data, f) {
    const sec = { id: 'school', title: '3. 小学校区と子どもの数（推計）', apis: ['XKT004', 'XKT013'], lines: [], ask: [], missing: unfetched(data, ['XKT004']) };
    const d = f.district;
    if (!d) return sec;
    if (!d.name) { sec.lines.push({ tag: 'XKT004', text: '指した位置を含む小学校区は、取得したデータにありません。' }); return sec; }
    sec.lines.push({ tag: 'XKT004', text: '小学校区は「' + d.name + '」。' });
    if (d.sums && ok(data, 'XKT013')) {
      const [y0, , y2] = pickYears(f.pop ? f.pop.years : [2025, 2035, 2050]);
      const a0 = d.sums[y0], a2 = d.sums[y2];
      if (a0 && a0.a >= SMALL_CHILD && a2 && a2.a > 0) {
        const cc = f.pop ? changePct(f.pop.city[y0].a, f.pop.city[y2].a) : null;
        sec.lines.push({ tag: '作成者の集計', text: 'この校区（メッシュ' + d.meshN + '個）の0〜14歳（推計）: ' + y0 + '年 ' + fmtNum(a0.a) + '人 → ' + y2 + '年 ' + fmtNum(a2.a) + '人（' + fmtPct(changePct(a0.a, a2.a)) + '）。' + data.region.whole + 'は ' + fmtPct(cc) + '。' });
      }
    }
    if (d.sums && ok(data, 'XKT013') && !(d.sums[pickYears(f.pop ? f.pop.years : [2025, 2035, 2050])[0]].a >= SMALL_CHILD)) sec.lines.push({ tag: '注意', text: 'この校区のメッシュ内の0〜14歳が少なく、増減率は' + SMALL_TEXT + 'ため出さない。' });
    sec.lines.push({ tag: '注意', text: '学校の統合・存続は教育委員会が決める。この数字だけでは、学校が続くかどうかは分からない。' });
    sec.ask.push('教育委員会に、この校区の通学区域の見直し・統合の予定を聞く。');
    return sec;
  }

  function facSection(data, f) {
    const sec = { id: 'fac', title: '4. 徒歩圏（直線800m）の生活施設', apis: ['XKT006', 'XKT007', 'XKT010', 'XKT011'], lines: [], ask: [], missing: unfetched(data, ['XKT006', 'XKT007', 'XKT010', 'XKT011']) };
    const fac = f.fac;
    if (!fac) return sec;
    const apiOf = { elem: 'XKT006', junior: 'XKT006', pre: 'XKT007', hospital: 'XKT010', clinic: 'XKT010', elder: 'XKT011' };
    for (const g of fac.groups) {
      if (!g.have) continue;
      const near = g.nearest ? '最寄りは' + g.nearest.name + '（約' + fmtDist(g.nearest.dist) + '）' : '';
      sec.lines.push({ tag: apiOf[g.key], text: g.label + ': ' + (g.count ? g.count + '件（' + g.names.join('、') + (g.count > g.names.length ? ' など' : '') + '）' : '直線800m以内に該当なし' + (near ? '。' + near : '')) + '。' });
    }
    sec.lines.push({ tag: '注意', text: 'ここでの徒歩圏は、指した位置から直線800m以内で、道路に沿った距離ではない（規約の「1分=80m」は道路距離。坂・川・踏切・遠回りがあれば実際はより長い）。位置は整備時点（医療機関は令和2年度、学校・福祉施設は令和5年度）のもので、その後の閉鎖・開設は反映されず、将来も続くかは分からない。' + (data.region.clip ? '同梱は' + data.region.name + 'の内側の施設のみ（境界の近くは隣の施設を数えない）。収録は自治体で差があり、少なく出ることがある。' : '') + '' });
    sec.ask.push('気になる施設は、現在も運営しているか、受け入れ状況を、施設か自治体に直接確かめる。');
    return sec;
  }

  /** 格子で持つ災害の想定。title は行の見出し、depth は区分の呼び方、noBoundary は境界付近の注記を付けないもの（250mメッシュ） */
  const RASTER_HAZARDS = [
    { api: 'XKT026', part: 'flood', title: '洪水浸水想定区域（想定最大規模）', depth: '想定浸水深', suffix: '（重なる所は最も深いもの）', out: '想定区域の外にある' },
    { api: 'XKT028', part: 'tsunami', title: '津波浸水想定', depth: '想定浸水深', suffix: '', out: '想定区域の外にある' },
    { api: 'XKT027', part: 'surge', title: '高潮浸水想定区域', depth: '想定浸水深', suffix: '', out: '想定区域の外にある' },
    { api: 'XKT025', part: 'liquefaction', title: '液状化の発生傾向（地形区分に基づく目安）', depth: '区分', suffix: '', out: '取得したデータに区分がない', noBoundary: true },
  ];
  function rasterHazardText(spec, r, v) {
    const label = (lv) => (r.labels && r.labels[lv]) || '区分不明';
    if (v.mixed && !spec.noBoundary) {
      return spec.title + ': 想定区域の境界付近にある（約20m以内に区域の内外の境界があり、中か外かは言い切れない' + (v.maxLevel ? '。付近の' + spec.depth + 'は最大で ' + label(v.maxLevel) : '') + '）。約18m格子に変換しているため、境界付近は±20m程度ずれる。';
    }
    if (v.level > 0) return spec.title + ': ' + (spec.noBoundary ? '' : '想定区域の中にある（') + spec.depth + ': ' + label(v.level) + (spec.noBoundary ? '' : spec.suffix + '）') + '。';
    return spec.title + ': ' + spec.out + '。';
  }

  function hazardSection(data, f) {
    const apis = ['XKT029', 'XKT026', 'XKT028', 'XKT027', 'XKT025'];
    const sec = { id: 'hazard', title: '5. 災害の想定区域（防災の確認）', apis: apis, lines: [], ask: [], missing: unfetched(data, apis) };
    const h = f.hazard;
    if (!h) return sec;
    const yn = (v) => (v ? '想定区域の中にある' : '想定区域の外にある');
    if ('sediment' in h) sec.lines.push({ tag: 'XKT029', text: '土砂災害警戒区域: ' + yn(h.sediment) + '。このシートは警戒区域と特別警戒区域を区別していない（特別警戒区域は建築や開発に制限がかかる場合があるため、市のハザードマップで確かめる）。' });
    for (const spec of RASTER_HAZARDS) if (spec.part in h) sec.lines.push({ tag: spec.api, text: rasterHazardText(spec, data.hazard[spec.part], h[spec.part]) });
    // 東京都は、国の想定とは別に、中小河川・内水も含めた「浸水予想区域図」を公表している（国土数値情報 洪水浸水想定区域（A31b）の注記。2026-11-14 に原ページで確認）
    if (data.region.id === 'tokyo23' && 'flood' in h) sec.lines.push({ tag: '注意', text: '東京都は別に、内水等も含む「浸水予想区域図」を公表しており、区のハザードマップと異なる場合がある（国土数値情報の注記）。' });
    if (data.status.XKT028.state === 'empty') sec.lines.push({ tag: '注意', text: '津波浸水想定は、この地域ではデータ無し（取得できたが0件）。想定が無い、または安全である、という意味ではない。' });
    if ('tsunami' in h) sec.lines.push({ tag: '注意', text: TSUNAMI_NOTE });
    if ('liquefaction' in h) sec.lines.push({ tag: '注意', text: LIQ_NOTE });
    sec.lines.push({ tag: '注意', text: '扱っていない災害: 内水氾濫、ため池、地すべり、急傾斜地、大規模盛土造成地、災害の履歴、津波の到達時間・地震の揺れ・火災。区域の外は安全を意味せず、同じ区域でも深さは場所で違う。安全・危険の判定ではない。' });
    sec.ask.push('市のハザードマップと避難場所を確認し、不動産会社に重要事項説明（水害ハザードマップ上の位置）を聞く。');
    return sec;
  }

  /** 1枚シートの中身を作る。範囲外・徳島市外の場合は outOfScope に理由を入れて、各節は空にする */
  function buildSheet(data, f) {
    const sheet = { title: '住む場所の先行きシート', outOfScope: null, sections: [], missing: [] };
    if (!f.inBBox) { sheet.outOfScope = 'この地点は、同梱データの範囲（' + data.region.name + '周辺）の外です。他の地域は、画面の「対象地域」で選べます。'; return sheet; }
    if (!ok(data, 'XKT013')) { sheet.outOfScope = '将来推計人口（XKT013）が' + UNFETCHED + 'のため、位置が' + data.region.name + 'の中か判定できません（' + data.status.XKT013.reason + '）。'; return sheet; }
    if (!regionHas(data.region, f.cityCode)) { sheet.outOfScope = f.cityCode ? 'この地域の対象は' + data.region.name + 'のみです。この地点は別の市区町村（市区町村コード ' + f.cityCode + '）です。他の地域は、画面の「対象地域」で選べます。' : 'この地点の近く（約' + MESH_SNAP + 'm以内）に、人口の推計があるメッシュがありません（海・川・山林など）。人が住む場所を指してください。'; return sheet; }
    sheet.sections = [planSection(data, f), popSection(data, f), schoolSection(data, f), facSection(data, f), hazardSection(data, f)];
    sheet.missing = ['学校・病院・店が10年後も続くか（公開データに将来の存続はない）', '空き家の多さ、道路・上下水道の維持の計画、地価や取引の動き（このシートでは扱わない）', '個別の物件の状態（接道・境界・建物の劣化など）'];
    return sheet;
  }

  return {
    processedFor, regionNote, REGIONS, DEFAULT_REGION, regionHas, planKey, apisFor, ZONING_APIS, NODATA, zoningAt, REINFOLIB_URL, CREDIT, ATTRIBUTION, NLNI_SOURCE, NLNI_SHORT, TSUNAMI_NOTE, LIQ_NOTE, SCHOOL_FAC_NOTE, ORIG_NOTES, PROCESSED, RESPONSIBILITY, POP_NOTE, PLAN_PDF, PLAN_PAGE, WALK_RADIUS, POP_RADIUS, MESH_SNAP, APIS, PLAN_KUBUN, UNFETCHED, FAC_GROUPS,
    lonLatToWorld, worldToLonLat, haversine, inRing, inPolygon, inPolys, inBBox, fmtDist, decodeRaster, rleDecode, inRaster, levelAt, rasterAround, cellOn, pickYears, RASTER_HAZARDS, SMALL_POP, SMALL_CHILD,
    assemble, cityAt, planAt, sumMeshes, popAround, changePct, fmtPct, fmtNum, share, districtAt, facilitiesAround, collect, buildSheet,
  };
});