/* バス定時性カルテ: 画面制御（MapLibre GL JS）。公開集計（data/*.json）だけを読む静的サイト。 */
(function () {
  'use strict';
  var L = window.TeijiLib;
  var $ = function (id) { return document.getElementById(id); };
  var q = /[?&]data=([a-z0-9-]+)/.exec(location.search);
  var DATA = q ? q[1] : 'data';
  var STATE = { onlySeg: false, index: null, op: null, band: 'all', route: null, map: null, ready: false, popup: null, requested: null };

  function getJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    });
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function init() {
    getJson(DATA + '/index.json').then(function (idx) {
      STATE.index = idx;
      var sel = $('op');
      sel.innerHTML = idx.operators.map(function (o) {
        return '<option value="' + L.esc(o.id) + '">' + L.esc(o.name) + '（' + L.esc(o.status || '蓄積中') + '）' + '</option>';
      }).join('');
      sel.addEventListener('change', function () { STATE.route = null; loadOp(sel.value); });
      $('route').addEventListener('change', function () { selectRoute($('route').value || null); });
      $('only-seg').addEventListener('change', function () { STATE.onlySeg = $('only-seg').checked; if (STATE.op) render(); });
      $('route-detail').addEventListener('click', function (e) {
        var go = e.target.getAttribute && e.target.getAttribute('data-go');
        if (go) { selectRoute(go); return; }
        if (e.target.getAttribute && e.target.getAttribute('data-clear')) selectRoute(null);
      });
      $('band').innerHTML = L.BANDS.map(function (b) {
        return '<button type="button" role="radio" data-band="' + b + '" aria-checked="' + (b === 'all') + '">' + L.esc(L.BAND_LABEL[b]) + '</button>';
      }).join('');
      $('band').addEventListener('click', function (e) {
        var b = e.target.getAttribute && e.target.getAttribute('data-band');
        if (!b) return;
        STATE.band = b;
        Array.prototype.forEach.call($('band').children, function (el) { el.setAttribute('aria-checked', String(el.getAttribute('data-band') === b)); });
        render();
      });
      $('csv-routes').addEventListener('click', function () {
        if (STATE.op) download('teiji_routes_' + STATE.op.id + '_' + STATE.band + '.csv', L.routesCsv(STATE.op, STATE.band));
      });
      $('csv-seg').addEventListener('click', function () {
        if (STATE.op) download('teiji_segments_' + STATE.op.id + '_' + STATE.band + '.csv', L.segmentsCsv(STATE.op, STATE.band));
      });
      initMap();
      var first = idx.operators.filter(function (o) { return o.status === '集計あり'; })[0] || idx.operators.filter(function (o) { return o.stop_estimates > 0; })[0] || idx.operators[0];
      if (first) { sel.value = first.id; loadOp(first.id); }
      else $('period').textContent = '公開できる集計がまだありません。取得と集計（README の手順）を実行してください。';
    }).catch(function (e) {
      $('period').textContent = 'データを読み込めませんでした（' + e.message + '）。ページは `python3 -m http.server` などで配信して開いてください。';
    });
  }

  function loadOp(id) {
    STATE.requested = id;
    STATE.op = null;
    $('period').textContent = '集計を読み込んでいます…';
    $('csv-routes').disabled = $('csv-seg').disabled = true;
    getJson(DATA + '/' + encodeURIComponent(id) + '.json').then(function (op) {
      if (STATE.requested !== id) return;
      STATE.op = op;
      render();
    }).catch(function (e) { if (STATE.requested === id) $('period').textContent = '読み込みに失敗しました。事業者を選び直してください: ' + e.message; });
  }

  function render() {
    var op = STATE.op;
    if (!op) return;
    var band = STATE.band;
    var synth = STATE.index && STATE.index.synthetic ? '<b>【合成データ】実在の事業者・路線・遅れではありません。画面確認用です。</b><br>' : '';
    $('period').innerHTML = synth + '<b>' + L.esc(op.name) + '</b>: ' + L.esc(L.periodText(op)) +
      (op.period.estimated_days && op.period.estimated_days.length < 14 ? '<br>蓄積が短いため、数値は試作段階の参考値です（日数が増えるほど安定します）。' : '');
    var available = STATE.index.operators.filter(function (o) { return o.status === '集計あり'; }).length;
    $('period').innerHTML += '<br>集計を表示できる事業者: ' + available + ' / ' + STATE.index.operators.length + '。最終集計: ' + L.esc(STATE.index.generated) + ' JST。自動収集は未設定です。';
    $('csv-routes').disabled = !op.routes.some(function (r) { return r.band === band; });
    $('csv-seg').disabled = !op.segments.some(function (r) { return r.band === band; });
    document.getElementById('layout').classList.toggle('no-segments', !op.segments.some(function (r) { return r.band === band; }));
    renderRouteSel(op);
    renderQuality(op);
    renderRoutes(op, band);
    renderSegments(op, band);
    renderAbout(op);
    drawMap(op, band);
  }

  function selectRoute(id) {
    STATE.route = id;
    render();
    if (id && $('route-detail').scrollIntoView) $('route-detail').scrollIntoView({ block: window.innerWidth <= 800 ? 'start' : 'nearest' });
  }

  function routeName(op, id) {
    var r = L.routeList(op).filter(function (x) { return x.route_id === id; })[0];
    return r ? r.name : id;
  }

  /* 選択中の路線: 全時間帯の定時率・遅れを固定の並びで出す（時間帯を切り替えても位置が動かない） */
  function renderRouteSel(op) {
    var list = L.routeList(op);
    if (STATE.route != null && !list.some(function (x) { return x.route_id === STATE.route; })) STATE.route = null;
    var sl = L.routeListSorted(op, STATE.onlySeg);
    function opt(r) {
      return '<option value="' + L.esc(r.route_id) + '"' + (r.route_id === STATE.route ? ' selected' : '') + '>' + L.esc(r.name) + (r.seg ? '（区間あり）' : '（区間なし）') + '</option>';
    }
    var withSeg = sl.filter(function (r) { return r.seg; }), noSeg = sl.filter(function (r) { return !r.seg; });
    var selInList = STATE.route == null || sl.some(function (r) { return r.route_id === STATE.route; });
    $('route').innerHTML = '<option value="">全路線（絞り込まない）</option>' +
      (selInList ? '' : '<option value="' + L.esc(STATE.route) + '" selected>' + L.esc(routeName(op, STATE.route)) + '（区間なし・選択中）</option>') +
      '<optgroup label="区間の集計がある路線（' + withSeg.length + '）">' + withSeg.map(opt).join('') + '</optgroup>' +
      (noSeg.length ? '<optgroup label="区間の集計がない路線（' + noSeg.length + '）">' + noSeg.map(opt).join('') + '</optgroup>' : '');
    var box = $('route-detail');
    if (STATE.route == null) {
      var quick = L.suggestSegmentRoutes(op, null, 6);
      box.innerHTML = list.length ? '<p class="note">路線を選ぶと、その路線の時間帯別の定時率・遅れと、遅れが増える区間がここに出ます。区間の集計がある路線は ' + L.routeListSorted(op, true).length + ' / ' + list.length + ' 路線です（選ぶ欄の先頭に「区間あり」で並べています）。</p>' +
        (quick.length ? '<p class="note">区間まで見られる路線（区間の多い順）:</p><div class="alt">' + quick.map(function (r) {
          return '<button type="button" class="act" data-go="' + L.esc(r.route_id) + '">' + L.esc(r.name) + '（区間 ' + r.seg + ' 件）</button>';
        }).join('') + '</div>' : '') : '';
      return;
    }
    var id = STATE.route, p = op.period || {};
    var rows = L.BANDS.map(function (b) {
      var st = L.routeBandStatus(op, id, b), cur = b === STATE.band ? ' class="cur" aria-current="true"' : '';
      var head = '<th scope="row">' + L.esc(L.BAND_LABEL[b]) + (b === STATE.band ? '<span class="tag">表示中</span>' : '') + '</th>';
      if (st.kind === 'missing') {
        return '<tr' + cur + '>' + head + '<td colspan="4" class="miss">この時間帯のデータは取得していません（取得したのは ' + L.esc(p.first || '') + ' 〜 ' + L.esc(p.last || '') + ' の間の一部の時間だけ）。</td></tr>';
      }
      if (st.kind === 'norow') {
        return '<tr' + cur + '>' + head + '<td colspan="4" class="miss">この路線は便が観測されていません（集計なし）</td></tr>';
      }
      var r = st.row;
      return '<tr' + cur + '>' + head + '<td>' + r.n_trips + '</td><td>' + L.esc(L.ontimeLabel(r)) + '</td><td>' + (r.enough ? L.fmtPct(r.late_pct) : '—') +
        '</td><td>' + (r.enough ? L.fmtDelay(r.median_delay_s) : '—') + '</td></tr>';
    }).join('');
    var segs = L.segmentsFor(op, STATE.band, id, 5);
    var nseg = L.segmentsFor(op, STATE.band, id).length;
    var total = L.segmentCounts(op)[id] || 0;
    var segHtml;
    if (nseg) {
      segHtml = '<h4>「' + L.esc(L.BAND_LABEL[STATE.band]) + '」で遅れが増える区間（上位' + segs.length + '件 / 全' + nseg + '件）</h4><ul class="segsum">' + segs.map(function (s) {
        return '<li><b>' + L.esc(s.from) + ' → ' + L.esc(s.to) + '</b>: ' + L.fmtDelay(s.median_added_s) + '（観測 ' + s.n + ' 回）</li>';
      }).join('') + '</ul>' + (nseg > 5 ? '<p class="note">残りは下の「遅れが増える区間」の表にあります。</p>' : '');
    } else if (total) {
      segHtml = '<p class="warn">この路線の区間の集計は「' + L.esc(L.BAND_LABEL[STATE.band]) + '」にはありません（' + (L.bandHasData(op, STATE.band) ? '同じ区間の観測が8回未満' : 'この時間帯のデータは取得していません') + '）。区間の集計がある時間帯: ' +
        L.BANDS.filter(function (b) { return L.segmentsFor(op, b, id).length; }).map(function (b) { return L.esc(L.BAND_LABEL[b]); }).join('、') + '。時間帯を切り替えてください。</p>';
    } else {
      var alt = L.suggestSegmentRoutes(op, id, 4);
      segHtml = '<p class="warn"><b>この路線は区間の集計がありません（同じ区間の観測が8回未満）。</b>' +
        (alt.length ? '区間を見られる路線:' : '') + '</p>' +
        (alt.length ? '<div class="alt">' + alt.map(function (r) {
          return '<button type="button" class="act" data-go="' + L.esc(r.route_id) + '">' + L.esc(r.name) + '（区間 ' + r.seg + ' 件）</button>';
        }).join('') + '</div>' : '');
    }
    var c = L.routeConclusion(op, id), lab = function (b) { return L.esc(L.BAND_LABEL[b]); };
    var cBand = c.worst
      ? '<li><b>遅れやすい時間帯: ' + lab(c.worst.band) + '</b>（定時率 ' + L.fmtPct(c.worst.row.ontime_pct) + '、5分超の遅れ ' + L.fmtPct(c.worst.row.late_pct) + '）' +
        (c.compared < 2 ? '。集計できた時間帯はこの1つだけで、他の時間帯とは比べられません' + (c.missing.length ? '（' + c.missing.map(lab).join('・') + 'は未取得）' : '') : '。集計できた ' + c.compared + ' 時間帯のうち定時率が最も低い') + '。</li>'
      : '<li><b>遅れやすい時間帯: 判断できません</b>（便数が足りる時間帯がありません' + (c.missing.length ? '。' + c.missing.map(lab).join('・') + 'は未取得' : '') + '）。</li>';
    var cSeg = c.topSeg
      ? '<li><b>遅れが最も増える区間: ' + L.esc(c.topSeg.from) + ' → ' + L.esc(c.topSeg.to) + '</b>（' + L.fmtDelay(c.topSeg.median_added_s) + '、' + lab(c.topSeg.band) + '、観測 ' + c.topSeg.n + ' 回）。</li>'
      : '<li><b>遅れが増える区間: この路線は集計がありません</b>（同じ区間の観測が8回未満）。下のボタンから区間のある路線を選べます。</li>';
    box.innerHTML = '<div class="rd"><h3>選択中の路線: ' + L.esc(routeName(op, id)) + (total ? '<span class="segflag">区間あり</span>' : '') + '</h3>' +
      '<div class="concl" role="status"><p class="concl-h">この路線のまとめ（' + L.esc(L.periodText(op)) + 'の参考値）</p><ul>' + cBand + cSeg + '</ul></div>' +
      '<button type="button" class="act clear" data-clear="1">路線の選択を解除（全路線に戻す）</button>' +
      '<div class="tablewrap"><table><caption class="sr">' + L.esc(routeName(op, id)) + ' の時間帯別の定時率と遅れ</caption>' +
      '<thead><tr><th scope="col">時間帯</th><th scope="col">便数</th><th scope="col">定時率</th><th scope="col">遅れ(5分超)</th><th scope="col">遅れ中央値</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      segHtml + '</div>';
  }

  function renderQuality(op) {
    var q = op.quality || {};
    var est = op.estimate || {};
    var h = '<h2>データの状況</h2>' +
      '<ul class="note"><li>1回の取得で見えた車両数: 中央値 ' + L.esc(q.vehicles_median) + ' 台、最大 ' + L.esc(q.vehicles_max) + ' 台</li>' +
      '<li>遅れを推定できた便: ' + L.esc(est.trips_estimated || 0) + ' 便（観測した便 ' + L.esc(est.trips_observed || 0) + '、停留所の推定 ' + L.esc(est.stop_estimates || 0) + ' 件）</li></ul>' +
      (q.verdict ? '<p class="note">日中の取得がまだ足りないため、データの状況は測れていません（' + L.esc(q.verdict) + '）。</p>' : '');
    $('quality').innerHTML = h;
  }

  function renderRoutes(op, band) {
    var cnt = L.segmentCounts(op);
    var rows = op.routes.filter(function (r) { return r.band === band && (!STATE.onlySeg || cnt[r.route_id]); }).sort(function (a, b) { return (!!cnt[b.route_id] - !!cnt[a.route_id]) || L.routeSortKey(a, b); });
    var t = $('routes-table');
    if (!rows.length) {
      t.innerHTML = '<tr><td class="empty">この時間帯のデータは取得していません（取得したのは ' + L.esc(op.period.first || '') + ' 〜 ' + L.esc(op.period.last || '') + ' の間の一部の時間だけ）。サンプル不足とは別で、この時間帯の車両位置の取得が必要です。</td></tr>';
      return;
    }
    t.innerHTML = '<caption class="sr">' + L.esc(op.name) + ' の ' + L.esc(L.BAND_LABEL[band]) + ' の路線別集計</caption>' +
      '<thead><tr><th scope="col">路線</th><th scope="col">便数</th><th scope="col">定時率</th><th scope="col">遅れ(5分超)</th><th scope="col">遅れ中央値</th><th scope="col">団子運転</th><th scope="col">区間</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var bunch = r.bunch_enough ? L.fmtPct(r.bunch_pct) + '<span class="sub">（' + r.bunch_pairs + '組）</span>' : '<span class="sub">対象外・不足</span>';
        var on = r.route_id === STATE.route;
        return '<tr class="pick' + (on ? ' sel' : '') + '" data-rid="' + L.esc(r.route_id) + '"><th scope="row"><button type="button" class="rbtn" aria-pressed="' + on + '" data-rid="' + L.esc(r.route_id) + '">' + L.esc(r.name) + '</button>' + (on ? '<span class="tag">選択中</span>' : '') + '</th><td>' + r.n_trips + '</td><td>' + L.esc(L.ontimeLabel(r)) + '</td>' +
          '<td>' + (r.enough ? L.fmtPct(r.late_pct) : '—') + '</td><td>' + (r.enough ? L.fmtDelay(r.median_delay_s) : '—') + '</td><td>' + bunch + '</td><td>' + (cnt[r.route_id] ? '区間あり（' + cnt[r.route_id] + '件）' : '<span class="sub">なし</span>') + '</td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call(t.querySelectorAll('tr.pick'), function (tr) {
      tr.addEventListener('click', function () {
        var id = tr.getAttribute('data-rid');
        selectRoute(id === STATE.route ? null : id);
      });
    });
  }

  function renderSegments(op, band) {
    var rows = L.segmentsFor(op, band, STATE.route, 15);
    var t = $('seg-table');
    $('seg-h').textContent = STATE.route == null ? '遅れが増える区間（上位）' : '遅れが増える区間（上位）: ' + routeName(op, STATE.route) + ' だけ';
    if (!rows.length) {
      var why = !L.bandHasData(op, band) ? 'この時間帯のデータは取得していません（取得したのは ' + (op.period.first || '') + ' 〜 ' + (op.period.last || '') + ' の間の一部の時間だけ）。'
        : (STATE.route != null ? 'この路線には、この時間帯に表示できる区間がありません（同じ区間を8回以上観測すると表示します）。「全路線」に戻すと他の路線の区間を見られます。'
          : '区間の集計はまだありません（路線×時間帯で10便・50観測以上、同じ区間で8観測以上が必要です）。');
      t.innerHTML = '<tr><td class="empty">' + L.esc(why) + '</td></tr>';
      return;
    }
    t.innerHTML = '<caption class="sr">遅れが増える区間の上位</caption><thead><tr><th scope="col">路線・区間</th><th scope="col">増える遅れ</th><th scope="col">観測</th></tr></thead><tbody>' +
      rows.map(function (s, i) {
        return '<tr class="pick" tabindex="0" data-i="' + i + '"><th scope="row">' + L.esc(s.name) + '<span class="sub">' + L.esc(s.from) + ' → ' + L.esc(s.to) + '</span></th>' +
          '<td>' + L.fmtDelay(s.median_added_s) + '<span class="sub">時刻表の所要 ' + Math.round(s.sched_run_s / 60 * 10) / 10 + '分</span></td><td>' + s.n + '</td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call(t.querySelectorAll('tr.pick'), function (tr) {
      function go() {
        var s = rows[+tr.getAttribute('data-i')];
        if (STATE.map) STATE.map.flyTo({ center: [(s.from_lon + s.to_lon) / 2, (s.from_lat + s.to_lat) / 2], zoom: 15 });
        if (window.scrollTo && window.innerWidth < 800) window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }

  function renderAbout(op) {
    var p = op.params || {};
    $('about-list').innerHTML =
      '<li>静的時刻表の取得日時（JST）: ' + L.esc(op.static_gtfs_acquired || '記録なし') + '。取得後のダイヤ改正は自動追従しません。</li>' +
      '<li>バス位置・時刻表: ' + L.esc(op.credit) + '（<a href="' + L.esc(op.page) + '" target="_blank" rel="noopener">データセットのページ</a>）。公共交通オープンデータセンター（ODPT）が配信する CC BY 4.0 のデータだけを使っています。</li>' +
      '<li>地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li>' +
      '<li>遅れの推定: 車両位置を停留所列の折れ線に当てはめ、停留所の通過時刻を線形補間して時刻表と比べます。道路形状（shapes）は使いません。推定の誤差の大きさは検証中で、実データでの精度は確認できていません。停留所に止まっていた時間は到着ではなく「停留所を出た時刻」で時刻表の発車と比べ、観測の間隔が5分を超える所は推定しません。</li>' +
      '<li>定時: 時刻表より ' + (-(p.early_s || -60)) + '秒早い〜' + (p.late_s || 300) + '秒遅い。団子運転: 時刻表で隣り合う同じ路線・方向の2便の通過間隔が、時刻表の間隔の ' + ((p.bunch_ratio || 0.25) * 100) + '% 未満（時刻表の間隔が1〜20分の停留所だけ対象）。これらの基準は仮の設定です。</li>' +
      '<li>サンプル不足: 便数 ' + (p.min_trips || 10) + ' 未満または観測 ' + (p.min_obs || 50) + ' 未満は数値を出しません。</li>' +
      '<li>事業者名を出した順位付けはしません。事業者は名称順に並べているだけです。便ごとの推定などの詳細は、事業者向けに別ファイル（CSV）で渡します。</li>' +
      '<li>祝日・臨時ダイヤ・運休は反映していません。位置データが欠けた便は集計に入りません。</li>';
  }

  /* ---- 地図 ---- */
  function initMap() {
    $('map-legend').innerHTML = '<b>区間で増える遅れ</b>' + L.SEG_LEGEND.map(function (x) {
      return '<span><i style="background:' + x[0] + '"></i>' + L.esc(x[1]) + '</span>';
    }).join('');
    if (typeof maplibregl === 'undefined') {
      $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした。表だけをご利用いただけます。</p>';
      return;
    }
    STATE.map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      center: [137.0, 36.0], zoom: 5, attributionControl: { compact: true }
    });
    STATE.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    STATE.map.on('load', function () {
      STATE.ready = true;
      STATE.map.addSource('segs', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      STATE.map.addLayer({ id: 'segs-line', type: 'line', source: 'segs', layout: { 'line-cap': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8] } });
      STATE.map.on('click', 'segs-line', function (e) {
        var f = e.features[0].properties;
        if (STATE.popup) STATE.popup.remove();
        STATE.popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(e.lngLat).setHTML(
          '<b>' + L.esc(f.name) + '</b><br>' + L.esc(f.from) + ' → ' + L.esc(f.to) + '<br>増える遅れ（中央値）: ' + L.fmtDelay(+f.median_added_s) +
          '<br>観測 ' + L.esc(f.n) + ' 回').addTo(STATE.map);
      });
      STATE.map.on('mouseenter', 'segs-line', function () { STATE.map.getCanvas().style.cursor = 'pointer'; });
      STATE.map.on('mouseleave', 'segs-line', function () { STATE.map.getCanvas().style.cursor = ''; });
      if (STATE.op) drawMap(STATE.op, STATE.band);
    });
  }

  function drawMap(op, band) {
    if (STATE.popup) { STATE.popup.remove(); STATE.popup = null; }
    if (!STATE.map || !STATE.ready) return;
    STATE.map.resize();
    var segs = L.segmentsFor(op, band, STATE.route);
    var feats = segs.map(function (s) {
      return { type: 'Feature', properties: { name: s.name, from: s.from, to: s.to, median_added_s: s.median_added_s, n: s.n, color: L.segColor(s.median_added_s) },
        geometry: { type: 'LineString', coordinates: [[s.from_lon, s.from_lat], [s.to_lon, s.to_lat]] } };
    });
    STATE.map.getSource('segs').setData({ type: 'FeatureCollection', features: feats });
    if (feats.length) {
      var b = new maplibregl.LngLatBounds();
      segs.forEach(function (s) { b.extend([s.from_lon, s.from_lat]); b.extend([s.to_lon, s.to_lat]); });
      STATE.map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 400 });
    }
  }

  init();
})();
