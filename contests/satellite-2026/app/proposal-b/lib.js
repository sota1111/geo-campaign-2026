// 盛土巡視台帳: ロジック（ブラウザ・Node 両用）。解析結果そのものは扱わず、与えられた検出候補の並べ替えと記録を担う。
(function (root) {
  'use strict';
  const DEFAULT_WEIGHTS = {
    change: { '新設': 30, '拡大': 25, '変位': 20, '植生消失': 10 },
    terrain: { '谷埋め': 25, '斜面': 15, '平地': 0 },
    permit: { '許可・届出なし': 25, '確認中': 15, '許可・届出あり': 0 },
    zone: { '特定盛土等規制区域': 10, '宅地造成等工事規制区域': 5, '区域外': 0 },
    ageMax: 10, // 検出から30日で頭打ちになる加点（最大値）
    seasonalPenalty: -15 // 農地の耕起など季節変動の可能性がある候補
  };
  // 実データ版の重み。入力はすべて実指標（造成地の型・面積・DEMの標高差と傾斜・規制区域）。しきい値と点数は説明用の仮置き。
  const DEFAULT_WEIGHTS_REAL = {
    type: { '谷埋め型': 25, '腹付け型': 15, '区分なし': 0 },
    zone: { '特定盛土等規制区域': 10, '宅地造成等工事規制区域': 5, '区域外': 0 },
    relief: [[40, 20], [20, 10], [10, 5]], // [標高差m以上, 点]
    slope: [[20, 20], [15, 12], [8, 6]],   // [平均傾斜°以上, 点]
    area: [[50000, 15], [10000, 10], [3000, 5]] // [面積m²以上, 点]
  };
  const RESULTS = ['是正対象', '要継続観察', '問題なし', '立入不可・再訪'];

  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }

  function scoreSite(site, w, refDate) {
    w = w || DEFAULT_WEIGHTS;
    const age = Math.max(0, daysBetween(site.detected, refDate));
    const parts = [
      ['変化の種類（' + site.change + '）', w.change[site.change] || 0],
      ['地形（' + site.terrain + '）', w.terrain[site.terrain] || 0],
      ['許可・届出（' + site.permit + '）', w.permit[site.permit] || 0],
      ['区域（' + site.zone + '）', w.zone[site.zone] || 0],
      ['検出からの経過（' + age + '日）', Math.round(w.ageMax * Math.min(age, 30) / 30)]
    ];
    if (site.seasonal) parts.push(['季節変動の可能性（農地等）', w.seasonalPenalty]);
    const score = Math.max(0, parts.reduce((s, p) => s + p[1], 0));
    return { score, parts };
  }

  function band(v, table) {
    if (v == null) return 0;
    for (let i = 0; i < table.length; i++) if (v >= table[i][0]) return table[i][1];
    return 0;
  }
  // 実データ: 衛星由来の変化量は未接続のため点数に入れない（null 行で明示）。
  function scoreReal(site, w) {
    w = w || DEFAULT_WEIGHTS_REAL;
    const noDem = site.reliefM == null;
    const parts = [
      ['衛星由来の変化（未接続。実運用では Sentinel-1/2 で算出）', null],
      ['型（' + site.type + '）', w.type[site.type] || 0],
      ['区域（' + site.zone + '）', w.zone[site.zone] || 0],
      ['面積（' + site.areaM2 + ' m²）', band(site.areaM2, w.area)],
      [noDem ? '区域内の標高差（算出不可）' : '区域内の標高差（' + site.reliefM + ' m）', band(site.reliefM, w.relief)],
      [noDem ? '平均傾斜（算出不可）' : '平均傾斜（' + site.slopeDeg + '°）', band(site.slopeDeg, w.slope)]
    ];
    return { score: parts.reduce((s, p) => s + (p[1] || 0), 0), parts };
  }

  // 緯度経度 → 地理院タイル（z/x/y とタイル内ピクセル）
  function tileOf(lon, lat, z) {
    const n = Math.pow(2, z) * 256;
    const x = (lon + 180) / 360 * n;
    const y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    return { z, x: Math.floor(x / 256), y: Math.floor(y / 256), px: x - Math.floor(x / 256) * 256, py: y - Math.floor(y / 256) * 256, wx: x, wy: y };
  }

  function latestResult(results, id) {
    for (let i = results.length - 1; i >= 0; i--) if (results[i].siteId === id) return results[i];
    return null;
  }

  function rank(sites, w, refDate, results, mode) {
    results = results || [];
    return sites.map((s) => {
      const sc = mode === 'real' ? scoreReal(s, w) : scoreSite(s, w, refDate);
      return Object.assign({}, s, { score: sc.score, parts: sc.parts, latest: latestResult(results, s.id) });
    }).sort((a, b) => b.score - a.score || (b.areaM2 || 0) - (a.areaM2 || 0) || (a.id < b.id ? -1 : 1))
      .map((s, i) => Object.assign(s, { rank: i + 1 }));
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  // 上位 n 件を、起点から近い順に回る（最近傍法。道路距離ではなく地図上の直線距離）
  function planRoute(ranked, origin, n) {
    const pool = ranked.slice(0, Math.max(0, n));
    const route = []; let cur = origin; let total = 0;
    while (pool.length) {
      let bi = 0;
      for (let i = 1; i < pool.length; i++) if (dist(cur, pool[i]) < dist(cur, pool[bi])) bi = i;
      const nx = pool.splice(bi, 1)[0];
      total += dist(cur, nx); route.push(nx); cur = nx;
    }
    total += route.length ? dist(cur, origin) : 0;
    return { route, total };
  }

  // 変化の種類ごとの巡視結果の集計（件数のみ）
  function hitStats(sites, results, key) {
    key = key || 'change';
    const byId = {}; sites.forEach((s) => (byId[s.id] = s));
    const out = {};
    results.forEach((r) => {
      const s = byId[r.siteId]; if (!s) return;
      const o = out[s[key]] || (out[s[key]] = { n: 0, hit: 0 });
      o.n++; if (r.result === '是正対象') o.hit++;
    });
    return out;
  }

  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // 表計算ソフトで数式として解釈されないようにする
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows) {
    return '﻿' + [header].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  const api = { DEFAULT_WEIGHTS_REAL, scoreReal, tileOf, band, DEFAULT_WEIGHTS, RESULTS, scoreSite, rank, planRoute, hitStats, toCSV, csvCell, latestResult, daysBetween, dist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MorLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
