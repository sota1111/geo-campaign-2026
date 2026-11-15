/* 実データでの試し計算（開発用）: node tools/try_route.js */
var fs = require('fs'), path = require('path');
var L = require('../web/lib.js');
var d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'data', 'kankou.json'), 'utf8'));
var net = L.prepare(d);
var o = { lat: +(process.argv[2] || 35.7147), lon: +(process.argv[3] || 139.7967) };
var t0 = Date.now();
var n = 0, diff = 0, same = 0, unavoid = 0;
d.facilities.filter(function (f) { return f[3] === '病院'; }).forEach(function (f) {
  var m = L.haversine(o.lat, o.lon, f[0], f[1]);
  if (m < 1500 || m > 5000) return;
  var r = L.compare(net, o, { lat: f[0], lon: f[1] }, { dt: 'wd', dep: 10 * 3600 });
  n++;
  if (!r.nBest) return;
  if (!r.aBest) { unavoid++; console.log('回避不能', f[2], Math.round(m)); return; }
  if (r.sameRoute) same++; else { diff++; console.log(f[2], Math.round(m) + 'm', '通常', Math.round(r.nBest.dur / 60), '回避', Math.round(r.aBest.dur / 60),
    r.nSum.flaggedRoutes.join(','), '->', r.aBest.legs.filter(function (l) { return l.type === 'bus'; }).map(function (l) { return l.route; }).join('+')); }
});
console.log('件数', n, '同じ', same, '違う', diff, '回避不能', unavoid, 'ms', Date.now() - t0);
