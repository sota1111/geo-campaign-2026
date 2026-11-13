/* 夜も使えるAED診断マップ: 地図に依存しない純粋なロジック（node でテスト可能） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AN = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAYS = ["月", "火", "水", "木", "金", "土", "日"];
  var RADII = [300, 500, 800];
  var DEF = { m: "machida", d: 0, t: 180, r: 500, mode: "strict" };
  /* AED レコードの種別: 0=24時間 1=時間指定 2=不明 3=曜日が空欄で時刻だけある（毎日と仮定した場合のみ使える）
     4=一般の人が使えない設置位置（救急車内・病室・診察室・医務室など）。どのモードでも「使える」に数えない */
  var K24 = 0, KTIMED = 1, KUNKNOWN = 2, KASSUMED = 3, KNONPUBLIC = 4;
  /* 最大見積でも、夜間（22時〜翌6時）に使える根拠がない不明の理由（施設の開館時間・条件付き・季節別・終日の意味が不明など） */
  var NIGHT_NO = { facility: 1, conditional: 1, seasonal: 1, closure: 1, allday: 1, multi: 1 };
  var NIGHT_FROM = 22 * 60, NIGHT_TO = 6 * 60;
  var REASON_LABEL = {
    empty: "曜日・時間とも未記入",
    facility: "「施設の開館時間」など時刻が書かれていない",
    conditional: "「学校使用時のみ」「施錠」など条件付きで時刻が読めない",
    allday: "「終日」だけで、24時間か開館中かが区別できない",
    seasonal: "季節や月で時間が変わる記載",
    closure: "休館日以外、とあるが休みの曜日が書かれていない",
    multi: "複数の設置箇所の条件が混ざった記載",
    no_time: "曜日だけで時刻がない",
    no_day: "時刻だけで曜日がない",
    garbled: "解釈できない記載",
    bad_range: "時刻の範囲が不正"
  };

  /* aed = [muni, lat, lon, name, place, kind, payload, note]。mode: "strict"（確認できたものだけ）/ "max"（不明も使えるとみなす最大見積） */
  function isUsable(aed, day, minute, mode) {
    var kind = aed[5];
    if (kind === K24) return true;
    if (kind === KTIMED) return inWindows(aed[6], day, minute);
    if (kind === KNONPUBLIC) return false;
    if (mode !== "max") return false;
    if (kind === KUNKNOWN && NIGHT_NO[aed[6]] && (minute >= NIGHT_FROM || minute < NIGHT_TO)) return false;
    return true;
  }
  function inWindows(wins, day, minute) {
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if ((w[0] >> day) & 1 && w[1] <= minute && minute < w[2]) return true;
    }
    return false;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* 格子索引（0.01度≒1km）。points は {lat, lon} 配列 */
  function buildIndex(points, step) {
    step = step || 0.01;
    var map = {};
    points.forEach(function (p, i) {
      var k = Math.floor(p.lat / step) + "," + Math.floor(p.lon / step);
      (map[k] || (map[k] = [])).push(i);
    });
    return { step: step, map: map, points: points };
  }
  function nearby(index, lat, lon, meters) {
    var step = index.step;
    var dLat = meters / 110574 + 1e-9, dLon = meters / (111320 * Math.cos(lat * Math.PI / 180)) + 1e-9;
    var out = [];
    for (var a = Math.floor((lat - dLat) / step); a <= Math.floor((lat + dLat) / step); a++) {
      for (var b = Math.floor((lon - dLon) / step); b <= Math.floor((lon + dLon) / step); b++) {
        var cell = index.map[a + "," + b];
        if (cell) for (var i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
  /* 半径 meters 以内で最も近い点までの距離。なければ null */
  function nearestWithin(index, lat, lon, meters) {
    var best = null, ids = nearby(index, lat, lon, meters);
    for (var i = 0; i < ids.length; i++) {
      var p = index.points[ids[i]];
      var d = haversine(lat, lon, p.lat, p.lon);
      if (d <= meters && (best === null || d < best)) best = d;
    }
    return best;
  }

  /* cells = [muni, code, lat, lon, pop, edge, area]（1自治体分）。aeds = その自治体のAED。 */
  function coverage(cells, aeds, day, minute, radius, mode) {
    var usable = aeds.filter(function (a) { return isUsable(a, day, minute, mode); });
    var idx = buildIndex(usable.map(function (a) { return { lat: a[1], lon: a[2] }; }));
    var covered = new Uint8Array(cells.length), dist = new Float64Array(cells.length);
    var popIn = 0, popOut = 0, popOutCore = 0, popCore = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var d = nearestWithin(idx, c[2], c[3], radius);
      covered[i] = d === null ? 0 : 1;
      dist[i] = d === null ? -1 : d;
      if (covered[i]) popIn += c[4]; else popOut += c[4];
      if (!c[5]) { popCore += c[4]; if (!covered[i]) popOutCore += c[4]; }
    }
    var seen = {}, sites = 0;
    usable.forEach(function (a) { var k = a[1] + "," + a[2]; if (!seen[k]) { seen[k] = 1; sites++; } });
    return { usable: usable, sites: sites, empty: cells.length === 0, covered: covered, dist: dist, popIn: popIn, popOut: popOut,
      popTotal: popIn + popOut, popOutCore: popOutCore, popCore: popCore };
  }

  /* 月〜金（0..4）それぞれの圏外の割合の最小・最大。core=true は市境から800m以内を除いた人口での割合。
     「平日」は月曜だけで代表させない（月曜は祝日・休館が多く、平日で最も条件が悪くなりやすい） */
  function weekdayRange(cells, aeds, minute, radius, mode, core) {
    var lo = null, hi = null, loD = 0, hiD = 0;
    for (var d = 0; d < 5; d++) {
      var c = coverage(cells, aeds, d, minute, radius, mode);
      var den = core ? c.popCore : c.popTotal, num = core ? c.popOutCore : c.popOut;
      var sh = den ? num / den : 0;
      if (lo === null || sh < lo) { lo = sh; loD = d; }
      if (hi === null || sh > hi) { hi = sh; hiD = d; }
    }
    return { min: lo, max: hi, minDay: loD, maxDay: hiD };
  }

  /* 1台足すと: 点 (lat,lon) に24時間使えるAEDを置いたとき、新たに圏内に入る人口 */
  function gainAt(cells, covered, lat, lon, radius) {
    var gain = 0, n = 0;
    for (var i = 0; i < cells.length; i++) {
      if (covered[i]) continue;
      if (haversine(lat, lon, cells[i][2], cells[i][3]) <= radius) { gain += cells[i][4]; n++; }
    }
    return { pop: gain, cells: n };
  }

  /* 設置先候補: 圏外のメッシュ中心を候補として、新たに入る人口が大きい順に貪欲に選ぶ（選んだ後はその圏内を埋める） */
  function topCandidates(cells, covered, radius, n) {
    var cov = Uint8Array.from(covered);
    var gapIdx = [];
    for (var i = 0; i < cells.length; i++) if (!cov[i]) gapIdx.push(i);
    var idx = buildIndex(gapIdx.map(function (i) { return { lat: cells[i][2], lon: cells[i][3] }; }));
    var out = [];
    for (var k = 0; k < n; k++) {
      var best = null;
      for (var g = 0; g < gapIdx.length; g++) {
        var ci = gapIdx[g];
        if (cov[ci]) continue;
        var near = nearby(idx, cells[ci][2], cells[ci][3], radius), gain = 0;
        for (var j = 0; j < near.length; j++) {
          var cj = gapIdx[near[j]];
          if (!cov[cj] && haversine(cells[ci][2], cells[ci][3], cells[cj][2], cells[cj][3]) <= radius) gain += cells[cj][4];
        }
        if (best === null || gain > best.pop) best = { i: ci, pop: gain };
      }
      if (!best || best.pop <= 0) break;
      var c = cells[best.i];
      out.push({ rank: k + 1, lat: c[2], lon: c[3], pop: best.pop, area: c[6], edge: c[5], code: c[1] });
      var near2 = nearby(idx, c[2], c[3], radius);
      for (var j2 = 0; j2 < near2.length; j2++) {
        var cj2 = gapIdx[near2[j2]];
        if (haversine(c[2], c[3], cells[cj2][2], cells[cj2][3]) <= radius) cov[cj2] = 1;
      }
    }
    return out;
  }

  /* 地区別の集計。areas は名前配列。戻り値は圏外人口の多い順 */
  function areaTable(cells, covered, areas, excludeEdge) {
    var t = {};
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (excludeEdge && c[5]) continue;
      var a = t[c[6]] || (t[c[6]] = { area: c[6], name: areas[c[6]], pop: 0, out: 0, cells: 0, outCells: 0, edge: 0, latS: 0, lonS: 0 });
      a.pop += c[4]; a.cells++; a.latS += c[2] * c[4]; a.lonS += c[3] * c[4];
      if (c[5]) a.edge++;
      if (!covered[i]) { a.out += c[4]; a.outCells++; }
    }
    var rows = Object.keys(t).map(function (k) {
      var a = t[k];
      a.lat = a.pop ? a.latS / a.pop : 0; a.lon = a.pop ? a.lonS / a.pop : 0;
      a.share = a.pop ? a.out / a.pop : 0;
      delete a.latS; delete a.lonS;
      return a;
    });
    rows.sort(function (x, y) { return y.out - x.out || y.share - x.share || x.name.localeCompare(y.name); });
    return rows;
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;  // 表計算ソフトでの式実行を避ける
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(header, rows) {
    return "﻿" + [header].concat(rows).map(function (r) { return r.map(csvCell).join(","); }).join("\r\n") + "\r\n";
  }

  function hhmm(minute) {
    var h = Math.floor(minute / 60), m = minute % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  function whenLabel(day, minute) { return DAYS[day] + "曜 " + hhmm(minute); }

  /* URL ハッシュ: #m=machida&d=0&t=180&r=500&mode=strict */
  function formatHash(v) {
    return "#m=" + encodeURIComponent(v.m) + "&d=" + v.d + "&t=" + v.t + "&r=" + v.r + "&mode=" + v.mode;
  }
  function parseHash(h, ids) {
    var out = { m: DEF.m, d: DEF.d, t: DEF.t, r: DEF.r, mode: DEF.mode };
    String(h || "").replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("="), k = p[0], v = "";
      try { v = decodeURIComponent(p[1] || ""); } catch (e) { return; } /* 途中で切れた共有URLでも既定値で起動する */
      if (k === "m" && (!ids || ids.indexOf(v) >= 0)) out.m = v;
      else if (k === "d" && /^[0-6]$/.test(v)) out.d = +v;
      else if (k === "t" && /^\d+$/.test(v) && +v >= 0 && +v < 1440) out.t = +v;
      else if (k === "r" && RADII.indexOf(+v) >= 0) out.r = +v;
      else if (k === "mode" && (v === "strict" || v === "max")) out.mode = v;
    });
    return out;
  }

  /* AED の利用可能時間を人が読める文字列にする */
  function windowsText(aed) {
    var kind = aed[5], p = aed[6];
    if (kind === K24) return "24時間（毎日）";
    if (kind === KNONPUBLIC) return "一般の人が使えない設置位置（救急車内・病室・診察室・医務室など）。台数に数えていません";
    if (kind === KUNKNOWN) return "不明（" + (REASON_LABEL[p] || "解釈できない記載") + "）";
    var parts = p.map(function (w) {
      var ds = "";
      for (var d = 0; d < 7; d++) if ((w[0] >> d) & 1) ds += DAYS[d];
      if (w[0] === 127) ds = "毎日";
      return ds + " " + hhmm(w[1]) + "–" + (w[2] >= 1440 ? "24:00" : hhmm(w[2]));
    });
    var s = parts.join("、");
    return kind === KASSUMED ? "曜日の記載なし。毎日と仮定すると " + s : s;
  }

  /* 時間表記の集計（画面の「時間表記を読めた割合」）。kinds = {"24h":n,"timed":n,"unknown":n} */
  function readableShare(kinds) {
    var total = kinds["24h"] + kinds.timed + kinds.unknown; /* 一般の人が使えない設置位置（nonpublic）は分母に入れない */
    return total ? (kinds["24h"] + kinds.timed) / total : 0;
  }

  return {
    DAYS: DAYS, RADII: RADII, DEF: DEF, REASON_LABEL: REASON_LABEL, K24: K24, KTIMED: KTIMED, KUNKNOWN: KUNKNOWN, KASSUMED: KASSUMED, KNONPUBLIC: KNONPUBLIC,
    isUsable: isUsable, inWindows: inWindows, haversine: haversine, buildIndex: buildIndex, nearestWithin: nearestWithin,
    coverage: coverage, weekdayRange: weekdayRange, gainAt: gainAt, topCandidates: topCandidates, areaTable: areaTable,
    csvCell: csvCell, toCSV: toCSV, hhmm: hhmm, whenLabel: whenLabel, formatHash: formatHash, parseHash: parseHash,
    readableShare: readableShare, windowsText: windowsText
  };
});
