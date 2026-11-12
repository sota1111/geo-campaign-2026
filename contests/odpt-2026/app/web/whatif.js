/* 「路線を止めたら？」: 事前計算（whatif_<地域>.json）の差分を表示する。
   各路線を除いて診断を再計算した結果のうち、水準が変化したメッシュだけを保持している。 */
(function () {
  'use strict';
  var L = window.Lib;
  var W = null;        // {routes: {路線index: [[セル番号, 水準], ...]}}
  var ST = null;       // App.STATE
  var D = null;        // 地域データ
  var selected = null; // 選択中の路線index（文字列）
  var refreshCb = null;
  var impact = {};     // 路線index -> {lost, lost65, idx}（現在の条件）

  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.App.esc(s); }

  function routeLabel(r) {
    var rt = D.routes[r];
    return rt[0] + (rt[1] ? '（' + rt[1] + '）' : '') + '｜' + rt[2];
  }

  function onRegion(state, data, refresh) {
    ST = state; D = data; refreshCb = refresh; W = null; selected = null; ST.lost = null;
    // 切り替えの途中でも、読み込み中に共有リンクの路線指定が消えないよう pendingRoute は触らない
    var box = $('whatif');
    box.hidden = true;
    fetch('data/whatif_' + data.id + '.json').then(function (r) {
      if (!r.ok) throw new Error('no whatif');
      return r.json();
    }).then(function (w) {
      if (!ST || ST.data !== data) return;   // 地域が切り替わっていたら捨てる
      W = w;
      box.hidden = false;
      box.innerHTML = '<h2>路線を止めたら？</h2>' +
        '<p class="wi-premise"><b>前提:</b> 選んだ路線の<b>全便が止まる</b>場合を計算します。<b>代替バス・デマンド交通・部分的な減便は考慮しません</b>。いまの診断条件で<b>行けなくなる人</b>を、地図にピンクで示します。</p>' +
        '<p class="note">路線は「事業者・路線名」でまとめ、方向や系統の違うものも含めて、時刻表で再計算しています。</p>' +
        '<div id="wi-top"></div>' +
        '<label for="wi-route" class="note">路線を選ぶ（影響が大きい順）</label>' +
        '<select id="wi-route"></select><div id="wi-result"></div>';
      $('wi-route').addEventListener('change', function () { select($('wi-route').value || null); });
      var pr = ST.pendingRoute; ST.pendingRoute = null;
      onRefresh();
      if (pr != null && W.routes[pr] && D.routes[+pr]) select(pr);
      else refreshCb();
    }).catch(function () { box.hidden = true; if (ST) ST.pendingRoute = null; });
  }

  function computeImpact() {
    impact = {};
    if (!W) return;
    var nd = window.App.need();
    Object.keys(W.routes).forEach(function (r) {
      impact[r] = L.lostPopulation(D.cells, W.routes[r], ST.fi, ST.day, ST.per, nd);
    });
  }

  function onRefresh() {
    if (!W) { if (ST) ST.lost = null; return; }
    computeImpact();
    ST.lost = selected && impact[selected] ? impact[selected].idx : null;
    var ids = Object.keys(impact).sort(function (a, b) { return impact[b].lost - impact[a].lost; });
    var sel = $('wi-route');
    if (sel) {
      sel.innerHTML = '<option value="">（選択しない）</option>' + ids.map(function (r) {
        return '<option value="' + r + '"' + (r === selected ? ' selected' : '') + '>' + esc(routeLabel(+r)) +
          '｜−' + impact[r].lost.toLocaleString('ja-JP') + '人</option>';
      }).join('');
    }
    var top = $('wi-top');
    if (top) {
      top.innerHTML = '<span class="note">影響が大きい路線: </span>' + ids.slice(0, 3).filter(function (r) { return impact[r].lost > 0; })
        .map(function (r) {
          return '<button type="button" class="act" data-r="' + r + '" aria-pressed="' + (r === selected) + '">' + esc(D.routes[+r][0]) + '</button>';
        }).join('');
      Array.prototype.forEach.call(top.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { select(b.getAttribute('data-r')); });
      });
    }
    renderResult();
  }

  function select(r) {
    selected = r;
    var map = window.App.getMap();
    var feats = [];
    if (r != null) {
      feats = D.patterns.filter(function (p) { return String(p[0]) === r; }).map(function (p) {
        return { type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: p[1].map(function (i) { return window.App.lonlat(D.nodes[i]); }) } };
      });
    }
    map.getSource('routes-wi').setData({ type: 'FeatureCollection', features: feats });
    refreshCb();
    // 選んだ路線と、行けなくなるメッシュが見えるように地図を寄せる
    if (r != null) {
      var bb = [180, 90, -180, -90];
      function ext(x, y) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
      var lost = ST.lost;
      if (lost) {
        D.cells.forEach(function (c, k) { if (lost[k]) { var b = L.meshBounds(c[0]); ext(b[0], b[1]); ext(b[2], b[3]); } });
      }
      if (bb[0] > bb[2]) feats.forEach(function (f) { f.geometry.coordinates.forEach(function (pt) { ext(pt[0], pt[1]); }); });
      if (bb[0] <= bb[2]) {
        var mobile = window.matchMedia('(max-width: 720px)').matches;
        var pad = mobile ? { top: 30, left: 30, right: 30, bottom: Math.round(window.innerHeight * 0.56) + 30 } : { top: 60, left: 420, right: 60, bottom: 60 };
        map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: pad, duration: 600, maxZoom: 14 });
      }
    }
  }

  function renderResult() {
    var el = $('wi-result');
    if (!el) return;
    if (selected == null) { el.innerHTML = '<p class="note">路線を選ぶと、その路線が止まったときの影響がここに出ます。</p>'; return; }
    var fl = D.facility_labels[D.facility_order[ST.fi]];
    var cond = L.DAY_LABEL[ST.day] + L.PERIOD_LABEL[ST.per] + D.params.start_hours[ST.per] + '時・' + ST.w + '分以内・' + fl;
    var im = impact[selected];
    var h = '<div class="wi-selected">選択中: <b>' + esc(routeLabel(+selected)) + '</b>（地図にピンクの破線で表示）' +
      '<button type="button" class="clr" id="wi-clear">選択を解除</button></div>';
    h += '<div class="res"><b>' + esc(routeLabel(+selected)) + '</b>が無くなると<br>';
    if (!im || im.lost === 0) {
      h += '「' + esc(cond) + '」の条件では、行けなくなる人はいません。（他の路線で代替できる、または元から到達できない地区です）';
    } else {
      var tot = D.cells.reduce(function (a, c) { return a + c[1]; }, 0);
      h += '「' + esc(cond) + '」で行けなくなる人: <b>' + im.lost.toLocaleString('ja-JP') + '人</b>（診断範囲の' + L.pct(im.lost, tot) +
        '%）、うち65歳以上 ' + im.lost65.toLocaleString('ja-JP') + '人 <span style="color:' + window.App.colors.lost + '">■</span>';
    }
    // 他の条件（曜日×時間帯）での影響
    var nd = window.App.need();
    h += '<table style="margin-top:6px"><tr><th></th>' + L.PERIODS.map(function (p) { return '<th>' + L.PERIOD_LABEL[p] + '</th>'; }).join('') + '</tr>';
    L.DAYS.forEach(function (dy) {
      h += '<tr><th>' + L.DAY_LABEL[dy] + '</th>';
      L.PERIODS.forEach(function (p) {
        var x = L.lostPopulation(D.cells, W.routes[selected] || [], ST.fi, dy, p, nd);
        h += '<td>' + (x.lost ? '−' + x.lost.toLocaleString('ja-JP') : '0') + '</td>';
      });
      h += '</tr>';
    });
    h += '</table><p class="note">表は「' + ST.w + '分以内・' + esc(fl) + '」で行けなくなる人数。<b>0</b>は、その時間帯にはこの路線が無くても結果が変わらないこと（他の路線や徒歩で代わりがきく、その時間帯にこの路線が走っていない、または元から行けない地区だけを通る）を意味します。未計算ではありません。</p></div>';
    el.innerHTML = h;
    $('wi-clear').addEventListener('click', function () { select(null); });
  }

  window.WhatIf = { onRegion: onRegion, onRefresh: onRefresh, getSelected: function () { return selected; } };
})();
