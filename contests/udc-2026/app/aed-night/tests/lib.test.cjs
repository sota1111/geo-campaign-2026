// 実行: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const AN = require("../lib.js");

// aed = [muni, lat, lon, name, place, kind, payload, note]
const A24 = [0, 35.0, 139.0, "a24", "", 0, [], 0];
const AWK = [0, 35.0, 139.0, "wk", "", 1, [[31, 510, 1020]], 0]; // 月〜金 8:30-17:00（ビット 1+2+4+8+16=31）
const AUNK = [0, 35.0, 139.0, "unk", "", 2, "empty", 0];
const AASM = [0, 35.0, 139.0, "asm", "", 3, [[127, 540, 1320]], 0];

test("isUsable: 24時間・時間指定・不明", () => {
  assert.equal(AN.isUsable(A24, 6, 180, "strict"), true);
  assert.equal(AN.isUsable(AWK, 0, 600, "strict"), true);
  assert.equal(AN.isUsable(AWK, 0, 1020, "strict"), false); // 終了時刻ちょうどは含まない
  assert.equal(AN.isUsable(AWK, 0, 509, "strict"), false);
  assert.equal(AN.isUsable(AWK, 5, 600, "strict"), false); // 土曜
  assert.equal(AN.isUsable(AUNK, 0, 600, "strict"), false);
  assert.equal(AN.isUsable(AUNK, 0, 600, "max"), true);
  assert.equal(AN.isUsable(AASM, 0, 600, "strict"), false); // 曜日の仮定は strict では使わない
  assert.equal(AN.isUsable(AASM, 0, 600, "max"), true);
});

test("haversine: 緯度1度は約111km", () => {
  const d = AN.haversine(35, 139, 36, 139);
  assert.ok(d > 110900 && d < 111500, String(d));
  assert.equal(AN.haversine(35, 139, 35, 139), 0);
});

test("nearestWithin: 半径の内外と索引をまたぐ近傍", () => {
  const pts = [{ lat: 35.0, lon: 139.0 }, { lat: 35.0095, lon: 139.0 }];
  const idx = AN.buildIndex(pts, 0.01);
  assert.equal(AN.nearestWithin(idx, 35.0, 139.0, 100), 0);
  // 35.0095 は別の格子。約0.95km 以内の点から 35.0095 の点が見つかる
  const d = AN.nearestWithin(idx, 35.0180, 139.0, 1000);
  assert.ok(d !== null && d < 1000, String(d));
  assert.equal(AN.nearestWithin(idx, 35.1, 139.0, 500), null);
});

// セル = [muni, code, lat, lon, pop, edge, area]
const cells = [
  [0, "c1", 35.000, 139.000, 100, 0, 0],
  [0, "c2", 35.003, 139.000, 200, 0, 0], // 約333m北
  [0, "c3", 35.020, 139.000, 300, 1, 1], // 約2.2km北
  [0, "c4", 35.021, 139.000, 50, 0, 1]
];

test("coverage: 半径と人口の集計、時刻で変わる", () => {
  const aeds = [AWK];
  const day = AN.coverage(cells, aeds, 0, 600, 500, "strict");
  assert.deepEqual(Array.from(day.covered), [1, 1, 0, 0]);
  assert.equal(day.popIn, 300); assert.equal(day.popOut, 350); assert.equal(day.popTotal, 650);
  assert.equal(day.popCore, 350); assert.equal(day.popOutCore, 50); // edge=1 のセルは境界付近として別に数える
  const night = AN.coverage(cells, aeds, 0, 180, 500, "strict");
  assert.equal(night.usable.length, 0);
  assert.equal(night.popOut, 650);
  const r300 = AN.coverage(cells, aeds, 0, 600, 300, "strict");
  assert.deepEqual(Array.from(r300.covered), [1, 0, 0, 0]); // 333m は 300m の圏外
});

test("coverage: 不明も使える（最大見積）は圏外が減る", () => {
  const s = AN.coverage(cells, [AUNK], 0, 180, 500, "strict");
  const m = AN.coverage(cells, [AUNK], 0, 180, 500, "max");
  assert.equal(s.popOut, 650);
  assert.equal(m.popOut, 350);
});

test("gainAt: 圏外のセルだけを数える", () => {
  const cov = AN.coverage(cells, [AWK], 0, 600, 500, "strict");
  const g = AN.gainAt(cells, cov.covered, 35.0205, 139.0, 500);
  assert.equal(g.pop, 350); assert.equal(g.cells, 2);
  assert.equal(AN.gainAt(cells, cov.covered, 35.0, 139.0, 500).pop, 0); // 既に圏内
});

test("topCandidates: 貪欲に新規人口が大きい順、選んだ圏内は重複して数えない", () => {
  const cov = AN.coverage(cells, [], 0, 180, 500, "strict"); // 全部圏外
  const c = AN.topCandidates(cells, cov.covered, 500, 5);
  assert.equal(c[0].pop, 350); // c3+c4 が先
  assert.equal(c[1].pop, 300);
  assert.equal(c.length, 2);
  assert.equal(c.reduce((a, x) => a + x.pop, 0), 650); // 合計は全人口。二重計上しない
});

test("areaTable: 地区別の圏外人口の多い順、境界付近を除く", () => {
  const cov = AN.coverage(cells, [AWK], 0, 600, 500, "strict");
  const t = AN.areaTable(cells, cov.covered, ["A", "B"], false);
  assert.equal(t[0].name, "B"); assert.equal(t[0].out, 350); assert.equal(t[0].pop, 350); assert.equal(t[0].edge, 1);
  assert.equal(t[1].name, "A"); assert.equal(t[1].out, 0);
  const t2 = AN.areaTable(cells, cov.covered, ["A", "B"], true);
  const b = t2.find((r) => r.name === "B");
  assert.equal(b.pop, 50);
});

test("toCSV: BOM・引用・式の無効化", () => {
  const s = AN.toCSV(["a", "b"], [["x,y", 'q"t'], ["=SUM(A1)", null]]);
  assert.ok(s.startsWith("﻿"));
  assert.ok(s.includes('"x,y"'));
  assert.ok(s.includes('"q""t"'));
  assert.ok(s.includes("'=SUM(A1)"));
});

test("windowsText", () => {
  assert.equal(AN.windowsText(A24), "24時間（毎日）");
  assert.equal(AN.windowsText(AWK), "月火水木金 08:30–17:00");
  assert.ok(AN.windowsText(AUNK).startsWith("不明"));
  assert.ok(AN.windowsText(AASM).includes("毎日と仮定"));
  assert.ok(AN.windowsText([0, 0, 0, "n", "", 1, [[127, 0, 1440]], 0]).includes("毎日 00:00–24:00"));
});

test("hash: 往復と不正値の無視", () => {
  const v = { m: "fukuoka", d: 5, t: 1320, r: 800, mode: "max" };
  assert.deepEqual(AN.parseHash(AN.formatHash(v), ["machida", "fukuoka"]), v);
  const bad = AN.parseHash("#m=evil&d=9&t=99999&r=123&mode=x", ["machida"]);
  assert.deepEqual(bad, AN.DEF);
  assert.deepEqual(AN.parseHash("", null), AN.DEF);
});

test("hhmm / readableShare", () => {
  assert.equal(AN.hhmm(0), "00:00"); assert.equal(AN.hhmm(1425), "23:45");
  assert.equal(AN.whenLabel(6, 840), "日曜 14:00");
  assert.equal(AN.readableShare({ "24h": 1, timed: 1, unknown: 2 }), 0.5);
  assert.equal(AN.readableShare({ "24h": 0, timed: 0, unknown: 0 }), 0);
});

// ---- アグレッサー指摘（重大5・中）の修正 ----
const ANONPUB = [0, 35.0, 139.0, "救急車内", "救急車内", 4, "nonpublic", 0, 0];
const AFAC = [0, 35.0, 139.0, "fac", "", 2, "facility", 0, 0];
const AEMPTY = [0, 35.0, 139.0, "emp", "", 2, "empty", 0, 0];

test("一般の人が使えない設置位置（kind=4）は、どのモード・時刻でも使える扱いにしない", () => {
  for (const mode of ["strict", "max"]) {
    for (const t of [180, 600, 1200]) assert.equal(AN.isUsable(ANONPUB, 0, t, mode), false);
  }
  assert.equal(AN.coverage(cells, [ANONPUB], 0, 180, 500, "max").usable.length, 0);
  assert.match(AN.windowsText(ANONPUB), /一般の人が使えない/);
});

test("最大見積でも、夜間（22時〜翌6時）は施設の開館時間・条件付きの不明を使える扱いにしない", () => {
  assert.equal(AN.isUsable(AFAC, 0, 180, "max"), false);
  assert.equal(AN.isUsable(AFAC, 0, 22 * 60, "max"), false);
  assert.equal(AN.isUsable(AFAC, 0, 5 * 60 + 59, "max"), false);
  assert.equal(AN.isUsable(AFAC, 0, 6 * 60, "max"), true); // 昼は使える可能性がある
  assert.equal(AN.isUsable(AFAC, 0, 840, "max"), true);
  assert.equal(AN.isUsable(AFAC, 0, 840, "strict"), false);
  assert.equal(AN.isUsable(AEMPTY, 0, 180, "max"), true); // 未記入は夜に使えないとも言えない
});

test("coverage: 台数のほかに設置か所数（同じ座標を1か所）を返す", () => {
  const same = [A24, [0, 35.0, 139.0, "b", "", 0, [], 0, 0], [0, 35.001, 139.0, "c", "", 0, [], 0, 0]];
  const c = AN.coverage(cells, same, 0, 180, 500, "strict");
  assert.equal(c.usable.length, 3);
  assert.equal(c.sites, 2);
});

test("coverage: メッシュ0件は empty=true で、0人（0%）と区別できる", () => {
  const c = AN.coverage([], [], 0, 180, 500, "strict");
  assert.equal(c.empty, true);
  assert.equal(AN.coverage(cells, [], 0, 180, 500, "strict").empty, false);
});

test("weekdayRange: 月〜金の最小・最大。月曜だけで代表させない", () => {
  // 火〜金 9時〜17時だけ使える AED。月曜は使えない（ビット: 火2+水4+木8+金16=30）
  const tueFri = [0, 35.0, 139.0, "tf", "", 1, [[30, 540, 1020]], 0, 0];
  const w = AN.weekdayRange(cells, [tueFri], 600, 500, "strict", false);
  assert.equal(w.maxDay, 0); // 月曜が最悪
  assert.equal(w.min, 350 / 650);
  assert.equal(w.max, 650 / 650);
});

test("coverage: 市境付近を除いた人口（popCore）と、そこでの圏外（popOutCore）を返す", () => {
  const c = AN.coverage(cells, [], 0, 180, 500, "strict");
  assert.equal(c.popCore, 350); assert.equal(c.popOutCore, 350); assert.equal(c.popTotal, 650);
});

test("hash: 途中で切れた共有URL（%E0）でも既定値で起動する", () => {
  assert.doesNotThrow(() => AN.parseHash("#m=%E0&d=1", ["machida"]));
  const v = AN.parseHash("#m=%E0&d=1&t=600", ["machida"]);
  assert.equal(v.d, 1); assert.equal(v.t, 600); assert.equal(v.m, "machida");
});

test("readableShare: 一般の人が使えない設置位置は分母に入れない", () => {
  assert.equal(AN.readableShare({ "24h": 1, timed: 1, unknown: 2, nonpublic: 5 }), 0.5);
});
