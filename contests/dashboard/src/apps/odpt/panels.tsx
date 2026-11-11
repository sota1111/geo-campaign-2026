import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  DAYS, DAY_FULL, DAY_LABEL, PERIODS, PERIOD_LABEL, citationText, compareRow, condIndex, fmtMin, levelLabel, lostPopulation,
  needLevel, nodeFacts, pct, shortName, summarize, type Cell, type Lost, type Near, type RegionData, type RegionIndex,
} from './lib'
import type { CondState } from './Conclusion'

export const COLORS = { walk: '#56B4E9', transit: '#0072B2', none: '#D55E00', rail: '#8c8c8c', lost: '#CC79A7' }

const man = (n: number) => (n >= 10000 ? `${Math.round(n / 100) / 100}万人` : `${n.toLocaleString('ja-JP')}人`)
const nf = (n: number) => n.toLocaleString('ja-JP')

function condLabel(d: RegionData, c: CondState) {
  return `${DAY_LABEL[c.day]}${PERIOD_LABEL[c.per]}${d.params.start_hours[c.per]}時・${c.w}分以内・${d.facility_labels[d.facility_order[c.fi]]}`
}

/* ---------------- 近くの停留所と診断表 ---------------- */
export function StopsPanel({
  data, cond, cell, near, labels,
}: { data: RegionData; cond: CondState; cell: Cell | null; near: Near[]; labels: string[] }) {
  void cond
  if (!near.length && !cell) {
    return <p className="text-sm text-muted-foreground">地図をタップするか住所・駅名で探すと、その地点の近くの停留所（本数・最終便）と診断表がここに出ます。</p>
  }
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1 font-semibold">近くの停留所（{data.params.walk_in_m}m以内・近い順）</h3>
        {!near.length ? (
          <p className="text-sm">半径{data.params.walk_in_m}m以内に停留所がありません。</p>
        ) : (
          <ul className="space-y-2">
            {near.map((o, k) => {
              const n = data.nodes[o.i]
              return (
                <li key={o.i} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2"><b className="text-base">{labels[k]}</b><span className="text-xs text-muted-foreground">約{Math.round(o.d)}m</span></div>
                  <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                    <div>平日 1日{n[3][3]}本（朝{n[3][0]}／昼{n[3][1]}／夕{n[3][2]}）<br />最終 <b>{n[3][3] > 0 ? fmtMin(n[3][5]) : '運行なし'}</b></div>
                    <div>休日（日曜） 1日{n[4][3]}本（朝{n[4][0]}／昼{n[4][1]}／夕{n[4][2]}）<br />最終 <b>{n[4][3] > 0 ? fmtMin(n[4][5]) : '運行なし'}</b></div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    路線: {n[5].slice(0, 5).map((r) => data.routes[r][0]).join('、')}{n[5].length > 5 ? ` ほか${n[5].length - 5}路線` : ''}。{nodeFacts(n).join('。')}。
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          朝は6-9時・昼は9-16時・夕は16-20時の発車数（それ以外の時間帯の便は1日の本数にだけ含む）。最終はその日の最後の発車時刻（基準日の時刻表）。
          選んだ地点の近くの路線は地図に濃い線で示します。
        </p>
      </section>
      {cell && <DiagTable data={data} cell={cell} />}
    </div>
  )
}

function DiagTable({ data, cell }: { data: RegionData; cell: Cell }) {
  const th = data.params.thresholds
  return (
    <section>
      <h3 className="mb-1 font-semibold">この地点（500mメッシュ）の診断表</h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2}>行き先</TableHead>
              {DAYS.map((d) => <TableHead key={d} colSpan={3} className="text-center">{DAY_FULL[d]}</TableHead>)}
            </TableRow>
            <TableRow>
              {DAYS.flatMap((d) => PERIODS.map((p) => <TableHead key={d + p} className="text-center">{PERIOD_LABEL[p]}</TableHead>))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.facility_order.map((k, fi) => {
              const wl = +String(cell[4]).charAt(fi)
              return (
                <TableRow key={k}>
                  <TableCell className="font-medium">{data.facility_labels[k]}</TableCell>
                  {DAYS.flatMap((d) => PERIODS.map((p) => {
                    const lv = +cell[3][condIndex(fi, d, p)]
                    let text: string, cls: string
                    if (wl > 0 && wl >= lv) { text = `${levelLabel(wl, th)}（徒歩）`; cls = 'bg-sky-100' }
                    else if (lv === 0 && cell[5]) { text = '鉄道駅が近い'; cls = 'bg-neutral-200' }
                    else if (lv === 0) { text = '× 行けない'; cls = 'bg-orange-100 font-bold' }
                    else { text = levelLabel(lv, th); cls = 'bg-blue-100' }
                    return <TableCell key={d + p} className={`whitespace-normal text-center text-xs ${cls}`}>{text}</TableCell>
                  }))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        朝8時・昼12時・夕17時に出発して、最短で何分以内に着けるか（待ち時間・乗継を含む）。×は60分以内に歩いても収録した公共交通でも着けない。
        「鉄道駅が近い」は、未収録の鉄道があるため評価していない。
      </p>
    </section>
  )
}

/* ---------------- 地域全体 ---------------- */
export function RegionPanel({ data, cond }: { data: RegionData; cond: CondState }) {
  const nd = needLevel(data.params.thresholds, cond.w)
  const s = summarize(data.cells, cond.fi, cond.day, cond.per, nd)
  const okp = pct(s.walk + s.transit, s.pop)
  const ok65 = pct(s.walk65 + s.transit65, s.pop65)
  const isSchool = data.facility_order[cond.fi] === 'school'
  const segs = [
    { k: '歩いて', v: pct(s.walk, s.pop), c: COLORS.walk },
    { k: '公共交通で', v: pct(s.transit, s.pop), c: COLORS.transit },
    { k: '鉄道駅が近い（未評価）', v: pct(s.rail, s.pop), c: COLORS.rail },
    { k: '行けない', v: pct(s.none, s.pop), c: COLORS.none },
  ]
  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>{shortName(data.name)}の診断範囲に住む人全体の結果です（選んだ地点の結果ではありません）</AlertTitle>
        <AlertDescription>条件: {condLabel(data, cond)}</AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-2">
        <Card className="gap-1 py-4">
          <CardHeader className="px-4"><CardDescription>行ける人（全体）</CardDescription><CardTitle className="text-3xl">{okp}%</CardTitle></CardHeader>
          <CardContent className="px-4 text-xs text-muted-foreground">診断範囲の人口 {man(s.pop)}</CardContent>
        </Card>
        <Card className="gap-1 py-4">
          <CardHeader className="px-4"><CardDescription>行ける人（65歳以上）</CardDescription><CardTitle className="text-3xl">{ok65}%</CardTitle></CardHeader>
          <CardContent className="px-4 text-xs text-muted-foreground">65歳以上の人口 {man(s.pop65)}</CardContent>
        </Card>
      </div>
      <div>
        <div
          className="flex h-4 w-full overflow-hidden rounded"
          role="img"
          aria-label={segs.map((x) => `${x.k} ${x.v}%`).join('、')}
        >
          {segs.map((x) => <i key={x.k} style={{ width: `${x.v}%`, background: x.c }} />)}
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {segs.map((x) => (
            <li key={x.k} className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm" style={{ background: x.c }} />{x.k} {x.v}%</li>
          ))}
        </ul>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>行けない人（{cond.w}分以内に歩いても収録した公共交通でも着けない）</TableHead>
              {!isSchool && <TableHead>65歳以上</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="whitespace-normal"><b>{nf(s.none)}人</b>（{pct(s.none, s.pop)}%）{isSchool && '（住民の人数。児童・生徒数ではありません）'}</TableCell>
              {!isSchool && <TableCell><b>{nf(s.none65)}人</b>（{pct(s.none65, s.pop65)}%）</TableCell>}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        パーセントは診断範囲の人口（全体 {man(s.pop)}／65歳以上 {man(s.pop65)}）に対する割合。「鉄道駅が近い（未評価）」の人は含みません。代替交通・デマンド交通・減便は考慮していません。
      </p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>行ける人の割合（{cond.w}分以内・{data.facility_labels[data.facility_order[cond.fi]]}）</TableHead>
              {PERIODS.map((p) => <TableHead key={p} className="text-center">{PERIOD_LABEL[p]}{data.params.start_hours[p]}時</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {DAYS.map((dy) => (
              <TableRow key={dy}>
                <TableCell className="font-medium">{DAY_FULL[dy]}</TableCell>
                {PERIODS.map((p) => {
                  const t = summarize(data.cells, cond.fi, dy, p, nd)
                  const cur = dy === cond.day && p === cond.per
                  return <TableCell key={p} className={`text-center ${cur ? 'bg-accent font-bold' : ''}`}>{pct(t.walk + t.transit, t.pop)}%{cur ? '（選択中）' : ''}</TableCell>
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        診断範囲: 収録した停留所から{data.params.diag_radius_m}m以内の人口メッシュ。徒歩は直線×{data.params.detour}÷分速{data.params.walk_m_per_min}mで換算し、許容時間内に歩いて着けるなら「歩いて行ける」。
      </p>
      {isSchool && cond.per !== 'm' && (
        <p className="text-xs"><b>学校の昼・夕について:</b> 「その時刻に家を出て学校へ向かう」場合の値です。下校は評価していません。通学は朝8時の値を見てください。</p>
      )}
    </div>
  )
}

/* ---------------- 路線を止めたら？ ---------------- */
export type WhatIfData = { routes: Record<string, [number, string][]> }

export function WhatIfPanel({
  data, whatif, cond, route, onRoute, impact,
}: {
  data: RegionData; whatif: WhatIfData | null; cond: CondState; route: string | null
  onRoute: (r: string | null) => void; impact: Record<string, Lost>
}) {
  if (!whatif) return <p className="text-sm text-muted-foreground">この地域の「路線を止めたら？」のデータを読み込み中、または用意がありません。</p>
  const ids = Object.keys(impact).sort((a, b) => impact[b].lost - impact[a].lost)
  const label = (r: string) => {
    const rt = data.routes[+r]
    return `${rt[0]}${rt[1] ? `（${rt[1]}）` : ''}｜${rt[2]}`
  }
  const nd = needLevel(data.params.thresholds, cond.w)
  const fl = data.facility_labels[data.facility_order[cond.fi]]
  const im = route ? impact[route] : null
  const tot = data.cells.reduce((a, c) => a + c[1], 0)
  return (
    <div className="space-y-3">
      <Alert>
        <AlertTitle>前提</AlertTitle>
        <AlertDescription>
          選んだ路線の<b>全便が止まる</b>場合を計算します。<b>代替バス・デマンド交通・部分的な減便は考慮しません</b>。
          いまの診断条件で<b>行けなくなる人</b>を、地図にピンクで示します。路線は「事業者・路線名」でまとめ、方向や系統の違うものも含めて時刻表で再計算しています。
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">影響が大きい路線:</span>
        {ids.slice(0, 3).filter((r) => impact[r].lost > 0).map((r) => (
          <Button key={r} size="sm" variant={route === r ? 'default' : 'outline'} aria-pressed={route === r} onClick={() => onRoute(r)}>{data.routes[+r][0]}</Button>
        ))}
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" id="wi-label">路線を選ぶ（影響が大きい順）</label>
        <Select value={route ?? '__none'} onValueChange={(v) => onRoute(v === '__none' ? null : v)}>
          <SelectTrigger aria-labelledby="wi-label" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value="__none">（選択しない）</SelectItem>
            {ids.map((r) => <SelectItem key={r} value={r}>{label(r)}｜−{nf(impact[r].lost)}人</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!route && <p className="text-sm text-muted-foreground">路線を選ぶと、その路線が止まったときの影響がここに出ます。</p>}
      {route && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>選択中: <b>{label(route)}</b>（地図にピンクの破線）</span>
            <Button size="sm" variant="ghost" onClick={() => onRoute(null)}>選択を解除</Button>
          </div>
          {!im || im.lost === 0 ? (
            <p>「{condLabel(data, cond)}」の条件では、行けなくなる人はいません。（他の路線で代替できる、または元から到達できない地区です）</p>
          ) : (
            <p>
              「{condLabel(data, cond)}」で行けなくなる人: <b>{nf(im.lost)}人</b>（診断範囲の{pct(im.lost, tot)}%）、うち65歳以上 <b>{nf(im.lost65)}人</b>
              <span aria-hidden style={{ color: COLORS.lost }}> ■</span>
            </p>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow><TableHead /> {PERIODS.map((p) => <TableHead key={p} className="text-center">{PERIOD_LABEL[p]}</TableHead>)}</TableRow>
              </TableHeader>
              <TableBody>
                {DAYS.map((dy) => (
                  <TableRow key={dy}>
                    <TableCell className="font-medium">{DAY_LABEL[dy]}</TableCell>
                    {PERIODS.map((p) => {
                      const x = lostPopulation(data.cells, whatif.routes[route] ?? [], cond.fi, dy, p, nd)
                      return <TableCell key={p} className="text-center">{x.lost ? `−${nf(x.lost)}` : '0'}</TableCell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            表は「{cond.w}分以内・{fl}」で行けなくなる人数。<b>0</b>は、その時間帯にはこの路線が無くても結果が変わらないこと（他の路線や徒歩で代わりがきく、その時間帯にこの路線が走っていない、または元から行けない地区だけを通る）を意味します。未計算ではありません。
          </p>
        </div>
      )}
    </div>
  )
}

/* ---------------- 5地域比較 ---------------- */
export function ComparePanel({
  index, all, cond, data, loading, error,
}: { index: RegionIndex; all: RegionData[] | null; cond: CondState; data: RegionData; loading: boolean; error: string | null }) {
  const key = data.facility_order[cond.fi]
  if (error) return <p className="text-sm">比較用のデータを読み込めませんでした: {error}</p>
  if (loading || !all) return <p className="text-sm text-muted-foreground">5地域のデータを読み込み中…</p>
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">条件: {DAY_FULL[cond.day]}{PERIOD_LABEL[cond.per]}{data.params.start_hours[cond.per]}時発・{cond.w}分以内・{data.facility_labels[key]}</p>
      <Alert variant="destructive">
        <AlertTitle>注意</AlertTitle>
        <AlertDescription>地域ごとに収録している交通機関が違うため、この表は地域の優劣を示しません（詳しくは表の下）。</AlertDescription>
      </Alert>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow><TableHead>地域</TableHead><TableHead>行ける割合</TableHead><TableHead>行けない人（全体）</TableHead><TableHead>行けない人（65歳以上）</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {all.map((c) => {
              const r = compareRow(c, key, cond.day, cond.per, cond.w)
              return (
                <TableRow key={c.id} className={c.id === data.id ? 'bg-accent' : ''}>
                  <TableCell className="font-medium">{shortName(c.name)}</TableCell>
                  {!r ? <TableCell colSpan={3}>この条件は未計算</TableCell> : (
                    <>
                      <TableCell><b>{r.okPct}%</b></TableCell>
                      <TableCell>{nf(r.none)}人（{r.nonePct}%）</TableCell>
                      <TableCell>{nf(r.none65)}人（{r.none65Pct}%）</TableCell>
                    </>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        <b>比べるときの注意:</b> 収録している事業者・交通手段が地域ごとに違います。
        {all.map((c) => {
          const ir = index.regions.find((x) => x.id === c.id)
          return `${shortName(c.name)}＝${(ir?.operators ?? []).join('・')}（${c.coverage.modes.join('・')}）`
        }).join('、')}。
        たとえば東京は都営（東京都交通局）のみ、飯田・下伊那は南信州地域のバスのみで、民営バスやJR等は含みません。数字は地域の優劣ではなく「収録した範囲での診断」の違いです。
        割合・人数は、各地域の診断範囲（収録停留所から{data.params.diag_radius_m}m以内）の人口が分母です。
      </p>
    </div>
  )
}

/* ---------------- 出典・前提 ---------------- */
export function AboutPanel({
  data, url, date, onCopyCite,
}: { data: RegionData; url: string; date: string; onCopyCite: (t: string) => void }) {
  const cite = citationText(data, { url, date })
  const rw = data.params.rail_walk_min
  const has = (s: string) => data.coverage.sources.includes(s)
  const A = ({ href, children }: { href: string; children: ReactNode }) => (
    <a className="text-primary underline" href={href} target="_blank" rel="noreferrer">{children}</a>
  )
  return (
    <div className="space-y-4 text-sm">
      <p>本アプリは、収録した事業者・地域のデータだけで診断しています。<b>全国を網羅するものではありません</b>（JR・大手民営鉄道等、GTFSデータリポジトリ・公共交通オープンデータセンターから収録していない事業者は含みません）。実データ（時刻表・人口・施設）に基づく推計で、架空データはありません。</p>
      <section className="space-y-2">
        <h3 className="font-semibold">この地域（{data.name}）に収録したGTFSデータ</h3>
        <p>
          出典: {has('GTFSデータリポジトリ') && <A href="https://www.gtfs-data.jp/">GTFSデータリポジトリ</A>}
          {data.coverage.sources.length > 1 && '、'}
          {has('公共交通オープンデータセンター') && <><A href="https://www.odpt.org/">公共交通オープンデータセンター</A>（公開API https://api-public.odpt.org/api/v4/ 、キー不要）</>}
          。各データは事業者がそれぞれのライセンスで公開しており、本アプリでは停留所の集約・本数集計・到達時間の計算という加工を行っています。
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事業者</TableHead><TableHead>データ名</TableHead><TableHead>取得元</TableHead><TableHead>ライセンス・クレジット</TableHead>
                <TableHead>更新日</TableHead><TableHead>データ有効期間</TableHead><TableHead>診断の基準日（平日/休日）</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.feeds.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-normal"><A href={f.url}>{f.org}</A></TableCell>
                  <TableCell className="whitespace-normal">{f.name}</TableCell>
                  <TableCell className="whitespace-normal">{f.source === 'odpt' ? '公共交通オープンデータセンター' : 'GTFSデータリポジトリ'}</TableCell>
                  <TableCell className="whitespace-normal">
                    {f.license_url ? <A href={f.license_url}>{f.license}</A> : f.license}
                    {f.credit && <div>クレジット: {f.credit}</div>}
                  </TableCell>
                  <TableCell>{f.updated}</TableCell>
                  <TableCell className="whitespace-normal">
                    {(f.valid[0] || '?') + '〜' + (f.valid[1] || '?')}
                    {f.expired && <b className="block text-orange-700">期限切れ</b>}
                    {!f.expired && f.ends_before_public_end && <b className="block text-orange-700">公開期間（〜{data.public_until}）の途中で終了</b>}
                  </TableCell>
                  <TableCell>{f.ref.wd} / {f.ref.hol}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">データ生成日: {data.built}。基準日は水曜（平日）・日曜（休日）のうち、各データの有効期間内で生成日以降の最初の日です。祝日・臨時ダイヤは反映していません。</p>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">その他のデータ</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>鉄道駅: 国土数値情報「鉄道データ」N02-22（国土交通省、令和4年12月31日時点）を加工して作成。GTFSに収録していない鉄道の駅の位置を地図に示し、駅から徒歩{rw}分圏の地区を「鉄道駅が近い（未評価）」とするためだけに使っています（時刻表・運行は使っていません）。</li>
          <li>人口: 政府統計の総合窓口（e-Stat）「令和2年国勢調査 地域メッシュ統計（250mメッシュ）」を500mメッシュに集約して作成。65歳以上人口は秘匿処理のため近隣メッシュに合算されている場合があります。</li>
          <li>施設: 国土数値情報（医療機関データ P04-20［病院のみ］、学校データ P29-21［小学校・中学校］）（国土交通省）を加工して作成。施設の位置・存廃は現在と異なる場合があります。</li>
          <li>地図: <A href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</A>（国土地理院）。描画: MapLibre GL JS（BSD-3-Clause）。</li>
          <li>住所・駅名の検索: <A href="https://msearch.gsi.go.jp/address-search/AddressSearch">国土地理院 地名検索API</A>。検索したときだけ、入力した文字列を国土地理院のサーバーへ送って（GET）候補の位置を受け取ります。他には送りません。</li>
        </ul>
      </section>
      <section>
        <h3 className="mb-1 font-semibold">診断の前提と限界</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>「行ける」とは、指定時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可・乗継時間3分以上）→徒歩で、許容時間内に施設の近くへ着けること。待ち時間を含みます。</li>
          <li>徒歩は直線距離の{data.params.detour}倍を分速{data.params.walk_m_per_min}mで歩くと仮定（道路網・坂・横断は未考慮）。乗車停留所は直線{data.params.walk_in_m}m以内、降車停留所から施設は直線{data.params.walk_out_m}m以内。公共交通を使わなくても、同じ徒歩モデルで許容時間内に施設へ歩いて着ければ「歩いて行ける」とします。</li>
          <li>GTFSに収録していない鉄道（JR・民鉄等）とデマンド交通は評価していません。鉄道駅の近くで「行けない」となる地区は灰色「鉄道駅が近い（未評価）」で示しています。「行けない」の中にも、未収録のバスや予約制の便で行ける地区が含まれることがあります。</li>
          <li>運賃、予約が必要なデマンド交通の予約可否、バリアフリー、施設の診療時間・受付時間、帰りの便は評価していません。</li>
          <li>診断範囲は、収録した停留所から{data.params.diag_radius_m}m以内の人口メッシュです。未収録事業者のみが走る地区は「空白」に見えることがあります。</li>
          <li>診断は時刻表データに基づく計算であり、実際の遅延・運休を示すものではありません。結果は計画・検討の参考であり、個別の移動の保証ではありません。</li>
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">出典の書き方（資料に貼れる例文）</h3>
        <Textarea readOnly rows={6} value={cite} className="text-xs" aria-label="出典の例文" />
        <Button variant="outline" size="sm" onClick={() => onCopyCite(cite)}><Copy className="size-4" />出典の例文をコピー</Button>
      </section>
    </div>
  )
}
