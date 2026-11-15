/* 観光客を避ける生活ルート: 画面に依存しない純粋関数（node でも試験できる）
 *
 * データ形式（web/data/kankou.json, build.py が作る）:
 *   stops [[lat, lon, name, feed]], spots [[lat, lon, name, kind]], tstop {停留所番号: 観光地点番号},
 *   routes [{name, feed, stops, tstops, share, spots, trips_wd, trips_hol}],
 *   patterns [[route, stops[], off[](先頭出発からの秒), dep_wd[], dep_hol[]]], table [[route, dt, hour, trips, visits]]
 *
 * 経路探索は RAPTOR（乗車回数ごとの最早到着）。徒歩は直線距離×迂回率÷歩行速度の概算（道路網は使わない）。
 */
(function (root) {
  'use strict';

  var WALK_MPS = 80 / 60;      /* 80 m/分（不動産の表示に関する公正競争規約の徒歩所要時間の基準） */
  var DETOUR = 1.25;           /* 直線距離に対する迂回率（仮定） */
  var MAX_WALK_IN = 600;       /* 出発地から乗車停留所まで（直線 m） */
  var MAX_WALK_OUT = 500;      /* 降車停留所から目的地まで（直線 m） */
  var MAX_XFER = 250;          /* 乗換の徒歩（直線 m） */
  var MAX_ROUNDS = 4;          /* 乗車回数の上限（乗換3回まで） */
  var INF = 1e9;
  var DEFAULTS = { share: 0.10, winStart: 9 * 3600, winEnd: 17 * 3600 };
  var DT_LABEL = { wd: '平日', hol: '休日' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function haversine(lat1, lon1, lat2, lon2) {
    var R = 6371008.8, rad = Math.PI / 180;
    var p1 = lat1 * rad, p2 = lat2 * rad, dp = p2 - p1, dl = (lon2 - lon1) * rad;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function walkSec(m) { return m * DETOUR / WALK_MPS; }

  /* 秒 -> "8:05"（24時超は 25:10 のまま） */
  function fmtClock(sec) {
    var m = Math.round(sec / 60);
    var h = Math.floor(m / 60), mm = m % 60;
    return h + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function fmtMin(sec) { return Math.round(sec / 60) + '分'; }

  /* ---- 近傍検索用の格子 ---- */
  function Grid(cellDeg) {
    this.c = cellDeg; this.m = {};
  }
  Grid.prototype.key = function (lat, lon) { return Math.floor(lat / this.c) + ',' + Math.floor(lon / this.c); };
  Grid.prototype.add = function (i, lat, lon) { var k = this.key(lat, lon); (this.m[k] = this.m[k] || []).push(i); };
  Grid.prototype.near = function (lat, lon, r, lats, lons) {
    var out = [], cy = Math.floor(lat / this.c), cx = Math.floor(lon / this.c);
    var span = Math.ceil(r / (this.c * 111320 * Math.cos(lat * Math.PI / 180))) + 1;
    span = Math.max(span, Math.ceil(r / (this.c * 111320)) + 1);
    for (var dy = -span; dy <= span; dy++) {
      for (var dx = -span; dx <= span; dx++) {
        var arr = this.m[(cy + dy) + ',' + (cx + dx)];
        if (!arr) continue;
        for (var j = 0; j < arr.length; j++) {
          var i = arr[j], d = haversine(lat, lon, lats[i], lons[i]);
          if (d <= r) out.push([i, d]);
        }
      }
    }
    out.sort(function (a, b) { return a[1] - b[1]; });
    return out;
  }

  /* ---- データの下準備 ---- */
  function prepare(data) {
    var n = data.stops.length;
    var lats = new Float64Array(n), lons = new Float64Array(n);
    var grid = new Grid(0.004);
    for (var i = 0; i < n; i++) { lats[i] = data.stops[i][0]; lons[i] = data.stops[i][1]; grid.add(i, lats[i], lons[i]); }
    var tflag = new Uint8Array(n), tspot = new Int32Array(n).fill(-1);
    Object.keys(data.tstop || {}).forEach(function (k) { tflag[+k] = 1; tspot[+k] = data.tstop[k]; });
    var pats = data.patterns.map(function (p) {
      return { route: p[0], stops: p[1], off: p[2], dep: { wd: p[3], hol: p[4] } };
    });
    var stopPat = new Array(n);
    for (i = 0; i < n; i++) stopPat[i] = [];
    pats.forEach(function (p, pi) {
      for (var j = 0; j < p.stops.length - 1; j++) stopPat[p.stops[j]].push([pi, j]);   /* 終点では乗らない */
    });
    var xfer = new Array(n);
    for (i = 0; i < n; i++) {
      xfer[i] = grid.near(lats[i], lons[i], MAX_XFER, lats, lons).filter(function (x) { return x[0] !== i; });
    }
    return { data: data, n: n, lats: lats, lons: lons, grid: grid, tflag: tflag, tspot: tspot, pats: pats, stopPat: stopPat, xfer: xfer };
  }

  /* 観光系統: 系統の停留所のうち観光地点に近い停留所の割合が share 以上 */
  function touristRoutes(net, share) {
    return net.data.routes.map(function (r) { return r.tstops > 0 && r.share >= share; });
  }

  /* 最初に乗れる便（先頭出発 + off[pos] >= tau）の添字。無ければ -1 */
  function firstTrip(deps, offPos, tau) {
    var lo = 0, hi = deps.length, target = tau - offPos;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (deps[mid] < target) lo = mid + 1; else hi = mid;
    }
    return lo < deps.length ? lo : -1;
  }

  function opt(o, k) { return o && o[k] != null ? o[k] : DEFAULTS[k]; }

  /* 出発地(lat,lon)・目的地(lat,lon)・出発時刻(秒)の最早到着経路。
   * opts: {dt, dep, avoid, share, winStart, winEnd}。
   * 戻り値: {options:[{rides, arrive, dur, legs}], walkOnly:{m, sec}|null}  options は乗車回数が増えるほど到着が早い（改善するものだけ） */
  function route(net, origin, dest, opts) {
    var dt = opts.dt || 'wd', dep = opts.dep, avoid = !!opts.avoid;
    var share = opt(opts, 'share'), ws = opt(opts, 'winStart'), we = opt(opts, 'winEnd');
    var troute = touristRoutes(net, share);
    var n = net.n;
    var tau = [], par = [], busTau = [], busPar = [];
    for (var k = 0; k <= MAX_ROUNDS; k++) {
      tau.push(new Float64Array(n).fill(INF)); par.push(new Array(n));
      busTau.push(new Float64Array(n).fill(INF)); busPar.push(new Array(n));
    }
    var best = new Float64Array(n).fill(INF);
    var marked = [];
    var starts = net.grid.near(origin.lat, origin.lon, MAX_WALK_IN, net.lats, net.lons);
    starts.forEach(function (s) {
      var t = dep + walkSec(s[1]);
      tau[0][s[0]] = t; best[s[0]] = t; par[0][s[0]] = { type: 'origin', m: s[1], sec: walkSec(s[1]) }; marked.push(s[0]);
    });
    var ends = net.grid.near(dest.lat, dest.lon, MAX_WALK_OUT, net.lats, net.lons);
    var endWalk = {};
    ends.forEach(function (e) { endWalk[e[0]] = e[1]; });

    for (k = 1; k <= MAX_ROUNDS; k++) {
      var qmin = {};   /* pattern -> 最初の marked 位置 */
      marked.forEach(function (s) {
        net.stopPat[s].forEach(function (pp) {
          var pi = pp[0], pos = pp[1];
          if (qmin[pi] == null || pos < qmin[pi]) qmin[pi] = pos;
        });
      });
      var newMarked = {};
      Object.keys(qmin).forEach(function (key) {
        var pi = +key, p = net.pats[pi], deps = p.dep[dt];
        if (!deps || !deps.length) return;
        var flagRoute = avoid && troute[p.route];
        var cur = -1, boardPos = -1, boardT = 0, seen = false;
        for (var i = qmin[pi]; i < p.stops.length; i++) {
          var s = p.stops[i];
          if (cur >= 0) {
            var ta = deps[cur] + p.off[i];
            if (flagRoute && boardT >= ws && boardT < we && net.tflag[s]) seen = true;
            var blocked = flagRoute && seen && boardT >= ws && boardT < we;
            if (!blocked && ta < best[s] && ta < tau[k][s]) {
              tau[k][s] = ta; best[s] = ta; newMarked[s] = 1;
              par[k][s] = { type: 'bus', pat: pi, trip: cur, from: boardPos, to: i };
              busTau[k][s] = ta; busPar[k][s] = par[k][s];
            }
          }
          var prev = tau[k - 1][s];
          if (prev < INF && i < p.stops.length - 1) {
            var ti = firstTrip(deps, p.off[i], prev);
            /* 同じ便でも、観光地点に近い停留所を通過済みで降りられない状態なら、ここで乗り直した（ここから乗る）扱いにする */
            if (ti >= 0 && (cur < 0 || ti < cur || (ti === cur && seen))) {
              cur = ti; boardPos = i; boardT = deps[ti] + p.off[i];
              seen = !!(flagRoute && net.tflag[s] && boardT >= ws && boardT < we);
            }
          }
        }
      });
      /* 乗換の徒歩（バスで着いた停留所からだけ。徒歩を2回続けない） */
      var busReached = Object.keys(newMarked).map(Number);
      busReached.forEach(function (s) {
        var base = busTau[k][s];
        net.xfer[s].forEach(function (x) {
          var t = base + walkSec(x[1]);
          if (t < best[x[0]] && t < tau[k][x[0]]) {
            tau[k][x[0]] = t; best[x[0]] = t; newMarked[x[0]] = 1;
            par[k][x[0]] = { type: 'walk', from: s, m: x[1], sec: walkSec(x[1]) };
          }
        });
      });
      marked = Object.keys(newMarked).map(Number);
      if (!marked.length) break;
    }

    /* 目的地までの到着を、乗車回数ごとに集める（改善するものだけ） */
    var options = [], bestSoFar = INF;
    for (k = 1; k <= MAX_ROUNDS; k++) {
      var bt = INF, bs = -1;
      Object.keys(endWalk).forEach(function (key) {
        var s = +key;
        if (tau[k][s] < INF) {
          var t = tau[k][s] + walkSec(endWalk[s]);
          if (t < bt) { bt = t; bs = s; }
        }
      });
      if (bs >= 0 && bt < bestSoFar - 59) {   /* 1分以上早くなる場合だけ別候補にする */
        bestSoFar = bt;
        options.push({ rides: k, arrive: bt, dur: bt - dep, legs: buildLegs(net, par, busPar, k, bs, origin, dest, endWalk[bs], dt) });
      }
    }
    var d = haversine(origin.lat, origin.lon, dest.lat, dest.lon);
    var wo = { m: d, sec: walkSec(d) };
    return { options: options, walkOnly: wo.sec <= 40 * 60 ? wo : null, walkDirect: wo };
  }

  function buildLegs(net, par, busPar, k, s, origin, dest, outM, dt) {
    var legs = [];
    legs.push({ type: 'walk', to: 'dest', m: outM, sec: walkSec(outM), toLL: [dest.lat, dest.lon], fromLL: [net.lats[s], net.lons[s]], fromName: net.data.stops[s][2], toName: '目的地' });
    var kk = k, cur = s;
    for (;;) {
      var p = par[kk][cur];
      if (!p) break;
      if (p.type === 'walk') {
        legs.push({ type: 'walk', m: p.m, sec: p.sec, fromLL: [net.lats[p.from], net.lons[p.from]], toLL: [net.lats[cur], net.lons[cur]],
          fromName: net.data.stops[p.from][2], toName: net.data.stops[cur][2] });
        cur = p.from;
        p = busPar[kk][cur];
      }
      if (!p) break;
      if (p.type === 'bus') {
        var pat = net.pats[p.pat], deps = pat.dep[dt], t0 = deps[p.trip];
        var ss = [];
        for (var i = p.from; i <= p.to; i++) ss.push(pat.stops[i]);
        legs.push({
          type: 'bus', route: net.data.routes[pat.route].name, routeIdx: pat.route, pat: p.pat,
          fromName: net.data.stops[pat.stops[p.from]][2], toName: net.data.stops[pat.stops[p.to]][2],
          dep: t0 + pat.off[p.from], arr: t0 + pat.off[p.to], stops: ss,
          fromLL: [net.lats[pat.stops[p.from]], net.lons[pat.stops[p.from]]], toLL: [net.lats[pat.stops[p.to]], net.lons[pat.stops[p.to]]]
        });
        cur = pat.stops[p.from]; kk -= 1;
        continue;
      }
      if (p.type === 'origin') {
        legs.push({ type: 'walk', m: p.m, sec: p.sec, fromLL: [origin.lat, origin.lon], toLL: [net.lats[cur], net.lons[cur]],
          fromName: '出発地', toName: net.data.stops[cur][2] });
      }
      break;
    }
    legs.reverse();
    return legs;
  }

  /* 経路の各バス区間が「観光系統の混雑を受けやすい」か。route() の avoid 判定と同じ条件
   * （観光系統 かつ 乗車時刻が観光時間帯 かつ 乗る区間が観光地点に近い停留所を含む）を、避けない経路にも当てはめる */
  function exposure(net, legs, opts) {
    var share = opt(opts, 'share'), ws = opt(opts, 'winStart'), we = opt(opts, 'winEnd');
    var troute = touristRoutes(net, share);
    var out = [];
    legs.forEach(function (l, idx) {
      if (l.type !== 'bus') return;
      var spots = [];
      l.stops.forEach(function (s) {
        if (net.tflag[s]) {
          var nm = net.data.spots[net.tspot[s]][2];
          if (spots.indexOf(nm) < 0) spots.push(nm);
        }
      });
      var inWin = l.dep >= ws && l.dep < we;
      var flagged = !!(troute[l.routeIdx] && inWin && spots.length);
      out.push({ leg: idx, route: l.route, flagged: flagged, spots: spots, routeIsTourist: !!troute[l.routeIdx], inWindow: inWin });
    });
    return out;
  }

  /* 経路の要約 */
  function summarize(net, opt0, opts) {
    var legs = opt0.legs, walk = 0, rides = 0;
    legs.forEach(function (l) { if (l.type === 'walk') walk += l.sec; else rides++; });
    var ex = exposure(net, legs, opts);
    return { dur: opt0.dur, rides: rides, transfers: Math.max(0, rides - 1), walk: walk,
      flaggedRoutes: ex.filter(function (e) { return e.flagged; }).map(function (e) { return e.route; }),
      touristSpots: ex.reduce(function (a, e) { e.spots.forEach(function (s) { if (a.indexOf(s) < 0) a.push(s); }); return a; }, []),
      exposure: ex };
  }

  /* 通常（避けない）と観光系統を避ける、の2つを同じ条件で求めて比較する */
  function compare(net, origin, dest, opts) {
    var o1 = {}, o2 = {};
    Object.keys(opts).forEach(function (k) { o1[k] = opts[k]; o2[k] = opts[k]; });
    o1.avoid = false; o2.avoid = true;
    var normal = route(net, origin, dest, o1), avoid = route(net, origin, dest, o2);
    var nBest = normal.options.length ? normal.options[normal.options.length - 1] : null;
    var aBest = avoid.options.length ? avoid.options[avoid.options.length - 1] : null;
    var res = { normal: normal, avoid: avoid, nBest: nBest, aBest: aBest, walkOnly: normal.walkOnly };
    res.nSum = nBest ? summarize(net, nBest, opts) : null;
    res.aSum = aBest ? summarize(net, aBest, opts) : null;
    res.aOptions = avoid.options.map(function (o) { return { opt: o, sum: summarize(net, o, opts) }; });
    res.nOptions = normal.options.map(function (o) { return { opt: o, sum: summarize(net, o, opts) }; });
    /* 通常経路がそもそも観光系統の影響を受けやすい区間を含まないなら、避けても同じ（避ける条件は通常の探索を制限するだけなので、到着は同じ）。
       同着で別の便・別経路が選ばれて紛らわしくならないよう、通常の経路をそのまま使う */
    res.sameRoute = !!(nBest && aBest && res.nSum.flaggedRoutes.length === 0);
    if (res.sameRoute) { res.aBest = nBest; res.aSum = res.nSum; res.aOptions = res.nOptions; }
    res.diffSec = res.nBest && res.aBest ? res.aBest.dur - res.nBest.dur : null;
    return res;
  }
  /* 出発時刻を変えて、通常と回避の所要時間を並べる（時間帯ごとの差） */
  function sweep(net, origin, dest, opts, hours) {
    return hours.map(function (h) {
      var o = {};
      Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
      o.dep = h * 3600;
      var r = compare(net, origin, dest, o);
      return { hour: h, normal: r.nBest ? r.nBest.dur : null, avoid: r.aBest ? r.aBest.dur : null,
        flagged: r.nSum ? r.nSum.flaggedRoutes.length > 0 : false };
    });
  }

  /* ---- 系統×時間帯の一覧 ---- */
  var CSV_HEAD = ['系統', '事業者フィード', '日種別', '時間帯(時)', '観光地点に近い停留所へ停車する便数',
    '観光地点に近い停留所への停車回数', '系統の停留所のうち観光地点に近い割合(%)', '系統が近くを通る観光地点'];

  /* opts: {share, dt('wd'|'hol'|'all'), hourFrom, hourTo, feed('all'|key)} -> 行（停車回数の多い順） */
  function tableRows(data, opts) {
    var share = opt(opts, 'share');
    var rows = [];
    data.table.forEach(function (t) {
      var r = data.routes[t[0]];
      if (r.share < share) return;
      if (opts.dt && opts.dt !== 'all' && t[1] !== opts.dt) return;
      if (opts.feed && opts.feed !== 'all' && r.feed !== opts.feed) return;
      if (opts.hourFrom != null && t[2] < opts.hourFrom) return;
      if (opts.hourTo != null && t[2] >= opts.hourTo) return;
      rows.push({ route: t[0], name: r.name, feed: r.feed, dt: t[1], hour: t[2], trips: t[3], visits: t[4], share: r.share,
        spots: r.spots.map(function (i) { return data.spots[i][2]; }) });
    });
    rows.sort(function (a, b) {
      return b.visits - a.visits || b.share - a.share || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.hour - b.hour;
    });
    return rows;
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    /* CSV インジェクション対策: 式として解釈されうる先頭文字には ' を付ける */
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function tableCsv(data, rows) {
    var feeds = {};
    data.feeds.forEach(function (f) { feeds[f.key] = f.name; });
    var lines = [CSV_HEAD.map(csvCell).join(',')];
    rows.forEach(function (r) {
      lines.push([r.name, feeds[r.feed] || r.feed, DT_LABEL[r.dt], r.hour, r.trips, r.visits, Math.round(r.share * 1000) / 10, r.spots.join('・')]
        .map(csvCell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* 系統ごとのまとめ（時間帯をまたいだ合計）。観光系統の一覧に使う */
  function routeRows(data, opts) {
    var share = opt(opts, 'share');
    var out = [];
    data.routes.forEach(function (r, i) {
      if (!(r.tstops > 0 && r.share >= share)) return;
      out.push({ route: i, name: r.name, feed: r.feed, share: r.share, tstops: r.tstops, stops: r.stops,
        trips: opts.dt === 'hol' ? r.trips_hol : r.trips_wd,
        spots: r.spots.map(function (j) { return data.spots[j][2]; }) });
    });
    out.sort(function (a, b) { return b.share - a.share || (a.name < b.name ? -1 : 1); });
    return out;
  }

  /* 目的地・出発地の候補検索（名称の部分一致） */
  function searchPlaces(data, q, limit) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    data.facilities.forEach(function (f, i) {
      if (f[2].toLowerCase().indexOf(q) >= 0) out.push({ kind: 'facility', i: i, lat: f[0], lon: f[1], name: f[2], tag: f[3] });
    });
    (data.spots || []).forEach(function (s, i) {
      if (s[2].toLowerCase().indexOf(q) >= 0) out.push({ kind: 'spot', i: i, lat: s[0], lon: s[1], name: s[2], tag: '観光地点' });
    });
    var seen = {};
    data.stops.forEach(function (s, i) {
      var nm = s[2];
      if (nm.toLowerCase().indexOf(q) >= 0 && !seen[nm]) { seen[nm] = 1; out.push({ kind: 'stop', i: i, lat: s[0], lon: s[1], name: nm, tag: 'バス停' }); }
    });
    // 名前が一致・前方一致するものを先に（施設が多くてもバス停が埋もれないように）
    function rank(p) { var n = p.name.toLowerCase(); return n === q ? 0 : (n.indexOf(q) === 0 ? 1 : 2); }
    out = out.map(function (p, k) { return [rank(p), p.name.length, k, p]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]; }).map(function (x) { return x[3]; });
    return out.slice(0, limit || 20);
  }

  var api = {
    esc: esc, haversine: haversine, walkSec: walkSec, fmtClock: fmtClock, fmtMin: fmtMin, prepare: prepare, touristRoutes: touristRoutes,
    route: route, compare: compare, exposure: exposure, summarize: summarize, sweep: sweep, tableRows: tableRows, tableCsv: tableCsv,
    routeRows: routeRows, searchPlaces: searchPlaces, csvCell: csvCell, firstTrip: firstTrip,
    CSV_HEAD: CSV_HEAD, DEFAULTS: DEFAULTS, DT_LABEL: DT_LABEL, WALK_MPS: WALK_MPS, DETOUR: DETOUR,
    MAX_WALK_IN: MAX_WALK_IN, MAX_WALK_OUT: MAX_WALK_OUT, MAX_XFER: MAX_XFER, MAX_ROUNDS: MAX_ROUNDS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KankouLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
