// 計算ロジック（画面に依存しない）。ブラウザでは window.SugiLib、node では module.exports。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SugiLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
  const DEFAULTS = { radiusKm: 3, useWind: true, winterMin: 0.5, excludeWeak: false, sortKey: 'index' };
  // 冬NDVI のしきい値 0.5 は説明用の仮置き（根拠のある値ではない）。

  const rad = (d) => (d * Math.PI) / 180;
  // 近距離用の平面近似。dx=東、dy=北（m）。
  function offset(lat0, lon0, lat1, lon1) {
    const dy = (lat1 - lat0) * 111320 * 1; // 緯度1度 ≒ 111.3 km（近似）
    const dx = (lon1 - lon0) * 111320 * Math.cos(rad((lat0 + lat1) / 2));
    return { dx, dy, dist: Math.hypot(dx, dy) };
  }
  // 区画から見た人口セルの方位（北=0、時計回り、度）
  function bearing(dx, dy) { return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360; }
  // 風向は「風が吹いてくる方位」。区画から方位 b のセルは、風が b+180 から吹くとき風下。
  function windIndexFor(b) { return Math.round((((b + 180) % 360) / 22.5)) % 16; }
  function dirIndex(b) { return Math.round(b / 22.5) % 16; }
  function normFreq(freq) {
    const s = freq.reduce((a, b) => a + b, 0) || 1;
    return freq.map((f) => f / s);
  }

  // 1区画の評価。pop: [[lat, lon, 人口], ...]
  function evaluate(cell, pop, wind, p) {
    const rM = p.radiusKm * 1000, f = normFreq(wind.freq);
    let within = 0, down = 0;
    const byDir = new Array(16).fill(0); // 区画から見て各方位（16方位）にいる人口
    for (let i = 0; i < pop.length; i++) {
      const o = offset(cell.lat, cell.lon, pop[i][0], pop[i][1]);
      if (o.dist > rM) continue;
      const n = pop[i][2];
      within += n;
      const b = o.dist < 1 ? 0 : bearing(o.dx, o.dy);
      byDir[dirIndex(b)] += n;
      const wgt = p.useWind ? f[windIndexFor(b)] * 16 : 1; // 風向が一様なら 1
      down += n * wgt;
    }
    return { within, down, byDir };
  }

  // 全区画を評価して順位を付ける。
  function buildRows(data, params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const wind = data.meta.wind;
    const rows = data.cells.map((r) => {
      const cell = { code: r[0], ha: r[1], ndviW: r[2], ndviS: r[3], lat: r[4], lon: r[5] };
      const e = evaluate(cell, data.pop, wind, p);
      cell.within = Math.round(e.within);
      cell.down = Math.round(e.down);
      cell.index = Math.round(e.down * cell.ha);
      cell.perHa = cell.ha > 0 ? Math.round(e.down) / cell.ha : 0;
      cell.byDir = e.byDir;
      cell.weak = cell.ndviW == null ? null : cell.ndviW < p.winterMin;
      cell.diff = cell.ndviW != null && cell.ndviS != null ? Math.round((cell.ndviS - cell.ndviW) * 1000) / 1000 : null;
      return cell;
    });
    return rank(rows, p);
  }

  function rank(rows, p) {
    const key = p.sortKey === 'ha' ? 'ha' : p.sortKey === 'down' ? 'down' : 'index';
    let list = rows.slice();
    if (p.excludeWeak) list = list.filter((r) => r.weak !== true);
    list.sort((a, b) => b[key] - a[key] || (a.code < b.code ? -1 : 1));
    list.forEach((r, i) => { r.rank = i + 1; });
    rows.forEach((r) => { if (!list.includes(r)) r.rank = null; });
    return { rows, ranked: list, params: p };
  }

  // 衛星で見た状態のことば。しきい値以下は「要確認」、欠測は「判定不可」。
  function satStatus(r, winterMin) {
    if (r.ndviW == null) return '判定不可（雲など）';
    return r.ndviW < winterMin ? '要確認（冬の緑が弱い）' : '常緑の植生と整合';
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s; // 表計算ソフトでの式解釈を防ぐ
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const CSV_HEAD = ['順位', '区画（500mメッシュコード）', '中心緯度', '中心経度', 'スギ・ヒノキ・サワラ植林面積_ha', '半径内人口_人', '風下人口指数_人', '優先度指数_人・ha', '冬NDVI', '夏NDVI', '衛星での確認状態', '備考'];
  function toCsv(list, params, meta) {
    const note = '実データ（環境省 現存植生図2024／国勢調査2020 250mメッシュ／気象庁／Sentinel-2）の加工値。指数は説明用で花粉量・健康影響ではない。現地確認前の候補';
    const lines = [CSV_HEAD.map(csvCell).join(',')];
    list.forEach((r) => {
      lines.push([r.rank, r.code, r.lat, r.lon, r.ha, r.within, r.down, r.index, r.ndviW, r.ndviS, satStatus(r, params.winterMin), note].map(csvCell).join(','));
    });
    const cond = '# 条件: 半径' + params.radiusKm + 'km／風向' + (params.useWind ? 'を使う（' + meta.wind.station + ' ' + meta.wind.years[0] + '-' + meta.wind.years[meta.wind.years.length - 1] + '年 ' + meta.wind.months.join('・') + '月の最多風向）' : 'を使わない');
    return '﻿' + lines.join('\r\n') + '\r\n' + csvCell(cond) + '\r\n';
  }

  // 値を帯（0..n-1）に分ける。分位点で。
  function bands(values, n) {
    const v = values.filter((x) => x > 0).sort((a, b) => a - b);
    const cuts = [];
    for (let i = 1; i < n; i++) cuts.push(v.length ? v[Math.floor((v.length * i) / n)] : 0);
    return cuts;
  }
  function bandOf(x, cuts) { let b = 0; while (b < cuts.length && x >= cuts[b]) b++; return b; }

  return { DIRS, DEFAULTS, offset, bearing, windIndexFor, dirIndex, normFreq, evaluate, buildRows, rank, satStatus, csvCell, toCsv, bands, bandOf };
});
