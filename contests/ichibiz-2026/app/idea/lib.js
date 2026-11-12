/* 地名の記憶マップ: 画面に依存しない処理（ブラウザとnodeの両方で読める） */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CERTAINTY = ['定説', '諸説', '不明'];
  var VISIBILITY = { public: '公開', local: '地域の関係者のみ', private: '非公開' };
  var LICENSES = { 'CC BY 4.0': 'CC BY 4.0（出典を示せば利用可）', 'CC0': 'CC0（制限なし）', none: '利用不可（記録のみ）' };
  var KINDS = ['洪水', '土砂災害', '地震', '津波', '高潮', '火山', 'その他'];

  function toRad(d) { return d * Math.PI / 180; }

  /* 2点間の距離(m)。球面近似（地図上の目安用） */
  function distanceM(lon1, lat1, lon2, lat2) {
    var R = 6371008.8;
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /* 「洪水・土砂災害」のような区切り表記を種別の配列にする */
  function kindsOf(str) {
    var out = [];
    String(str || '').split(/[・,、\/]/).forEach(function (s) {
      s = s.trim();
      if (s && KINDS.indexOf(s) < 0) s = 'その他';
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /* 地点から半径内の伝承碑を近い順に返す */
  function nearby(items, lon, lat, radiusM) {
    return items.map(function (it) {
      return { item: it, dist: distanceM(lon, lat, it.lon, it.lat) };
    }).filter(function (x) { return x.dist <= radiusM; })
      .sort(function (a, b) { return a.dist - b.dist; });
  }

  /*
   * 突き合わせ。語られている災害の種類(claimed)と、近くの伝承碑の種類を比べる。
   * 危険度は判定しない。結果は「手がかりあり／公開データでは見つからず」の2通りで、
   * 後者は「その話が誤り」という意味ではない。
   */
  function crossCheck(claimed, near) {
    var claimedKinds = (claimed || []).slice();
    var hits = [], matchedKinds = [];
    near.forEach(function (n) {
      var ks = kindsOf(n.item.kind);
      var m = ks.filter(function (k) { return claimedKinds.indexOf(k) >= 0; });
      if (m.length) {
        hits.push(n);
        m.forEach(function (k) { if (matchedKinds.indexOf(k) < 0) matchedKinds.push(k); });
      }
    });
    return {
      level: hits.length ? 'clue' : 'none',
      hits: hits,
      matchedKinds: matchedKinds,
      missingKinds: claimedKinds.filter(function (k) { return matchedKinds.indexOf(k) < 0; }),
      nearCount: near.length
    };
  }

  function trim(v) { return String(v == null ? '' : v).trim(); }

  /* 聞き取り記録の検証。errors が空なら ok */
  function validateRecord(input) {
    var errors = [];
    if (!trim(input.placeName)) errors.push('地名を入力してください');
    if (!trim(input.story)) errors.push('聞き取った話の内容を入力してください');
    if (!trim(input.basis)) errors.push('話の出典（誰から・どの資料で）を入力してください');
    if (CERTAINTY.indexOf(input.certainty) < 0) errors.push('確からしさ（定説／諸説／不明）を選んでください');
    if (!VISIBILITY[input.visibility]) errors.push('公開範囲を選んでください');
    if (!LICENSES[input.license]) errors.push('利用条件を選んでください');
    var lon = Number(input.lon), lat = Number(input.lat);
    if (!isFinite(lon) || !isFinite(lat) || input.lon === '' || input.lat === '' || input.lon == null || input.lat == null) {
      errors.push('地図で位置を選んでください');
    } else if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      errors.push('位置が範囲外です');
    }
    return errors;
  }

  var seq = 0;
  /* 記録を作る。新規は必ず「未確認」。確認役の確認は別の操作（verify） */
  function createRecord(input, nowIso) {
    var errors = validateRecord(input);
    if (errors.length) return { ok: false, errors: errors };
    seq += 1;
    var rec = {
      id: 'rec-' + String(nowIso).replace(/\D/g, '').slice(0, 14) + '-' + seq,
      placeName: trim(input.placeName),
      placeType: trim(input.placeType) || '旧地名',
      teller: trim(input.teller) || '（匿名）',
      heardOn: trim(input.heardOn),
      story: trim(input.story),
      basis: trim(input.basis),
      claimedKinds: (input.claimedKinds || []).filter(function (k) { return KINDS.indexOf(k) >= 0; }),
      certainty: input.certainty,
      visibility: input.visibility,
      license: input.license,
      checked: (input.checked || []).slice(),
      lon: Number(input.lon),
      lat: Number(input.lat),
      verified: false,
      verifiedBy: '',
      createdAt: nowIso,
      sample: false
    };
    return { ok: true, record: rec };
  }

  function setVerified(rec, by, nowIso) {
    var c = {};
    Object.keys(rec).forEach(function (k) { c[k] = rec[k]; });
    c.verified = true;
    c.verifiedBy = trim(by) || '（確認役）';
    c.verifiedAt = nowIso;
    return c;
  }

  /* 公開してよい記録: 確認済み・公開・利用条件あり。サンプル（架空）は常に対象外 */
  function isPublishable(rec) {
    return !!rec && rec.verified === true && rec.visibility === 'public' && rec.license !== 'none' && !rec.sample;
  }

  function toGeoJSON(records, opts) {
    opts = opts || {};
    var list = opts.onlyPublishable ? records.filter(isPublishable) : records.filter(function (r) { return r.visibility !== 'private' || opts.includePrivate; });
    return {
      type: 'FeatureCollection',
      name: 'chimei-kioku-map',
      properties: {
        note: '地名の記憶マップ（デモ）の書き出し。サンプル（架空）を含む場合は sample=true。危険度の判定は含まない。',
        exportedAt: opts.exportedAt || null,
        scope: opts.onlyPublishable ? 'publishable' : 'all-except-private'
      },
      features: list.map(function (r) {
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
          properties: {
            id: r.id, placeName: r.placeName, placeType: r.placeType, teller: r.teller, heardOn: r.heardOn,
            story: r.story, basis: r.basis, claimedKinds: r.claimedKinds, certainty: r.certainty,
            visibility: r.visibility, license: r.license, checked: r.checked,
            verified: r.verified, verifiedBy: r.verifiedBy || '', sample: !!r.sample
          }
        };
      })
    };
  }

  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km'; }

  return {
    CERTAINTY: CERTAINTY, VISIBILITY: VISIBILITY, LICENSES: LICENSES, KINDS: KINDS,
    distanceM: distanceM, kindsOf: kindsOf, nearby: nearby, crossCheck: crossCheck,
    validateRecord: validateRecord, createRecord: createRecord, setVerified: setVerified,
    isPublishable: isPublishable, toGeoJSON: toGeoJSON, fmtDist: fmtDist
  };
}));
