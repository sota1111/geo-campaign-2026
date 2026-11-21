/* 大雨のときに避けたい駅の出入口と迂回: 画面制御（MapLibre GL JS）。外部への送信は行わない（地図タイルの取得のみ）。 */
(function () {
  'use strict';
  var L = window.KansuiLib;
  var esc = L.escapeHtml;
  var D = null, map = null, openIdx = -1, hl = null, hlPop = null;
  var $ = function (id) { return document.getElementById(id); };
  var ST_COLOR = { avoid: '#c2410c', warn: '#e9a23b', none: '#5b7fa6' };

  function cl(c) { return D.meta.classes[c]; }
  var OP_SHORT = { '東京地下鉄': '東京メトロ', '東京都交通局': '都営', '東日本旅客鉄道': 'JR東日本', '東海旅客鉄道': 'JR東海', '首都圏新都市鉄道': 'つくばエクスプレス', '東京臨海高速鉄道': 'りんかい線' };
  function opsText(s) { return s.operators.map(function (o) { return OP_SHORT[o] || o; }).join('・'); }
  function pickLabel(s) { var o = opsText(s); return s.name + (o ? '（' + o + '）' : ''); }
  function badge(c) {
    var s = L.statusOf(c);
    return '<span class="badge ' + s + '">' + esc(L.STATUS_TEXT[s]) + '</span>';
  }

  function load() {
    fetch('data/kansui.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      D = d;
      D.stations.forEach(function (st) {   // 同じ番号の出入口が複数ある駅は区別する
        var seen = {};
        st.entrances.forEach(function (e) { seen[e.label] = (seen[e.label] || 0) + 1; if (seen[e.label] > 1) e.label += '（' + seen[e.label] + 'か所目）'; });
      });
      renderSummary(); renderList(); renderPick(); renderFoot();
      initMap();
    }).catch(function (e) {
      $('summary').innerHTML = '<p class="note">データを読み込めませんでした（' + esc(e.message) + '）。このフォルダを Web サーバーで配信して開いてください（README の起動方法）。</p>';
    });
  }

  function renderSummary() {
    var st = D.stations, n = 0, a = 0, w = 0, z = 0, half = 0;
    st.forEach(function (s) {
      n += s.summary.n; a += s.summary.avoid; w += s.summary.warn; z += s.summary.none;
      if (s.summary.n && s.summary.avoid * 2 >= s.summary.n) half++;
    });
    function stat(cls, v, t) { return '<div class="stat ' + cls + '"><b>' + v + '</b><span>' + t + '</span></div>'; }
    $('summary').innerHTML =
      stat('', st.length, '駅（' + esc(D.meta.region.name.split('（')[0]) + '）') +
      stat('', n, '出入口（OSM に記録のあるもの）') +
      stat('avoid', a + '（' + (n ? Math.round(a / n * 100) : 0) + '%）', '▲ 避けたい出入口（想定0.5m以上）') +
      stat('', w, '△ 注意（0.5m未満）') +
      stat('', z, '○ 着色なし') +
      stat('avoid', half, '出入口の半数以上が「避けたい」の駅');
  }

  var pickMap = {};
  function renderPick() {
    var inp = $('pickStation'), dl = $('stationNames');
    D.stations.map(function (s, i) { return [pickLabel(s), i]; })
      .sort(function (x, y) { return x[0].localeCompare(y[0], 'ja'); })
      .forEach(function (p) {
        pickMap[p[0]] = p[1];
        var o = document.createElement('option');
        o.value = p[0];
        dl.appendChild(o);
      });
    function go() {
      var v = inp.value.trim().replace(/駅$/, ''), msg = $('pickMsg');
      if (!v) { msg.textContent = ''; return; }
      var i = pickMap[v];
      if (i === undefined) {
        var hits = Object.keys(pickMap).filter(function (k) { return k.indexOf(v) === 0; });
        if (hits.length === 1) i = pickMap[hits[0]];
        else if (hits.length > 1) {
          msg.innerHTML = '「' + esc(v) + '」に当てはまる駅が' + hits.length + 'つあります。押して選んでください: ' + hits.map(function (k) { return '<button type="button" class="jump" data-pick="' + esc(k) + '">' + esc(k) + '</button>'; }).join(' ');
          msg.querySelectorAll('[data-pick]').forEach(function (b) { b.onclick = function () { inp.value = b.getAttribute('data-pick'); go(); }; });
          return;
        }
      }
      if (i === undefined) { msg.textContent = '「' + v + '」はこの地図の範囲の駅にありません（' + D.meta.region.name.split('（')[0] + 'の駅のみ）。'; return; }
      msg.textContent = '';
      openStation(i, true);
    }
    inp.addEventListener('change', go);
    inp.addEventListener('input', function () { if (pickMap[inp.value.trim()] !== undefined) go(); });
    $('pickGo').addEventListener('click', go);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }

  function indexOfStation(s) { return D.stations.indexOf(s); }

  function renderList() {
    var ranked = L.rankStations(D.stations);
    var rest = D.stations.filter(function (s) { return !s.summary.n; });
    var html = '';
    ranked.forEach(function (s, i) { html += itemHtml(s, i + 1); });
    rest.forEach(function (s) { html += itemHtml(s, null); });
    $('list').innerHTML = html;
    $('list').addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      if (b.classList.contains('head')) { var i = +b.getAttribute('data-i'); openStation(i === openIdx ? -1 : i, true); }
      else if (b.getAttribute('data-fly')) {
        var p = b.getAttribute('data-fly').split(',');
        flyTo(+p[0], +p[1], 18);
        if (map && window.maplibregl) {
          if (hl) hl.remove();
          var el = document.createElement('div'); el.className = 'hl-mark'; el.setAttribute('aria-hidden', 'true');
          hl = new maplibregl.Marker({ element: el }).setLngLat([+p[0], +p[1]]).addTo(map);
          var lab = b.getAttribute('data-label');
          if (lab) { if (hlPop) hlPop.remove(); hlPop = new maplibregl.Popup({ offset: 18, closeOnClick: true }).setLngLat([+p[0], +p[1]]).setHTML('<strong>' + esc(lab) + '</strong>').addTo(map); }
        }
        if (window.innerWidth < 900) $('map').scrollIntoView({ block: 'start', behavior: 'smooth' });  // 狭い画面では地図が画面外になるため
      } else if (b.getAttribute('data-go')) { openStation(+b.getAttribute('data-go'), true); }
    });
    $('csvStations').addEventListener('click', function () { download('kansui_stations.csv', L.stationsCsv(D.stations, D.meta.classes)); });
    $('csvEntrances').addEventListener('click', function () { download('kansui_entrances.csv', L.entrancesCsv(D.stations, D.meta.classes)); });
  }

  function itemHtml(s, rank) {
    var m = s.summary, i = indexOfStation(s);
    var ops = opsText(s);
    var bar = '', cnt;
    if (m.n) {
      bar = '<span class="bar" aria-hidden="true"><i class="a" style="width:' + (m.avoid / m.n * 100) + '%"></i><i class="w" style="width:' + (m.warn / m.n * 100) + '%"></i></span>';
      cnt = '<span class="cnt">▲ ' + m.avoid + ' ／ 出入口 ' + m.n + '</span>';
    } else {
      cnt = '<span class="cnt">出入口の記録なし</span>';
    }
    return '<li class="item" id="st' + i + '"><button type="button" class="head" data-i="' + i + '" aria-expanded="false">' +
      '<span class="rank">' + (rank || '–') + '</span>' +
      '<span class="nm">' + esc(s.name) + (ops ? '<small>' + esc(ops) + '</small>' : '') + '</span>' + bar + cnt + '</button>' +
      '<div class="detail" hidden></div></li>';
  }

  function openStation(i, fly) {
    var prev = openIdx;
    if (prev >= 0) closeItem(prev);
    openIdx = i;
    $('pickStation').value = i >= 0 ? pickLabel(D.stations[i]) : '';
    if (i < 0) { clearAlt(); updateSelection(); return; }
    var li = $('st' + i), d = li.querySelector('.detail');
    d.innerHTML = detailHtml(D.stations[i]);
    d.hidden = false;
    li.classList.add('open');
    li.querySelector('.head').setAttribute('aria-expanded', 'true');
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (fly) {
      var s = D.stations[i];
      if (!showAlternatives(s)) flyTo(s.lon, s.lat, 16);
    } else showAlternatives(D.stations[i], true);
    updateSelection();
  }
  function closeItem(i) {
    var li = $('st' + i);
    li.classList.remove('open');
    li.querySelector('.detail').hidden = true;
    li.querySelector('.head').setAttribute('aria-expanded', 'false');
  }

  function busLine(ref) {
    var b = D.bus[ref.b], mx = Math.max.apply(null, b.hourly.concat([1]));
    var spark = '<span class="spark" role="img" aria-label="平日の時間帯別の便数（0時〜23時）">' +
      b.hourly.map(function (v) { return '<i style="height:' + Math.round(v / mx * 14) + 'px"></i>'; }).join('') + '</span>';
    var hints = [];
    if (b.routes.length) hints.push('路線: ' + b.routes.join('、'));
    if (b.cls >= L.WARN_MIN) hints.push('このバス停の地点も想定あり（' + cl(b.cls) + '）');
    return '<li><strong>' + esc(b.name) + '</strong> 約' + L.fmtDist(ref.d) + '（直線）・' + esc(L.busSummary(b)) + spark +
      (hints.length ? '<br><span class="hint">' + esc(hints.join(' ／ ')) + '</span>' : '') + '</li>';
  }

  function detailHtml(s) {
    var h = '';
    if (!s.entrances.length) {
      h += '<p class="note">この駅は OpenStreetMap に出入口の記録がありません。駅の位置では ' + badge(s.cls) + '（洪水: ' + esc(cl(s.flood)) + ' ／ 高潮: ' + esc(cl(s.tide)) + '）。</p>';
      h += busBlock(s.bus, '駅の近くのバス停');
      return h;
    }
    h += conclusionHtml(s);
    s.entrances.forEach(function (e, ei) {
      var st = L.statusOf(e.cls);
      h += '<div class="ent ' + st + '"><h4>' + esc(e.label) + ' ' + badge(e.cls) + '</h4>' +
        '<div class="meta">洪水の想定: <strong>' + esc(cl(e.flood)) + '</strong> ／ 高潮の想定: <strong>' + esc(cl(e.tide)) + '</strong>' +
        (e.name ? ' ／ 名称: ' + esc(e.name.split(';').join('・')) : '') + '</div>' +
        '<div class="meta">場所: 駅の中心から' + esc(dirFrom(s, e)) + ' ／ 車いす: ' + esc(WC[e.wheelchair] || '記録なし（OSM）') + (e.cls >= L.WARN_MIN ? ' ／ 判定の理由: ' + esc(reasonOf(e)) : '') + '</div>' +
        '<div class="meta">' + esc(L.STATUS_NOTE[st]) + '</div>' +
        '<button type="button" class="jump" data-fly="' + e.lon + ',' + e.lat + '" data-label="' + esc(L.stationLabel(s.name) + ' ' + e.label) + '">地図で見る</button>';
      h += altHtml(s, e);
      h += '</div>';
    });
    return h;
  }

  var WC = { yes: '利用可（OSMの記録）', no: '利用不可（OSMの記録）', limited: '一部利用可（OSMの記録）' };
  function dirFrom(s, e) {
    var dy = (e.lat - s.lat) * 111000, dx = (e.lon - s.lon) * 111000 * Math.cos(s.lat * Math.PI / 180);
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 10) return 'すぐそば';
    var names = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
    var a = (Math.atan2(dx, dy) * 180 / Math.PI + 360 + 22.5) % 360;
    return names[Math.floor(a / 45)] + 'へ約' + L.fmtDist(Math.round(d / 10) * 10);
  }
  function reasonOf(e) {
    var r = [];
    if (e.flood >= L.WARN_MIN) r.push('川の氾濫（洪水）の想定 ' + cl(e.flood));
    if (e.tide >= L.WARN_MIN) r.push('高潮の想定 ' + cl(e.tide));
    return r.join('、') + (e.flood !== e.tide && e.flood >= L.WARN_MIN && e.tide >= L.WARN_MIN ? '（深い方で判定）' : '');
  }
  /* 出入口がすべて「避けたい」の駅では、代わりの駅・バス停を地図に名前つきで出し、駅と一緒に収まるように寄せる */
  var altMarks = [];
  function clearAlt() { altMarks.forEach(function (m) { m.remove(); }); altMarks = []; }
  function showAlternatives(s, noFit) {
    clearAlt();
    if (!map || !window.maplibregl || !s.entrances.length || s.summary.avoid < s.summary.n) return false;
    var bs = null, bb = null;
    s.entrances.forEach(function (e) {
      var sf = e.alt.safer; if (!sf) return;
      if (sf.station && (!bs || sf.station.d < bs.d)) bs = sf.station;
      if (sf.bus && (!bb || sf.bus.d < bb.d)) bb = sf.bus;
    });
    var pts = [[s.lon, s.lat]];
    function mark(lon, lat, text) {
      var el = document.createElement('div'); el.className = 'alt-mark'; el.textContent = text;
      altMarks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(map));
      pts.push([lon, lat]);
    }
    if (bs) { var t = D.stations[bs.s], o = bs.e >= 0 ? t.entrances[bs.e] : null; mark(o ? o.lon : t.lon, o ? o.lat : t.lat, '代わりの駅: ' + L.stationLabel(t.name) + (o ? ' ' + o.label : '')); }
    if (bb) { var b = D.bus[bb.b]; mark(b.lon, b.lat, '代わりのバス停: ' + b.name); }
    if (pts.length < 2) return false;
    if (!noFit) {
      var lo = pts.map(function (p) { return p[0]; }), la = pts.map(function (p) { return p[1]; });
      map.fitBounds([[Math.min.apply(null, lo), Math.min.apply(null, la)], [Math.max.apply(null, lo), Math.max.apply(null, la)]], { padding: 70, maxZoom: 16 });
    }
    return true;
  }
  /* 駅ごとの結論（まず一言で） */
  function conclusionHtml(s) {
    var m = s.summary, name = L.stationLabel(s.name), h = '<div class="concl"><h4>まとめ: ' + esc(name) + '</h4><p>';
    var low = s.entrances.filter(function (e) { return e.cls < L.AVOID_MIN; });
    if (!m.avoid) {
      h += '出入口 ' + m.n + ' か所に、想定0.5m以上の「避けたい」出入口はありません' + (m.warn ? '（△ 注意 ' + m.warn + ' か所）' : '') + '。';
      return h + '</p><p class="hint">「着色なし」も安全の保証ではありません。当日の情報を優先してください。</p></div>';
    }
    if (low.length) {
      low.sort(function (a, b) { return a.cls - b.cls; });
      h += '出入口 ' + m.n + ' か所のうち ▲ ' + m.avoid + ' か所が「避けたい」（想定0.5m以上）です。大雨のときは、この駅の出入口の中で浸水の想定が浅い（0.5m未満か着色なし）次の出入口を使うのが目安です: <strong>' +
        low.map(function (e) { return esc(e.label) + '（' + (e.cls === 0 ? '○ 着色なし' : '△ 注意・' + esc(cl(e.cls))) + '・' + esc(dirFrom(s, e)) + (e.wheelchair === 'yes' ? '・車いす可' : '') + '）'; }).join('、') + '</strong>。';
      if (low.every(function (e) { return e.cls > 0; })) h += ' 「△ 注意」は浸水の想定が浅い（0.5m未満）という意味で、水が来ないという意味ではありません。';
      return h + '</p>' + jumpList(low) + '</div>';
    }
    // すべて避けたい: 範囲を広げて、避けたいに当たらない最寄りの駅・バス停
    var bs = null, bb = null, bs0 = null, bb0 = null;
    s.entrances.forEach(function (e) {
      var sf = e.alt.safer; if (!sf) return;
      if (sf.station && (!bs || sf.station.d < bs.d)) bs = sf.station;
      if (sf.bus && (!bb || sf.bus.d < bb.d)) bb = sf.bus;
      if (sf.station0 && (!bs0 || sf.station0.d < bs0.d)) bs0 = sf.station0;
      if (sf.bus0 && (!bb0 || sf.bus0.d < bb0.d)) bb0 = sf.bus0;
    });
    var deep = s.entrances.map(function (e) { return e.cls; });
    var minc = Math.min.apply(null, deep);
    h += '<strong>出入口 ' + m.n + ' か所のすべてが「避けたい」</strong>（洪水と高潮の想定の深い方が0.5m以上）です。この駅の中には、想定の低い出入口はありません。';
    var lowest = s.entrances.filter(function (e) { return e.cls === minc; });
    if (deep.some(function (c) { return c !== minc; })) h += ' その中では <strong>' + lowest.map(function (e) { return esc(e.label); }).join('・') + '</strong> の想定が最も浅い区分（' + esc(cl(minc)) + '）です。';
    else {
      // 区分が同じなら、洪水か高潮の片方だけが0.5m以上の出入口を「比べれば浅め」として挙げる
      var one = lowest.filter(function (e) { return Math.min(e.flood, e.tide) < L.AVOID_MIN; });
      if (one.length && one.length < lowest.length) h += ' すべて同じ区分（' + esc(cl(minc)) + '）ですが、洪水か高潮の<strong>片方だけ</strong>が0.5m以上なのは <strong>' + one.map(function (e) { return esc(e.label) + '（' + esc(dirFrom(s, e)) + '・' + (e.flood >= L.AVOID_MIN ? '洪水' : '高潮') + 'のみ）'; }).join('、') + '</strong> です。駅の中で選ぶなら、こちらが比べて浅めの目安です。';
    }
    h += '</p><p>大雨が予想されるときの代わりの目安（「△ 注意」＝想定0.5m未満、または「○ 着色なし」の場所のうち、いちばん近いもの）:</p><ul>';
    if (bs) {
      var t = D.stations[bs.s], o = bs.e >= 0 ? t.entrances[bs.e] : null;
      h += '<li>駅: <button type="button" class="jump" data-go="' + bs.s + '">' + esc(L.stationLabel(t.name)) + '</button> ' + (o ? esc(o.label) : '駅の位置') +
        '（約' + L.fmtDist(bs.d) + '・直線）' + badge(o ? o.cls : t.cls) +
        ' <button type="button" class="jump" data-fly="' + (o ? o.lon : t.lon) + ',' + (o ? o.lat : t.lat) + '" data-label="' + esc(L.stationLabel(t.name) + ' ' + (o ? o.label : '')) + '">地図で見る</button></li>';
    } else h += '<li>駅: 直線 ' + L.fmtDist(4000) + ' 以内にありません。</li>';
    if (bb) {
      var b = D.bus[bb.b];
      h += '<li>バス停: <strong>' + esc(b.name) + '</strong>（約' + L.fmtDist(bb.d) + '・直線）・' + esc(L.busSummary(b)) + ' <button type="button" class="jump" data-fly="' + b.lon + ',' + b.lat + '" data-label="' + esc(b.name + '（バス停）') + '">地図で見る</button></li>';
    } else h += '<li>バス停: 直線 ' + L.fmtDist(1500) + ' 以内に、想定0.5m未満か着色なしの場所で便のある都営バスのバス停はありません。</li>';
    var extra = [];
    if (bs0 && (!bs || bs0.d > bs.d)) { var t0 = D.stations[bs0.s], o0 = bs0.e >= 0 ? t0.entrances[bs0.e] : null; extra.push('駅: ' + esc(L.stationLabel(t0.name)) + ' ' + (o0 ? esc(o0.label) : '駅の位置') + '（約' + L.fmtDist(bs0.d) + '）'); }
    if (bb0 && (!bb || bb0.d > bb.d)) { var b0 = D.bus[bb0.b]; extra.push('バス停: ' + esc(b0.name) + '（約' + L.fmtDist(bb0.d) + '）'); }
    if (extra.length) h += '<li>上の候補は「△ 注意（0.5m未満）」を含みます。<b>着色なし</b>の場所でいちばん近いのは ' + extra.join('、') + ' です（直線）。</li>';
    h += '</ul>' + ((bs || bb) ? '<p class="hint">地図に「代わりの駅」「代わりのバス停」の札を出しています。</p>' : '') + '<p class="hint">この辺り一帯が想定区域のため、近くに「避けたい」に当たらない出入口がありません。大雨が予想される日は、早めに移動する・在宅に切り替えるなど、時間で避けることも検討してください。距離は直線で、冠水した道は考えていません。</p>';
    return h + '</div>';
  }
  function jumpList(arr) {
    return '<p>' + arr.map(function (e) { return '<button type="button" class="jump" data-fly="' + e.lon + ',' + e.lat + '" data-label="' + esc(e.label) + '">' + esc(e.label) + ' を地図で見る</button>'; }).join(' ') + '</p>';
  }

  function busBlock(list, title) {
    if (!list.length) return '<h5>' + esc(title) + '</h5><p class="nope">500m 以内に、運行する便のあるバス停（都営バス）の記録はありません。</p>';
    return '<h5>' + esc(title) + '</h5><ul>' + list.map(busLine).join('') + '</ul>';
  }

  function altHtml(s, e) {
    var a = e.alt, h = '<div class="alt">';
    if (e.cls >= L.WARN_MIN) {
      h += '<h5>この出入口より浸水の想定が浅い候補</h5><p class="hint">「この出入口より浅い」という比較です。候補自体がまだ「▲ 避けたい」（0.5m以上）のこともあります。想定0.5m未満か着色なしの場所は、駅の「まとめ」に出しています。</p>';
      if (a.same.length) {
        h += '<h5>同じ駅の別の出入口</h5><ul>' + a.same.map(function (x) {
          var o = s.entrances[x.i];
          return '<li><strong>' + esc(o.label) + '</strong> 約' + L.fmtDist(x.d) + '（直線）・' + badge(o.cls) + ' ' + esc(cl(o.cls)) +
            ' <button type="button" class="jump" data-fly="' + o.lon + ',' + o.lat + '">地図で見る</button></li>';
        }).join('') + '</ul>';
      } else {
        h += '<p class="nope">同じ駅内に、想定の区分がより低い出入口の記録はありません。</p>';
      }
      if (a.stations.length) {
        h += '<h5>隣の駅（直線 1.5km 以内）</h5><ul>' + a.stations.map(function (x) {
          var t = D.stations[x.s], o = x.e >= 0 ? t.entrances[x.e] : null;
          var c = o ? o.cls : t.cls;
          return '<li><button type="button" class="jump" data-go="' + x.s + '">' + esc(L.stationLabel(t.name)) + '</button> ' +
            (o ? esc(o.label) : '駅の位置') + ' まで約' + L.fmtDist(x.d) + '（直線）・' + badge(c) + ' ' + esc(cl(c)) + '</li>';
        }).join('') + '</ul>';
      } else {
        h += '<p class="nope">直線 1.5km 以内に、想定の区分がより低い隣の駅の記録はありません。</p>';
      }
      h += busBlock(a.bus, '近くのバス停（500m 以内・便のあるもの）');
      h += '<p class="hint">距離は直線です。実際の道のりは地図・案内で確認してください。冠水時の道路の状況は反映していません。</p>';
    } else {
      h += busBlock(a.bus, '近くのバス停（500m 以内・便のあるもの）');
    }
    return h + '</div>';
  }

  function renderFoot() {
    var m = D.meta, g = m.gtfs;
    var src = m.sources.map(function (x) {
      return '<li>' + esc(x.name) + '（' + esc(x.org) + '、' + esc(x.license) + '）: ' + esc(x.use) +
        ' <a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.url) + '</a></li>';
    }).join('');
    $('foot').innerHTML = '<h2>データの出典・ライセンスと限界</h2><ul>' + src + '</ul>' +
      '<ul><li>便数は都営バスの GTFS-JP（フィード版 ' + esc(g.feed_version) + '）で、平日は ' + esc(g.ref_weekday) + '（水）、休日は ' + esc(g.ref_holiday) + '（日）の運行分。データの取得日 ' + esc(m.generated) + '。</li>' +
      '<li>浸水の区分は、出入口の地点（周囲約1m）のタイルの色を読んだ目安です。「着色なし」は、この想定図に色がないという意味で、安全の保証ではありません。内水（雨水出水）の想定は、この地域では国土地理院のタイルに無く、含めていません。</li>' +
      '<li>地下駅の出入口の位置は OpenStreetMap の記録に依存し、すべての出入口があるとは限りません（駅に紐づけられなかった出入口 ' + m.counts.unassigned_entrances + ' 件）。バスは都営バスのみで、他社・地下鉄・JR の便は含みません。</li>' +
      '<li>実際の冠水は雨量・排水・街の状況で変わります。気象庁の防災情報（<a href="https://www.jma.go.jp/bosai/" target="_blank" rel="noopener">https://www.jma.go.jp/bosai/</a>）、鉄道会社・自治体の案内を優先してください。</li></ul>';
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    var m = $('csvMsg');
    if (m) { m.hidden = false; m.textContent = '「' + name + '」を保存しました（ブラウザのダウンロード先に入ります。Excel で開けます）。'; }
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---- 地図 ---- */
  function flyTo(lon, lat, z) { if (map) map.flyTo({ center: [lon, lat], zoom: z, essential: true }); }

  function geo() {
    var st = [], en = [];
    D.stations.forEach(function (s, i) {
      st.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { i: i, name: s.name, st: s.summary.n ? L.statusOf(s.summary.max) : 'none', n: s.summary.n, a: s.summary.avoid } });
      s.entrances.forEach(function (e) {
        en.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
          properties: { i: i, label: e.label, st: L.statusOf(e.cls), c: e.cls } });
      });
    });
    var bs = D.bus.map(function (b, i) {
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: { b: i, name: b.name } };
    });
    var fc = function (f) { return { type: 'FeatureCollection', features: f }; };
    return { st: fc(st), en: fc(en), bs: fc(bs) };
  }

  function colorExpr() {
    return ['match', ['get', 'st'], 'avoid', ST_COLOR.avoid, 'warn', ST_COLOR.warn, ST_COLOR.none];
  }

  function initMap() {
    if (typeof maplibregl === 'undefined') { $('mapfail').hidden = false; return; }
    var c = D.meta.region.center;
    map = new maplibregl.Map({
      container: 'map', center: c, zoom: 11, maxZoom: 18, attributionControl: false,
      style: { version: 8, sources: { base: { type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>' } },
        layers: [{ id: 'base', type: 'raster', source: 'base' }] }
    });
    var bb = D.meta.region.bbox;
    map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: 20, animate: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution:
      '浸水想定: 国土交通省・東京都（国土地理院 重ねるハザードマップ） | 駅・出入口: © OpenStreetMap contributors | バス: 東京都交通局・ODPT（CC BY 4.0）' }));
    map.on('load', function () {
      var g = geo();
      [['flood', '01_flood_l2_shinsuishin_data'], ['tide', '03_hightide_l2_shinsuishin_data']].forEach(function (p) {
        map.addSource('ov-' + p[0], { type: 'raster', tileSize: 256, maxzoom: 17,
          tiles: ['https://disaportaldata.gsi.go.jp/raster/' + p[1] + '/{z}/{x}/{y}.png'] });
        map.addLayer({ id: 'ov-' + p[0], type: 'raster', source: 'ov-' + p[0], layout: { visibility: (p[0] === 'flood' ? $('ovFlood').checked : $('ovTide').checked) ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.6 } });
      });
      map.addSource('bus', { type: 'geojson', data: g.bs });
      map.addSource('ents', { type: 'geojson', data: g.en });
      map.addSource('sts', { type: 'geojson', data: g.st });
      map.addLayer({ id: 'bus', type: 'circle', source: 'bus', minzoom: 13,
        paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': '#1b4f8a', 'circle-stroke-width': 2 } });
      map.addLayer({ id: 'ents', type: 'circle', source: 'ents', minzoom: 14,
        paint: { 'circle-radius': 6, 'circle-color': colorExpr(), 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'sts-sel', type: 'circle', source: 'sts', filter: ['==', ['get', 'i'], -1],
        paint: { 'circle-radius': 18, 'circle-color': 'rgba(27,79,138,0.15)', 'circle-stroke-color': '#1b4f8a', 'circle-stroke-width': 3 } });
      map.addLayer({ id: 'sts', type: 'circle', source: 'sts',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10], 'circle-color': colorExpr(),
          'circle-stroke-color': '#1b2a3a', 'circle-stroke-width': 2 } });
      ['sts', 'ents'].forEach(function (id) {
        map.on('click', id, function (ev) {
          var f = ev.features[0], i = f.properties.i;
          var t = id === 'sts' ? esc(L.stationLabel(f.properties.name)) : esc(L.stationLabel(D.stations[i].name)) + ' ' + esc(f.properties.label);
          new maplibregl.Popup({ offset: 10 }).setLngLat(f.geometry.coordinates).setHTML('<strong>' + t + '</strong>').addTo(map);
          openStation(i, false);
        });
        map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
      });
      map.on('click', 'bus', function (ev) {
        var b = D.bus[ev.features[0].properties.b];
        new maplibregl.Popup({ offset: 8 }).setLngLat(ev.features[0].geometry.coordinates)
          .setHTML('<strong>' + esc(b.name) + '</strong><br>' + esc(L.busSummary(b))).addTo(map);
      });
      updateSelection();
    });
    $('ovFlood').addEventListener('change', function (e) { setOv('flood', e.target.checked); });
    $('ovTide').addEventListener('change', function (e) { setOv('tide', e.target.checked); });
  }
  function setOv(k, on) { if (map && map.getLayer('ov-' + k)) map.setLayoutProperty('ov-' + k, 'visibility', on ? 'visible' : 'none'); }
  function updateSelection() {
    if (map && map.getLayer('sts-sel')) map.setFilter('sts-sel', ['==', ['get', 'i'], openIdx]);
  }

  load();
})();
