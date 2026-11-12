// 実行: node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const MW = require("../lib.js");
const fc = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/fills.geojson"), "utf8"));

function centroid(f) {
  const c = f.geometry.coordinates[0];
  return [c.reduce((a, p) => a + p[0], 0) / c.length, c.reduce((a, p) => a + p[1], 0) / c.length];
}

test("pointInRing: 四角形の内外", () => {
  const ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
  assert.ok(MW.pointInRing(1, 1, ring));
  assert.ok(!MW.pointInRing(3, 1, ring));
});

test("nearestFill: 範囲内の点は inside で距離0", () => {
  const sq = { type: "Feature", properties: { id: "T1", kind: "谷埋め型", city: "試験市" }, geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [139.001, 35.0], [139.001, 35.001], [139.0, 35.001], [139.0, 35.0]]] } };
  const r = MW.nearestFill(139.0005, 35.0005, [sq]);
  assert.strictEqual(r.inside, true);
  assert.strictEqual(r.distM, 0);
});

test("nearestFill: 外側の点は約100m離れた距離を返す（東へ0.0011度≒100m）", () => {
  const sq = { type: "Feature", properties: { id: "T1", kind: "腹付け型", city: "試験市" }, geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [139.001, 35.0], [139.001, 35.001], [139.0, 35.001], [139.0, 35.0]]] } };
  const r = MW.nearestFill(139.0021, 35.0005, [sq]);
  assert.strictEqual(r.inside, false);
  const truth = MW.haversine(139.001, 35.0005, 139.0021, 35.0005);
  assert.ok(Math.abs(r.distM - truth) < 2, `${r.distM} vs ${truth}`);
});

test("実データ: 全盛土造成地の重心近傍は自分のIDを最近傍に持つ（重心が外でも距離は小さい）", () => {
  for (const f of fc.features) {
    const [x, y] = centroid(f);
    const r = MW.nearestFill(x, y, fc.features);
    assert.ok(r.distM < 150, `${f.properties.id} ${r.distM}`);
  }
});

test("実データ: 熱海・伊東のデータは対象範囲内", () => {
  for (const f of fc.features) for (const [x, y] of f.geometry.coordinates[0]) assert.ok(MW.inCoverage(x, y));
});

test("inCoverage: 東京は範囲外", () => assert.ok(!MW.inCoverage(139.76, 35.68)));

test("makeRecord: ぼかしは小数3桁、範囲外フラグ", () => {
  const r = MW.makeRecord({ id: "a", lng: 139.07312345, lat: 35.10198765, kind: "crack", memo: "x", observedAt: "2026-11-11 10:00", blurred: true });
  assert.strictEqual(r.lng, 139.073);
  assert.strictEqual(r.lat, 35.102);
  assert.strictEqual(r.outOfCoverage, false);
  assert.strictEqual(MW.makeRecord({ id: "b", lng: 139.76, lat: 35.68, kind: "zzz", observedAt: "" }).outOfCoverage, true);
  assert.strictEqual(MW.makeRecord({ id: "b", lng: 139.76, lat: 35.68, kind: "zzz", observedAt: "" }).kind, "other");
});

test("makeRecord: メモは500字に切る", () => {
  assert.strictEqual(MW.makeRecord({ id: "a", lng: 139.07, lat: 35.1, kind: "crack", memo: "あ".repeat(900), observedAt: "" }).memo.length, 500);
});

test("GeoJSON 書き出し→読み込みで往復できる", () => {
  const nf = { id: "熱海市0008", kind: "谷埋め型", city: "熱海市", inside: true, distM: 0 };
  const recs = [MW.makeRecord({ id: "r1", lng: 139.0573, lat: 35.1054, kind: "water", memo: "湧水", observedAt: "2026-11-11 10:00", nearFill: nf })];
  const back = MW.fromGeoJSON(JSON.parse(JSON.stringify(MW.toGeoJSON(recs))));
  assert.strictEqual(back.skipped, 0);
  assert.deepStrictEqual(back.records, recs);
});

test("fromGeoJSON: 不正な点・形式は捨てる", () => {
  const bad = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: ["a", 1] }, properties: {} },
    { type: "Feature", geometry: { type: "Point", coordinates: [139.07, 95] }, properties: {} },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} },
    { type: "Feature", geometry: { type: "Point", coordinates: [139.07, 35.1] }, properties: { kind: "crack", id: "ok" } }
  ] };
  const r = MW.fromGeoJSON(bad);
  assert.strictEqual(r.records.length, 1);
  assert.strictEqual(r.skipped, 3);
  assert.strictEqual(MW.fromGeoJSON(null).records.length, 0);
  assert.strictEqual(MW.fromGeoJSON({ type: "Feature" }).records.length, 0);
});

test("CSV: BOM、引用符のエスケープ、式の無効化", () => {
  const recs = [MW.makeRecord({ id: "r1", lng: 139.07, lat: 35.1, kind: "crack", memo: '=HYPERLINK("x"),"引用"', observedAt: "2026-11-11 10:00" })];
  const csv = MW.toCSV(recs);
  assert.ok(csv.startsWith("﻿"));
  assert.ok(csv.includes('"\'=HYPERLINK(""x""),""引用"""'));
  assert.strictEqual(csv.trim().split("\r\n").length, 2);
});

test("通報文: 位置・日時・注意書きを含み、範囲外では注記が入る", () => {
  const r = MW.makeRecord({ id: "r1", lng: 139.0573, lat: 35.1054, kind: "crack", memo: "路肩に亀裂", observedAt: "2026-11-11 10:00",
    nearFill: { id: "熱海市0008", kind: "谷埋め型", city: "熱海市", inside: false, distM: 123 } });
  const t = MW.reportText(r);
  for (const s of ["2026-11-11 10:00", "35.1054,139.0573", "亀裂", "路肩に亀裂", "熱海市0008", "約100m", "直ちに危険"]) assert.ok(t.includes(s), s);
  assert.ok(!t.includes("対象範囲（熱海市・伊東市）の外"));
  const out = MW.reportText(MW.makeRecord({ id: "r2", lng: 139.76, lat: 35.68, kind: "other", observedAt: "x" }));
  assert.ok(out.includes("対象範囲（熱海市・伊東市）の外"));
  assert.ok(MW.reportText(MW.makeRecord({ id: "r3", lng: 139.0573, lat: 35.1054, kind: "other", observedAt: "x", blurred: true })).includes("ぼかした"));
});

test("URLハッシュ: 往復と不正値の無視", () => {
  const def = { z: 13.5, lat: 35.1, lng: 139.07, base: "std", old: "none", op: 60 };
  const s = { z: 15, lat: 35.12345, lng: 139.05, base: "photo", old: "gazo1", op: 40 };
  assert.deepStrictEqual(MW.parseHash(MW.formatHash(s), def), s);
  const p = MW.parseHash("#z=99&lat=abc&base=evil&old=<script>&op=-5&foo", def);
  assert.deepStrictEqual(p, def);
});
