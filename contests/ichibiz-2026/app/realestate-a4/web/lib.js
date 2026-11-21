/* 同じ土地、四つの値段: 画面の純ロジック（DOM・通信に触れない。node のテストからも使う）。
 * データは tools/fetch.mjs が作る web/data/fukuoka.json の形式。 */
(function (root) {
  'use strict';

  // ---- 利用規約が求める表示（https://www.reinfolib.mlit.go.jp/help/termsOfUse/ の文言。変えない） ----
  const URL_LIB = 'https://www.reinfolib.mlit.go.jp/';
  /** API利用規約 第7条のクレジット */
  const CREDIT = 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません';
  /** PDL1.0 の出典記載例どおり */
  const ATTRIBUTION = '出典：国土交通省　不動産情報ライブラリ（' + URL_LIB + '）';
  /** 編集・加工した旨（利用したコンテンツの名称と加工の内容） */
  const PROCESSED = '「地価公示・地価調査（鑑定評価書情報）」（国土交通省）をもとに作成者が項目の抽出・距離順の並べ替えをして作成';
  /** API利用規約 第8条(1) */
  const RESPONSIBILITY = 'このアプリは作成者が開発・運営し、表示内容の責任は作成者が負います（国が作成・監修したものではありません）。表示は参考情報で、判断は利用者が行ってください（重要事項説明などの手続きには使えません）';
  /** 画面の主表示と必ず併記する文 */
  const NOTICE = '標準地の価格であり、あなたの土地の価格ではありません';

  /** 4つの価格。説明は一般的な定義だけ（数値・水準の関係は書かない） */
  const PRICES = [
    { key: 'price', label: '公示価格', note: '地価公示（国土交通省）が示す、標準地の1㎡当たりの価格です。' },
    { key: 'rosenka', label: '相続税路線価', note: '国税庁が相続税・贈与税の計算のために定める、標準地が面する道路（路線）の1㎡当たりの価額です。決める年が公示価格と異なることがあります。' },
    { key: 'hikaku', label: '取引事例比較法比準価格', note: '鑑定評価で、条件の近い取引事例の価格から求めた価格です。' },
    { key: 'shueki', label: '収益価格', note: '鑑定評価で、その土地から見込まれる収益を、還元利回りで現在の価値にした価格です。' },
  ];
  const NODATA = 'データなし';
  const DEFAULT_COUNT = 5;
  /** これより遠い最寄りの標準地しか無い時は、近くに無い旨を出す（m） */
  const FAR_M = 3000;

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** 地点に近い標準地を距離順（近い順。同じ距離は id 順）で n 件。uses を渡すと、その用途だけに絞る */
  function nearest(points, lon, lat, opts) {
    const o = Object.assign({ n: DEFAULT_COUNT, uses: null }, opts || {});
    return (points || [])
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && (!o.uses || o.uses.includes(p.use)))
      .map((p) => ({ p, d: haversine(lon, lat, p.lon, p.lat) }))
      .sort((a, b) => a.d - b.d || String(a.p.id).localeCompare(String(b.p.id)))
      .slice(0, o.n)
      .map((e) => ({ point: e.p, distance: e.d }));
  }

  const yen = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v).toLocaleString('en-US') + '円/㎡' : NODATA);
  /** 還元利回り。0〜1 の値は割合（0.045）とみなして%にする。1以上はそのまま%（4.5）。空は null */
  function rateText(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    const pct = v < 1 ? v * 100 : v;
    return (Math.round(pct * 100) / 100) + '%';
  }
  function distText(m) { return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km'; }

  /** 標準地1件の4つの価格を、決まった順（公示→路線価→取引事例→収益）で並べる。値の無いものも行は残す（空は「データなし」）。
   *  bar は、その標準地で値のある価格の最大を 100 とした長さ（%）。値が無ければ 0 */
  function priceRows(p) {
    const vals = PRICES.map((d) => (typeof p[d.key] === 'number' && p[d.key] > 0 ? p[d.key] : null));
    const max = Math.max(0, ...vals.filter((v) => v !== null));
    return PRICES.map((d, i) => {
      const v = vals[i];
      const row = { key: d.key, label: d.label, note: d.note, value: v, text: yen(v), bar: v && max ? Math.round((v / max) * 100) : 0, extra: '' };
      if (d.key === 'rosenka' && v && p.rosenkaYear) row.extra = p.rosenkaYear + '年分';
      if (d.key === 'shueki') { const r = rateText(p.rimawari); row.extra = r ? '還元利回り ' + r : (v ? '還元利回り ' + NODATA : ''); }
      return row;
    });
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 標準地のカード（HTML）。nth は距離順の番号（1〜） */
  function cardHtml(entry, nth) {
    const p = entry.point;
    const place = p.addr || p.lot || p.area || '所在地の記載なし';
    const meta = [p.use, p.zone, p.kenpei ? '建蔽率' + p.kenpei + '%' : '', p.yoseki ? '容積率' + p.yoseki + '%' : ''].filter(Boolean).join('／');
    const rows = priceRows(p).map((r) =>
      '<li class="pr' + (r.value ? '' : ' none') + '" data-key="' + r.key + '">' +
      '<div class="prh"><span class="prl">' + esc(r.label) + '</span><span class="prv">' + esc(r.text) + '</span></div>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + r.bar + '%"></i></div>' +
      (r.extra ? '<div class="pre">' + esc(r.extra) + '</div>' : '') +
      '</li>').join('');
    return '<article class="card" data-id="' + esc(p.id) + '">' +
      '<h4><span class="nth">標準地 ' + nth + '</span> ' + esc(place) + '</h4>' +
      '<p class="cm">指した地点から直線 ' + esc(distText(entry.distance)) + '。' + esc(meta) + '</p>' +
      '<ul class="prices">' + rows + '</ul>' +
      '<p class="cn">' + esc(NOTICE) + '。</p></article>';
  }

  /** 4つの価格の見方（1回だけ出す定義）。HTML */
  function legendHtml() {
    return '<dl class="legend">' + PRICES.map((d) => '<dt>' + esc(d.label) + '</dt><dd>' + esc(d.note) + '</dd>').join('') + '</dl>';
  }

  /** 結果の見出し文（近くに無い時の注意を含む） */
  function summaryText(entries) {
    if (!entries.length) return '近くの標準地が見つかりませんでした。';
    const far = entries[0].distance > FAR_M;
    return '近い順に ' + entries.length + ' 件の標準地です。' + (far ? '最も近い標準地でも ' + distText(entries[0].distance) + ' 離れています。この地点の近くには標準地が少ない地域です。' : '');
  }

  /** 読み込んだデータの検証。形が合わなければ null */
  function validate(d) {
    if (!d || !Array.isArray(d.points) || !d.points.length) return null;
    if (typeof d.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d.fetchedAt)) return null;
    return d;
  }

  const api = { URL_LIB, CREDIT, ATTRIBUTION, PROCESSED, RESPONSIBILITY, NOTICE, PRICES, NODATA, DEFAULT_COUNT, FAR_M, haversine, nearest, yen, rateText, distText, priceRows, cardHtml, legendHtml, summaryText, validate, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);
