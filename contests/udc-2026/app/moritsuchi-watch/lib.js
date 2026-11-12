/* みんなの盛土ウォッチ: 地図に依存しない純粋なロジック（node でテスト可能） */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MW = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var KINDS = [
    { id: "crack", label: "亀裂・段差" },
    { id: "water", label: "湧水・水の濁り" },
    { id: "wall", label: "擁壁・のり面のふくらみ／変形" },
    { id: "haul", label: "土砂・資材の搬入や新しい盛り上がり" },
    { id: "slide", label: "崩れ・落石" },
    { id: "other", label: "その他" }
  ];
  var KIND_LABEL = {};
  KINDS.forEach(function (k) { KIND_LABEL[k.id] = k.label; });

  // 対象2市のデータが収まる範囲（熱海市・伊東市。余白つき）。範囲外判定に使う
  var COVERAGE = { west: 138.99, south: 34.88, east: 139.18, north: 35.17 };

  function inCoverage(lng, lat) {
    return lng >= COVERAGE.west && lng <= COVERAGE.east && lat >= COVERAGE.south && lat <= COVERAGE.north;
  }

  function haversine(lng1, lat1, lng2, lat2) {
    var R = 6371008.8, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function pointInRing(lng, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 点と線分の距離（m）。局所の平面近似（数km以内で十分）
  function distToSegment(lng, lat, a, b) {
    var kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110574;
    var px = 0, py = 0;
    var ax = (a[0] - lng) * kx, ay = (a[1] - lat) * ky;
    var bx = (b[0] - lng) * kx, by = (b[1] - lat) * ky;
    var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  // 最も近い大規模盛土造成地。inside=true なら範囲内（distM=0）
  function nearestFill(lng, lat, features) {
    var best = null;
    for (var f = 0; f < features.length; f++) {
      var ring = features[f].geometry.coordinates[0];
      var d, inside = pointInRing(lng, lat, ring);
      if (inside) d = 0;
      else {
        d = Infinity;
        for (var i = 0; i < ring.length - 1; i++) d = Math.min(d, distToSegment(lng, lat, ring[i], ring[i + 1]));
      }
      if (!best || d < best.distM) best = { id: features[f].properties.id, kind: features[f].properties.kind, city: features[f].properties.city, inside: inside, distM: d };
    }
    return best;
  }

  // 位置のぼかし: 小数3桁（約100m）に丸める。通報者保護のための任意機能
  function blur(v) { return Math.round(v * 1000) / 1000; }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function makeRecord(o) {
    var blurred = !!o.blurred;
    var lng = blurred ? blur(o.lng) : Math.round(o.lng * 1e5) / 1e5;
    var lat = blurred ? blur(o.lat) : Math.round(o.lat * 1e5) / 1e5;
    return {
      id: o.id,
      lng: lng, lat: lat,
      kind: KIND_LABEL[o.kind] ? o.kind : "other",
      memo: String(o.memo || "").slice(0, 500),
      observedAt: o.observedAt,
      blurred: blurred,
      nearFill: o.nearFill || null,
      outOfCoverage: !inCoverage(lng, lat)
    };
  }

  function toGeoJSON(records) {
    return {
      type: "FeatureCollection",
      name: "moritsuchi-watch-records",
      features: records.map(function (r) {
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [r.lng, r.lat] },
          properties: {
            id: r.id, kind: r.kind, kindLabel: KIND_LABEL[r.kind], memo: r.memo, observedAt: r.observedAt,
            blurred: r.blurred, nearFill: r.nearFill, outOfCoverage: r.outOfCoverage
          }
        };
      })
    };
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? "" : String(v);
    // CSVインジェクション対策: 式として解釈され得る先頭文字を無効化
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function toCSV(records) {
    var head = ["id", "observedAt", "kindLabel", "lat", "lng", "blurred", "nearFill", "nearFillDistM", "memo"];
    var rows = [head.map(csvCell).join(",")];
    records.forEach(function (r) {
      var nf = r.nearFill;
      rows.push([r.id, r.observedAt, KIND_LABEL[r.kind], r.lat, r.lng, r.blurred ? "yes" : "no",
        nf ? nf.id : "", nf ? Math.round(nf.distM) : "", r.memo].map(csvCell).join(","));
    });
    return "﻿" + rows.join("\r\n") + "\r\n";
  }

  // GeoJSON から記録を取り込む。不正なものは捨てる。{records, skipped}
  function fromGeoJSON(obj) {
    var out = [], skipped = 0;
    var feats = obj && obj.type === "FeatureCollection" && Array.isArray(obj.features) ? obj.features : [];
    feats.forEach(function (f) {
      try {
        var c = f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates : null;
        if (!c || typeof c[0] !== "number" || typeof c[1] !== "number" || !isFinite(c[0]) || !isFinite(c[1]) ||
          Math.abs(c[1]) > 90 || Math.abs(c[0]) > 180) { skipped++; return; }
        var p = f.properties || {};
        var nf = p.nearFill && typeof p.nearFill.id === "string" && isFinite(p.nearFill.distM)
          ? { id: p.nearFill.id.slice(0, 40), kind: String(p.nearFill.kind || "").slice(0, 20), city: String(p.nearFill.city || "").slice(0, 20), inside: !!p.nearFill.inside, distM: +p.nearFill.distM }
          : null;
        out.push(makeRecord({
          id: String(p.id || "imp-" + out.length).slice(0, 60),
          lng: c[0], lat: c[1], kind: p.kind, memo: p.memo,
          observedAt: String(p.observedAt || "").slice(0, 32), blurred: !!p.blurred, nearFill: nf
        }));
      } catch (e) { skipped++; }
    });
    return { records: out, skipped: skipped };
  }

  function distText(nf) {
    if (!nf) return "近くに登録された大規模盛土造成地データはありません";
    if (nf.inside) return "大規模盛土造成地「" + nf.id + "」（" + nf.kind + "）の範囲内";
    return "大規模盛土造成地「" + nf.id + "」（" + nf.kind + "）から約" + (nf.distM < 100 ? Math.round(nf.distM / 10) * 10 : Math.round(nf.distM / 50) * 50) + "m";
  }

  // 自治体窓口に伝えるための通報文のたたき台。送信はしない（コピーして各窓口へ）
  function reportText(r) {
    var lines = [
      "【盛土の変化に関する情報提供（たたき台）】",
      "気づいた日時: " + r.observedAt,
      "場所（緯度,経度）: " + r.lat + "," + r.lng + (r.blurred ? "（約100mにぼかした位置。詳しい場所は電話等でお伝えします）" : ""),
      "地図: https://maps.gsi.go.jp/#17/" + r.lat + "/" + r.lng + "/",
      "気づいた内容: " + KIND_LABEL[r.kind],
      "状況: " + (r.memo || "（記入なし）"),
      "国の大規模盛土造成地データとの位置関係: " + distText(r.nearFill),
      "撮影は公道など立ち入ってよい場所から行い、個人が特定される写真は添付しません。",
      "※盛土造成地であること自体は、直ちに危険であることを意味しません。危険かどうかの判定はしていません。"
    ];
    if (r.outOfCoverage) lines.splice(7, 0, "※この位置は本アプリの対象範囲（熱海市・伊東市）の外です。大規模盛土造成地データとの比較はできていません。");
    return lines.join("\n");
  }

  // URLハッシュ: #z=15.0&lat=35.1&lng=139.07&base=std&old=gazo1&op=50
  var BASES = ["std", "pale", "photo"];
  var OLDS = ["none", "ort_old10", "gazo1"];
  function formatHash(s) {
    return "#z=" + s.z.toFixed(1) + "&lat=" + s.lat.toFixed(5) + "&lng=" + s.lng.toFixed(5) +
      "&base=" + s.base + "&old=" + s.old + "&op=" + Math.round(s.op);
  }
  function parseHash(h, def) {
    var s = { z: def.z, lat: def.lat, lng: def.lng, base: def.base, old: def.old, op: def.op };
    String(h || "").replace(/^#/, "").split("&").forEach(function (kv) {
      var p = kv.split("="), k = p[0], v = p[1];
      if (v === undefined) return;
      var n = parseFloat(v);
      if (k === "z" && isFinite(n) && n >= 5 && n <= 18) s.z = n;
      else if (k === "lat" && isFinite(n) && n >= -90 && n <= 90) s.lat = n;
      else if (k === "lng" && isFinite(n) && n >= -180 && n <= 180) s.lng = n;
      else if (k === "base" && BASES.indexOf(v) >= 0) s.base = v;
      else if (k === "old" && OLDS.indexOf(v) >= 0) s.old = v;
      else if (k === "op" && isFinite(n) && n >= 0 && n <= 100) s.op = n;
    });
    return s;
  }

  return {
    KINDS: KINDS, KIND_LABEL: KIND_LABEL, COVERAGE: COVERAGE, inCoverage: inCoverage,
    haversine: haversine, pointInRing: pointInRing, distToSegment: distToSegment, nearestFill: nearestFill,
    blur: blur, fmtDate: fmtDate, makeRecord: makeRecord, toGeoJSON: toGeoJSON, toCSV: toCSV,
    fromGeoJSON: fromGeoJSON, reportText: reportText, distText: distText,
    formatHash: formatHash, parseHash: parseHash
  };
});
