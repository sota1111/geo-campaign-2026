/* 観光バスを避ける生活ルート: 画面 */
(function () {
  'use strict';
  var L = window.KankouLib;
  var $ = function (id) { return document.getElementById(id); };
  var C_NORMAL = '#0072B2', C_AVOID = '#D55E00', C_SPOT = '#CC79A7';
  var KINDS = [['病院', '病院'], ['鉄道駅', '駅'], ['小学校', '小学校'], ['中学校', '中学校'], ['高校', '高校']];
  var S = {
    data: null, net: null, map: null, ready: false, origin: null, dest: null, dt: 'wd', timeSec: 10 * 3600,
    share: L.DEFAULTS.share, ws: L.DEFAULTS.winStart, we: L.DEFAULTS.winEnd, kind: '病院', pick: null,
    tdt: 'all', tfeed: 'all', thf: 5, tht: 25, limit: 30, markers: {}, popup: null, last: null, sweepTimer: null
  };

  function opts() { return { dt: S.dt, dep: S.timeSec, share: S.share, winStart: S.ws, winEnd: S.we }; }
  function pct(x) { return Math.round(x * 1000) / 10; }
  function hourLabel(h) { return h >= 24 ? '翌' + (h - 24) + '時台' : h + '時台'; }
  function hh(n) { return (n < 10 ? '0' : '') + n + ':00'; }

  /* ---- 読み込み ---- */
  function load() {
    fetch('data/kankou.json').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      S.data = d; S.net = L.prepare(d);
      init();
    }).catch(function (e) {
      $('result-body').innerHTML = '<p class="msg">データを読み込めませんでした（' + L.esc(e.message) + '）。このフォルダで <code>python3 -m http.server</code> を起動し、http://localhost:8000/ で開いてください（ファイルを直接開くと読み込めません）。</p>';
    });
  }

  function init() {
    var d = S.data;
    $('region-name').textContent = d.region.name;
    $('near-m').textContent = d.near_m;
    initDay();
    initCond();
    initPlaces();
    initTable();
    initAbout();
    initMap();
    /* 例の出発地・目的地 */
    var ex = L.searchPlaces(d, '墨東病院', 5).filter(function (p) { return p.kind === 'facility'; })[0];
    setPlace('o', { lat: 35.7185, lon: 139.7900, name: '浅草・国際通り付近（例の地点）', tag: '地図上の地点' }, true);
    if (ex) setPlace('d', { lat: ex.lat, lon: ex.lon, name: ex.name + '（例）', tag: ex.tag }, true);
    recompute(true);
    $('o-now').insertAdjacentHTML('beforeend', '<br><span class="note">最初は例の出発地・目的地が入っています。上の欄で名前を入れて選び直すか、「地図で指す」で変えてください。</span>');
  }

  /* ---- 日種別・時刻 ---- */
  function seg(el, items, cur, onpick) {
    el.innerHTML = items.map(function (it) {
      return '<button type="button" role="radio" aria-checked="' + (it[0] === cur) + '" data-v="' + L.esc(it[0]) + '">' + L.esc(it[1]) + '</button>';
    }).join('');
    el.onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      onpick(b.getAttribute('data-v'));
      seg(el, items, b.getAttribute('data-v'), onpick);
    };
  }
  function initDay() {
    seg($('dt'), [['wd', '平日'], ['hol', '休日']], S.dt, function (v) { S.dt = v; refNote(); recompute(false); });
    function onTime() {
      var m = /^(\d{1,2}):(\d{2})$/.exec(this.value);
      if (m) { var t = (+m[1]) * 3600 + (+m[2]) * 60; if (t !== S.timeSec) { S.timeSec = t; recompute(false); } }
    }
    $('time').addEventListener('change', onTime);
    $('time').addEventListener('input', onTime);   // 入力のたびに結果を更新（欄を離れなくても反映）
    refNote();
  }
  function refNote() {
    var parts = S.data.feeds.map(function (f) { return f.name + ' ' + f.ref[S.dt]; });
    $('ref-note').textContent = '時刻表の基準日: ' + parts.join(' ／ ') + '（この日のダイヤで計算）';
  }

  /* ---- 推定の条件 ---- */
  function initCond() {
    var opts24 = '';
    for (var h = 0; h <= 24; h++) opts24 += '<option value="' + h + '">' + hh(h) + '</option>';
    $('ws').innerHTML = opts24; $('we').innerHTML = opts24;
    $('ws').value = S.ws / 3600; $('we').value = S.we / 3600;
    $('share').value = Math.round(S.share * 100);
    $('share-v').textContent = Math.round(S.share * 100) + '%';
    $('share').addEventListener('input', function () {
      S.share = +this.value / 100; $('share-v').textContent = this.value + '%'; recompute(false); renderTables();
    });
    function syncTable() {   // 4. の一覧の時間帯も、仮定した時間帯に合わせる
      S.thf = S.ws / 3600; S.tht = Math.max(S.thf, S.we / 3600 - 1);
      if ($('t-hf')) { $('t-hf').value = S.thf; $('t-ht').value = S.tht; S.limit = 30; renderTables(); }
    }
    $('ws').addEventListener('change', function () { S.ws = +this.value * 3600; recompute(false); syncTable(); });
    $('we').addEventListener('change', function () { S.we = +this.value * 3600; recompute(false); syncTable(); });
  }

  /* ---- 出発地・目的地 ---- */
  function placeBtn(p, i) {
    return '<button type="button" role="option" class="res" data-i="' + i + '">' + L.esc(p.name) + '<span class="sub">' + L.esc(p.tag) +
      (p.m != null ? ' ／ ' + (p.m < 1000 ? Math.round(p.m) + ' m' : (p.m / 1000).toFixed(1) + ' km') + '（直線）' : '') + '</span></button>';
  }
  function initPlaces() {
    var lists = { o: [], d: [] };
    function show(which) {
      var q = $(which + '-q').value, el = $(which + '-list'), arr;
      if (which === 'o') {
        arr = q.trim() ? L.searchPlaces(S.data, q, 12) : [];
        el.hidden = !q.trim();
      } else {
        if (q.trim()) {
          var all = L.searchPlaces(S.data, q, 400);
          var od = function (p) { return S.origin ? L.haversine(S.origin.lat, S.origin.lon, p.lat, p.lon) : 0; };
          arr = all.filter(function (p) { return p.kind === 'facility' && p.tag === S.kind; })
            .sort(function (a, b) { return od(a) - od(b); }).slice(0, 8);   // 同じ種類の中では、出発地に近い順
          // 選んだ種類の後ろに、観光地点・バス停・他の種類の施設も出す（例: 浅草寺 → 観光地点、雷門 → 浅草雷門のバス停）
          arr = arr.concat(all.filter(function (p) { return arr.indexOf(p) < 0; })).slice(0, 14);
        } else {
          /* 検索語が空なら、出発地に近い順 */
          arr = S.data.facilities.map(function (f, i) { return { kind: 'facility', i: i, lat: f[0], lon: f[1], name: f[2], tag: f[3],
            m: S.origin ? L.haversine(S.origin.lat, S.origin.lon, f[0], f[1]) : 0 }; })
            .filter(function (p) { return p.tag === S.kind; }).sort(function (a, b) { return a.m - b.m; }).slice(0, 8);
          if (!S.origin) arr.forEach(function (p) { p.m = null; });
        }
      }
      lists[which] = arr;
      el.innerHTML = arr.length ? arr.map(placeBtn).join('') : '<div class="empty">該当する場所がありません。名前の一部（例: 「上野」）で探すか、横の「地図で指す」で地図上の地点を選べます。</div>';
    }
    ['o', 'd'].forEach(function (w) {
      $(w + '-q').addEventListener('input', function () { show(w); });
      $(w + '-list').addEventListener('click', function (e) {
        var b = e.target.closest('button.res'); if (!b) return;
        var p = lists[w][+b.getAttribute('data-i')];
        setPlace(w, { lat: p.lat, lon: p.lon, name: p.name, tag: p.tag }, true);
        $(w + '-q').value = '';
        if (w === 'o') $('o-list').hidden = true; else show('d');
        recompute(true);
      });
      $(w + '-map').addEventListener('click', function () { setPick(S.pick === w ? null : w); });
    });
    seg($('d-kind'), KINDS.map(function (k) { return [k[0], k[1]]; }), S.kind, function (v) { S.kind = v; show('d'); });
    S.refreshDestList = function () { show('d'); };
    show('d');
  }

  function setPick(w) {
    S.pick = w;
    ['o', 'd'].forEach(function (x) { $(x + '-map').setAttribute('aria-pressed', String(w === x)); });
    var bar = $('pickbar');
    bar.hidden = !w;
    bar.textContent = w ? '地図をタップして' + (w === 'o' ? '出発地' : '目的地') + 'を指定（もう一度ボタンで解除）' : '';
    if (S.map) S.map.getCanvas().style.cursor = w ? 'crosshair' : '';
  }

  function setPlace(w, p, move) {
    var key = w === 'o' ? 'origin' : 'dest';
    S[key] = p;
    $(w + '-now').innerHTML = (w === 'o' ? '出発地: ' : '目的地: ') + '<b>' + L.esc(p.name) + '</b>' + (p.tag && p.tag !== '地図上の地点' ? '（' + L.esc(p.tag) + '）' : '');
    if (S.map && S.ready) placeMarker(w, p);
    if (S.refreshDestList && w === 'o') S.refreshDestList();
  }
  function placeMarker(w, p) {
    var m = S.markers[w];
    if (!m) {
      var el = document.createElement('div');
      el.className = 'mk ' + w; el.textContent = w === 'o' ? '出' : '着';
      el.setAttribute('role', 'img'); el.setAttribute('aria-label', w === 'o' ? '出発地' : '目的地');
      m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lon, p.lat]).addTo(S.map);
      m.on('dragend', function () {
        var ll = m.getLngLat();
        setPlace(w, { lat: ll.lat, lon: ll.lng, name: '地図上の地点', tag: '地図上の地点' });
        recompute(false);
      });
      S.markers[w] = m;
    } else { m.setLngLat([p.lon, p.lat]); }
  }

  /* ---- 結果 ---- */
  function inWindow(sec) { return sec >= S.ws && sec < S.we; }
  /* 乗る区間ごとの判定を、結論を先に1文で */
  function verdict(l, f) {
    var r = S.data.routes.filter(function (x) { return x.name === l.route; })[0];
    if (!r) return '';
    var th = Math.round(S.share * 100), pc = Math.round(r.share * 100);
    var whole = '系統全体では停留所 ' + r.stops + ' のうち ' + r.tstops + ' が観光地点の近く＝' + pc + '%';
    if (f) return '<span class="verdict warn">判定: 観光客が多い区間（避ける対象）。</span><span class="why">観光系統（' + whole + '、基準 ' + th + '%以上）で、乗る時刻が観光客が多いと仮定した時間帯（' + hh(S.ws / 3600) + '〜' + hh(S.we / 3600) + '）の中、乗る区間が観光地点（' + L.esc(f.spots.join('・')) + '）の近くを通ります。</span>';
    if (r.share < S.share) return '<span class="verdict ok">判定: 避けなくてよい。</span><span class="why">観光系統ではありません（' + whole + '、基準 ' + th + '%未満）。</span>';
    if (!inWindow(l.dep)) return '<span class="verdict ok">判定: 避けなくてよい（この時刻は観光客の影響を見込んでいません）。</span><span class="why">系統としては観光系統（' + whole + '）ですが、乗る時刻 ' + L.fmtClock(l.dep) + ' は観光客が多いと仮定した時間帯（' + hh(S.ws / 3600) + '〜' + hh(S.we / 3600) + '）の外です。</span>';
    return '<span class="verdict ok">判定: 避けなくてよい（乗る区間は観光地から離れています）。</span><span class="why">系統としては観光系統（' + whole + '）ですが、今回乗る区間（' + L.esc(l.fromName) + '→' + L.esc(l.toName) + '）には観光地点に近い停留所がありません。</span>';
  }
  function legHtml(l, ex) {
    if (l.type === 'walk') {
      if (l.sec < 60 && l.m < 60) return '';
      return '<li class="walk">徒歩 約' + L.fmtMin(l.sec) + '（直線 ' + Math.round(l.m) + ' m）' + L.esc(l.fromName) + ' → ' + L.esc(l.toName) + '</li>';
    }
    var f = ex ? ex.filter(function (e) { return e.route === l.route && e.flagged; })[0] : null;
    return '<li class="bus' + (f ? ' flag' : '') + '"><b>' + L.esc(l.route) + '</b> ' + L.fmtClock(l.dep) + ' ' + L.esc(l.fromName) + ' → ' + L.fmtClock(l.arr) + ' ' + L.esc(l.toName) +
      '（' + (l.stops.length - 1) + '区間）<br>' + verdict(l, f) + '</li>';
  }
  function cardHtml(kind, opt, sum, others) {
    var title = kind === 'normal' ? '通常（いちばん早い経路）' : '観光系統を避ける経路';
    var h = '<div class="card ' + kind + '"><h3>' + title + '</h3>';
    if (!opt) {
      return h + '<p class="msg">' + (kind === 'avoid' ? '観光系統を避けて行ける経路（バス・乗換3回まで）が見つかりません。' : '通常の経路が見つかりません。') + '</p></div>';
    }
    h += '<div class="big">' + L.fmtMin(opt.dur) + ' <small>' + L.fmtClock(opt.arrive - opt.dur) + '発 → ' + L.fmtClock(opt.arrive) + '着</small></div>';
    h += '<span class="badge">乗換 ' + sum.transfers + '回</span><span class="badge">徒歩 約' + L.fmtMin(sum.walk) + '</span>';
    h += sum.flaggedRoutes.length ? '<span class="badge warn">観光系統の影響を受けやすい区間あり: ' + L.esc(sum.flaggedRoutes.join('・')) + '</span>'
      : '<span class="badge ok">観光系統の影響を受けやすい区間なし</span>';
    if (kind === 'normal') {
      var buses = opt.legs.filter(function (l) { return l.type !== 'walk'; }).map(function (l) { return l.route; });
      var why = opt.legs.filter(function (l) { return l.type !== 'walk'; }).map(function (l) {
        var r = S.data.routes.filter(function (x) { return x.name === l.route; })[0];
        var f = sum.exposure ? sum.exposure.filter(function (e) { return e.route === l.route && e.flagged; })[0] : null;
        if (!r) return L.esc(l.route);
        if (f) return L.esc(l.route) + '＝観光系統で、時間帯内に観光地点の近くを通る';
        if (r.share < S.share) return L.esc(l.route) + '＝観光系統ではない（観光地点の近くの停留所 ' + Math.round(r.share * 100) + '%）';
        if (!inWindow(l.dep)) return L.esc(l.route) + '＝観光系統だが、乗る時刻が時間帯の外';
        return L.esc(l.route) + '＝観光系統だが、乗る区間が観光地点から離れている';
      });
      h += '<p class="summary-line"><b>この経路に観光客が多い区間: ' + (sum.flaggedRoutes.length ? 'あり（' + L.esc(sum.flaggedRoutes.join('・')) + '）' : 'なし') + '</b>' +
        (why.length ? '。理由: ' + why.join('、') + '。' : '') + '</p>';
    }
    h += '<ul class="legs">' + opt.legs.map(function (l) { return legHtml(l, sum.exposure); }).join('') + '</ul>';
    var near = (others || []).filter(function (o) { return o.opt.dur <= opt.dur + 30 * 60; });
    if (near.length > 1) {
      h += '<ul class="opts">' + near.map(function (o) { return '<li>バスに' + o.opt.rides + '回乗る場合の最短: ' + L.fmtMin(o.opt.dur) + '</li>'; }).join('') + '</ul>';
    }
    return h + '</div>';
  }

  function recompute(fit) {
    if (!S.origin || !S.dest) { $('result-body').innerHTML = '<p class="msg">出発地と目的地を選んでください。</p>'; return; }
    var o = { lat: S.origin.lat, lon: S.origin.lon }, d = { lat: S.dest.lat, lon: S.dest.lon };
    var r = L.compare(S.net, o, d, opts());
    S.last = r;
    var h = '';
    headline(r);
    if (!r.nBest) {
      h = '<p class="msg">この条件では、バスで行ける経路が見つかりませんでした（出発地から600m・目的地から500m以内に停留所が無い、または時間内に便が無い、乗換3回を超える等）。</p>';
      if (r.walkOnly) h += '<p class="msg">徒歩だけなら約' + L.fmtMin(r.walkOnly.sec) + '（直線 ' + Math.round(r.walkOnly.m) + ' m）。</p>';
      $('result-body').innerHTML = h;
      drawRoutes(null, null, fit);
      drawSweep();
      return;
    }
    h += '<div class="cmp">' + cardHtml('normal', r.nBest, r.nSum, r.nOptions) + cardHtml('avoid', r.aBest, r.aSum, r.aOptions) + '</div>';
    var df;
    if (!r.aBest) {
      df = '観光系統を避けては、この目的地に着けません（バスのみ・乗換3回まで）。通常の経路で観光系統の影響を受けやすい区間は上の黄色の行です。';
    } else if (r.sameRoute) {
      df = '<b>差は0分です。</b>通常の経路がすでに、観光客が多い区間を含まないため、避けても同じ経路になります。各系統の下に、避けなくてよい理由を書いています。';
    } else {
      var m = Math.round(r.diffSec / 60);
      df = '観光系統を避けると <b>' + (m > 0 ? '+' + m + '分' : (m === 0 ? '差なし' : m + '分')) + '</b>（通常 ' + L.fmtMin(r.nBest.dur) + ' → 回避 ' + L.fmtMin(r.aBest.dur) + '）。';
    }
    if (r.nBest && !inWindow(r.nBest.arrive - r.nBest.dur) ) df += '<br><b>出発時刻 ' + L.fmtClock(r.nBest.arrive - r.nBest.dur) + ' は、観光客が多いと仮定した時間帯（' + hh(S.ws / 3600) + '〜' + hh(S.we / 3600) + '。終わりの時刻ちょうどは含みません）の外です。</b>この時刻は観光系統も避ける対象にならないため、差が出にくくなります。時間帯は「推定の条件」で変えられます。';
    if (r.walkOnly) df += '<br><span class="note">参考: 徒歩だけなら約' + L.fmtMin(r.walkOnly.sec) + '（直線距離×1.25を毎分80m）。</span>';
    h += '<p class="diff">' + df + '</p>';
    h += '<p class="note">観光系統の影響を受けやすい区間 = 観光系統（停留所の' + Math.round(S.share * 100) + '%以上が観光地点の近く）に、' + hh(S.ws / 3600) + '〜' + hh(S.we / 3600) + 'に乗り、観光地点に近い停留所を通る区間（推定）。</p>';
    $('result-body').innerHTML = h;
    drawRoutes(r.nBest, r.aBest, fit);
    drawSweep();
  }

  function headline(r) {
    var el = $('headline');
    if (!r.nBest) { el.innerHTML = 'バスで行ける経路なし'; return; }
    if (!r.aBest) { el.innerHTML = '通常 <b class="n">' + L.fmtMin(r.nBest.dur) + '</b> ／ 観光系統を避けると<b class="a">行けない</b>'; return; }
    if (r.sameRoute) { el.innerHTML = '通常 <b class="n">' + L.fmtMin(r.nBest.dur) + '</b> ／ 避けても同じ'; return; }
    var m = Math.round(r.diffSec / 60);
    el.innerHTML = '通常 <b class="n">' + L.fmtMin(r.nBest.dur) + '</b> ／ 避ける <b class="a">' + L.fmtMin(r.aBest.dur) + '</b>（' + (m > 0 ? '+' : '') + m + '分）';
  }

  /* ---- 出発時刻ごとの比較 ---- */
  function drawSweep() {
    clearTimeout(S.sweepTimer);
    $('sweep').innerHTML = '<p class="note">計算中…</p>';
    if (!S.origin || !S.dest) { $('sweep').innerHTML = ''; return; }
    S.sweepTimer = setTimeout(function () {
      var hours = [];
      for (var h = 6; h <= 22; h++) hours.push(h);
      var res = L.sweep(S.net, { lat: S.origin.lat, lon: S.origin.lon }, { lat: S.dest.lat, lon: S.dest.lon }, { dt: S.dt, share: S.share, winStart: S.ws, winEnd: S.we }, hours);
      $('sweep').innerHTML = sweepSvg(res) + sweepTable(res);
    }, 30);
  }
  function sweepSvg(res) {
    var W = 440, H = 190, ml = 34, mr = 6, mt = 8, mb = 28;
    var mx = 30;
    res.forEach(function (x) { [x.normal, x.avoid].forEach(function (v) { if (v != null && v / 60 > mx) mx = v / 60; }); });
    mx = Math.min(120, Math.ceil(mx / 10) * 10);   /* 120分より長いものは棒を切って ▲ を付ける */
    var iw = W - ml - mr, ih = H - mt - mb, n = res.length, slot = iw / n;
    var y = function (min) { return mt + ih - (min / mx) * ih; };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="出発時刻ごとの所要時間。通常と、観光系統を避けた場合の比較">';
    var x0 = ml + ((S.ws / 3600 - res[0].hour) / n) * iw, x1 = ml + ((S.we / 3600 - res[0].hour) / n) * iw;
    x0 = Math.max(ml, x0); x1 = Math.min(ml + iw, x1);
    if (x1 > x0) s += '<rect x="' + x0 + '" y="' + mt + '" width="' + (x1 - x0) + '" height="' + ih + '" fill="#E69F00" opacity=".16"></rect>';
    [0, mx / 2, mx].forEach(function (g) {
      s += '<line x1="' + ml + '" x2="' + (ml + iw) + '" y1="' + y(g) + '" y2="' + y(g) + '" stroke="#ddd"></line><text x="' + (ml - 4) + '" y="' + (y(g) + 4) + '" font-size="10" text-anchor="end" fill="#555">' + g + '分</text>';
    });
    res.forEach(function (r, i) {
      var bx = ml + i * slot, bw = slot * 0.4;
      if (r.normal != null) s += '<rect x="' + (bx + slot * 0.07) + '" y="' + y(Math.min(mx, r.normal / 60)) + '" width="' + bw + '" height="' + (mt + ih - y(Math.min(mx, r.normal / 60))) + '" fill="' + C_NORMAL + '"></rect>' + (r.normal / 60 > mx ? '<text x="' + (bx + slot * 0.07 + bw / 2) + '" y="' + (mt + 9) + '" font-size="9" text-anchor="middle" fill="#fff">▲</text>' : '');
      if (r.avoid != null) s += '<rect x="' + (bx + slot * 0.07 + bw) + '" y="' + y(Math.min(mx, r.avoid / 60)) + '" width="' + bw + '" height="' + (mt + ih - y(Math.min(mx, r.avoid / 60))) + '" fill="' + C_AVOID + '"></rect>' + (r.avoid / 60 > mx ? '<text x="' + (bx + slot * 0.07 + bw * 1.5) + '" y="' + (mt + 9) + '" font-size="9" text-anchor="middle" fill="#fff">▲</text>' : '');
      else if (r.normal != null) s += '<text x="' + (bx + slot * 0.07 + bw * 1.5) + '" y="' + (mt + ih - 3) + '" font-size="9" text-anchor="middle" fill="#a8460a">×</text>';
      if (r.hour % 2 === 1 || i === 0) s += '<text x="' + (bx + slot / 2) + '" y="' + (H - 12) + '" font-size="10" text-anchor="middle" fill="#555">' + r.hour + '</text>';
    });
    s += '<text x="' + (ml + iw / 2) + '" y="' + (H - 1) + '" font-size="10" text-anchor="middle" fill="#555">出発時刻（時）</text></svg>';
    s += '<div class="leg"><i style="background:' + C_NORMAL + '"></i>通常<i style="background:' + C_AVOID + '"></i>観光系統を避ける（× は避けて行けない、▲ は120分超）<i style="background:#E69F00;opacity:.4"></i>観光客が多いと仮定した時間帯</div>';
    return s;
  }
  function sweepTable(res) {
    var rows = res.map(function (r) {
      return '<tr><th scope="row">' + r.hour + '時</th><td class="num">' + (r.normal != null ? L.fmtMin(r.normal) : '—') + '</td><td class="num">' +
        (r.avoid != null ? L.fmtMin(r.avoid) : '避けられない') + '</td><td>' + (r.flagged ? '観光系統の影響を受けやすい区間あり' : '') + '</td></tr>';
    }).join('');
    return '<details style="margin-top:6px"><summary>数値で見る</summary><div class="tablewrap"><table><thead><tr><th>出発</th><th class="num">通常</th><th class="num">避ける</th><th>通常経路</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
  }

  /* ---- 一覧（自治体・事業者向け） ---- */
  function initTable() {
    var d = S.data;
    seg($('t-dt'), [['all', '平日・休日'], ['wd', '平日'], ['hol', '休日']], S.tdt, function (v) { S.tdt = v; S.limit = 30; renderTables(); });
    $('t-feed').innerHTML = '<option value="all">すべて</option>' + d.feeds.map(function (f) { return '<option value="' + L.esc(f.key) + '">' + L.esc(f.name) + '</option>'; }).join('');
    var ho = ''; for (var h = 0; h <= 28; h++) ho += '<option value="' + h + '">' + (h >= 24 ? '翌' + (h - 24) : h) + '時</option>';
    $('t-hf').innerHTML = ho; $('t-ht').innerHTML = ho; $('t-hf').value = S.thf; $('t-ht').value = S.tht;
    $('t-feed').addEventListener('change', function () { S.tfeed = this.value; S.limit = 30; renderTables(); });
    $('t-hf').addEventListener('change', function () { S.thf = +this.value; S.limit = 30; renderTables(); });
    $('t-ht').addEventListener('change', function () { S.tht = +this.value; S.limit = 30; renderTables(); });
    $('more').addEventListener('click', function () { S.limit += 30; renderTables(); });
    $('csv-table').addEventListener('click', function () { download('kankou_route_hour.csv', L.tableCsv(S.data, tRows())); });
    $('csv-routes').addEventListener('click', function () { download('kankou_routes.csv', routesCsv()); });
    renderTables();
  }
  function tRows() { return L.tableRows(S.data, { share: S.share, dt: S.tdt, feed: S.tfeed, hourFrom: S.thf, hourTo: S.tht }); }
  function rRows() { return L.routeRows(S.data, { share: S.share, dt: S.tdt === 'hol' ? 'hol' : 'wd' }).filter(function (r) { return S.tfeed === 'all' || r.feed === S.tfeed; }); }
  function routesCsv() {
    var lines = [['系統', '事業者フィード', '停留所数', '観光地点に近い停留所数', '割合(%)', '1日の便数(' + (S.tdt === 'hol' ? '休日' : '平日') + ')', '近くを通る観光地点'].map(L.csvCell).join(',')];
    var feeds = {}; S.data.feeds.forEach(function (f) { feeds[f.key] = f.name; });
    rRows().forEach(function (r) { lines.push([r.name, feeds[r.feed], r.stops, r.tstops, pct(r.share), r.trips, r.spots.join('・')].map(L.csvCell).join(',')); });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }
  function spotList(a) { return a.length > 4 ? a.slice(0, 4).join('・') + ' ほか' + (a.length - 4) + '件' : a.join('・'); }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    var m = $('csv-msg'); if (m) { m.hidden = false; m.textContent = '「' + name + '」を保存しました（ブラウザのダウンロード先に入ります。Excel で開けます）。'; }
  }
  function renderTopRoutes(rows) {
    var by = {}, order = [];
    rows.forEach(function (r) {
      if (!by[r.name]) { by[r.name] = { name: r.name, visits: 0, trips: 0, share: r.share }; order.push(by[r.name]); }
      by[r.name].visits += r.visits; by[r.name].trips += r.trips;
    });
    order.sort(function (a, b) { return b.visits - a.visits; });
    var dt = { all: '平日・休日', wd: '平日', hol: '休日' }[S.tdt];
    $('top-routes').innerHTML = '<h3>この条件で観光客が集中しやすい系統（上位5）</h3><p class="note">' + L.esc(dt) + '・' + S.thf + '時〜' + hourLabel(S.tht) + '。観光地点に近い停留所での停車回数を、時間帯の合計で比べた順（乗客数ではありません）。</p>' +
      (order.length ? '<ol>' + order.slice(0, 5).map(function (r) {
        var info = S.data.routes.filter(function (x) { return x.name === r.name; })[0];
        var spots = info ? (info.spots || []).map(function (i) { return S.data.spots[i] && S.data.spots[i][2]; }).filter(Boolean) : [];
        return '<li><b>' + L.esc(r.name) + '</b> 停車 ' + r.visits + ' 回・便 ' + r.trips + ' 本' + (info ? '（停留所 ' + info.stops + ' のうち観光地点の近く ' + info.tstops + '・' + pct(info.share) + '%）' : '') + (spots.length ? '<br><span class="sub">近くの観光地点: ' + L.esc(spots.join('・')) + '</span>' : '') + '</li>';
      }).join('') + '</ol>' : '<p class="empty">条件に合う系統がありません。</p>');
  }
  function renderTables() {
    var rr = rRows();
    renderTopRoutes(tRows());
    $('routes-table').innerHTML = '<thead><tr><th>系統</th><th class="num">近い停留所<span class="sub">/ 全停留所</span></th><th class="num">割合</th><th class="num">1日の便数</th></tr></thead><tbody>' +
      (rr.length ? rr.slice(0, 40).map(function (r) {
        return '<tr><th scope="row">' + L.esc(r.name) + '<span class="sub">' + L.esc(spotList(r.spots)) + '</span></th><td class="num">' + r.tstops + ' / ' + r.stops + '</td><td class="num">' + pct(r.share) + '%</td><td class="num">' + r.trips + '</td></tr>';
      }).join('') : '<tr><td class="empty" colspan="4">条件に合う系統がありません（基準を下げてください）。</td></tr>') + '</tbody>';
    var rows = tRows();
    var mxv = rows.length ? rows[0].visits : 1;
    $('table-table').innerHTML = '<thead><tr><th>系統</th><th>時間帯</th><th class="num">便数</th><th class="num">停車回数</th></tr></thead><tbody>' +
      (rows.length ? rows.slice(0, S.limit).map(function (r) {
        return '<tr><th scope="row">' + L.esc(r.name) + '<span class="sub">' + L.DT_LABEL[r.dt] + ' ／ 観光地点に近い停留所 ' + pct(r.share) + '%</span></th><td>' + r.hour + '時台</td><td class="num">' + r.trips + '</td><td class="num">' + r.visits +
          '<span class="bar" style="width:' + Math.max(2, Math.round(r.visits / mxv * 100)) + '%"></span></td></tr>';
      }).join('') : '<tr><td class="empty" colspan="4">条件に合う行がありません。</td></tr>') + '</tbody>';
    $('more').hidden = rows.length <= S.limit;
    $('table-count').textContent = rows.length + ' 行中 ' + Math.min(rows.length, S.limit) + ' 行を表示。便数 = その時間帯に観光地点に近い停留所へ停車する便の数、停車回数 = そのような停留所での停車の延べ回数（どちらも時刻表から数えた値）。CSVは条件に合う全行を出力します。';
  }

  /* ---- 出典 ---- */
  function initAbout() {
    var d = S.data, li = [];
    d.feeds.forEach(function (f) {
      li.push('<b>' + L.esc(f.name) + '</b>（' + L.esc(f.operator) + '）時刻表 GTFS: 公共交通オープンデータセンター、<a href="' + L.esc(f.license_url) + '" target="_blank" rel="noopener">' + L.esc(f.license) + '</a>。<a href="' + L.esc(f.page) + '" target="_blank" rel="noopener">カタログ</a>。版 ' + L.esc(f.version) + '、有効期間 ' + L.esc(f.start) + '〜' + L.esc(f.end) + '。「' + L.esc(f.operator) + '・公共交通オープンデータセンター」のデータを、観光地点との近接判定・本数集計・経路計算のために加工しています。');
    });
    li.push('観光地点: 国土数値情報「観光資源データ」P12-14（平成26年度版、国土交通省）。<b>利用条件は「非商用」</b>（データ詳細ページの記載）。複数区にまたがる項目と番地のないイベントを除き、同じ座標の項目はまとめています。「国土数値情報（観光資源データ）（国土交通省）を加工して作成」。');
    li.push('病院・学校・鉄道駅: 国土数値情報 医療機関データ P04-20（病院のみ）・学校データ P29-21（小学校・中学校・中等教育学校・高等学校）・鉄道データ N02-22（駅、令和4年12月31日時点）（国土交通省）を加工して作成。');
    li.push('背景地図: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>（国土地理院）。地図表示ライブラリ: MapLibre GL JS。');
    li.push('データ作成日: ' + L.esc(d.built) + '。時刻表は各フィードの有効期間内の基準日（平日=水曜、休日=日曜）の1日分。');
    li.push('提供元は公共交通オープンデータセンターおよび各事業者。データの正確性・完全性は保証されません。この画面は参加者が作成した試作で、事業者・センターとは関係ありません。');
    $('about-list').innerHTML = li.map(function (x) { return '<li>' + x + '</li>'; }).join('');
    $('map-legend').innerHTML = '<details id="lg"' + (window.innerWidth > 800 ? ' open' : '') + '><summary>凡例</summary><span><i style="background:' + C_NORMAL + '"></i>通常の経路</span><span><i style="background:' + C_AVOID + '"></i>観光系統を避ける経路</span>' +
      '<span><i class="dot" style="background:' + C_SPOT + '"></i>観光地点（国交省 観光資源）</span><span><i class="dot" style="background:#fff;box-shadow:0 0 0 2px ' + C_SPOT + '"></i>観光地点に近い停留所</span><span><i class="dot" style="background:#444"></i>病院・駅・学校</span></details>';
  }

  /* ---- 地図 ---- */
  function fc(features) { return { type: 'FeatureCollection', features: features || [] }; }
  function pt(lat, lon, props) { return { type: 'Feature', properties: props || {}, geometry: { type: 'Point', coordinates: [lon, lat] } }; }
  function initMap() {
    if (typeof maplibregl === 'undefined') {
      $('map').innerHTML = '<p class="note" style="padding:12px">地図の部品（MapLibre GL JS）を読み込めませんでした。経路と表だけをご利用いただけます。</p>';
      return;
    }
    var bb = S.data.region.bbox;
    S.map = new maplibregl.Map({
      container: 'map',
      style: { version: 8, sources: { gsi: { type: 'raster', tileSize: 256, maxzoom: 18,
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル（淡色地図）</a>' } },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }] },
      bounds: [[bb[0], bb[1]], [bb[2], bb[3]]], fitBoundsOptions: { padding: 10 }, attributionControl: { compact: true }
    });
    S.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    S.map.on('load', function () {
      S.ready = true;
      var d = S.data;
      S.map.addSource('fac', { type: 'geojson', data: fc(d.facilities.map(function (f, i) { return pt(f[0], f[1], { i: i, name: f[2], kind: f[3] }); })) });
      S.map.addSource('spots', { type: 'geojson', data: fc(d.spots.map(function (s, i) { return pt(s[0], s[1], { i: i, name: s[2], kind: s[3] }); })) });
      S.map.addSource('tstops', { type: 'geojson', data: fc(Object.keys(d.tstop).map(function (k) { var s = d.stops[+k]; return pt(s[0], s[1], { name: s[2] }); })) });
      S.map.addSource('lines', { type: 'geojson', data: fc([]) });
      S.map.addLayer({ id: 'fac', type: 'circle', source: 'fac', minzoom: 11.5, paint: { 'circle-radius': 3.5, 'circle-color': '#444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      S.map.addLayer({ id: 'tstops', type: 'circle', source: 'tstops', minzoom: 12, paint: { 'circle-radius': 4, 'circle-color': '#fff', 'circle-stroke-color': C_SPOT, 'circle-stroke-width': 2 } });
      S.map.addLayer({ id: 'lines', type: 'line', source: 'lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'walk'], 1], 3, 5], 'line-offset': ['get', 'offset'], 'line-opacity': 0.9 },
        filter: ['==', ['get', 'walk'], 0] });
      S.map.addLayer({ id: 'walks', type: 'line', source: 'lines', paint: { 'line-color': '#666', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] }, filter: ['==', ['get', 'walk'], 1] });
      S.map.addLayer({ id: 'spots', type: 'circle', source: 'spots', paint: { 'circle-radius': 8, 'circle-color': C_SPOT, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9 } });
      ['fac', 'spots', 'tstops'].forEach(function (l) {
        S.map.on('mouseenter', l, function () { if (!S.pick) S.map.getCanvas().style.cursor = 'pointer'; });
        S.map.on('mouseleave', l, function () { if (!S.pick) S.map.getCanvas().style.cursor = ''; });
      });
      S.map.on('click', onMapClick);
      if (S.origin) placeMarker('o', S.origin);
      if (S.dest) placeMarker('d', S.dest);
      if (S.last) drawRoutes(S.last.nBest, S.last.aBest, true);
    });
  }
  function onMapClick(e) {
    var fs = S.map.queryRenderedFeatures(e.point, { layers: ['fac', 'spots', 'tstops'] });
    var f = fs[0];
    if (S.pick) {
      var w = S.pick;
      if (f && f.layer.id === 'fac') {
        var p = f.properties;
        setPlace(w, { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], name: p.name, tag: p.kind });
      } else {
        setPlace(w, { lat: e.lngLat.lat, lon: e.lngLat.lng, name: '地図上の地点', tag: '地図上の地点' });
      }
      setPick(null);
      recompute(true);
      return;
    }
    if (!f) return;
    var pr = f.properties, html;
    if (f.layer.id === 'fac') {
      html = '<b>' + L.esc(pr.name) + '</b><br>' + L.esc(pr.kind) + '<br><button type="button" class="act pop" data-set="d" data-lat="' + f.geometry.coordinates[1] + '" data-lon="' + f.geometry.coordinates[0] + '" data-name="' + L.esc(pr.name) + '" data-tag="' + L.esc(pr.kind) + '">目的地にする</button> ' +
        '<button type="button" class="act pop" data-set="o" data-lat="' + f.geometry.coordinates[1] + '" data-lon="' + f.geometry.coordinates[0] + '" data-name="' + L.esc(pr.name) + '" data-tag="' + L.esc(pr.kind) + '">出発地にする</button>';
    } else if (f.layer.id === 'spots') {
      html = '<b>' + L.esc(pr.name) + '</b><br>観光地点（国交省 観光資源）' + (pr.kind ? '：' + L.esc(pr.kind) : '');
    } else {
      html = '<b>' + L.esc(pr.name) + '</b><br>観光地点から ' + S.data.near_m + ' m 以内のバス停';
    }
    if (S.popup) S.popup.remove();
    S.popup = new maplibregl.Popup({ maxWidth: '260px' }).setLngLat(f.geometry.coordinates).setHTML(html).addTo(S.map);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button.pop');
    if (!b) return;
    setPlace(b.getAttribute('data-set'), { lat: +b.getAttribute('data-lat'), lon: +b.getAttribute('data-lon'), name: b.getAttribute('data-name'), tag: b.getAttribute('data-tag') });
    if (S.popup) S.popup.remove();
    recompute(true);
  });

  function legLines(opt, color, offset) {
    var feats = [];
    opt.legs.forEach(function (l) {
      var coords;
      if (l.type === 'bus') coords = l.stops.map(function (s) { return [S.net.lons[s], S.net.lats[s]]; });
      else coords = [[l.fromLL[1], l.fromLL[0]], [l.toLL[1], l.toLL[0]]];
      feats.push({ type: 'Feature', properties: { color: color, walk: l.type === 'walk' ? 1 : 0, offset: l.type === 'walk' ? 0 : offset }, geometry: { type: 'LineString', coordinates: coords } });
    });
    return feats;
  }
  function drawRoutes(n, a, fit) {
    if (!S.map || !S.ready) return;
    var feats = [], pts = [];
    if (a) feats = feats.concat(legLines(a, C_AVOID, 3));
    if (n) feats = feats.concat(legLines(n, C_NORMAL, -3));
    S.map.getSource('lines').setData(fc(feats));
    if (fit) {
      feats.forEach(function (f) { f.geometry.coordinates.forEach(function (c) { pts.push(c); }); });
      if (S.origin) pts.push([S.origin.lon, S.origin.lat]);
      if (S.dest) pts.push([S.dest.lon, S.dest.lat]);
      if (pts.length) {
        var b = new maplibregl.LngLatBounds(pts[0], pts[0]);
        pts.forEach(function (c) { b.extend(c); });
        S.map.fitBounds(b, { padding: 40, maxZoom: 15, duration: 400 });
      }
    }
  }

  window.KankouApp = { STATE: S, getMap: function () { return S.map; } };   /* 試験・点検用 */
  load();
})();
