/* アグレッサー（2026-11-13）による失敗テスト: lib.js（判定・URLハッシュ）。
   既知の失敗は todo 扱い（通常は緑。AGGRESSOR_STRICT=1 で赤）。
   実行: node --test reports/aggressor/udc-2026-aed-tests/lib_attack.test.cjs */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const here = __dirname;
const APP = fs.existsSync(path.join(here, "..", "lib.js")) ? path.join(here, "..")
  : path.join(here, "..", "..", "..", "contests", "udc-2026", "app", "aed-night");
const AN = require(path.join(APP, "lib.js"));
const D = JSON.parse(fs.readFileSync(path.join(APP, "data", "aed.json"), "utf8"));
const BUG = process.env.AGGRESSOR_STRICT === "1" ? {} : { todo: "known bug (aggressor 2026-11-13)" };

test("壊れた共有URL（%E0）でも既定値で起動する", BUG, () => {
  // 現状は decodeURIComponent が URIError を投げ、app.js の catch で「データを読み込めませんでした」になる
  assert.doesNotThrow(() => AN.parseHash("#m=%E0&d=1", ["machida"]));
});

test("最大見積でも、午前3時に「施設の開館時間」のAEDを使える扱いにしない", BUG, () => {
  // mode=max は不明を全部使えるとみなす。理由が facility/conditional のものは深夜に使える根拠がない
  const a = [1, 33.6, 130.4, "x", "", AN.KUNKNOWN, "facility", 0, 0];
  assert.strictEqual(AN.isUsable(a, 0, 180, "max"), false);
});

test("人口メッシュが0件の自治体は「0人（0%）」ではなく判定不能と区別できる", BUG, () => {
  const c = AN.coverage([], [], 0, 180, 500, "strict");
  assert.ok(c.popTotal === 0);
  assert.ok(c.empty === true || c.popOut === null, "coverage() に空データの印がない");
});

test("同一座標の重複登録を1か所として数えられる（町田市 平日3時: 14台=2か所）", BUG, () => {
  const mi = D.munis.findIndex(m => m.id === "machida");
  const cells = D.cells.filter(c => c[0] === mi), aeds = D.aed.filter(a => a[0] === mi && !a[8]);
  const c = AN.coverage(cells, aeds, 0, 180, 500, "strict");
  assert.ok("sites" in c, "coverage() が設置か所数を返さない（usable.length=" + c.usable.length + "）");
});

test("時刻 t=1440・d=7 などの範囲外は既定値に戻る（攻撃したが壊れなかった）", () => {
  const v = AN.parseHash("#d=7&t=1440&r=999&mode=xx&m=evil", ["machida"]);
  assert.deepStrictEqual([v.d, v.t, v.r, v.mode, v.m], [0, 180, 500, "strict", "machida"]);
});

test("CSVの式注入対策（攻撃したが壊れなかった）", () => {
  assert.ok(AN.csvCell("=HYPERLINK(1)").startsWith("'"));
  assert.ok(AN.csvCell("@SUM(A1)").startsWith("'"));
});
