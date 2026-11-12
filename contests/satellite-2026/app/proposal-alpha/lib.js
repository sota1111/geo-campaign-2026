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

  // 保存済みの重みが古い形式・空・壊れていても落ちないよう、既定値に重ねて補う（型が違う項目は既定値に戻す）
  function normalizeWeights(w) {
    const out = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));
    if (!w || typeof w !== 'object') return out;
    Object.keys(DEFAULT_WEIGHTS).forEach((k) => {
      const d = DEFAULT_WEIGHTS[k], v = w[k];
      if (Array.isArray(d)) {
        if (Array.isArray(v) && v.every((r) => Array.isArray(r) && isFinite(r[0]) && isFinite(r[1]))) out[k] = v.map((r) => [+r[0], +r[1]]);
      } else if (typeof d === 'object') {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(d).forEach((c) => { if (isFinite(v[c]) && v[c] !== null) out[k][c] = +v[c]; });
      } else if (isFinite(v) && v !== null) out[k] = +v;
    });
    return out;
  }
  // 保存済みの記録から、形の合わないものを除く
  function sanitizeResults(a) {
    if (!Array.isArray(a)) return [];
    return a.filter((r) => r && typeof r === 'object' && typeof r.siteId === 'string');
  }

  function band(v, table) {
    if (v == null) return 0;
    for (let i = 0; i < table.length; i++) if (v >= table[i][0]) return table[i][1];
    return 0;
  }

  // 戻り値 parts: [表示名, 点, 'sat'|'op']
  function scoreSection(s, w, refYear) {
    w = normalizeWeights(w);
    const futureCut = s.lastCut != null && s.lastCut > refYear;   // 入力ミスの疑い。負の年数にしない
    const yrs = s.lastCut == null || futureCut ? null : refYear - s.lastCut;
    // 衛星指標が欠損（雲・データ欠落）した区間を「0点＝安全」にしない。中間の帯の点を仮に付け、missing に項目名を残す
    const missing = [];
    const mid2 = (t) => (t.length ? t[Math.floor(t.length / 2)][1] : 0);
    const num = (v, label, table) => { if (v == null || !isFinite(v)) { missing.push(label); return [label + 'は欠損（中間点を仮に付与）', mid2(table)]; } return null; };
    const cMiss = num(s.p90, '樹高', w.canopy), tMiss = num(s.tallPct, '高木の割合', w.tall);
    const cat = (v, label, table) => { if (v == null || !(v in table)) { missing.push(label); return [label + 'は欠損（中間点を仮に付与）', Math.round(Object.values(table).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(table).length))]; } return [label + '（' + v + '）', table[v]]; };
    const chg = cat(s.change, '台風・豪雨前後の変化', w.change), ter = cat(s.terrain, '地形', w.terrain);
    const parts = [
      cMiss ? [cMiss[0], cMiss[1], 'sat'] : ['樹高（線の周囲15mの90%値 ' + s.p90 + ' m）', band(s.p90, w.canopy), 'sat'],
      tMiss ? [tMiss[0], tMiss[1], 'sat'] : ['高木（15m以上）の割合 ' + s.tallPct + '%', band(s.tallPct, w.tall), 'sat'],
      [chg[0], chg[1], 'sat'],
      [ter[0], ter[1], 'sat'],
      ['停電の想定戸数 ' + s.customers + ' 戸', band(s.customers, w.customers), 'op'],
      ['重要施設（' + s.facility + '）', w.facility[s.facility] || 0, 'op'],
      ['道路との関係（' + s.road + '）', w.road[s.road] || 0, 'op'],
      ['過去の倒木停電の記録（' + (s.pastFall ? 'あり' : 'なし') + '）', s.pastFall ? w.pastFall : 0, 'op'],
      [futureCut ? '前回の伐採年 ' + s.lastCut + ' が基準年 ' + refYear + ' より後（入力ミスの疑い・不明として扱う）' : yrs == null ? '前回の伐採（履歴なし・不明）' : '前回の伐採から ' + yrs + ' 年', yrs == null ? w.cutUnknown : band(yrs, w.cutAge), 'op']
    ];
    const sum = (src) => parts.filter((p) => !src || p[2] === src).reduce((a, p) => a + p[1], 0);
    return { score: sum(), satScore: sum('sat'), opScore: sum('op'), parts, missing, futureCut };
  }

  function latestResult(results, id) {
    // 確認日が新しいものを採る。同じ日（または日付なし）なら、後から入力したものを採る
    let best = null;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r || r.siteId !== id) continue;
      if (!best || String(r.date || '') >= String(best.date || '')) best = r;
    }
    return best;
  }

  // satOnly: 衛星・公開データ由来の点数だけで並べる（事業者データを重ねない場合との比較用）
  function rank(sections, w, refYear, results, satOnly) {
    results = sanitizeResults(results);
    w = normalizeWeights(w);
    return sections.map((s) => {
      const sc = scoreSection(s, w, refYear);
      return Object.assign({}, s, { score: satOnly ? sc.satScore : sc.score, satScore: sc.satScore, opScore: sc.opScore, parts: sc.parts, missing: sc.missing, latest: latestResult(results, s.id) });
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
    // 同じ区間の再訪で件数を水増ししない: 区間ごとに最新の確認だけを数える
    const latest = [];
    sections.forEach((s) => { const r = latestResult(sanitizeResults(results), s.id); if (r) latest.push(r); });
    latest.forEach((r) => {
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
  // 格子は1セル=cellM（約12m）の集約値なので、bufferM より細かい幅は選べない。幅は「両側 k セル」（k = floor(bufferM/cellM)）に切り捨てる:
  // bufferM < cellM（例: 10m）は k=0 で線が通るセルだけ、cellM 以上 2*cellM 未満は k=1（線から1セル以内）、25m は k=2。
  // 線が通るセルは必ず含め、その外側は「セルの中心が線から k セル以内」のものを足す。実際に使った幅は戻り値の bufferCells・bufferUsedM。
  // 樹高マップの範囲外は「0m（樹木なし）」ではなく outside として返す（outside=true の統計値は null）。
  function alongLine(grid, cellM, pts, bufferM, tallM, chunkM) {
    chunkM = chunkM || 100;
    const n = grid.n, h = grid.h;
    const seg = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) * cellM;
      seg.push({ a: pts[i - 1], b: pts[i], L, from: total }); total += L;
    }
    if (!total) return { lengthM: 0, cells: 0, max: 0, p90: 0, tallShare: 0, chunks: [], outside: false };
    const k = Math.floor(bufferM / cellM + 1e-9), step = cellM / 2, r = k, nCh = Math.ceil(total / chunkM);
    const chunkCells = Array.from({ length: nCh }, () => new Map());
    const inside = new Array(nCh).fill(0), samples = new Array(nCh).fill(0);
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
      samples[ci]++;
      if (x >= 0 && y >= 0 && x < n && y < n) inside[ci]++;
      take(Math.floor(x), Math.floor(y), ci);
      for (let rr = Math.floor(y - r - 0.5); rr <= Math.ceil(y + r + 0.5); rr++)
        for (let c = Math.floor(x - r - 0.5); c <= Math.ceil(x + r + 0.5); c++)
          if (Math.hypot(c + 0.5 - x, rr + 0.5 - y) <= r) take(c, rr, ci);
    }
    const stat = (m) => {
      const v = Array.from(m.values()).sort((a, b) => a - b);
      if (!v.length) return { cells: 0, max: null, p90: null, tallShare: null, outside: true };
      return { outside: false, cells: v.length, max: v.length ? v[v.length - 1] : 0, p90: percentile(v, 90), tallShare: v.length ? v.filter((x) => x >= tallM).length / v.length : 0 };
    };
    const whole = stat(all);
    const chunks = chunkCells.map((m, i) => Object.assign({ fromM: i * chunkM, toM: Math.min(total, (i + 1) * chunkM), insideShare: samples[i] ? inside[i] / samples[i] : 0 }, stat(m)));
    const allSamples = samples.reduce((a, b) => a + b, 0), allInside = inside.reduce((a, b) => a + b, 0);
    return Object.assign({ lengthM: total, bufferCells: k, bufferUsedM: k * cellM, insideShare: allSamples ? allInside / allSamples : 0 }, whole, { chunks });
  }

  const api = { DEFAULT_WEIGHTS, RESULTS, SAT_KEYS, band, scoreSection, rank, planRoute, hitStats, toCSV, csvCell, latestResult, tileOf, percentile, alongLine, mid, dist, normalizeWeights, sanitizeResults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TreeLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
