/* 見直し案の比較: 画面に依存しない純粋関数（node でもテストできる）。
   セルの水準の読み方は odpt-2026 の web/lib.js と同じ（そちらは変更せず、必要な部分だけここに持つ）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Biz = factory();
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

  function condIndex(fi, day, per) {
    return fi * 6 + DAYS.indexOf(day) * 3 + PERIODS.indexOf(per);
  }

  function needLevel(thresholds, w) {
    var k = thresholds.indexOf(w);
    if (k < 0) throw new Error('unknown threshold ' + w);
    return thresholds.length - k;
  }

  /* cell = [code, pop, pop65, levels, walkLevels, rail] */
  function cellStatus(cell, fi, day, per, need) {
    if (+String(cell[4]).charAt(fi) >= need) return 'walk';
    var lv = +cell[3][condIndex(fi, day, per)];
    if (lv >= need) return 'transit';
    return cell[5] ? 'rail' : 'none';
  }

  function reachable(st) { return st === 'walk' || st === 'transit'; }

  /* 1つの路線を止めたときに「行けていたのに行けなくなる」セルの番号の一覧。
     diffs = whatif の [[セル番号, 新しい水準文字列], ...]（odpt の事前計算そのまま）。 */
  function lostCells(cells, diffs, fi, day, per, need) {
    var out = [];
    for (var i = 0; i < (diffs || []).length; i++) {
      var k = diffs[i][0], c = cells[k];
      var after = [c[0], c[1], c[2], diffs[i][1], c[4], c[5]];
      if (reachable(cellStatus(c, fi, day, per, need)) && !reachable(cellStatus(after, fi, day, per, need))) out.push(k);
    }
    return out;
  }

  /* 案 = 止める路線の集まり。
     路線を1つ止めたとき: 事前計算どおりの人数（exact=true）。
     複数止めるとき: どれか1つでも止めれば行けなくなるセルの和集合（セルの重複は1回だけ数える）。
       ある路線を止めるだけで行けなくなる地区は、さらに別の路線も止めれば当然行けないままなので、
       これは「少なくとも」の下限である。複数を同時に止めたときだけ新たに行けなくなる地区
       （A線とB線の両方が無くなって初めて行けなくなる地区）は事前計算に無く、数えていない。 */
  function planLoss(cells, W, routeIds, fi, day, per, need) {
    var seen = {}, list = [];
    for (var i = 0; i < routeIds.length; i++) {
      var ks = lostCells(cells, W.routes[String(routeIds[i])] || [], fi, day, per, need);
      for (var j = 0; j < ks.length; j++) if (!seen[ks[j]]) { seen[ks[j]] = 1; list.push(ks[j]); }
    }
    var lost = 0, lost65 = 0;
    for (var m = 0; m < list.length; m++) { lost += cells[list[m]][1]; lost65 += cells[list[m]][2]; }
    return { lost: lost, lost65: lost65, cells: list, exact: routeIds.length <= 1 };
  }

  function distM(lon1, lat1, lon2, lat2) {
    var kx = 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574);
  }

  /* 行けなくなるセルを、最寄りの停留所名でまとめて「地区」にする。
     地区名は行政区画ではなく「最寄り停留所の名前（直線距離）」。nodes = [lon,lat,name,...] */
  function groupByNearestStop(cells, cellIdxList, nodes) {
    var groups = {};
    cellIdxList.forEach(function (k) {
      var b = meshBounds(cells[k][0]);
      var lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2;
      var best = -1, bd = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var d = distM(lon, lat, nodes[i][0], nodes[i][1]);
        if (d < bd) { bd = d; best = i; }
      }
      var name = best >= 0 ? nodes[best][2] : '（停留所なし）';
      var g = groups[name] || (groups[name] = { name: name, lost: 0, lost65: 0, meshes: 0, maxDist: 0 });
      g.lost += cells[k][1]; g.lost65 += cells[k][2]; g.meshes += 1;
      g.maxDist = Math.max(g.maxDist, Math.round(bd));
    });
    return Object.keys(groups).map(function (n) { return groups[n]; })
      .sort(function (a, b) { return b.lost - a.lost || (a.name < b.name ? -1 : 1); });
  }

  /* 変更前に、その条件で行ける人口（歩いて＋公共交通）と診断範囲の人口 */
  function baseline(cells, fi, day, per, need) {
    var o = { pop: 0, pop65: 0, reach: 0, reach65: 0 };
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      o.pop += c[1]; o.pop65 += c[2];
      if (reachable(cellStatus(c, fi, day, per, need))) { o.reach += c[1]; o.reach65 += c[2]; }
    }
    return o;
  }

  function pct(a, b) { return b > 0 ? Math.round((1000 * a) / b) / 10 : 0; }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;     // 表計算ソフトの数式として解釈されるのを避ける
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n';
  }

  return {
    DAYS: DAYS, PERIODS: PERIODS, DAY_LABEL: DAY_LABEL, PERIOD_LABEL: PERIOD_LABEL,
    meshBounds: meshBounds, condIndex: condIndex, needLevel: needLevel, cellStatus: cellStatus, reachable: reachable,
    lostCells: lostCells, baseline: baseline, planLoss: planLoss, groupByNearestStop: groupByNearestStop, distM: distM, pct: pct,
    csvCell: csvCell, toCsv: toCsv
  };
});
