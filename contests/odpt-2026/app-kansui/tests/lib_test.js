// node tests/lib_test.js  （標準の assert のみ）
'use strict';
const assert = require('assert');
const L = require('../web/lib.js');

const classes = ['着色なし', '0.5m未満', '0.5〜3m', '3〜5m', '5〜10m', '10〜20m', '20m以上'];
function ent(label, cls, alt) {
  return { label: label, name: '', lat: 35.1, lon: 139.1, flood: cls, tide: 0, cls: cls, alt: alt || { same: [] } };
}
function st(name, ents) {
  const c = ents.map(e => e.cls);
  return { name: name, operators: ['東京都交通局'], entrances: ents, summary: {
    n: c.length, avoid: c.filter(x => x >= 2).length, warn: c.filter(x => x === 1).length,
    none: c.filter(x => x === 0).length, max: c.length ? Math.max.apply(null, c) : null } };
}

// 状態の判定と文言（「安全」と断定しない）
assert.strictEqual(L.statusOf(0), 'none');
assert.strictEqual(L.statusOf(1), 'warn');
assert.strictEqual(L.statusOf(2), 'avoid');
assert.strictEqual(L.statusOf(6), 'avoid');
Object.keys(L.STATUS_TEXT).forEach(k => assert.ok(!/安全/.test(L.STATUS_TEXT[k])));
assert.ok(/保証ではありません/.test(L.STATUS_NOTE.none));
assert.ok(/^[▲△○]/.test(L.STATUS_TEXT.avoid + L.STATUS_TEXT.warn + L.STATUS_TEXT.none));

// escape
assert.strictEqual(L.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
assert.strictEqual(L.escapeHtml(null), '');

assert.strictEqual(L.stationLabel('蔵前'), '蔵前駅');
assert.strictEqual(L.stationLabel('蔵前駅'), '蔵前駅');

// 距離
assert.strictEqual(L.fmtDist(120.4), '120 m');
assert.strictEqual(L.fmtDist(1530), '1.5 km');
assert.strictEqual(L.fmtDist(null), '');

// 並び: 避けたい数 → 注意を含む数 → 最大 → 名前。出入口 0 の駅は除く
const A = st('甲', [ent('1', 2), ent('2', 2), ent('3', 0)]);
const B = st('乙', [ent('1', 4), ent('2', 0)]);
const C = st('丙', [ent('1', 2), ent('2', 1), ent('3', 1)]);
const D = st('丁', [ent('1', 3), ent('2', 0)]);
const E = st('孤', []);
const order = L.rankStations([B, E, D, A, C]).map(s => s.name);
assert.deepStrictEqual(order, ['甲', '丙', '乙', '丁']);
assert.ok(order.indexOf('孤') < 0);

// CSV: 引用・BOM・式の無効化
assert.strictEqual(L.csvCell('a,b'), '"a,b"');
assert.strictEqual(L.csvCell('say "hi"'), '"say ""hi"""');
assert.strictEqual(L.csvCell('=SUM(A1)'), "'=SUM(A1)");
assert.strictEqual(L.csvCell('-1'), "'-1");
assert.strictEqual(L.csvCell(null), '');
assert.strictEqual(L.csvCell(0), '0');
const csv = L.stationsCsv([B, A, E], classes);
assert.ok(csv.startsWith('﻿順位,駅名'));
const lines = csv.trim().split('\r\n');
assert.strictEqual(lines.length, 3);               // 見出し + 甲 + 乙（出入口なしは除く）
assert.strictEqual(lines[1].split(',')[1], '甲');
assert.strictEqual(lines[1].split(',')[8], '67');  // 避けたい割合 2/3
assert.strictEqual(lines[2].split(',')[7], '5〜10m');  // 乙

const ents = L.entrancesCsv([st('甲', [ent('A1', 3, { same: [{ i: 1, d: 80 }] }), ent('A2', 0)])], classes);
const el = ents.trim().split('\r\n');
assert.strictEqual(el.length, 3);
assert.ok(el[1].includes('避けたい'));
assert.ok(el[1].includes('A2 80m'));
assert.ok(el[2].includes('着色なし'));

// バスの要約
assert.strictEqual(L.busSummary({ wd: 0, hol: 0 }), '運行する便の記録なし');
assert.ok(L.busSummary({ wd: 30, hol: 20, first: '06:00', last: '22:30' }).includes('平日 30 本・休日 20 本'));
assert.ok(L.busSummary({ wd: 30, hol: 20, first: '06:00', last: '22:30' }).includes('始発 06:00'));

console.log('lib_test.js: OK');
