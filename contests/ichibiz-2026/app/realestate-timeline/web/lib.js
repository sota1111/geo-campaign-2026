/* 23区、値段の年表: 画面の純ロジック（DOM・通信に触れない。node のテストからも使う）。
 * データ: data/price-districts.json（tools/fetch.mjs。地区×間取り×年）、data/detail/<区コード>.json（同。四分位など。クリックした区だけ読む）、
 *         data/rent.json（tools/fetch-rent.mjs。区別の家賃）、data/districts.json（tools/build-districts.py。地区と区の境界）。 */
(function (root) {
  'use strict';

  // ---- 利用規約が求める表示（不動産情報ライブラリ https://www.reinfolib.mlit.go.jp/help/termsOfUse/ ／ 統計ダッシュボードAPI https://dashboard.e-stat.go.jp/static/api ／ e-Stat 利用規約 https://www.e-stat.go.jp/terms-of-use の文言。変えない） ----
  const URL_LIB = 'https://www.reinfolib.mlit.go.jp/';
  const CREDIT = 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません';
  const ATTRIBUTION = '出典：国土交通省　不動産情報ライブラリ（' + URL_LIB + '）';
  const PROCESSED = '「不動産価格（取引価格）情報」（国土交通省）の「中古マンション等」の記録を、作成者が地区名・間取り・年（直近5年の窓）ごとに集計（中央値・四分位）して作成';
  const CREDIT_ESTAT = 'このサービスは、統計ダッシュボードのAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません';
  const ATTRIBUTION_RENT = '出典：総務省統計局「社会・人口統計体系」（基は総務省「住宅・土地統計調査」）。政府統計の総合窓口（e-Stat）の統計ダッシュボードから取得し、作成者が23区の「専用住宅の1畳当たり家賃」を抜き出して作成';
  const ATTRIBUTION_BOUNDARY = '出典：政府統計の総合窓口(e-Stat)（https://www.e-stat.go.jp/）。「国勢調査 小地域（町丁・字等）境界データ」（2020年・東京都）（総務省統計局）を加工して作成（町丁目を町名ごとに束ね、境界を簡略化）。国が作成したものではありません';
  const ATTRIBUTION_MAP = '地図は国土地理院タイル（淡色地図）';
  const RESPONSIBILITY = 'このアプリは作成者が開発・運営し、表示内容の責任は作成者が負います（国が作成・監修したものではありません）。表示は過去の取引・調査の集計で、将来の値動きや個別の物件の価格を示すものではありません';
  const NOTICE = '地区ごとの過去の集計であり、特定の物件の価格や将来の値動きを示すものではありません';

  const LOW_N_DEFAULT = 10, MIN_N_DEFAULT = 3;
  const NODATA = 'データなし';

  // ---- 色の階級（固定。時間・間取りを変えても同じ色が同じ値段。色だけに頼らず、数字も出す） ----
  const PALETTE = ['#ffffcc', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#0c2c84'];
  const MODES = {
    price: { key: 'price', label: 'マンション価格', unit: '万円/㎡', long: '中古マンション等の ㎡単価（中央値）', breaks: [40, 60, 80, 100, 130, 170], digits: 0 },
    rent: { key: 'rent', label: '家賃', unit: '円/畳', long: '借家の1畳当たり家賃', breaks: [4500, 5000, 5500, 6000, 7000, 8000], digits: 0 },
  };

  /** 値が属する階級（0〜breaks.length）。値なしは -1 */
  function classOf(v, breaks) {
    if (v === null || v === undefined || !Number.isFinite(v)) return -1;
    let i = 0;
    while (i < breaks.length && v >= breaks[i]) i++;
    return i;
  }
  function classLabel(i, breaks) {
    const f = (x) => x.toLocaleString('ja-JP');
    if (i === 0) return f(breaks[0]) + '未満';
    if (i === breaks.length) return f(breaks[i - 1]) + '以上';
    return f(breaks[i - 1]) + '〜' + f(breaks[i]) + '未満';
  }

  // ---- 時間（年。その年を末尾とする直近 windowYears 年の取引） ----
  const qParse = (k) => { const m = /^(\d{4})Q([1-4])$/.exec(k || ''); return m ? { y: Number(m[1]), q: Number(m[2]) } : null; };
  /** 窓の表示。例: 2022〜2026年（2026年は6月まで）。最初の窓は取引価格の公開開始（2005年第3四半期）から */
  function windowLabel(price, yi) {
    const y = price.years[yi], w = price.filter.windowYears, f = qParse(price.firstQuarter), l = qParse(price.lastQuarter);
    let start = y - w + 1 + '年', end = y + '年';
    if (f && y - w + 1 < f.y) start = f.y + '年第' + f.q + '四半期';
    else if (f && y - w + 1 === f.y && f.q > 1) start = f.y + '年第' + f.q + '四半期';
    if (l && y === l.y && l.q < 4) end = y + '年' + l.q * 3 + '月';
    return start + '〜' + end;
  }
  const windowShort = (price, yi) => price.years[yi] + '年';
  /** 家賃: その年の末までに行われた最新の調査（調査は各回10月1日時点）。無ければ null */
  function surveyYearFor(y, years) {
    let best = null;
    for (const s of years) if (Number(s) <= y && (best === null || Number(s) > Number(best))) best = String(s);
    return best;
  }

  // ---- 値の取り出し ----
  /** 地区×間取り×年のセル。state: none（0件）／few（minN 未満。中央値は出さない）／low（lowN 未満）／ok */
  function districtCell(price, code, pname, pi, yi) {
    const arr = pname ? price.districts[code]?.[pname]?.[pi] : null;
    const n = arr ? arr[2 * yi] : 0, u = arr ? arr[2 * yi + 1] : 0;
    const lowN = price.filter.lowN, minN = price.filter.minN;
    const state = n === 0 ? 'none' : n < minN ? 'few' : n < lowN ? 'low' : 'ok';
    const value = state === 'low' || state === 'ok' ? u : null;
    return { n, value, state, low: state === 'low', cls: value === null ? -1 : classOf(value, MODES.price.breaks) };
  }
  function wardCell(price, code, pi, yi) {
    const r = price.wards[code]?.[pi]?.[yi];
    if (!r) return null;
    const [n, unit, p25, p75, age, area] = r;
    const state = n < price.filter.minN ? 'few' : n < price.filter.lowN ? 'low' : 'ok';
    return { n, unit: state === 'few' ? null : unit, p25, p75, age: age < 0 ? null : age, area, state };
  }
  /** 詳細（四分位・築年数・面積）。detail は data/detail/<区コード>.json の中身 */
  function detailAt(detail, pname, pi, yi) {
    const arr = detail?.districts?.[pname]?.[pi];
    if (!arr) return null;
    const [p25, p75, age, area] = arr.slice(4 * yi, 4 * yi + 4);
    return p75 ? { p25, p75, age: age < 0 ? null : age, area } : null;
  }
  /** 家賃: 区×年。{year(調査年), value} か null */
  function rentAt(rent, code, y) {
    const sy = surveyYearFor(y, rent.years);
    if (sy === null) return null;
    const v = rent.wards[code]?.[rent.years.indexOf(sy)];
    return v === null || v === undefined ? null : { year: sy, value: v };
  }
  /** 地図の1地区（価格）または1区（家賃）の表示値: {value, state, n, cls} */
  function cellFor(mode, D, ent, pi, yi) {
    if (mode === 'price') return districtCell(D.price, ent.code, ent.pname, pi, yi);
    const r = rentAt(D.rent, ent.code, D.price.years[yi]);
    return r ? { value: r.value, state: 'ok', n: null, cls: classOf(r.value, MODES.rent.breaks), year: r.year } : { value: null, state: 'none', n: null, cls: -1 };
  }
  /** いまの間取り・年で、境界のある地区の状態の数 */
  function stateCounts(D, pi, yi) {
    const c = { ok: 0, low: 0, few: 0, none: 0, total: D.districts.length };
    for (const d of D.districts) c[districtCell(D.price, d.code, d.pname, pi, yi).state]++;
    return c;
  }
  /** 順位表: 件数が lowN 以上の地区を値の大きい順に */
  function ranking(D, pi, yi) {
    const rows = [];
    for (const d of D.districts) { const c = districtCell(D.price, d.code, d.pname, pi, yi); if (c.state === 'ok') rows.push({ d, ...c }); }
    return rows.sort((a, b) => b.value - a.value);
  }
  function wardRanking(D, yi) {
    return D.wards.map((w) => ({ w, ...cellFor('rent', D, w, 0, yi) })).filter((r) => r.value !== null).sort((a, b) => b.value - a.value);
  }

  // ---- 境界（差分符号化 → 経度・緯度） ----
  function decodeRings(flat, geo) {
    const [ox, oy] = geo.origin, q = geo.q;
    return flat.map((r) => {
      const out = []; let x = 0, y = 0;
      for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; out.push([ox + x / q, oy + y / q]); }
      return out;
    });
  }
  function bboxOfRings(rings) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const r of rings) for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  }
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** 穴のある図形（外周と穴が混ざった輪の並び）の内外。偶奇で判定 */
  function pointInRings(x, y, rings) {
    let n = 0;
    for (const r of rings) if (pointInRing(x, y, r)) n++;
    return n % 2 === 1;
  }
  const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return s / 2; };
  /** 名前を置く点: 最大の輪の重心（図形の外に出るなら外接箱の中心）。w・h は外接箱（度） */
  function labelPoint(rings, bbox) {
    const b = bbox || bboxOfRings(rings);
    let best = null, area = 0;
    for (const r of rings) { const a = Math.abs(ringArea(r)); if (a > area) { area = a; best = r; } }
    let lon = (b.x0 + b.x1) / 2, lat = (b.y0 + b.y1) / 2;
    if (best && area > 0) {
      let cx = 0, cy = 0, s = 0;
      for (let i = 0; i < best.length - 1; i++) { const c = best[i][0] * best[i + 1][1] - best[i + 1][0] * best[i][1]; s += c; cx += (best[i][0] + best[i + 1][0]) * c; cy += (best[i][1] + best[i + 1][1]) * c; }
      if (s) { const px = cx / (3 * s), py = cy / (3 * s); if (pointInRings(px, py, rings)) { lon = px; lat = py; } }
    }
    if (!pointInRings(lon, lat, rings)) { // 細長い・曲がった形: 緯度の中央を横切る線のうち、いちばん長い内側の区間の中点
      for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
        const y = b.y0 + (b.y1 - b.y0) * f, xs = [];
        for (const r of rings) for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)); }
        xs.sort((p, q) => p - q);
        let bestW = -1;
        for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bestW) { bestW = xs[i + 1] - xs[i]; lon = (xs[i] + xs[i + 1]) / 2; lat = y; }
        if (bestW > 0 && pointInRings(lon, lat, rings)) break;
      }
    }
    return { lon, lat, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }
  const inBox = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
  function districtAt(D, lon, lat) {
    for (const d of D.districts) if (inBox(d.bbox, lon, lat) && pointInRings(lon, lat, d.rings)) return d;
    return null;
  }
  function wardAt(D, lon, lat) {
    for (const w of D.wards) if (inBox(w.bbox, lon, lat) && pointInRings(lon, lat, w.rings)) return w;
    return null;
  }
  function boundsOf(items) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const it of items) { const b = it.bbox; if (b.x0 < x0) x0 = b.x0; if (b.x1 > x1) x1 = b.x1; if (b.y0 < y0) y0 = b.y0; if (b.y1 > y1) y1 = b.y1; }
    return { x0, y0, x1, y1 };
  }

  // ---- グラフ（SVG の座標を計算するだけ） ----
  function linePath(pts) {
    let d = '', pen = false;
    for (const p of pts) {
      if (p === null) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      pen = true;
    }
    return d;
  }
  function bandPath(top, bottom) {
    let d = '', run = [];
    const flush = () => {
      if (run.length > 1) {
        d += 'M' + run.map((i) => top[i].x.toFixed(1) + ' ' + top[i].y.toFixed(1)).join('L');
        d += 'L' + [...run].reverse().map((i) => bottom[i].x.toFixed(1) + ' ' + bottom[i].y.toFixed(1)).join('L') + 'Z';
      }
      run = [];
    };
    top.forEach((p, i) => { if (p === null || bottom[i] === null) flush(); else run.push(i); });
    flush();
    return d;
  }
  function niceTicks(min, max, n) {
    if (!(max > min)) return [min];
    const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
    return out;
  }

  // ---- 文言 ----
  const fmt = (v, d = 0) => (v === null || v === undefined ? NODATA : Number(v).toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const stateWord = (c, minN) => (c.state === 'none' ? NODATA + '（0件）' : c.state === 'few' ? NODATA + '（' + c.n + '件のみ。' + minN + '件未満は中央値を出さない）' : c.state === 'low' ? '件数が少ない' : '');
  /** 地図の読み上げ・選択行用の1行 */
  function cellText(mode, name, c, price) {
    if (mode === 'rent') return c.value === null ? name + ' ' + NODATA : name + ' ' + fmt(c.value) + '円/畳（' + c.year + '年10月の調査。区の値）';
    if (c.value === null) return name + ' ' + stateWord(c, price?.filter?.minN ?? MIN_N_DEFAULT);
    return name + ' ' + fmt(c.value) + '万円/㎡（' + c.n + '件' + (c.low ? '・件数が少ない' : '') + '）';
  }
  function lowText(n, lowN) { return '件数が少ない（' + n + '件。' + lowN + '件未満）ので、中央値は大きくぶれることがあります'; }

  /** 3つのデータを突き合わせて検証し、画面が使う形にまとめる。壊れていれば null */
  function validate(price, rent, geo) {
    if (!price || !Array.isArray(price.years) || !price.years.length || !price.districts || !price.wards || !Array.isArray(price.plans) || !price.filter) return null;
    if (!rent || !Array.isArray(rent.years) || !rent.wards) return null;
    if (!geo || !Array.isArray(geo.wards) || geo.wards.length !== 23 || !Array.isArray(geo.districts) || !geo.origin) return null;
    const wards = geo.wards.map((w) => { const rings = decodeRings(w.p, geo); return { code: w.code, name: w.name, rings, bbox: bboxOfRings(rings), lp: null }; });
    for (const w of wards) w.lp = labelPoint(w.rings, w.bbox);
    const wname = new Map(wards.map((w) => [w.code, w.name]));
    const districts = geo.districts.map((d) => {
      const rings = decodeRings(d.p, geo), bbox = bboxOfRings(rings);
      return { key: d.code + '|' + d.name, code: d.code, ward: wname.get(d.code), name: d.name, pname: d.price, label: d.price ?? d.name, rings, bbox, lp: labelPoint(rings, bbox) };
    });
    for (const w of wards) if (!Array.isArray(price.wards[w.code]) || price.wards[w.code].length !== price.plans.length) return null;
    return { price, rent, geo, wards, districts, byKey: new Map(districts.map((d) => [d.key, d])), wardByCode: new Map(wards.map((w) => [w.code, w])) };
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const api = { URL_LIB, CREDIT, ATTRIBUTION, PROCESSED, CREDIT_ESTAT, ATTRIBUTION_RENT, ATTRIBUTION_BOUNDARY, ATTRIBUTION_MAP, RESPONSIBILITY, NOTICE, NODATA, LOW_N_DEFAULT, MIN_N_DEFAULT, PALETTE, MODES, classOf, classLabel, windowLabel, windowShort, surveyYearFor, districtCell, wardCell, detailAt, rentAt, cellFor, stateCounts, ranking, wardRanking, decodeRings, bboxOfRings, pointInRings, labelPoint, districtAt, wardAt, boundsOf, linePath, bandPath, niceTicks, fmt, stateWord, cellText, lowText, validate, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);
