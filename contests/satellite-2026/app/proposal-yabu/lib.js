/* 藪払い優先地図：点数・順位・記録・CSV の純粋ロジック（ブラウザと node の両方で動く） */
(function (root) {
  'use strict';

  // 点数の重み（満点）。説明用の仮置きで、根拠のある値ではない。合計100。
  const DEFAULT_WEIGHTS = { edge: 12, veg: 8, drop: 10, sight: 30, house: 20, houses_n: 10, school: 10 };
  const SAT_KEYS = ['edge', 'veg', 'drop'];            // 衛星由来
  const OVERLAY_KEYS = ['sight', 'house', 'houses_n', 'school'];   // 目撃履歴・建物・学校（重ねるデータ）
  const KEYS = SAT_KEYS.concat(OVERLAY_KEYS);
  const LABELS = {
    edge: '林縁度（開けた所・建物から30m以内の植生の割合）',
    veg: '新緑期の植生の濃さ（NDVI）',
    drop: '落葉期との差（NDVI。冬に落ちる藪・落葉樹林）',
    sight: '500m以内のクマ目撃件数',
    house: '最寄りの建物までの近さ',
    houses_n: '300m以内の建物数',
    school: '最寄りの学校・園までの近さ',
  };
  // 根拠の棒グラフ用の短い名前
  const SHORT = { edge: '森の縁の割合', veg: '5月の緑の濃さ', drop: '冬との緑の差', sight: '目撃（500m内）', house: '建物までの近さ', houses_n: '周りの建物数', school: '学校・園の近さ' };
  const SRC = { edge: 'sat', veg: 'sat', drop: 'sat', sight: 'hist', house: 'osm', houses_n: 'osm', school: 'osm' };
  const SRC_LABEL = { sat: '衛星', hist: '目撃履歴', osm: '建物・学校' };
  // 各要素を 0〜1 にする基準（仮置き）
  const CAPS = { edge: 0.5, vegLo: 0.6, vegHi: 0.85, drop: 0.5, sight: 40, house: 400, houses_n: 30, school: 1000 };

  const RESULTS = ['藪・要刈り払い', 'すでに管理されている', '藪ではない（農地・建物など）', '立ち入れず・要再確認'];
  const EXCLUDE_RESULT = RESULTS[2];

  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  function normalizeWeights(w) {
    const out = {};
    KEYS.forEach((k) => {
      const v = w && Number(w[k]);
      out[k] = Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_WEIGHTS[k];
    });
    return out;
  }

  // 0〜1 の素点
  function unit(c) {
    const drop = c.ndvi_g - c.ndvi_w;
    return {
      edge: clamp01(c.edge / CAPS.edge),
      veg: clamp01((c.ndvi_g - CAPS.vegLo) / (CAPS.vegHi - CAPS.vegLo)),
      drop: clamp01(drop / CAPS.drop),
      sight: clamp01(c.n_sight500 / CAPS.sight),
      house: 1 - clamp01(c.d_house / CAPS.house),
      houses_n: clamp01(c.n_house300 / CAPS.houses_n),
      school: c.d_school == null ? 0 : 1 - clamp01(c.d_school / CAPS.school),
    };
  }

  function parts(c, weights) {
    const u = unit(c);
    return KEYS.map((k) => ({ key: k, label: LABELS[k], src: SRC[k], unit: u[k], pts: Math.round(u[k] * weights[k] * 10) / 10, max: weights[k] }));
  }

  function scoreOf(c, weights, satOnly) {
    const p = parts(c, weights);
    const sat = p.filter((x) => x.src === 'sat').reduce((a, x) => a + x.pts, 0);
    const all = p.reduce((a, x) => a + x.pts, 0);
    return { sat: Math.round(sat * 10) / 10, total: Math.round(all * 10) / 10, use: Math.round((satOnly ? sat : all) * 10) / 10 };
  }

  function latestResults(results) {
    const m = {};
    results.forEach((r) => { if (!m[r.cellId] || r.date >= m[r.cellId].date) m[r.cellId] = r; });
    return m;
  }

  // 順位付け。同点は区画ID順。satRank は「衛星だけで並べたら何位か」
  function rank(cells, weights, results, satOnly) {
    const latest = latestResults(results || []);
    const scored = cells.map((c) => ({ cell: c, s: scoreOf(c, weights, false) }));
    const byUse = (a, b) => (b.use - a.use) || (a.cell.id < b.cell.id ? -1 : 1);
    const sorted = scored.map((x) => ({ cell: x.cell, sat: x.s.sat, total: x.s.total, use: satOnly ? x.s.sat : x.s.total }));
    sorted.sort(byUse);
    sorted.forEach((x, i) => { x.rank = i + 1; });
    const sat = sorted.map((x) => ({ id: x.cell.id, use: x.sat })).sort((a, b) => (b.use - a.use) || (a.id < b.id ? -1 : 1));
    const satRank = {};
    sat.forEach((x, i) => { satRank[x.id] = i + 1; });
    const full = sorted.slice().sort((a, b) => (b.total - a.total) || (a.cell.id < b.cell.id ? -1 : 1));
    const fullRank = {};
    full.forEach((x, i) => { fullRank[x.cell.id] = i + 1; });
    return sorted.map((x) => ({ ...x.cell, rank: x.rank, score: x.use, satScore: x.sat, totalScore: x.total, satRank: satRank[x.cell.id], fullRank: fullRank[x.cell.id], latest: latest[x.cell.id] || null }));
  }

  // 優先の根拠（文章）。数字はすべてデータ由来の実測値と、仮置きの配点
  function reasons(c, weights) {
    const p = parts(c, weights);
    const f = (k) => p.find((x) => x.key === k);
    const line = (k, text) => ({ src: SRC[k], label: LABELS[k], text, pts: f(k).pts, max: f(k).max });
    return [
      line('edge', '植生のうち ' + Math.round(c.edge * 100) + '%が、開けた所か建物の30m以内（林縁）にある'),
      line('veg', '新緑期（5月）のNDVI平均 ' + c.ndvi_g.toFixed(2) + '（' + CAPS.vegLo + '以下で0点、' + CAPS.vegHi + '以上で満点）'),
      line('drop', '落葉期（2月）のNDVI平均 ' + c.ndvi_w.toFixed(2) + '、差 ' + (c.ndvi_g - c.ndvi_w).toFixed(2) + (c.ndvi_g - c.ndvi_w < 0.1 ? '（冬も緑が残る常緑樹・竹林の可能性）' : '（冬に葉が落ちる植生の可能性）')),
      line('sight', '500m以内で 2009〜2018年度に ' + c.n_sight500 + ' 件の目撃（うち人里の中 ' + c.n_sight500_village + ' 件、2014年度以降 ' + c.n_sight500_recent + ' 件' + (c.last_year ? '、最後は ' + c.last_year + ' 年度' : '') + '）'),
      line('house', '最寄りのOSM登録建物まで 約' + c.d_house + ' m'),
      line('houses_n', '300m以内のOSM登録建物 ' + c.n_house300 + ' 棟（未登録の建物は数えていない）'),
      line('school', c.d_school == null ? '学校・園のデータなし' : '最寄りの学校・園（' + c.school + '）まで 約' + c.d_school + ' m（通学路そのものは未入手）'),
    ];
  }

  // 理由の一言（点数の大きい観点を2つ、実測値で）。例「目撃52件・建物10m」
  function shortReason(c, weights, satOnly) {
    const word = { edge: '林縁' + Math.round(c.edge * 100) + '%', veg: '緑の濃さ ' + c.ndvi_g.toFixed(2), drop: '冬との差 ' + (c.ndvi_g - c.ndvi_w).toFixed(2), sight: '目撃' + c.n_sight500 + '件（〜2018年度）', house: '建物' + c.d_house + 'm', houses_n: '建物' + c.n_house300 + '棟', school: c.d_school == null ? '' : '学校・園' + c.d_school + 'm' };
    return parts(c, weights).filter((x) => x.pts > 0 && (!satOnly || x.src === 'sat') && word[x.key]).sort((a, b) => b.pts - a.pts).slice(0, 2).map((x) => word[x.key]).join('・');
  }

  // ---- 出没しやすさ（論文ベース）。式は README と tools/build_habitat.py に同じ ----
  // 数値は Takahata ほか 2014 PLoS ONE 9(1): e86181 の選択オッズ（雌、原文の値）。G_* は論文に数値がない仮の係数
  const HAB = { ODDS_EDGE_20: 3.74, ODDS_EDGE_100: 1.81, ODDS_RIVEREDGE_20: 21.45, TIER_HIGH: 3.74, TIER_MID: 1.81, G_FAR: 0.5, G_URBAN: 0.5, SETTLE_M: 500 };
  HAB.BETA = Math.log(HAB.ODDS_EDGE_20) / Math.exp(-0.2);
  const HAB_TIER_NAMES = ['低', '中', '高'];
  // 林縁から d m の画素の選択度（河川に接する林縁は 21.45）
  function habSelect(dEdge, riverEdge) {
    if (riverEdge && dEdge <= 20) return HAB.ODDS_RIVEREDGE_20;
    return Math.exp(HAB.BETA * Math.exp(-0.01 * dEdge));
  }
  // 区画の判定値 S = R（区画内の最大）x 集落係数 x 市街地係数
  function habScore(rMax, dHouse, urban) {
    return rMax * (dHouse <= HAB.SETTLE_M ? 1 : HAB.G_FAR) * (urban ? HAB.G_URBAN : 1);
  }
  function habTier(s) { return s >= HAB.TIER_HIGH ? 2 : s >= HAB.TIER_MID ? 1 : 0; }

  // ---- 現地確認の記録 ----
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  function sanitizeResults(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r.cellId === 'string' && /^Y\d{3}$/.test(r.cellId) && isDate(r.date) && RESULTS.indexOf(r.result) >= 0)
      .map((r) => ({ cellId: r.cellId, date: r.date, who: String(r.who == null ? '' : r.who).slice(0, 40), result: r.result, memo: String(r.memo == null ? '' : r.memo).slice(0, 200) }));
  }

  // ---- CSV ----
  // 表計算ソフトで式として実行されないよう、先頭が = + - @ タブ の文字列には ' を付ける（数値は対象外）
  function cell(v) {
    if (v == null) return '';
    let s = String(v);
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(header, rows) {
    return '﻿' + [header].concat(rows).map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  const PLAN_HEADER = ['順位', '区画ID', '緯度', '経度', '地図(地理院地図)', '点数', '衛星由来の点', '目撃・建物・学校由来の点', '500m以内の目撃(件・2009-2018年度)', '最寄り建物まで(m)', '最寄り学校・園', '学校・園まで(m)', '現地確認の結果', '確認日', '確認メモ', '刈り払い実施主体(記入)', '実施予定時期(記入)', '注記'];
  const PLAN_NOTE = '衛星の植生指数と京都府の目撃履歴・OSM建物による机上の順位。藪の有無・刈り払いの要否は現地確認で判断すること';

  // 現地に向かう人向けの地理院地図リンク（区画の中心）
  const gsiUrl = (c) => 'https://maps.gsi.go.jp/#17/' + c.lat + '/' + c.lon + '/';
  // 計画対象: 現地で「藪ではない」とされた区画を除く上位 n 区画
  function planRows(ranked, n) {
    const rows = ranked.filter((c) => !(c.latest && c.latest.result === EXCLUDE_RESULT)).slice(0, n);
    return rows.map((c, i) => [i + 1, c.id, c.lat, c.lon, gsiUrl(c), c.totalScore, c.satScore, Math.round((c.totalScore - c.satScore) * 10) / 10, c.n_sight500, c.d_house, c.school || '', c.d_school == null ? '' : c.d_school,
      c.latest ? c.latest.result : '未確認', c.latest ? c.latest.date : '', c.latest ? c.latest.memo : '', '', '', PLAN_NOTE]);
  }

  const RECORD_HEADER = ['確認日', '区画ID', '確認者', '結果', 'メモ', '注記'];
  function recordRows(results) {
    return results.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((r) => [r.date, r.cellId, r.who, r.result, r.memo, 'デモ画面での入力（実際の現地確認とは限らない）']);
  }

  const api = { SHORT, shortReason, gsiUrl, HAB, HAB_TIER_NAMES, habSelect, habScore, habTier, DEFAULT_WEIGHTS, SAT_KEYS, OVERLAY_KEYS, KEYS, LABELS, SRC, SRC_LABEL, CAPS, RESULTS, EXCLUDE_RESULT, normalizeWeights, unit, parts, scoreOf, rank, reasons, latestResults, isDate, sanitizeResults, cell, toCsv, PLAN_HEADER, planRows, RECORD_HEADER, recordRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.YabuLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
