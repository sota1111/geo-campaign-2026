// アグレッサーの失敗テスト（ichibiz-2026 新案 RN1・3地域版。東京23区・大阪市）。2026-11-14
// 実行: node --test reports/aggressor/ichibiz-2026-realestate-rn1-tests/aggressor_regions_test.js   （約1〜2分。ネットワーク・APIキー不要）
//   環境変数 RN1_APP でアプリの場所を変えられる（既定: contests/ichibiz-2026/app/realestate-rn1）。
//   app/realestate-rn1/tests/ への書き込みは hook で拒否されたため、ここに置いた。工兵が tests/ へ移す場合は APP の既定値を path.join(__dirname, '..') に変える。
// FAIL は弱点が残っていることを示す（アプリ本体はアグレッサーは直さない）。報告: reports/aggressor/ichibiz-2026-realestate-rn1-regions-20261114.md
// 隣の自治体の座標の市区町村コードは、国土地理院の逆ジオコーダ（GET）で 2026-11-14 に確認した値をここに固定している。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(process.env.RN1_APP || path.join(__dirname, '..', '..', '..', 'contests', 'ichibiz-2026', 'app', 'realestate-rn1'));
const Lib = require(path.join(APP, 'web', 'lib.js'));
const WEB = path.join(APP, 'web');
const ROOT = path.join(WEB, 'data');
const SUB = path.join(APP, '..', '..', 'submission', 'realestate-rn1');
const FILES = { 'plan.json': 'plan', 'population.json': 'population', 'districts.json': 'districts', 'facilities.json': 'facilities', 'hazards.json': 'hazards', 'zoning.json': 'zoning' };
const raw = {};
const load = (rid) => {
  const dir = path.join(ROOT, Lib.REGIONS[rid].dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const files = {};
  for (const [file, k] of Object.entries(FILES)) if (fs.existsSync(path.join(dir, file))) files[k] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  raw[rid] = files;
  return Lib.assemble(manifest, files, Lib.REGIONS[rid]);
};
const D = { tokyo23: load('tokyo23'), osaka: load('osaka') };
const sheetText = (s) => JSON.stringify(s.sections.map((x) => [x.title, x.lines.map((l) => l.text), x.ask, x.missing]));
const regionPolys = (rid) => raw[rid].zoning.areas.flatMap((a) => a.polys); // 同梱の「地域の内側」の元（fetch-reinfolib.mjs の makeMask と同じ多角形）

// 国土地理院の逆ジオコーダで「隣の自治体」と確認した地点（[経度, 緯度, 実際の市区町村コード, 町名]）
const NEIGHBORS = {
  tokyo23: [
    [139.566, 35.746, '13229', '西東京市 東町三丁目'],
    [139.570, 35.766, '11230', '新座市 片山三丁目'],
    [139.586, 35.674, '13204', '三鷹市 北野一丁目'],
    [139.598, 35.618, '14134', '川崎市高津区 宇奈根'],
    [139.622, 35.770, '11229', '和光市 白子一丁目'],
    [139.666, 35.586, '14133', '川崎市中原区 上丸子天神町'],
    [139.702, 35.554, '14132', '川崎市幸区 小向'],
    [139.762, 35.814, '11203', '川口市 本蓮四丁目'],
  ],
  osaka: [
    [135.432, 34.714, '28202', '尼崎市 杭瀬南新町三丁目'],
    [135.448, 34.734, '28202', '尼崎市 神崎町'],
    [135.472, 34.734, '27203', '豊中市 神州町'],
    [135.476, 34.598, '27141', '堺市堺区 南島町六丁'],
    [135.504, 34.586, '27146', '堺市北区 常磐町一丁'],
    [135.532, 34.598, '27217', '松原市 天美北八丁目'],
    [135.556, 34.730, '27209', '守口市 平代町'],
    [135.580, 34.690, '27227', '東大阪市 稲田本町三丁目'],
  ],
};

test('G1 境界: 隣の自治体（GSIで確認した16地点）で、東京23区・大阪市のシートを出さない', () => {
  const bad = [];
  for (const [rid, pts] of Object.entries(NEIGHBORS)) {
    for (const [lon, lat, code, name] of pts) {
      const f = Lib.collect(D[rid], lon, lat);
      const s = Lib.buildSheet(D[rid], f);
      if (!s.outOfScope) bad.push(`${name}（実際 ${code}）→ ${Lib.REGIONS[rid].name}の ${f.cityCode} としてシートを出した`);
    }
  }
  assert.deepStrictEqual(bad, [], '隣の自治体なのにシートが出る:\n' + bad.join('\n'));
});

test('G2 境界: シートが災害を「想定区域の外にある」と言う地点は、データを同梱した地域の内側（XKT001 の範囲）にある', () => {
  // 災害の格子は XKT001 の範囲の外を 0（区域外）に消してある（tools/extract.mjs finish(mask)）。
  // 範囲の外の地点で「外にある」と出すと、データを持っていないのに安全側に読める文になる。
  const bad = [];
  for (const rid of ['tokyo23', 'osaka']) {
    const polys = regionPolys(rid);
    for (const [lon, lat, , name] of NEIGHBORS[rid]) {
      const s = Lib.buildSheet(D[rid], Lib.collect(D[rid], lon, lat));
      if (s.outOfScope || Lib.inPolys(lon, lat, polys)) continue;
      const hz = s.sections.find((x) => x.id === 'hazard');
      const outs = hz.lines.filter((l) => /想定区域の外にある/.test(l.text)).map((l) => l.tag);
      if (outs.length) bad.push(`${name}: ${outs.join('・')} を「外にある」と表示（この地点の災害データは同梱していない）`);
    }
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

test('G3 境界: 地域の内側（XKT001）の地点を、隣の市区町村として拒まない（練馬区・板橋区の縁）', () => {
  const pts = [[139.568, 35.744, '練馬区の縁'], [139.640, 35.795, '板橋区の縁']];
  const polys = regionPolys('tokyo23');
  const bad = [];
  for (const [lon, lat, name] of pts) {
    if (!Lib.inPolys(lon, lat, polys)) continue;
    const s = Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, lon, lat));
    if (s.outOfScope) bad.push(name + ': ' + s.outOfScope.slice(0, 60));
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

test('W1 文言: 東京23区のシートに「市全体との差」「市のハザードマップ」「市に、この地区」など、区と合わない呼び方が出ない', () => {
  const bad = [];
  for (const e of Lib.REGIONS.tokyo23.examples) {
    const t = sheetText(Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, e.lon, e.lat)));
    for (const w of ['市全体との差', '市のハザードマップ', '市に、この地区']) if (t.includes(w)) bad.push(e.label + ': 「' + w + '」');
  }
  assert.deepStrictEqual(bad, [], bad.join('\n'));
});

test('W2 印刷の加工の旨: 東京23区・大阪市のシート（印刷に入る .fine）に、用途地域・都市計画区域を使った旨が入る', () => {
  // 画面のフッターは Lib.processedFor(region) を使うが、シート（印刷）は Lib.PROCESSED のまま
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const sheetPart = app.slice(app.indexOf('function renderSheet'), app.indexOf('function renderStatus'));
  assert.ok(/processedFor\(/.test(sheetPart), 'renderSheet が Lib.PROCESSED を直接出しており、印刷したシートに「用途地域・都市計画区域」の加工の旨が入らない');
});

test('W3 タグ: 「データ無し」（取得できたが0件）の項目に「未取得」のタグを付けない（東京の津波・大阪の土砂/校区）', () => {
  const app = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const s = Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, 139.8723, 35.6637));
  const hz = s.sections.find((x) => x.id === 'hazard');
  assert.ok(hz.missing.some((m) => m.includes(Lib.NODATA)), '前提: 葛西の災害の節に「データ無し」の項目がある');
  // renderSheet は sec.missing のすべてに <span class="tag">未取得</span> を付ける
  assert.ok(!app.includes(`sec.missing.map((m) => '<li class="unf"><span class="tag">' + Lib.UNFETCHED`), '「データ無し」の項目にも「未取得」のタグが付く（タグと本文が食い違う）');
});

test('S1 校区: XKT004 を「取得済み」とする東京23区で、校区データが1件も無い区がない', () => {
  const have = new Set(raw.tokyo23.districts.items.map((x) => String(x.city)));
  const lack = Lib.REGIONS.tokyo23.codes.filter((c) => !have.has(c));
  assert.deepStrictEqual(lack, [], '校区データの無い区: ' + lack.join(',') + '（品川区・荒川区。シートは「取得したデータにありません」とだけ出し、状態一覧は「取得済み」）');
});

test('P1 提出文: reinfolib.md の「API14種」「3地域で表示済み」が、地域ごとの取得済み項目数と合う', () => {
  const t = fs.readFileSync(path.join(SUB, 'reinfolib.md'), 'utf8');
  const claimed = Number((t.match(/API(\d+)種/) || [])[1]);
  const per = {};
  for (const rid of ['tokushima', 'tokyo23', 'osaka']) {
    const d = D[rid] || load(rid);
    per[rid] = Object.values(d.status).filter((s) => s.state === 'ok').length;
  }
  const max = Math.max(...Object.values(per));
  assert.ok(claimed <= max, `提出文は ${claimed}種。実際に表示できる項目数は 徳島市 ${per.tokushima}・東京23区 ${per.tokyo23}・大阪市 ${per.osaka}（どの地域も${claimed}種に届かない）`);
});

test('P2 提出文: service.md の⑤（洪水・津波・高潮・液状化・土砂）に、東京23区は津波・大阪市は土砂が「データ無し」である旨が添えてある', () => {
  const t = fs.readFileSync(path.join(SUB, 'service.md'), 'utf8');
  assert.ok(/津波.{0,30}(東京|23区).{0,20}(無|な)|土砂.{0,30}大阪.{0,20}(無|な)|(東京|23区).{0,20}津波.{0,20}(無|な)/.test(t), 'service.md は3地域とも5種の災害を出すように読める（東京23区の津波・大阪市の土砂災害は「データ無し」）');
});

test('P3 課題: 東京23区で、周辺500mの人口が2025→2050年に減る地点が半数を超える（problem.md の「人口減」の起点が東京でも成り立つか）', () => {
  const R = Lib.REGIONS.tokyo23, d = D.tokyo23;
  const own = d.pop.meshes.filter((m) => R.codes.includes(m.sc)).filter((_, i) => i % 4 === 0);
  let n = 0, dec = 0;
  for (const m of own) {
    const q = Lib.popAround(d.pop, R, m.lon, m.lat, 500);
    if (q.local[2025].p < Lib.SMALL_POP) continue;
    n++; if (q.local[2050].p < q.local[2025].p) dec++;
  }
  assert.ok(dec / n > 0.5, `23区で周辺人口が減る地点は ${dec}/${n}（${Math.round((dec / n) * 100)}%）。多くの地点で②は「増える」と出る`);
});
