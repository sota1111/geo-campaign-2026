/* web/lib.js の純粋関数の試験（node tests/lib_test.js）。小さな合成ネットワークで経路探索・観光系統の回避を確かめる */
'use strict';
var assert = require('assert');
var path = require('path');
var fs = require('fs');
var L = require(path.join(__dirname, '..', 'web', 'lib.js'));

var passed = 0;
function t(name, fn) { fn(); passed++; }

/* 緯度 0.009 ≒ 1 km */
var LAT = 35.70, LON = 139.79;
function data() {
  return {
    feeds: [{ key: 'f', name: 'テストバス' }],
    stops: [
      [LAT, LON, 'A', 'f'],                  /* 0 出発 */
      [LAT + 0.010, LON, 'B', 'f'],          /* 1 観光地点の近く */
      [LAT + 0.020, LON, 'D', 'f'],          /* 2 目的 */
      [LAT + 0.010, LON + 0.012, 'C', 'f'],  /* 3 迂回 */
      [LAT + 0.0, LON + 0.05, 'X', 'f'],     /* 4 乗換 前 */
      [LAT + 0.0009, LON + 0.05, 'Y', 'f'],  /* 5 乗換 後（X から約100m） */
      [LAT + 0.05, LON + 0.05, 'Z', 'f'],    /* 6 */
      [LAT + 0.060, LON + 0.10, 'S1', 'f'],  /* 7（S1〜S4 は約670mおき） */
      [LAT + 0.066, LON + 0.10, 'S2', 'f'],  /* 8 観光地点の近く */
      [LAT + 0.072, LON + 0.10, 'S3', 'f'],  /* 9 */
      [LAT + 0.078, LON + 0.10, 'S4', 'f']   /* 10 */
    ],
    spots: [[LAT + 0.0102, LON, 'テスト名所', '観光名所'], [LAT + 0.0662, LON + 0.10, '別の名所', '']],
    tstop: { '1': 0, '8': 1 },
    routes: [
      { name: '観光1', feed: 'f', stops: 3, tstops: 1, share: 0.3333, spots: [0], trips_wd: 3, trips_hol: 0 },
      { name: '生活2', feed: 'f', stops: 3, tstops: 0, share: 0, spots: [], trips_wd: 2, trips_hol: 0 },
      { name: '乗換4', feed: 'f', stops: 2, tstops: 0, share: 0, spots: [], trips_wd: 1, trips_hol: 0 },
      { name: '乗換5', feed: 'f', stops: 2, tstops: 0, share: 0, spots: [], trips_wd: 1, trips_hol: 0 },
      { name: '観光6', feed: 'f', stops: 4, tstops: 1, share: 0.25, spots: [1], trips_wd: 1, trips_hol: 0 }
    ],
    patterns: [
      [0, [0, 1, 2], [0, 300, 600], [25200, 36000, 39600], []],
      [1, [0, 3, 2], [0, 500, 1000], [25200, 36000], []],
      [2, [4 - 4 + 0, 4], [0, 300], [], []],            /* 置き換え（下で上書き） */
      [3, [5, 6], [0, 300], [], []],
      [4, [7, 8, 9, 10], [0, 120, 240, 360], [36000], []]
    ],
    table: [[0, 'wd', 10, 1, 1], [0, 'wd', 9, 2, 2], [1, 'wd', 10, 1, 0], [0, 'hol', 10, 1, 1], [4, 'wd', 10, 1, 1]],
    facilities: [[LAT + 0.020, LON, '目的の病院', '病院'], [LAT, LON, '近くの駅', '鉄道駅']]
  };
}

function build() {
  var d = data();
  d.patterns[2] = [2, [0, 4], [0, 300], [36000], []];
  d.patterns[3] = [3, [5, 6], [0, 300], [36600], []];
  return L.prepare(d);
}

t('徒歩の概算: 80m/分 × 迂回率1.25', function () {
  assert.strictEqual(Math.round(L.walkSec(800)), 750);
  assert.strictEqual(L.fmtClock(36000), '10:00');
  assert.strictEqual(L.fmtClock(90600), '25:10');
});

t('通常は観光系統（最短）を選び、観光系統を避けると別系統になる', function () {
  var net = build();
  var r = L.compare(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd', dep: 36000 - 60 });
  assert.ok(r.nBest && r.aBest);
  assert.strictEqual(r.nBest.legs.filter(function (l) { return l.type === 'bus'; })[0].route, '観光1');
  assert.strictEqual(r.aBest.legs.filter(function (l) { return l.type === 'bus'; })[0].route, '生活2');
  assert.ok(r.diffSec > 0, '回避すると遅くなる');
  assert.strictEqual(r.nSum.flaggedRoutes[0], '観光1');
  assert.deepStrictEqual(r.nSum.touristSpots, ['テスト名所']);
  assert.strictEqual(r.aSum.flaggedRoutes.length, 0);
  assert.ok(!r.sameRoute);
  /* 所要時間 = 到着 - 出発 */
  assert.strictEqual(Math.round(r.nBest.dur), Math.round(r.nBest.arrive - (36000 - 60)));
});

t('観光時間帯の外（朝7時）なら避けても同じ経路', function () {
  var net = build();
  var r = L.compare(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd', dep: 25200 - 60 });
  assert.ok(r.sameRoute);
  assert.strictEqual(r.diffSec, 0);
  assert.strictEqual(r.nSum.flaggedRoutes.length, 0);
});

t('観光系統のしきい値を上げると観光系統ではなくなる', function () {
  var net = build();
  var r = L.compare(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd', dep: 35900, share: 0.5 });
  assert.ok(r.sameRoute);
  assert.strictEqual(r.nSum.flaggedRoutes.length, 0);
});

t('観光地点の停留所を過ぎてから乗る区間は避けなくてよい', function () {
  var net = build();
  /* S3 から S4 へ: 系統は観光系統だが、乗る区間に観光地点に近い停留所を含まない */
  var r = L.compare(net, { lat: LAT + 0.072, lon: LON + 0.10 }, { lat: LAT + 0.078, lon: LON + 0.10 }, { dt: 'wd', dep: 36000 });
  assert.ok(r.aBest, '回避でも到達できる');
  assert.ok(r.sameRoute);
  /* S1 から S3 へ: 区間に S2 を含むので回避すると到達できない */
  var r2 = L.compare(net, { lat: LAT + 0.060, lon: LON + 0.10 }, { lat: LAT + 0.072, lon: LON + 0.10 }, { dt: 'wd', dep: 36000 - 30 });
  assert.ok(r2.nBest, '通常は到達できる');
  assert.strictEqual(r2.aBest, null, '避けると別の手段が無い');
  assert.deepStrictEqual(r2.nSum.touristSpots, ['別の名所']);
});

t('乗換（徒歩約100m）で2本のバスを乗り継ぐ', function () {
  var net = build();
  var r = L.route(net, { lat: LAT, lon: LON }, { lat: LAT + 0.05, lon: LON + 0.05 }, { dt: 'wd', dep: 35900 });
  assert.ok(r.options.length >= 1);
  var o = r.options[r.options.length - 1];
  assert.strictEqual(o.rides, 2);
  assert.deepStrictEqual(o.legs.map(function (l) { return l.type; }), ['walk', 'bus', 'walk', 'bus', 'walk']);
  assert.strictEqual(o.legs[1].route, '乗換4');
  assert.strictEqual(o.legs[3].route, '乗換5');
  assert.ok(o.legs[2].m > 50 && o.legs[2].m < 150);
});

t('休日にダイヤが無い系統は使われない・到達不能なら options が空', function () {
  var net = build();
  var r = L.route(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'hol', dep: 36000 });
  assert.strictEqual(r.options.length, 0);
  var far = L.route(net, { lat: 36.5, lon: 140.5 }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd', dep: 36000 });
  assert.strictEqual(far.options.length, 0);
});

t('出発時刻を過ぎた便には乗れない', function () {
  var net = build();
  var r = L.route(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd', dep: 39600 + 1 });
  assert.strictEqual(r.options.length, 0);
});

t('時間帯ごとの比較（sweep）', function () {
  var net = build();
  var s = L.sweep(net, { lat: LAT, lon: LON }, { lat: LAT + 0.020, lon: LON }, { dt: 'wd' }, [7, 10]);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].hour, 7);
});

t('系統×時間帯の一覧: しきい値・日種別・時間帯で絞る。停車回数の多い順', function () {
  var d = data();
  var rows = L.tableRows(d, { share: 0.1, dt: 'wd' });
  assert.deepStrictEqual(rows.map(function (r) { return r.name + r.hour; }), ['観光19', '観光110', '観光610']);
  assert.strictEqual(L.tableRows(d, { share: 0.1, dt: 'hol' }).length, 1);
  assert.strictEqual(L.tableRows(d, { share: 0.1, dt: 'all', hourFrom: 10, hourTo: 11 }).length, 3);
  assert.strictEqual(L.tableRows(d, { share: 0.3, dt: 'wd' }).length, 2);
  assert.strictEqual(L.tableRows(d, { share: 0.0, dt: 'wd' }).length, 4);   /* しきい値0でも観光系統以外も出る */
  var rr = L.routeRows(d, { share: 0.1, dt: 'wd' });
  assert.deepStrictEqual(rr.map(function (r) { return r.name; }), ['観光1', '観光6']);
});

t('CSV: BOM・ヘッダー・引用・式の無効化', function () {
  var d = data();
  var csv = L.tableCsv(d, L.tableRows(d, { share: 0.1, dt: 'wd' }));
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  var lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[0], L.CSV_HEAD.join(','));
  assert.strictEqual(lines.length, 5);   /* ヘッダー + 3行 + 末尾の空 */
  assert.ok(lines[1].indexOf('テストバス') > 0 && lines[1].indexOf('平日') > 0);
  assert.strictEqual(L.csvCell('=1+1'), "'=1+1");
  assert.strictEqual(L.csvCell('a,b'), '"a,b"');
  assert.strictEqual(L.csvCell('x"y'), '"x""y"');
  assert.strictEqual(L.csvCell(0), '0');
});

t('場所の検索: 施設名とバス停名の部分一致', function () {
  var d = data();
  var r = L.searchPlaces(d, '病院');
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].tag, '病院');
  assert.strictEqual(L.searchPlaces(d, 'S').filter(function (x) { return x.kind === 'stop'; }).length >= 4, true);
  assert.deepStrictEqual(L.searchPlaces(d, ''), []);
});

t('esc: HTML をエスケープする', function () {
  assert.strictEqual(L.esc('<b>"&\'</b>'), '&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;');
});

/* 実データ（ビルド済みなら）: 浅草寺の近くから病院へ */
var real = path.join(__dirname, '..', 'web', 'data', 'kankou.json');
if (fs.existsSync(real)) {
  t('実データ: 浅草寺付近から近くの病院へ。通常経路が出て、比較が計算できる', function () {
    var d = JSON.parse(fs.readFileSync(real, 'utf8'));
    var net = L.prepare(d);
    var o = { lat: 35.7147, lon: 139.7967 };
    var hosp = d.facilities.map(function (f) { return { f: f, m: L.haversine(o.lat, o.lon, f[0], f[1]) }; })
      .filter(function (x) { return x.f[3] === '病院' && x.m > 1000 && x.m < 4500; })
      .sort(function (a, b) { return a.m - b.m; }).slice(0, 12);
    assert.ok(hosp.length > 3);
    var ok = 0;
    hosp.forEach(function (h) {
      var r = L.compare(net, o, { lat: h.f[0], lon: h.f[1] }, { dt: 'wd', dep: 11 * 3600 });
      if (r.nBest) {
        ok++;
        assert.ok(r.nBest.dur > 0 && r.nBest.dur < 4 * 3600, '所要時間が現実的な範囲');
        if (r.aBest) assert.ok(r.aBest.dur >= r.nBest.dur - 1, '回避しても通常より速くはならない');
      }
    });
    assert.ok(ok >= 3, '少なくとも3か所には行ける: ' + ok);
  });
  t('実データ: 一覧とCSV', function () {
    var d = JSON.parse(fs.readFileSync(real, 'utf8'));
    var rows = L.tableRows(d, { share: 0.1, dt: 'all' });
    assert.ok(rows.length > 20);
    assert.ok(rows[0].visits >= rows[rows.length - 1].visits);
    var csv = L.tableCsv(d, rows);
    assert.strictEqual(csv.slice(1).split('\r\n').length, rows.length + 2);
  });
}

console.log('lib_test OK (' + passed + ' tests)');
