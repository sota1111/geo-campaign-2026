/* 同じ土地、四つの値段: 画面の純ロジック（DOM・通信に触れない。node のテストからも使う）。
 * データは tools/fetch.mjs が作る web/data/fukuoka.json（version 2。標準地ごとにまとめた parcels）の形式。 */
(function (root) {
  'use strict';

  // ---- 利用規約が求める表示（https://www.reinfolib.mlit.go.jp/help/termsOfUse/ の文言。変えない） ----
  const URL_LIB = 'https://www.reinfolib.mlit.go.jp/';
  /** API利用規約 第7条のクレジット */
  const CREDIT = 'このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません';
  /** PDL1.0 の出典記載例どおり */
  const ATTRIBUTION = '出典：国土交通省　不動産情報ライブラリ（' + URL_LIB + '）';
  /** 編集・加工した旨（利用したコンテンツの名称と加工の内容） */
  const PROCESSED = '「地価公示・地価調査（鑑定評価書情報、地価公示のポイント）」（国土交通省）をもとに作成者が項目の抽出・標準地ごとのとりまとめ・位置による突き合わせ・距離順の並べ替えをして作成';
  /** API利用規約 第8条(1) */
  const RESPONSIBILITY = 'このアプリは作成者が開発・運営し、表示内容の責任は作成者が負います（国が作成・監修したものではありません）。表示は参考情報で、判断は利用者が行ってください（重要事項説明などの手続きには使えません）';
  /** 画面の主表示と必ず併記する文 */
  const NOTICE = '標準地の価格であり、あなたの土地の価格ではありません';

  /** 公示価格の出典（XPT002 の当年価格だけを出す） */
  const KOJI_SOURCE = '地価公示（不動産情報ライブラリ XPT002 の当年価格）';
  const KOJI_MISSING = '照合できませんでした';
  const KOJI_MISSING_NOTE = '地価公示のデータ（XPT002）と、位置で突き合わせできませんでした';
  /** 鑑定評価書の記録が2件ある旨。API の2件がこの制度の2人分に当たるとは断定しない */
  const RECORDS_NOTE = '地価公示では、1つの標準地を2人の鑑定評価員が評価する制度です（国土交通省）。';
  const NODATA = 'データなし';
  /** 値の無い価格の理由の文（原因は断定しない: 国のデータに値が無いことだけを言う） */
  const MISSING_NOTE = '国のデータにこの標準地の値の記載がありません';

  /** 4つの価格。説明は一般的な定義だけ（数値・水準の関係は書かない）。kind: koji=1つの値／records=鑑定評価書の記録ごとの値 */
  const PRICES = [
    { key: 'koji', kind: 'koji', label: '公示価格', note: '地価公示の標準地の1㎡当たりの価格です。1つの標準地に1つで、ここでは不動産情報ライブラリ（XPT002）の当年価格を出しています。' },
    { key: 'rosenka', kind: 'records', label: '相続税路線価', note: '国税庁が相続税・贈与税の計算のために定める、標準地が面する道路（路線）の1㎡当たりの価額です。決める年が公示価格と異なることがあります。' },
    { key: 'hikaku', kind: 'records', label: '取引事例比較法比準価格', note: '鑑定評価員が、条件の近い取引事例の価格から求めた価格（試算価格）です。鑑定評価書の記録ごとに値があります。' },
    { key: 'shueki', kind: 'records', label: '収益価格', note: '鑑定評価員が、その土地から見込まれる収益を還元利回りで現在の価値にして求めた価格（試算価格）です。鑑定評価書の記録ごとに値があります。' },
  ];
  const DEFAULT_COUNT = 5;
  /** これより遠い最寄りの標準地しか無い時は、近くに無い旨を出す（m） */
  const FAR_M = 3000;

  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  const has = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  /** 記録ごとの値の配列から、値のある記録の数と、重複を除いた値（昇順）を返す */
  function distinctValues(arr) {
    const vals = (Array.isArray(arr) ? arr : []).filter(has);
    return { withValue: vals.length, values: [...new Set(vals)].sort((a, b) => a - b) };
  }
  /** 4つの価格が全て値を持つか（公示価格が照合できていて、他の3つは記録のどれかに値がある） */
  function hasAll(p) {
    return has(p.koji && p.koji.price) && ['rosenka', 'hikaku', 'shueki'].every((k) => distinctValues(p[k]).values.length > 0);
  }

  /** 標準地番号を国の形で（XPT002 の標準地番号で確かめた規則: 住宅地「地域名-連番」、商業地「地域名5-連番」）。他の用途は規則が未確認なので null */
  function parcelNo(p) {
    const seq = String(p.id || '').split('-').pop();
    if (!p.area || !seq) return null;
    if (p.use === '住宅地') return p.area + '-' + seq;
    if (p.use === '商業地') return p.area + '5-' + seq;
    return null;
  }
  /** 見出し下の標準地番号の行。公示のデータ（XPT002）の標準地番号があればそれ。無ければ国の形に組み立てたもの（作成者による表記）。組み立てられなければ地域名・用途・連番 */
  function parcelNoLine(p) {
    if (p.koji && p.koji.lotNo) return '標準地番号: ' + p.koji.lotNo;
    const n = parcelNo(p);
    if (n) return '標準地番号（作成者による表記）: ' + n;
    return '標準地番号（作成者による表記）: ' + [p.area, p.use, String(p.id || '').split('-').pop()].filter(Boolean).join(' ');
  }

  /** 地点に近い標準地を距離順（近い順。同じ距離は id 順）で n 地点。uses を渡すと、その用途だけに絞る。complete は4つそろう地点だけ */
  function nearest(parcels, lon, lat, opts) {
    const o = Object.assign({ n: DEFAULT_COUNT, uses: null, complete: false }, opts || {});
    return (parcels || [])
      .filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && (!o.uses || o.uses.includes(p.use)) && (!o.complete || hasAll(p)))
      .map((p) => ({ p, d: haversine(lon, lat, p.lon, p.lat) }))
      .sort((a, b) => a.d - b.d || String(a.p.id).localeCompare(String(b.p.id)))
      .slice(0, o.n)
      .map((e, i) => ({ point: e.p, distance: e.d, parcel: i + 1 }));
  }

  const num = (v) => Math.round(v).toLocaleString('en-US');
  const yen = (v) => (has(v) ? num(v) + '円/㎡' : NODATA);
  /** 還元利回り。0〜1 の値は割合（0.045）とみなして%にする。1以上はそのまま%（4.5）。空は null */
  function rateText(v) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    const pct = v < 1 ? v * 100 : v;
    return (Math.round(pct * 100) / 100) + '%';
  }
  function distText(m) { return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km'; }

  /** 記録ごとの値の表示。値が1つ（または2件とも同じ）なら1つ、違えば「A／B円/㎡」。
   *  extra に記録の数の注記を付ける（記録が2件以上ある標準地だけ） */
  function recordsView(arr) {
    const n = Array.isArray(arr) ? arr.length : 0;
    const { withValue, values } = distinctValues(arr);
    if (!values.length) return { value: null, text: NODATA, note: MISSING_NOTE };
    const text = values.map(num).join('／') + '円/㎡';
    let note = '';
    if (n > 1) {
      if (withValue < n) note = '鑑定評価書の記録' + n + '件のうち' + withValue + '件に値があります';
      else if (values.length > 1) note = '鑑定評価書の記録' + n + '件（値が異なります）';
      else note = '鑑定評価書の記録' + n + '件（同じ値）';
    }
    return { value: values[values.length - 1], text, note };
  }

  /** 標準地1つの4つの価格を、決まった順（公示→路線価→取引事例→収益）で並べる。値の無いものも行は残す。
   *  bar は、値のある価格の最大（記録が複数なら高い方）を 100 とした長さ（%）。値が無ければ 0 */
  function priceRows(p) {
    const rows = PRICES.map((d) => {
      if (d.kind === 'koji') {
        const v = p.koji && has(p.koji.price) ? p.koji.price : null;
        return { key: d.key, label: d.label, note: d.note, value: v, text: v ? yen(v) : KOJI_MISSING, extra: v ? '出典: ' + KOJI_SOURCE : KOJI_MISSING_NOTE };
      }
      const r = recordsView(p[d.key]);
      let extra = r.note;
      if (d.key === 'rosenka' && r.value && p.rosenkaYear) extra = [p.rosenkaYear + '年分', r.note].filter(Boolean).join('。');
      if (d.key === 'shueki' && r.value) {
        const rd = distinctValues(p.rimawari).values.map(rateText).filter(Boolean);
        extra = [rd.length ? '還元利回り ' + rd.join('／') : '還元利回り ' + NODATA, r.note].filter(Boolean).join('。');
      }
      return { key: d.key, label: d.label, note: d.note, value: r.value, text: r.text, extra };
    });
    const max = Math.max(0, ...rows.map((r) => r.value || 0));
    for (const r of rows) r.bar = r.value && max ? Math.round((r.value / max) * 100) : 0;
    return rows;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** 標準地のカード（HTML）。1地点＝1枚。nth は距離順の番号（1〜） */
  function cardHtml(entry, nth) {
    const p = entry.point;
    const place = p.addr || p.lot || p.area || '所在地の記載なし';
    const meta = [p.use, p.zone, p.kenpei ? '建蔽率' + p.kenpei + '%' : '', p.yoseki ? '容積率' + p.yoseki + '%' : ''].filter(Boolean).join('／');
    const prices = priceRows(p);
    const rows = prices.map((r) =>
      '<li class="pr' + (r.value ? '' : ' none') + '" data-key="' + r.key + '">' +
      '<div class="prh"><span class="prl">' + esc(r.label) + '</span><span class="prv">' + esc(r.text) + '</span></div>' +
      '<div class="bar" aria-hidden="true"><i style="width:' + r.bar + '%"></i></div>' +
      (r.extra ? '<div class="pre">' + esc(r.extra) + '</div>' : '') +
      '</li>').join('');
    const miss = prices.filter((r) => !r.value).length;
    const comp = miss ? '4つのうち ' + miss + ' つはデータなし・照合できず' : '4つの価格がそろっています';
    return '<article class="card" data-id="' + esc(p.id) + '">' +
      '<h3><span class="nth">標準地 ' + (entry.parcel || nth) + '</span> ' + esc(place) + '</h3>' +
      '<p class="pn">' + esc(parcelNoLine(p)) + '</p>' +
      '<p class="cm">指した地点から直線 ' + esc(distText(entry.distance)) + '。' + esc(meta) + '</p>' +
      '<p class="cc' + (miss ? ' part' : '') + '">' + esc(comp) + '</p>' +
      (p.n > 1 ? '<p class="cr">この標準地には鑑定評価書の記録が' + p.n + '件あります。' + esc(RECORDS_NOTE) + '</p>' : '') +
      '<ul class="prices">' + rows + '</ul>' +
      '<p class="cn">' + esc(NOTICE) + '。</p></article>';
  }

  /** 4つの価格の見方（1回だけ出す定義）。HTML */
  function legendHtml() {
    return '<dl class="legend">' + PRICES.map((d) => '<dt>' + esc(d.label) + '</dt><dd>' + esc(d.note) + '</dd>').join('') + '</dl>' +
      '<p class="hint">データには、同じ標準地に鑑定評価書の記録が2件あるものがあります。' + esc(RECORDS_NOTE) + '2件の値が違う項目は「A／B」と並べ、同じ値は1つにしています。</p>' +
      '<p class="hint">各価格の下の棒は、その標準地の4つのうち最も高い価格（2つ並ぶ項目は高い方）を100%とした長さです（標準地どうしの比較には使えません）。</p>';
  }

  /** 結果の見出し文（近くに無い時の注意を含む） */
  function summaryText(entries, opts) {
    if (!entries.length) return '近くの標準地が見つかりませんでした。';
    const far = entries[0].distance > FAR_M;
    return '近い順に ' + entries.length + ' 地点の標準地です' + (opts && opts.complete ? '（4つの価格がそろう標準地だけ）' : '') + '。' +
      (far ? '最も近い標準地でも ' + distText(entries[0].distance) + ' 離れています。この地点の近くには標準地が少ない地域です。' : '');
  }

  /** 読み込み完了の案内。標準地（地点）の数と、鑑定評価書の記録の数を分けて書く */
  function loadedText(d) {
    const records = d.parcels.reduce((s, p) => s + (p.n || 1), 0);
    return '同梱データ: ' + d.pref.name + ' 標準地 ' + d.parcels.length.toLocaleString('en-US') + ' 地点（鑑定評価書の記録 ' + records.toLocaleString('en-US') + ' 件）。';
  }

  /** 読み込んだデータの検証。形が合わなければ null */
  function validate(d) {
    if (!d || d.version !== 2 || !Array.isArray(d.parcels) || !d.parcels.length) return null;
    if (typeof d.fetchedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d.fetchedAt)) return null;
    return d;
  }

  const api = { URL_LIB, CREDIT, ATTRIBUTION, PROCESSED, RESPONSIBILITY, NOTICE, KOJI_SOURCE, KOJI_MISSING, KOJI_MISSING_NOTE, RECORDS_NOTE, PRICES, NODATA, DEFAULT_COUNT, FAR_M, haversine, nearest, yen, rateText, distText, parcelNo, parcelNoLine, distinctValues, recordsView, priceRows, hasAll, MISSING_NOTE, cardHtml, legendHtml, summaryText, loadedText, validate, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Lib = api;
})(typeof window !== 'undefined' ? window : globalThis);
