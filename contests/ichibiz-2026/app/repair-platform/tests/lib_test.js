// ロジックのテスト。実行: node --test tests/lib_test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../web/lib.js');

const web = path.join(__dirname, '../web');
const read = (f) => JSON.parse(fs.readFileSync(path.join(web, 'data', f), 'utf8'));
const S = read('mlit-survey.json');
const B = read('buildings.json');
const DEMO = read('demo.json');

test('国交省調査の転記: 四分位が昇順で、頁の出典が付いている', () => {
  for (const k of ['1', '2', '3']) {
    for (const m of ['perUnit', 'perSqm', 'total']) {
      const s = S.byCount[k][m];
      assert.ok(s.q1 < s.median && s.median < s.q3, `${k}/${m}`);
      assert.match(s.page, /報告書 p\.\d+/);
    }
  }
  // 概要・報告書の数値の転記（p.13〜15）
  assert.equal(S.byCount['1'].perUnit.median, 110.2);
  assert.equal(S.byCount['2'].perUnit.median, 106.1);
  assert.equal(S.byCount['3'].perUnit.median, 97.0);
  assert.equal(S.byCount['1'].perSqm.median, 1.1);
  assert.equal(S.byCount['2'].perSqm.q3, 1.6);
  assert.equal(S.byCount['1'].total.median, 8665.0);
  assert.match(S.license, /要確認/);
});

test('国交省調査の内訳比率の合計と、外壁関係・防水関係の合計', () => {
  const sum = (a) => a.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(sum(S.breakdown.total) - 100) < 0.5);
  assert.ok(Math.abs(sum(S.breakdown.building) - 100) < 0.5);
  const g = (name) => S.breakdown.building.filter((x) => x.group === name).reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(g('外壁関係') - S.breakdown.groups['外壁関係']) < 0.05);
  assert.ok(Math.abs(g('防水関係') - S.breakdown.groups['防水関係']) < 0.05);
  const h = S.histPerUnit.bins.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(h - 100) < 0.5);
});

test('目安の範囲: 戸数×戸あたり、延床×㎡あたり（下位25%値〜上位25%値）', () => {
  const r = L.estimate({ units: 50, tfa: 4000, age: 0, count: '1', quote: 0, quoteTaxIn: false }, S);
  assert.equal(r.ranges.length, 2);
  const u = r.ranges.find((x) => x.key === 'perUnit');
  assert.ok(Math.abs(u.low - 90.9 * 50) < 1e-9 && Math.abs(u.mid - 110.2 * 50) < 1e-9 && Math.abs(u.high - 134.0 * 50) < 1e-9);
  const q = r.ranges.find((x) => x.key === 'perSqm');
  assert.ok(Math.abs(q.mid - 1.1 * 4000) < 1e-9);
  assert.equal(r.positions.length, 0);
  // 戸数だけなら戸あたりの範囲だけ
  assert.equal(L.estimate({ units: 50, tfa: 0, count: '2', quote: 0 }, S).ranges.length, 1);
  // 何も無ければ範囲なし
  assert.equal(L.estimate({ units: 0, tfa: 0, count: '3', quote: 0 }, S).ranges.length, 0);
});

test('見積の位置: 中央値との差、上位25%・下位25%・中間の判定、税込は10%を除く', () => {
  // 50戸、1回目。戸あたりの中央値110.2 → 総額5510万円は「中央値と同じ」
  let r = L.estimate({ units: 50, tfa: 0, count: '1', quote: 5510, quoteTaxIn: false }, S);
  const pu = r.positions.find((x) => x.key === 'perUnit');
  assert.equal(pu.rel, '中央値と同じ');
  assert.equal(pu.band, 'q1-median');
  // 戸あたり 150万円（総額7500万円）は上位25%値134.0を超える
  r = L.estimate({ units: 50, tfa: 0, count: '1', quote: 7500, quoteTaxIn: false }, S);
  const hi = r.positions.find((x) => x.key === 'perUnit');
  assert.equal(hi.band, 'above-q3');
  assert.match(hi.text, /上位25%に入る/);
  assert.match(hi.rel, /^中央値より36\.1%高い$/);
  // 戸あたり 80万円は下位25%値90.9を下回る
  r = L.estimate({ units: 50, tfa: 0, count: '1', quote: 4000, quoteTaxIn: false }, S);
  assert.equal(r.positions.find((x) => x.key === 'perUnit').band, 'below-q1');
  // 中央値と上位の間
  r = L.estimate({ units: 50, tfa: 0, count: '1', quote: 6500, quoteTaxIn: false }, S);
  assert.equal(r.positions.find((x) => x.key === 'perUnit').band, 'median-q3');
  // 税込の見積は 1.1 で割ってから比べる
  r = L.estimate({ units: 50, tfa: 0, count: '1', quote: 6050, quoteTaxIn: true }, S);
  assert.ok(Math.abs(r.quoteEx - 5500) < 1e-9);
  assert.ok(Math.abs(L.exTax(110, true) - 100) < 1e-9);
  // ㎡あたりも出る。5,000㎡で総額6,500万円=1.3万円/㎡ は中央値1.1より高い
  r = L.estimate({ units: 0, tfa: 5000, count: '1', quote: 6500, quoteTaxIn: false }, S);
  const sq = r.positions.find((x) => x.key === 'perSqm');
  assert.ok(sq.diffPct > 0 && sq.band === 'median-q3');
  // 総額の位置は「規模を考えない参考」の印が付く
  assert.ok(r.positions.find((x) => x.key === 'total').scaleFree);
});

test('築年からの工事回数の見当（平均周期を足し上げた築年に最も近い回）', () => {
  assert.equal(L.countHint(0, S.cycle.years), null);
  assert.equal(L.countHint(15, S.cycle.years).count, '1');
  assert.equal(L.countHint(30, S.cycle.years).count, '2');
  assert.equal(L.countHint(43, S.cycle.years).count, '3');
  assert.equal(L.countHint(60, S.cycle.years).count, '3');
  const c = L.countHint(15, S.cycle.years).cum;
  assert.ok(Math.abs(c[0] - 15.6) < 1e-9 && Math.abs(c[1] - 29.6) < 1e-9 && Math.abs(c[2] - 42.5) < 1e-9);
});

test('PLATEAU の建物データ: 検証・件数・属性の付与率（建築年・階数・延床・用途は0%）', () => {
  assert.ok(L.validateBuildings(B));
  assert.equal(B.meta.ward, '墨田区');
  assert.equal(B.stats.total, 46386);
  const r = Object.fromEntries(L.fillRates(B.stats).map((x) => [x.key, x]));
  assert.equal(r.height.pct, 100);
  assert.ok(r.roofArea.pct > 90 && r.roofArea.pct < 95);
  assert.equal(r.year.n, 0);
  assert.equal(r.floors.n, 0);
  assert.equal(r.tfa.n, 0);
  assert.equal(r.usage.n, 0);
  assert.match(B.meta.license, /PLATEAU/);
  // 候補は高さ・屋根面積の条件を満たす
  assert.ok(B.buildings.every((b) => b.h >= B.meta.minHeight && b.area >= B.meta.minArea));
  // 墨田区の範囲に入っている（経度139.78〜139.87、緯度35.68〜35.75）
  assert.ok(B.buildings.every((b) => b.lon > 139.78 && b.lon < 139.87 && b.lat > 35.68 && b.lat < 35.75));
});

test('階数・延床・外壁面積の概算（仮定の階高を使う）', () => {
  assert.equal(L.floorsFromHeight(29.6, 3), 10);
  assert.equal(L.floorsFromHeight(2, 3), 1);
  const e = L.enrich({ id: 'x', h: 30, area: 400, per: 80 }, 3);
  assert.equal(e.floors, 10);
  assert.equal(e.tfa, 4000);
  assert.equal(e.wall, 2400);
});

test('似た建物: 階数の差±2以内で、延床の比が近い順。自分自身は含まない', () => {
  const list = [
    { id: 'a', h: 30, area: 400, per: 80 }, // 10階 4000
    { id: 'b', h: 30, area: 390, per: 80 }, // 10階 3900
    { id: 'c', h: 27, area: 500, per: 90 }, // 9階 4500
    { id: 'd', h: 60, area: 400, per: 80 }, // 20階（対象外）
    { id: 'e', h: 30, area: 300, per: 70 }, // 10階 3000
  ].map((b) => L.enrich(b, 3));
  const out = L.similar(list, list[0], 10, 3);
  assert.deepEqual(out.map((x) => x.b.id), ['b', 'c', 'e']);
  assert.ok(out[0].ratio < 1);
});

test('外周×高さ: 合成の点群の外壁面積が、箱の正解（60m×9m=540㎡）に近い', () => {
  const cloud = L.synthCloud();
  assert.ok(cloud.count > 10000);
  const a = L.analyzeCloud(cloud, 'z');
  assert.ok(Math.abs(a.perimeter - 60) < 1, 'perimeter ' + a.perimeter);
  assert.ok(Math.abs(a.wall - 540) / 540 < 0.05, 'wall ' + a.wall);
  assert.ok(!a.slender);
});

test('点群: 壁1面だけ（細長い）なら外周を2で割る警告つきにする', () => {
  const pts = [];
  for (let x = 0; x < 6; x += 0.1) for (let z = 0; z < 3; z += 0.1) pts.push(x, 0, z);
  const a = L.analyzeCloud({ points: Float32Array.from(pts), count: pts.length / 3, total: pts.length / 3 }, 'z');
  assert.ok(a.slender);
  assert.ok(Math.abs(a.wallLen - 6) < 0.5);
});

test('点群: Y 軸を上にした向きでも同じ結果', () => {
  const c = L.synthCloud();
  const sw = new Float32Array(c.points.length);
  for (let i = 0; i < c.count; i++) { sw[i * 3] = c.points[i * 3]; sw[i * 3 + 1] = c.points[i * 3 + 2]; sw[i * 3 + 2] = c.points[i * 3 + 1]; }
  const a = L.analyzeCloud({ points: sw, count: c.count, total: c.count }, 'y');
  assert.ok(Math.abs(a.wall - 540) / 540 < 0.05);
});

test('PLY（ASCII・バイナリ）、LAS、XYZ を読める。LAZ は読めない旨のエラー', () => {
  const c = { points: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 1, 1, 1]), count: 4, total: 4 };
  const ascii = L.toPLY(c);
  const abA = new TextEncoder().encode(ascii).buffer;
  const pa = L.parseCloud(abA, 'a.ply');
  assert.equal(pa.count, 4);
  assert.deepEqual(Array.from(pa.points.slice(0, 3)), [1, 2, 3]);
  // バイナリ
  const head = 'ply\nformat binary_little_endian 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n';
  const hb = new TextEncoder().encode(head);
  const buf = new ArrayBuffer(hb.length + 4 * 13);
  new Uint8Array(buf).set(hb, 0);
  const dv = new DataView(buf, hb.length);
  for (let i = 0; i < 4; i++) { dv.setFloat32(i * 13, c.points[i * 3], true); dv.setFloat32(i * 13 + 4, c.points[i * 3 + 1], true); dv.setFloat32(i * 13 + 8, c.points[i * 3 + 2], true); dv.setUint8(i * 13 + 12, 200); }
  const pb = L.parseCloud(buf, 'b.ply');
  assert.equal(pb.count, 4);
  assert.deepEqual(Array.from(pb.points.slice(3, 6)), [4, 5, 6]);
  // LAS 1.2（形式0、20バイト）
  const las = new ArrayBuffer(227 + 3 * 20);
  const lv = new DataView(las);
  'LASF'.split('').forEach((ch, i) => lv.setUint8(i, ch.charCodeAt(0)));
  lv.setUint8(24, 1); lv.setUint8(25, 2); lv.setUint16(94, 227, true); lv.setUint32(96, 227, true); lv.setUint8(104, 0); lv.setUint16(105, 20, true); lv.setUint32(107, 3, true);
  [0.01, 0.01, 0.01].forEach((s, i) => lv.setFloat64(131 + i * 8, s, true));
  [100, 200, 300].forEach((o, i) => lv.setFloat64(155 + i * 8, o, true));
  for (let i = 0; i < 3; i++) { lv.setInt32(227 + i * 20, 100 * (i + 1), true); lv.setInt32(227 + i * 20 + 4, 200, true); lv.setInt32(227 + i * 20 + 8, 300, true); }
  const pl = L.parseCloud(las, 'c.las');
  assert.equal(pl.count, 3);
  assert.ok(Math.abs(pl.points[0] - 101) < 1e-3 && Math.abs(pl.points[1] - 202) < 1e-3 && Math.abs(pl.points[2] - 303) < 1e-3);
  // XYZ
  const px = L.parseCloud(new TextEncoder().encode('1 2 3\n4,5,6\nx y z\n').buffer, 'd.xyz');
  assert.equal(px.count, 2);
  // LAZ
  assert.throws(() => L.parseCloud(new ArrayBuffer(300), 'e.laz'), /LAZ/);
  assert.throws(() => L.parseCloud(new TextEncoder().encode('abc').buffer, 'e.bin'), /対応する形式/);
});

test('口コミの並び: 投稿日の新しい順だけ。評価・会社・利害関係の申告で並びが変わらない', () => {
  const base = DEMO.reviews;
  const a = L.sortReviews(base).map((r) => r.id);
  // 並びの決定に使える入力を書き換えても、並びは同じ
  const mutated = base.map((r) => Object.assign({}, r, { stars: 6 - r.stars, company: 'Z' + r.company, stake: r.stake === 'none' ? 'related' : 'none' }));
  assert.deepEqual(L.sortReviews(mutated).map((r) => r.id), a);
  // 日付の順になっている
  const dates = L.sortReviews(base).map((r) => r.date);
  assert.deepEqual(dates, dates.slice().sort().reverse());
  // 入力の順番を変えても同じ
  assert.deepEqual(L.sortReviews(base.slice().reverse()).map((r) => r.id), a);
});

test('デモの事例・口コミはすべて「架空」と書いてある', () => {
  assert.match(DEMO.notice, /架空/);
  for (const c of DEMO.cases) assert.match(c.name + c.memo, /架空/);
  for (const r of DEMO.reviews) assert.match(r.company + r.text, /架空/);
});

test('表現: 「査定」を使わない。「適正」は「保証しない」と一緒にだけ使う。一点断定の語がない', () => {
  const files = ['index.html', 'app.js', 'lib.js', 'style.css'].map((f) => [f, fs.readFileSync(path.join(web, f), 'utf8')]);
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8'); // 指示の原文を引用するので、語の検査は画面側だけ
  assert.ok(/適正な金額であることを保証しません/.test(readme) && /要確認/.test(readme));
  for (const [name, text] of files) {
    assert.ok(!text.includes('査定'), name + ' に「査定」');
    assert.ok(!/適正価格|適正料金|適正な料金|相場価格を保証/.test(text.replace(/「適正料金」|適正料金を一点|「適正価格」/g, '')), name + ' に断定の語');
    for (const m of text.matchAll(/適正/g)) {
      const around = text.slice(Math.max(0, m.index - 30), m.index + 40);
      assert.ok(/保証|断定|名乗|言い切|適正化|条件|使わ|一点|表示|範囲|ではありません|ではない|論点|不実証|ない/.test(around), name + ' の「適正」の周り: ' + around);
    }
  }
  assert.match(L.DISCLAIMER, /適正な金額であることを保証しません/);
  assert.match(L.LICENSE_NOTE, /要確認/);
});

test('公的リンクは https。国交省の検索2点と公取委の公表を含む。チェック項目に出典がある', () => {
  assert.ok(L.LINKS.every((l) => l.url.startsWith('https://')));
  assert.ok(L.LINKS.some((l) => /etsuran2\.mlit\.go\.jp/.test(l.url)));
  assert.ok(L.LINKS.some((l) => /mlit\.go\.jp\/nega-inf/.test(l.url)));
  assert.ok(L.LINKS.some((l) => /jftc\.go\.jp.*260928/.test(l.url)));
  assert.ok(L.CHECKLIST.length >= 6 && L.CHECKLIST.every((c) => c.text && c.basis));
});

test('外部への送信がない: POST・sendBeacon・XMLHttpRequest を使っていない。GET の fetch は同梱データだけ', () => {
  const app = fs.readFileSync(path.join(web, 'app.js'), 'utf8');
  assert.ok(!/method\s*:\s*['"]POST|sendBeacon|XMLHttpRequest|WebSocket/i.test(app));
  const urls = [...app.matchAll(/fetch\(\s*([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 1);
  assert.ok(urls.every((u) => /data\//.test(u) || /DATA|file/.test(u)), urls.join(' | '));
});

test('規模の検査: 超高層・大規模は目安を出さない。小さすぎる建物は警告', () => {
  assert.equal(L.scaleCheck({ floors: 62, tfa: 1896890 }).blocked, true);
  assert.equal(L.scaleCheck({ floors: 41, tfa: 20000 }).blocked, true);
  assert.equal(L.scaleCheck({ floors: 10, tfa: 60000 }).blocked, true);
  assert.equal(L.scaleCheck({ floors: 10, tfa: 4000 }).blocked, false);
  assert.equal(L.scaleCheck({ floors: 4, tfa: 650 }).small, true);
  assert.equal(L.unitsFromTfa(7000), 100);
});

test('戸数と延床の食い違い: 1戸あたり30〜150㎡の外なら、延床あたりの範囲と位置を出さず、戸あたりを主にする', () => {
  // 60戸・650㎡（1戸11㎡）
  let r = L.estimate({ units: 60, tfa: 650, count: '1', quote: 9500, quoteTaxIn: false }, S);
  assert.ok(r.conflict && r.conflict.per < 30);
  assert.ok(!r.ranges.some((x) => x.key === 'perSqm') && !r.positions.some((x) => x.key === 'perSqm'));
  assert.equal(r.primary.key, 'perUnit');
  assert.equal(r.primaryPos.key, 'perUnit');
  // 60戸・23,474㎡（1戸391㎡）
  r = L.estimate({ units: 60, tfa: 23474, count: '1', quote: 9500, quoteTaxIn: false }, S);
  assert.ok(r.conflict && r.conflict.per > 150);
  // 整合していれば両方出す
  r = L.estimate({ units: 50, tfa: 4000, count: '1', quote: 6000, quoteTaxIn: false }, S);
  assert.equal(r.conflict, null);
  assert.ok(r.positions.some((x) => x.key === 'perSqm'));
  // 延床だけなら延床あたりが主
  r = L.estimate({ units: 0, tfa: 4000, count: '1', quote: 0 }, S);
  assert.equal(r.primary.key, 'perSqm');
  // 10倍を超える比率は「桁を確認」
  assert.match(L.position(100, { q1: 0.9, median: 1.1, q3: 1.4 }).rel, /桁を確認/);
});

test('複数社の見積: 同じ主指標で位置づける。口コミは会社ごとに件数と利害関係ありの件数だけ', () => {
  const inp = { units: 50, tfa: 0, count: '1' };
  const c = L.compareQuotes([{ name: 'A', amount: 4000 }, { name: 'B', amount: 0 }, { name: 'C', amount: 7500 }], inp, S);
  assert.equal(c.length, 2);
  assert.equal(c[0].pos.band, 'below-q1');
  assert.equal(c[1].pos.band, 'above-q3');
  assert.ok(Math.abs(L.compareQuotes([{ name: 'A', amount: 6050, taxIn: true }], inp, S)[0].ex - 5500) < 1e-9);
  const rc = L.reviewCounts(DEMO.reviews, DEMO.reviews[0].company);
  assert.ok(rc.n >= 1 && rc.related >= 0 && !('avg' in rc));
  assert.equal(L.reviewCounts(DEMO.reviews, '').n, 0);
});

test('似た建物: 対象外の規模を除き、同じ町・同じ規模の重複をまとめる', () => {
  const list = [
    { id: 't', h: 30, area: 400, per: 80, town: '甲' },
    { id: 'x1', h: 30, area: 401, per: 80, town: '乙' },
    { id: 'x2', h: 30, area: 401, per: 80, town: '乙' },
    { id: 'big', h: 30, area: 6000, per: 300, town: '丙' },
  ].map((b) => L.enrich(b, 3));
  const out = L.similar(list, list[0], 10, 3);
  assert.deepEqual(out.map((x) => x.b.id), ['x1']);
});
