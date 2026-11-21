/* 東京23区の区の境界を web/data/wards.json に書く前処理（通信しない）。
 * 入力: 国土数値情報 行政区域データ（N03）東京都 2025年版の GeoJSON（国土交通省。https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2025.html）。
 *   node tools/build-boundaries.mjs <N03-20250101_13.geojson> [出力先]
 * 区コード 13101〜13123（N03_007）だけを取り、外周だけを単純化（許容 約12m）して座標を小数5桁に丸める。
 * 画面で塗る・押す・区名を出すための簡略図で、測量や権利の根拠ではない。 */
import fs from 'node:fs';
import path from 'node:path';

const TOL = 0.00012;
const MIN_RING_AREA = 2e-8; // 度²。これ未満の小さな島は落とす

export function simplify(pts, tol) {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let dmax = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
export const ringArea = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
const round = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

if (process.argv[1] === import.meta.filename) {
  const [src, outArg] = process.argv.slice(2);
  if (!src) { console.error('使い方: node tools/build-boundaries.mjs <N03 GeoJSON> [出力先]'); process.exit(2); }
  const out = path.resolve(outArg ?? path.join(import.meta.dirname, '../web/data/wards.json'));
  const gj = JSON.parse(fs.readFileSync(src, 'utf8'));
  const wards = new Map();
  for (const f of gj.features) {
    const code = f.properties.N03_007;
    if (!/^131(0[1-9]|1\d|2[0-3])$/.test(code)) continue;
    const w = wards.get(code) ?? { code, name: f.properties.N03_004, polys: [] };
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const outer = poly[0];
      if (ringArea(outer) < MIN_RING_AREA) continue;
      const s = simplify(outer, TOL).map(round);
      if (s.length >= 4) w.polys.push(s);
    }
    wards.set(code, w);
  }
  const list = [...wards.values()].sort((a, b) => a.code.localeCompare(b.code));
  if (list.length !== 23) { console.error(`23区になりません: ${list.length}`); process.exit(1); }
  const data = {
    source: '国土数値情報 行政区域データ（N03）2025年1月1日時点 東京都（国土交通省）を加工して作成',
    note: '外周のみ・約12m で単純化。区の塗り分けと選択のための簡略図',
    wards: list.map((w) => ({ code: w.code, name: w.name, polys: w.polys })),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`書き出しました: ${out}（${list.length}区、${(fs.statSync(out).size / 1024).toFixed(0)}KB、多角形 ${list.reduce((n, w) => n + w.polys.length, 0)}）`);
}
