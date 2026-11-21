// 「実データで確かめる」画面の本文（data/verify.json から作る）。tools/verify_incidents.py の出力を読む。
// 因果・精度は言わない。位置単位の検証ではなく、町単位・全国の件数の整理であることを必ず併記する。

const n0 = (x) => Number(x).toLocaleString('ja-JP');
const p1 = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
const GROUP_JA = { oldest: '古い方の3分の1', middle: '真ん中の3分の1', newest: '新しい方の3分の1' };

export function verifyHtml(v) {
  if (!v) return '<p class="note">検証データ（data/verify.json）を読み込めませんでした。</p>';
  const nat = v.national, m = nat.municipal, ck = v.check, toy = v.toyonaka, tk = v.tokujuten, cls = nat.municipal_by_class;
  const allTotal = nat.national.total + nat.prefecture.total + m.total;
  const clsRow = (label, c) => `<tr><td>${label}</td><td class="n">${n0(c.total)}</td><td class="n">${n0(c.sewer)}</td><td class="n">${p1(c.sewer, c.total)}</td></tr>`;
  const tc = v.terciles.map((g) => `<tr><td>${GROUP_JA[g.group]}（竣工年の中央値 ${g.year_min}〜${g.year_max}年）</td><td class="n">${g.towns}</td><td class="n">${n0(g.pipe_km)}</td><td class="n">${g.sewer_incidents}</td><td class="n">${g.per_100km.toFixed(1)}</td></tr>`).join('');
  const topTowns = v.towns.filter((t) => t.sewer_incidents > 0).slice(0, 8)
    .map((t) => `<tr><td>${t.town}</td><td class="n">${t.median_year ?? '不明'}</td><td class="n">${t.pipe_km_known.toFixed(1)}</td><td class="n">${t.sewer_incidents}</td></tr>`).join('');
  const tokP = tk && tk.priority, tokO = tk && tk.other;
  return `
  <p class="note"><b>地中レーダの結果は、一次審査を通るまで手元にありません。</b>そのため「この点数で空洞を当てられた」とは検証できません。代わりに、公開されている実データでできる範囲を示します。<b>因果や精度を示すものではなく、位置単位の検証でもありません。</b></p>

  <h3>1. 国交省「道路陥没発生箇所の詳細」（令和6年度）に何が載っているか</h3>
  <ul class="tight">
    <li>列は <b>道路管理者・路線名・地名・要因施設・大きさ（深さ・縦断・横断）</b>。<b>座標はありません</b>。地名は「大阪府豊中市宝山町地先」のように <b>市区町村＋町名＋「地先」</b>までで、番地・丁目はありません（町丁目より粗い）。</li>
    <li>件数: 全国 <b>${n0(allTotal)}</b>（直轄国道 ${nat.national.total}、都道府県管理 ${n0(nat.prefecture.total)}、市町村管理 ${n0(m.total)}）。大阪府内 <b>${v.osaka.total}</b>、うち豊中市管理 <b>${toy.incidents}</b>（要因は 下水道 ${toy.sewer}、要因未確定 ${toy.causes['要因未確定'] || 0}、その他 ${(toy.incidents - toy.sewer - (toy.causes['要因未確定'] || 0))}）。</li>
    <li>ライセンス: 国交省サイトの既定（公共データ利用規約 PDL1.0、出典表示と加工の旨が条件）。ページ個別の表示はなく、<b>要確認</b>。</li>
    <li>豊中市の件数は少なく（${toy.incidents} 件・1年度）、<b>区間や道路には結び付けていません</b>。結び付けは町名までです。</li>
  </ul>

  <h3>2. 豊中市の町単位の照合（下水道管の古さ × 陥没の件数）</h3>
  <p class="note">方法: 陥没の町名（${toy.towns_with_incident} 町に発生）と、豊中市の下水道台帳（管 ${n0(toy.pipe_count)} 本・約 ${n0(Math.round(toy.pipe_km_total))} km）を、町丁境界（e-Stat、令和2年国勢調査）で町ごとに集計して照合。比較に使う町は、竣工年が分かる管が ${ck.min_km} km 以上ある ${ck.towns_used} 町。下水道起因の陥没 ${ck.incidents_used} 件のうち、発生した町は ${ck.towns_used_with_sewer_incident} 町。</p>
  <table><thead><tr><th>町を管の古さで3群に分けると</th><th class="n">町数</th><th class="n">管 km</th><th class="n">下水道起因の件数</th><th class="n">100 km あたり</th></tr></thead><tbody>${tc}</tbody></table>
  <ul class="tight">
    <li>管の古さ（町ごとの竣工年の中央値）が古い町ほど、管の延長あたりの下水道起因の陥没件数が多い傾向（順位相関 <b>${ck.spearman_age_vs_rate}</b>）。件数が出た町は、出なかった町より古い確率 <b>${ck.auc_age_for_towns_with_sewer_incident}</b>（0.5 なら差なし）。</li>
    <li>件数を管の延長に比例して町に無作為に配り直す試行（${n0(ck.perm_trials)} 回）で、同じ以上になった割合は ${(ck.perm_p_rho_ge * 100).toFixed(1)}%（順位相関）・${(ck.perm_p_auc_ge * 100).toFixed(1)}%（上の確率）。<b>偶然だけでは出にくい差ですが、原因を示すものではありません。</b></li>
  </ul>
  <details><summary>下水道起因の件数が多い町（8町）</summary>
    <table><thead><tr><th>町</th><th class="n">竣工年の中央値</th><th class="n">管 km</th><th class="n">件数</th></tr></thead><tbody>${topTowns}</tbody></table>
  </details>
  <p class="note"><b>限界</b>: 1年度・${ck.incidents_used} 件だけの照合で、町ごとの件数は 0〜3 件です。見つかった陥没は通報・点検の濃淡の影響を受けます。町の大きさ・人口・道路の量・交通量・地盤は調整していません。管の古さは町の中央値で、陥没した管の古さではありません。<b>このアプリの点数（衛星を含む）の検証ではありません</b>（衛星は豊中市全域では取り込んでおらず、この地区では階級がほぼ一様です）。</p>

  <h3>3. 全国の文脈（市町村管理の陥没で、下水道が要因とされた割合）</h3>
  <table><thead><tr><th>管理者の区分</th><th class="n">件数</th><th class="n">下水道が要因</th><th class="n">割合</th></tr></thead><tbody>
    ${clsRow('市町村管理の全体', m)}
    ${clsRow('　うち特別区', cls.tokubetsu)}
    ${clsRow('　うち政令市', cls.designated)}
    ${clsRow('　うちそれ以外の市町村', cls.other_municipal)}
    ${clsRow('都道府県管理', nat.prefecture)}
    ${clsRow('直轄国道', nat.national)}
    ${clsRow('豊中市（市管理）', { total: toy.incidents, sewer: toy.sewer })}
  </tbody></table>
  <p class="note">管理者の区分によって、下水道が要因とされる割合に大きな差があります（件数の集計のみ。要因は各管理者の判定で、「要因未確定」も多い）。</p>

  <h3>4. 全国特別重点調査（八潮市の事故後。管径 2 m 以上・1994 年度以前の下水道管）での豊中市</h3>
  <ul class="tight">
    <li>令和8年2月末時点で、豊中市は対象延長 ${tokP ? tokP.target_km : '—'} km（優先実施箇所）＋ ${tokO ? tokO.target_km : '—'} km（それ以外）。<b>空洞が確認された箇所は 0</b>（全国の合計は ${tk ? tk.all_cavities_listed : '—'} 箇所）。</li>
    <li>ただし<b>空洞調査の実施済み延長も 0 km</b>（目視調査・打音調査等は実施）。「空洞がない」ことを示す数字ではなく、<b>この調査では確認されていない</b>という数字です。対象は大口径管だけで、生活道路の下の中小口径管は含みません。</li>
    <li>したがって、豊中市に「当たり」として使える空洞の実データは見つかっていません。</li>
  </ul>

  <h3>出典</h3>
  <ul class="tight">
    <li>国交省 令和6年度 路面陥没発生状況: <a href="https://www.mlit.go.jp/road/sisaku/ijikanri/r6hasseijoukyou.html" target="_blank" rel="noopener">mlit.go.jp/road/sisaku/ijikanri/r6hasseijoukyou.html</a>（02.xlsx、令和8年2月18日訂正版。取得 2026-11-21）</li>
    <li>国交省 下水道管路の全国特別重点調査 別紙2: <a href="https://www.mlit.go.jp/report/press/content/001997561.xlsx" target="_blank" rel="noopener">001997561.xlsx</a>（令和8年2月末時点）</li>
    <li>豊中市 下水道（CC BY 4.0）: <a href="https://data.bodik.jp/dataset/272035_gesuido" target="_blank" rel="noopener">data.bodik.jp/dataset/272035_gesuido</a></li>
    <li>町丁境界: e-Stat 令和2年国勢調査 小地域（町丁・字等）（e-Stat の利用規約に従う。条件は要確認）。加工して作成。</li>
    <li>再現: <code>tools/verify_incidents.py</code>（取得物は sandbox に置いて読むだけ）。</li>
  </ul>`;
}
