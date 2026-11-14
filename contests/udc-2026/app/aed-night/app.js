/* 夜も使えるAED診断マップ: 画面。外部への送信は行わない（地図タイル・data/ の GET のみ）。 */
(function () {
  "use strict";
  var TILE = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
  var ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  /* 「平日」の代表は水曜。月曜は祝日（ハッピーマンデー）と月曜休館が多く、平日で最も条件が悪くなりやすいため使わない。月〜金の幅は見出しに出す */
  var PRESETS = [
    { label: "水曜 午前3時", d: 2, t: 180 }, { label: "水曜 14時", d: 2, t: 840 },
    { label: "水曜 20時", d: 2, t: 1200 }, { label: "土曜 22時", d: 5, t: 1320 }, { label: "日曜 14時", d: 6, t: 840 }
  ];
  var MODES = [{ id: "strict", label: "確認できたAEDだけ" }, { id: "max", label: "不明も使える（最大見積）" }];

  var S = { data: null, bounds: null, mi: 0, cells: [], aeds: [], cov: null, covOther: null, pick: null, view: null, edge: false };
  var map, popup, markers = [], raf = 0;
  /* 画面テスト用の入口（tests/ui_check.mjs） */
  window.App = { ready: false, S: S, getMap: function () { return map; }, showGain: function (lat, lon) { showGain(lat, lon); }, render: function () { render(); },
    set: function (d, t, r, mode) { S.view.d = d; S.view.t = t; if (r) S.view.r = r; if (mode) S.view.mode = mode; render(); }, setMuni: function (id) { setMuni(id, true); } };

  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") e.textContent = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function fmt(n) { return Math.round(n).toLocaleString("ja-JP"); }
  /* 「約」を付ける人数は百人単位に丸める（メッシュ推計に1の位まで出さない） */
  function fmtA(n) { return (n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10).toLocaleString("ja-JP"); }
  function pct(x) { return (x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0) + "%"; }

  function radio(container, items, current, onPick) {
    container.innerHTML = "";
    items.forEach(function (it) {
      var b = el("button", { type: "button", role: "radio", "aria-checked": String(it.id === current), text: it.label });
      b.dataset.id = String(it.id);
      b.addEventListener("click", function () { onPick(it.id); });
      container.appendChild(b);
    });
  }
  function setRadio(container, id) {
    Array.prototype.forEach.call(container.children, function (b) { b.setAttribute("aria-checked", String(b.dataset.id === String(id))); });
  }

  /* ---------- データ ---------- */
  function splitData() {
    var D = S.data;
    S.cellsBy = D.munis.map(function () { return []; });
    S.aedsBy = D.munis.map(function () { return []; });
    D.cells.forEach(function (c) { S.cellsBy[c[0]].push(c); });
    D.aed.forEach(function (a) { if (!a[8]) S.aedsBy[a[0]].push(a); });
  }

  /* ---------- 計算と描画 ---------- */
  function compute() {
    var v = S.view;
    S.cells = S.cellsBy[S.mi]; S.aeds = S.aedsBy[S.mi];
    S.cov = AN.coverage(S.cells, S.aeds, v.d, v.t, v.r, v.mode);
    S.covOther = AN.coverage(S.cells, S.aeds, v.d, v.t, v.r, v.mode === "strict" ? "max" : "strict");
  }

  function cellFeatures() {
    var out = [];
    for (var i = 0; i < S.cells.length; i++) {
      var c = S.cells[i], lat = c[2], lon = c[3];
      var dl = 125 / 110574, dn = 125 / (111320 * Math.cos(lat * Math.PI / 180));
      out.push({ type: "Feature", properties: { g: S.cov.covered[i] ? 0 : 1, pop: c[4], edge: c[5], i: i },
        geometry: { type: "Polygon", coordinates: [[[lon - dn, lat - dl], [lon + dn, lat - dl], [lon + dn, lat + dl], [lon - dn, lat + dl], [lon - dn, lat - dl]]] } });
    }
    return out;
  }
  function aedFeatures() {
    var v = S.view, out = [];
    S.aeds.forEach(function (a, i) {
      var s = a[5] === AN.KNONPUBLIC ? "priv" : a[5] === AN.KUNKNOWN || a[5] === AN.KASSUMED ? "unk" : (AN.isUsable(a, v.d, v.t, "strict") ? "on" : "off");
      out.push({ type: "Feature", properties: { s: s, i: i, use: AN.isUsable(a, v.d, v.t, v.mode) ? 1 : 0 },
        geometry: { type: "Point", coordinates: [a[2], a[1]] } });
    });
    return out;
  }

  function render() {
    compute();
    var v = S.view, mu = S.data.munis[S.mi], cv = S.cov;
    map.getSource("cells").setData({ type: "FeatureCollection", features: cellFeatures() });
    map.getSource("aed").setData({ type: "FeatureCollection", features: aedFeatures() });
    $("tm-out").textContent = AN.hhmm(v.t);
    $("tm").setAttribute("aria-valuetext", AN.whenLabel(v.d, v.t));
    setRadio($("ctl-muni"), mu.id); setRadio($("ctl-day"), v.d); setRadio($("ctl-r"), v.r); setRadio($("ctl-mode"), v.mode);
    $("tm").value = v.t;
    Array.prototype.forEach.call($("presets").children, function (b, i) {
      b.setAttribute("aria-pressed", String(PRESETS[i].d === v.d && PRESETS[i].t === v.t));
    });
    var strict = v.mode === "strict" ? cv : S.covOther, max = v.mode === "strict" ? S.covOther : cv;
    var coreOk = cv.popCore > 0;
    function share(c) { return coreOk ? (c.popCore ? c.popOutCore / c.popCore : 0) : (c.popTotal ? c.popOut / c.popTotal : 0); }
    var kn = mu.kinds;
    var h = $("headline"); h.innerHTML = "";
    /* 見出しの数字は「市境から800m以内を除いた人口」。市境の近くは隣の市のAEDを読み込んでいないため、圏外が多めに出る */
    // 大きな数字の母数（市境から800m以上内側）を数字と同じ行に出す（市全体の割合と取り違えやすかった）
    h.appendChild(el("div", { class: "big", text: "徒歩圏に使えるAEDがない人" + (coreOk ? "（市境から800m以上内側）" : "") + ": 約" + fmtA(coreOk ? cv.popOutCore : cv.popOut) + "人（" + pct(share(cv)) + "）" }));
    $("toggle-sum").textContent = "徒歩圏外 " + pct(share(cv)) + "（" + AN.whenLabel(v.d, v.t) + "）　";
    h.appendChild(el("div", { class: "sub", text: mu.name + "・" + AN.whenLabel(v.d, v.t) + "・徒歩圏 直線" + v.r + "m。対象は市の境界から800m以上内側の人口 " + fmt(coreOk ? cv.popCore : cv.popTotal) +
      "人。この時間に使えると確認できたAEDは " + strict.usable.length + "台（設置場所は" + strict.sites + "か所）。登録 " + mu.with_xy + "台のうち、時間が不明 " + kn.unknown + "台、一般の人が使えない設置位置（救急車内・病室など）" + kn.nonpublic + "台は数えていません。" }));
    h.appendChild(el("div", { class: "rng", text: "確認できたAEDだけなら " + pct(share(strict)) + "、時間が不明のAEDを使えるとしても（夜間は施設の開館時間・条件付きなどを除く）" + pct(share(max)) + "。" }));
    if (coreOk) {
      h.appendChild(el("div", { class: "edge-note", text: "市境付近（800m以内）を含む市全体（メッシュ人口 " + fmt(cv.popTotal) + "人）では約" + fmtA(cv.popOut) + "人（" + pct(cv.popTotal ? cv.popOut / cv.popTotal : 0) +
        "）。隣の市のAEDを読み込んでいないので、これは上限です。" }));
    }
    if (v.d <= 4) {
      var wr = AN.weekdayRange(S.cells, S.aeds, v.t, v.r, v.mode, coreOk);
      var same = pct(wr.min) === pct(wr.max);
      h.appendChild(el("div", { class: "edge-note", text: same ? "同じ時刻で月〜金のどの曜日も " + pct(wr.min) + "。祝日は反映していません。" :
        "同じ時刻で月〜金を比べると " + pct(wr.min) + "（" + AN.DAYS[wr.minDay] + "曜）〜" + pct(wr.max) + "（" + AN.DAYS[wr.maxDay] + "曜）。祝日は反映していません。" }));
    }
    renderLegend();
    renderAreas();
    if (!$("pane-out").hidden) renderOut();
    $("out-when").textContent = AN.whenLabel(v.d, v.t); $("out-r").textContent = v.r;
    if (S.pick) showGain(S.pick.lat, S.pick.lon);
    history.replaceState(null, "", AN.formatHash({ m: mu.id, d: v.d, t: v.t, r: v.r, mode: v.mode }));
  }
  function schedule() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; render(); }); }

  function renderLegend() {
    var L = $("legend"); L.innerHTML = "";
    function item(cls, style, text) { var s = el("span"); var sw = el("span", { class: "sw " + cls, style: style }); s.appendChild(sw); s.appendChild(document.createTextNode(text)); L.appendChild(s); }
    item("", "background:rgba(213,94,0,.55);border-color:#d55e00", "圏外（人口が多いほど濃い）");
    item("", "background:rgba(0,114,178,.18);border-color:#0072b2", "圏内");
    /* 点は色だけに頼らず、大きさ・形・明るさで区別する: 大きい濃い縁の丸＝使える／小さい白丸＝いまは使えない／明るい菱形＝不明／小さい灰色の四角＝数えない */
    item("dot big", "background:#009E73;border-color:#00261b", "いま使えるAED（大きい丸）");
    item("dot", "background:#fff;border-color:#555", "いまは使えないAED（小さい白丸）");
    item("dia", "background:#f6d9e8;border-color:#6a2c52", "時間が不明のAED（菱形）");
    item("sq", "background:#8a8a8a;border-color:#fff;box-shadow:0 0 0 1px #333", "一般の人が使えない位置のAED（小さい四角。数えない）");
    item("", "background:#fff;border:2px dashed #333", "境界付近（隣の市のAEDは未読込）");
  }

  function renderAreas() {
    var rows = AN.areaTable(S.cells, S.cov.covered, S.data.areas, S.edge).filter(function (r) { return r.out > 0; });
    var mu = S.data.munis[S.mi];
    $("area-head").textContent = mu.name + "、" + AN.whenLabel(S.view.d, S.view.t) + "、徒歩圏 直線" + S.view.r + "m。圏外の人口が多い地区（上位30）。地区をタップすると地図が移動します。";
    var ol = $("area-list"); ol.innerHTML = "";
    var max = rows.length ? rows[0].out : 1;
    rows.slice(0, 30).forEach(function (r) {
      var b = el("button", { type: "button" });
      b.appendChild(el("b", { text: r.name }));
      b.appendChild(document.createTextNode("　圏外 " + fmt(r.out) + "人 / 地区の人口 " + fmt(r.pop) + "人（" + pct(r.share) + "）"));
      if (r.edge) { b.appendChild(el("span", { class: "edge", text: "　※境界付近を含む" })); }
      var bar = el("span", { class: "bar" }); bar.appendChild(el("i", { style: "width:" + Math.max(2, Math.round(100 * r.out / max)) + "%" })); b.appendChild(bar);
      b.addEventListener("click", function () { map.flyTo({ center: [r.lon, r.lat], zoom: 15 }); if (window.matchMedia("(max-width:720px)").matches) setPanel(false); });
      ol.appendChild(el("li", {}, [b]));
    });
    if (!rows.length) ol.appendChild(el("li", { class: "note", text: "この条件では、徒歩圏に使えるAEDがない地区はありません。" }));
  }

  function clearMarkers() { markers.forEach(function (m) { m.remove(); }); markers = []; }
  function renderOut() {
    var cands = AN.topCandidates(S.cells, S.cov.covered, S.view.r, 10);
    S.cands = cands;
    clearMarkers();
    var ol = $("cand-list"); ol.innerHTML = "";
    cands.forEach(function (c) {
      var name = S.data.areas[c.area];
      var b = el("button", { type: "button" });
      b.appendChild(el("b", { text: c.rank + ". " + name + "付近" }));
      b.appendChild(document.createTextNode("　新たに徒歩圏に入る人 約" + fmtA(c.pop) + "人"));
      if (c.edge) b.appendChild(el("span", { class: "edge", text: "　※境界付近" }));
      b.addEventListener("click", function () { map.flyTo({ center: [c.lon, c.lat], zoom: 15.5 }); });
      ol.appendChild(el("li", {}, [b]));
      var e = el("div", { class: "cand-mark", text: String(c.rank), style: "background:#7a003c;color:#fff;border:2px solid #fff;border-radius:50%;width:24px;height:24px;line-height:20px;text-align:center;font-size:12px;font-weight:bold" });
      markers.push(new maplibregl.Marker({ element: e }).setLngLat([c.lon, c.lat]).addTo(map));
    });
    if (!cands.length) ol.appendChild(el("li", { class: "note", text: "この条件では候補はありません（徒歩圏外の人口がありません）。" }));
  }

  function showGain(lat, lon, tapped) {
    S.pick = { lat: lat, lon: lon };
    var g = AN.gainAt(S.cells, S.cov.covered, lat, lon, S.view.r);
    var near = null;
    S.cov.usable.forEach(function (a) { var d = AN.haversine(lat, lon, a[1], a[2]); if (near === null || d < near) near = d; });
    var card = $("gain-card"); card.innerHTML = "";
    card.appendChild(el("div", {}, [el("b", { text: "ここに24時間使えるAEDを1台置くと、新たに徒歩圏（直線" + S.view.r + "m）に入る人: 約" + fmtA(g.pop) + "人" })]));
    card.appendChild(el("div", { class: "small", text: "いま（" + AN.whenLabel(S.view.d, S.view.t) + "）、この地点から最も近い使えるAEDまで" +
      (near === null ? "（使えるAEDが登録にありません）" : "直線 約" + fmt(near) + "m") + "。人口は250mメッシュの合計で、置ける場所かどうかは考慮していません。" }));
    if (tapped && popup) {
      /* スマホではパネルの結果カードが画面の外になりやすいので、タップした地点の上にも結果を出す */
      var pb = el("div", {}, [el("b", { text: "ここに24時間使えるAEDを1台置くと、新たに徒歩圏に入る人: 約" + fmtA(g.pop) + "人" }),
        el("div", { class: "small", text: near === null ? "いま使えるAEDは登録にありません。" : "いま最も近い使えるAEDまで直線 約" + fmt(near) + "m。" })]);
      popup.setLngLat([lon, lat]).setDOMContent(pb).addTo(map);
    }
    var m = map.getSource("pick");
    if (m) m.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }] });
  }

  /* ---------- CSV ---------- */
  function download(name, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function stamp() { var v = S.view, mu = S.data.munis[S.mi]; return mu.id + "_" + "月火水木金土日".charAt(v.d) + AN.hhmm(v.t).replace(":", "") + "_r" + v.r + "_" + v.mode; }
  function note() { return "公開データ上の試算。民間の24時間AED等は含まない。直線距離・250mメッシュ中心で判定。"; }
  function csvCand() {
    var v = S.view, mu = S.data.munis[S.mi];
    var rows = (S.cands || []).map(function (c) {
      return [mu.name, AN.whenLabel(v.d, v.t), v.r, v.mode === "strict" ? "確認できたAEDのみ" : "不明も使える", c.rank, S.data.areas[c.area], c.lat, c.lon, c.pop, c.edge ? "境界付近" : "", note()];
    });
    download("aed_candidates_" + stamp() + ".csv", AN.toCSV(["自治体", "曜日時刻", "徒歩圏m(直線)", "不明の扱い", "順位", "地区(目安)", "緯度", "経度", "新たに圏内に入る人口", "備考", "注意"], rows));
    $("io-msg").textContent = "設置先候補 " + rows.length + " 件を書き出しました。";
  }
  function csvArea() {
    var v = S.view, mu = S.data.munis[S.mi];
    var rows = AN.areaTable(S.cells, S.cov.covered, S.data.areas, S.edge).map(function (r) {
      return [mu.name, AN.whenLabel(v.d, v.t), v.r, v.mode === "strict" ? "確認できたAEDのみ" : "不明も使える", r.name, r.pop, r.out, r.pop ? (r.out / r.pop).toFixed(3) : "", r.edge ? "境界付近を含む" : "", r.lat.toFixed(5), r.lon.toFixed(5), note()];
    });
    download("aed_areas_" + stamp() + ".csv", AN.toCSV(["自治体", "曜日時刻", "徒歩圏m(直線)", "不明の扱い", "地区(目安)", "地区の人口", "圏外の人口", "圏外の割合", "備考", "重心緯度", "重心経度", "注意"], rows));
    $("io-msg").textContent = "地区別 " + rows.length + " 地区を書き出しました。";
  }
  function csvAll() {
    $("io-msg").textContent = "作成中…";
    setTimeout(function () {
      var v = S.view, rows = [];
      S.data.munis.forEach(function (mu, mi) {
        for (var d = 0; d < 7; d++) {
          for (var t = 0; t < 1440; t += 180) {
            var a = AN.coverage(S.cellsBy[mi], S.aedsBy[mi], d, t, v.r, "strict");
            var b = AN.coverage(S.cellsBy[mi], S.aedsBy[mi], d, t, v.r, "max");
            rows.push([mu.name, AN.DAYS[d] + "曜", AN.hhmm(t), v.r, a.usable.length, a.sites, a.popOut, a.popTotal ? (a.popOut / a.popTotal).toFixed(3) : "", b.usable.length, b.popOut, b.popTotal ? (b.popOut / b.popTotal).toFixed(3) : ""]);
          }
        }
      });
      download("aed_all_times_r" + v.r + ".csv", AN.toCSV(["自治体", "曜日", "時刻", "徒歩圏m(直線)", "確認できた使えるAED数", "同・設置か所数", "圏外人口(確認できたAEDのみ)", "圏外割合(確認できたAEDのみ)", "不明も使えるとした時のAED数", "圏外人口(最大見積)", "圏外割合(最大見積)"], rows));
      $("io-msg").textContent = "全時間帯の表 " + rows.length + " 行を書き出しました（公開データ上の試算）。";
    }, 30);
  }

  /* ---------- データタブ・出典 ---------- */
  function renderData() {
    var D = S.data, t = el("table", { class: "data" });
    var head = el("tr"); ["自治体", "登録数", "24時間", "時間指定", "不明", "一般不可", "読めた割合"].forEach(function (h) { head.appendChild(el("th", { text: h })); });
    t.appendChild(head);
    D.munis.forEach(function (m) {
      var r = el("tr");
      [m.name, m.rows, m.kinds["24h"], m.kinds.timed, m.kinds.unknown, m.kinds.nonpublic, pct(AN.readableShare(m.kinds))].forEach(function (x) { r.appendChild(el("td", { text: String(x) })); });
      t.appendChild(r);
    });
    var box = $("data-table"); box.innerHTML = ""; box.appendChild(t);
    D.munis.forEach(function (m) {
      var rs = Object.keys(m.unknown_reasons).map(function (k) { return (AN.REASON_LABEL[k] || k) + " " + m.unknown_reasons[k]; }).join("、");
      var nt = m.notes || {};
      box.appendChild(el("p", { class: "small", text: m.name + ": 緯度経度のある " + m.with_xy + "台のうち、一般の人が使えない設置位置 " + m.kinds.nonpublic + "台は数えず、不明 " + m.kinds.unknown + "台の内訳は " + (rs || "なし") +
        (nt.applied ? "。特記事項を曜日・時間に反映したもの " + nt.applied + "台（祝日・年末年始・第N週・季節限定は未反映）" : "") +
        (m.out_of_range ? "。座標が市の範囲外のもの " + m.out_of_range + "台は地図・判定から除きました（元データの座標誤りの疑い）" : "") + "。曜日が空欄で時刻だけのものを毎日と仮定すれば、不明は " + m.kinds_if_everyday.unknown + "台に減ります（既定では仮定しません）。" }));
    });
    var c = $("credits"); c.innerHTML = "";
    D.munis.forEach(function (m) {
      var li = el("li"); li.appendChild(document.createTextNode(m.credit + "。ライセンス: " + m.license + "。 "));
      li.appendChild(el("a", { href: m.landing, target: "_blank", rel: "noopener", text: "配布ページ" }));
      c.appendChild(li);
    });
  }

  /* ---------- 画面 ---------- */
  function setPanel(open) {
    $("panel").classList.toggle("closed", !open);
    $("sheet-toggle").setAttribute("aria-expanded", String(open));
    $("toggle-act").textContent = open ? "パネルを閉じる ▼" : "パネルを開く ▲";
  }
  function selectTab(id) {
    ["map", "area", "out", "data"].forEach(function (k) {
      $("tab-" + k).setAttribute("aria-selected", String(k === id));
      $("pane-" + k).hidden = k !== id;
    });
    if (id === "out") renderOut(); else clearMarkers();
  }
  function fitMuni() {
    var b = S.data.munis[S.mi].bbox;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: window.matchMedia("(max-width:720px)").matches ? { top: 20, left: 20, right: 20, bottom: window.innerHeight * 0.55 } : { top: 30, bottom: 30, right: 30, left: 440 }, duration: 600 });
  }
  function setMuni(id, fit) {
    var i = S.data.munis.map(function (m) { return m.id; }).indexOf(id);
    if (i < 0) return;
    S.mi = i; S.view.m = id; S.pick = null;
    map.getSource("pick").setData({ type: "FeatureCollection", features: [] });
    $("gain-card").innerHTML = "地図の<b>空いているところをタップ</b>すると、「ここに24時間使えるAEDを1台置くと、徒歩圏に入る人が何人増えるか」を出します。";
    map.setFilter("boundary", ["==", ["get", "id"], id]);
    if (fit) fitMuni();
    render();
  }

  function initUI() {
    var D = S.data;
    radio($("ctl-muni"), D.munis.map(function (m) { return { id: m.id, label: m.name }; }), S.view.m, function (id) { setMuni(id, true); });
    radio($("ctl-day"), AN.DAYS.map(function (d, i) { return { id: i, label: d }; }), S.view.d, function (i) { S.view.d = i; schedule(); });
    radio($("ctl-r"), AN.RADII.map(function (r) { return { id: r, label: r + "m" }; }), S.view.r, function (r) { S.view.r = r; schedule(); });
    radio($("ctl-mode"), MODES, S.view.mode, function (m) { S.view.mode = m; schedule(); });
    var pc = $("presets");
    PRESETS.forEach(function (p) {
      var b = el("button", { type: "button", text: p.label, "aria-pressed": "false" });
      b.addEventListener("click", function () { S.view.d = p.d; S.view.t = p.t; schedule(); });
      pc.appendChild(b);
    });
    $("tm").addEventListener("input", function (e) { S.view.t = +e.target.value; schedule(); });
    ["map", "area", "out", "data"].forEach(function (k) { $("tab-" + k).addEventListener("click", function () { selectTab(k); }); });
    $("sheet-toggle").addEventListener("click", function () { setPanel($("panel").classList.contains("closed")); });
    $("chk-edge").addEventListener("change", function (e) { S.edge = e.target.checked; renderAreas(); });
    $("btn-csv-cand").addEventListener("click", csvCand);
    $("btn-csv-area").addEventListener("click", csvArea);
    $("btn-csv-all").addEventListener("click", csvAll);
    $("copy-link").addEventListener("click", function () {
      var url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { $("copy-msg").textContent = "コピーしました"; }, function () { $("copy-msg").textContent = "コピーできませんでした。アドレスバーのURLを使ってください。"; });
    });
    renderData();
  }

  /* 地図に載せる点の絵（菱形・四角）。濃い縁取りで、背景が明るくても暗くても見える */
  function addIcon(name, shape, fill, stroke, px) {
    var c = document.createElement("canvas"), r = 2; c.width = c.height = px * r;
    var g = c.getContext("2d"), m = c.width / 2, k = c.width * 0.36;
    g.lineWidth = 2.5 * r; g.fillStyle = fill; g.strokeStyle = stroke; g.beginPath();
    if (shape === "diamond") { g.moveTo(m, m - k); g.lineTo(m + k, m); g.lineTo(m, m + k); g.lineTo(m - k, m); g.closePath(); }
    else { g.rect(m - k * 0.8, m - k * 0.8, k * 1.6, k * 1.6); }
    g.fill(); g.stroke();
    map.addImage(name, g.getImageData(0, 0, c.width, c.height), { pixelRatio: r });
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map", center: [139.45, 35.55], zoom: 11, attributionControl: { compact: true },
      style: { version: 8, sources: { base: { type: "raster", tiles: [TILE], tileSize: 256, minzoom: 5, maxzoom: 18, attribution: ATTR } },
        layers: [{ id: "base", type: "raster", source: "base" }] }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", function () {
      map.addSource("cells", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("aed", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("pick", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("bound", { type: "geojson", data: S.bounds });
      map.addLayer({ id: "cells-fill", type: "fill", source: "cells", paint: {
        "fill-color": ["case", ["==", ["get", "g"], 1], "#d55e00", "#0072b2"],
        "fill-opacity": ["case", ["==", ["get", "g"], 1], ["interpolate", ["linear"], ["get", "pop"], 1, 0.3, 300, 0.6, 1500, 0.8], 0.14] } });
      map.addLayer({ id: "cells-edge", type: "line", source: "cells", filter: ["==", ["get", "edge"], 1], paint: { "line-color": "#333", "line-width": 1, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "boundary", type: "line", source: "bound", filter: ["==", ["get", "id"], S.view.m], paint: { "line-color": "#111", "line-width": 2 } });
      /* 点の見分け方（色覚の違いでも分かるように、明るさ・大きさ・形を変える）。丸は使える／使えない、菱形は不明、四角は一般の人が使えない位置 */
      addIcon("aed-unk", "diamond", "#f6d9e8", "#6a2c52", 22);
      addIcon("aed-priv", "square", "#8a8a8a", "#ffffff", 14);
      map.addLayer({ id: "aed", type: "circle", source: "aed", filter: ["match", ["get", "s"], ["on", "off"], true, false], paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "s"], "on", 5, 3], 15, ["match", ["get", "s"], "on", 11, 7]],
        "circle-color": ["match", ["get", "s"], "on", "#009E73", "#ffffff"],
        "circle-stroke-color": ["match", ["get", "s"], "on", "#00261b", "#555555"],
        "circle-stroke-width": ["match", ["get", "s"], "on", 2.5, 1.5] } });
      map.addLayer({ id: "aed-sym", type: "symbol", source: "aed", filter: ["match", ["get", "s"], ["unk", "priv"], true, false], layout: {
        "icon-image": ["match", ["get", "s"], "unk", "aed-unk", "aed-priv"], "icon-allow-overlap": true, "icon-ignore-placement": true,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "s"], "unk", 0.55, 0.5], 15, ["match", ["get", "s"], "unk", 1, 0.8]] } }, "aed");
      map.addLayer({ id: "pick", type: "circle", source: "pick", paint: { "circle-radius": 9, "circle-color": "#7a003c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: "260px" });
      map.on("click", function (e) {
        var f = map.queryRenderedFeatures(e.point, { layers: ["aed", "aed-sym"] })[0];
        if (f) {
          var a = S.aeds[f.properties.i], v = S.view;
          var now = a[5] === AN.KNONPUBLIC ? "一般の人は使えない位置（数えていません）" : a[5] === AN.KUNKNOWN || a[5] === AN.KASSUMED ? "時間が不明" : (AN.isUsable(a, v.d, v.t, "strict") ? "いま（" + AN.whenLabel(v.d, v.t) + "）使える" : "いま（" + AN.whenLabel(v.d, v.t) + "）は使えない");
          var box = el("div", {}, [el("b", { text: a[3] }), el("div", { text: a[4] ? "設置位置: " + a[4] : "" }), el("div", { text: "利用可能: " + AN.windowsText(a) }),
            el("div", { text: now }), el("div", { class: "small", text: a[7] === 2 ? "※自治体の特記事項を曜日・時間に反映済み。祝日・年末年始・第N週・季節限定は未反映。" : a[7] ? "※自治体の特記事項あり。曜日・時間には反映していません（祝日・年末年始など）。" : "" })]);
          popup.setLngLat(f.geometry.coordinates).setDOMContent(box).addTo(map);
          return;
        }
        showGain(e.lngLat.lat, e.lngLat.lng, true);
      });
      ["aed", "aed-sym"].forEach(function (l) {
        map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
      });
      setMuni(S.view.m, true);
      window.App.ready = true;
    });
  }

  function start() {
    Promise.all([fetch("data/aed.json").then(function (r) { return r.json(); }), fetch("data/boundaries.geojson").then(function (r) { return r.json(); })]).then(function (res) {
      S.data = res[0]; S.bounds = res[1];
      splitData();
      S.view = AN.parseHash(location.hash, S.data.munis.map(function (m) { return m.id; }));
      S.mi = Math.max(0, S.data.munis.map(function (m) { return m.id; }).indexOf(S.view.m));
      initUI();
      initMap();
    }).catch(function (e) {
      $("headline").textContent = "データを読み込めませんでした。python3 -m http.server で配信して開いてください。（" + e + "）";
    });
  }
  start();
})();
