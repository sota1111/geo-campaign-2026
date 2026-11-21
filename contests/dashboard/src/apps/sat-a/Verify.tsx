import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** contests/satellite-2026/app/proposal-a/data/verify.json（tools/verify_incidents.py の出力）の形 */
export interface VerifyData {
  has_coordinates: boolean
  national: {
    national: { total: number; sewer: number }
    prefecture: { total: number; sewer: number }
    municipal: { total: number; sewer: number }
    municipal_by_class: Record<'tokubetsu' | 'designated' | 'other_municipal', { total: number; sewer: number }>
  }
  osaka: { total: number; sewer: number; toyonaka: number }
  toyonaka: {
    incidents: number
    sewer: number
    causes: Record<string, number>
    towns_with_incident: number
    pipe_count: number
    pipe_km_total: number
  }
  tokujuten: {
    priority: { target_km: number; cavity_survey_km: number; cavities: number }
    other: { target_km: number; cavity_survey_km: number; cavities: number }
    all_cavities_listed: number
  } | null
  terciles: { group: 'oldest' | 'middle' | 'newest'; towns: number; year_min: number; year_max: number; pipe_km: number; sewer_incidents: number; per_100km: number }[]
  check: {
    min_km: number
    towns_used: number
    towns_used_with_sewer_incident: number
    incidents_used: number
    spearman_age_vs_rate: number
    auc_age_for_towns_with_sewer_incident: number
    perm_trials: number
    perm_p_rho_ge: number
    perm_p_auc_ge: number
  }
  towns: { town: string; median_year: number | null; pipe_km_known: number; incidents: number; sewer_incidents: number }[]
}

const n0 = (x: number) => x.toLocaleString('ja-JP')
const p1 = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')
const GROUP_JA = { oldest: '古い方の3分の1', middle: '真ん中の3分の1', newest: '新しい方の3分の1' } as const

/** 「実データで確かめる」手順の本文。因果・精度は言わない。位置単位の検証ではなく、町単位・全国の件数の整理であることを併記する */
export function VerifyPanel({ v }: { v: VerifyData }) {
  const nat = v.national, m = nat.municipal, ck = v.check, toy = v.toyonaka, tk = v.tokujuten, cls = nat.municipal_by_class
  const total = nat.national.total + nat.prefecture.total + m.total
  const other = toy.incidents - toy.sewer - (toy.causes['要因未確定'] || 0)
  const rows: [string, { total: number; sewer: number }][] = [
    ['市町村管理の全体', m],
    ['　うち特別区', cls.tokubetsu],
    ['　うち政令市', cls.designated],
    ['　うちそれ以外の市町村', cls.other_municipal],
    ['都道府県管理', nat.prefecture],
    ['直轄国道', nat.national],
    ['豊中市（市管理）', { total: toy.incidents, sewer: toy.sewer }],
  ]
  const top = v.towns.filter((t) => t.sewer_incidents > 0).slice(0, 8)
  return (
    <div className="space-y-4 text-sm" data-testid="verify-panel">
      <p className="rounded-md border bg-muted/40 p-2.5 text-xs">
        <b>地中レーダの結果は、一次審査を通るまで手元にありません。</b>そのため「この点数で空洞を当てられた」とは検証できません。代わりに、公開されている実データでできる範囲を示します。
        <b>因果や精度を示すものではなく、位置単位の検証でもありません。</b>
      </p>

      <section className="space-y-1.5">
        <h3 className="font-bold">1. 国交省「道路陥没発生箇所の詳細」（令和6年度）に何が載っているか</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li>列は <b>道路管理者・路線名・地名・要因施設・大きさ（深さ・縦断・横断）</b>。<b>座標はありません</b>。地名は「大阪府豊中市宝山町地先」のように <b>市区町村＋町名＋「地先」</b>までで、番地・丁目はありません（町丁目より粗い）。</li>
          <li>件数: 全国 <b>{n0(total)}</b>（直轄国道 {nat.national.total}、都道府県管理 {n0(nat.prefecture.total)}、市町村管理 {n0(m.total)}）。大阪府内 <b>{v.osaka.total}</b>、うち豊中市管理 <b>{toy.incidents}</b>（要因は 下水道 {toy.sewer}、要因未確定 {toy.causes['要因未確定'] || 0}、その他 {other}）。</li>
          <li>ライセンス: 国交省サイトの既定（公共データ利用規約 PDL1.0、出典表示と加工の旨が条件）。ページ個別の表示はなく、<b>要確認</b>。</li>
          <li>豊中市の件数は少なく（{toy.incidents} 件・1年度）、<b>区間や道路には結び付けていません</b>。結び付けは町名までです。</li>
        </ul>
      </section>

      <section className="space-y-1.5">
        <h3 className="font-bold">2. 豊中市の町単位の照合（下水道管の古さ × 陥没の件数）</h3>
        <p className="text-xs text-muted-foreground">
          方法: 陥没の町名（{toy.towns_with_incident} 町に発生）と、豊中市の下水道台帳（管 {n0(toy.pipe_count)} 本・約 {n0(Math.round(toy.pipe_km_total))} km）を、町丁境界（e-Stat、令和2年国勢調査）で町ごとに集計して照合。
          比較に使う町は、竣工年が分かる管が {ck.min_km} km 以上ある {ck.towns_used} 町。下水道起因の陥没 {ck.incidents_used} 件のうち、発生した町は {ck.towns_used_with_sewer_incident} 町。
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>町を管の古さで3群に分けると</TableHead>
              <TableHead className="text-right">町数</TableHead>
              <TableHead className="text-right">管 km</TableHead>
              <TableHead className="text-right">下水道起因の件数</TableHead>
              <TableHead className="text-right">100 km あたり</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {v.terciles.map((g) => (
              <TableRow key={g.group}>
                <TableCell>{GROUP_JA[g.group]}（竣工年の中央値 {g.year_min}〜{g.year_max}年）</TableCell>
                <TableCell className="text-right">{g.towns}</TableCell>
                <TableCell className="text-right">{n0(g.pipe_km)}</TableCell>
                <TableCell className="text-right">{g.sewer_incidents}</TableCell>
                <TableCell className="text-right">{g.per_100km.toFixed(1)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li>管の古さ（町ごとの竣工年の中央値）が古い町ほど、管の延長あたりの下水道起因の陥没件数が多い傾向（順位相関 <b>{ck.spearman_age_vs_rate}</b>）。件数が出た町は、出なかった町より古い確率 <b>{ck.auc_age_for_towns_with_sewer_incident}</b>（0.5 なら差なし）。</li>
          <li>件数を管の延長に比例して町に無作為に配り直す試行（{n0(ck.perm_trials)} 回）で、同じ以上になった割合は {(ck.perm_p_rho_ge * 100).toFixed(1)}%（順位相関）・{(ck.perm_p_auc_ge * 100).toFixed(1)}%（上の確率）。<b>偶然だけでは出にくい差ですが、原因を示すものではありません。</b></li>
        </ul>
        <details className="rounded-md border p-2 text-xs">
          <summary className="cursor-pointer font-medium">下水道起因の件数が多い町（8町）</summary>
          <Table>
            <TableHeader>
              <TableRow><TableHead>町</TableHead><TableHead className="text-right">竣工年の中央値</TableHead><TableHead className="text-right">管 km</TableHead><TableHead className="text-right">件数</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {top.map((t) => (
                <TableRow key={t.town}>
                  <TableCell>{t.town}</TableCell><TableCell className="text-right">{t.median_year ?? '不明'}</TableCell>
                  <TableCell className="text-right">{t.pipe_km_known.toFixed(1)}</TableCell><TableCell className="text-right">{t.sewer_incidents}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </details>
        <p className="text-xs text-muted-foreground">
          <b>限界</b>: 1年度・{ck.incidents_used} 件だけの照合で、町ごとの件数は 0〜3 件です。見つかった陥没は通報・点検の濃淡の影響を受けます。町の大きさ・人口・道路の量・交通量・地盤は調整していません。管の古さは町の中央値で、陥没した管の古さではありません。
          <b>この画面の点数（衛星を含む）の検証ではありません</b>（衛星は豊中市全域では取り込んでおらず、この地区では階級がほぼ一様です）。
        </p>
      </section>

      <section className="space-y-1.5">
        <h3 className="font-bold">3. 全国の文脈（陥没のうち、下水道が要因とされた割合）</h3>
        <Table>
          <TableHeader>
            <TableRow><TableHead>管理者の区分</TableHead><TableHead className="text-right">件数</TableHead><TableHead className="text-right">下水道が要因</TableHead><TableHead className="text-right">割合</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(([label, c]) => (
              <TableRow key={label}>
                <TableCell>{label}</TableCell><TableCell className="text-right">{n0(c.total)}</TableCell>
                <TableCell className="text-right">{n0(c.sewer)}</TableCell><TableCell className="text-right">{p1(c.sewer, c.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">管理者の区分によって、下水道が要因とされる割合に大きな差があります（件数の集計のみ。要因は各管理者の判定で、「要因未確定」も多い）。</p>
      </section>

      <section className="space-y-1.5">
        <h3 className="font-bold">4. 全国特別重点調査（八潮市の事故後。管径 2 m 以上・1994 年度以前の下水道管）での豊中市</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs">
          <li>令和8年2月末時点で、豊中市は対象延長 {tk ? tk.priority.target_km : '—'} km（優先実施箇所）＋ {tk ? tk.other.target_km : '—'} km（それ以外）。<b>空洞が確認された箇所は 0</b>（全国の合計は {tk ? tk.all_cavities_listed : '—'} 箇所）。</li>
          <li>ただし<b>空洞調査の実施済み延長も 0 km</b>（目視調査・打音調査等は実施）。「空洞がない」ことを示す数字ではなく、<b>この調査では確認されていない</b>という数字です。対象は大口径管だけで、生活道路の下の中小口径管は含みません。</li>
          <li>したがって、豊中市に「当たり」として使える空洞の実データは見つかっていません。</li>
        </ul>
      </section>

      <section className="space-y-1 text-xs">
        <h3 className="text-sm font-bold">出典</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>国交省 令和6年度 路面陥没発生状況（02.xlsx、令和8年2月18日訂正版。取得 2026-11-21）: <a className="break-all text-primary underline" href="https://www.mlit.go.jp/road/sisaku/ijikanri/r6hasseijoukyou.html" target="_blank" rel="noreferrer">mlit.go.jp/road/sisaku/ijikanri/r6hasseijoukyou.html</a></li>
          <li>国交省 下水道管路の全国特別重点調査 別紙2（令和8年2月末時点）: <a className="break-all text-primary underline" href="https://www.mlit.go.jp/report/press/content/001997561.xlsx" target="_blank" rel="noreferrer">001997561.xlsx</a></li>
          <li>豊中市 下水道（CC BY 4.0）: <a className="break-all text-primary underline" href="https://data.bodik.jp/dataset/272035_gesuido" target="_blank" rel="noreferrer">data.bodik.jp/dataset/272035_gesuido</a></li>
          <li>町丁境界: e-Stat 令和2年国勢調査 小地域（町丁・字等）（e-Stat の利用規約に従う。条件は要確認）。加工して作成。</li>
        </ul>
      </section>
    </div>
  )
}
