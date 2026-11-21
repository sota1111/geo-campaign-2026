// usage: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ageNorm, satNorm, segScore, rank, selectByBudget, totalKm, auc, calibrate, exclusionAccuracy, topShift, adoptWeight, MIN_AUC, MIN_GAIN, aucAt, AGE_UNKNOWN, parseCsv, parseCavity, parseOutcomes, distToSegM, nearestSegment, scannedFrom } from '../logic.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/toyonaka.json', import.meta.url)));
const cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]));

test('正規化は0〜1に収まる', () => {
  assert.equal(ageNorm(2026), 0); assert.equal(ageNorm(1900), 1); assert.equal(ageNorm(1996), 0.5);
  assert.equal(satNorm(0), 0); assert.equal(satNorm(-20), 1); assert.equal(satNorm(4), 0); assert.equal(satNorm(-4), 0.5);
});

test('点数: w=0で台帳のみ、w=1で衛星のみ', () => {
  const s = { cell: 'A3', year: 1966 };
  assert.equal(segScore(s, { A3: 0.2 }, 0), 1);
  assert.equal(segScore(s, { A3: 0.2 }, 1), 0.2);
  const m = segScore(s, { A3: 0.5 }, 0.5); assert.equal(m, 0.75);
});

test('竣工年が不明(null)の古さは中立の0.5', () => {
  assert.equal(AGE_UNKNOWN, 0.5);
  assert.equal(ageNorm(null), 0.5); assert.equal(ageNorm(undefined), 0.5);
  assert.equal(segScore({ cell: 'A', year: null }, { A: 0 }, 0), 0.5);
});

test('topShift: 衛星が全区画で同じ値なら台帳のみと順位は変わらない／区画で差があれば入れ替わる', () => {
  const segs = [];
  for (let i = 0; i < 30; i++) segs.push({ id: 'S' + String(i).padStart(2, '0'), cls: 'life', surveyed: false, cell: i < 15 ? 'A' : 'B', year: 1960 + i, lenM: 50 });
  assert.equal(topShift(segs, { A: 0.2, B: 0.2 }, 1, 10), 0);
  assert.ok(topShift(segs, { A: 0, B: 1 }, 1, 10) > 0);
});

test('rank: 同点は竣工年の古い順（不明は後ろ）→区間ID順', () => {
  const segs = [{ id: 'S3', cell: 'A', year: 1960 }, { id: 'S1', cell: 'A', year: 1962 }, { id: 'S2', cell: 'A', year: null }, { id: 'S0', cell: 'A', year: 1960 }];
  assert.deepEqual(rank(segs, { A: 0 }, 1).map((x) => x.id), ['S0', 'S3', 'S1', 'S2']);
  const r = rank(data.segments, cellSat, 0.1).filter((s) => s.cls === 'life');
  const t = r.filter((s) => Math.abs(s.score - r[0].score) < 1e-9);
  for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].year <= t[i].year);
});

test('adoptWeight: 当てずっぽうに近い・差が小さい結果では重みを変えない／明確な差なら更新', () => {
  assert.ok(MIN_AUC >= 0.5 && MIN_GAIN > 0);
  const cs = { A: 0, B: 1 };
  const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ cell: i % 2 ? 'B' : 'A', year: 1970 + (i % 7), hit: f(i) }));
  const strong = mk(40, (i) => i % 2 === 1); // 衛星（B）がよく当たる
  const cal = calibrate(strong, cs);
  const a = adoptWeight(cal, strong, cs, 0);
  assert.equal(a.adopt, true); assert.equal(a.w, cal.w); assert.ok(a.best >= MIN_AUC);
  const rnd = mk(40, (i) => i % 4 < 2); // 衛星とは無関係
  const ar = adoptWeight(calibrate(rnd, cs), rnd, cs, 0.1);
  assert.equal(ar.adopt, false); assert.equal(ar.w, 0.1);
  assert.equal(adoptWeight({ w: null }, [], cs, 0.3).reason, 'short');
  assert.equal(adoptWeight({ w: null }, [], cs, 0.3).w, 0.3);
  void aucAt;
});

test('rank は降順で、同点はidで安定', () => {
  const r = rank(data.segments, cellSat, 0.5);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].score >= r[i].score);
  assert.deepEqual(rank(data.segments, cellSat, 0.5).map((x) => x.id), r.map((x) => x.id));
});

test('selectByBudget: 未調査の生活道路のみ・予算内・上位優先', () => {
  const r = rank(data.segments, cellSat, 0.5);
  const ids = selectByBudget(r, 3);
  const set = new Set(ids);
  assert.ok(ids.length > 0);
  assert.ok(totalKm(data.segments, set) <= 3);
  for (const id of ids) { const s = data.segments.find((x) => x.id === id); assert.equal(s.cls, 'life'); assert.ok(!s.surveyed); }
  assert.equal(selectByBudget(r, 0).length, 0);
  // 最上位の候補は必ず含まれる（1区間は3kmより短い）
  const top = r.find((s) => s.cls === 'life' && !s.surveyed);
  assert.ok(set.has(top.id));
});

test('auc: 完全分離=1、逆=0、同点=0.5、片側なし=null', () => {
  assert.equal(auc([{ hit: true, score: 2 }, { hit: false, score: 1 }]), 1);
  assert.equal(auc([{ hit: true, score: 1 }, { hit: false, score: 2 }]), 0);
  assert.equal(auc([{ hit: true, score: 1 }, { hit: false, score: 1 }]), 0.5);
  assert.equal(auc([{ hit: true, score: 1 }]), null);
});

test('calibrate: 衛星が当たるデータでは衛星の重みが大きくなる／データ不足はnull', () => {
  const cs = { A: 1, B: 0 };
  // 台帳の古さは無関係（同じ年）、区画Aだけ空洞
  const sc = [];
  for (let i = 0; i < 5; i++) { sc.push({ cell: 'A', year: 1990 + i, hit: true }); sc.push({ cell: 'B', year: 1990 + i, hit: false }); }
  const c = calibrate(sc, cs);
  assert.ok(c.w >= 0.5);
  assert.equal(c.satOnly, 1);
  const few = calibrate(sc.slice(0, 4), cs);
  assert.equal(few.w, null); assert.equal(few.reason, 'データ不足');
});

test('calibrate: 台帳が当たるデータでは衛星の重みが小さくなる', () => {
  const cs = { A: 0.5, B: 0.5 };
  const sc = [];
  for (let i = 0; i < 5; i++) { sc.push({ cell: 'A', year: 1962, hit: true }); sc.push({ cell: 'B', year: 2020, hit: false }); }
  assert.ok(calibrate(sc, cs).w <= 0.5);
});

test('exclusionAccuracy: 下位半分の異常なし割合。件数不足はnull', () => {
  const cs = { A: 0 };
  const sc = [];
  for (let i = 0; i < 10; i++) sc.push({ cell: 'A', year: 1970 + i * 4, hit: i < 5 });
  const e = exclusionAccuracy(sc, cs, 0);
  assert.equal(e.n, 5); assert.equal(e.rate, 1);
  assert.equal(exclusionAccuracy(sc.slice(0, 6), cs, 0), null);
});

test('実データ（豊中市北東部）の整合性', () => {
  assert.ok(data.note.includes('実データ') && data.note.includes('含まない'));
  // 実データのファイルに架空の結果（sim_cavity・調査済み）が入っていない
  assert.ok(!JSON.stringify(data).includes('sim_cavity'));
  assert.ok(data.segments.every((s) => !('surveyed' in s) && !('sim_cavity' in s)));
  const sat = data.satellite;
  assert.equal(sat.class_width_mm_yr, 3.75); assert.equal(sat.classes, 16);
  assert.ok(!JSON.stringify(sat).includes('Sentinel'));
  const ids = new Set(data.segments.map((s) => s.id));
  assert.equal(ids.size, data.segments.length);
  const cells = new Map(data.cells.map((c) => [c.id, c]));
  for (const c of data.cells) {
    assert.ok(Number.isInteger(c.k) && c.k >= 0 && c.k < 16);
    assert.ok(Math.abs(c.disp - (-30 + 3.75 * (c.k + 0.5))) < 1e-9);       // 階級の中央値
    assert.ok(Math.abs(c.range[1] - c.range[0] - 3.75) < 1e-9);             // 階級幅
    assert.equal(c.ring.length, 5);
  }
  const [w, s, e, n] = data.area.bbox;
  for (const sg of data.segments) {
    assert.ok(cells.has(sg.cell)); assert.ok(sg.lenM > 0); assert.equal(sg.coords.length, 2);
    assert.ok(['life', 'arterial', 'noledger'].includes(sg.cls));
    for (const [lo, la] of sg.coords) assert.ok(lo > w - 0.002 && lo < e + 0.002 && la > s - 0.002 && la < n + 0.002);
    if (sg.cls === 'life') assert.ok(sg.year === null || (sg.year >= 1900 && sg.year <= 2026));
  }
  assert.ok(data.segments.filter((s) => s.cls === 'life').length > 500);
  // 統計と本体の一致、突き合わせ率の根拠
  const st = data.stats, by = (c) => data.segments.filter((s) => s.cls === c).length;
  assert.equal(st.segments, data.segments.length);
  assert.equal(st.segments_by_cls.life, by('life')); assert.equal(st.segments_by_cls.arterial, by('arterial')); assert.equal(st.segments_by_cls.noledger, by('noledger'));
  const r15 = st.match_rate_by_threshold['15m'];
  assert.ok(r15.matched <= r15.of && Math.abs(r15.rate - r15.matched / r15.of) < 1e-3);
  assert.equal(st.life_year_unknown, data.segments.filter((s) => s.cls === 'life' && s.year === null).length);
  assert.equal(st.cells_with_roads, data.cells.length);
});

test('実データで衛星の点数が効きにくい（階級が少なく同点が多い）', () => {
  const ks = new Set(data.cells.map((c) => c.k));
  assert.ok(ks.size <= 3);
  const r = rank(data.segments, cellSat, 1).filter((s) => s.cls === 'life' && !s.surveyed);
  assert.ok(new Set(r.map((s) => s.score)).size <= ks.size);     // 衛星のみの点数は階級の数だけ
  assert.ok(Math.max(...Object.values(cellSat)) < 0.5);          // どの区画も衛星の点数は小さい
});

// ---- 調査結果 CSV の取り込み（GMS3 の書式は未確認。区間ID と 緯度・経度 の2通りで受ける）
const mid = (s) => [(s.coords[0][0] + s.coords[1][0]) / 2, (s.coords[0][1] + s.coords[1][1]) / 2];
const life = data.segments.filter((s) => s.cls === 'life');

test('parseCsv: 引用符・BOM・CRLF・タブ区切り', () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x,y",2\r\n'), [['a', 'b'], ['x,y', '2']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCavity: あり/なしの表記ゆれ', () => {
  for (const v of ['あり', '1', 'true', 'TRUE', '空洞あり', '疑い', ' 有 ', 'yes']) assert.equal(parseCavity(v), true, v);
  for (const v of ['なし', '0', 'false', '空洞なし', '異常なし', '無', 'no']) assert.equal(parseCavity(v), false, v);
  for (const v of ['', '不明', '？', null]) assert.equal(parseCavity(v), null, String(v));
});

test('parseOutcomes: 区間IDの書き方', () => {
  const [a, b, c] = life;
  const r = parseOutcomes(`segment_id,cavity\n${a.id},あり\n${b.id},なし\n${c.id},1\nXXXX,あり\n${a.id},?\n`, data.segments);
  assert.equal(r.error, null);
  assert.equal(r.results.size, 3);
  assert.equal(r.results.get(a.id), true); assert.equal(r.results.get(b.id), false);
  assert.equal(r.summary.unknownId, 1); assert.equal(r.summary.invalid, 1); assert.equal(r.summary.byId, 3);
});

test('parseOutcomes: 緯度・経度の書き方（近い区間に結び付け、遠い点は使わない）', () => {
  const [a, b] = life;
  const [la, lb] = [mid(a), mid(b)];
  const r = parseOutcomes(`緯度,経度,空洞\n${la[1]},${la[0]},あり\n${lb[1]},${lb[0]},なし\n34.9,135.9,あり\n`, data.segments);
  assert.equal(r.error, null);
  assert.equal(r.summary.byPoint, 2); assert.equal(r.summary.unmatched, 1);
  assert.equal(r.results.get(a.id), true); assert.equal(r.results.get(b.id), false);
});

test('parseOutcomes: 同じ区間の複数行は「1つでもあり」ならあり', () => {
  const a = life[5];
  const r = parseOutcomes(`segment_id,cavity\n${a.id},なし\n${a.id},あり\n`, data.segments);
  assert.equal(r.results.get(a.id), true); assert.equal(r.summary.merged, 1); assert.equal(r.summary.conflicts, 1);
});

test('parseOutcomes: 見出しの誤り・空はエラー', () => {
  assert.ok(parseOutcomes('foo,bar\n1,2\n', data.segments).error);
  assert.ok(parseOutcomes('segment_id,foo\nS0001,1\n', data.segments).error);
  assert.ok(parseOutcomes('segment_id,cavity\n', data.segments).error);
});

test('2つの書き方で、同じ結果なら同じ較正になる', () => {
  const pick = life.filter((_, i) => i % 40 === 0).slice(0, 40);
  const hitOf = (s) => (s.year != null && s.year <= 1975);
  const byId = 'segment_id,cavity\n' + pick.map((s) => `${s.id},${hitOf(s) ? 'あり' : 'なし'}`).join('\n');
  const byPt = 'lat,lon,cavity\n' + pick.map((s) => `${(mid(s)[1] + 0.00002).toFixed(6)},${mid(s)[0].toFixed(6)},${hitOf(s) ? 1 : 0}`).join('\n');
  const r1 = parseOutcomes(byId, data.segments), r2 = parseOutcomes(byPt, data.segments);
  assert.equal(r1.results.size, pick.length); assert.equal(r2.results.size, pick.length);
  assert.deepEqual([...r1.results].sort(), [...r2.results].sort());
  const c1 = calibrate(scannedFrom(data.segments, r1.results), cellSat), c2 = calibrate(scannedFrom(data.segments, r2.results), cellSat);
  assert.deepEqual(c1, c2);
  assert.ok(c1.w !== null);
});

test('距離: 区間の中点は0m、約20m 離れた点は20m前後', () => {
  const s = life[0], [lo, la] = mid(s);
  assert.ok(distToSegM(lo, la, s.coords) < 0.01);
  const d = distToSegM(lo, la + 0.0003, [[lo - 0.01, la], [lo + 0.01, la]]);
  assert.ok(d > 30 && d < 36, String(d));
  assert.equal(nearestSegment(lo, la + 0.5, data.segments), null);
});

test('同梱の書式見本が読める', () => {
  for (const f of ['format_sample_by_segment.csv', 'format_sample_by_point.csv']) {
    const t = fs.readFileSync(new URL('../data/' + f, import.meta.url), 'utf8');
    const r = parseOutcomes(t, data.segments);
    assert.equal(r.error, null, f); assert.ok(r.results.size >= 10, f);
    // 見本だけで較正まで進める（あり・なし各3件以上）。架空の見本であることがファイル内にある
    assert.ok(r.summary.hit >= 3 && r.summary.none >= 3, f);
    assert.ok(t.includes('架空'), f);
  }
});

test('検証データ verify.json の整合性（豊中市の件数）', () => {
  const v = JSON.parse(fs.readFileSync(new URL('../data/verify.json', import.meta.url)));
  assert.equal(v.has_coordinates, false);
  assert.equal(v.national.municipal.total, 8624); assert.equal(v.national.municipal.sewer, 1289);
  assert.equal(v.national.national.total + v.national.prefecture.total + v.national.municipal.total, 9865);
  assert.equal(v.toyonaka.incidents, 50); assert.equal(v.toyonaka.sewer, 38);
  assert.equal(v.towns.reduce((a, t) => a + t.incidents, 0), 50);
  assert.equal(v.tokujuten.all_cavities_listed, 96);
  assert.equal(v.tokujuten.priority.cavities + v.tokujuten.other.cavities, 0);
  assert.equal(v.tokujuten.priority.cavity_survey_km + v.tokujuten.other.cavity_survey_km, 0);
  assert.equal(v.terciles.reduce((a, g) => a + g.sewer_incidents, 0), v.check.incidents_used);
  assert.ok(!JSON.stringify(v).includes('号線'), '路線名を出力に含めない');
});

test('説明用デモの架空データは別ファイルで、既定のデータに混ざらない', () => {
  const d = JSON.parse(fs.readFileSync(new URL('../data/demo_sim.json', import.meta.url)));
  assert.ok(d.note.includes('架空'));
  const ids = new Set(data.segments.map((s) => s.id));
  for (const id of [...d.past, ...d.hit]) assert.ok(ids.has(id));
});
