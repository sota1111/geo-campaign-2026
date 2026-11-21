/* 23区、値段の年表: 画面の純ロジック（DOM・通信に触れない。node のテストからも使う）。
 * データ: data/price.json（tools/fetch.mjs の出力）、data/rent.json（tools/fetch-rent.mjs）、data/wards.json（tools/build-boundaries.mjs）。 */
(function (root) {
  'use strict';

  // ---- 利用規約が求める表示（不動産情報ライブラリ https://www.reinfolib.mlit.go.jp/help/termsOfUse/ ／ 統計ダッシュボードAPI https://dashboard.e-stat.go.jp/static/api の文言。変えない） ----
  const URL_LIB = 'https://www.reinfolib.mlit.go.jp/';
  const CREDIT = 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません';
  const ATTRIBUTION = '出典：国土交通省　不動産情報ライブラリ（' + URL_LIB + '）';
  const PROCESSED = '「不動産価格（取引価格）情報」（国土交通省）の「中古マンション等」の記録を、作成者が23区・四半期ごとに集計（中央値・四分位）して作成';
  const CREDIT_ESTAT = 'このサービスは、統計ダッシュボードのAPI機能を使用していますが、サービスの内容は国によって保証されたものではありません';
  const ATTRIBUTION_RENT = '出典：総務省統計局「社会・人口統計体系」（基は総務省「住宅・土地統計調査」）。政府統計の総合窓口（e-Stat）の統計ダッシュボードから取得し、作成者が23区の「専用住宅の1畳当たり家賃」を抜き出して作成';
  const ATTRIBUTION_MAP = '地図は国土地理院タイル（淡色地図）。区の境界は国土数値情報 行政区域データ（国土交通省）を加工して作成';
  const RESPONSIBILITY = 'このアプリは作成者が開発・運営し、表示内容の責任は作成者が負います（国が作成・監修したものではありません）。表示は過去の取引・調査の集計で、将来の値動きや個別の物件の価格を示すものではありません';
  const NOTICE = '区ごとの過去の集計であり、特定の物件の価格や将来の値動きを示すものではありません';

  const LOW_N_DEFAULT = 30;
  const NODATA = 'データなし';

  // ---- 色の階級（固定。時間を動かしても同じ色が同じ値段を指す。色だけに頼らず、区に値と階級の数字も出す） ----
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
  function classLabel(i, breaks, unit) {
    const f = (x) => x.toLocaleString('ja-JP');
    if (i === 0) return f(breaks[0]) + '未満';
    if (i === breaks.length) return f(breaks[i - 1]) + '以上';
    return f(breaks[i - 1]) + '〜' + f(breaks[i]) + '未満';
  }

  // ---- 時間 ----
  /** "2018Q3" → "2018年 第3四半期" */
  function quarterLabel(k) { const m = /^(\d{4})Q([1-4])$/.exec(k); return m ? m[1] + '年 第' + m[2] + '四半期' : String(k); }
  function quarterMonths(k) { const m = /^(\d{4})Q([1-4])$/.exec(k); return m ? m[1] + '年' + (m[2] * 3 - 2) + '〜' + m[2] * 3 + '月' : ''; }
  /** 家賃の調査（毎回10月1日時点）のうち、その四半期の終わりまでに行われた最新の調査年。無ければ null。
   *  Q4（10〜12月）はその年の調査（10/1）を含む。 */
  function surveyYearFor(k, years) {
    const m = /^(\d{4})Q([1-4])$/.exec(k);
    if (!m) return null;
    const y = Number(m[1]), q = Number(m[2]);
    let best = null;
    for (const s of years) { const sy = Number(s); if (sy < y || (sy === y && q === 4)) best = best === null || sy > Number(best) ? String(s) : best; }
    return best;
  }

  // ---- 値の取り出し ----
  /** マンション価格: その区・四半期の {n, unit, p25, p75, total, area, age, low}。無ければ null */
  function priceAt(price, code, qi) {
    const r = price.wards[code]?.[qi];
    if (!r) return null;
    const lowN = price.filter?.lowN ?? LOW_N_DEFAULT;
    return { n: r[0], unit: r[1], p25: r[2], p75: r[3], total: r[4], area: r[5], age: r[6], low: r[0] < lowN };
  }
  /** 家賃: 四半期 k に当てる調査の値。{year, value} か null */
  function rentAt(rent, code, k) {
    const sy = surveyYearFor(k, rent.years);
    if (sy === null) return null;
    const v = rent.wards[code]?.[rent.years.indexOf(sy)];
    return v === null || v === undefined ? null : { year: sy, value: v };
  }
  /** 地図の1区ぶんの表示値: {value, low, n, cls, note} */
  function cellFor(mode, data, code, qi) {
    const br = MODES[mode].breaks;
    if (mode === 'price') {
      const p = priceAt(data.price, code, qi);
      if (!p) return { value: null, low: false, n: 0, cls: -1 };
      return { value: p.unit, low: p.low, n: p.n, cls: classOf(p.unit, br) };
    }
    const r = rentAt(data.rent, code, data.price.quarters[qi]);
    return r ? { value: r.value, low: false, n: null, cls: classOf(r.value, br), year: r.year } : { value: null, low: false, n: null, cls: -1 };
  }
  /** 順位表: 値のある区を値の大きい順に */
  function ranking(mode, data, qi) {
    const rows = data.wards.map((w) => ({ code: w.code, name: w.name, ...cellFor(mode, data, w.code, qi) })).filter((r) => r.value !== null);
    return rows.sort((a, b) => b.value - a.value);
  }

  // ---- 幾何 ----
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** 経度・緯度が入る区（無ければ null） */
  function wardAt(wards, lon, lat) {
    for (const w of wards) for (const ring of w.polys) if (pointInRing(lon, lat, ring)) return w;
    return null;
  }
  function boundsOf(wards) {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const w of wards) for (const ring of w.polys) for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  }
  /** 区の最大の多角形の中心（ラベルを置く位置。外周の重心ではなく外接箱の中心に近い点） */
  function labelPoint(w) {
    let best = null, area = -1;
    for (const ring of w.polys) {
      let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
      for (const [x, y] of ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const a = (x1 - x0) * (y1 - y0);
      if (a > area) { area = a; best = { lon: (x0 + x1) / 2, lat: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 }; }
    }
    return best;
  }

  // ---- グラフ（SVG の座標を計算するだけ） ----
  /** 値の並び（null は線が切れる）から path の d を作る */
  function linePath(pts) {
    let d = '', pen = false;
    for (const p of pts) {
      if (p === null) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
      pen = true;
    }
    return d;
  }
  /** 四分位の帯の path（上辺を進み下辺を戻る）。null で途切れる区間ごとに別の帯 */
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
  /** 目盛り（見やすい刻み）を最大 n 本 */
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
  function priceText(p) {
    if (!p) return NODATA;
    return fmt(p.unit, p.unit < 100 ? 1 : 0) + '万円/㎡';
  }
  /** 地図の読み上げ・title 用の1行 */
  function cellText(mode, name, c) {
    if (c.value === null) return name + ' ' + NODATA;
    const m = MODES[mode];
    const base = name + ' ' + fmt(c.value, mode === 'price' && c.value < 100 ? 1 : 0) + m.unit;
    return mode === 'price' ? base + '（' + c.n + '件' + (c.low ? '・件数が少ない' : '') + '）' : base + '（' + c.year + '年10月の調査）';
  }
  function lowText(n, lowN) { return '件数が少ない（' + n + '件。' + lowN + '件未満）ので、中央値は大きくぶれることがあります'; }

  function validate(price, rent, wards) {
    if (!price || !Array.isArray(price.quarters) || !price.wards || !price.quarters.length) return null;
    if (!rent || !Array.isArray(rent.years) || !rent.wards) return null;
    if (!wards || !Array.isArray(wards.wards) || wards.wards.length !== 23) return null;
    for (const w of wards.wards) if (!Array.isArray(price.wards[w.code]) || price.wards[w.code].length !== price.quarters.length) return null;
    return { price, rent, wards: wards.wards };
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const api = { URL_LIB, CREDIT, ATTRIBUTION, PROCESSED, CREDIT_ESTAT, ATTRIBUTION_RENT, ATTRIBUTION_MAP, RESPONSIBILITY, NOTICE, NODATA, LOW_N_DEFAULT, PALETTE, MODES, classOf, classLabel, quarterLabel, quarterMonths, surveyYearFor, priceAt, rentAt, cellFor, ranking, pointInRing, wardAt, boundsOf, labelPoint, linePath, bandPath, niceTicks, fmt, priceText, cellText, lowText, validate, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);
