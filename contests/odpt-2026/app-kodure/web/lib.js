/* 子連れお出かけ診断: 画面に依存しない純粋関数（node でもテストできる） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var QUANT = 5;                      /* 所要時間は5分刻み（切り上げ）で持つ */
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

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

  /* ビルドが出力する RLE 文字列 -> 符号(0..18)の配列。'3B1A' = 0,0,0,2,0,1（0の長さは10進数、符号は A=1,B=2…） */
  function rleDecode(s, n) {
    var row = new Uint8Array(n), i = 0, j = 0;
    while (j < s.length) {
      var ch = s.charCodeAt(j);
      if (ch >= 48 && ch <= 57) {
        var k = j;
        while (k < s.length && s.charCodeAt(k) >= 48 && s.charCodeAt(k) <= 57) k++;
        i += parseInt(s.slice(j, k), 10);
        j = k;
      } else {
        row[i++] = LETTERS.indexOf(s[j]) + 1;
        j++;
      }
    }
    return row;
  }

  function fileName(dir, hour, cap, layer) {
    return 'm_' + dir + hour + '_c' + cap + '_t' + layer + '.json';
  }

  /* 符号 -> 分（5分刻みの上限）。0 は到達できない */
  function minutesOf(code) { return code > 0 ? code * QUANT : null; }

  /* mats = { o: [層1の行列, 層2, 層3], r: [...] }。行列[dest][cell] は符号。layer は 1..3（使える乗車回数の層） */
  function code(mats, dir, layer, d, c) {
    return mats[dir][layer - 1][d][c];
  }

  function within(codeV, w) { return codeV > 0 && codeV * QUANT <= w; }

  /* 地区 c から行き先 d への、行き・帰りの所要（分）。layer=許容する乗車回数の層 */
  function pair(mats, layer, d, c) {
    return { out: minutesOf(code(mats, 'o', layer, d, c)), ret: minutesOf(code(mats, 'r', layer, d, c)) };
  }

  /* 行き帰りとも許容時間 w 分以内か / 片道だけか / どちらも無理か */
  function pairStatus(mats, layer, d, c, w) {
    var o = within(code(mats, 'o', layer, d, c), w), r = within(code(mats, 'r', layer, d, c), w);
    return o && r ? 'both' : (o || r ? 'one' : 'none');
  }

  /* その方向で w 分以内に着ける最少の乗換回数（0, 1, 2=2回以上）。着けなければ -1。
     層1=乗換0回、層2=1回まで、層3=制限なし。「2」は乗換が2回以上必要という意味 */
  function minTransfers(mats, dir, d, c, w) {
    for (var k = 1; k <= 3; k++) if (within(code(mats, dir, k, d, c), w)) return k - 1;
    return -1;
  }

  /* 行き先 d を選んだときの各地区の状態 'both'|'one'|'none'|'rail'（none で鉄道駅が近い地区は rail=未評価） */
  function statusesForDest(mats, layer, d, cells, w) {
    var out = new Array(cells.length);
    for (var c = 0; c < cells.length; c++) {
      var st = pairStatus(mats, layer, d, c, w);
      out[c] = st === 'none' && cells[c][3] ? 'rail' : st;
    }
    return out;
  }

  /* 行き先 dests（番号の配列）のうち、行き帰りとも w 分以内に着ける数 */
  function countBoth(mats, layer, dests, c, w) {
    var n = 0;
    for (var i = 0; i < dests.length; i++) if (pairStatus(mats, layer, dests[i], c, w) === 'both') n++;
    return n;
  }

  /* 行き先の数の区分（東京都区部の分布を見て決めた区切り: 1〜4 / 5〜19 / 20以上） */
  var BUCKET_LABEL = { n0: '0か所', n1: '1〜4か所', n2: '5〜19か所', n3: '20か所以上' };
  function bucketOf(n) { return n >= 20 ? 'n3' : (n >= 5 ? 'n2' : (n >= 1 ? 'n1' : 'n0')); }

  /* 行き先を選んでいないとき: 行き帰りとも行ける行き先の数で 'n0'(0)|'n1'(1〜4)|'n2'(5〜19)|'n3'(20以上)。n0 で鉄道が近ければ 'rail' */
  function statusesForCounts(mats, layer, dests, cells, w) {
    var out = new Array(cells.length);
    for (var c = 0; c < cells.length; c++) {
      var b = bucketOf(countBoth(mats, layer, dests, c, w));
      out[c] = b === 'n0' && cells[c][3] ? 'rail' : b;
    }
    return out;
  }

  /* 状態別の人口・0〜14歳人口。cells=[code, pop, pop0_14, rail] */
  function summarize(cells, statuses) {
    var o = { pop: 0, kids: 0, by: {} };
    for (var c = 0; c < cells.length; c++) {
      var s = statuses[c];
      if (!o.by[s]) o.by[s] = { pop: 0, kids: 0, cells: 0 };
      o.by[s].pop += cells[c][1];
      o.by[s].kids += cells[c][2];
      o.by[s].cells++;
      o.pop += cells[c][1];
      o.kids += cells[c][2];
    }
    return o;
  }

  function pct(a, b) { return b > 0 ? Math.round((1000 * a) / b) / 10 : 0; }

  /* 地区 c の行き先一覧。両方向とも w 分以内のものを「行き帰りOK」、片道だけのものを別に返す。
     dests=行き先の番号の配列。戻り値の各要素 {d, out, ret, status, tOut, tRet}（out/ret=分, tOut/tRet=最少乗換）。
     並びは、行き帰りOKを先に、その中は行き帰りの長い方が短い順 */
  function listForCell(mats, layer, dests, c, w) {
    var rows = [];
    for (var i = 0; i < dests.length; i++) {
      var d = dests[i], p = pair(mats, layer, d, c), st = pairStatus(mats, layer, d, c, w);
      if (st === 'none') continue;
      rows.push({ d: d, out: p.out, ret: p.ret, status: st,
        tOut: minTransfers(mats, 'o', d, c, w), tRet: minTransfers(mats, 'r', d, c, w) });
    }
    rows.sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'both' ? -1 : 1;
      var ka = Math.max(a.out || 999, a.ret || 999), kb = Math.max(b.out || 999, b.ret || 999);
      return ka - kb || (a.d - b.d);
    });
    return rows;
  }

  /* 分 -> 'H:MM'（出発時刻 hour 時 + 所要分） */
  function clock(hour, minutes) {
    var t = hour * 60 + minutes, h = Math.floor(t / 60), m = t % 60;
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  function distM(lon1, lat1, lon2, lat2) {
    var kx = 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110574);
  }

  /* 点を含む500mメッシュの番号（cells=[code,...]）。無ければ -1。idx は indexCells の戻り値 */
  function indexCells(cells) {
    var m = {};
    for (var i = 0; i < cells.length; i++) m[cells[i][0]] = i;
    return m;
  }
  function meshCodeAt(lon, lat) {
    var p = Math.floor(lat * 1.5), a = lat * 1.5 - p;
    var u = Math.floor(lon) - 100, f = lon - Math.floor(lon);
    var r = Math.floor(a * 8), a2 = a * 8 - r;
    var s = Math.floor(f * 8), f2 = f * 8 - s;
    var t = Math.floor(a2 * 10), a3 = a2 * 10 - t;
    var v = Math.floor(f2 * 10), f3 = f2 * 10 - v;
    var m = (a3 >= 0.5 ? 2 : 0) + (f3 >= 0.5 ? 1 : 0) + 1;
    return String(p).padStart(2, '0') + String(u).padStart(2, '0') + r + s + t + v + m;
  }

  /* 共有リンクのハッシュ。条件: o=行き出発(時) r=帰り出発(時) w=許容(分) c=徒歩上限(m) t=乗車回数の層 k=行き先の種類(カンマ) v=見方(a|b) s=選択(地区コード or 行き先番号) */
  function writeHash(st) {
    var p = ['o=' + st.o, 'r=' + st.r, 'w=' + st.w, 'c=' + st.c, 't=' + st.t, 'k=' + st.kinds.join(','), 'v=' + st.view];
    if (st.sel != null && st.sel !== '') p.push('s=' + st.sel);
    return '#' + p.join('&');
  }
  function parseHash(h) {
    var o = {};
    String(h || '').replace(/^#/, '').split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    var n = function (x) { return x != null && /^\d+$/.test(x) ? +x : null; };
    return { o: n(o.o), r: n(o.r), w: n(o.w), c: n(o.c), t: n(o.t),
      kinds: o.k != null ? o.k.split(',').filter(Boolean) : null,
      view: o.v === 'a' || o.v === 'b' ? o.v : null, sel: o.s != null ? o.s : null };
  }

  /* 公共交通オープンデータ開発者ガイドラインが一般ユーザへの通知を求める事項（出典・無保証・事業者へ問い合わせない・開発者の連絡先） */
  var ODPT_CONTACT = 'sota.moro@gmail.com';
  var ODPT_NOTICE = '本アプリが利用する公共交通データの一部は、公共交通オープンデータセンターにおいて提供されるものです。' +
    '公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。' +
    '本アプリの表示内容について、公共交通事業者への直接の問合せは行わないでください。' +
    (ODPT_CONTACT ? '本アプリに関するお問い合わせ: ' + ODPT_CONTACT : '');

  /* 国土数値情報 P13・P27 の使用許諾の表示（一覧ページの記載をそのまま） */
  var KSJ_TERMS = '国土数値情報の都市公園データ（P13、2011年度版・2010年3月時点）と文化施設データ（P27、2013年度版）は、' +
    '提供元（国土交通省）の一覧ページで使用許諾条件が「非商用」と表示されています。非商用の範囲でのみ利用してください。';

  function citationText(meta, o) {
    var seen = {}, parts = [];
    meta.feeds.forEach(function (f) {
      var k = f.org + '|' + f.license;
      if (seen[k]) return;
      seen[k] = 1;
      parts.push(f.org + '（' + f.license + (f.credit ? '、' + f.credit : '') + '）');
    });
    return '出典: 子連れお出かけ診断（' + o.url + '、東京都区部、最終閲覧 ' + o.date + '）。' +
      '公共交通の時刻表は公共交通オープンデータセンターで公開されている次のGTFSデータを加工して利用: ' + parts.join('、') + '。' +
      '行き先は国土数値情報（都市公園データ P13、文化施設データ P27、国土交通省。いずれも非商用）、人口は令和2年国勢調査地域メッシュ統計' +
      '（政府統計の総合窓口 e-Stat）、鉄道駅は国土数値情報（鉄道データ N02）、地図は地理院タイルを使用し、いずれも加工して作成。' +
      '診断は収録した事業者のデータだけに基づく（JR・東急等の未収録の鉄道、デマンド交通は考慮しない）。';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  return {
    QUANT: QUANT, meshBounds: meshBounds, rleDecode: rleDecode, fileName: fileName, minutesOf: minutesOf,
    within: within, pair: pair, pairStatus: pairStatus, minTransfers: minTransfers, statusesForDest: statusesForDest,
    countBoth: countBoth, bucketOf: bucketOf, BUCKET_LABEL: BUCKET_LABEL, statusesForCounts: statusesForCounts, summarize: summarize, pct: pct,
    listForCell: listForCell, clock: clock, distM: distM, indexCells: indexCells, meshCodeAt: meshCodeAt,
    writeHash: writeHash, parseHash: parseHash, citationText: citationText, esc: esc,
    ODPT_NOTICE: ODPT_NOTICE, ODPT_CONTACT: ODPT_CONTACT, KSJ_TERMS: KSJ_TERMS
  };
});
