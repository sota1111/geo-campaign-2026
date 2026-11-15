/* バス定時性カルテ: 画面に依存しない純粋関数（node でも試験できる） */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var BAND_LABEL = { all: '全時間帯', morning: '朝（6〜9時）', day: '日中（9〜16時）', evening: '夕（16〜19時）', night: '夜（19〜6時）' };
  var BANDS = ['all', 'morning', 'day', 'evening', 'night'];

  /* 秒 -> 「+3分20秒」「-1分」「0秒」 */
  function fmtDelay(s) {
    if (s == null) return '—';
    var sign = s > 0 ? '+' : (s < 0 ? '-' : '');
    var a = Math.abs(Math.round(s));
    var m = Math.floor(a / 60), r = a % 60;
    if (m === 0) return sign + r + '秒';
    return sign + m + '分' + (r ? r + '秒' : '');
  }

  function fmtPct(p) { return p == null ? '—' : p.toFixed(1) + '%'; }

  /* 区間の遅れ増加（秒）を色に。増えない=青系、増える=橙系（赤緑を避ける） */
  function segColor(addedS) {
    if (addedS == null) return '#999999';
    if (addedS < 15) return '#0072B2';
    if (addedS < 45) return '#56B4E9';
    if (addedS < 90) return '#E69F00';
    return '#D55E00';
  }
  var SEG_LEGEND = [['#0072B2', '増えない（15秒未満）'], ['#56B4E9', '15〜45秒増える'], ['#E69F00', '45〜90秒増える'], ['#D55E00', '90秒以上増える']];

  /* 定時率の表示ラベル（色だけに頼らない）。n不足は「サンプル不足」 */
  function ontimeLabel(row) {
    if (!row.enough) return 'サンプル不足';
    return fmtPct(row.ontime_pct);
  }

  /* CSV（Excel で文字化けしないよう先頭に BOM。セルは常に引用符で囲む） */
  function toCsv(header, rows) {
    function cell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
    var lines = [header.map(cell).join(',')];
    rows.forEach(function (r) { lines.push(r.map(cell).join(',')); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  function routesCsv(op, band) {
    var rows = op.routes.filter(function (r) { return r.band === band; }).map(function (r) {
      return [op.name, r.route_id, r.name, BAND_LABEL[band], r.n_trips, r.enough ? 'はい' : 'いいえ',
        r.enough ? r.ontime_pct : '', r.enough ? r.late_pct : '', r.enough ? r.early_pct : '',
        r.enough ? r.median_delay_s : '', r.enough ? r.p90_delay_s : '',
        r.bunch_enough ? r.bunch_pairs : '', r.bunch_enough ? r.bunch_pct : '', r.bunch_enough ? r.gap_pct : ''];
    });
    return toCsv(['事業者', 'route_id', '路線名', '時間帯', '便数', 'サンプル十分', '定時率%', '遅れ(5分超)%', '早発%', '遅れ中央値(秒)', '遅れ90%点(秒)', '団子運転の組数', '団子運転%', '間延び%'], rows);
  }

  function segmentsCsv(op, band) {
    var rows = op.segments.filter(function (s) { return s.band === band; }).map(function (s) {
      return [op.name, s.route_id, s.name, s.dir, s.from, s.to, BAND_LABEL[band], s.n, s.median_added_s, s.p90_added_s, s.sched_run_s, s.added_pct_of_run];
    });
    return toCsv(['事業者', 'route_id', '路線名', '方向', '区間の始点', '区間の終点', '時間帯', '観測数', '増えた遅れの中央値(秒)', '同90%点(秒)', '時刻表の所要(秒)', '所要に対する増加%'], rows);
  }

  /* 期間の見出し。「◯日分・◯時点」 */
  function periodText(op) {
    var p = op.period;
    var est = (p.estimated_days || []).length;
    var obs = (p.observed_days || []).length;
    if (!p.first) return '取得記録がありません。';
    if (!est) {
      return '取得した期間: ' + p.first + ' 〜 ' + p.last + '（' + obs + '日分・取得 ' + p.polls + ' 回）。遅れを推定できるだけの位置データが、まだありません。';
    }
    return est + '日分（' + p.estimated_days[0] + (est > 1 ? ' 〜 ' + p.estimated_days[est - 1] : '') + '）の推定。最終取得 ' + p.last + ' 時点。';
  }

  function routeSortKey(a, b) {
    var x = String(a.name), y = String(b.name);
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  /* 路線の一覧（route_id 重複なし、名称順） */
  function routeList(op) {
    var seen = {}, out = [];
    (op.routes || []).concat(op.segments || []).forEach(function (r) {
      if (r.route_id != null && !seen[r.route_id]) { seen[r.route_id] = 1; out.push({ route_id: r.route_id, name: r.name }); }
    });
    return out.sort(routeSortKey);
  }

  /* 区間を時間帯と（任意で）路線で絞る。絞り込み後に上位 limit 件（元の並び順を保つ） */
  function segmentsFor(op, band, routeId, limit) {
    var rows = (op.segments || []).filter(function (s) { return s.band === band && (routeId == null || s.route_id === routeId); });
    return limit ? rows.slice(0, limit) : rows;
  }

  /* その時間帯に、事業者全体で1行でも集計があるか（無ければ「未取得」） */
  function bandHasData(op, band) {
    return (op.routes || []).some(function (r) { return r.band === band; }) || (op.segments || []).some(function (s) { return s.band === band; });
  }

  /* 選択路線の時間帯別の状態。kind: ok | thin（サンプル不足） | norow（この路線は行なし） | missing（時間帯が未取得） */
  function routeBandStatus(op, routeId, band) {
    var row = (op.routes || []).filter(function (r) { return r.route_id === routeId && r.band === band; })[0];
    if (row) return { kind: row.enough ? 'ok' : 'thin', row: row };
    return { kind: bandHasData(op, band) ? 'norow' : 'missing', row: null };
  }

  /* 区間の集計がある路線: route_id -> 区間の件数（全時間帯の合計）。区間は同じ区間の観測が8回以上で出る */
  function segmentCounts(op) {
    var m = {};
    (op.segments || []).forEach(function (s) { if (s.route_id != null) m[s.route_id] = (m[s.route_id] || 0) + 1; });
    return m;
  }
  function hasSegments(op, routeId) { return !!segmentCounts(op)[routeId]; }
  /* 区間あり路線を先、続けて名称順。onlySeg なら区間ありだけ */
  function routeListSorted(op, onlySeg) {
    var cnt = segmentCounts(op);
    var list = routeList(op).map(function (r) { return { route_id: r.route_id, name: r.name, seg: cnt[r.route_id] || 0 }; });
    if (onlySeg) list = list.filter(function (r) { return r.seg > 0; });
    return list.sort(function (a, b) { return (b.seg > 0) - (a.seg > 0) || routeSortKey(a, b); });
  }
  /* 選択路線に区間がないときの代わり: 区間の多い順に最大 limit 路線（選択中を除く） */
  function suggestSegmentRoutes(op, excludeId, limit) {
    return routeListSorted(op, true).filter(function (r) { return r.route_id !== excludeId; })
      .sort(function (a, b) { return b.seg - a.seg || routeSortKey(a, b); }).slice(0, limit || 4);
  }

  /* 選択路線のまとめ: 個別の時間帯（全時間帯を除く）のうち集計できたものを比べ、定時率が最も低い時間帯と、
     全時間帯を通じて遅れが最も増える区間を返す。データにない値は作らない（比べられる時間帯が1つなら compared=1 で返す）。 */
  function routeConclusion(op, id) {
    var bands = BANDS.filter(function (b) { return b !== 'all'; });
    var got = [], missing = [], thin = [];
    bands.forEach(function (b) {
      var st = routeBandStatus(op, id, b);
      if (st.kind === 'missing') missing.push(b);
      else if (st.kind === 'ok') got.push({ band: b, row: st.row });
      else thin.push(b);
    });
    got.sort(function (a, b) { return a.row.ontime_pct - b.row.ontime_pct || b.row.late_pct - a.row.late_pct; });
    var segs = (op.segments || []).filter(function (s) { return s.route_id === id; })
      .sort(function (a, b) { return b.median_added_s - a.median_added_s; });
    return { worst: got[0] || null, compared: got.length, missing: missing, thin: thin, topSeg: segs[0] || null };
  }

  var api = { segmentCounts: segmentCounts, hasSegments: hasSegments, routeListSorted: routeListSorted, suggestSegmentRoutes: suggestSegmentRoutes, routeList: routeList, segmentsFor: segmentsFor, bandHasData: bandHasData, routeBandStatus: routeBandStatus, routeConclusion: routeConclusion, esc: esc, fmtDelay: fmtDelay, fmtPct: fmtPct, segColor: segColor, SEG_LEGEND: SEG_LEGEND, ontimeLabel: ontimeLabel,
    toCsv: toCsv, routesCsv: routesCsv, segmentsCsv: segmentsCsv, periodText: periodText, routeSortKey: routeSortKey, BAND_LABEL: BAND_LABEL, BANDS: BANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TeijiLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
