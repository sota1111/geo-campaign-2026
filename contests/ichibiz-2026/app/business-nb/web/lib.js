/* 回収圏計画（デモ）の計算。画面に依存しない（node でも動く）。
 * 入力の行: [lat, lon, kw, start_ym, fit_end_ym, cert_ym, precision, muni]（data/plants.json）。
 * ここでの「廃棄時期」は、運転開始年月などからの【仮説による推定】で、実際の撤去時期ではない。
 * 距離は直線距離（道路距離ではない）。重さ（トン）への換算はしない（出力 kW のまま扱う）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Nb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 6371.0088;
  function rad(d) { return d * Math.PI / 180; }
  function distKm(lat1, lon1, lat2, lon2) {
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* 廃棄時期の置き方（すべて仮説）。
   *  {type:'fit'}            … 調達期間（FIT）の終了年。データの列にある。終了時点で撤去する最も早い置き方。列が空なら運転開始＋20年。
   *  {type:'life', years:N}  … 運転開始年＋N年。N は利用者が置く仮の値。 */
  var Y_MIN = 2000, Y_MAX = 2100; // これを外れる年は壊れた値として扱う（年別の配列が膨らまないように）
  function okYear(y) { return isFinite(y) && y >= Y_MIN && y <= Y_MAX; }
  function disposalYear(row, basis) {
    var startY = Math.floor(row[3] / 100);
    if (!okYear(startY)) return null;
    var y;
    if (basis.type === 'fit') y = row[4] ? Math.floor(row[4] / 100) : startY + 20;
    else y = startY + basis.years;
    return okYear(y) ? y : null;
  }
  function hasPos(r) { return typeof r[0] === 'number' && typeof r[1] === 'number' && isFinite(r[0]) && isFinite(r[1]); }
  function kwOf(r) { return typeof r[2] === 'number' && isFinite(r[2]) ? r[2] : 0; }

  function nearestSite(lat, lon, sites) {
    var best = -1, bd = Infinity;
    for (var i = 0; i < sites.length; i++) {
      var d = distKm(lat, lon, sites[i].lat, sites[i].lon);
      if (d < bd) { bd = d; best = i; }
    }
    return { site: best, km: bd };
  }

  /* opts: {basis, cutoff, radiusKm}。cutoff 年までに出る（廃棄時期の推定が cutoff 以前の）設備を「対象」とする。
   * 位置が欠けた設備は距離・圏外の計算から除く（total.noPos に件数）。施設が0件なら距離は出さず、すべて圏外とする（total.noSites=true）。
   * kW が欠けた設備は0kWとして数える。total.kwKm は、距離が出せた設備の出力（平均距離の分母）。
   * minYear: 廃棄時期の推定が最も早い設備の年（対象が0件のとき、理由の表示に使う）。 */
  function analyze(rows, munis, sites, opts) {
    var nS = sites.length;
    var bySite = sites.map(function () { return { plants: 0, kw: 0, kmKw: 0, kmMax: 0, outPlants: 0, outKw: 0 }; });
    var tot = { plants: 0, kw: 0, kmKw: 0, kwKm: 0, kmMax: 0, outPlants: 0, outKw: 0, allPlants: rows.length, allKw: 0, noPos: 0, noSites: nS === 0 };
    var yearly = {};
    var muniAgg = munis.map(function () { return { plants: 0, kw: 0, kmKw: 0, kwKm: 0, outKw: 0 }; });
    var items = new Array(rows.length);
    var minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], kw = kwOf(r);
      var y = disposalYear(r, opts.basis);
      var placed = hasPos(r);
      var ns = placed && nS > 0 ? nearestSite(r[0], r[1], sites) : { site: -1, km: null };
      var out = placed ? (nS === 0 ? true : ns.km > opts.radiusKm) : false;
      items[i] = { year: y, site: ns.site, km: ns.km, inCut: y !== null && y <= opts.cutoff, out: out };
      tot.allKw += kw;
      if (y === null) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      var ye = yearly[y] || (yearly[y] = { year: y, kw: 0, plants: 0, bySite: new Array(nS).fill(0), outKw: 0 });
      ye.kw += kw; ye.plants += 1;
      if (ns.site >= 0) ye.bySite[ns.site] += kw;
      if (out) ye.outKw += kw;
      if (y > opts.cutoff) continue;
      tot.plants += 1; tot.kw += kw;
      var m = muniAgg[r[7]];
      if (m) { m.plants += 1; m.kw += kw; }
      if (!placed) { tot.noPos += 1; continue; }
      if (ns.site >= 0) {
        var s = bySite[ns.site];
        s.plants += 1; s.kw += kw; s.kmKw += kw * ns.km; if (ns.km > s.kmMax) s.kmMax = ns.km;
        tot.kmKw += kw * ns.km; tot.kwKm += kw; if (ns.km > tot.kmMax) tot.kmMax = ns.km;
        if (m) { m.kmKw += kw * ns.km; m.kwKm += kw; }
      }
      if (out) {
        tot.outPlants += 1; tot.outKw += kw;
        if (ns.site >= 0) { bySite[ns.site].outPlants += 1; bySite[ns.site].outKw += kw; }
        if (m) m.outKw += kw;
      }
    }
    var ylist = [];
    if (minY !== Infinity) for (var yy = minY; yy <= maxY; yy++) ylist.push(yearly[yy] || { year: yy, kw: 0, plants: 0, bySite: new Array(nS).fill(0), outKw: 0 });
    return {
      items: items, bySite: bySite, total: tot, yearly: ylist, minYear: minY === Infinity ? null : minY,
      munis: munis.map(function (name, k) { return { name: name, plants: muniAgg[k].plants, kw: muniAgg[k].kw, outKw: muniAgg[k].outKw, avgKm: muniAgg[k].kwKm ? muniAgg[k].kmKw / muniAgg[k].kwKm : 0 }; })
        .filter(function (m) { return m.plants > 0; })
        .sort(function (a, b) { return b.kw - a.kw; })
    };
  }

  /* 追加拠点を1つ置くなら、距離（kW重み付き）の合計が最も減る町字はどこか。町字の代表点（precision 0）だけを候補にする。
   * 距離だけの目安。用地・許可・道路・受入能力は見ていない。 */
  function suggestSite(rows, sites, opts) {
    var targets = [];
    if (!sites.length) return null;
    for (var i = 0; i < rows.length; i++) {
      var y = disposalYear(rows[i], opts.basis);
      if (y !== null && y <= opts.cutoff && hasPos(rows[i])) targets.push({ lat: rows[i][0], lon: rows[i][1], kw: kwOf(rows[i]), d0: nearestSite(rows[i][0], rows[i][1], sites).km });
    }
    if (!targets.length) return null; // 対象が0件なら、どこに置いても同じ（意味のある候補がない）
    var seen = {}, cands = [];
    rows.forEach(function (r) { if (r[6] === 0 && hasPos(r)) { var k = r[0] + ',' + r[1]; if (!seen[k]) { seen[k] = 1; cands.push([r[0], r[1]]); } } });
    var base = 0;
    targets.forEach(function (t) { base += t.kw * t.d0; });
    var best = null;
    cands.forEach(function (c) {
      var sum = 0;
      for (var j = 0; j < targets.length; j++) {
        var t = targets[j];
        var d = distKm(c[0], c[1], t.lat, t.lon);
        sum += t.kw * (d < t.d0 ? d : t.d0);
      }
      if (best === null || sum < best.sum) best = { lat: c[0], lon: c[1], sum: sum };
    });
    if (!best) return null;
    return { lat: best.lat, lon: best.lon, reducedKmKw: base - best.sum, baseKmKw: base };
  }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n') + '\r\n'; }

  return { distKm: distKm, disposalYear: disposalYear, nearestSite: nearestSite, analyze: analyze, suggestSite: suggestSite, csvCell: csvCell, toCsv: toCsv };
});
