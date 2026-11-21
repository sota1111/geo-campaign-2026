/* データセンター候補地の一次スクリーニング：格子の読み出し・確認項目の集計（ブラウザと node の両方で動く）
 * 点数・順位・「適地」の判定は作らない。地点（または候補地の範囲）ごとに、確認項目と出典を並べるだけ。 */
(function (root) {
  'use strict';

  const R_EARTH = 6371008.8;
  const CLICK_RADIUS_M = 75; // 利用者が指した地点は、周囲この半径の格子を集計する

  // ---- 場面（fetch_sat.py・README と同じ）----
  const SCENES = {
    s2_now: { id: 'S2B_52SFC_20260823_0_L2A', date: '2026-08-23', label: 'Sentinel-2B L2A（現在の状態）', credit: 'Contains modified Copernicus Sentinel data [2026]' },
    s2_past: { id: 'S2B_52SFC_20200824_0_L2A', date: '2020-08-24', label: 'Sentinel-2B L2A（比べる過去）', credit: 'Contains modified Copernicus Sentinel data [2020]' },
    landsat: { id: 'LC09_L2SP_113036_20260822_02_T1', date: '2026-08-22', label: 'Landsat 9 Collection 2 Level-2 地表面温度（ST_B10）', credit: 'Landsat-9 image courtesy of the U.S. Geological Survey' },
    insar: { id: 'merge_sbas_regular_japan_20260331_qu', date: '観測 2014-08〜2025-11（2026-03-31 公開分）', label: '国土地理院 衛星SAR地盤変動測量成果（準上下方向の変位速度）', credit: '解析：国土地理院 原初データ所有：JAXA' },
  };

  // ---- 国土数値情報の区分 ----
  const FLOOD_RANK = ['', '0.5 m 未満', '0.5〜3 m', '3〜5 m', '5〜10 m', '10〜20 m', '20 m 以上']; // 浸水深ランクコード（A31b）
  const SLIDE_ZONE = ['', '土砂災害警戒区域（イエロー）', '土砂災害特別警戒区域（レッド）'];
  const SLIDE_TYPE = ['急傾斜地の崩壊', '土石流', '地すべり'];
  // 干渉SAR: 16 階級（凡例 -3〜+3 cm/年 を 16 等分。1 階級 = 3.75 mm/年幅）。階級 0 が最も沈下側
  const INSAR_CLASS_W = 3.75;
  const insarRange = (k) => [-30 + INSAR_CLASS_W * k, -30 + INSAR_CLASS_W * (k + 1)];
  // 地表面温度: 符号は 1 = 10.0 ℃、0.5 ℃刻み（約 100 m の平均）
  const lstFromCode = (c) => (c > 0 ? 10 + (c - 1) / 2 : null);
  const LAND = { 0: '雲・欠測', 1: '植生', 2: '裸地等', 3: '建物', 4: '水', 5: 'まばらな植生・草地' };

  // ---- 基本 ----
  function decodeRle(runs, n) {
    const out = new Uint8Array(n);
    let p = 0;
    for (let i = 0; i < runs.length; i += 2) {
      const v = runs[i], len = runs[i + 1];
      if (v) out.fill(v, p, p + len);
      p += len;
    }
    if (p !== n) throw new Error(`格子の大きさが合いません（${p} != ${n}）`);
    return out;
  }

  const gridOf = (data) => data.grid;
  function cellOf(g, lon, lat) {
    const j = Math.floor((lon - g.w) / g.d), i = Math.floor((g.n - lat) / g.d);
    if (j < 0 || j >= g.nx || i < 0 || i >= g.ny) return null;
    return { i, j, idx: i * g.nx + j };
  }
  const cellCenter = (g, i, j) => [g.w + (j + 0.5) * g.d, g.n - (i + 0.5) * g.d];

  function haversine(lon1, lat1, lon2, lat2) {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** 地点から線分 (a,b) までの距離 m（局所の平面近似。数 km の範囲では誤差は小さい） */
  function distToSegment(lon, lat, ax, ay, bx, by) {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320, ky = 110574;
    const px = 0, py = 0, x1 = (ax - lon) * kx, y1 = (ay - lat) * ky, x2 = (bx - lon) * kx, y2 = (by - lat) * ky;
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x1 + t * dx - px, y1 + t * dy - py);
  }

  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 範囲（輪郭）に中心が入る格子の番号 */
  function cellsInRing(g, ring) {
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const j0 = Math.max(0, Math.floor((Math.min(...xs) - g.w) / g.d)), j1 = Math.min(g.nx - 1, Math.floor((Math.max(...xs) - g.w) / g.d));
    const i0 = Math.max(0, Math.floor((g.n - Math.max(...ys)) / g.d)), i1 = Math.min(g.ny - 1, Math.floor((g.n - Math.min(...ys)) / g.d));
    const out = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const [x, y] = cellCenter(g, i, j);
      if (pointInRing(x, y, ring)) out.push(i * g.nx + j);
    }
    return out;
  }

  /** 地点の周囲の半径 r m の格子の番号 */
  function cellsInDisk(g, lon, lat, r) {
    const c = cellOf(g, lon, lat);
    if (!c) return [];
    const out = [];
    const nj = Math.ceil(r / (g.d * 92500)) + 1, ni = Math.ceil(r / (g.d * 111000)) + 1;
    for (let i = Math.max(0, c.i - ni); i <= Math.min(g.ny - 1, c.i + ni); i++) {
      for (let j = Math.max(0, c.j - nj); j <= Math.min(g.nx - 1, c.j + nj); j++) {
        const [x, y] = cellCenter(g, i, j);
        if (haversine(lon, lat, x, y) <= r) out.push(i * g.nx + j);
      }
    }
    if (!out.length) out.push(c.idx);
    return out;
  }

  // ---- 集計 ----
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  function summarizeFlood(arr, cells) {
    let hit = 0, max = 0;
    for (const k of cells) { if (arr[k]) { hit++; if (arr[k] > max) max = arr[k]; } }
    return { hit: hit > 0, share: pct(hit, cells.length), max, label: max ? FLOOD_RANK[max] : '' };
  }
  function summarizeSlide(arr, cells) {
    let hit = 0, zone = 0, types = 0;
    for (const k of cells) { const v = arr[k]; if (v & 3) { hit++; zone = Math.max(zone, v & 3); types |= v >> 2; } }
    return { hit: hit > 0, share: pct(hit, cells.length), zone, zoneLabel: zone ? SLIDE_ZONE[zone] : '', types: SLIDE_TYPE.filter((_, t) => types & (1 << t)) };
  }
  function summarizeDepth(arr, cells, labels) {
    let hit = 0, max = 0;
    for (const k of cells) { if (arr[k]) { hit++; if (arr[k] > max) max = arr[k]; } }
    return { hit: hit > 0, share: pct(hit, cells.length), max, label: max ? labels[max - 1] : '' };
  }
  function summarizeInsar(arr, cells) {
    const cnt = new Array(17).fill(0);
    let valid = 0;
    for (const k of cells) { cnt[arr[k]]++; if (arr[k]) valid++; }
    if (!valid) return { valid: 0, share: 0 };
    let best = 1;
    for (let c = 2; c <= 16; c++) if (cnt[c] > cnt[best]) best = c;
    const k = best - 1;
    const classes = cnt.map((n, c) => [c - 1, n]).filter(([c, n]) => c >= 0 && n > 0);
    return { valid, share: pct(valid, cells.length), k, range: insarRange(k), classes, mixed: classes.length > 1 };
  }
  function summarizeLst(arr, cells) {
    const v = [];
    for (const k of cells) if (arr[k]) v.push(lstFromCode(arr[k]));
    if (!v.length) return { valid: 0 };
    v.sort((a, b) => a - b);
    const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { valid: v.length, median: med, min: v[0], max: v[v.length - 1] };
  }
  function summarizeLand(land, chg, cells) {
    const cnt = {};
    let valid = 0, changed = 0;
    for (const k of cells) {
      const v = land[k];
      cnt[v] = (cnt[v] || 0) + 1;
      if (v) valid++;
      if (chg[k]) changed++;
    }
    const share = {};
    for (const v of [1, 2, 3, 4, 5]) share[v] = pct(cnt[v] || 0, valid);
    return { valid, cloud: pct(cnt[0] || 0, cells.length), share, changed: pct(changed, valid || cells.length) };
  }

  /** 電圧タグ（"220000;66000" など。V）の最大値。無ければ 0 */
  function maxVoltage(v) {
    return Math.max(0, ...String(v || '').split(/[;,]/).map((s) => parseInt(s, 10) || 0));
  }
  function nearestSubstation(subs, lon, lat, minV) {
    let best = null;
    for (const s of subs) {
      if (minV && maxVoltage(s.voltage) < minV) continue;
      const d = haversine(lon, lat, s.lon, s.lat);
      if (!best || d < best.d) best = { s, d };
    }
    return best;
  }
  function nearestLine(lines, lon, lat) {
    let best = null;
    for (const l of lines) {
      const p = l.p;
      for (let i = 0; i + 1 < p.length; i++) {
        const d = distToSegment(lon, lat, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
        if (!best || d < best.d) best = { l, d };
      }
    }
    return best;
  }

  const fmtKm = (m) => (m < 1000 ? `約 ${Math.round(m / 10) * 10} m` : `約 ${(m / 1000).toFixed(1)} km`);
  const fmtVolt = (v) => {
    const m = maxVoltage(v);
    return m ? `${m >= 1000 ? m / 1000 : m} kV` : '電圧の記載なし';
  };
  const fmtRange = (r) => `${r[0] > 0 ? '+' : ''}${r[0]}〜${r[1] > 0 ? '+' : ''}${r[1]} mm/年`;

  const SRC = {
    flood: { name: '国土数値情報 A31b 洪水浸水想定区域（想定最大規模。令和7年度版）', lic: 'CC BY 4.0', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31b-2025.html' },
    slide: { name: '国土数値情報 A33 土砂災害警戒区域（福岡県。2025-08-01 時点）', lic: 'CC BY 4.0（一部制限）', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A33-2025.html' },
    tsunami: { name: '国土数値情報 A40 津波浸水想定（福岡県。2016 年版）', lic: 'CC BY 4.0（一部制限）', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A40-2024.html' },
    surge: { name: '国土数値情報 A49 高潮浸水想定区域（福岡県。2020 年版）', lic: 'CC BY 4.0（一部制限）', url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A49-2024.html' },
    insar: { name: '国土地理院 衛星SAR地盤変動測量成果（だいち2号・4号。解析：国土地理院 原初データ所有：JAXA）', lic: '国土地理院コンテンツ（出典表示。承認の要否は要確認）', url: 'https://www.gsi.go.jp/uchusokuchi/gsi_sar_seika.html' },
    lst: { name: 'Landsat 9 Collection 2 Level-2 地表面温度 ST_B10（2026-08-22。USGS）', lic: 'USGS: 利用制限なし', url: 'https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products' },
    sub: { name: '© OpenStreetMap contributors（power=substation / line）', lic: 'ODbL', url: 'https://www.openstreetmap.org/copyright' },
    land: { name: 'Copernicus Sentinel-2 L2A（2026-08-23 と 2020-08-24）＋ OSM の建物', lic: 'Copernicus: 無償・自由 ／ ODbL', url: 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice' },
  };

  /** 干渉SARの階級の範囲を、言葉で先に言う（階級の数字は注記に回す） */
  function insarWords(r) {
    if (r[0] >= -INSAR_CLASS_W && r[1] <= INSAR_CLASS_W) return { word: '目立つ動きなし', text: `目立つ動きなし（±${INSAR_CLASS_W} mm/年の階級内。現地確認が要る）` };
    if (r[1] <= -INSAR_CLASS_W) return { word: '沈下気味', text: `沈下気味（${fmtRange(r)}）` };
    return { word: '隆起気味', text: `隆起気味（${fmtRange(r)}）` };
  }

  /** 確認項目の一覧。target = { lon, lat, cells } 。layers = decodeRle した格子
   *  各項目: label（項目名）・status・value（1行の値）・short（比べる表の短い値）・hint（衛星の項目だけ：何を見るか→何に使うか）・src・note */
  function buildChecks(data, layers, target) {
    const { lon, lat, cells } = target;
    const rows = [];
    const OUT = '浸水想定区域の外（概略。誤差 数百 m）';
    const f = summarizeFlood(layers.flood, cells);
    rows.push({ key: 'flood', label: '洪水', status: f.hit ? 'hit' : 'none', value: f.hit ? `浸水想定区域に重なる（最大 ${f.label}。範囲の ${f.share}%）` : OUT, short: f.hit ? `該当 最大${f.label}` : '外', src: SRC.flood,
      note: '想定最大規模。想定が作られていない川・内水は含まれない。' });
    const s = summarizeSlide(layers.slide, cells);
    rows.push({ key: 'slide', label: '土砂災害', status: s.hit ? 'hit' : 'none', value: s.hit ? `${s.zoneLabel}に重なる（${s.types.join('・')}。範囲の ${s.share}%）` : '警戒区域の外（概略。誤差 数百 m）', short: s.hit ? `該当 ${s.zone === 2 ? 'レッド' : 'イエロー'}` : '外', src: SRC.slide,
      note: '全ての警戒区域が指定済みとは限らない。重要事項説明の代わりにならない。' });
    const t = summarizeDepth(layers.tsunami, cells, data.labels.tsunami);
    rows.push({ key: 'tsunami', label: '津波', status: t.hit ? 'hit' : 'none', value: t.hit ? `浸水想定区域に重なる（最大 ${t.label}。範囲の ${t.share}%）` : OUT, short: t.hit ? `該当 最大${t.label}` : '外', src: SRC.tsunami, note: '' });
    const h = summarizeDepth(layers.surge, cells, data.labels.surge);
    rows.push({ key: 'surge', label: '高潮', status: h.hit ? 'hit' : 'none', value: h.hit ? `浸水想定区域に重なる（最大 ${h.label}。範囲の ${h.share}%）` : OUT, short: h.hit ? `該当 最大${h.label}` : '外', src: SRC.surge, note: '' });
    const n = summarizeInsar(layers.sub, cells);
    let nv, nshort, nstatus = 'info', nnote = '';
    if (!n.valid) { nv = '値がない（植生・水面などで衛星レーダーの値が取れない所）'; nshort = '値なし'; nstatus = 'nodata'; } else {
      const w = insarWords(n.range);
      nv = w.text + (n.mixed ? '。周囲で値が混在' : '');
      nshort = w.word;
      nnote = `干渉SARの階級 ${n.k + 1}/16（1 階級 ${INSAR_CLASS_W} mm/年）。`;
    }
    rows.push({ key: 'insar', label: '地盤の変動', sat: true, hint: '衛星レーダーで地面の上下を測る → 沈みやすさの手がかり', status: nstatus, value: nv, short: nshort, src: SRC.insar,
      note: nnote + '数百 m より狭い変動は読めない。0 をまたぐ近辺は沈下の兆候と言えない。炭鉱の採掘跡など原因は断定しない。' });
    const l = summarizeLst(layers.lst, cells);
    const p50 = data.stats.lst_p50;
    const cmpText = l.valid ? (l.median > p50 ? 'より高い' : l.median < p50 ? 'より低い' : 'と同じ') : '';
    rows.push({ key: 'lst', label: '冷却（夏の地表面温度）', sat: true, hint: '夏の地面の熱さ → 冷却の条件の参考（気温ではない）', status: l.valid ? 'info' : 'nodata',
      value: l.valid ? `${l.median.toFixed(1)} ℃（範囲の中央値 ${p50} ℃ ${cmpText}）。8/22 の1場面で、季節・時刻で変わる` : '値がない（雲など）', short: l.valid ? `${l.median.toFixed(1)} ℃` : '値なし', src: SRC.lst,
      note: `2026-08-22 の昼前の 1 場面。範囲全体の 10〜90% は ${data.stats.lst_p10}〜${data.stats.lst_p90} ℃。気温でも冷却の効率でもない。表面の種類（植生・裸地・建物）で大きく変わる。` });
    const ss = nearestSubstation(data.substations, lon, lat, 0), sh = nearestSubstation(data.substations, lon, lat, 66000), ln = nearestLine(data.lines, lon, lat);
    const subText = ss ? `変電所 ${fmtKm(ss.d)}${ss.s.name ? `（${ss.s.name}）` : ''}・${fmtVolt(ss.s.voltage)}` : '範囲内に OSM の変電所なし';
    const hv = sh && (!ss || sh.s !== ss.s) ? `／66 kV 以上の記載がある変電所 ${fmtKm(sh.d)}` : '';
    const lnText = ln ? `／送電線 ${fmtKm(ln.d)}（${fmtVolt(ln.l.v)}）` : '';
    rows.push({ key: 'power', label: '電力設備', status: 'info', value: subText + hv + lnText, short: ss ? `変電所 ${fmtKm(ss.d)}` : '変電所なし', src: SRC.sub,
      note: 'いずれも最寄りまでの直線距離。OSM は網羅的でない。変電所の空き容量・接続の可否は分からない（電力会社の確認が要る）。' });
    const d = summarizeLand(layers.land, layers.chg, cells);
    const parts = [1, 2, 3, 4, 5].filter((v) => d.share[v] > 0).sort((a, b) => d.share[b] - d.share[a]).map((v) => `${LAND[v]} ${d.share[v]}%`);
    rows.push({ key: 'land', label: '土地の状態', sat: true, hint: '衛星画像で今の土地と 2020 年からの変化 → 造成地・遊休地か', status: 'info',
      value: d.valid ? `${parts.join('・')}。2020→2026 に植生から裸地等へ ${d.changed}%` : '値がない（雲など）', short: d.valid ? parts[0] : '値なし', src: SRC.land,
      note: '裸地等は更地・造成地のほか、舗装・未登録の建物・採石場を含む。建物は OSM に登録された分だけ。' });
    return rows;
  }

  const api = {
    SCENES, SRC, LAND, FLOOD_RANK, SLIDE_ZONE, SLIDE_TYPE, CLICK_RADIUS_M, INSAR_CLASS_W,
    insarRange, lstFromCode, decodeRle, gridOf, cellOf, cellCenter, haversine, distToSegment, pointInRing,
    cellsInRing, cellsInDisk, summarizeFlood, summarizeSlide, summarizeDepth, summarizeInsar, summarizeLst, summarizeLand,
    maxVoltage, nearestSubstation, nearestLine, fmtKm, fmtVolt, fmtRange, insarWords, buildChecks,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DCLib = api;
})(typeof self !== 'undefined' ? self : this);
