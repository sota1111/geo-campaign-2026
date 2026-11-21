/* XCT001（鑑定評価書情報API）の1件分の応答から、画面に要る項目だけを取り出す純関数。通信・ファイルには触れない。
 * 応答の項目名は日本語（例「鑑定評価手法の適用 取引事例比較法比準価格」）。空白（半角・全角）の揺れを除いて照合する。 */
export const GENERATOR = 'realestate-a4/tools/fetch.mjs';
export const SOURCE = '国土交通省 不動産情報ライブラリ（鑑定評価書情報API XCT001）';

/** 項目名（空白除去後）。公式マニュアル https://www.reinfolib.mlit.go.jp/help/apiManual/xct001/ の項目名による */
export const FIELDS = {
  price: '公示価格',
  priceAlt: '1㎡当たりの価格',
  change: '変動率',
  lat: '位置座標緯度',
  lon: '位置座標経度',
  rosenka: '路線価相続税路線価',
  rosenkaYear: '路線価年',
  hikaku: '鑑定評価手法の適用取引事例比較法比準価格',
  shueki: '鑑定評価手法の適用収益還元法収益価格',
  rimawari: '収益価格算定内訳還元利回り',
  cityCode: '標準地番号市区町村コード市区町村コード',
  areaName: '標準地番号地域名',
  useName: '標準地番号用途区分',
  seq: '標準地番号連番',
  lot: '標準地所在地所在地番',
  addr: '標準地所在地住居表示',
  zone: '標準地法令上の規制等用途地域',
  kenpei: '標準地法令上の規制等指定建ぺい率',
  yoseki: '標準地法令上の規制等指定容積率',
  chiseki: '標準地地積地積',
  genkyo: '標準地土地利用の現況現況',
};
/** 別名（表記ゆれ。実データの項目名は上の FIELDS）。建蔽／建ぺい、位置座標の有無、用途区分のコード有無など */
export const ALIASES = {
  lat: ['緯度'], lon: ['経度'],
  useName: ['標準地番号用途区分コード'],
  kenpei: ['標準地法令上の規制等指定建蔽率'],
};
/** 4つの価格に当たる項目 */
export const PRICE_FIELDS = ['price', 'rosenka', 'hikaku', 'shueki'];

const squash = (s) => String(s).replace(/[\s　]+/g, '');
/** 項目名の空白を除いた索引を作る */
export function indexOf(rec) {
  const m = new Map();
  for (const [k, v] of Object.entries(rec ?? {})) m.set(squash(k), v);
  return m;
}
/** 数字（文字列可）→ 数。空・「-」・0・数でない値は null（APIは値なしを 0 や空で返すため、0 は「値なし」として扱う） */
export function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (s === '' || s === '-' || s === '－' || s === '―') return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
}
const text = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/[\s　]+/g, ' ').trim();
  return s === '-' ? '' : s;
};
const inJapan = (lon, lat) => lon >= 122 && lon <= 154 && lat >= 20 && lat <= 46;

/** 1件を画面用の形にする。位置が取れない、または価格が4つとも無い件は null */
export function extractPoint(rec, fallbackUse = '') {
  const ix = indexOf(rec);
  const g = (f) => {
    for (const name of [FIELDS[f], ...(ALIASES[f] ?? [])]) { const v = ix.get(name); if (v !== undefined) return v; }
    return undefined;
  };
  const lat = num(g('lat')), lon = num(g('lon'));
  if (lat === null || lon === null || !inJapan(lon, lat)) return null;
  const price = num(g('price')) ?? num(g('priceAlt'));
  const p = {
    id: [text(g('cityCode')), text(g('areaName')), text(g('useName')) || fallbackUse, text(g('seq'))].join('-'),
    lon, lat,
    use: text(g('useName')) || fallbackUse,
    area: text(g('areaName')),
    lot: text(g('lot')),
    addr: text(g('addr')),
    price,
    change: num(g('change')),
    rosenka: num(g('rosenka')),
    rosenkaYear: text(g('rosenkaYear')),
    hikaku: num(g('hikaku')),
    shueki: num(g('shueki')),
    rimawari: num(g('rimawari')),
    zone: text(g('zone')),
    kenpei: num(g('kenpei')),
    yoseki: num(g('yoseki')),
    chiseki: num(g('chiseki')),
    genkyo: text(g('genkyo')),
  };
  if (p.price === null && p.rosenka === null && p.hikaku === null && p.shueki === null) return null;
  return p;
}

/** 応答全体（{status, data:[...]} または配列）から件の配列を取り出す */
export function recordsOf(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  return [];
}

/** 取り出した件の集計（取得ログ用）。各項目に値がある件数 */
export function fill(points) {
  const keys = ['price', 'rosenka', 'hikaku', 'shueki', 'rimawari'];
  const out = { total: points.length };
  for (const k of keys) out[k] = points.filter((p) => p[k] !== null).length;
  return out;
}
