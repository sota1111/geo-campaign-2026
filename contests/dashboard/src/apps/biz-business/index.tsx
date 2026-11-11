import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Info, X, Copy, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog, type SourceItem } from '@/components/shared/SourceDialog'
import { downloadText } from '@/components/shared/downloadText'
import { useHashState } from '@/components/shared/useHashState'
import { fetchData } from '@/lib/data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DAYS, DAY_LABEL, PERIODS, PERIOD_LABEL, baseline, groupByNearestStop, meshBounds, needLevel, pct, pickSmaller, planLoss,
  toCsvText, type Day, type Period, type RegionData, type WhatIf,
} from './lib'
import { buildCsvRows, type PlanView } from './csv'
import { SOURCE_LINES, limitLines } from './text'

const APP = 'biz-business'
const PLAN_IDS = ['A', 'B', 'C']
const n = (x: number) => x.toLocaleString('ja-JP')

interface RegionInfo { id: string; name: string }
interface Plan { name: string; routes: number[] }

/** ToggleGroup（単一選択）。選択解除を無視する */
function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <ToggleGroup type="single" variant="outline" value={value} aria-label={label} className="flex-wrap justify-start"
      onValueChange={(v) => v && onChange(v as T)}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export default function App() {
  const [regions, setRegions] = useState<RegionInfo[]>([])
  const [regionId, setRegionId] = useHashState('region', 'tokushima')
  const [data, setData] = useState<RegionData | null>(null)
  const [W, setW] = useState<WhatIf | null>(null)
  const [error, setError] = useState('')
  const [day, setDay] = useState<Day>('wd')
  const [per, setPer] = useState<Period>('m')
  const [w, setWmin] = useState(20)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selPlan, setSelPlan] = useState(0)
  const [selFac, setSelFac] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetchData<{ regions: RegionInfo[] }>(APP, 'index.json').then((i) => setRegions(i.regions)).catch((e) => setError(String(e.message)))
  }, [])

  useEffect(() => {
    let alive = true
    setData(null)
    setW(null)
    Promise.all([fetchData<RegionData>(APP, `${regionId}.json`), fetchData<WhatIf>(APP, `whatif_${regionId}.json`)])
      .then(([d, wi]) => {
        if (!alive) return
        setError('')
        setData(d)
        setW(wi)
        setSelFac(0)
        setSelPlan(0)
        // 例として、病院・学校の合計で影響が大きい2路線を案A・案Bに仮に入れる（開いた時点の条件）
        const need = needLevel(d.params.thresholds, w)
        const sel = d.routes.map((_, i) => i).filter((i) => d.routes[i][3] + d.routes[i][4] > 0)
        const both = (i: number) =>
          [0, 1].reduce((s, fi) => s + planLoss(d.cells, wi, [i], fi, day, per, need).lost, 0)
        const ranked = sel.filter((i) => both(i) > 0).sort((a, b) => both(b) - both(a))
        setPlans(PLAN_IDS.map((id, k) => ({ name: `案${id}`, routes: k < 2 && ranked[k] != null ? [ranked[k]] : [] })))
      })
      .catch((e) => alive && setError(`地域データを読み込めませんでした: ${e.message}`))
    return () => {
      alive = false
    }
    // 条件(day/per/w)の変更では案を作り直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionId])

  const need = data ? needLevel(data.params.thresholds, w) : 0
  const routeName = (i: number) => {
    const r = data!.routes[i]
    return r[0] + (r[1] ? `（${r[1]}）` : '')
  }
  const routeFull = (i: number) => `${routeName(i)}｜${data!.routes[i][2]}`
  const condText = data
    ? `${DAY_LABEL[day]}${PERIOD_LABEL[per]}${data.params.start_hours[per]}時発・${w}分以内`
    : ''

  const calc = useMemo(() => {
    if (!data || !W) return null
    const nf = data.facility_order.length
    const base = Array.from({ length: nf }, (_, fi) => baseline(data.cells, fi, day, per, need))
    const results = plans.map((p) =>
      Array.from({ length: nf }, (_, fi) => {
        const l = planLoss(data.cells, W, p.routes, fi, day, per, need)
        return { ...l, groups: groupByNearestStop(data.cells, l.cells, data.nodes) }
      }),
    )
    const selectable = data.routes.map((_, i) => i).filter((i) => data.routes[i][3] + data.routes[i][4] > 0)
    const single = new Map<number, number>()
    for (const i of selectable) single.set(i, planLoss(data.cells, W, [i], 0, day, per, need).lost)
    selectable.sort((a, b) => (single.get(b)! - single.get(a)!) || (data.routes[a][0] < data.routes[b][0] ? -1 : 1))
    return { base, results, selectable, single }
  }, [data, W, plans, day, per, need])

  const ks = plans.map((_, k) => k).filter((k) => plans[k].routes.length > 0)
  const activePlan = ks.includes(selPlan) ? selPlan : (ks[0] ?? 0)
  const smaller = calc && ks.length >= 2 ? pickSmaller(ks.map((k) => calc.results[k][0])).map((i) => ks[i]) : []
  const anyLowerBound = calc ? ks.some((k) => !calc.results[k][0].exact) : false
  const lostText = (l: { lost: number; exact: boolean }) => `${l.exact ? '' : '少なくとも'}${n(l.lost)}人`
  const lb = (exact: boolean) => (exact ? '' : '少なくとも')

  const sentences = useMemo(() => {
    if (!data || !calc) return []
    return ks.map((k) => {
      const parts = data.facility_order.map((fk, fi) => {
        const l = calc.results[k][fi]
        const top = l.groups[0]
        return `${data.facility_labels[fk]}へ行けなくなる人は${lostText(l)}（うち65歳以上${lb(l.exact)}${n(l.lost65)}人）${top ? `、最も多い地区は「${top.name}」付近の${n(top.lost)}人` : ''}`
      })
      return `${plans[k].name}（${plans[k].routes.map(routeName).join('・')}を廃止）: ${condText}で、${parts.join('。')}。`
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calc, plans, condText])

  const mapLayers = useMemo<MapLayer[]>(() => {
    if (!data || !calc || !ks.length) return []
    const l = calc.results[activePlan]?.[selFac]
    if (!l) return []
    const rs = plans[activePlan].routes
    const line = (idx: number[]) => ({
      type: 'Feature' as const, properties: {},
      geometry: { type: 'LineString' as const, coordinates: idx.map((i) => [data.nodes[i][0], data.nodes[i][1]]) },
    })
    return [
      {
        id: 'routes', type: 'line',
        data: { type: 'FeatureCollection', features: data.patterns.map((p) => line(p[1])) },
        paint: { 'line-color': '#555555', 'line-width': 0.8, 'line-opacity': 0.45 },
      },
      {
        id: 'lost', type: 'fill',
        data: {
          type: 'FeatureCollection',
          features: l.cells.map((k) => {
            const b = meshBounds(data.cells[k][0])
            return {
              type: 'Feature' as const, properties: { pop: data.cells[k][1] },
              geometry: { type: 'Polygon' as const, coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] },
            }
          }),
        },
        paint: {
          'fill-color': '#D55E00',
          'fill-opacity': ['interpolate', ['linear'], ['get', 'pop'], 0, 0.4, 50, 0.6, 300, 0.85],
          'fill-outline-color': '#7a3500',
        },
      },
      {
        id: 'plan', type: 'line',
        data: { type: 'FeatureCollection', features: data.patterns.filter((p) => rs.includes(p[0])).map((p) => line(p[1])) },
        paint: { 'line-color': '#0072B2', 'line-width': 4, 'line-opacity': 0.95, 'line-dasharray': [2, 1.5] },
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calc, plans, activePlan, selFac])

  const updatePlan = (k: number, f: (p: Plan) => Plan) => setPlans((ps) => ps.map((p, i) => (i === k ? f(p) : p)))

  const planViews = (): PlanView[] => ks.map((k) => ({ name: plans[k].name, routes: plans[k].routes.map(routeFull), per: calc!.results[k] }))
  const exportCsv = () => {
    if (!data || !calc || !ks.length) {
      toast.error('止める路線を選んだ案がありません。手順2で路線を選んでください。')
      return
    }
    const rows = buildCsvRows(data, condText, calc.base, planViews())
    if (smaller.length) rows.splice(6, 0, ['影響が小さい案（病院へ行けなくなる人が少ない）', smaller.map((k) => plans[k].name).join('・')])
    downloadText(`plan-comparison-${data.id}-${day}${per}${w}.csv`, toCsvText(rows), 'text/csv;charset=utf-8')
    toast.success('CSVを書き出しました（この端末の中で作成。送信していません）')
  }

  const sources: SourceItem[] = data
    ? [
        ...data.feeds.map((f) => ({
          name: `${f.org}｜${f.name.trim()}（GTFS）`,
          provider: f.source === 'odpt' ? '公共交通オープンデータセンター' : 'GTFSデータリポジトリ',
          license: f.license + (f.credit ? `（${f.credit}）` : ''),
          url: f.url,
          note: `更新日 ${f.updated}／有効期間 ${f.valid[0] ?? '?'}〜${f.valid[1] ?? '?'}${f.expired ? '／期限切れ' : f.ends_before_public_end ? '／公開期間の途中で終了' : ''}`,
        })),
        ...SOURCE_LINES.map((t) => ({ name: t })),
        { name: '描画: MapLibre GL JS', license: 'BSD-3-Clause' },
      ]
    : []

  const fl0 = data ? data.facility_labels[data.facility_order[0]] : ''

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader appId={APP} actions={<SourceDialog sources={sources} />} />

      {error && (
        <Alert variant="destructive"><AlertTriangle className="size-4" /><AlertTitle>読み込めませんでした</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">このページの使い方（3ステップ）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li><b>地域と条件</b>を確認する（初期値は徳島市周辺・平日朝・20分以内）。</li>
            <li><b>案A・案B</b>に、廃止する路線を選ぶ（例として2路線が入っています。×で外し、プルダウンで追加・入れ替え）。</li>
            <li><b>「3 案を比べる」</b>で、<b>病院へ行けなくなる人</b>と<b>うち65歳以上</b>、<b>影響が小さい案</b>を確認し、<b>CSV</b>で書き出す。</li>
          </ol>
          <Alert>
            <Info className="size-4" />
            <AlertTitle>できること／できないこと</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>できる: 路線の<b>廃止</b>（その路線の全便を止める）を案にして比べる。</li>
                <li>未対応: <b>減便（本数を減らす）</b>、停留所の移設、乗継の変更、運賃・代替交通。</li>
                <li>1案に<b>複数路線</b>を入れた場合の人数は<b>「少なくとも」の下限</b>です。同時に止めたときだけ新たに行けなくなる人は含みません（足し算ではなく、重複を除いた集計）。</li>
                <li>収録した5地域のデータのみ（JR・大手民鉄は未収録）。計画・検討の参考で、個別の移動の保証ではありません。</li>
              </ul>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span>地域と診断の条件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5 sm:max-w-md">
            <Label htmlFor="region">地域</Label>
            <Select value={regionId} onValueChange={setRegionId}>
              <SelectTrigger id="region" className="w-full"><SelectValue placeholder="地域を選ぶ" /></SelectTrigger>
              <SelectContent>
                {regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {data && <p className="text-xs text-muted-foreground">{data.name}：{data.reason}</p>}
          </div>
          {data && (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label>曜日</Label>
                <Seg label="曜日" value={day} onChange={setDay} options={DAYS.map((k) => ({ value: k, label: DAY_LABEL[k] }))} />
              </div>
              <div className="space-y-1.5">
                <Label>時間帯</Label>
                <Seg label="時間帯" value={per} onChange={setPer}
                  options={PERIODS.map((k) => ({ value: k, label: `${PERIOD_LABEL[k]}${data.params.start_hours[k]}時` }))} />
              </div>
              <div className="space-y-1.5">
                <Label>許容時間（病院・学校まで）</Label>
                <Seg label="許容時間" value={String(w)} onChange={(v) => setWmin(+v)}
                  options={data.params.thresholds.map((t) => ({ value: String(t), label: `${t}分` }))} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            「行ける」= その時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可）→徒歩で、許容時間内に施設の近くへ着けること（待ち時間込み）。歩いて着ける地区は路線を止めても影響を受けません。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>見直し案をつくる（路線の廃止）</CardTitle>
          <CardDescription>
            案ごとに、止める路線を選びます。2案以上に路線が入ると比較されます。案名は書き換えられます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data || !calc ? <p className="text-sm text-muted-foreground">読み込み中…</p> : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                {plans.map((p, k) => (
                  <div key={k} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{PLAN_IDS[k]}</span>
                      <Input value={p.name} maxLength={30} aria-label={`案${PLAN_IDS[k]}の名前`}
                        onChange={(e) => updatePlan(k, (q) => ({ ...q, name: e.target.value || `案${PLAN_IDS[k]}` }))} />
                    </div>
                    <div className="flex min-h-8 flex-wrap gap-1.5">
                      {p.routes.length ? p.routes.map((r) => (
                        <Badge key={r} variant="secondary" className="gap-1 py-1 pr-1 text-xs font-normal">
                          <span className="whitespace-normal text-left">{routeFull(r)}</span>
                          <button type="button" aria-label={`${routeName(r)}を外す`}
                            className="rounded p-0.5 hover:bg-background"
                            onClick={() => updatePlan(k, (q) => ({ ...q, routes: q.routes.filter((x) => x !== r) }))}>
                            <X className="size-3.5" />
                          </button>
                        </Badge>
                      )) : <span className="text-xs text-muted-foreground">止める路線が未選択です（現状と同じ）</span>}
                    </div>
                    <Select value="" onValueChange={(v) => { updatePlan(k, (q) => ({ ...q, routes: [...q.routes, +v] })); setSelPlan(k) }}>
                      <SelectTrigger className="w-full" aria-label={`案${PLAN_IDS[k]}に止める路線を追加`}>
                        <SelectValue placeholder="＋ 止める路線を追加…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {calc.selectable.filter((r) => !p.routes.includes(r)).map((r) => (
                          <SelectItem key={r} value={String(r)}>
                            {routeFull(r)}｜単独停止で{fl0}−{n(calc.single.get(r)!)}人
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                路線は影響が大きい順（現在の条件・{fl0}）。選べるのは基準日に便がある{calc.selectable.length}路線／収録{data.routes.length}路線（全便の停止のみ。減便は未対応）。
                地域を開いたとき、案A・案Bには例として病院・学校の合計で影響が大きい路線を仮に入れてあります。
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">3</span>案を比べる</CardTitle>
              <CardDescription>条件: {condText || '—'}</CardDescription>
            </div>
            <Button onClick={exportCsv} disabled={!calc || !ks.length}><Download className="size-4" />比較表をCSVでダウンロード</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data || !calc ? null : !ks.length ? (
            <p className="text-sm text-muted-foreground">手順2で、止める路線を1つ以上選んでください。（この条件では、止めても行けなくなる人が出る路線が無い地域もあります。許容時間を短くすると差が出ます。）</p>
          ) : (
            <>
              {ks.length >= 2 ? (
                <Alert className="border-primary/50 bg-primary/5" role="status">
                  <CheckCircle2 className="size-4" />
                  <AlertTitle className="text-base">
                    影響が小さい案: {smaller.length === ks.length ? '差がありません（同数）' : smaller.map((k) => plans[k].name).join('・')}
                  </AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>
                      {fl0}へ行けなくなる人が少ない案です（{ks.map((k) => `${plans[k].name} ${lostText(calc.results[k][0])}・うち65歳以上${lb(calc.results[k][0].exact)}${n(calc.results[k][0].lost65)}人`).join('、')}）。
                      同数なら65歳以上が少ない方を選びます。
                    </p>
                    {anyLowerBound && (
                      <p className="font-medium">
                        複数路線の案は「少なくとも」の下限値どうしの比較です。実際の人数はこれ以上になりうるため、この判定は暫定です（減便・同時停止の影響は含みません）。
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert><Info className="size-4" /><AlertDescription>比較するには、もう1つの案にも路線を選んでください。</AlertDescription></Alert>
              )}

              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {ks.map((k) => {
                  const win = smaller.includes(k) && smaller.length < ks.length
                  return (
                    <Card key={k} className={win ? 'border-2 border-primary' : ''}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                          {plans[k].name}
                          {win && <Badge>影響が小さい案</Badge>}
                          {!calc.results[k][0].exact && <Badge variant="outline">下限値</Badge>}
                        </CardTitle>
                        <CardDescription>{plans[k].routes.map(routeName).join('、')}を廃止</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {data.facility_order.map((fk, fi) => {
                          const l = calc.results[k][fi]
                          return (
                            <div key={fk} className="rounded-md bg-muted/50 p-2">
                              <div className="text-xs text-muted-foreground">{data.facility_labels[fk]}へ行けなくなる人</div>
                              <div className={fi === 0 ? 'text-2xl font-bold' : 'text-lg font-semibold'}>{lostText(l)}</div>
                              <div className="text-sm">うち65歳以上 <b>{lb(l.exact)}{n(l.lost65)}人</b></div>
                              <div className="text-xs text-muted-foreground">診断範囲の人口の{lb(l.exact)}{pct(l.lost, calc.base[fi].pop)}%・{lb(l.exact)}{l.groups.length}地区</div>
                            </div>
                          )
                        })}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-40">指標</TableHead>
                      <TableHead className="text-right">現状（変更なし）</TableHead>
                      {ks.map((k) => (
                        <TableHead key={k} className="min-w-28 text-right">
                          {plans[k].name}{smaller.includes(k) && smaller.length < ks.length ? '（影響小）' : ''}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">止める路線</TableCell>
                      <TableCell className="text-right">なし</TableCell>
                      {ks.map((k) => (
                        <TableCell key={k} className="whitespace-normal text-right text-xs">
                          {plans[k].routes.map(routeName).join('、')}
                          {plans[k].routes.length > 1 && <div className="text-muted-foreground">{plans[k].routes.length}路線</div>}
                        </TableCell>
                      ))}
                    </TableRow>
                    {data.facility_order.map((fk, fi) => {
                      const b = calc.base[fi]
                      const rows: [string, string, (k: number) => string][] = [
                        ['行けなくなる人', '0人', (k) => lostText(calc.results[k][fi])],
                        ['　うち65歳以上', '0人', (k) => `${lb(calc.results[k][fi].exact)}${n(calc.results[k][fi].lost65)}人`],
                        ['　診断範囲の人口に占める割合', '0%', (k) => `${lb(calc.results[k][fi].exact)}${pct(calc.results[k][fi].lost, b.pop)}%`],
                        ['　影響を受ける地区数', '0', (k) => `${lb(calc.results[k][fi].exact)}${calc.results[k][fi].groups.length}`],
                      ]
                      return [
                        <TableRow key={fk + 'h'} className="bg-muted/60">
                          <TableCell colSpan={2 + ks.length} className="font-bold">行き先: {data.facility_labels[fk]}</TableCell>
                        </TableRow>,
                        <TableRow key={fk + 'b'}>
                          <TableCell>いま行ける人（徒歩・公共交通）</TableCell>
                          <TableCell className="text-right">{n(b.reach)}人<div className="text-xs text-muted-foreground">うち65歳以上 {n(b.reach65)}人</div></TableCell>
                          {ks.map((k) => <TableCell key={k} className="text-right text-muted-foreground">—</TableCell>)}
                        </TableRow>,
                        ...rows.map(([label, zero, f], ri) => (
                          <TableRow key={fk + ri}>
                            <TableCell className={ri === 0 ? 'font-medium' : ''}>{label}</TableCell>
                            <TableCell className="text-right">{zero}</TableCell>
                            {ks.map((k) => <TableCell key={k} className={`text-right ${ri === 0 ? 'text-base font-bold' : ''}`}>{f(k)}</TableCell>)}
                          </TableRow>
                        )),
                      ]
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                診断範囲の人口: {n(calc.base[0].pop)}人（うち65歳以上 {n(calc.base[0].pop65)}人、令和2年国勢調査）。「地区」は最寄りの停留所の名前でまとめた500mメッシュの集まり（行政区画ではない）。「少なくとも」は複数路線の案で、事前計算にない同時停止の影響を含まない下限。
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">会議資料にそのまま使える文</h3>
                  <Button variant="outline" size="sm" onClick={() => {
                    navigator.clipboard?.writeText(sentences.join('\n')).then(() => { setCopied(true); toast.success('文章をコピーしました') }, () => toast.error('コピーできませんでした'))
                  }}><Copy className="size-4" />{copied ? 'コピーしました' : 'コピー'}</Button>
                </div>
                {sentences.map((s, i) => <p key={i} className="rounded-md border-l-4 border-primary bg-muted/40 p-2 text-sm">{s}</p>)}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">地区ごとの内訳と地図</CardTitle>
          <CardDescription>案と行き先を選ぶと、表と地図が切り替わります。地図はオレンジ＝行けなくなる500mメッシュ、青の破線＝止める路線、灰色＝その他の路線。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!data || !calc || !ks.length ? <p className="text-sm text-muted-foreground">案がありません。</p> : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>案</Label>
                  <Tabs value={String(activePlan)} onValueChange={(v) => setSelPlan(+v)}>
                    <TabsList className="h-auto flex-wrap justify-start">
                      {ks.map((k) => <TabsTrigger key={k} value={String(k)}>{plans[k].name}</TabsTrigger>)}
                    </TabsList>
                  </Tabs>
                </div>
                <div className="space-y-1.5">
                  <Label>行き先</Label>
                  <Tabs value={String(selFac)} onValueChange={(v) => setSelFac(+v)}>
                    <TabsList className="h-auto flex-wrap justify-start">
                      {data.facility_order.map((fk, fi) => <TabsTrigger key={fk} value={String(fi)}>{data.facility_labels[fk]}</TabsTrigger>)}
                    </TabsList>
                  </Tabs>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div>
                  {(() => {
                    const l = calc.results[activePlan][selFac]
                    const fl = data.facility_labels[data.facility_order[selFac]]
                    if (!l.groups.length) return <p className="text-sm text-muted-foreground">この条件では、{plans[activePlan].name}で{fl}へ行けなくなる人はいません（他の路線で代替できる、歩いて行ける、または元から到達できない地区です）。</p>
                    return (
                      <>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>地区（最寄り停留所）</TableHead>
                                <TableHead className="text-right">行けなくなる人</TableHead>
                                <TableHead className="text-right">うち65歳以上</TableHead>
                                <TableHead className="text-right">メッシュ数</TableHead>
                                <TableHead className="text-right">停留所まで最大(m)</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {l.groups.slice(0, 15).map((g) => (
                                <TableRow key={g.name}>
                                  <TableCell className="whitespace-normal">{g.name}</TableCell>
                                  <TableCell className="text-right">{n(g.lost)}</TableCell>
                                  <TableCell className="text-right">{n(g.lost65)}</TableCell>
                                  <TableCell className="text-right">{g.meshes}</TableCell>
                                  <TableCell className="text-right">{n(g.maxDist)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {plans[activePlan].name}・{fl}・{condText}。上位15地区を表示（全{l.groups.length}地区はCSVに収録）。{l.exact ? '' : '複数路線の案のため下限。'}
                          「最寄り停留所」は収録した停留所のうちメッシュ中心に直線で最も近いもの（その停留所が止まる路線のものとは限りません）。
                        </p>
                      </>
                    )
                  })()}
                </div>
                <MapView
                  bounds={[[data.bbox[0], data.bbox[1]], [data.bbox[2], data.bbox[3]]]}
                  layers={mapLayers}
                  attribution="国土数値情報・国勢調査・GTFS（各事業者）を加工して作成"
                  className="h-[320px] sm:h-[440px]"
                  ariaLabel="地図（選んだ案で行けなくなる500mメッシュをオレンジで表示）"
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">4</span>資料用に書き出す</CardTitle>
          <CardDescription>
            比較表・地区別の内訳・診断の前提・出典を1つのCSV（UTF-8、Excelで開けるBOM付き）にします。この端末の中で作るだけで、どこにも送信しません。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={exportCsv} disabled={!calc || !ks.length}><Download className="size-4" />比較表をCSVでダウンロード</Button>
          <SourceDialog sources={sources} trigger={<Button variant="outline">出典・ライセンス</Button>} />
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">未対応事項と前提</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">{limitLines(data.params).map((t) => <li key={t}>{t}</li>)}</ul>
            <p className="mt-2 text-xs text-muted-foreground">
              データ生成日 {data.built}。診断の基準日: 平日 {data.feeds[0].ref.wd}／休日 {data.feeds[0].ref.hol}。この画面は人数を新たに推定せず、公共交通オープンデータチャレンジ向けアプリの事前計算（路線ごとの全便停止の再計算）から「行けていたのに行けなくなる」メッシュの人口を集計しているだけです。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
