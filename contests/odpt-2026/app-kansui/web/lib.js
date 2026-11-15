/* 冠水しやすい駅の出入口と迂回: 画面に依存しない関数（ブラウザと Node の両方で動く） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KansuiLib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AVOID_MIN = 2, WARN_MIN = 1;

  function statusOf(cls) {
    return cls >= AVOID_MIN ? 'avoid' : (cls >= WARN_MIN ? 'warn' : 'none');
  }
  // 色だけに頼らないよう、記号と文言を必ず付ける。断定する語は使わない。
  var STATUS_TEXT = { avoid: '▲ 避けたい', warn: '△ 注意', none: '○ 着色なし' };
  var STATUS_NOTE = {
    avoid: '想定浸水深 0.5m 以上（想定に基づく目安）',
    warn: '想定浸水深 0.5m 未満（想定に基づく目安）',
    none: 'この想定では着色なし（安全の保証ではありません）'
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 駅名の末尾に「駅」を付ける（既に付いていれば付けない）
  function stationLabel(name) {
    return /駅$/.test(name) ? name : name + '駅';
  }

  function fmtDist(m) {
    if (m == null) return '';
    return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';
  }

  // 駅の並び: 避けたい出入口の数 → 注意を含む数 → 最大区分 → 駅名。出入口の記録が無い駅は含めない。
  function rankStations(stations) {
    return stations.filter(function (s) { return s.summary.n > 0; }).sort(function (a, b) {
      var x = a.summary, y = b.summary;
      return (y.avoid - x.avoid) ||
        ((y.avoid + y.warn) - (x.avoid + x.warn)) ||
        ((y.max || 0) - (x.max || 0)) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // 表計算ソフトでの式の実行を防ぐ
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function toCsv(rows) {
    return '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  function label(classes, c) { return classes[c] != null ? classes[c] : ''; }

  // 地区の一覧（駅ごと）
  function stationsCsv(stations, classes) {
    var rows = [['順位', '駅名', '事業者', '出入口数', '避けたい出入口数(想定浸水深0.5m以上)', '注意の出入口数(0.5m未満)', '着色なしの出入口数', '最大の区分', '避けたい割合(%)']];
    rankStations(stations).forEach(function (s, i) {
      var m = s.summary;
      rows.push([i + 1, s.name, s.operators.join('・'), m.n, m.avoid, m.warn, m.none,
        label(classes, m.max), Math.round(m.avoid / m.n * 100)]);
    });
    return toCsv(rows);
  }

  // 出入口ごと
  function entrancesCsv(stations, classes) {
    var rows = [['駅名', '出入口', 'OSMの名称', '緯度', '経度', '洪水の想定浸水深(想定最大規模)', '高潮の想定浸水深(想定最大規模)', '判定', '同じ駅の代わりの出入口(直線距離)']];
    stations.forEach(function (s) {
      s.entrances.forEach(function (e) {
        var alt = ((e.alt && e.alt.same) || []).map(function (a) {
          return s.entrances[a.i].label + ' ' + a.d + 'm';
        }).join(' / ');
        rows.push([s.name, e.label, e.name, e.lat, e.lon, label(classes, e.flood), label(classes, e.tide),
          STATUS_TEXT[statusOf(e.cls)].replace(/^\S+ /, ''), alt]);
      });
    });
    return toCsv(rows);
  }

  // バス停の便の要約（平日・休日の本数、始発・終発）
  function busSummary(b) {
    if (!b.wd && !b.hol) return '運行する便の記録なし';
    var t = '平日 ' + b.wd + ' 本・休日 ' + b.hol + ' 本（全系統・両方向の合計）';
    if (b.first) t += '（平日の始発 ' + b.first + '・終発 ' + b.last + '）';
    return t;
  }

  return {
    AVOID_MIN: AVOID_MIN, WARN_MIN: WARN_MIN, STATUS_TEXT: STATUS_TEXT, STATUS_NOTE: STATUS_NOTE,
    statusOf: statusOf, stationLabel: stationLabel, escapeHtml: escapeHtml, fmtDist: fmtDist, rankStations: rankStations,
    csvCell: csvCell, toCsv: toCsv, stationsCsv: stationsCsv, entrancesCsv: entrancesCsv, busSummary: busSummary
  };
});
