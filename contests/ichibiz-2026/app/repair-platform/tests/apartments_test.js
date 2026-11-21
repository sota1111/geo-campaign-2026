// 実在のマンション（OSM との突き合わせ・写真）のテスト。実行: node --test tests/apartments_test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../web/lib.js');

const web = path.join(__dirname, '../web');
const read = (f) => JSON.parse(fs.readFileSync(path.join(web, 'data', f), 'utf8'));
const B = read('buildings.json');
const OSM = read('osm.json');
const PHOTOS = read('photos.json');
const bById = new Map(B.buildings.map((b) => [b.id, b]));
const appSrc = fs.readFileSync(path.join(web, 'app.js'), 'utf8');

test('OSM との突き合わせ: 全件が PLATEAU の建物に結び付き、種別は共同住宅系。件数が meta と合う', () => {
  assert.equal(OSM.items.length, OSM.meta.matched);
  assert.equal(OSM.items.filter((x) => x.name).length, OSM.meta.named);
  assert.match(OSM.meta.license, /ODbL/);
  const ids = new Set();
  for (const it of OSM.items) {
    assert.ok(bById.has(it.id), it.id);
    assert.ok(!ids.has(it.id), '同じ建物が2回: ' + it.id);
    ids.add(it.id);
    assert.ok(['apartments', 'residential', 'dormitory'].includes(it.btype), it.btype);
    // 名前は OSM にあったものだけ。空文字や補った名前を入れない
    assert.ok(it.name === null || (typeof it.name === 'string' && it.name.trim() === it.name && it.name.length > 0));
  }
  assert.ok(OSM.meta.named >= 50, '名前のある建物が少なすぎる');
});

test('似た建物: bonus は並びだけを変え、候補（階数±2・規模の上限）は変えない', () => {
  const list = [
    { id: 't', h: 30, area: 400, per: 80, town: '甲' },
    { id: 'a', h: 30, area: 410, per: 80, town: '乙' },
    { id: 'b', h: 30, area: 450, per: 80, town: '丙' },
  ].map((b) => L.enrich(b, 3));
  const plain = L.similar(list, list[0], 5, 3).map((x) => x.b.id);
  const bonus = L.similar(list, list[0], 5, 3, (b) => (b.id === 'b' ? 0.5 : 0)).map((x) => x.b.id);
  assert.deepEqual(plain, ['a', 'b']);
  assert.deepEqual(bonus, ['b', 'a']);
});

test('外観写真: 商用利用できるライセンスで、作者・ライセンス・原典が全件にある（空でも可）', () => {
  for (const p of PHOTOS.items) {
    assert.ok(bById.has(p.id));
    assert.match(p.license, /^(CC BY(-SA)? [0-9.]+|CC0|Public domain)/i);
    assert.ok(p.artist && p.licenseUrl && p.page && p.thumb, p.id);
    assert.match(p.page, /^https:\/\/commons\.wikimedia\.org\//);
  }
});

test('実在の建物のカード: 修繕費・金額・口コミの数値を結び付けるコードがない', () => {
  const i = appSrc.indexOf('function simCard');
  const card = appSrc.slice(i, appSrc.indexOf('function bindPicks'));
  assert.ok(card.includes('未登録（公開データなし）'));
  assert.ok(!/fmtMan|simRange|万円|reviews|simRow|perUnit|estimate/.test(card), 'カードに金額・口コミ・目安の計算が混ざっている');
  assert.ok(!appSrc.includes('function simRow'), '旧い試算の列が残っている');
  assert.ok(appSrc.includes('架空のデモ事例（実在の建物ではありません）'));
});

test('空中写真は国土地理院のシームレス空中写真（出典表示つき）。Google 等の写真は使わない', () => {
  assert.ok(appSrc.includes('cyberjapandata.gsi.go.jp/xyz/seamlessphoto/'));
  assert.ok(!/google\.com\/maps|streetview|maps\.googleapis/i.test(appSrc));
  assert.ok(/OpenStreetMap contributors/.test(appSrc) && appSrc.includes('空中写真: 国土地理院'));
});
