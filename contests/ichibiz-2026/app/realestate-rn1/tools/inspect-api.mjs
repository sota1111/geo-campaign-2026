/* 応答の形（項目名）だけを確認する補助。GETのみ。キーは出力しない。取得結果は保存しない。
 *   node --env-file=<.envのパス> tools/inspect-api.mjs XKT003 13 [経度 緯度 [表示件数]]
 * 引数: API名 ズーム 経度 緯度 表示件数（既定は徳島駅付近）。 */
const key = process.env.REINFOLIB_API_KEY;
console.log('キーの設定:', !!key);
const base = 'https://www.reinfolib.mlit.go.jp/ex-api/external/';
function tile(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  return { x, y };
}
const ep = process.argv[2];
const z = Number(process.argv[3] || 13);
const t = tile(Number(process.argv[4] || 134.5513), Number(process.argv[5] || 34.0745), z);
const url = `${base}${ep}?response_format=geojson&z=${z}&x=${t.x}&y=${t.y}`;
const res = await fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } });
console.log(ep, 'z', z, 'タイル', t, 'HTTP', res.status);
const txt = await res.text();
let j;
try { j = JSON.parse(txt); } catch { console.log('JSONではない応答（先頭200字）:', txt.slice(0, 200)); process.exit(0); }
const f = j.features || [];
console.log('features', f.length, '最上位キー', Object.keys(j));
const keys = new Set();
f.forEach((x) => Object.keys(x.properties || {}).forEach((k) => keys.add(k)));
console.log('項目名', [...keys].join(','));
console.log('形状', [...new Set(f.map((x) => x.geometry?.type))].join(','));
console.log(JSON.stringify(f[0]?.properties), JSON.stringify(f[0]?.geometry)?.slice(0, 200));
const n = Number(process.argv[6] || 0);
for (const x of f.slice(0, n)) console.log(JSON.stringify(x.properties));
// 第7引数: 値の度数を数える項目名（カンマ区切り）。例: SHICODE,P14_002
for (const p of (process.argv[7] ?? '').split(',').filter(Boolean)) {
  const c = {};
  for (const x of f) { const v = x.properties?.[p]; c[v] = (c[v] || 0) + 1; }
  console.log(`度数 ${p}:`, JSON.stringify(c).slice(0, 700));
}
