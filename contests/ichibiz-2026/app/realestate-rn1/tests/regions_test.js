// 実行: node --test contests/ichibiz-2026/app/realestate-rn1/tests/regions_test.js
// 東京23区・大阪市を足した分の検査（徳島市は lib_test.js）。同梱した実データ（web/data/<地域>/）で、画面のロジック（web/lib.js）を調べる。ネットワーク・APIキー不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Lib = require('../web/lib.js');

const ROOT = path.join(__dirname, '../web/data');
const FILES = { 'plan.json': 'plan', 'population.json': 'population', 'districts.json': 'districts', 'facilities.json': 'facilities', 'hazards.json': 'hazards', 'zoning.json': 'zoning' };
const rd = (rid, f) => JSON.parse(fs.readFileSync(path.join(ROOT, Lib.REGIONS[rid].dir, f), 'utf8'));
const load = (rid, mut) => {
  const manifest = rd(rid, 'manifest.json');
  const files = {};
  for (const [file, k] of Object.entries(FILES)) if (fs.existsSync(path.join(ROOT, Lib.REGIONS[rid].dir, file))) files[k] = rd(rid, file);
  if (mut) mut(manifest, files);
  return Lib.assemble(manifest, files, Lib.REGIONS[rid]);
};
const NEW = ['tokyo23', 'osaka'];
const D = { tokyo23: load('tokyo23'), osaka: load('osaka') };
const text = (s) => JSON.stringify(s);
const FORBID = ['住めない', '価値が下がる', '価値が上がる', '資産価値', '査定', '買うべき', '売るべき', 'おすすめ', '安全です', '危険です'];
// 徳島市だけに出す引用・名称
const TOKUSHIMA_ONLY = ['届出の手引', '居住促進区域', '徳島'];

test('地域の定義: 3地域・市区町村コード（東京23区=13101〜13123、大阪市=市27100＋24区）・取得範囲が地域ごとにある', () => {
  assert.deepStrictEqual(Object.keys(Lib.REGIONS), ['tokushima', 'tokyo23', 'osaka']);
  assert.strictEqual(Lib.REGIONS.tokyo23.codes.length, 23);
  assert.strictEqual(Lib.REGIONS.tokyo23.codes[0], '13101');
  assert.strictEqual(Lib.REGIONS.tokyo23.codes[22], '13123');
  assert.strictEqual(Lib.REGIONS.osaka.codes.length, 25);
  assert.ok(Lib.regionHas(Lib.REGIONS.osaka, '27127') && Lib.regionHas(Lib.REGIONS.osaka, '27100') && !Lib.regionHas(Lib.REGIONS.osaka, '27140')); // 堺市は含まない
  assert.ok(!Lib.regionHas(Lib.REGIONS.tokyo23, '13201') && !Lib.regionHas(Lib.REGIONS.tokyo23, '14130')); // 八王子市・川崎市は含まない
  assert.strictEqual(Lib.planKey(Lib.REGIONS.osaka, '27127'), '27100'); // 大阪市は区のコードを市のコードにまとめる
  assert.strictEqual(Lib.planKey(Lib.REGIONS.tokyo23, '13112'), '13112');
  for (const r of Object.values(Lib.REGIONS)) {
    assert.ok(r.bbox[0] < r.bbox[2] && r.bbox[1] < r.bbox[3] && r.examples.length >= 3, r.id);
    assert.ok(fs.existsSync(path.join(ROOT, r.dir, 'manifest.json')), r.id);
  }
});

test('同梱データ: 地域ごとに manifest と件数が一致し、項目の状態（取得済み・データ無し・未取得）が記録されている', () => {
  for (const rid of NEW) {
    const m = rd(rid, 'manifest.json'), d = D[rid];
    assert.strictEqual(m.region, rid);
    for (const api of Object.keys(Lib.apisFor(Lib.REGIONS[rid]))) {
      assert.ok(['ok', 'empty', 'failed', 'missing'].includes(d.status[api].state), api);
      if (d.status[api].state === 'ok') assert.strictEqual(d.status[api].count, m.layers[api].count, rid + ' ' + api);
      if (d.status[api].state === 'empty') assert.ok(d.status[api].reason.includes('0件'), rid + ' ' + api);
    }
    // 人口・用途地域・区域区分・洪水・液状化は必ずある（無いとシートが成り立たない）
    for (const api of ['XKT013', 'XKT002', 'XKT001', 'XKT026']) assert.strictEqual(d.status[api].state, 'ok', rid + ' ' + api + ' ' + text(d.status[api]));
    assert.ok(d.pop.meshes.filter((m2) => Lib.regionHas(Lib.REGIONS[rid], m2.sc)).length > 1000, rid);
  }
});

test('同梱データにAPIキーらしき文字列が入っていない（全地域。32桁以上の英数字がない。格子のbase64は除く）', () => {
  const re = /[A-Za-z0-9]{32,}/;
  for (const r of Object.values(Lib.REGIONS)) {
    for (const f of fs.readdirSync(path.join(ROOT, r.dir))) {
      const raw = fs.readFileSync(path.join(ROOT, r.dir, f), 'utf8');
      const j = JSON.parse(raw);
      for (const k of ['flood', 'tsunami', 'surge', 'liquefaction']) if (j[k]) { delete j[k].bits; delete j[k].lv; }
      assert.ok(!re.test(JSON.stringify(j)), r.id + '/' + f);
      if (process.env.REINFOLIB_API_KEY) assert.ok(!raw.includes(process.env.REINFOLIB_API_KEY), r.id + '/' + f);
    }
  }
});

test('同梱量: 地域ごとに分けてあり、目安（徳島市 5MB・大阪市 5MB・東京23区 15MB・合計 25MB）に収まる。起動時に読むのは選んだ地域だけ', () => {
  const size = (rid) => fs.readdirSync(path.join(ROOT, Lib.REGIONS[rid].dir)).reduce((t, f) => t + fs.statSync(path.join(ROOT, Lib.REGIONS[rid].dir, f)).size, 0);
  const MB = 1024 * 1024;
  assert.ok(size('tokushima') < 5 * MB, String(size('tokushima')));
  assert.ok(size('osaka') < 5 * MB, String(size('osaka')));
  assert.ok(size('tokyo23') < 15 * MB, String(size('tokyo23')));
  assert.ok(size('tokushima') + size('osaka') + size('tokyo23') < 25 * MB);
  // 画面は選んだ地域の data/<dir>/ だけを読む（他の地域のパスを固定で読まない）
  const app = fs.readFileSync(path.join(__dirname, '../web/app.js'), 'utf8');
  assert.ok(app.includes("'data/' + region.dir + '/'"));
  assert.ok(!/data\/(tokyo23|osaka|tokushima)\//.test(app));
});

test('用途地域の代用: 立地適正化計画のデータが無い区（市）の指定地点では、代用の旨・規制であること・居住誘導区域ではないことを書き、断定しない', () => {
  for (const rid of NEW) {
    const d = D[rid], reg = Lib.REGIONS[rid];
    let n = 0, substituted = 0;
    for (const ex of reg.examples) {
      const f = Lib.collect(d, ex.lon, ex.lat);
      assert.ok(Lib.regionHas(reg, f.cityCode), rid + ' ' + ex.label + ' ' + f.cityCode);
      const s = Lib.buildSheet(d, f);
      assert.strictEqual(s.sections.length, 5, rid + ' ' + ex.label);
      const plan = s.sections[0], t = text(plan);
      n++;
      if (f.plan && f.plan.hasPlan) { // この区は XKT003 のデータがある: 計画の区域を出す
        assert.ok(plan.lines.some((l) => l.tag === 'XKT003' && /区域/.test(l.text)), ex.label);
        continue;
      }
      substituted++;
      assert.ok(t.includes('立地適正化計画のデータが無いため、用途地域を示す'), ex.label);
      assert.ok(t.includes('用途地域は建てられる建物の規制で、居住を誘導する区域ではない'), ex.label);
      assert.ok(t.includes('XKT002'), ex.label);
      assert.ok(plan.title.includes('用途地域'), plan.title);
      assert.ok(plan.lines.some((l) => l.tag === 'XKT002' && l.text.startsWith('用途地域: ')), ex.label + ' ' + t);
      assert.ok(plan.lines.some((l) => l.tag === 'XKT001'), ex.label);
    }
    assert.strictEqual(n, reg.examples.length);
    assert.ok(substituted >= 1, rid + ' 代用の地点が1つもない'); // 計画のデータがある区が混じっていても、少なくとも1地点は代用
  }
});

test('XKT003 の結果: 23区・大阪市で返った区域は、その区の計画の区域として出し、返らなかった区は代用にする（取得結果と画面が食い違わない）', () => {
  for (const rid of NEW) {
    const d = D[rid], m = rd(rid, 'manifest.json'), reg = Lib.REGIONS[rid];
    const planCities = d.plan ? [...new Set(d.plan.map((e) => e.cityCode))] : [];
    if (d.status.XKT003.state === 'empty') assert.strictEqual(planCities.length, 0);
    for (const c of planCities) assert.ok(Lib.regionHas(reg, c), rid + ' ' + c);
    // 受信の内訳（byCity）は、記録として残っている
    assert.ok(m.layers.XKT003.byCity && typeof m.layers.XKT003.byCity === 'object', rid);
    // 計画のある区の点では hasPlan、それ以外では代用
    for (const c of Lib.REGIONS[rid].codes) {
      const mesh = d.pop.meshes.find((x) => x.sc === c);
      if (!mesh) continue;
      const f = Lib.collect(d, mesh.lon, mesh.lat);
      if (!Lib.regionHas(reg, f.cityCode)) continue;
      const has = !!(f.plan && f.plan.hasPlan);
      assert.strictEqual(has, planCities.includes(Lib.planKey(reg, f.cityCode)), rid + ' ' + c);
    }
  }
});

test('徳島市の引用（届出の手引・居住促進区域）は徳島市のシートだけ。東京23区・大阪市のシートには出ない', () => {
  const tk = Lib.assemble(JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/manifest.json'), 'utf8')), {
    plan: JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/plan.json'), 'utf8')), population: JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/population.json'), 'utf8')),
    districts: JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/districts.json'), 'utf8')), facilities: JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/facilities.json'), 'utf8')), hazards: JSON.parse(fs.readFileSync(path.join(ROOT, 'tokushima/hazards.json'), 'utf8')),
  });
  assert.ok(text(Lib.buildSheet(tk, Lib.collect(tk, 134.4845, 34.054))).includes('届出の手引')); // 徳島市の郊外には出る
  for (const rid of NEW) {
    const d = D[rid];
    for (let i = 0; i < 25; i++) for (let j = 0; j < 25; j++) {
      const b = Lib.REGIONS[rid].bbox;
      const lon = b[0] + ((i + 0.5) / 25) * (b[2] - b[0]), lat = b[1] + ((j + 0.5) / 25) * (b[3] - b[1]);
      const f = Lib.collect(d, lon, lat);
      if (!Lib.regionHas(Lib.REGIONS[rid], f.cityCode)) continue;
      const t = text(Lib.buildSheet(d, f));
      for (const w of TOKUSHIMA_ONLY) assert.ok(!t.includes(w), rid + ' ' + w + ' @' + lon + ',' + lat);
    }
  }
});

test('文言: 地域内の格子点で、断定語を出さない・災害の節に「該当なし」を書かない・5節がそろう・数値の欠けがない・他の地域の名前が出ない', () => {
  for (const rid of NEW) {
    const d = D[rid], reg = Lib.REGIONS[rid], b = reg.bbox;
    const others = Object.values(Lib.REGIONS).filter((r) => r.id !== rid).map((r) => r.whole);
    let n = 0;
    for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
      const lon = b[0] + ((i + 0.5) / 40) * (b[2] - b[0]), lat = b[1] + ((j + 0.5) / 40) * (b[3] - b[1]);
      const f = Lib.collect(d, lon, lat);
      if (!Lib.regionHas(reg, f.cityCode)) continue;
      const s = Lib.buildSheet(d, f);
      n++;
      assert.strictEqual(s.sections.length, 5);
      const t = text(s);
      for (const w of FORBID) assert.ok(!t.includes(w), rid + ' ' + w + ' @' + lon + ',' + lat);
      assert.ok(!text(s.sections.find((x) => x.id === 'hazard')).includes('該当なし'), rid + ' 災害の節に該当なし @' + lon + ',' + lat); // 施設の「直線800m以内に該当なし」とは別。災害は「データ無し」と「想定区域の外」を区別する
      for (const w of others) assert.ok(!t.includes(w), rid + ' ' + w);
      assert.ok(!/NaN|undefined|Infinity/.test(t), t.match(/.{20}(NaN|undefined|Infinity).{20}/)?.[0]);
      if (f.pop && f.pop.meshN && f.pop.local[2025].p >= Lib.SMALL_POP && f.pop.local[2050].p > 0) assert.ok(t.includes(reg.whole), rid + ' 全体との比較に地域名が出る（少人数の地点は増減率を出さないので除く）');
    }
    assert.ok(n > 150, rid + ' ' + n);
  }
});

test('範囲外・地域外: 取得範囲の外・隣の自治体（川崎市・堺市）では、シートを出さず理由と「対象は○○のみ」を示す', () => {
  const t = Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, 135.5, 34.7));
  assert.ok(t.outOfScope.includes('範囲') && t.outOfScope.includes('東京23区') && t.sections.length === 0);
  const kawasaki = Lib.collect(D.tokyo23, 139.70, 35.53); // 川崎市川崎区付近（取得範囲の中、東京23区の外）
  const ks = Lib.buildSheet(D.tokyo23, kawasaki);
  assert.ok(!kawasaki.cityCode || !Lib.regionHas(Lib.REGIONS.tokyo23, kawasaki.cityCode));
  assert.strictEqual(ks.sections.length, 0);
  assert.ok(/対象は東京23区のみ|メッシュ/.test(ks.outOfScope), ks.outOfScope);
  const sakai = Lib.collect(D.osaka, 135.50, 34.58); // 堺市堺区付近（取得範囲の南端）
  const ss = Lib.buildSheet(D.osaka, sakai);
  assert.strictEqual(ss.sections.length, 0);
  assert.ok(/対象は大阪市のみ|メッシュ|範囲/.test(ss.outOfScope), ss.outOfScope);
});

test('データ無し: 項目が「データ無し」（取得できたが0件）なら、その旨と理由を出し、「該当なし」「想定区域の外」とは書かない', () => {
  const d = load('tokyo23', (m, files) => {
    m.layers.XKT028 = { label: '津波浸水想定', status: 'empty', reason: '取得はできたが、対象範囲（0件を受信）に区域のデータが0件', file: 'hazards.json', part: 'tsunami' };
    delete files.hazards.tsunami;
  });
  assert.strictEqual(d.status.XKT028.state, 'empty');
  const f = Lib.collect(d, 139.7960, 35.6490); // 豊洲付近
  const s = Lib.buildSheet(d, f), hz = s.sections.find((x) => x.id === 'hazard');
  assert.ok(hz.missing.some((x) => x.includes('XKT028') && x.includes('データ無し') && x.includes('0件')), text(hz.missing));
  assert.ok(!hz.lines.some((l) => l.tag === 'XKT028'), '津波の行は出さない');
  // 2026-11-14: 行が重複していたため、注意は「データ無し」の項目そのものに入れた（印刷の文字を大きくするため）。意味は同じ
  assert.ok(hz.missing.some((x) => x.includes('XKT028') && x.includes('データ無し（取得できたが0件') && x.includes('安全という意味ではない')), text(hz.missing));
  assert.ok(!text(s).includes('津波浸水想定: 想定区域の外'));
  assert.ok(!text(hz).includes('該当なし'));
  // 未取得（失敗）は従来どおり「未取得」
  const d2 = load('tokyo23', (m, files) => { m.layers.XKT028 = { label: 'x', status: 'failed', reason: 'HTTP 500', file: 'hazards.json', part: 'tsunami' }; delete files.hazards.tsunami; });
  const hz2 = Lib.buildSheet(d2, Lib.collect(d2, 139.7960, 35.6490)).sections.find((x) => x.id === 'hazard');
  assert.ok(hz2.missing.some((x) => x.includes('XKT028') && x.includes('未取得')));
  assert.ok(!hz2.lines.some((l) => l.text.includes('データ無し（取得できたが0件）')));
});

test('実データ: 東京都の津波（XKT028）・大阪の福祉施設（XKT011）・XKT003 が、取得結果どおりに画面へ出る', () => {
  for (const rid of NEW) {
    const d = D[rid], m = rd(rid, 'manifest.json');
    const st = m.layers.XKT028.status;
    const ex = Lib.REGIONS[rid].examples[0];
    const s = Lib.buildSheet(d, Lib.collect(d, ex.lon, ex.lat)), hz = s.sections.find((x) => x.id === 'hazard');
    if (st === 'empty') assert.ok(hz.missing.some((x) => x.includes('XKT028') && x.includes('データ無し')) && !hz.lines.some((l) => l.tag === 'XKT028'), rid);
    else if (st === 'ok') assert.ok(hz.lines.some((l) => l.tag === 'XKT028'), rid);
    else assert.ok(hz.missing.some((x) => x.includes('XKT028') && x.includes('未取得')), rid);
  }
  // 福祉施設は、地域内の施設だけ（P14_003 の自治体コード）。大阪市の分が入っている
  assert.strictEqual(D.osaka.status.XKT011.state, 'ok');
  assert.ok(D.osaka.fac.elder.length > 100);
});

test('人口の集計: 地域ごとに、地域の市区町村コードのメッシュの合計が再計算できる（tools/city-summary.mjs と同じ式）', () => {
  for (const rid of NEW) {
    const d = D[rid], reg = Lib.REGIONS[rid];
    const ms = d.pop.meshes.filter((x) => Lib.regionHas(reg, x.sc));
    const s = Lib.sumMeshes(ms, d.pop.years);
    for (const y of d.pop.years) assert.ok(s[y].p > 100000 && Number.isFinite(s[y].c) && s[y].c < s[y].p, rid + y);
    assert.ok(Number.isFinite(Lib.changePct(s[2025].p, s[2050].p)));
    // 隣の自治体のメッシュは地域の合計に入らない
    assert.ok(d.pop.meshes.some((x) => !Lib.regionHas(reg, x.sc)), rid + ' 隣の自治体のメッシュ（半径500mの集計用）');
  }
  // 公表値の目安（国勢調査・住民基本台帳ではなく、国の推計）。東京23区は 900万人台、大阪市は 270万人前後
  const tk = Lib.sumMeshes(D.tokyo23.pop.meshes.filter((x) => Lib.regionHas(Lib.REGIONS.tokyo23, x.sc)), D.tokyo23.pop.years)[2025].p;
  const os = Lib.sumMeshes(D.osaka.pop.meshes.filter((x) => Lib.regionHas(Lib.REGIONS.osaka, x.sc)), D.osaka.pop.years)[2025].p;
  assert.ok(tk > 8.5e6 && tk < 1.05e7, String(tk));
  assert.ok(os > 2.4e6 && os < 3.0e6, String(os));
});

test('施設・災害の区域が、地域の内側だけ（隣の自治体を同梱しない）', () => {
  for (const rid of NEW) {
    const d = D[rid], reg = Lib.REGIONS[rid];
    // 取得範囲の四隅付近（隣の自治体・海）では、区域・格子が0
    const b = reg.bbox;
    for (const part of ['flood', 'liquefaction', 'surge', 'tsunami']) {
      const r = d.hazard && d.hazard[part];
      if (!r) continue;
      for (const [lon, lat] of [[b[0] + 0.002, b[1] + 0.002], [b[2] - 0.002, b[3] - 0.002]]) assert.strictEqual(Lib.levelAt(r, lon, lat), 0, rid + ' ' + part);
    }
  }
});

test('範囲外（2026-11-14）: 隣の市は市名で知らせる。シートの題に地域名・区名が入る。東京23区の老人福祉施設の「収録なし」は施設が無い意味ではないと書く', () => {
  const k = Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, 139.666, 35.586)); // 川崎市中原区
  assert.ok(k.outOfScope.includes('川崎市中原区') && k.outOfScope.includes('印刷はできません'), k.outOfScope);
  const a = Lib.buildSheet(D.osaka, Lib.collect(D.osaka, 135.432, 34.714)); // 尼崎市
  assert.ok(a.outOfScope.includes('尼崎市'), a.outOfScope);
  const s = Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, 139.8723, 35.6637));
  assert.ok(s.title.includes('東京23区') && s.title.includes('江戸川区'), s.title);
  const o = Lib.buildSheet(D.osaka, Lib.collect(D.osaka, 135.476, 34.607));
  assert.ok(o.title.includes('大阪市') && o.title.includes('住之江区'), o.title);
  const t = JSON.stringify(Lib.buildSheet(D.tokyo23, Lib.collect(D.tokyo23, 139.67, 35.6)).sections.find((x) => x.id === 'fac'));
  assert.ok(!/老人福祉施設: 直線800m以内に該当なし/.test(t), t);
});
