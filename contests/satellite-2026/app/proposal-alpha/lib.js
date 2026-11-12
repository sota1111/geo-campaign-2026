// 配電線 樹木リスク台帳: ロジック（ブラウザ・Node 両用）。衛星解析そのものは扱わず、区間ごとの指標の点数化・並べ替え・記録・線沿いの集計を担う。
(function (root) {
  'use strict';
  // 点数の重み。しきい値と点数は仕組みを見せるための仮置きで、根拠のある値ではない。
  // 'sat' = 衛星・公開データから作れる指標、'op' = 事業者・自治体が持つデータ（総務省調査が挙げる優先順位の観点に対応）。
  const DEFAULT_WEIGHTS = {
    canopy: [[20, 25], [15, 18], [10, 10]],       // 線の周囲15m圏の樹高の90パーセンタイル(m以上, 点)
    tall: [[40, 20], [20, 12], [10, 5]],          // 高木（15m以上）の割合(%以上, 点)
    change: { '倒木・裸地化の疑い': 25, '樹冠の拡大': 8, '変化なし': 0 },   // Sentinel-2 の台風・豪雨前後の変化
    terrain: { '谷筋・急斜面': 15, '斜面': 8, '平地': 0 },                // 数値標高モデル
    customers: [[500, 15], [200, 10], [50, 5]],   // 断線時に停電する想定戸数(戸以上, 点)  事業者データ
    facility: { '病院': 10, '避難所': 10, '通信設備': 8, 'なし': 0 },     // 影響を受ける重要施設  事業者・自治体データ
    road: { '幹線道路沿い': 8, '市道沿い': 4, '道路なし': 0 },            // 倒木による道路閉塞の影響  公開地図
    pastFall: 15,                                  // 過去に倒木による停電の記録がある  事業者データ
    cutAge: [[10, 8], [5, 4]],                     // 前回の伐採からの年数(年以上, 点)
    cutUnknown: 4                                  // 伐採履歴が分からない区間
  };
  const RESULTS = ['要伐採', '要継続観察', '問題なし', '立入不可・再訪'];
  const SAT_KEYS = ['canopy', 'tall', 'change', 'terrain'];

  function band(v, table) {
    if (v == null) return 0;
    for (let i = 0; i < table.length; i++) if (v >= table[i][0]) return table[i][1];
    return 0;
  }

  // 戻り値 parts: [表示名, 点, 'sat'|'op']
  function scoreSection(s, w, refYear) {
    w = w || DEFAULT_WEIGHTS;
    const yrs = s.lastCut == null ? null : refYear - s.lastCut;
    const parts = [
      ['樹高（線の周囲15mの90%値 ' + s.p90 + ' m）', band(s.p90, w.canopy), 'sat'],
      ['高木（15m以上）の割合 ' + s.tallPct + '%', band(s.tallPct, w.tall), 'sat'],
      ['台風・豪雨前後の変化（' + s.change + '）', w.change[s.change] || 0, 'sat'],
      ['地形（' + s.terrain + '）', w.terrain[s.terrain] || 0, 'sat'],
      ['停電の想定戸数 ' + s.customers + ' 戸', band(s.customers, w.customers), 'op'],
      ['重要施設（' + s.facility + '）', w.facility[s.facility] || 0, 'op'],
      ['道路との関係（' + s.road + '）', w.road[s.road] || 0, 'op'],
      ['過去の倒木停電の記録（' + (s.pastFall ? 'あり' : 'なし') + '）', s.pastFall ? w.pastFall : 0, 'op'],
      [yrs == null ? '前回の伐採（履歴なし・不明）' : '前回の伐採から ' + yrs + ' 年', yrs == null ? w.cutUnknown : band(yrs, w.cutAge), 'op']
    ];
    const sum = (src) => parts.filter((p) => !src || p[2] === src).reduce((a, p) => a + p[1], 0);
    return { score: sum(), satScore: sum('sat'), opScore: sum('op'), parts };
  }

  function latestResult(results, id) {
    for (let i = results.length - 1; i >= 0; i--) if (results[i].siteId === id) return results[i];
    return null;
  }

  // satOnly: 衛星・公開データ由来の点数だけで並べる（事業者データを重ねない場合との比較用）
  function rank(sections, w, refYear, results, satOnly) {
    results = results || [];
    return sections.map((s) => {
      const sc = scoreSection(s, w, refYear);
      return Object.assign({}, s, { score: satOnly ? sc.satScore : sc.score, satScore: sc.satScore, opScore: sc.opScore, parts: sc.parts, latest: latestResult(results, s.id) });
    }).sort((a, b) => b.score - a.score || (b.lenM || 0) - (a.lenM || 0) || (a.id < b.id ? -1 : 1))
      .map((s, i) => Object.assign(s, { rank: i + 1 }));
  }

  function mid(s) { return s.pts[Math.floor(s.pts.length / 2)]; }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

  // 上位 n 区間を、営業所から近い順に回る（最近傍法。地図上の直線距離で、道路距離ではない）
  function planRoute(ranked, depot, n) {
    const pool = ranked.slice(0, Math.max(0, n));
    const route = []; let cur = [depot.x, depot.y]; let total = 0;
    while (pool.length) {
      let bi = 0;
      for (let i = 1; i < pool.length; i++) if (dist(cur, mid(pool[i])) < dist(cur, mid(pool[bi]))) bi = i;
      const nx = pool.splice(bi, 1)[0];
      total += dist(cur, mid(nx)); route.push(nx); cur = mid(nx);
    }
    total += route.length ? dist(cur, [depot.x, depot.y]) : 0;
    return { route, total };
  }

  // 現地確認の結果を区分ごとに集計（件数のみ。要伐採になった件数を数える）
  function hitStats(sections, results, key) {
    const byId = {}; sections.forEach((s) => (byId[s.id] = s));
    const out = {};
    results.forEach((r) => {
      const s = byId[r.siteId]; if (!s) return;
      const o = out[s[key]] || (out[s[key]] = { n: 0, hit: 0 });
      o.n++; if (r.result === '要伐採') o.hit++;
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

  // 緯度経度 → 地理院タイル（z/x/y とタイル内ピクセル、世界ピクセル座標 wx/wy）
  function tileOf(lon, lat, z) {
    const n = Math.pow(2, z) * 256;
    const x = (lon + 180) / 360 * n;
    const y = (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    return { z, x: Math.floor(x / 256), y: Math.floor(y / 256), wx: x, wy: y };
  }

  function percentile(sorted, p) {
    if (!sorted.length) return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
    return sorted[i];
  }

  // 実データ（樹高の格子）の上で、利用者が引いた仮の線の周囲の樹高を集計する。
  // grid: { n, h[行][列] }、cellM: 1セルの一辺(m)、pts: 格子座標（列, 行。小数可）の折れ線、
  // bufferM: 線から両側に見る幅(m)、tallM: 高木とみなす樹高(m)、chunkM: 区間の長さ(m)
  function alongLine(grid, cellM, pts, bufferM, tallM, chunkM) {
    chunkM = chunkM || 100;
    const n = grid.n, h = grid.h;
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * cellM;
      seg.push({ a: pts[i - 1], b: pts[i], L, from: total }); total += L;
    }
    if (!total) return { lengthM: 0, cells: 0, max: 0, p90: 0, tallShare: 0, chunks: [] };
    const step = cellM / 2, r = bufferM / cellM, nCh = Math.ceil(total / chunkM);
    const chunkCells = Array.from({ length: nCh }, () => new Map());
    const all = new Map();
    const take = (c, rr, ci) => {
      if (c < 0 || rr < 0 || c >= n || rr >= n) return;
      const key = rr * n + c;
      all.set(key, h[rr][c]); chunkCells[ci].set(key, h[rr][c]);
    };
    for (let d = 0; d <= total + 1e-9; d += step) {
      const dd = Math.min(d, total);
      let sg = seg[seg.length - 1];
      for (let i = 0; i < seg.length; i++) if (dd <= seg[i].from + seg[i].L + 1e-9) { sg = seg[i]; break; }
      const t = sg.L ? (dd - sg.from) / sg.L : 0;
      const x = sg.a[0] + (sg.b[0] - sg.a[0]) * t, y = sg.a[1] + (sg.b[1] - sg.a[1]) * t;
      const ci = Math.min(nCh - 1, Math.floor(dd / chunkM));
      for (let rr = Math.floor(y - r); rr <= Math.ceil(y + r); rr++)
        for (let c = Math.floor(x - r); c <= Math.ceil(x + r); c++)
          if (Math.hypot(c + 0.5 - x, rr + 0.5 - y) <= r + 0.5) take(c, rr, ci);
    }
    const stat = (m) => {
      const v = Array.from(m.values()).sort((a, b) => a - b);
      return { cells: v.length, max: v.length ? v[v.length - 1] : 0, p90: percentile(v, 90), tallShare: v.length ? v.filter((x) => x >= tallM).length / v.length : 0 };
    };
    const whole = stat(all);
    return Object.assign({ lengthM: total }, whole, {
      chunks: chunkCells.map((m, i) => Object.assign({ fromM: i * chunkM, toM: Math.min(total, (i + 1) * chunkM) }, stat(m)))
    });
  }

  const api = { DEFAULT_WEIGHTS, RESULTS, SAT_KEYS, band, scoreSection, rank, planRoute, hitStats, toCSV, csvCell, latestResult, tileOf, percentile, alongLine, mid, dist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TreeLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
