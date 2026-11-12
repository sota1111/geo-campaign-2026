/* 相談前の1枚シート: 純粋ロジック（ブラウザ・Node両対応）。DOM・ネットワークには触れない。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Lib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 地理 ----
  function lonLatToWorld(lon, lat, z) {
    const n = Math.pow(2, z);
    const x = ((lon + 180) / 360) * n;
    const s = Math.sin((lat * Math.PI) / 180);
    const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
    return { x, y };
  }
  function worldToLonLat(x, y, z) {
    const n = Math.pow(2, z);
    const lon = (x / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    return { lon, lat };
  }
  // タイル番号とタイル内ピクセル(0-255)
  function tileOf(lon, lat, z) {
    const w = lonLatToWorld(lon, lat, z);
    const tx = Math.floor(w.x), ty = Math.floor(w.y);
    return { z, x: tx, y: ty, px: Math.min(255, Math.floor((w.x - tx) * 256)), py: Math.min(255, Math.floor((w.y - ty) * 256)) };
  }
  function haversine(lon1, lat1, lon2, lat2) {
    const R = 6371008.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function inRing(lon, lat, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function inPolygon(lon, lat, rings) {
    if (!rings.length || !inRing(lon, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (inRing(lon, lat, rings[k])) return false;
    return true;
  }
  function findZone(zones, lon, lat) {
    for (const z of zones) for (const poly of z.polys) if (inPolygon(lon, lat, poly)) return z;
    return null;
  }
  function inBBox(bbox, lon, lat) {
    return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
  }

  // ---- 公共交通 ----
  function nearest(list, lon, lat) {
    let best = null;
    for (const s of list) {
      const d = haversine(lon, lat, s[0], s[1]);
      if (!best || d < best.dist) best = { name: s[2], dist: d, operator: s[3] };
    }
    return best;
  }
  function transitAround(data, lon, lat, radius) {
    const near = new Set();
    for (const s of data.bus) if (haversine(lon, lat, s[0], s[1]) <= radius) near.add(s[2]);
    const bus = nearest(data.bus, lon, lat);
    const rail = nearest(data.rail, lon, lat);
    return { radius, busNames: near.size, bus, rail };
  }

  // ---- ハザードタイルの画素の読み取り ----
  // 洪水浸水想定区域（想定最大規模）の凡例色（重ねるハザードマップの凡例）。色は目安。
  const FLOOD_LEGEND = [
    { rgb: [247, 245, 169], label: '0.5m未満' },
    { rgb: [255, 216, 192], label: '0.5〜3m' },
    { rgb: [255, 183, 183], label: '3〜5m' },
    { rgb: [255, 145, 145], label: '5〜10m' },
    { rgb: [242, 133, 201], label: '10〜20m' },
    { rgb: [220, 122, 220], label: '20m以上' },
  ];
  // rgba: [r,g,b,a]。透明なら区域外。
  function classifyFlood(rgba) {
    if (!rgba || rgba[3] < 40) return { inside: false };
    let best = null;
    for (const l of FLOOD_LEGEND) {
      const d = Math.hypot(rgba[0] - l.rgb[0], rgba[1] - l.rgb[1], rgba[2] - l.rgb[2]);
      if (!best || d < best.d) best = { d, label: l.label };
    }
    return { inside: true, depth: best.d <= 30 ? best.label : null };
  }
  function classifyPresence(rgba) {
    return { inside: !!rgba && rgba[3] >= 40 };
  }
  // 地理院標高タイル(dem_png): 標高[m]。無効値は null
  function demElevation(r, g, b) {
    const x = r * 65536 + g * 256 + b;
    if (x === 8388608) return null;
    return (x < 8388608 ? x : x - 16777216) * 0.01;
  }

  // ---- 1枚シートの組み立て ----
  const SAMPLE_FACTS = {
    sample: true,
    place: 'サンプル（架空）の土地',
    inArea: true,
    zone: null,
    zoneChecked: true,
    noZone: false,
    flood: { status: 'inside', depth: '0.5〜3m' },
    hightide: { status: 'outside' },
    tsunami: { status: 'outside' },
    sediment: { kyukeisha: 'outside', dosekiryu: 'outside', jisuberi: 'outside' },
    elevation: null,
    transit: { radius: 500, busNames: 1, bus: { name: '（架空）〇〇バス停', dist: 620 }, rail: { name: '（架空）△△駅', dist: 4800 } },
    cityPlanningNote: '市街化調整区域（サンプルの前提）',
    調整区域: true,
  };
  const SAMPLE_ANSWERS = { building: 'あり', landUse: '不明', road: '不明', registered: '未' };

  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : Math.round(m / 10) * 10 + 'm'; }

  // facts: 地図とデータから得た事実。answers: 本人が選んだ項目。返り値は出口ごとの{title, items[]}
  function buildSheet(facts, answers) {
    const ans = answers || {};
    const exits = { sell: [], rent: [], use: [], release: [] };
    const missing = []; // データにない項目
    const f = facts;

    // 用途地域・区域区分
    const adjust = f.調整区域 === true;
    if (adjust) {
      exits.sell.push({ basis: 'data', fact: '市街化調整区域にある（サンプルの前提）。', ask: '建てられる建物の条件を市役所の都市計画担当に聞く。買い手の想定を不動産会社に聞く。', who: '市役所・不動産会社' });
      exits.use.push({ basis: 'data', fact: '市街化調整区域にある（サンプルの前提）。', ask: '自分で建てる・使う場合に必要な手続きを市役所に聞く。', who: '市役所' });
    } else if (f.zone) {
      const z = f.zone;
      const far = z.bcr || z.far ? '（データ上の建ぺい率' + (z.bcr || '—') + '%・容積率' + (z.far || '—') + '%）' : '';
      exits.sell.push({ basis: 'data', fact: '用途地域は「' + z.name + '」' + far + '。', ask: 'この用途地域で建てられる建物と、買い手が使える範囲を市役所・不動産会社に聞く。', who: '市役所・不動産会社' });
      exits.use.push({ basis: 'data', fact: '用途地域は「' + z.name + '」。', ask: '自分で建てる・使う場合に建てられる建物の種類を市役所に聞く。', who: '市役所' });
      exits.rent.push({ basis: 'data', fact: '用途地域は「' + z.name + '」。', ask: '貸して使える用途（駐車場・店舗・住宅など）に制限がないかを市役所・不動産会社に聞く。', who: '市役所・不動産会社' });
    } else if (f.inArea) {
      const m = '用途地域の指定がデータにない（市街化調整区域・都市計画区域外・データが古い、のいずれかの可能性）。';
      exits.sell.push({ basis: 'data', fact: m, ask: '区域区分（市街化調整区域か）と建てられる建物の条件を市役所の都市計画担当に聞く。', who: '市役所' });
      exits.use.push({ basis: 'data', fact: m, ask: '建築や利用に必要な手続きの有無を市役所に聞く。', who: '市役所' });
    } else {
      missing.push('用途地域・区域区分（この地図データは徳島市のみ。範囲外のため出せません）');
    }

    // 災害リスク
    const hz = [];
    if (f.flood && f.flood.status === 'inside') hz.push('洪水浸水想定区域（想定最大規模）内' + (f.flood.depth ? '・凡例色の目安は' + f.flood.depth : ''));
    if (f.hightide && f.hightide.status === 'inside') hz.push('高潮浸水想定区域内');
    if (f.tsunami && f.tsunami.status === 'inside') hz.push('津波浸水想定区域内');
    const sed = [];
    if (f.sediment) {
      if (f.sediment.kyukeisha === 'inside') sed.push('急傾斜地崩壊');
      if (f.sediment.dosekiryu === 'inside') sed.push('土石流');
      if (f.sediment.jisuberi === 'inside') sed.push('地すべり');
    }
    if (sed.length) hz.push('土砂災害警戒区域等（' + sed.join('・') + '）内');
    const hazardUnknown = ['flood', 'hightide', 'tsunami'].some((k) => f[k] && f[k].status === 'error');
    if (hz.length) {
      const t = hz.join('、') + '。';
      exits.rent.push({ basis: 'data', fact: t, ask: '借り手に何を説明すべきかを不動産会社に確かめる。', who: '不動産会社' });
      exits.sell.push({ basis: 'data', fact: t, ask: '買い手への説明事項と、売り出し前に確認すべき点を不動産会社に聞く。', who: '不動産会社' });
      exits.use.push({ basis: 'data', fact: t, ask: '自分で使う・建てる場合の備えと、自治体のハザードマップ上の避難先を市役所の防災担当に聞く。', who: '市役所' });
    } else if (!hazardUnknown && f.flood && f.flood.status === 'outside') {
      exits.rent.push({ basis: 'data', fact: '洪水・高潮・津波・土砂災害の想定区域には、この地点では該当しなかった（国の公開タイルによる）。', ask: '想定区域外でも、自治体のハザードマップで過去の浸水や内水の記録がないかを市役所に聞く。', who: '市役所' });
    }
    if (hazardUnknown) missing.push('災害リスク（通信できず取得できませんでした。ハザードマップポータルで確認）');
    if (f.elevation != null) {
      exits.use.push({ basis: 'data', fact: '地理院の標高タイルで約' + f.elevation.toFixed(1) + 'm（誤差あり。測量ではない）。', ask: '浸水や排水が心配な場合、敷地の高さを現地で確かめる方法を専門家に聞く。', who: '土地家屋調査士・建築士' });
    }

    // 公共交通
    if (f.transit) {
      const t = f.transit;
      const parts = [];
      if (t.bus) parts.push('最寄りのバス停「' + t.bus.name + '」まで直線約' + fmtDist(t.bus.dist) + '（半径' + t.radius + 'm内に' + t.busNames + '停留所名）');
      if (t.rail) parts.push('最寄り駅「' + t.rail.name + '」まで直線約' + fmtDist(t.rail.dist));
      if (parts.length) {
        const far = t.bus && t.bus.dist > t.radius;
        exits.rent.push({ basis: 'data', fact: parts.join('。') + '。便数・運行日は含まない。', ask: far ? '歩いて使える停留所が近くにない場合、借り手の足をどう想定するかを不動産会社に聞く。' : '借り手の通勤・通学の足として十分かを不動産会社に聞く。', who: '不動産会社' });
        exits.sell.push({ basis: 'data', fact: parts.join('。') + '。便数・運行日は含まない。', ask: '買い手が車なしで暮らせる場所かを不動産会社に聞く。', who: '不動産会社' });
      }
    }

    // 本人の回答
    if (ans.building === 'あり') {
      exits.release.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。建物がある土地は、相続土地国庫帰属制度の申請ができない。', ask: '解体の要否と費用の見通しを、司法書士・法務局に聞く。', who: '司法書士・法務局' });
      exits.sell.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。', ask: '建物付きで売るか更地にして売るかを不動産会社に聞く。', who: '不動産会社' });
      exits.rent.push({ basis: 'answer', fact: '土地に建物がある（あなたの回答）。', ask: '貸す前に必要な修繕・安全面の確認を不動産会社に聞く。', who: '不動産会社' });
    } else if (ans.building === 'なし') {
      exits.release.push({ basis: 'answer', fact: '建物はない（あなたの回答）。', ask: '国庫帰属の申請の条件（境界・担保権など、建物以外の却下事由）と負担金を法務局に聞く。', who: '法務局' });
    } else {
      exits.release.push({ basis: 'answer', fact: '建物の有無が未確認。', ask: '建物の有無と、国庫帰属が申請できる土地かどうかを法務局に聞く。', who: '法務局' });
    }
    if (ans.landUse === '農地') {
      exits.sell.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地の売却・貸し出しに必要な手続きを農業委員会に聞く。', who: '農業委員会' });
      exits.rent.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地を貸す場合の手続きを農業委員会に聞く。', who: '農業委員会' });
      exits.use.push({ basis: 'answer', fact: '地目が農地（あなたの回答）。', ask: '農地以外の使い方にする場合の手続きを農業委員会に聞く。', who: '農業委員会' });
    }
    if (ans.road === 'なし') {
      exits.sell.push({ basis: 'answer', fact: '道路に接していない・不明確（あなたの回答）。', ask: '建築できる土地か、売却に影響するかを不動産会社・市役所に聞く。', who: '不動産会社・市役所' });
      exits.use.push({ basis: 'answer', fact: '道路に接していない・不明確（あなたの回答）。', ask: '建築できる条件を市役所の建築指導担当に聞く。', who: '市役所' });
    }
    if (ans.registered === '未') {
      exits.sell.push({ basis: 'answer', fact: '相続登記が済んでいない（あなたの回答）。', ask: '売る・貸す・手放すの前に必要な相続登記の進め方を司法書士に聞く。', who: '司法書士' });
      exits.release.push({ basis: 'answer', fact: '相続登記が済んでいない（あなたの回答）。', ask: '国庫帰属の申請の前に必要な登記を司法書士に聞く。', who: '司法書士' });
    }

    // データにない項目（常に表示）
    missing.push('接道（道路に接しているか）。登記・現地で確認');
    missing.push('地目（農地か宅地か）。登記事項証明書で確認');
    missing.push('建物の状態（傷み・残置物）。現地で確認');
    missing.push('境界が確定しているか。測量・登記で確認');

    const empty = (arr, text) => (arr.length ? arr : [{ basis: 'none', fact: text, ask: '相談先に、この出口で確認すべき点を聞く。', who: '相談先' }]);
    return {
      title: f.sample ? 'サンプル（架空）の土地の1枚シート' : '相談前の1枚シート',
      place: f.place,
      sample: !!f.sample,
      exits: [
        { key: 'sell', label: '売る', items: empty(exits.sell, 'この地点の用途地域データがない。') },
        { key: 'rent', label: '貸す', items: empty(exits.rent, 'この地点の災害・交通データがない。') },
        { key: 'use', label: '活かす', items: empty(exits.use, 'この地点の用途地域データがない。') },
        { key: 'release', label: '手放す', items: exits.release },
      ],
      missing,
      reinfolibItems: [
        '周辺の取引価格の傾向（地区単位）',
        '近くの地価公示・地価調査の標準地',
        '将来推計人口（250mメッシュ）',
        '医療機関・小学校区',
      ],
    };
  }

  return { lonLatToWorld, worldToLonLat, tileOf, haversine, inPolygon, findZone, inBBox, nearest, transitAround, classifyFlood, classifyPresence, demElevation, FLOOD_LEGEND, buildSheet, SAMPLE_FACTS, SAMPLE_ANSWERS, fmtDist };
});
