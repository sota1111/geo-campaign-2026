/* データセンター候補地の一次スクリーニング：格子の読み出し・確認項目の集計・優先値（ブラウザと node の両方で動く）
 * 「適地」の判定は作らない。地点（または候補地の範囲）ごとに、確認項目と出典を並べる。
 * 優先値は、利用者が決めた重みで 8 要素の「望ましさ（0〜1）」を平均した目安（2026-11-22 総司令官の指示で追加）。 */
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
    // 目立つ動き＝±3.75 mm/年の外（階級 7・8 以外）。沈下側・隆起側の格子数
    let sink = 0, rise = 0;
    classes.forEach(([c, n]) => { if (c < 7) sink += n; else if (c > 8) rise += n; });
    return { valid, share: pct(valid, cells.length), k, range: insarRange(k), classes, mixed: classes.length > 1,
      sink: pct(sink, valid), rise: pct(rise, valid), move: pct(sink + rise, valid) };
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
  /** 干渉SARの集計を言葉にする。±3.75 mm/年は検出の目安で、それより小さい動きは見分けられない（＝動いていないとは言えない） */
  function insarWords(n) {
    if (!n.move) return { word: '目立つ動きなし', text: `年${INSAR_CLASS_W}mm超の動きなし（それ未満は見分けられない）` };
    const dir = n.sink >= n.rise ? '沈下' : '隆起';
    return { word: `${dir}気味 ${n.move}%`, text: `範囲の${n.move}%で年${INSAR_CLASS_W}mm超の${dir}（最多の階級 ${fmtRange(n.range)}）` };
  }

  /** 確認項目の一覧。target = { lon, lat, cells } 。layers = decodeRle した格子
   *  各項目: label（項目名）・status・value（1行の値）・short（比べる表の短い値）・hint（衛星の項目だけ：何を見るか→何に使うか）・src・note */
  function buildChecks(data, layers, target) {
    const { lon, lat, cells } = target;
    const rows = [];
    const OUT = '区域の外（概略）';
    const f = summarizeFlood(layers.flood, cells);
    rows.push({ key: 'flood', label: '洪水', status: f.hit ? 'hit' : 'none', value: f.hit ? `最大 ${f.label}・範囲の${f.share}%` : OUT, short: f.hit ? `該当 最大${f.label}` : '外', src: SRC.flood,
      note: '位置の誤差は数百 m。想定最大規模。想定が作られていない川・内水は含まれない。' });
    const s = summarizeSlide(layers.slide, cells);
    rows.push({ key: 'slide', label: '土砂災害', status: s.hit ? 'hit' : 'none', value: s.hit ? `${s.zone === 2 ? 'レッド（特別警戒）' : 'イエロー（警戒）'}・${s.types.map((x) => x.replace('の崩壊', '')).join('・')}・範囲の${s.share}%` : OUT, short: s.hit ? `該当 ${s.zone === 2 ? 'レッド' : 'イエロー'}` : '外', src: SRC.slide,
      note: '位置の誤差は数百 m。全ての警戒区域が指定済みとは限らない。重要事項説明の代わりにならない。' });
    const t = summarizeDepth(layers.tsunami, cells, data.labels.tsunami);
    rows.push({ key: 'tsunami', label: '津波', status: t.hit ? 'hit' : 'none', value: (t.hit ? `最大 ${t.label}・範囲の${t.share}%` : OUT) + '・2016年版', short: t.hit ? `該当 最大${t.label}` : '外', src: SRC.tsunami, note: '位置の誤差は数百 m。' });
    const h = summarizeDepth(layers.surge, cells, data.labels.surge);
    rows.push({ key: 'surge', label: '高潮', status: h.hit ? 'hit' : 'none', value: h.hit ? `最大 ${h.label}・範囲の${h.share}%` : OUT, short: h.hit ? `該当 最大${h.label}` : '外', src: SRC.surge, note: '位置の誤差は数百 m。' });
    const n = summarizeInsar(layers.sub, cells);
    let nv, nshort, nstatus = 'info', nnote = '';
    if (!n.valid) { nv = '値なし（植生・水面など）'; nnote = '植生・水面などでは衛星レーダーの値が取れない。'; nshort = '値なし'; nstatus = 'nodata'; } else {
      const w = insarWords(n);
      nv = w.text; nshort = w.word;
      nnote = `最も多い階級 ${n.k + 1}/16（1 階級 ${INSAR_CLASS_W} mm/年）。動きがないことの保証ではなく、現地確認が要る。`;
    }
    rows.push({ key: 'insar', label: '地盤の変動', sat: true, hint: '衛星レーダーで、地面が年に何 mm 上下したかを見る → 沈みやすさの手がかり。現地確認が要る', status: nstatus, value: nv, short: nshort, src: SRC.insar,
      note: nnote + '数百 m より狭い変動は読めない。0 をまたぐ近辺は沈下の兆候と言えない。炭鉱の採掘跡など原因は断定しない。' });
    const l = summarizeLst(layers.lst, cells);
    const p50 = data.stats.lst_p50;
    const cmpText = l.valid ? (l.median > p50 ? '周りより高い' : l.median < p50 ? '周りより低い' : '周りと同じ') : '';
    rows.push({ key: 'lst', label: '地表面温度', sat: true, hint: '夏の日中の地面の熱さ（気温・冷却の可否そのものではない）', status: l.valid ? 'info' : 'nodata',
      value: l.valid ? `${l.median.toFixed(1)}℃・${cmpText}（8/22の1場面）` : '値がない（雲など）', short: l.valid ? `${l.median.toFixed(1)} ℃` : '値なし', num: l.valid ? l.median : null, src: SRC.lst,
      note: `2026-08-22 の昼前の 1 場面で、季節・時刻で変わる。範囲の中央値は ${p50} ℃、範囲全体の 10〜90% は ${data.stats.lst_p10}〜${data.stats.lst_p90} ℃。気温でも冷却の効率でもない。表面の種類（植生・裸地・建物）で大きく変わる。` });
    const ss = nearestSubstation(data.substations, lon, lat, 0), sh = nearestSubstation(data.substations, lon, lat, 66000), ln = nearestLine(data.lines, lon, lat);
    const subText = ss ? `変電所 ${fmtKm(ss.d)}・${fmtVolt(ss.s.voltage)}` : '範囲内に OSM の変電所なし';
    // 1 行に収める：最寄りの変電所と送電線の距離だけ。66 kV 以上の変電所・送電線の電圧は出典欄へ
    const hv = sh && (!ss || sh.s !== ss.s) ? `66 kV以上の変電所 ${fmtKm(sh.d)}。` : '';
    const lnText = ln ? `／送電線 ${fmtKm(ln.d)}` : '';
    rows.push({ key: 'power', label: '電力設備（OSM）', status: 'info', value: subText + lnText, short: ss ? `変電所 ${fmtKm(ss.d)}` : '変電所なし', src: SRC.sub,
      note: (ss && ss.s.name ? `最寄りの変電所：${ss.s.name}。` : '') + hv + (ln ? `最寄りの送電線は ${fmtVolt(ln.l.v)}。` : '') + 'いずれも最寄りまでの直線距離。OSM は網羅的でない。変電所の空き容量・接続の可否は分からない（電力会社の確認が要る）。' });
    const d = summarizeLand(layers.land, layers.chg, cells);
    const parts = [1, 2, 3, 4, 5].filter((v) => d.share[v] > 0).sort((a, b) => d.share[b] - d.share[a]).map((v) => `${LAND[v]} ${d.share[v]}%`);
    rows.push({ key: 'land', label: '土地の状態', sat: true, hint: '衛星画像で、いま何があるか・2020 年から植生が裸地等に変わったかを見る → 造成地・遊休地か', status: 'info',
      value: d.valid ? `${parts.join('・')}${d.changed ? `（植生→裸地等 2020→26年：${d.changed}%）` : ''}` : '値がない（雲など）', short: d.valid ? parts[0] : '値なし', src: SRC.land,
      note: '裸地等は更地・造成地のほか、舗装・未登録の建物・採石場を含む。建物は OSM に登録された分だけ。' });
    return rows;
  }


  // ---- 優先値（利用者の重みによる一次スクリーニングの目安。適地の判定ではない）----
  // 8 要素それぞれを 0〜1 の「望ましさ」に直し、重み付き平均を 0〜100 にする。しきい値は公的な基準が見つからないので、すべて仮置き。
  const FACTOR_KEYS = ['flood', 'slide', 'tsunami', 'surge', 'insar', 'lst', 'power', 'land'];
  const FACTOR_LABEL = { flood: '洪水', slide: '土砂', tsunami: '津波', surge: '高潮', insar: '地盤', lst: '温度', power: '電力', land: '土地' };
  const FACTOR_LONG = { flood: '洪水の区域', slide: '土砂災害の区域', tsunami: '津波の区域', surge: '高潮の区域', insar: '地盤の変動（干渉SAR）', lst: '夏の地表面温度', power: '変電所までの距離', land: '土地の状態と変化' };
  const PRI = {
    B: 10,               // 優先値の格子 = 元の格子 10×10（約 250 m 四方）
    insarFree: 3.75,     // mm/年。この範囲内の動きは見分けられない → 望ましさ 1
    insarZero: 15,       // mm/年。これ以上の動き → 望ましさ 0（間は直線）
    powerNear: 500,      // m。これ以内 → 1
    powerFar: 5000,      // m。これ以上 → 0（間は直線）
    exclude: 0.5,        // 「災害区域を除外」の切替が入った時、4 種のどれかの区域が格子の半分以上なら除外
    land: { 1: 0.2, 2: 0.8, 3: 0.3, 4: 0, 5: 0.6 }, // 植生・裸地等・建物・水・草地等
    landChanged: 1,      // 2020 植生 → 2026 裸地等（造成の跡）
    defaultWeight: 5,    // 0〜10。初期値は全要素で同じ（均等）
  };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const defaultWeights = () => Object.fromEntries(FACTOR_KEYS.map((k) => [k, PRI.defaultWeight]));
  /** 干渉SARの符号（1〜16）→ 望ましさ。動きの外縁が ±3.75 mm/年以内なら 1、±15 mm/年以上なら 0。沈下・隆起とも同じ */
  function insarDesir(code) {
    const [lo, hi] = insarRange(code - 1);
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    return clamp01(1 - (m - PRI.insarFree) / (PRI.insarZero - PRI.insarFree));
  }
  /** 地表面温度（℃）→ 望ましさ。範囲全体の 10 パーセンタイルで 1、90 パーセンタイルで 0（低いほど高い） */
  const lstDesir = (t, p10, p90) => clamp01((p90 - t) / (p90 - p10));
  /** 最寄りの変電所までの距離（m）→ 望ましさ。500 m 以内で 1、5 km 以上で 0 */
  const powerDesir = (d) => clamp01((PRI.powerFar - d) / (PRI.powerFar - PRI.powerNear));

  /** 範囲（cells）の 8 要素の望ましさ。値が取れない要素は null（優先値の計算から外す）。hz = 4 種の区域のどれかが占める割合の最大 */
  function factorsOfCells(data, layers, cells, lon, lat) {
    const n = cells.length, f = {};
    const share = (arr, mask) => { let h = 0; for (const k of cells) if (arr[k] & mask) h++; return n ? h / n : 0; };
    const sFlood = share(layers.flood, 255), sSlide = share(layers.slide, 3), sTsu = share(layers.tsunami, 255), sSurge = share(layers.surge, 255);
    f.flood = n ? 1 - sFlood : null; f.slide = n ? 1 - sSlide : null; f.tsunami = n ? 1 - sTsu : null; f.surge = n ? 1 - sSurge : null;
    f.hz = Math.max(sFlood, sSlide, sTsu, sSurge);
    let s = 0, c = 0;
    for (const k of cells) { const v = layers.sub[k]; if (v) { s += insarDesir(v); c++; } }
    f.insar = c ? s / c : null;
    const { lst_p10: p10, lst_p90: p90 } = data.stats;
    s = 0; c = 0;
    for (const k of cells) { const v = layers.lst[k]; if (v) { s += lstDesir(lstFromCode(v), p10, p90); c++; } }
    f.lst = c ? s / c : null;
    const ss = nearestSubstation(data.substations, lon, lat, 0);
    f.power = ss ? powerDesir(ss.d) : null;
    s = 0; c = 0;
    for (const k of cells) { const v = layers.land[k]; if (v) { s += layers.chg[k] ? PRI.landChanged : (PRI.land[v] ?? 0); c++; } }
    f.land = c ? s / c : null;
    return f;
  }

  /** 重み付き平均（0〜100）。重み 0 の要素と値のない要素は計算から外す。全て外れれば value = null。
   *  opts.exclude が真で、災害区域が範囲の半分以上なら除外（value = null, excluded = true） */
  function priorityOf(f, weights, opts) {
    const parts = [];
    let sw = 0, s = 0;
    for (const k of FACTOR_KEYS) {
      const w = Math.max(0, Number(weights[k]) || 0), v = f[k];
      const used = w > 0 && v != null;
      if (used) { sw += w; s += w * v; }
      parts.push({ key: k, w, f: v, used });
    }
    if (opts && opts.exclude && f.hz >= PRI.exclude) return { value: null, excluded: true, parts, sumW: sw };
    if (!sw) return { value: null, excluded: false, parts, sumW: 0 };
    parts.forEach((p) => { p.contrib = p.used ? (100 * p.w * p.f) / sw : 0; });
    return { value: (100 * s) / sw, excluded: false, parts, sumW: sw };
  }

  /** 対象範囲全体の格子（B×B 個の元の格子ごと）の望ましさ。重みに依らないので 1 回だけ作る */
  function buildFactorGrid(data, layers, B) {
    B = B || PRI.B;
    const g = data.grid, nbx = Math.ceil(g.nx / B), nby = Math.ceil(g.ny / B), nb = nbx * nby;
    const F = new Float32Array(nb * FACTOR_KEYS.length).fill(NaN), HZ = new Float32Array(nb);
    for (let bi = 0; bi < nby; bi++) for (let bj = 0; bj < nbx; bj++) {
      const cells = blockCells(g, B, bi, bj);
      const [lon, lat] = blockCenter(g, B, bi, bj);
      const f = factorsOfCells(data, layers, cells, lon, lat), b = bi * nbx + bj;
      FACTOR_KEYS.forEach((k, q) => { if (f[k] != null) F[b * FACTOR_KEYS.length + q] = f[k]; });
      HZ[b] = f.hz;
    }
    return { B, nbx, nby, F, HZ };
  }
  function blockCells(g, B, bi, bj) {
    const out = [];
    for (let i = bi * B; i < Math.min(g.ny, (bi + 1) * B); i++) for (let j = bj * B; j < Math.min(g.nx, (bj + 1) * B); j++) out.push(i * g.nx + j);
    return out;
  }
  const blockCenter = (g, B, bi, bj) => [g.w + (Math.min(g.nx, (bj + 1) * B) + bj * B) / 2 * g.d, g.n - (Math.min(g.ny, (bi + 1) * B) + bi * B) / 2 * g.d];
  /** 地点が入る格子の位置 */
  function blockOf(g, B, lon, lat) {
    const c = cellOf(g, lon, lat);
    return c ? { bi: Math.floor(c.i / B), bj: Math.floor(c.j / B) } : null;
  }
  /** 格子ごとの優先値。値なし = NaN、除外 = -1 */
  function priorityGrid(fg, weights, opts) {
    const K = FACTOR_KEYS.length, nb = fg.nbx * fg.nby, out = new Float32Array(nb);
    const w = FACTOR_KEYS.map((k) => Math.max(0, Number(weights[k]) || 0));
    for (let b = 0; b < nb; b++) {
      if (opts && opts.exclude && fg.HZ[b] >= PRI.exclude) { out[b] = -1; continue; }
      let sw = 0, s = 0;
      for (let q = 0; q < K; q++) { const v = fg.F[b * K + q]; if (w[q] > 0 && !Number.isNaN(v)) { sw += w[q]; s += w[q] * v; } }
      out[b] = sw ? (100 * s) / sw : NaN;
    }
    return out;
  }
  /** 色の段階の境界。今の重みでの全格子の値を 5 等分した 4 つの境界（色は対象範囲の中での相対。値の範囲は凡例に出す） */
  function priEdges(vals) {
    const v = Array.from(vals).filter((x) => x >= 0).sort((a, b) => a - b); // NaN（値なし）と -1（除外）を除く
    if (!v.length) return [0, 0, 0, 0];
    return [0.2, 0.4, 0.6, 0.8].map((q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]);
  }
  /** 段階 0〜4（境界以上なら上の段階） */
  const priBin = (v, edges) => edges.filter((e) => v >= e).length;

  const api = {
    FACTOR_KEYS, FACTOR_LABEL, FACTOR_LONG, PRI, priEdges, priBin, clamp01, defaultWeights, insarDesir, lstDesir, powerDesir, factorsOfCells, priorityOf, buildFactorGrid, blockCells, blockCenter, blockOf, priorityGrid,
    SCENES, SRC, LAND, FLOOD_RANK, SLIDE_ZONE, SLIDE_TYPE, CLICK_RADIUS_M, INSAR_CLASS_W,
    insarRange, lstFromCode, decodeRle, gridOf, cellOf, cellCenter, haversine, distToSegment, pointInRing,
    cellsInRing, cellsInDisk, summarizeFlood, summarizeSlide, summarizeDepth, summarizeInsar, summarizeLst, summarizeLand,
    maxVoltage, nearestSubstation, nearestLine, fmtKm, fmtVolt, fmtRange, insarWords, buildChecks,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DCLib = api;
})(typeof self !== 'undefined' ? self : this);
