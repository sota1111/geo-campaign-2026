// 架空の市「サンプル市」の道路網・衛星指標・GMS3結果（シミュレーション）を作る。乱数は固定シード。
// usage: node tools/generate_sample.mjs > data/sample.json
// 実在の道路・下水道・衛星観測・調査結果は一切使っていない。
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = rng(20261111);
const COLS = 12, ROWS = 9, D = 0.0012;           // 度。座標は便宜上の位置（実在地点ではない）
const CW = 4, CH = 3;                              // 1区画 = 4x3 ブロック
const node = [];
for (let j = 0; j <= ROWS; j++) {
  node[j] = [];
  for (let i = 0; i <= COLS; i++) {
    const edge = i === 0 || j === 0 || i === COLS || j === ROWS;
    node[j][i] = [(i + (edge ? 0 : (R() - .5) * .25)) * D, (j + (edge ? 0 : (R() - .5) * .25)) * D];
  }
}
// 区画の衛星指標: 地表変位 mm/年（負=沈下）。ホットスポット2か所＋ばらつき（すべて架空）。
const cells = [];
for (let cy = 0; cy < ROWS / CH; cy++) for (let cx = 0; cx < COLS / CW; cx++) {
  const hot = Math.exp(-(((cx - 2) ** 2 + (cy - 0) ** 2) / 0.8)) * 6 + Math.exp(-(((cx - 0) ** 2 + (cy - 2) ** 2) / 0.6)) * 3.5;
  const disp = -(0.8 + hot + R() * 1.2);
  cells.push({ id: `${String.fromCharCode(65 + cy)}${cx + 1}`, cx, cy, disp: Math.round(disp * 10) / 10 });
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const segs = []; let n = 0;
const dist = (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 110540); // 赤道付近の近似
function add(a, b, arterial, mi, mj) {
  const cx = Math.min(Math.floor(mi / CW), COLS / CW - 1), cy = Math.min(Math.floor(mj / CH), ROWS / CH - 1);
  const cell = cells.find((c) => c.cx === cx && c.cy === cy);
  const year = Math.round(1962 + R() * 46 - (cell.cx === 0 ? 8 : 0));
  const age = clamp01((2026 - year) / 60);
  // 画面で「GMS3走査の結果」として見せるための乱数シミュレーション。台帳の古さ＋区画の沈下＋区間ごとの局所差。
  // 衛星指標は区画単位で、区間ごとの局所差は知らない（不完全）。
  const local = R();
  const p = 0.45 * (0.02 + 0.28 * age * age + 0.30 * clamp01(-cell.disp / 8) * (0.4 + 0.9 * local) + 0.06 * local);
  const surveyed = arterial || R() < 0.06;
  segs.push({ id: `S${String(++n).padStart(3, '0')}`, cls: arterial ? 'arterial' : 'life', cell: cell.id, year,
    lenM: Math.round(dist(a, b)), surveyed, sim_cavity: R() < p, coords: [a, b] });
}
for (let j = 0; j <= ROWS; j++) for (let i = 0; i < COLS; i++) add(node[j][i], node[j][i + 1], j % 3 === 0, i, Math.min(j, ROWS - 1));
for (let i = 0; i <= COLS; i++) for (let j = 0; j < ROWS; j++) add(node[j][i], node[j + 1][i], i % 4 === 0, Math.min(i, COLS - 1), j);
const ring = (c) => [node[c.cy * CH][c.cx * CW], node[c.cy * CH][(c.cx + 1) * CW], node[(c.cy + 1) * CH][(c.cx + 1) * CW], node[(c.cy + 1) * CH][c.cx * CW], node[c.cy * CH][c.cx * CW]];
console.log(JSON.stringify({
  note: 'サンプル（架空）データ。実在の道路・下水道台帳・衛星観測・地中レーダ結果ではない。sim_cavity は画面上で「GMS3走査の結果」を見せるための乱数シミュレーション。',
  generator: 'tools/generate_sample.mjs（seed 20261111）',
  cells: cells.map((c) => ({ ...c, ring: ring(c) })),
  segments: segs
}));
