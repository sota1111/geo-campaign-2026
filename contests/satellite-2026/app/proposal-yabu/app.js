(function () {
  'use strict';
  const L = window.YabuLib, D = window.YABU;
  const HB = window.HABITAT || null;
  const TN = L.HAB_TIER_NAMES;   // ['低','中','高']
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEY_R = 'yabu-results-v1', KEY_W = 'yabu-weights-v1';
  const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png';

  function load(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できない環境でも画面は使える */ } }
  const state = { results: L.sanitizeResults(load(KEY_R, [])), weights: L.normalizeWeights(load(KEY_W, null)), sel: null, satOnly: false, map: null, mapReady: false };

  function recompute() { state.ranked = L.rank(D.cells, state.weights, state.results, state.satOnly); state.byId = {}; state.ranked.forEach((c) => (state.byId[c.id] = c)); }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    document.querySelectorAll('.csvmsg').forEach((m) => { m.hidden = true; });
    const m = document.querySelector('.view:not([hidden]) .csvmsg');
    if (m) { m.hidden = false; m.textContent = '「' + name + '」を保存しました（ブラウザのダウンロード先に入ります。Excel で開けます）。'; }
  }
  const PLACE = window.YABU_PLACE || {};
  const MUNI = { '26465': '与謝野町', '26463': '伊根町', '26205': '宮津市', '26212': '京丹後市', '26201': '福知山市' };
  const placeOf = (id) => { const p = PLACE[id]; return p ? (MUNI[p[0]] || '') + (p[1] ? ' ' + p[1] : '') : ''; };
  const resClass = (r) => 'r' + Math.max(0, L.RESULTS.indexOf(r));
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });

  // ---- タブ ----
  function show(view) {
    document.querySelectorAll('.view').forEach((v) => (v.hidden = v.id !== 'v-' + view));
    document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    if (view === 'rank' && state.map) setTimeout(() => state.map.resize(), 0);
    if (view === 'record') renderRecords();
    if (view === 'plan') renderPlan();
  }


  // ---- この判定は当たっているか（検証の表示）----
  const f2 = (v) => (v == null ? '―' : v.toFixed(2));
  const dens = (t) => (t.dens == null ? '―' : t.dens.toFixed(1));
  const PERIODS = ['all', 'all_no2010', 'first', 'first_no2010', 'second'];
  function aucTable(zone) {
    const rows = PERIODS.map((p) => {
      const e = HB.val[p + '|' + zone], a = e.auc;
      const better = a.S != null && a.base != null ? (a.S > a.base ? 'S' : a.S < a.base ? 'base' : '') : '';
      return '<tr><th scope="row">' + esc(e.period) + '</th><td class="num">' + e.n_cells.toLocaleString() + '</td><td class="num">' + e.n_pos.toLocaleString() + '（' + e.n_sights.toLocaleString() + '件）</td><td class="num' + (better === 'S' ? ' better' : '') + '">' + f2(a.S) + '</td><td class="num">' + f2(a.R) + '</td><td class="num' + (better === 'base' ? ' better' : '') + '">' + f2(a.base) + '</td></tr>';
    }).join('');
    return '<div class="tablewrap"><table><thead><tr><th>目撃の期間</th><th>区画数</th><th>目撃のあった区画（目撃件数）</th><th>論文ベースの判定 S</th><th>林縁・川だけ R</th><th>人家からの距離だけ（基準）</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function densTable(zone) {
    const names = ['高', '中', '低'];
    const head = '<tr><th>等級</th><th>区画数</th>' + PERIODS.map((p) => '<th>' + esc(HB.val[p + '|' + zone].period) + '<br><small>件/km²</small></th>').join('') + '<th>目撃のあった区画の割合<br><small>2009〜2018年度</small></th></tr>';
    const rows = names.map((n) => '<tr><th scope="row">' + n + '</th><td class="num">' + HB.val['all|' + zone].tiers[n].n_cells.toLocaleString() + '</td>' + PERIODS.map((p) => '<td class="num">' + dens(HB.val[p + '|' + zone].tiers[n]) + '</td>').join('') + '<td class="num">' + (HB.val['all|' + zone].tiers[n].p_cell == null ? '―' : Math.round(HB.val['all|' + zone].tiers[n].p_cell * 100) + '%') + '</td></tr>').join('');
    return '<div class="tablewrap"><table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }
  function stratTable() {
    const rows = HB.strat.map((r) => '<tr><th scope="row">建物から ' + r.from + '〜' + r.to + ' m</th>' + ['高', '中', '低'].map((n) => '<td class="num">' + dens(r.tiers[n]) + '<br><small>（' + r.tiers[n].n_cells.toLocaleString() + '区画・' + r.tiers[n].n_sights + '件）</small></td>').join('') + '</tr>').join('');
    return '<div class="tablewrap"><table><thead><tr><th>人家からの距離</th><th>高</th><th>中</th><th>低</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function dbandTable() {
    const rows = HB.dband.map((r) => '<tr><th scope="row">' + (r.to == null ? r.from + ' m 以上' : r.from + '〜' + r.to + ' m') + '</th><td class="num">' + r.n_cells.toLocaleString() + '</td><td class="num">' + r.n_sights.toLocaleString() + '</td><td class="num">' + dens(r) + '</td></tr>').join('');
    return '<div class="tablewrap"><table><thead><tr><th>最寄りの建物まで</th><th>区画数</th><th>目撃件数</th><th>件/km²</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function verdict() {
    const e = HB.val['all|near500'], a = e.auc, t = e.tiers, u = HB.val['all|land'].auc;
    const fm = (v) => v.toFixed(2);
    const mono = t['高'].dens != null && t['中'].dens != null && t['低'].dens != null && t['高'].dens > t['中'].dens && t['中'].dens > t['低'].dens;
    const per = (p) => HB.val[p + '|near500'].auc;
    const beat = (x) => (x.S > x.base ? '上回る' : x.S < x.base ? '下回る' : '同じ');
    return '<p class="saved"><b>結果（そのまま掲載）：</b>検証範囲全体では、論文ベースの判定 S の AUC は ' + fm(u.S) + '、人家からの距離だけの基準は ' + fm(u.base) + ' で、S は基準を' + beat(u) + '。人家から500m以内に限ると、S は ' + fm(a.S) + '、基準は ' + fm(a.base) + ' で、S は基準を' + beat(a) + '（2009〜2013年度 ' + fm(per('first').S) + ' 対 ' + fm(per('first').base) + '、2014〜2018年度 ' + fm(per('second').S) + ' 対 ' + fm(per('second').base) + '、2010年度を除く ' + fm(per('all_no2010').S) + ' 対 ' + fm(per('all_no2010').base) + '）。500m以内の目撃密度は 高 ' + dens(t['高']) + '、中 ' + dens(t['中']) + '、低 ' + dens(t['低']) + ' 件/km² で、' + (mono ? '高・中・低の順に高い' : '高・中・低の順にはなっていない') + '。AUC は 0.5 が当てずっぽう、1 が完全に当たる値。</p>';
  }
  function renderValidation() {
    const el = $('#validation-body');
    if (!HB) { el.innerHTML = '<p>検証データを読み込めませんでした。</p>'; return; }
    const m = HB.meta;
    el.innerHTML = '<p>判定は論文の数値だけで作り、<b>目撃データで調整していません</b>（目撃は当てはめではなく答え合わせにだけ使用）。検証範囲は、地図の範囲より広い丹後〜福知山の一部（東経 ' + m.val_bbox[0] + '〜' + m.val_bbox[2] + '、北緯 ' + m.val_bbox[1] + '〜' + m.val_bbox[3] + '）で、100m四方の ' + m.n_cells_val.toLocaleString() + ' 区画、目撃 ' + m.n_sights_val.toLocaleString() + ' 件（2009〜2018年度）。区画ごとに「目撃があったか」と判定値を比べます。</p>' +
      '<p class="old"><b>注意：目撃データは住民・市町村・警察の通報で、府は真偽を精査していません。人の多い所ほど見つかり・通報されやすく、クマが実際に多い所とは限りません。</b>そのため「人家からの距離だけ」の単純な判定を基準にして、論文ベースの判定がそれを上回るかを見ます。</p>' +
      verdict() +
      '<h3>① 判定の当たり具合（AUC）：建物から500m以内の区画だけ</h3><p class="note">人里の周りだけで比べる表。通報されやすさの差が小さい範囲です。</p>' + aucTable('near500') +
      '<h3>② 判定の当たり具合（AUC）：検証範囲の全区画</h3><p class="note">山奥（人家から遠く、通報されにくい）を含むため、人家からの距離が有利になりやすい表です。</p>' + aucTable('land') +
      '<h3>③ 等級ごとの目撃の密度（件/km²）：建物から500m以内の区画</h3>' + densTable('near500') +
      '<h3>④ 等級ごとの目撃の密度（件/km²）：検証範囲の全区画</h3>' + densTable('land') +
      '<h3>⑤ 人家からの距離をそろえても等級で差が出るか（件/km²、2009〜2018年度）</h3>' + stratTable() +
      '<h3>⑥ 参考：最寄りの建物までの距離ごとの目撃の密度</h3>' + dbandTable() +
      '<p class="note">読み方：AUC＝目撃のあった区画をなかった区画より高く判定できた確率（0.5＝当てずっぽう）。年度で分けた行は、年による偏り（2010年度は大量出没）の影響を見るためです。判定に使う建物（OSM）は未登録のものがあり、建物の少ない所では「人家から遠い」と誤って扱われます。区画の大きさは100mのみで確かめました。出没の予測精度を保証するものではありません。</p>';
  }
  function renderMethod() {
    const el = $('#hab-method-body');
    if (!HB) return;
    const m = HB.meta, H = L.HAB;
    el.innerHTML = '<p>区画（100m）ごとの判定値 <b>S ＝ R × 集落係数 × 市街地係数</b>。S ≧ ' + H.TIER_HIGH + ' を「高」、S ≧ ' + H.TIER_MID + ' を「中」、それ未満を「低」とします（境目の 3.74・1.81 は論文の林縁20m・100mの選択オッズ）。</p>' +
      '<div class="tablewrap"><table><thead><tr><th>要因</th><th>使い方</th><th>数値と出典</th><th>根拠の強さ</th></tr></thead><tbody>' +
      '<tr><th scope="row">林縁への近さ</th><td>R：画素ごとに exp(b×exp(−0.01×d))、b＝ln3.74÷exp(−0.2)＝' + m.beta + '。区画内の最大値</td><td>林縁20mで選択オッズ 3.74、100mで 1.81（雌。雄は 7.00 と 2.40）。Takahata ほか 2014, PLoS ONE 9(1): e86181（長野県・GPS）。距離の変換式は論文のもの。式から求めた100mの値 ' + m.r100 + ' が論文の 1.81 と一致することを確認</td><td>強（長野県の GPS。選択であって目撃ではない）</td></tr>' +
      '<tr><th scope="row">川に接する林縁</th><td>林縁20m以内かつ川（OSM）20m以内の画素は R＝21.45</td><td>選択オッズ 21.45（雌。雄 18.01）。同上</td><td>強（長野県のみ）</td></tr>' +
      '<tr><th scope="row">集落（人家）から500m圏</th><td>集落係数：建物から500m以内＝1、外＝' + H.G_FAR + '（<b>仮</b>）</td><td>夏（7〜9月）は人里から500m圏内を主に利用（Takahata ほか 2017。高畠 2021 の表より）。係数の数値は論文になく仮</td><td>中（向きのみ。数値なし）</td></tr>' +
      '<tr><th scope="row">人口の多い市街地</th><td>市街地係数：建物用地（国土数値情報）が区画の半分以上＝' + H.G_URBAN + '（<b>仮</b>）</td><td>人口密度が高いほど避ける（三谷ほか 2001, 人と自然 12: 55–62。1頭・73地点、R²＝0.162）。係数は仮</td><td>弱</td></tr>' +
      '<tr><th scope="row">果樹園</th><td><b>入れていません</b></td><td>京都府の資料（京都府立大 ACTR A22）で京丹後市・綾部市は果樹園の分布と目撃が相関するが数値なし。使った国土数値情報 L03-b（令和3年）は果樹園を「その他の農用地」に含み、取り出せない</td><td>数値なし</td></tr>' +
      '<tr><th scope="row">針葉樹率・学校・NDVIの濃さ</th><td><b>入れていません</b></td><td>針葉樹率は文献で向きが割れる（山梨・長野・兵庫）。学校・NDVIの濃さは出没しやすさの根拠が見つからない（学校は「被害を受ける側」として表に残す）</td><td>―</td></tr>' +
      '</tbody></table></div>' +
      '<p class="note">林縁の判定：Sentinel-2 の5月のNDVI 0.6以上の画素を森林とし（田・その他農用地・建物用地・道路・ゴルフ場などの土地利用は除く）、それ以外を開けた所として、境目までの距離（森林側・開けた側とも）を10m単位で求めています。雲などで欠測の所は国土数値情報の「森林」で補っています。論文の林縁の定義とは異なるため、林縁の位置はずれます。川はOSMの river・stream です。</p>' +
      '<p class="note">使ったデータ：国土数値情報 土地利用細分メッシュ L03-b（令和3年・5335）（国土交通省。国土数値情報の利用約款に従う）、© OpenStreetMap contributors（ODbL。建物 ' + m.n_buildings.toLocaleString() + ' 棟・河川 ' + m.n_waterways.toLocaleString() + ' 本、' + esc((m.osm_timestamp || '').slice(0, 10)) + ' 時点）、Copernicus Sentinel-2（' + esc(m.scene) + '）、京都府クマ目撃情報（BODIK、CC BY 4.0）。地図に塗った範囲：高 ' + HB.show_n['高'] + ' 区画・中 ' + HB.show_n['中'] + ' 区画（100m四方）。</p>';
  }

  // ---- ⑴ 順位表・詳細 ----
  function filtered() {
    const u = $('#f-unvisited').checked, n = +$('#f-n').value;
    const pf = $('#f-place') ? $('#f-place').value : '';
    const k = $('#f-sort').value, arr = state.ranked.filter((c) => (!u || !c.latest) && (!pf || placeOf(c.id) === pf)).slice();
    const key = { hab: (c) => -habOf(c.id).s, sight: (c) => -c.n_sight500, house: (c) => c.d_house, school: (c) => (c.d_school == null ? 1e9 : c.d_school) }[k];
    if (key) arr.sort((a, b) => key(a) - key(b) || a.rank - b.rank);
    return arr.slice(0, n);
  }

  // ---- 出没しやすさ（論文ベース）----
  const habOf = (id) => { const v = HB && HB.cand[id]; return v ? { tier: v[0], s: v[1], edge: v[2], river: v[3], house: v[4] } : { tier: 0, s: 0, edge: null, river: 0, house: null }; };
  const habCell = (id) => { const h = habOf(id); return '<b>' + TN[h.tier] + '</b><br><small>S ' + h.s + '</small>'; };
  const habText = (h) => TN[h.tier] + '（判定値 S＝' + h.s + '。' + (h.edge == null ? '' : '区画内で最も林縁に近い所 ' + h.edge + ' m。') + '川に接する林縁：' + (h.river ? 'あり' : 'なし') + '。建物から ' + h.house + ' m' + (h.house <= L.HAB.SETTLE_M ? '（500m圏内）' : '（500m圏外）') + '）';
  function renderTable() {
    const rows = filtered();
    $('#ranktable thead').innerHTML = '<tr><th>順位</th><th>区画</th><th>点数<br><small>衛星 / 重ねたデータ</small></th><th>500m以内の目撃</th><th>最寄り建物</th><th>学校・園まで</th><th>衛星だけで<br>並べた順位</th><th>クマの出没しやすさ<br><small>論文ベース</small></th><th>現地確認</th></tr>';
    const pfv = $('#f-place') ? $('#f-place').value : '';
    $('#ranktable tbody').innerHTML = rows.map((c) => {
      const lt = c.latest ? '<span class="tag ' + resClass(c.latest.result) + '">' + esc(c.latest.result) + '</span> ' + esc(c.latest.date) : '未確認';
      return '<tr data-id="' + c.id + '" tabindex="0"' + (c.id === state.sel ? ' class="sel"' : '') + '><td>' + (pfv ? '<b>' + (state.ranked.filter((x) => placeOf(x.id) === pfv).indexOf(c) + 1) + '</b><br><small>全体 ' + c.rank + '</small>' : c.rank) + '</td><td>' + c.id + (placeOf(c.id) ? '<br><small>' + esc(placeOf(c.id)) + '</small>' : '') + '</td><td>' + (state.satOnly ? c.score + '<br><small>目撃・建物・学校の ' + Math.round((c.totalScore - c.satScore) * 10) / 10 + ' 点は加えていない</small>' : c.score + '（' + c.satScore + ' / ' + Math.round((c.totalScore - c.satScore) * 10) / 10 + '）') + '</td><td>' + c.n_sight500 + '件</td><td>' + c.d_house + ' m</td><td>' + (c.d_school == null ? '不明' : c.d_school + ' m') + '</td><td>' + c.satRank + '位</td><td>' + habCell(c.id) + '</td><td>' + lt + '</td></tr>';
    }).join('') || '<tr><td colspan="9">該当なし</td></tr>';
    $('#count').textContent = '候補 ' + state.ranked.length + ' 区画（100m四方・約1ha）のうち ' + rows.length + ' 区画を、' + (state.satOnly ? '衛星だけの点数' : '目撃履歴・建物・学校を重ねた点数') + 'の高い順に表示。「衛星だけで並べた順位」は目撃・建物・学校を重ねない場合の順位。';
    const mode = document.getElementById('mode-pill');
    if (mode) { const so = $('#f-sort').value !== 'score' ? '・表は「' + $('#f-sort').selectedOptions[0].textContent + '」' : ''; mode.textContent = (state.satOnly ? 'いまの点数: 衛星だけ（枠線の色と順位）' : 'いまの点数: 衛星＋目撃・建物・学校（枠線の色と順位）') + so; mode.className = 'mode-pill' + (state.satOnly ? ' sat' : ''); }
    if (pfv) $('#count').insertAdjacentHTML('beforeend', ' 「' + esc(pfv) + '」に絞っています。順位の列は、太字がこの地区の中での点数の順位、小さな字が全体での順位です。');
    $('#count').insertAdjacentHTML('beforeend', ' <b class="old">目撃履歴は2009〜2018年度の記録で、最新ではありません。</b>');
    const top = state.ranked[0]; if ($('#f-sort').value !== 'score') $('#count').insertAdjacentHTML('afterbegin', '<b>表は「' + $('#f-sort').selectedOptions[0].textContent + '」で、全候補から並べています。左端の「順位」の列は点数での順位です。刈り払い計画（⑶）は常に点数の高い順です。</b> '); if (top) $('#count').insertAdjacentHTML('afterbegin', '<b>いまの1位: ' + top.id + '（' + (state.satOnly ? '衛星だけの点数' : '重ねた点数') + ' ' + top.score + '点）</b> ');
  }
  function renderDetail() {
    const c = state.byId[state.sel], el = $('#detail');
    if (!c) { el.innerHTML = '<h2>根拠の表示</h2><p>地図の区画か表の行を選ぶと、<b>なぜ優先か</b>（点数の内訳と元の数値）が出ます。</p><p class="note">上位の区画から、現地確認に回す順番の案です。</p>'; return; }
    const rs = L.reasons(c, state.weights);
    const hist = state.results.filter((r) => r.cellId === c.id).slice().reverse();
    const top2 = rs.slice().filter((r) => !state.satOnly || r.src === 'sat').sort((a, b) => b.pts - a.pts).filter((r) => r.pts > 0).slice(0, 3);
    el.innerHTML = '<h2>' + c.id + '（順位 ' + c.rank + '／点数 ' + c.score + '）</h2>' +
      '<p class="saved"><b>ひとことで：</b>' + (top2.length ? top2.map((r) => esc(r.text)).join('。') + '。' : '') + ' 点数の大きい観点から順に挙げています。</p><dl>' +
      '<dt>位置</dt><dd>' + (placeOf(c.id) ? esc(placeOf(c.id)) + '（区画の中心点）／' : '') + '北緯 ' + c.lat + '、東経 ' + c.lon + '（100m四方）</dd>' +
      (HB ? '<dt>クマの出没しやすさ（論文ベース）</dt><dd>' + esc(habText(habOf(c.id))) + '<br><small>林縁・川の近さは Takahata ほか 2014 の選択オッズ、人家500m圏は Takahata 2017。出没の予測ではありません。この値は上の点数には入れていません。</small></dd>' : '') +
      '<dt>なぜ優先か（点数の内訳）</dt><dd>' + rs.map((r) => '<div' + (state.satOnly && r.src !== 'sat' ? ' class="unused"' : '') + '><span class="src src-' + r.src + '">' + L.SRC_LABEL[r.src] + '</span><b>' + esc(r.label) + '</b> ' + r.pts + ' / ' + r.max + '点<span class="bar" style="width:' + Math.round(r.max ? (r.pts / r.max) * 60 : 0) + 'px"></span><br><small>' + esc(r.text) + (state.satOnly && r.src !== 'sat' ? '（いまの「衛星だけで並べる」では点数に入れていません）' : '') + '</small></div>').join('') + '</dd>' +
      '<dt>衛星だけで並べた場合</dt><dd>' + c.satRank + '位（衛星由来 ' + c.satScore + '点）。重ねたデータで ' + c.fullRank + '位になっている。</dd>' +
      '<dt>現地確認</dt><dd>' + (hist.length ? hist.map((r) => esc(r.date) + ' ' + esc(r.result) + (r.memo ? '（' + esc(r.memo) + '）' : '')).join('<br>') : 'まだ記録なし') + '</dd></dl>' +
      '<p class="note">藪・耕作放棄地かどうかは衛星だけでは確定できません。配点の重みは仮置きです。</p>' +
      '<p><button type="button" id="btn-to-rec">この区画の現地確認を記録する</button></p>';
    $('#btn-to-rec').onclick = () => { $('#r-cell').value = c.id; show('record'); $('#r-who').focus(); };
  }

  function select(id, fly) {
    state.sel = id;
    renderTable(); renderDetail(); updateSel();
    const c = state.byId[id];
    if (fly && c && state.map) state.map.easeTo({ center: [c.lon, c.lat], zoom: Math.max(state.map.getZoom(), 15), duration: 400 });
  }

  // ---- 地図 ----
  function cellsFC() {
    return { type: 'FeatureCollection', features: state.ranked.map((c) => ({ type: 'Feature', properties: { id: c.id, rank: c.rank, tier: c.rank <= 20 ? 0 : c.rank <= 100 ? 1 : 2 }, geometry: { type: 'Polygon', coordinates: [c.ring] } })) };
  }
  // 出没しやすい範囲（高・中）の区画。100m 格子（UTM）の中心から、緯度経度の小さな矩形にする（約100m）
  function habFC() {
    const dx = 0.000552, dy = 0.00045;
    return { type: 'FeatureCollection', features: HB.show.map((h) => ({ type: 'Feature', properties: { tier: h[2], s: h[3], river: h[4] }, geometry: { type: 'Polygon', coordinates: [[[h[0] - dx, h[1] - dy], [h[0] + dx, h[1] - dy], [h[0] + dx, h[1] + dy], [h[0] - dx, h[1] + dy], [h[0] - dx, h[1] - dy]]] } })) };
  }
  function hatchImage() {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.strokeStyle = '#7b3294'; x.lineWidth = 2; x.beginPath();
    x.moveTo(0, 8); x.lineTo(8, 0); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    return x.getImageData(0, 0, 8, 8);
  }
  const pts = (arr) => ({ type: 'FeatureCollection', features: arr.map((p, i) => ({ type: 'Feature', properties: { name: p.name || '', year: p.year || 0, i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
  function updateSel() {
    if (!state.mapReady) return;
    state.map.setFilter('cells-sel', ['==', ['get', 'id'], state.sel || '']);
  }
  function refreshMap() { if (state.mapReady) state.map.getSource('cells').setData(cellsFC()); }
  function initMap() {
    const b = D.meta.bbox;
    if (typeof maplibregl === 'undefined') { $('#map').innerHTML = '<p class="note">地図ライブラリを読み込めませんでした。表と根拠は使えます。</p>'; return; }
    let map;
    try {
      map = new maplibregl.Map({
        container: 'map', center: [(b[0] + b[2]) / 2 + 0.004, (b[1] + b[3]) / 2 - 0.01], zoom: 12.3, dragRotate: false, attributionControl: false, maxBounds: [[b[0] - 0.05, b[1] - 0.05], [b[2] + 0.05, b[3] + 0.05]],
        style: { version: 8, sources: { gsi: { type: 'raster', tiles: [TILE], tileSize: 256, minzoom: 5, maxzoom: 18 } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9eef3' } }, { id: 'gsi', type: 'raster', source: 'gsi', paint: { 'raster-opacity': 0.75 } }] },
      });
    } catch (e) { $('#map').innerHTML = '<p class="note">この環境では地図を表示できません（WebGL が使えない）。表と根拠は使えます。</p>'; return; }
    state.map = map;
    // 初期レイアウト確定後や画面幅の変更で、地図の描画サイズがずれないようにする
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => map.resize()).observe($('#map'));
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: '地図：<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 地理院タイル（標準地図）</a>' }));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('error', () => { /* タイル取得失敗（オフライン等）でも落とさない */ });
    map.on('load', () => {
      map.addSource('cells', { type: 'geojson', data: cellsFC() });
      map.addSource('sights', { type: 'geojson', data: pts(D.sights) });
      map.addSource('houses', { type: 'geojson', data: pts(D.houses.map((h) => ({ lat: h[0], lon: h[1] }))) });
      map.addSource('schools', { type: 'geojson', data: pts(D.schools) });
      if (HB) {
        map.addSource('hab', { type: 'geojson', data: habFC() });
        map.addImage('hatch', hatchImage(), { pixelRatio: 1 });
        map.addLayer({ id: 'hab-mid', type: 'fill', source: 'hab', filter: ['==', ['get', 'tier'], 1], paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.9 } });
        map.addLayer({ id: 'hab-high', type: 'fill', source: 'hab', filter: ['==', ['get', 'tier'], 2], paint: { 'fill-color': '#7b3294', 'fill-opacity': 0.5 } });
      }
      map.addLayer({ id: 'cells', type: 'fill', source: 'cells', paint: { 'fill-color': ['match', ['get', 'tier'], 0, '#d95f02', 1, '#fdb863', '#7fa6cf'], 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': ['match', ['get', 'tier'], 0, '#c24a00', 1, '#e08a1e', '#2f6db0'], 'line-width': ['match', ['get', 'tier'], 0, 2.5, 1, 1.5, 1] } });
      map.addLayer({ id: 'cells-sel', type: 'line', source: 'cells', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#000', 'line-width': 3 } });
      map.addLayer({ id: 'houses', type: 'circle', source: 'houses', layout: { visibility: 'none' }, paint: { 'circle-radius': 2.5, 'circle-color': '#333', 'circle-opacity': 0.8 } });
      map.addLayer({ id: 'sights', type: 'circle', source: 'sights', layout: { visibility: 'none' }, paint: { 'circle-radius': 3.5, 'circle-color': '#6a3d9a', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1, 'circle-opacity': 0.75 } });
      map.addLayer({ id: 'schools', type: 'circle', source: 'schools', paint: { 'circle-radius': 6, 'circle-color': '#1f78b4', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      map.on('click', 'cells', (e) => { const f = e.features && e.features[0]; if (f) select(f.properties.id, false); });
      map.on('click', 'schools', (e) => { const f = e.features && e.features[0]; if (f) new maplibregl.Popup().setLngLat(e.lngLat).setText(f.properties.name).addTo(map); });
      if (HB) map.on('click', (e) => {
        if (map.queryRenderedFeatures(e.point, { layers: ['cells'] }).length) return;
        const f = map.queryRenderedFeatures(e.point, { layers: ['hab-high', 'hab-mid'] })[0];
        if (f) new maplibregl.Popup().setLngLat(e.lngLat).setText('クマが出やすい範囲：' + TN[f.properties.tier] + '（判定値 S＝' + f.properties.s + (f.properties.river ? '。川に接する林縁を含む' : '') + '）。論文の数値に基づく判定で、出没の予測ではありません').addTo(map);
      });
      map.on('mouseenter', 'cells', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'cells', () => (map.getCanvas().style.cursor = ''));
      state.mapReady = true; updateSel();
    });
  }
  function setLayer(id, on) { if (state.mapReady) state.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
  function setLayers(ids, on) { ids.forEach((i) => { if (state.mapReady && state.map.getLayer(i)) setLayer(i, on); }); }

  // ---- 重み ----
  function renderWeights() {
    $('#weights').innerHTML = L.KEYS.map((k) => '<label>' + '<span><span class="src src-' + L.SRC[k] + '">' + L.SRC_LABEL[L.SRC[k]] + '</span>' + esc(L.LABELS[k]) + '：<b id="wv-' + k + '">' + state.weights[k] + '</b>点満点</span><input type="range" min="0" max="40" step="1" value="' + state.weights[k] + '" data-k="' + k + '" aria-label="' + esc(L.LABELS[k]) + 'の満点"></label>').join('');
    document.querySelectorAll('#weights input').forEach((i) => (i.oninput = () => {
      state.weights[i.dataset.k] = +i.value; $('#wv-' + i.dataset.k).textContent = i.value;
      save(KEY_W, state.weights); refresh();
    }));
  }

  // ---- ⑵ 記録 ----
  function renderRecords() {
    const n = state.results.length;
    const rows = state.results.map((r, i) => [r, i]).reverse();
    $('#rec-table tbody').innerHTML = rows.map(([r, i]) => '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.cellId) + '</td><td>' + esc(r.who) + '</td><td><span class="tag ' + resClass(r.result) + '">' + esc(r.result) + '</span></td><td>' + esc(r.memo) + '</td><td><button type="button" data-del="' + i + '" aria-label="' + esc(r.cellId) + ' の記録を消す">消す</button></td></tr>').join('') || '<tr><td colspan="6">まだ記録がありません</td></tr>';
    document.querySelectorAll('#rec-table [data-del]').forEach((b) => (b.onclick = () => {
      const i = +b.dataset.del; if (state.results.length !== n || !state.results[i]) return;
      const r = state.results.splice(i, 1)[0]; save(KEY_R, state.results); refresh(); renderRecords();
      $('#rec-msg-text').textContent = r.cellId + '（' + r.date + '）の記録を消しました。'; $('#btn-rec-to-plan').hidden = true; $('#rec-msg').hidden = false;
    }));
  }
  // ---- ⑶ 計画 ----
  const planRanked = () => L.rank(D.cells, state.weights, state.results, false);
  function renderPlan() {
    const n = Math.max(1, Math.min(100, Math.floor(+$('#cap').value) || 10));
    const full = planRanked(), rows = L.planRows(full, n);
    const excluded = full.filter((c) => c.latest && c.latest.result === L.EXCLUDE_RESULT).length;
    $('#plan-note').textContent = '現在の点数の上位から ' + rows.length + ' 区画。現地で「藪ではない」とした ' + excluded + ' 区画は除いています。' + (state.satOnly ? '（「衛星だけで並べる」は⑴の表示用で、計画は常に重ねたデータを含む点数で並べます）' : '');
    $('#plan-table tbody').innerHTML = rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + esc(r[1]) + '</td><td>' + r[5] + '</td><td>' + esc(r[12]) + '</td><td>' + r[9] + ' m</td><td>' + r[8] + '件</td></tr>').join('');
  }

  function refresh() { recompute(); refreshMap(); renderTable(); renderDetail(); }

  function init() {
    recompute();
    $('#footer').innerHTML = '出典：クマ目撃＝京都府「クマ目撃情報」（BODIK、CC BY 4.0、' + D.meta.sight_years[0] + '〜' + D.meta.sight_years[1] + '年度、対象範囲内 ' + D.meta.n_sights + ' 件）／建物・学校＝© OpenStreetMap contributors（ODbL、' + esc(D.meta.osm_timestamp.slice(0, 10)) + ' 取得、建物 ' + D.meta.n_houses + ' 棟）／衛星＝Copernicus Sentinel-2 L2A（' + D.meta.scenes.green.id + '・' + D.meta.scenes.winter.id + '。AWS Open Data）／背景地図＝国土地理院 地理院タイル／地図＝MapLibre GL JS（BSD-3-Clause）。';
    $('#map-note').textContent = '地図の区画は ' + D.meta.area + ' の ' + D.meta.n_cells_all + ' 区画（100m四方）から、条件に合う ' + D.cells.length + ' 区画を候補にしたもの。条件：' + D.meta.rule.replace(/^候補 = /, '');
    $('#r-result').innerHTML = '<option value="">（現地で見た結果を選ぶ）</option>' + L.RESULTS.map((r) => '<option>' + esc(r) + '</option>').join('');
    $('#cell-list').innerHTML = D.cells.map((c) => '<option value="' + c.id + '">').join('');
    $('#r-date').value = today();
    renderWeights(); renderTable(); renderDetail(); initMap(); renderValidation(); renderMethod();
    document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => show(b.dataset.view)));
    $('#ranktable tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) select(tr.dataset.id, true); });
    $('#ranktable tbody').addEventListener('keydown', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(tr.dataset.id, true); } });
    $('#f-sat').onchange = (e) => { state.satOnly = e.target.checked; refresh(); };
    $('#f-unvisited').onchange = renderTable;
    $('#btn-to-weights').onclick = () => { const d = document.querySelector('details.weights'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    $('#f-n').onchange = renderTable;
    $('#f-sort').onchange = renderTable;
    const places = {}; D.cells.forEach((c) => { const p = placeOf(c.id); if (p) places[p] = (places[p] || 0) + 1; });
    $('#f-place').innerHTML = '<option value="">すべての地区</option>' + Object.keys(places).sort((a, b) => a.localeCompare(b, 'ja')).map((p) => '<option value="' + esc(p) + '">' + esc(p) + '（' + places[p] + '区画）</option>').join('');
    $('#f-place').onchange = renderTable;
    $('#l-cells').onchange = (e) => { setLayers(['cells', 'cells-line'], e.target.checked); };
    $('#l-hab').onchange = (e) => setLayers(['hab-high', 'hab-mid'], e.target.checked);
    $('#l-sights').onchange = (e) => setLayer('sights', e.target.checked);
    $('#l-houses').onchange = (e) => setLayer('houses', e.target.checked);
    $('#l-schools').onchange = (e) => setLayer('schools', e.target.checked);
    $('#btn-w-reset').onclick = () => { state.weights = L.normalizeWeights(null); save(KEY_W, state.weights); renderWeights(); refresh(); };
    $('#rec-form').onsubmit = (e) => {
      e.preventDefault();
      const r = { cellId: $('#r-cell').value.trim().toUpperCase(), date: $('#r-date').value, who: $('#r-who').value.trim(), result: $('#r-result').value, memo: $('#r-memo').value.trim() };
      const msg = $('#rec-msg');
      if (!state.byId[r.cellId]) { $('#rec-msg-text').textContent = '区画ID「' + r.cellId + '」は候補にありません。⑴の表で確認してください。'; msg.hidden = false; $('#btn-rec-to-plan').hidden = true; return; }
      if (!r.result) { $('#rec-msg-text').textContent = '「結果」を選んでください（現地で見た状態）。'; msg.hidden = false; $('#btn-rec-to-plan').hidden = true; $('#r-result').focus(); return; }
      const ok = L.sanitizeResults([r])[0];
      if (!ok || !ok.who) { $('#rec-msg-text').textContent = '日付・確認者・結果を確かめてください。'; msg.hidden = false; $('#btn-rec-to-plan').hidden = true; return; }
      state.results.push(ok); save(KEY_R, state.results);
      const pr = planRanked(), pos = pr.findIndex((c) => c.id === ok.cellId), cap = Math.max(1, Math.min(100, Math.floor(+$('#cap').value) || 10));
      const eff = ok.result === L.EXCLUDE_RESULT ? 'この区画は⑶の刈り払い計画から外れます。' : (pos >= 0 && pos < cap ? 'この区画は⑶の刈り払い計画（上位' + cap + '）の ' + (pos + 1) + ' 番目に入っており、計画の「現地確認」欄に結果が出ます。' + (ok.result !== L.RESULTS[0] ? '計画から外れるのは「藪ではない」だけで、この結果では計画に残ります（実施するかは担当者が判断）。' : '') : 'この区画は点数 ' + (pos + 1) + ' 位のため、⑶の刈り払い計画（上位' + cap + '）には入っていません（計画の対象数を増やすと入ります）。');
      $('#rec-msg-text').textContent = ok.cellId + ' を記録しました（' + ok.result + '）。' + eff;
      $('#btn-rec-to-plan').hidden = false; msg.hidden = false;
      $('#r-memo').value = ''; $('#r-result').value = ''; refresh(); renderRecords();
    };
    $('#btn-rec-to-plan').onclick = () => show('plan');
    $('#btn-reset').onclick = () => { if (!confirm('現地確認の記録をすべて消します。よろしいですか？')) return; state.results = []; save(KEY_R, state.results); refresh(); renderRecords(); $('#rec-msg').hidden = true; };
    $('#btn-rec-csv').onclick = () => download('yabu_records_' + today() + '.csv', L.toCsv(L.RECORD_HEADER, L.recordRows(state.results)));
    $('#cap').oninput = renderPlan;
    $('#btn-plan-csv').onclick = () => {
      const n = Math.max(1, Math.min(100, Math.floor(+$('#cap').value) || 10));
      download('yabu_plan_' + today() + '.csv', L.toCsv(L.PLAN_HEADER, L.planRows(planRanked(), n)));
    };
  }
  if (window.innerWidth <= 800) { const bw = document.getElementById('bannerwrap'); if (bw) bw.open = false; }
  init();
  window.YabuApp = { state, select };   // 画面テスト用（読み取りと選択のみ）
})();
