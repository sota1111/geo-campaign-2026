/* 生活アクセス診断マップ: 画面に依存しない純粋関数（node でもテストできる） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = ['wd', 'hol'];
  var PERIODS = ['m', 'd', 'e'];
  var DAY_LABEL = { wd: '平日', hol: '休日' };
  var PERIOD_LABEL = { m: '朝', d: '昼', e: '夕' };

  /* 500m メッシュコード(9桁) -> [lonMin, latMin, lonMax, latMax] */
  function meshBounds(code) {
    var p = +code.slice(0, 2), q = +code.slice(2, 4);
    var r = +code[4], s = +code[5], t = +code[6], u = +code[7];
    var lat = p * 2 / 3 + r / 12 + t / 120;
    var lon = 100 + q + s / 8 + u / 80;
    var dlat = 1 / 240, dlon = 1 / 160;
    var m = +code[8] - 1;
    lat += Math.floor(m / 2) * dlat;
    lon += (m % 2) * dlon;
    return [lon, lat, lon + dlon, lat + dlat];
  }

  /* 診断文字列の位置: 施設(fi) × 日種(wd,hol) × 時間帯(m,d,e) */
  function condIndex(fi, day, per) {
    return fi * 6 + DAYS.indexOf(day) * 3 + PERIODS.indexOf(per);
  }

  /* しきい値 W(分) -> 必要な水準（thresholds は昇順: [20,30,45,60]、水準は W が小さいほど高い） */
  function needLevel(thresholds, w) {
    var k = thresholds.indexOf(w);
    if (k < 0) throw new Error('unknown threshold ' + w);
    return thresholds.length - k;
  }

  /* cell = [code, pop, pop65, levels, walkBits]。戻り値 'walk' | 'transit' | 'none' */
  function cellStatus(cell, fi, day, per, need) {
    if (cell[4] & (1 << fi)) return 'walk';
    var lv = +cell[3][condIndex(fi, day, per)];
    return lv >= need ? 'transit' : 'none';
  }

  /* 人口と65歳以上人口を状態別に集計 */
  function summarize(cells, fi, day, per, need) {
    var out = { pop: 0, walk: 0, transit: 0, none: 0, pop65: 0, walk65: 0, transit65: 0, none65: 0 };
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var st = cellStatus(c, fi, day, per, need);
      out.pop += c[1];
      out[st] += c[1];
      out.pop65 += c[2];
      out[st + '65'] += c[2];
    }
    return out;
  }

  function pct(a, b) {
    return b > 0 ? Math.round((1000 * a) / b) / 10 : 0;
  }

  /* 最良水準 -> 表示文字 */
  function levelLabel(level, thresholds) {
    if (!level) return '×';
    return thresholds[thresholds.length - level] + '分以内';
  }

  /* 分(0起点・24時超可) -> 'H:MM'。1440以上は翌日扱いで「翌」を付ける */
  function fmtMin(m) {
    if (m == null || m < 0) return '—';
    var next = m >= 1440;
    var mm = m % 1440;
    var h = Math.floor(mm / 60), mi = mm % 60;
    return (next ? '翌' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }

  function distM(lon1, lat1, lon2, lat2) {
    var kx = 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574);
  }

  /* nodes: [lon,lat,name,wd,hol,routes]。半径内を距離順に返す */
  function nearbyNodes(nodes, lon, lat, radius, limit) {
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var d = distM(lon, lat, nodes[i][0], nodes[i][1]);
      if (d <= radius) out.push({ i: i, d: d });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return limit ? out.slice(0, limit) : out;
  }

  /* 点を含む500mメッシュのセルを探す（cells は code 昇順でなくてもよいので Map を使う） */
  function indexCells(cells) {
    var m = {};
    for (var i = 0; i < cells.length; i++) m[cells[i][0]] = i;
    return m;
  }

  function meshCodeAt(lon, lat) {
    var p = Math.floor(lat * 1.5);
    var a = lat * 1.5 - p;           // 0..1 (1次メッシュ内の南北)
    var r = Math.floor(a * 8);
    var a2 = a * 8 - r;
    var t = Math.floor(a2 * 10);
    var a3 = a2 * 10 - t;
    var q = Math.floor(lon) - 100;
    var b = lon - Math.floor(lon);
    var s = Math.floor(b * 8);
    var b2 = b * 8 - s;
    var u = Math.floor(b2 * 10);
    var b3 = b2 * 10 - u;
    var m = (a3 >= 0.5 ? 2 : 0) + (b3 >= 0.5 ? 2 : 1);
    return ('0' + p).slice(-2) + ('0' + q).slice(-2) + r + s + t + u + m;
  }

  /* 地点の自動コメント（事実のみ）。node = nodes[i] */
  function nodeFacts(node) {
    var wd = node[3], hol = node[4];
    var facts = [];
    if (wd[3] === 0 && hol[3] === 0) return ['この停留所群から発車する便は基準日にありません'];
    if (wd[3] > 0) {
      facts.push('平日は1日' + wd[3] + '本、終発は' + fmtMin(wd[5]));
    } else {
      facts.push('平日の運行はありません');
    }
    if (hol[3] > 0) {
      var ratio = wd[3] > 0 ? '（平日の' + Math.round((100 * hol[3]) / wd[3]) + '%）' : '';
      facts.push('休日は1日' + hol[3] + '本' + ratio + '、終発は' + fmtMin(hol[5]));
    } else {
      facts.push('休日の運行はありません');
    }
    return facts;
  }

  return {
    DAYS: DAYS, PERIODS: PERIODS, DAY_LABEL: DAY_LABEL, PERIOD_LABEL: PERIOD_LABEL,
    meshBounds: meshBounds, condIndex: condIndex, needLevel: needLevel,
    cellStatus: cellStatus, summarize: summarize, pct: pct, levelLabel: levelLabel,
    fmtMin: fmtMin, distM: distM, nearbyNodes: nearbyNodes, indexCells: indexCells,
    meshCodeAt: meshCodeAt, nodeFacts: nodeFacts
  };
});
