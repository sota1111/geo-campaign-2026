/* 同じ土地、四つの値段: 画面。ネットワークは GET のみ（国土地理院のタイル・住所検索、同梱データ data/fukuoka.json）。
 * 不動産情報ライブラリの API はここからは呼ばない（取得は tools/fetch.mjs で事前に行う）。入力は端末内のみ。
 * 試験用: ?data=<相対パス> で同梱データ以外（仮データ）を読める。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const GSI = 'https://cyberjapandata.gsi.go.jp/xyz/';
  const EXAMPLES = [
    { label: '天神（福岡市中央区）', lon: 130.3988, lat: 33.5902 },
    { label: '博多駅付近', lon: 130.4207, lat: 33.5897 },
    { label: '小倉駅付近（北九州市）', lon: 130.8826, lat: 33.8869 },
    { label: '久留米市中心部', lon: 130.5083, lat: 33.3194 },
  ];
  const state = { mark: null, data: null, view: { lon: 130.4, lat: 33.59, z: 14 }, pin: null, results: [] };

  // ---- 地図（平面の座標変換） ----
  const map = $('map'), tiles = $('tiles'), cv = $('over'), pinEl = $('pin');
  const imgs = new Map();
  const world = (lon, lat, z) => {
    const n = 2 ** z, s = Math.sin((lat * Math.PI) / 180);
    return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
  };
  const lonlat = (x, y, z) => {
    const n = 2 ** z;
    return { lon: (x / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI };
  };
  const size = () => ({ w: map.clientWidth, h: map.clientHeight });
  function project(lon, lat) {
    const { w, h } = size(), v = state.view, c = world(v.lon, v.lat, v.z), p = world(lon, lat, v.z);
    return { x: w / 2 + (p.x - c.x) * 256, y: h / 2 + (p.y - c.y) * 256 };
  }
  function unproject(x, y) {
    const { w, h } = size(), v = state.view, c = world(v.lon, v.lat, v.z);
    return lonlat(c.x + (x - w / 2) / 256, c.y + (y - h / 2) / 256, v.z);
  }
  function render() {
    const { w, h } = size(), v = state.view, c = world(v.lon, v.lat, v.z);
    const want = new Set();
    for (let x = Math.floor(c.x - w / 512); x <= Math.floor(c.x + w / 512); x++) {
      for (let y = Math.floor(c.y - h / 512); y <= Math.floor(c.y + h / 512); y++) {
        const key = v.z + '/' + x + '/' + y;
        want.add(key);
        let im = imgs.get(key);
        if (!im) { im = new Image(); im.alt = ''; im.src = GSI + 'std/' + v.z + '/' + x + '/' + y + '.png'; imgs.set(key, im); tiles.appendChild(im); }
        im.style.left = Math.round(w / 2 + (x - c.x) * 256) + 'px';
        im.style.top = Math.round(h / 2 + (y - c.y) * 256) + 'px';
      }
    }
    for (const [key, im] of imgs) if (!want.has(key)) { im.remove(); imgs.delete(key); }
    drawOverlay(); placePin();
  }
  /** 標準地の位置: 番号つきの丸（色だけに頼らず、数字と白縁で示す）。近い順の結果だけ描く */
  function drawOverlay() {
    const dpr = window.devicePixelRatio || 1, { w, h } = size();
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (state.mark) { // 検索した場所: ひし形（ピンとは形を変える）
      const m = project(state.mark.lon, state.mark.lat);
      g.beginPath(); g.moveTo(m.x, m.y - 12); g.lineTo(m.x + 12, m.y); g.lineTo(m.x, m.y + 12); g.lineTo(m.x - 12, m.y); g.closePath();
      g.fillStyle = '#f0a000'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 1; g.strokeStyle = '#1d2733'; g.stroke();
    }
    state.results.forEach((e, i) => {
      if (e.part > 1) return; // 同じ標準地番号は同じ位置なので、丸は1つ
      const p = project(e.point.lon, e.point.lat);
      g.beginPath(); g.arc(p.x, p.y, 11, 0, Math.PI * 2);
      g.fillStyle = '#1d2733'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
      g.fillStyle = '#fff'; g.fillText(String(e.parcel || i + 1), p.x, p.y + 0.5);
    });
  }
  function placePin() {
    if (!state.pin) { pinEl.hidden = true; return; }
    const p = project(state.pin.lon, state.pin.lat);
    pinEl.hidden = false; pinEl.style.left = p.x + 'px'; pinEl.style.top = p.y + 'px';
  }
  function zoom(dz) { state.view.z = Math.max(8, Math.min(18, state.view.z + dz)); render(); }
  $('zin').onclick = () => zoom(1); $('zout').onclick = () => zoom(-1);

  let drag = null;
  map.addEventListener('pointerdown', (e) => { if (e.target.closest('.zoombtns')) return; drag = { x: e.clientX, y: e.clientY, moved: false, view: Object.assign({}, state.view) }; map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const c = world(drag.view.lon, drag.view.lat, drag.view.z);
    const n = lonlat(c.x - dx / 256, c.y - dy / 256, drag.view.z);
    state.view = { lon: n.lon, lat: n.lat, z: drag.view.z }; render();
  });
  map.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const r = map.getBoundingClientRect(), q = unproject(e.clientX - r.left, e.clientY - r.top);
    choose(q.lon, q.lat);
  });
  map.addEventListener('keydown', (e) => {
    const step = 0.25 * 256;
    const move = (dx, dy) => { const c = world(state.view.lon, state.view.lat, state.view.z), n = lonlat(c.x + dx / 256, c.y + dy / 256, state.view.z); state.view.lon = n.lon; state.view.lat = n.lat; render(); };
    if (e.key === 'ArrowLeft') move(-step, 0); else if (e.key === 'ArrowRight') move(step, 0);
    else if (e.key === 'ArrowUp') move(0, -step); else if (e.key === 'ArrowDown') move(0, step);
    else if (e.key === '+' || e.key === '=') zoom(1); else if (e.key === '-') zoom(-1);
    else if (e.key === 'Enter') choose(state.view.lon, state.view.lat);
    else return;
    e.preventDefault();
  });

  // ---- 地点 → 近くの標準地 ----
  function uses() { return Array.from(document.querySelectorAll('input[name=use]:checked')).map((i) => i.value); }
  function choose(lon, lat) {
    if (!state.data) return;
    state.pin = { lon, lat };
    showResults();
    $('status').textContent = '地点を指しました。近くの標準地は、地図の下（広い画面では右）に出しています。別の地点を指すと入れ替わります。';
  }
  function showResults() {
    if (!state.pin || !state.data) return;
    const u = uses();
    if (!u.length) { state.results = []; $('summary').textContent = '標準地の用途を1つ以上選んでください。'; $('legendBox').innerHTML = ''; $('cards').innerHTML = ''; $('notice2').hidden = true; render(); return; }
    state.results = Lib.nearest(state.data.points, state.pin.lon, state.pin.lat, { n: Lib.DEFAULT_COUNT, uses: u, complete: $('completeOnly').checked });
    $('summary').textContent = Lib.summaryText(state.results, { complete: $('completeOnly').checked });
    $('legendBox').innerHTML = state.results.length ? Lib.legendHtml() : '';
    $('cards').innerHTML = state.results.map((e, i) => Lib.cardHtml(e, i + 1)).join('');
    $('notice2').hidden = !state.results.length; $('notice2').textContent = Lib.NOTICE + '。';
    render();
  }
  document.querySelectorAll('input[name=use]').forEach((i) => { i.onchange = showResults; });
  $('completeOnly').onchange = showResults;

  $('search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('q').value.trim(); if (!q) return;
    $('status').textContent = '検索しています…';
    try {
      const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
      const j = await r.json();
      if (!j.length) { $('status').textContent = '見つかりませんでした。地図を直接クリックしてください。'; return; }
      const [lon, lat] = j[0].geometry.coordinates;
      state.view = { lon, lat, z: 15 }; state.pin = null; state.results = []; state.mark = { lon, lat };
      $('summary').textContent = '場所を指すと、結果がここに出ます（スマートフォンでは地図の下）。'; $('legendBox').innerHTML = ''; $('cards').innerHTML = ''; $('notice2').hidden = true; render();
      $('status').textContent = '「' + j[0].properties.title + '」付近に移動しました（地図のひし形が検索した場所です）。次に、土地の位置を地図でクリックしてください（地図にフォーカスして Enter でも、中心の十字を指せます）。';
    } catch (err) { $('status').textContent = '検索に失敗しました。地図を直接クリックしてください。'; }
  });
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'secondary'; b.textContent = ex.label;
    b.addEventListener('click', () => { state.view = { lon: ex.lon, lat: ex.lat, z: 15 }; choose(ex.lon, ex.lat); });
    $('exButtons').appendChild(b);
  }

  // ---- 表示の固定文言 ----
  $('noticeTop').textContent = Lib.NOTICE;
  $('attribution').textContent = Lib.ATTRIBUTION;
  $('processed').textContent = Lib.PROCESSED;
  $('credit').textContent = Lib.CREDIT;
  $('resp').textContent = Lib.RESPONSIBILITY;

  // ---- データの読み込み ----
  const param = new URLSearchParams(location.search).get('data');
  const dataUrl = param && /^[\w./-]+\.json$/.test(param) && !param.startsWith('/') ? param : 'data/fukuoka.json';
  fetch(dataUrl).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((j) => {
    const d = Lib.validate(j);
    if (!d) throw new Error('形式が違います');
    state.data = d;
    $('year').textContent = d.year; $('fetchedAt').textContent = d.fetchedAt;
    if (d.provisional) $('provisional').hidden = false;
    $('status').textContent = Lib.loadedText(d) + '地図で場所を指すか、例の場所を選んでください。';
  }).catch(() => { $('status').textContent = 'データを読み込めませんでした（data/fukuoka.json が未取得です）。'; });

  window.App = { state, choose };
  render();
  window.addEventListener('resize', render);
})();
