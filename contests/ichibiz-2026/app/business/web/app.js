/* 見直し案の比較（デモ）: 画面制御。計算は lib.js（Biz）、データは data/（odpt-2026 の生成結果のコピー）。 */
(function () {
  'use strict';
  var B = window.Biz;
  var PLAN_IDS = ['A', 'B', 'C'];
  var S = { index: null, data: null, W: null, day: 'wd', per: 'm', w: 20, plans: [], selPlan: 0, selFac: 0, req: 0, res: null };
  var map = null, mapReady = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function n(x) { return x.toLocaleString('ja-JP'); }
  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function need() { return B.needLevel(S.data.params.thresholds, S.w); }
  function routeName(i) { var r = S.data.routes[i]; return r[0] + (r[1] ? '（' + r[1] + '）' : ''); }
  function routeFull(i) { return routeName(i) + '｜' + S.data.routes[i][2]; }
  function condText() {
    return B.DAY_LABEL[S.day] + B.PERIOD_LABEL[S.per] + S.data.params.start_hours[S.per] + '時発・' + S.w + '分以内';
  }

  function seg(el, options, value, onChange) {
    el.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.textContent = o.label;
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(el.children, function (c) { c.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
        onChange(o.value);
      });
      el.appendChild(b);
    });
  }

  /* ---------- 起動 ---------- */
  function init() {
    getJSON('data/index.json').then(function (idx) {
      S.index = idx;
      $('region').innerHTML = idx.regions.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join('');
      var m = /region=([a-z0-9_-]+)/.exec(location.hash);
      var start = m && idx.regions.some(function (r) { return r.id === m[1]; }) ? m[1] : idx.regions[0].id;
      $('region').value = start;
      $('region').addEventListener('change', function () { loadRegion($('region').value); });
      initMap();
      loadRegion(start);
    }).catch(function (e) {
      $('compare').innerHTML = '<p class="warn">データを読み込めませんでした: ' + esc(e.message) + '（file:// ではなく http で開いてください）</p>';
    });
    $('btn-about').addEventListener('click', openAbout);
    $('modal-close').addEventListener('click', function () { $('modal').hidden = true; });
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) $('modal').hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('modal').hidden = true; });
    $('btn-csv').addEventListener('click', downloadCsv);
  }

  function loadRegion(id) {
    var req = ++S.req;
    S.data = null; S.W = null;
    Promise.all([getJSON('data/' + id + '.json'), getJSON('data/whatif_' + id + '.json')]).then(function (rs) {
      if (req !== S.req) return;
      S.data = rs[0]; S.W = rs[1];
      history.replaceState(null, '', '#region=' + id);
      $('region-note').textContent = S.data.name + '：' + S.data.reason;
      buildControls();
      initPlans();
      renderAll();
      fitMap();
    }).catch(function (e) {
      if (req !== S.req) return;
      $('compare').innerHTML = '<p class="warn">地域データを読み込めませんでした: ' + esc(e.message) + '</p>';
    });
  }

  function buildControls() {
    var d = S.data;
    seg($('ctl-day'), B.DAYS.map(function (k) { return { value: k, label: B.DAY_LABEL[k] }; }), S.day, function (v) { S.day = v; renderAll(); });
    seg($('ctl-period'), B.PERIODS.map(function (k) { return { value: k, label: B.PERIOD_LABEL[k] + d.params.start_hours[k] + '時' }; }), S.per, function (v) { S.per = v; renderAll(); });
    seg($('ctl-w'), d.params.thresholds.map(function (w) { return { value: w, label: w + '分' }; }), S.w, function (v) { S.w = v; renderAll(); });
    seg($('ctl-fac'), d.facility_order.map(function (k, i) { return { value: i, label: d.facility_labels[k] }; }), S.selFac, function (v) { S.selFac = v; renderDistricts(); renderMap(); });
  }

  /* 運行のある路線（基準日に便がある）だけを案に入れられる */
  function selectableRoutes() {
    var out = [];
    S.data.routes.forEach(function (r, i) { if (r[3] + r[4] > 0) out.push(i); });
    return out;
  }
  function singleLost(i, fi) {
    return B.planLoss(S.data.cells, S.W, [i], fi, S.day, S.per, need()).lost;
  }

  function initPlans() {
    S.selPlan = 0; S.selFac = 0;
    function both(i) { return singleLost(i, 0) + singleLost(i, 1); }
    var ranked = selectableRoutes().filter(function (i) { return both(i) > 0; }).sort(function (a, b) { return both(b) - both(a); });
    S.plans = PLAN_IDS.map(function (id, k) {
      return { name: '案' + id, routes: k < 2 && ranked[k] != null ? [ranked[k]] : [] };
    });
  }

  /* ---------- 案の編集 ---------- */
  function renderPlans() {
    var sel = selectableRoutes().sort(function (a, b) {
      return singleLost(b, 0) - singleLost(a, 0) || (routeName(a) < routeName(b) ? -1 : 1);
    });
    var fl0 = S.data.facility_labels[S.data.facility_order[0]];
    var h = '';
    S.plans.forEach(function (p, k) {
      h += '<div class="plan"><div class="pn"><b>' + PLAN_IDS[k] + '</b><input type="text" maxlength="30" value="' + esc(p.name) + '" data-name="' + k + '" aria-label="案' + PLAN_IDS[k] + 'の名前"></div>';
      h += '<div class="chips">' + (p.routes.length ? p.routes.map(function (r) {
        return '<span class="chip">' + esc(routeName(r)) + '<button type="button" data-rm="' + k + ':' + r + '" aria-label="' + esc(routeName(r)) + 'を外す">×</button></span>';
      }).join('') : '<span class="note">止める路線が未選択です（現状と同じ）</span>') + '</div>';
      h += '<select data-add="' + k + '" aria-label="案' + PLAN_IDS[k] + 'に止める路線を追加"><option value="">＋ 止める路線を追加…</option>' +
        sel.filter(function (r) { return p.routes.indexOf(r) < 0; }).map(function (r) {
          var rt = S.data.routes[r];
          return '<option value="' + r + '">' + esc(routeFull(r)) + '｜平日' + rt[3] + '本・休日' + rt[4] + '本｜単独停止で' + esc(fl0) + '−' + n(singleLost(r, 0)) + '人</option>';
        }).join('') + '</select></div>';
    });
    $('plans').innerHTML = h;
    $('plans-note').textContent = '路線は影響が大きい順（現在の条件・' + fl0 + '）。地域を開いたとき、案A・案Bには例として、病院・学校の合計で影響が大きい路線（条件は開いた時点のもの）を仮に入れてあります。選べるのは基準日に便がある' + sel.length + '路線／収録' + S.data.routes.length + '路線（全便の停止のみ。減便は未対応）。';
    Array.prototype.forEach.call($('plans').querySelectorAll('[data-add]'), function (el) {
      el.addEventListener('change', function () {
        if (el.value === '') return;
        S.plans[+el.getAttribute('data-add')].routes.push(+el.value);
        S.selPlan = +el.getAttribute('data-add');
        renderAll();
      });
    });
    Array.prototype.forEach.call($('plans').querySelectorAll('[data-rm]'), function (el) {
      el.addEventListener('click', function () {
        var t = el.getAttribute('data-rm').split(':');
        var p = S.plans[+t[0]];
        p.routes = p.routes.filter(function (r) { return r !== +t[1]; });
        renderAll();
      });
    });
    Array.prototype.forEach.call($('plans').querySelectorAll('[data-name]'), function (el) {
      el.addEventListener('input', function () {
        S.plans[+el.getAttribute('data-name')].name = el.value || ('案' + PLAN_IDS[+el.getAttribute('data-name')]);
        renderCompare(); renderDistricts(); buildPlanSeg();
      });
    });
  }

  /* ---------- 計算 ---------- */
  function compute() {
    var d = S.data, nd = need();
    var nf = d.facility_order.length;
    var res = { base: [], plans: [] };
    for (var fi = 0; fi < nf; fi++) res.base.push(B.baseline(d.cells, fi, S.day, S.per, nd));
    S.plans.forEach(function (p) {
      var per = [];
      for (var fi2 = 0; fi2 < nf; fi2++) {
        var l = B.planLoss(d.cells, S.W, p.routes, fi2, S.day, S.per, nd);
        l.groups = B.groupByNearestStop(d.cells, l.cells, d.nodes);
        per.push(l);
      }
      res.plans.push(per);
    });
    S.res = res;
  }

  function nonEmptyPlans() {
    return S.plans.map(function (p, k) { return k; }).filter(function (k) { return S.plans[k].routes.length > 0; });
  }
  function lostText(l) { return (l.exact ? '' : '少なくとも') + n(l.lost) + '人'; }

  /* ---------- 比較表 ---------- */
  function renderCompare() {
    var d = S.data, ks = nonEmptyPlans();
    if (!ks.length) { $('compare').innerHTML = '<p class="note">手順2で、止める路線を1つ以上選んでください。（この条件では、止めても行けなくなる人が出る路線が無い地域もあります。許容時間を短くすると差が出ます。）</p>'; $('sentences').innerHTML = ''; return; }
    var h = '<table><tr><th class="l">条件: ' + esc(condText()) + '</th><th>現状（変更なし）</th>' +
      ks.map(function (k) { return '<th>' + esc(S.plans[k].name) + '</th>'; }).join('') + '</tr>';
    h += '<tr><th class="l">止める路線</th><td>なし</td>' + ks.map(function (k) {
      return '<td class="l">' + S.plans[k].routes.map(function (r) { return esc(routeName(r)); }).join('<br>') +
        (S.plans[k].routes.length > 1 ? '<br><span class="note">' + S.plans[k].routes.length + '路線</span>' : '') + '</td>';
    }).join('') + '</tr>';
    d.facility_order.forEach(function (fk, fi) {
      var b = S.res.base[fi];
      h += '<tr><th class="l" colspan="' + (2 + ks.length) + '">行き先: ' + esc(d.facility_labels[fk]) + '</th></tr>';
      h += '<tr class="base"><th class="l">いま行ける人（徒歩・公共交通）</th><td>' + n(b.reach) + '人<br><span class="note">うち65歳以上 ' + n(b.reach65) + '人</span></td>' +
        ks.map(function () { return '<td>—</td>'; }).join('') + '</tr>';
      h += '<tr><th class="l">行けなくなる人</th><td>0人</td>' + ks.map(function (k) { var l = S.res.plans[k][fi]; return '<td class="big">' + lostText(l) + '</td>'; }).join('') + '</tr>';
      h += '<tr><th class="l">　うち65歳以上</th><td>0人</td>' + ks.map(function (k) { var l = S.res.plans[k][fi]; return '<td>' + (l.exact ? '' : '少なくとも') + n(l.lost65) + '人</td>'; }).join('') + '</tr>';
      h += '<tr><th class="l">　診断範囲の人口に占める割合</th><td>0%</td>' + ks.map(function (k) { var l = S.res.plans[k][fi]; return '<td>' + (l.exact ? '' : '少なくとも') + B.pct(l.lost, b.pop) + '%</td>'; }).join('') + '</tr>';
      h += '<tr><th class="l">　影響を受ける地区数</th><td>0</td>' + ks.map(function (k) { var l = S.res.plans[k][fi]; return '<td>' + (l.exact ? '' : '少なくとも') + l.groups.length + '</td>'; }).join('') + '</tr>';
    });
    h += '</table><p class="note">診断範囲の人口: ' + n(S.res.base[0].pop) + '人（うち65歳以上 ' + n(S.res.base[0].pop65) + '人、令和2年国勢調査）。「地区」は最寄りの停留所の名前でまとめた500mメッシュの集まり（行政区画ではない）。「少なくとも」は複数路線の案で、事前計算にない同時停止の影響を含まない下限。</p>';
    $('compare').innerHTML = h;

    var sh = '';
    ks.forEach(function (k) {
      var p = S.plans[k];
      var parts = d.facility_order.map(function (fk, fi) {
        var l = S.res.plans[k][fi];
        var top = l.groups[0];
        return esc(d.facility_labels[fk]) + 'へ行けなくなる人は' + lostText(l) + '（うち65歳以上' + (l.exact ? '' : '少なくとも') + n(l.lost65) + '人）' +
          (top ? '、最も多い地区は「' + esc(top.name) + '」付近の' + n(top.lost) + '人' : '');
      });
      sh += '<div class="sent"><b>' + esc(p.name) + '</b>: ' + esc(condText()) + 'で、' + parts.join('。') + '。</div>';
    });
    $('sentences').innerHTML = sh;
  }

  /* ---------- 地区の内訳 ---------- */
  function buildPlanSeg() {
    var ks = nonEmptyPlans();
    if (ks.indexOf(S.selPlan) < 0) S.selPlan = ks.length ? ks[0] : 0;
    seg($('ctl-plan'), ks.map(function (k) { return { value: k, label: S.plans[k].name }; }), S.selPlan, function (v) { S.selPlan = v; renderDistricts(); renderMap(); });
  }

  function renderDistricts() {
    var ks = nonEmptyPlans();
    if (!ks.length) { $('districts').innerHTML = '<p class="note">案がありません。</p>'; return; }
    var l = S.res.plans[S.selPlan][S.selFac];
    var fl = S.data.facility_labels[S.data.facility_order[S.selFac]];
    if (!l.groups.length) { $('districts').innerHTML = '<p class="note">この条件では、' + esc(S.plans[S.selPlan].name) + 'で' + esc(fl) + 'へ行けなくなる人はいません（他の路線で代替できる、歩いて行ける、または元から到達できない地区です）。</p>'; return; }
    var h = '<table><tr><th class="l">地区（最寄り停留所）</th><th>行けなくなる人</th><th>うち65歳以上</th><th>メッシュ数</th><th>停留所まで最大(m)</th></tr>';
    l.groups.slice(0, 15).forEach(function (g) {
      h += '<tr><td class="l">' + esc(g.name) + '</td><td>' + n(g.lost) + '</td><td>' + n(g.lost65) + '</td><td>' + g.meshes + '</td><td>' + n(g.maxDist) + '</td></tr>';
    });
    h += '</table><p class="note">' + esc(S.plans[S.selPlan].name) + '・' + esc(fl) + '・' + esc(condText()) + '。上位15地区を表示（全' + l.groups.length + '地区はCSVに収録）。' + (l.exact ? '' : '複数路線の案のため下限。') + '「最寄り停留所」は収録した停留所のうちメッシュ中心に直線で最も近いもの（その停留所が止まる路線のものとは限りません）。</p>';
    $('districts').innerHTML = h;
  }

  /* ---------- 地図 ---------- */
  function initMap() {
    if (typeof maplibregl === 'undefined') { $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした。表と書き出しは使えます。</p>'; return; }
    map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: [137.2, 36.7], zoom: 9, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      var empty = { type: 'FeatureCollection', features: [] };
      ['cells', 'routes', 'plan'].forEach(function (s) { map.addSource(s, { type: 'geojson', data: empty }); });
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: { 'fill-color': '#CC79A7', 'fill-opacity': ['interpolate', ['linear'], ['get', 'pop'], 0, 0.35, 50, 0.55, 300, 0.8], 'fill-outline-color': 'rgba(120,40,90,.6)' } });
      map.addLayer({ id: 'routes', type: 'line', source: 'routes', paint: { 'line-color': '#444', 'line-width': 0.7, 'line-opacity': 0.4 } });
      map.addLayer({ id: 'plan', type: 'line', source: 'plan', paint: { 'line-color': '#B03A8C', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } });
      mapReady = true;
      renderMap(); fitMap();
    });
  }

  function fitMap() {
    if (!mapReady || !S.data) return;
    var b = S.data.bbox;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 20, duration: 0 });
  }

  function renderMap() {
    if (!mapReady || !S.data || !S.res) return;
    var d = S.data, ks = nonEmptyPlans();
    var feats = [], lines = [];
    if (ks.length) {
      var l = S.res.plans[S.selPlan][S.selFac];
      feats = l.cells.map(function (k) {
        var b = B.meshBounds(d.cells[k][0]);
        return { type: 'Feature', properties: { pop: d.cells[k][1] }, geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
      });
      var rs = S.plans[S.selPlan].routes;
      d.patterns.forEach(function (p) {
        if (rs.indexOf(p[0]) >= 0) lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return [d.nodes[i][0], d.nodes[i][1]]; }) } });
      });
    }
    var all = d.patterns.map(function (p) { return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return [d.nodes[i][0], d.nodes[i][1]]; }) } }; });
    map.getSource('cells').setData({ type: 'FeatureCollection', features: feats });
    map.getSource('plan').setData({ type: 'FeatureCollection', features: lines });
    map.getSource('routes').setData({ type: 'FeatureCollection', features: all });
  }

  function renderAll() {
    compute();
    renderPlans();
    renderCompare();
    buildPlanSeg();
    renderDistricts();
    renderMap();
  }

  /* ---------- CSV ---------- */
  function buildCsvRows() {
    var d = S.data, ks = nonEmptyPlans(), rows = [];
    rows.push(['見直し案の比較（デモ出力）']);
    rows.push(['地域', d.name]);
    rows.push(['診断の条件', condText()]);
    rows.push(['診断の基準日（平日/休日）', d.feeds[0].ref.wd + ' / ' + d.feeds[0].ref.hol + '（水曜・日曜。祝日・臨時ダイヤは未反映）']);
    rows.push(['データ生成日', d.built]);
    rows.push(['診断範囲の人口', S.res.base[0].pop, 'うち65歳以上', S.res.base[0].pop65]);
    rows.push([]);
    rows.push(['【比較表】']);
    rows.push(['案', '止める路線', '行き先', '行けなくなる人', 'うち65歳以上', '診断範囲の人口に占める割合(%)', '影響を受ける地区数', '集計の種類']);
    ks.forEach(function (k) {
      d.facility_order.forEach(function (fk, fi) {
        var l = S.res.plans[k][fi];
        rows.push([S.plans[k].name, S.plans[k].routes.map(routeName).join(' / '), d.facility_labels[fk], l.lost, l.lost65,
          B.pct(l.lost, S.res.base[fi].pop), l.groups.length, l.exact ? '単独路線の停止（事前計算どおり）' : '複数路線の案: 少なくともこの人数（下限。同時停止でのみ生じる影響は含まない）']);
      });
    });
    rows.push([]);
    rows.push(['【地区別の内訳】（地区＝最寄り停留所の名前でまとめた500mメッシュ。行政区画ではない）']);
    rows.push(['案', '行き先', '地区（最寄り停留所）', '行けなくなる人', 'うち65歳以上', 'メッシュ数', '停留所まで最大(m)']);
    ks.forEach(function (k) {
      d.facility_order.forEach(function (fk, fi) {
        S.res.plans[k][fi].groups.forEach(function (g) {
          rows.push([S.plans[k].name, d.facility_labels[fk], g.name, g.lost, g.lost65, g.meshes, g.maxDist]);
        });
      });
    });
    rows.push([]);
    rows.push(['【前提と限界】']);
    aboutLimits().forEach(function (t) { rows.push([t]); });
    rows.push([]);
    rows.push(['【出典】']);
    rows.push(['GTFS（事業者名 / データ名 / ライセンス / 更新日 / 取得元）']);
    d.feeds.forEach(function (f) {
      rows.push([f.org, f.name.trim(), f.license + (f.credit ? '（' + f.credit + '）' : ''), f.updated, f.url]);
    });
    sourceLines().forEach(function (t) { rows.push([t]); });
    return rows;
  }

  function downloadCsv() {
    if (!S.data || !S.res) return;
    var text = '﻿' + B.toCsv(buildCsvRows());
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plan-comparison-' + S.data.id + '-' + S.day + S.per + S.w + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- 出典・前提 ---------- */
  function aboutLimits() {
    var p = S.data.params;
    return [
      '本デモは「路線の廃止（その路線の全便を止める）」のみ扱う。減便（本数を減らす）・停留所の移設・乗継の変更・運賃・代替交通・デマンド交通は未対応。',
      '1つの案に複数路線を入れた場合の人数は、単独停止の結果のうち地区の重複を除いた「少なくとも」の下限。同時に止めたときだけ新たに行けなくなる人は含まない。',
      '「行ける」: 指定時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可・乗継3分以上）→徒歩で許容時間内に施設の近くへ着けること。待ち時間込み。徒歩は直線距離の' + p.detour + '倍を分速' + p.walk_m_per_min + 'mで歩く概算（道路網・坂・横断は未考慮）。乗車停留所は直線' + p.walk_in_m + 'm以内、降車停留所から施設は直線' + p.walk_out_m + 'm以内。',
      '歩いて許容時間内に着ける地区は、路線を止めても影響なしとして数える。',
      '診断範囲は収録停留所から' + p.diag_radius_m + 'm以内の500mメッシュ。JR・大手民鉄等の未収録事業者、デマンド交通は評価していない。',
      '行き先は病院・小中学校のみ。施設の診療・受付時間、帰りの便、バリアフリー、遅延・運休は評価していない。',
      '人口は令和2年国勢調査（現在の人口）。65歳以上人口は秘匿処理のため近隣メッシュに合算されている場合がある。将来推計人口は未対応。',
      '時刻表データに基づく計算であり、計画・検討の参考。個別の移動の保証ではない。'
    ];
  }
  function sourceLines() {
    return [
      '人口: 政府統計の総合窓口(e-Stat) 令和2年国勢調査 地域メッシュ統計（250mメッシュを500mに集約）を加工して作成',
      '病院・学校: 国土数値情報 医療機関データ(P04-20, 病院のみ)・学校データ(P29-21, 小学校・中学校)（国土交通省）を加工して作成',
      '鉄道駅（未収録鉄道の位置の目安）: 国土数値情報 鉄道データ N02-22（国土交通省）を加工して作成',
      '背景地図: 地理院タイル（淡色地図）（国土地理院）',
      '計算: 公共交通オープンデータチャレンジ2026向け住民向けプロトタイプ（生活アクセス診断マップ）の事前計算結果を利用'
    ];
  }

  function openAbout() {
    var d = S.data;
    var h = '<h2 id="about-title" style="margin-top:0">出典・ライセンス・前提</h2>';
    h += '<p>本デモは、収録した事業者・地域のデータだけで計算しています。<b>全国を網羅するものではありません</b>。数値はすべて、公開データから時刻表どおりに計算した結果で、実績や将来の利用者数ではありません。</p>';
    if (d) {
      h += '<h2>この地域（' + esc(d.name) + '）のGTFSデータ</h2><div class="scroll"><table><tr><th>事業者</th><th>データ名</th><th>取得元</th><th>ライセンス・クレジット</th><th>更新日</th><th>データ有効期間</th></tr>';
      d.feeds.forEach(function (f) {
        var warn = f.expired ? ' <b class="warn">期限切れ</b>' : (f.ends_before_public_end ? ' <b class="warn">公開期間の途中で終了</b>' : '');
        h += '<tr><td class="l"><a href="' + esc(f.url) + '" target="_blank" rel="noopener">' + esc(f.org) + '</a></td><td class="l">' + esc(f.name) + '</td><td class="l">' +
          (f.source === 'odpt' ? '公共交通オープンデータセンター' : 'GTFSデータリポジトリ') + '</td><td class="l">' +
          (f.license_url ? '<a href="' + esc(f.license_url) + '" target="_blank" rel="noopener">' + esc(f.license) + '</a>' : esc(f.license)) +
          (f.credit ? '<br>クレジット: ' + esc(f.credit) : '') + '</td><td>' + esc(f.updated) + '</td><td>' + esc((f.valid[0] || '?') + '〜' + (f.valid[1] || '?')) + warn + '</td></tr>';
      });
      h += '</table></div><p class="note">各データは事業者がそれぞれのライセンスで公開。本デモでは停留所の集約・本数集計・到達時間の計算・路線除外の再計算という加工を行っています。データ生成日: ' + esc(d.built) + '。</p>';
    }
    h += '<h2>その他のデータ</h2><ul>' + sourceLines().map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '<li>描画: MapLibre GL JS（BSD-3-Clause）</li></ul>';
    if (d) h += '<h2>前提と限界</h2><ul>' + aboutLimits().map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    $('about').innerHTML = h;
    $('modal').hidden = false;
    $('modal-close').focus();
  }

  window.BizApp = { STATE: S, renderAll: renderAll, buildCsvRows: buildCsvRows, getMap: function () { return map; }, mapReady: function () { return mapReady; } };
  init();
})();
