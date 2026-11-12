/* みんなの盛土ウォッチ: 画面。外部への送信は行わない（地図タイルと盛土データの GET のみ）。 */
(function () {
  "use strict";
  var KEY = "mw.records.v1";
  var DEF = { z: 13.5, lat: 35.1, lng: 139.07, base: "std", old: "none", op: 60 };
  var TILE = "https://cyberjapandata.gsi.go.jp/xyz/";
  var ATTR = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>';
  var KIND_COLOR = { "谷埋め型": "#D55E00", "腹付け型": "#56B4E9", "区分なし": "#999999" };
  var JUMPS = [{ label: "熱海市", lng: 139.073, lat: 35.1, z: 13 }, { label: "伊東市", lng: 139.1, lat: 34.96, z: 11.5 }];

  var S = { fills: [], records: [], pick: null, selected: null, view: MW.parseHash(location.hash, DEF) };
  var map, popup;

  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) { if (k === "text") e.textContent = props[k]; else e.setAttribute(k, props[k]); });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  /* ---------- 保存 ---------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? MW.fromGeoJSON(MW.toGeoJSON(arr)).records : [];
    } catch (e) { return []; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S.records)); return true; }
    catch (e) { $("io-msg").textContent = "この端末のブラウザに保存できませんでした（プライベートモード等）。GeoJSONで書き出してください。"; return false; }
  }

  /* ---------- 地図 ---------- */
  function rasterSource(path, ext, minz, maxz) {
    return { type: "raster", tiles: [TILE + path + "/{z}/{x}/{y}." + ext], tileSize: 256, minzoom: minz, maxzoom: maxz, attribution: ATTR };
  }
  function style() {
    return {
      version: 8,
      sources: {
        std: rasterSource("std", "png", 5, 18),
        pale: rasterSource("pale", "png", 5, 18),
        photo: rasterSource("seamlessphoto", "jpg", 5, 18),
        ort_old10: rasterSource("ort_old10", "png", 10, 17),
        gazo1: rasterSource("gazo1", "jpg", 10, 17)
      },
      layers: [
        { id: "std", type: "raster", source: "std", layout: { visibility: "none" } },
        { id: "pale", type: "raster", source: "pale", layout: { visibility: "none" } },
        { id: "photo", type: "raster", source: "photo", layout: { visibility: "none" } },
        { id: "ort_old10", type: "raster", source: "ort_old10", layout: { visibility: "none" }, paint: { "raster-opacity": 0.6 } },
        { id: "gazo1", type: "raster", source: "gazo1", layout: { visibility: "none" }, paint: { "raster-opacity": 0.6 } }
      ]
    };
  }

  function radio(container, items, current, onPick) {
    container.innerHTML = "";
    items.forEach(function (it) {
      var b = el("button", { type: "button", role: "radio", "aria-checked": String(it.id === current), text: it.label });
      b.dataset.id = it.id;
      b.addEventListener("click", function () { onPick(it.id); });
      container.appendChild(b);
    });
  }
  function setRadio(container, id) {
    Array.prototype.forEach.call(container.children, function (b) { b.setAttribute("aria-checked", String(b.dataset.id === id)); });
  }

  function applyLayers() {
    var v = S.view;
    ["std", "pale", "photo"].forEach(function (id) { map.setLayoutProperty(id, "visibility", id === v.base ? "visible" : "none"); });
    ["ort_old10", "gazo1"].forEach(function (id) {
      map.setLayoutProperty(id, "visibility", id === v.old ? "visible" : "none");
      map.setPaintProperty(id, "raster-opacity", v.op / 100);
    });
    setRadio($("ctl-base"), v.base); setRadio($("ctl-old"), v.old);
    $("op").value = v.op; $("row-op").style.opacity = v.old === "none" ? 0.5 : 1;
    $("op").disabled = v.old === "none";
  }

  function writeHash() {
    var c = map.getCenter();
    S.view.z = map.getZoom(); S.view.lat = c.lat; S.view.lng = c.lng;
    history.replaceState(null, "", MW.formatHash(S.view));
  }

  function recordsFC() {
    var fc = MW.toGeoJSON(S.records);
    fc.features.forEach(function (f) { f.properties.sel = f.properties.id === S.selected ? 1 : 0; });
    return fc;
  }
  function refreshRecords() {
    if (map.getSource("records")) map.getSource("records").setData(recordsFC());
    if (map.getSource("pick")) {
      map.getSource("pick").setData({ type: "FeatureCollection", features: S.pick ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [S.pick.lng, S.pick.lat] } }] : [] });
    }
  }

  function initMap() {
    map = new maplibregl.Map({
      container: "map", style: style(), center: [S.view.lng, S.view.lat], zoom: S.view.z, maxZoom: 18, minZoom: 6,
      hash: false, attributionControl: { compact: true }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("load", function () {
      applyLayers();
      map.addSource("fills", { type: "geojson", data: { type: "FeatureCollection", features: S.fills }, promoteId: "id" });
      var colorExpr = ["match", ["get", "kind"], "谷埋め型", KIND_COLOR["谷埋め型"], "腹付け型", KIND_COLOR["腹付け型"], KIND_COLOR["区分なし"]];
      map.addLayer({ id: "fills-fill", type: "fill", source: "fills", paint: { "fill-color": colorExpr, "fill-opacity": 0.45 } });
      map.addLayer({ id: "fills-line", type: "line", source: "fills", paint: { "line-color": colorExpr, "line-width": 2.5 } });
      map.addLayer({ id: "fills-line-in", type: "line", source: "fills", paint: { "line-color": "#222", "line-width": 1, "line-dasharray": [2, 2] } });
      map.addSource("records", { type: "geojson", data: recordsFC() });
      map.addLayer({ id: "rec-halo", type: "circle", source: "records", paint: { "circle-radius": ["case", ["==", ["get", "sel"], 1], 15, 11], "circle-color": "#fff" } });
      map.addLayer({ id: "rec", type: "circle", source: "records", paint: { "circle-radius": ["case", ["==", ["get", "sel"], 1], 11, 8], "circle-color": "#F0E442", "circle-stroke-color": "#000", "circle-stroke-width": 3 } });
      map.addSource("pick", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "pick", type: "circle", source: "pick", paint: { "circle-radius": 9, "circle-color": "#CC79A7", "circle-stroke-color": "#fff", "circle-stroke-width": 3 } });
      window.App.ready = true;
    });
    map.on("moveend", writeHash);
    window.addEventListener("hashchange", function () {
      S.view = MW.parseHash(location.hash, DEF);
      applyLayers();
      map.jumpTo({ center: [S.view.lng, S.view.lat], zoom: S.view.z });
    });
    map.on("click", onMapClick);
    ["fills-fill", "rec"].forEach(function (l) {
      map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
    });
  }

  /* ---------- 盛土情報 ---------- */
  function showFill(p) {
    var box = $("fill-info");
    box.innerHTML = "";
    box.appendChild(el("b", { text: p.id + "（" + p.city + "）" }));
    box.appendChild(el("div", { text: "盛土区分: " + p.kind }));
    box.appendChild(el("div", { text: p.kind === "谷埋め型" ? "谷や沢を埋めた盛土造成地（概ねの範囲）" : p.kind === "腹付け型" ? "傾斜地盤の上に盛土した造成地（概ねの範囲）" : "区分は整備されていません" }));
    box.appendChild(el("div", { class: "small", text: "範囲は「概ね」の位置です。直ちに危険という意味ではなく、安全性の確認が必要な場所を示します。最新の状況は市の窓口で確認してください。" }));
  }

  function onMapClick(e) {
    var recHit = map.queryRenderedFeatures(e.point, { layers: ["rec"] })[0];
    if (recHit) { selectRecord(recHit.properties.id, true); return; }
    var fillHit = map.queryRenderedFeatures(e.point, { layers: ["fills-fill"] })[0];
    if (fillHit) showFill(fillHit.properties);
    if (isTab("rec")) setPick(e.lngLat.lng, e.lngLat.lat);
    else if (!fillHit) { /* 何もしない */ }
  }

  /* ---------- 記録 ---------- */
  function setPick(lng, lat) {
    S.pick = { lng: lng, lat: lat };
    var nf = MW.nearestFill(lng, lat, S.fills);
    S.pick.nearFill = nf;
    $("pick-pos").textContent = lat.toFixed(5) + ", " + lng.toFixed(5);
    var hint = MW.inCoverage(lng, lat) ? MW.distText(nf) + "。" : "この位置は対象範囲（熱海市・伊東市）の外です。記録はできますが、盛土造成地データとの比較はできません。";
    $("pick-hint").textContent = hint;
    $("btn-save").disabled = false;
    refreshRecords();
  }

  function saveRecord(ev) {
    ev.preventDefault();
    if (!S.pick) return;
    var when = $("f-when").value ? $("f-when").value.replace("T", " ") : MW.fmtDate(new Date());
    var rec = MW.makeRecord({
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      lng: S.pick.lng, lat: S.pick.lat, kind: $("f-kind").value, memo: $("f-memo").value,
      observedAt: when, blurred: $("f-blur").checked, nearFill: S.pick.nearFill
    });
    if (rec.blurred) rec.nearFill = MW.nearestFill(rec.lng, rec.lat, S.fills);
    S.records.push(rec);
    save();
    S.pick = null; $("pick-pos").textContent = "未選択"; $("pick-hint").textContent = "記録しました。「3 届ける」で通報文のたたき台を作れます。";
    $("btn-save").disabled = true; $("f-memo").value = "";
    renderList(); refreshRecords();
  }

  function selectRecord(id, openTab) {
    S.selected = id;
    var r = S.records.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    if (openTab) switchTab("out");
    $("report-box").hidden = false;
    $("report-text").value = MW.reportText(r);
    renderList(); refreshRecords();
    map.easeTo({ center: [r.lng, r.lat], duration: 400 });
  }

  function renderList() {
    var ul = $("rec-list");
    ul.innerHTML = "";
    $("rec-count").textContent = String(S.records.length);
    if (!S.records.length) ul.appendChild(el("li", { text: "まだ記録がありません。「2 記録する」から追加できます。" }));
    S.records.forEach(function (r) {
      var li = el("li", {});
      if (r.id === S.selected) li.style.borderColor = "#0072b2";
      li.appendChild(el("b", { text: MW.KIND_LABEL[r.kind] }));
      li.appendChild(el("div", { text: r.observedAt + (r.blurred ? "（位置ぼかし）" : "") }));
      li.appendChild(el("div", { text: MW.distText(r.nearFill) }));
      if (r.outOfCoverage) li.appendChild(el("div", { class: "small", text: "※対象範囲外の位置" }));
      if (r.memo) li.appendChild(el("div", { class: "small", text: r.memo }));
      var acts = el("div", { class: "acts" });
      var b1 = el("button", { type: "button", text: "通報文を作る" });
      b1.addEventListener("click", function () { selectRecord(r.id, false); });
      var b2 = el("button", { type: "button", text: "削除" });
      b2.addEventListener("click", function () {
        S.records = S.records.filter(function (x) { return x.id !== r.id; });
        if (S.selected === r.id) { S.selected = null; $("report-box").hidden = true; }
        save(); renderList(); refreshRecords();
      });
      acts.appendChild(b1); acts.appendChild(b2); li.appendChild(acts);
      ul.appendChild(li);
    });
  }

  function download(name, text, mime) {
    var url = URL.createObjectURL(new Blob([text], { type: mime }));
    var a = el("a", { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function stamp() { return MW.fmtDate(new Date()).replace(/[- :]/g, "").slice(0, 12); }

  function copyText(text, msgEl) {
    function done(ok) { msgEl.textContent = ok ? "コピーしました" : "コピーできませんでした。手動で選択してください"; setTimeout(function () { msgEl.textContent = ""; }, 3000); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  }

  /* ---------- タブ ---------- */
  function isTab(n) { return $("tab-" + n).getAttribute("aria-selected") === "true"; }
  function switchTab(n) {
    ["look", "rec", "out"].forEach(function (k) {
      $("tab-" + k).setAttribute("aria-selected", String(k === n));
      $("pane-" + k).hidden = k !== n;
    });
    map.getCanvas().style.cursor = n === "rec" ? "crosshair" : "";
    if (n !== "rec" && S.pick) { S.pick = null; $("pick-pos").textContent = "未選択"; $("btn-save").disabled = true; refreshRecords(); }
  }

  function init() {
    S.records = load();
    MW.KINDS.forEach(function (k) { $("f-kind").appendChild(el("option", { value: k.id, text: k.label })); });
    $("f-when").value = MW.fmtDate(new Date()).replace(" ", "T");
    radio($("ctl-base"), [{ id: "std", label: "標準" }, { id: "pale", label: "淡色" }, { id: "photo", label: "航空写真(現在)" }], S.view.base, function (id) { S.view.base = id; applyLayers(); writeHash(); });
    radio($("ctl-old"), [{ id: "none", label: "なし" }, { id: "ort_old10", label: "1961〜69年" }, { id: "gazo1", label: "1974〜78年" }], S.view.old, function (id) { S.view.old = id; applyLayers(); writeHash(); });
    $("op").addEventListener("input", function () { S.view.op = +$("op").value; applyLayers(); writeHash(); });
    var jump = $("jump");
    JUMPS.forEach(function (j) {
      var b = el("button", { type: "button", text: j.label + "へ移動" });
      b.addEventListener("click", function () { map.flyTo({ center: [j.lng, j.lat], zoom: j.z, duration: 600 }); });
      jump.appendChild(b);
    });
    var legend = $("legend");
    Object.keys(KIND_COLOR).forEach(function (k) {
      var sp = el("span", {}, [el("span", { class: "sw" }), document.createTextNode(k === "区分なし" ? "区分なし（データ上）" : "盛土造成地: " + k)]);
      sp.firstChild.style.borderColor = KIND_COLOR[k]; sp.firstChild.style.background = KIND_COLOR[k] + "70";
      legend.appendChild(sp);
    });
    var rs = el("span", {}, [el("span", { class: "sw" }), document.createTextNode("自分の記録")]);
    rs.firstChild.style.borderColor = "#000"; rs.firstChild.style.background = "#F0E442"; rs.firstChild.style.borderRadius = "50%";
    legend.appendChild(rs);

    ["look", "rec", "out"].forEach(function (k) { $("tab-" + k).addEventListener("click", function () { switchTab(k); }); });
    $("rec-form").addEventListener("submit", saveRecord);
    $("btn-locate").addEventListener("click", function () {
      if (!navigator.geolocation) { $("pick-hint").textContent = "この端末では現在地を使えません。地図をタップしてください。"; return; }
      $("pick-hint").textContent = "現在地を取得中…（位置情報は端末内だけで使います）";
      navigator.geolocation.getCurrentPosition(function (p) {
        setPick(p.coords.longitude, p.coords.latitude);
        map.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(map.getZoom(), 16) });
      }, function () { $("pick-hint").textContent = "現在地を取得できませんでした。地図をタップして位置を決めてください。"; }, { enableHighAccuracy: true, timeout: 10000 });
    });
    $("btn-geojson").addEventListener("click", function () {
      if (!S.records.length) { $("io-msg").textContent = "書き出す記録がありません。"; return; }
      download("moritsuchi-records-" + stamp() + ".geojson", JSON.stringify(MW.toGeoJSON(S.records), null, 2), "application/geo+json");
    });
    $("btn-csv").addEventListener("click", function () {
      if (!S.records.length) { $("io-msg").textContent = "書き出す記録がありません。"; return; }
      download("moritsuchi-records-" + stamp() + ".csv", MW.toCSV(S.records), "text/csv");
    });
    $("f-import").addEventListener("change", function (e) {
      var f = e.target.files[0];
      if (!f) return;
      if (f.size > 2e6) { $("io-msg").textContent = "ファイルが大きすぎます（2MBまで）。"; return; }
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var r = MW.fromGeoJSON(JSON.parse(fr.result));
          var have = {}; S.records.forEach(function (x) { have[x.id] = 1; });
          var added = 0;
          r.records.forEach(function (x) { if (!have[x.id]) { S.records.push(x); added++; } });
          save(); renderList(); refreshRecords();
          $("io-msg").textContent = added + "件を読み込みました" + (r.skipped ? "（形式が不正な" + r.skipped + "件は除外）" : "") + (r.records.length - added ? "（同じIDの" + (r.records.length - added) + "件は既存を維持）" : "") + "。";
        } catch (err) { $("io-msg").textContent = "読み込めませんでした。GeoJSON（このアプリで書き出したもの）を選んでください。"; }
        e.target.value = "";
      };
      fr.readAsText(f);
    });
    $("btn-clear").addEventListener("click", function () {
      if (!S.records.length) return;
      if (!confirm("この端末の記録 " + S.records.length + " 件をすべて消します。よろしいですか？（書き出していないと戻せません）")) return;
      S.records = []; S.selected = null; $("report-box").hidden = true; save(); renderList(); refreshRecords();
    });
    $("btn-copy-report").addEventListener("click", function () { copyText($("report-text").value, $("copy-report-msg")); });
    $("copy-link").addEventListener("click", function () { copyText(location.href, $("copy-msg")); });
    $("sheet-toggle").addEventListener("click", function () {
      var p = $("panel"), closed = p.classList.toggle("closed");
      $("sheet-toggle").setAttribute("aria-expanded", String(!closed));
    });
    if (window.matchMedia("(max-width: 720px)").matches) { /* 初期は開いたまま */ }

    renderList();
    initMap();
  }

  window.App = { ready: false, S: S, getMap: function () { return map; }, setPick: setPick, switchTab: switchTab };

  fetch("data/fills.geojson").then(function (r) { return r.json(); }).then(function (fc) {
    S.fills = fc.features;
    $("n-fills").textContent = String(S.fills.length);
    init();
  }).catch(function () {
    document.getElementById("fill-info").textContent = "盛土データを読み込めませんでした。ファイルを配信するサーバー経由（python3 -m http.server）で開いてください。";
    S.fills = []; init();
  });
})();
