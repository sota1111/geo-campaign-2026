const assert = require('assert');
const L = require('../web/lib.js');

assert.strictEqual(L.fmtDelay(0), '0秒');
assert.strictEqual(L.fmtDelay(200), '+3分20秒');
assert.strictEqual(L.fmtDelay(-60), '-1分');
assert.strictEqual(L.fmtDelay(-30), '-30秒');
assert.strictEqual(L.fmtDelay(null), '—');
assert.strictEqual(L.fmtPct(75), '75.0%');
assert.strictEqual(L.fmtPct(null), '—');

assert.strictEqual(L.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');

// 色: 境界
assert.strictEqual(L.segColor(14), '#0072B2');
assert.strictEqual(L.segColor(15), '#56B4E9');
assert.strictEqual(L.segColor(45), '#E69F00');
assert.strictEqual(L.segColor(90), '#D55E00');

// サンプル不足は数値を出さない
assert.strictEqual(L.ontimeLabel({ enough: false, ontime_pct: 80 }), 'サンプル不足');
assert.strictEqual(L.ontimeLabel({ enough: true, ontime_pct: 80 }), '80.0%');

// CSV: BOM・引用符のエスケープ・CRLF
const csv = L.toCsv(['a', 'b'], [['x"y', 1], ['カンマ,入り', null]]);
assert.ok(csv.startsWith('﻿"a","b"\r\n'));
assert.ok(csv.includes('"x""y","1"'));
assert.ok(csv.includes('"カンマ,入り",""'));

const op = {
  name: 'デモ交通',
  routes: [
    { route_id: 'R1', name: '1系統', band: 'all', n_trips: 12, enough: true, ontime_pct: 75, late_pct: 25, early_pct: 0, median_delay_s: 60, p90_delay_s: 400, bunch_enough: true, bunch_pairs: 66, bunch_pct: 10, gap_pct: 0 },
    { route_id: 'R2', name: '2系統', band: 'all', n_trips: 3, enough: false, bunch_enough: false },
    { route_id: 'R1', name: '1系統', band: 'day', n_trips: 12, enough: true, ontime_pct: 70, late_pct: 30, early_pct: 0, median_delay_s: 80, p90_delay_s: 400, bunch_enough: false },
  ],
  segments: [{ route_id: 'R1', name: '1系統', dir: '0', from: 'A', to: 'B', band: 'all', n: 9, median_added_s: 60, p90_added_s: 90, sched_run_s: 300, added_pct_of_run: 20 }],
};
const rc = L.routesCsv(op, 'all').split('\r\n');
assert.strictEqual(rc.length, 4);              // 見出し + 2 行 + 末尾の空
assert.ok(rc[1].includes('"75"'));
assert.ok(rc[2].includes('"いいえ","","","",""'), rc[2]);   // サンプル不足の行は数値が空
assert.ok(L.segmentsCsv(op, 'all').includes('"A","B"'));
assert.strictEqual(L.segmentsCsv(op, 'night').split('\r\n').length, 2);

// 期間の見出し
assert.ok(L.periodText({ period: { first: null } }).includes('取得記録がありません'));
assert.ok(L.periodText({ period: { first: '2026-11-13 00:00', last: '2026-11-13 00:20', observed_days: ['2026-11-13'], estimated_days: [], polls: 40 } }).includes('1日分'));
assert.ok(L.periodText({ period: { first: 'a', last: 'b', observed_days: ['d1', 'd2'], estimated_days: ['2026-11-13', '2026-11-14'], polls: 9 } }).includes('2日分（2026-11-13 〜 2026-11-14）'));

// 路線は名称順（成績順ではない）
const sorted = [{ name: 'B' }, { name: 'A' }].sort(L.routeSortKey);
assert.strictEqual(sorted[0].name, 'A');

console.log('lib_test OK');
