// アグレッサー（2026-11-09）: web/lib.js の境界条件。結果を JSON で標準出力に出す（test_aggressor.py が判定）。
// node tests/aggressor_lib_test.js
const fs = require('node:fs');
const path = require('node:path');
const L = require(path.join(__dirname, '..', 'web', 'lib.js'));
const out = {};

// 1) 生成済み全セルで、セル中心 -> meshCodeAt -> 同じコード（クリック位置とセルの対応）
const dataDir = path.join(__dirname, '..', 'web', 'data');
let checked = 0, mismatch = [];
if (fs.existsSync(path.join(dataDir, 'index.json'))) {
  for (const r of JSON.parse(fs.readFileSync(path.join(dataDir, 'index.json'), 'utf8')).regions) {
    const d = JSON.parse(fs.readFileSync(path.join(dataDir, r.id + '.json'), 'utf8'));
    for (const c of d.cells) {
      const b = L.meshBounds(c[0]);
      // 中心と、四隅から 1e-7 度だけ内側の点
      const pts = [[(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], [b[0] + 1e-7, b[1] + 1e-7], [b[2] - 1e-7, b[3] - 1e-7]];
      for (const [lon, lat] of pts) {
        checked++;
        const got = L.meshCodeAt(lon, lat);
        if (got !== c[0] && mismatch.length < 5) mismatch.push([c[0], got, lon, lat]);
      }
    }
  }
}
out.meshRoundTrip = { checked, mismatch };

// 2) 空のセル配列: 0人で 0% を表示する（「全員行けない」と読まれないか）
const s = L.summarize([], 0, 'wd', 'm', 1);
out.emptySummary = { pop: s.pop, pct: L.pct(s.walk + s.transit, s.pop) };

// 3) 診断文字列が欠けたセル（施設を追加した直後の古いJSON等）は「到達できない」に化ける
out.missingDigitStatus = L.cellStatus(['533946111', 10, 1, '', 0], 1, 'hol', 'e', 1);

// 4) 終発 48時超（2日目跨ぎ）の表示
out.fmt2days = L.fmtMin(2900);

// 5) nodeFacts: 平日0本・休日あり
out.factsHolOnly = L.nodeFacts([0, 0, 'x', [0, 0, 0, 0, -1, -1], [1, 1, 0, 3, 480, 900], []]);

console.log(JSON.stringify(out));
