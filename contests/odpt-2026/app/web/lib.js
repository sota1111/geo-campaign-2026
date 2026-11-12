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
  /* 休日は日曜のダイヤで計算している（基準日が日曜）。文章中ではこちらを使う */
  var DAY_FULL = { wd: '平日', hol: '休日（日曜ダイヤ）' };

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

  /* cell = [code, pop, pop65, levels, walkLevels, rail]。
     walkLevels は施設ごと1桁の文字列（徒歩だけで着ける水準。公共交通の水準と同じ尺度で、徒歩モデルと許容時間から求めたもの）。
     rail は 1 なら「GTFS未収録の鉄道駅から徒歩圏」。
     戻り値 'walk'（許容時間内に歩いて着く）| 'transit'（公共交通で着く）| 'rail'（着けないが鉄道駅が近く、鉄道は未評価）| 'none'（着けない） */
  function cellStatus(cell, fi, day, per, need) {
    if (+String(cell[4]).charAt(fi) >= need) return 'walk';
    var lv = +cell[3][condIndex(fi, day, per)];
    if (lv >= need) return 'transit';
    return cell[5] ? 'rail' : 'none';
  }

  function reachable(st) { return st === 'walk' || st === 'transit'; }

  /* 人口と65歳以上人口を状態別に集計 */
  function summarize(cells, fi, day, per, need) {
    var out = { pop: 0, walk: 0, transit: 0, rail: 0, none: 0, pop65: 0, walk65: 0, transit65: 0, rail65: 0, none65: 0 };
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

  /* 路線を止めた場合の差分。diffs=[[セル番号, 新しい水準文字列], ...]。
     徒歩で着く地区は変化しない。「行けていたのに行けなくなる」人口を数える */
  function lostPopulation(cells, diffs, fi, day, per, need) {
    var out = { lost: 0, lost65: 0, idx: {} };
    for (var i = 0; i < diffs.length; i++) {
      var k = diffs[i][0], c = cells[k];
      var after = [c[0], c[1], c[2], diffs[i][1], c[4], c[5]];
      var was = reachable(cellStatus(c, fi, day, per, need));
      var now = reachable(cellStatus(after, fi, day, per, need));
      if (was && !now) {
        out.lost += c[1];
        out.lost65 += c[2];
        out.idx[k] = 1;
      }
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
      var ratio = wd[3] > 0 ? '（平日の本数の' + Math.round((100 * hol[3]) / wd[3]) + '%）' : '';
      facts.push('休日は1日' + hol[3] + '本' + ratio + '、終発は' + fmtMin(hol[5]));
    } else {
      facts.push('休日の運行はありません');
    }
    return facts;
  }

  /* ---------- 結論の一言 ---------- */
  var WORD = { walk: '行けます（歩いて着ける距離。バスに乗らなくても可）', transit: '行けます（公共交通で）', rail: '行けません（収録した範囲では）', none: '行けません' };

  /* 診断状態 -> 「行けます／行けません」。startHours は {m:8,d:12,e:17}。cell が無ければ null */
  function verdict(cell, o) {
    if (!cell) return null;
    var need = needLevel(o.thresholds, o.w);
    var st = cellStatus(cell, o.fi, o.day, o.per, need);
    var other = o.day === 'wd' ? 'hol' : 'wd';
    var st2 = cellStatus(cell, o.fi, other, o.per, need);
    var hr = o.startHours[o.per];
    var cond = DAY_FULL[o.day] + PERIOD_LABEL[o.per] + hr + '時';
    var main = 'この地点から' + cond + 'に出発すると、' + o.facLabel + 'へ' + o.w + '分以内に ' + WORD[st];
    var cmp;
    var ocond = DAY_FULL[other] + 'の' + PERIOD_LABEL[o.per] + hr + '時発';
    if (st === st2) cmp = ocond + 'も同じ結果です。';
    else cmp = ocond + 'は ' + WORD[st2] + '。';
    var extra = st === 'rail' ? '近くに未収録の鉄道駅があり、鉄道を使えば行ける可能性があります（本アプリは未評価）。' : '';
    var short = DAY_LABEL[o.day] + PERIOD_LABEL[o.per] + hr + '時発・' + o.w + '分以内: ' + o.facLabel + 'へ ' + WORD[st];
    return { status: st, ok: reachable(st), otherStatus: st2, main: main, cmp: cmp, extra: extra, short: short };
  }

  /* 同名の停留所が近傍に複数あるとき、路線名で区別した表示名を返す。near=[{i,d}], routes=data.routes */
  function stopLabels(nodes, near, routes) {
    var count = {};
    near.forEach(function (o) { var n = nodes[o.i][2] || '(名称なし)'; count[n] = (count[n] || 0) + 1; });
    return near.map(function (o) {
      var n = nodes[o.i], name = n[2] || '(名称なし)';
      if (count[name] < 2) return name;
      var rs = n[5].slice(0, 2).map(function (r) { return routes[r][0]; });
      return name + '（' + (rs.length ? rs.join('・') + (n[5].length > 2 ? ' ほか' : '') + '方面' : '約' + Math.round(o.d) + 'm') + '）';
    });
  }

  /* ---------- 共有リンク（ハッシュ） ---------- */
  function writeHash(s) {
    var p = ['region=' + s.region, 'f=' + s.fi, 'd=' + s.day, 'p=' + s.per, 'w=' + s.w];
    if (s.route != null && s.route !== '') p.push('r=' + s.route);
    if (s.pt) p.push('pt=' + (+s.pt[0]).toFixed(5) + ',' + (+s.pt[1]).toFixed(5));
    return '#' + p.join('&');
  }

  /* 読めた項目だけを返す（不正な値は捨てる）。旧形式 #region=xxx も読める */
  function parseHash(h) {
    var out = {};
    String(h || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      var k = kv.slice(0, i), v = kv.slice(i + 1);
      if (k === 'region' && /^[a-z0-9_-]{1,40}$/.test(v)) out.region = v;
      else if (k === 'f' && /^\d{1,2}$/.test(v)) out.fi = +v;
      else if (k === 'd' && DAYS.indexOf(v) >= 0) out.day = v;
      else if (k === 'p' && PERIODS.indexOf(v) >= 0) out.per = v;
      else if (k === 'w' && /^\d{1,3}$/.test(v)) out.w = +v;
      else if (k === 'r' && /^\d{1,5}$/.test(v)) out.route = v;
      else if (k === 'pt') {
        var m = /^(-?\d{1,3}(?:\.\d+)?),(-?\d{1,2}(?:\.\d+)?)$/.exec(v);
        if (m && +m[1] >= 120 && +m[1] <= 155 && +m[2] >= 20 && +m[2] <= 46) out.pt = [+m[1], +m[2]];
      }
    });
    return out;
  }

  /* ---------- 地名検索（国土地理院 AddressSearch の応答） ---------- */
  function parseGsi(json) {
    if (!Array.isArray(json)) return [];
    var out = [];
    json.forEach(function (f) {
      var c = f && f.geometry && f.geometry.coordinates;
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) return;
      out.push({ lon: +c[0], lat: +c[1], title: String((f.properties && f.properties.title) || '') });
    });
    return out;
  }

  /* regions=index.json の regions。点を含む bbox の地域id（複数なら面積が小さい方）。無ければ null */
  function regionForPoint(regions, lon, lat) {
    var best = null, bestA = Infinity;
    regions.forEach(function (r) {
      var b = r.bbox;
      if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) {
        var a = (b[2] - b[0]) * (b[3] - b[1]);
        if (a < bestA) { best = r.id; bestA = a; }
      }
    });
    return best;
  }

  /* 「東京都区部（都営バス…）」-> 「東京都区部」 */
  /* 停留所名の部分一致（地名検索が使えない時の代わり）。同じ名前は1つにまとめる */
  function searchStops(nodes, q, limit) {
    var s = String(q || '').trim(), out = [], seen = {};
    limit = limit || 5;
    if (!s) return out;
    nodes.forEach(function (n, i) {
      if (n[2] && n[2].indexOf(s) >= 0 && !seen[n[2]] && out.length < limit) { seen[n[2]] = 1; out.push({ i: i, name: n[2] }); }
    });
    return out;
  }

  /* 住所らしい入力か（数字・「丁目」「番地」を含む）。住所では停留所名の部分一致を並べない */
  function looksLikeAddress(q) { return /[0-9０-９]|丁目|番地/.test(String(q || '')); }

  function shortName(name) { return String(name).replace(/（.*$/, ''); }

  /* ---------- 地域比較 ---------- */
  /* d=地域データ。行き先は名前(key)で合わせる。許容時間が無い地域は null */
  function compareRow(d, facKey, day, per, w) {
    var fi = d.facility_order.indexOf(facKey);
    if (fi < 0 || d.params.thresholds.indexOf(w) < 0) return null;
    var s = summarize(d.cells, fi, day, per, needLevel(d.params.thresholds, w));
    return { id: d.id, name: d.name, pop: s.pop, pop65: s.pop65, okPct: pct(s.walk + s.transit, s.pop),
      none: s.none, nonePct: pct(s.none, s.pop), none65: s.none65, none65Pct: pct(s.none65, s.pop65) };
  }

  /* 本アプリの開発者の連絡先（ガイドラインの通知③）。公開前に入れる（README の公開前チェックリスト）。ダッシュボード版 lib.ts の ODPT_CONTACT と同じ値にする */
  var ODPT_CONTACT = '';
  /* 公共交通オープンデータ開発者ガイドラインが一般ユーザへの通知を求める事項（出典・無保証・事業者へ問い合わせない・開発者の連絡先） */
  var ODPT_NOTICE = '本アプリが利用する公共交通データの一部は、公共交通オープンデータセンターにおいて提供されるものです。' +
    '公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。' +
    '本アプリの表示内容について、公共交通事業者への直接の問合せは行わないでください。' +
    (ODPT_CONTACT ? '本アプリに関するお問い合わせ: ' + ODPT_CONTACT : '');

  /* ---------- 出典の例文 ---------- */
  function citationText(d, o) {
    var seen = {}, parts = [];
    d.feeds.forEach(function (f) {
      var k = f.org + '|' + f.license;
      if (seen[k]) return;
      seen[k] = 1;
      parts.push(f.org + '（' + f.license + (f.credit ? '、' + f.credit : '') + '）');
    });
    var srcs = (d.coverage && d.coverage.sources || []).join('・');
    return '出典: 生活アクセス診断マップ（' + o.url + '、' + d.name + '、最終閲覧 ' + o.date + '）。' +
      '公共交通の時刻表は' + srcs + 'で公開されている次のGTFSデータを加工して利用: ' + parts.join('、') + '。' +
      '人口は令和2年国勢調査地域メッシュ統計（政府統計の総合窓口 e-Stat）、施設は国土数値情報（医療機関データ・学校データ、国土交通省）、' +
      '鉄道駅は国土数値情報（鉄道データ）、地図は地理院タイル、地名検索は国土地理院の地名検索APIを使用し、いずれも加工して作成。' +
      '診断は収録した事業者のデータだけに基づく（未収録の鉄道・デマンド交通・代替交通は考慮しない）。';
  }

  return {
    DAYS: DAYS, PERIODS: PERIODS, DAY_LABEL: DAY_LABEL, PERIOD_LABEL: PERIOD_LABEL, DAY_FULL: DAY_FULL,
    verdict: verdict, stopLabels: stopLabels, writeHash: writeHash, parseHash: parseHash, parseGsi: parseGsi,
    regionForPoint: regionForPoint, shortName: shortName, searchStops: searchStops, looksLikeAddress: looksLikeAddress, compareRow: compareRow, citationText: citationText,
    meshBounds: meshBounds, condIndex: condIndex, needLevel: needLevel,
    cellStatus: cellStatus, reachable: reachable, summarize: summarize, lostPopulation: lostPopulation, pct: pct, levelLabel: levelLabel,
    fmtMin: fmtMin, distM: distM, nearbyNodes: nearbyNodes, indexCells: indexCells,
    meshCodeAt: meshCodeAt, nodeFacts: nodeFacts, ODPT_NOTICE: ODPT_NOTICE, ODPT_CONTACT: ODPT_CONTACT
  };
});
