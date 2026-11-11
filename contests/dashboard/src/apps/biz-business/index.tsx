import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Copy, Download, Info, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared/PageHeader'
import { StepLayout } from '@/components/shared/StepLayout'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog, type SourceItem } from '@/components/shared/SourceDialog'
import { downloadText } from '@/components/shared/downloadText'
import { useHashState } from '@/components/shared/useHashState'
import { useAppSteps } from '@/components/shared/AppSteps'
import { fetchData } from '@/lib/data'
import { isSampleMode } from '@/lib/sample'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  DAYS, DAY_LABEL, PERIODS, PERIOD_LABEL, baseline, groupByNearestStop, meshBounds, needLevel, pct, pickSmaller, find65Reversal,
  planLoss, toCsvText, type Day, type Period, type RegionData, type WhatIf,
} from './lib'
import { buildCsvRows, type PlanView } from './csv'
import { SOURCE_LINES, limitLines } from './text'

const APP = 'biz-business'
const SAMPLE_MODE = isSampleMode()
const PLAN_IDS = ['A', 'B', 'C']
const n = (x: number) => x.toLocaleString('ja-JP')

interface RegionInfo { id: string; name: string }
interface Plan { name: string; routes: number[] }
type StepId = 'cond' | 'planA' | 'planB' | 'verdict' | 'export'

const TITLES: Record<StepId, { title: string; hint: string }> = {
  cond: { title: '地域と条件を確かめる', hint: '初期値（徳島市周辺・平日朝8時・20分以内）のままで構いません' },
  planA: { title: '案Aを作る', hint: '止める路線を選ぶ（例が入っています）。地図に影響が出ます' },
  planB: { title: '案Bを作る', hint: '複数の路線を同時に止めたい場合は路線を足す（人数は下限値）' },
  verdict: { title: 'どちらの影響が小さいか確かめる', hint: '結論・下限値の意味・65歳以上の注意・詳細表' },
  export: { title: '会議資料用に書き出す', hint: '表に貼る→CSV／本文に貼る→文章' },
}

/** ToggleGroup（単一選択）。選択解除を無視する */
function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} aria-label={label} className="flex-wrap justify-start"
      onValueChange={(v) => v && onChange(v as T)}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="px-2.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export default function App() {
  const [step, setStep] = useState<StepId>('cond')
  const [visited, setVisited] = useState<Record<string, boolean>>({})
  const [mapOverride, setMapOverride] = useState<number | null>(null)
  const [regions, setRegions] = useState<RegionInfo[]>([])
  const [regionId, setRegionId] = useHashState('region', 'tokushima')
  const [data, setData] = useState<RegionData | null>(null)
  const [W, setW] = useState<WhatIf | null>(null)
  const [error, setError] = useState('')
  const [day, setDay] = useState<Day>('wd')
  const [per, setPer] = useState<Period>('m')
  const [w, setWmin] = useState(20)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selFac, setSelFac] = useState(0)
  const [exported, setExported] = useState(false)
  const [lastAction, setLastAction] = useState('')
  const [routeQ, setRouteQ] = useState<string[]>(['', '', ''])

  const pick = (s: StepId) => {
    setStep(s)
    setMapOverride(null)
  }

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
        setMapOverride(null)
        // 例として、病院・学校の合計で影響が大きい2路線を案A・案Bに1路線ずつ仮に入れる（開いた時点の条件）
        const need = needLevel(d.params.thresholds, w)
        const sel = d.routes.map((_, i) => i).filter((i) => d.routes[i][3] + d.routes[i][4] > 0)
        const both = (i: number) => [0, 1].reduce((s, fi) => s + planLoss(d.cells, wi, [i], fi, day, per, need).lost, 0)
        const ranked = sel.filter((i) => both(i) > 0).sort((a, b) => both(b) - both(a))
        let init = PLAN_IDS.map((id, k) => ({ name: `案${id}`, routes: k < 2 && ranked[k] != null ? [ranked[k]] : [] }))
        if (SAMPLE_MODE) {
          // 実行サンプル: 被験者の到達状態（案A＝28 鍛冶屋原線＋21 鳴門線、案B＝21 鳴門線）。路線名で実データから引く
          const find = (name: string) => d.routes.findIndex((r) => r[0] === name && !r[1])
          const kaji = find('28 鍛冶屋原線'), naruto = find('21 鳴門線')
          if (kaji >= 0 && naruto >= 0) init = init.map((p, k) => (k === 0 ? { ...p, routes: [kaji, naruto] } : k === 1 ? { ...p, routes: [naruto] } : p))
        }
        setPlans(init)
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
  /** 事業者名を先頭に（同名路線の見分け用） */
  const routeFull = (i: number) => {
    const base = `${data!.routes[i][2]}｜${routeName(i)}`
    // 同じ事業者・同じ表示名の系統が複数あるときは便数で区別する
    const dup = data!.routes.some((r, j) => j !== i && `${r[2]}｜${r[0]}${r[1] ? `（${r[1]}）` : ''}` === base)
    return dup ? `${base}（平日${data!.routes[i][3]}本・休日${data!.routes[i][4]}本）` : base
  }
  const condText = data ? `${DAY_LABEL[day]}${PERIOD_LABEL[per]}${data.params.start_hours[per]}時発・${w}分以内` : ''

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
  const verdict = calc && ks.length >= 2 ? pickSmaller(ks.map((k) => calc.results[k][0])) : null
  const smaller = verdict ? verdict.winners.map((i) => ks[i]) : []
  const firm = verdict?.firm ?? false
  const anyLowerBound = calc ? ks.some((k) => !calc.results[k][0].exact) : false
  const lostText = (l: { lost: number; exact: boolean }) => `${l.exact ? '' : '少なくとも'}${n(l.lost)}人`
  const lb = (exact: boolean) => (exact ? '' : '少なくとも')
  const fl0 = data ? data.facility_labels[data.facility_order[0]] : ''

  // 総数では影響が小さい案と、65歳以上で少ない案が逆転する場合の注意文
  const rev = calc && ks.length >= 2 ? find65Reversal(ks.map((k) => calc.results[k][0])) : null
  const reversalText = (() => {
    if (!calc || ks.length < 2) return ''
    const rv = rev
    if (!rv) return ''
    const w0 = ks[rv.winner], j = ks[rv.other]
    const wl = calc.results[w0][0], jl = calc.results[j][0]
    return `65歳以上では${plans[j].name}の方が少ない（${plans[j].name} ${lb(jl.exact)}${n(jl.lost65)}人 対 ${plans[w0].name} ${lb(wl.exact)}${n(wl.lost65)}人）。総数では${plans[w0].name}の方が影響が小さい案ですが、${fl0}へ行けなくなる65歳以上に配慮する場合は注意してください。`
  })()

  const sentences = useMemo(() => {
    if (!data || !calc) return []
    const base = ks.map((k) => {
      const parts = data.facility_order.map((fk, fi) => {
        const l = calc.results[k][fi]
        const top = l.groups[0]
        return `${data.facility_labels[fk]}へ行けなくなる人は${lostText(l)}（うち65歳以上${lb(l.exact)}${n(l.lost65)}人）${top ? `、最も多い地区は「${top.name}」付近の${n(top.lost)}人` : ''}`
      })
      return `${plans[k].name}（${plans[k].routes.map(routeFull).join('・')}を廃止）: ${condText}で、${parts.join('。')}。`
    })
    return reversalText ? [...base, reversalText] : base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calc, plans, condText, reversalText])

  // 地図に出す案: 案A・案Bの手順ではその案、それ以外は選択中の案
  const defaultMapPlan = step === 'cond' || step === 'planA' ? 0 : step === 'planB' ? 1 : (smaller[0] ?? ks[0] ?? 0)
  const mapPlan = mapOverride !== null && plans[mapOverride] ? mapOverride : defaultMapPlan
  const mapLayers = useMemo<MapLayer[]>(() => {
    if (!data || !calc || !plans[mapPlan] || !plans[mapPlan].routes.length) return []
    const l = calc.results[mapPlan]?.[selFac]
    if (!l) return []
    const rs = plans[mapPlan].routes
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
  }, [data, calc, plans, mapPlan, selFac])

  const updatePlan = (k: number, f: (p: Plan) => Plan) => setPlans((ps) => ps.map((p, i) => (i === k ? f(p) : p)))

  const planViews = (): PlanView[] => ks.map((k) => ({ name: plans[k].name, routes: plans[k].routes.map(routeFull), per: calc!.results[k] }))
  const makeRows = () => {
    if (!data || !calc || !ks.length) return null
    const rows = buildCsvRows(data, condText, calc.base, planViews())
    if (smaller.length) {
      rows.splice(6, 0, [
        '影響が小さい案（病院へ行けなくなる人が少ない）',
        smaller.length === ks.length ? '差なし（同数）' : smaller.map((k) => plans[k].name).join('・'),
        firm ? '確定' : '暫定（下限値どうしの比較を含む）',
      ])
    }
    if (reversalText) rows.splice(7, 0, ['注意（65歳以上）', reversalText])
    return rows
  }
  const previewRows = useMemo(() => makeRows(), // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, calc, plans, condText, smaller.join(','), firm, reversalText])
  const exportCsv = () => {
    if (!data || !calc || !ks.length) {
      toast.error('止める路線を選んだ案がありません。案Aか案Bで路線を選んでください。')
      return
    }
    const fname = `plan-comparison-${data.id}-${day}${per}${w}.csv`
    downloadText(fname, toCsvText(makeRows()!), 'text/csv;charset=utf-8')
    setExported(true)
    setLastAction(`ダウンロードフォルダに ${fname} を保存しました（保存先はブラウザの設定によります）。Excelで開けます。`)
    toast.success(`${fname} を書き出しました`, {
      description: `中身: ${ks.map((k) => plans[k].name).join('・')}の比較表、地区別の内訳、診断の前提、出典。この端末で作成しただけで、送信していません。`,
      duration: 9000,
    })
  }
  const copySentences = () => {
    if (!ks.length) { toast.error('止める路線を選んだ案がありません。'); return }
    navigator.clipboard?.writeText(sentences.join('\n')).then(
      () => {
        setExported(true)
        setLastAction(`クリップボードにコピーしました（${ks.map((k) => plans[k].name).join('・')}の${sentences.length}段落、${sentences.join('\n').length}文字）。報告書や議事録の本文に貼り付け（Ctrl+V / ⌘V）してください。`)
        toast.success('資料用の文章をコピーしました', { description: `${sentences.length}段落。各案で行けなくなる人（うち65歳以上）と最も多い地区を条件つきで入れています。`, duration: 9000 })
      },
      () => toast.error('コピーできませんでした'),
    )
  }

  const hasA = (plans[0]?.routes.length ?? 0) > 0
  const hasB = (plans[1]?.routes.length ?? 0) > 0
  // 「済」の共通ルール: 見る手順・初期値で成り立つ手順は、前提が満たされた状態で表示したら済。する手順（書き出し）は主操作で済
  const prereq: Record<StepId, boolean> = { cond: !!data, planA: hasA, planB: hasB, verdict: ks.length >= 2, export: false }
  useEffect(() => {
    if (prereq[step]) setVisited((v) => (v[step] ? v : { ...v, [step]: true }))
  })
  // 実行サンプル: 被験者は全手順を開きCSVを書き出したので、前提が満たされたら済にする（実際のダウンロードはしない）
  useEffect(() => {
    if (!SAMPLE_MODE || !data || !calc || ks.length < 2) return
    setVisited((v) => (v.cond && v.planA && v.planB && v.verdict ? v : { cond: true, planA: true, planB: true, verdict: true }))
    setExported(true)
    setLastAction(`実行サンプル: 被験者が plan-comparison-${data.id}-${day}${per}${w}.csv を書き出しました（この画面ではダウンロードは行っていません）。`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, calc === null])
  useAppSteps(
    [
      { id: 'cond', title: TITLES.cond.title, hint: '初期値のままで可', done: !!visited.cond },
      { id: 'planA', title: TITLES.planA.title, hint: '止める路線を選ぶ', done: !!visited.planA },
      { id: 'planB', title: TITLES.planB.title, hint: '複数路線にする場合は路線を足す', done: !!visited.planB },
      { id: 'verdict', title: TITLES.verdict.title, hint: '結論と詳細表', done: !!visited.verdict },
      { id: 'export', title: TITLES.export.title, hint: 'CSVまたは文章コピー', action: '書き出す（またはコピーする）と完了', done: exported },
    ],
    {
      activeId: step,
      onSelectStep: (id) => pick(id as StepId),
      description:
        '徳島市周辺の交通担当として、路線を廃止する見直し案を2つ作り、病院へ行けなくなる人（65歳以上を含む）がより少ない案を会議資料にまとめます。人数は500m四方の区画ごとの令和2年国勢調査人口の合計（推計）です。',
    },
  )

  const sources: SourceItem[] = data
    ? [
        ...(data ? limitLines(data.params).map((t) => ({ name: `前提・未対応: ${t}` })) : []),
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

  // ---------- 手順ごとのパネル ----------
  const loading = <p className="text-sm text-muted-foreground">読み込み中…</p>

  const condPanel = (
    <div className="space-y-3">
      <div className="grid gap-1.5">
        <Label htmlFor="region">地域</Label>
        <Select value={regionId} onValueChange={setRegionId}>
          <SelectTrigger id="region" className="w-full"><SelectValue placeholder="地域を選ぶ" /></SelectTrigger>
          <SelectContent>{regions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
        </Select>
        {data && <p className="text-xs text-muted-foreground">{data.reason}</p>}
      </div>
      {data && (
        <>
          <div className="space-y-1"><Label>曜日</Label>
            <Seg label="曜日" value={day} onChange={setDay} options={DAYS.map((k) => ({ value: k, label: DAY_LABEL[k] }))} /></div>
          <div className="space-y-1"><Label>時間帯</Label>
            <Seg label="時間帯" value={per} onChange={setPer} options={PERIODS.map((k) => ({ value: k, label: `${PERIOD_LABEL[k]}${data.params.start_hours[k]}時` }))} /></div>
          <div className="space-y-1"><Label>許容時間（病院・学校まで）</Label>
            <Seg label="許容時間" value={String(w)} onChange={(v) => setWmin(+v)} options={data.params.thresholds.map((t) => ({ value: String(t), label: `${t}分` }))} /></div>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        「行ける」= その時刻に500mメッシュの中心を出て、徒歩→公共交通（乗継可）→徒歩で、許容時間内に施設の近くへ着けること（待ち時間込み）。歩いて着ける地区は路線を止めても影響を受けません。
      </p>
      <p className="flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-xs">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <span>できるのは路線の廃止（全便停止）の比較のみ。減便・代替交通は未対応で、複数路線の人数は下限値です（詳細は右上の「出典・ライセンス」）。</span>
      </p>
    </div>
  )

  const planPanel = (k: number) => {
    if (!data || !calc || !plans[k]) return loading
    const p = plans[k]
    const q = routeQ[k].trim()
    const opts = calc.selectable.filter((r) => !p.routes.includes(r) && (!q || routeFull(r).includes(q)))
    const l = calc.results[k]?.[0]
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{PLAN_IDS[k]}</span>
          <Input value={p.name} maxLength={30} aria-label={`案${PLAN_IDS[k]}の名前`}
            onChange={(e) => updatePlan(k, (qq) => ({ ...qq, name: e.target.value || `案${PLAN_IDS[k]}` }))} />
        </div>
        <p className="rounded-md border-l-4 border-primary bg-primary/10 p-2 text-sm font-medium" data-testid="multi-hint">
          路線を足すと、複数路線を同時に止める案になります（人数は「少なくとも」の下限値）。足すには、下の「＋ 止める路線を追加」で選びます。
        </p>
        <div className="flex min-h-8 flex-wrap gap-1.5" data-testid={`chips-${k}`}>
          {p.routes.length ? p.routes.map((r) => (
            <Badge key={r} variant="secondary" className="gap-1 py-1 pr-1 text-xs font-normal">
              <span className="whitespace-normal text-left">{routeFull(r)}</span>
              <button type="button" aria-label={`${routeName(r)}を外す`} className="rounded p-0.5 hover:bg-background"
                onClick={() => updatePlan(k, (qq) => ({ ...qq, routes: qq.routes.filter((x) => x !== r) }))}>
                <X className="size-3.5" />
              </button>
            </Badge>
          )) : <span className="text-xs text-muted-foreground">止める路線が未選択です（現状と同じ）</span>}
        </div>
        <div className="space-y-1.5">
          <Input value={routeQ[k]} placeholder="路線名・事業者名で絞り込み（例: 鳴門）" aria-label={`案${PLAN_IDS[k]}の路線を絞り込み`}
            onChange={(e) => setRouteQ((qs) => qs.map((v, i) => (i === k ? e.target.value : v)))} />
          <select value="" aria-label={`案${PLAN_IDS[k]}に止める路線を追加`}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            onChange={(e) => {
              if (!e.target.value) return
              const r = +e.target.value
              updatePlan(k, (qq) => ({ ...qq, routes: [...qq.routes, r] }))
              setRouteQ((qs) => qs.map((v, i) => (i === k ? '' : v)))
            }}>
            <option value="">＋ 止める路線を追加…（{q ? `候補${opts.length}路線` : `残り${opts.length}路線`}）</option>
            {opts.filter((r) => calc.single.get(r)! > 0).map((r) => (
              <option key={r} value={String(r)}>
                {routeFull(r)}（平日{data.routes[r][3]}本・休日{data.routes[r][4]}本｜この路線だけを止めると{fl0}へ行けなくなる人 {n(calc.single.get(r)!)}人）
              </option>
            ))}
            {opts.some((r) => calc.single.get(r)! === 0) && (
              <optgroup label={`影響なし（${opts.filter((r) => calc.single.get(r)! === 0).length}路線。この条件では止めても${fl0}へ行けなくなる人が出ない）`}>
                {opts.filter((r) => calc.single.get(r)! === 0).map((r) => (
                  <option key={r} value={String(r)}>{routeFull(r)}（平日{data.routes[r][3]}本・休日{data.routes[r][4]}本）</option>
                ))}
              </optgroup>
            )}
          </select>
          <p className="text-xs text-muted-foreground">
            選べるのは基準日に便がある{calc.selectable.length}路線／収録{data.routes.length}路線（全便の停止のみ。減便は未対応）。
          </p>
        </div>
        {l && p.routes.length > 0 && (
          <div className="rounded-lg border bg-muted/40 p-3" data-testid={`plan-result-${k}`}>
            <div className="text-xs text-muted-foreground">この案で{fl0}へ行けなくなる人（{condText}）</div>
            <div className="text-2xl font-bold">{lostText(l)}</div>
            <div className="text-sm">うち65歳以上 <b>{lb(l.exact)}{n(l.lost65)}人</b></div>
            {!l.exact && <div className="mt-1 text-xs text-muted-foreground">重複を除いた下限。足し算ではありません。</div>}
          </div>
        )}
      </div>
    )
  }

  const verdictPanel = () => {
    if (!data || !calc) return loading
    if (ks.length < 2) {
      return <Alert><Info className="size-4" /><AlertDescription>比較するには、案Aと案Bの両方に路線を選んでください（左の手順から）。</AlertDescription></Alert>
    }
    const actPlan = ks.includes(mapPlan) ? mapPlan : ks[0]
    const lg = calc.results[actPlan][selFac]
    const fl = data.facility_labels[data.facility_order[selFac]]
    return (
      <div className="space-y-4">
        <div role="status" className="space-y-1" data-testid="verdict-main">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-bold">影響が小さい案: {smaller.length === ks.length ? '差がありません（同数）' : smaller.map((k) => plans[k].name).join('・')}{rev ? `（総数）／65歳以上では${plans[ks[rev.other]].name}` : ''}</span>
            <Badge variant={firm ? 'default' : 'outline'}>{firm ? '確定' : '暫定'}</Badge>
          </div>
          <p className="text-sm">{fl0}へ行けなくなる人が少ない案です。同数なら65歳以上が少ない方を選んでいます。</p>
          {firm && anyLowerBound && <p className="text-sm">複数路線の案の「少なくとも」がすでに相手の確定値を上回るため、結論は変わりません。</p>}
          {!firm && <p className="text-sm font-medium">暫定: 複数路線の案は「少なくとも」の下限値で、実際の人数はこれ以上になりうるため大小は確定できません。</p>}
        </div>
        {reversalText && (
          <Alert className="border-2 border-foreground/70" role="alert">
            <AlertTriangle className="size-4" />
            <AlertTitle>65歳以上では結果が逆になります</AlertTitle>
            <AlertDescription className="text-sm font-medium text-foreground">{reversalText}</AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-2 gap-2">
          {ks.map((k) => {
            const l = calc.results[k][0]
            const win = smaller.includes(k) && smaller.length < ks.length
            return (
              <div key={k} className={`rounded-lg border p-2.5 ${win ? 'border-2 border-primary' : ''}`}>
                <div className="flex flex-wrap items-center gap-1 text-sm font-bold">
                  {plans[k].name}{win && <Badge>影響小</Badge>}{rev && ks[rev.other] === k && <Badge variant="outline">65歳以上は少</Badge>}{!l.exact && <Badge variant="outline">下限値</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{fl0}へ行けなくなる人</div>
                <div className="text-xl font-bold">{lostText(l)}</div>
                <div className="text-sm">うち65歳以上 <b>{lb(l.exact)}{n(l.lost65)}人</b></div>
                {!l.exact && (
                  <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
                    <span>重複を除いた下限。足し算ではありません。</span>
                    <Tooltip>
                      <TooltipTrigger asChild><button type="button" aria-label="下限値の説明" className="shrink-0 rounded"><Info className="size-3.5" /></button></TooltipTrigger>
                      <TooltipContent className="max-w-64">路線ごとに行けなくなる区画を求め、重なる区画は1回だけ数えた合計です。同時に止めたときだけ新たに行けなくなる人は含まないので、実際の人数はこれ以上です。</TooltipContent>
                    </Tooltip>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <details className="rounded-lg border p-2" data-testid="detail-table">
          <summary className="cursor-pointer text-sm font-bold">詳細比較表（{condText}）</summary>
          <div className="mt-2">
          <div className="rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-28">指標</TableHead>
                  {ks.map((k) => <TableHead key={k} className="text-right">{plans[k].name}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>止める路線</TableCell>
                  {ks.map((k) => <TableCell key={k} className="whitespace-normal text-right text-xs">{plans[k].routes.map(routeFull).join('、')}</TableCell>)}
                </TableRow>
                {data.facility_order.map((fk, fi) => {
                  const b = calc.base[fi]
                  const rows: [string, (k: number) => string][] = [
                    ['行けなくなる人', (k) => lostText(calc.results[k][fi])],
                    ['　うち65歳以上', (k) => `${lb(calc.results[k][fi].exact)}${n(calc.results[k][fi].lost65)}人`],
                    ['　人口に占める割合', (k) => `${lb(calc.results[k][fi].exact)}${pct(calc.results[k][fi].lost, b.pop)}%`],
                    ['　影響を受ける地区数', (k) => `${lb(calc.results[k][fi].exact)}${calc.results[k][fi].groups.length}`],
                  ]
                  return [
                    <TableRow key={fk + 'h'} className="bg-muted/60">
                      <TableCell colSpan={1 + ks.length} className="whitespace-normal font-bold">
                        行き先: {data.facility_labels[fk]}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">（いま行ける人 {n(b.reach)}人・うち65歳以上 {n(b.reach65)}人）</span>
                      </TableCell>
                    </TableRow>,
                    ...rows.map(([label, f], ri) => (
                      <TableRow key={fk + ri}>
                        <TableCell className={ri === 0 ? 'font-medium' : ''}>{label}</TableCell>
                        {ks.map((k) => <TableCell key={k} className={`text-right ${ri === 0 ? 'font-bold' : ''}`}>{f(k)}</TableCell>)}
                      </TableRow>
                    )),
                  ]
                })}
              </TableBody>
            </Table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            診断範囲の人口: {n(calc.base[0].pop)}人（うち65歳以上 {n(calc.base[0].pop65)}人、令和2年国勢調査）。「地区」は最寄り停留所の名前でまとめた500mメッシュの集まり（行政区画ではない）。
          </p>
          </div>
        </details>

        <details className="space-y-2 rounded-lg border p-2" data-testid="district-table">
          <summary className="cursor-pointer text-sm font-bold">地区ごとの内訳（地図にも表示）</summary>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Seg label="案" value={String(actPlan)} onChange={(v) => setMapOverride(+v)} options={ks.map((k) => ({ value: String(k), label: plans[k].name }))} />
            <Seg label="行き先" value={String(selFac)} onChange={(v) => setSelFac(+v)} options={data.facility_order.map((fk, fi) => ({ value: String(fi), label: data.facility_labels[fk] }))} />
          </div>
          {!lg.groups.length ? (
            <p className="text-sm text-muted-foreground">この条件では、{plans[actPlan].name}で{fl}へ行けなくなる人はいません（他の路線で代替できる、歩いて行ける、または元から到達できない地区です）。</p>
          ) : (
            <>
              <div className="rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>地区（最寄り停留所）</TableHead>
                      <TableHead className="text-right">行けなくなる人</TableHead>
                      <TableHead className="text-right">うち65歳以上</TableHead>
                      <TableHead className="text-right">メッシュ数</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lg.groups.slice(0, 15).map((g) => (
                      <TableRow key={g.name}>
                        <TableCell className="whitespace-normal">{g.name}</TableCell>
                        <TableCell className="text-right">{n(g.lost)}</TableCell>
                        <TableCell className="text-right">{n(g.lost65)}</TableCell>
                        <TableCell className="text-right">{g.meshes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                {plans[actPlan].name}・{fl}。上位15地区（全{lg.groups.length}地区はCSVに収録）。{lg.exact ? '' : '複数路線の案のため下限。'}「最寄り停留所」は収録停留所のうちメッシュ中心に直線で最も近いもの（止める路線のものとは限りません）。
              </p>
            </>
          )}
        </details>
      </div>
    )
  }

  const exportPanel = () => {
    if (!data || !calc) return loading
    if (!ks.length) return <Alert><Info className="size-4" /><AlertDescription>書き出すには、案に路線を選んでください。</AlertDescription></Alert>
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium" data-testid="export-state">
          {exported ? 'この手順は完了しました。書き出したCSV／文章を会議資料に貼り付けてください。' : 'この手順は、書き出す（またはコピーする）と完了します。'}
        </p>
        <Button size="lg" className="h-12 w-full text-base" onClick={exportCsv} data-testid="export-csv"><Download className="size-5" />会議資料用にCSVで書き出す</Button>
        <Button variant="outline" size="sm" onClick={copySentences} data-testid="copy-text"><Copy className="size-4" />文章だけをコピー（本文に貼る場合）</Button>
        <p className="text-xs text-muted-foreground">使い分け: 表に貼る・集計に使う → CSV／報告書や議事録の本文に貼る → 文章。この端末の中で作るだけで、送信しません。</p>
        {lastAction && <p role="status" className="rounded-md border-l-4 border-primary bg-primary/10 p-2 text-sm font-medium">{lastAction}</p>}
        <details className="rounded-lg border p-2" data-testid="export-preview">
          <summary className="cursor-pointer text-sm font-bold">書き出す内容のプレビュー（文章全文・CSV先頭）</summary>
          <div className="mt-2 space-y-3">
        <div>
          <div className="mb-1 text-xs font-bold text-muted-foreground">資料用の文章（コピーされる全文）</div>
          <div className="space-y-1">
            {sentences.map((t, i) => <p key={i} className="rounded border-l-4 border-primary bg-muted/40 p-2 text-sm">{t}</p>)}
          </div>
        </div>
        {previewRows && (
          <div>
            <div className="mb-1 text-xs font-bold text-muted-foreground">CSVの先頭{Math.min(14, previewRows.length)}行（全{previewRows.length}行。以降は地区別の内訳・前提・出典）</div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-xs">
                <tbody>
                  {previewRows.slice(0, 14).map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      {r.length ? r.map((c, j) => <td key={j} className="max-w-56 truncate whitespace-nowrap px-2 py-1" title={String(c ?? '')}>{String(c ?? '')}</td>) : <td className="px-2 py-1">&nbsp;</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
          </div>
        </details>
      </div>
    )
  }

  const legendPlan = plans[mapPlan]
  const aside = (
    <div className="relative h-full">
      <MapView
        bounds={data ? [[data.bbox[0], data.bbox[1]], [data.bbox[2], data.bbox[3]]] : undefined}
        center={[134.54, 34.08]} zoom={10}
        layers={mapLayers}
        attribution="国土数値情報・国勢調査・GTFS（各事業者）を加工して作成"
        ariaLabel="地図（選んだ案で行けなくなる500mメッシュをオレンジで表示）"
        className="h-full"
      />
      {data && (
        <div className="absolute left-[8.5rem] right-14 top-2 flex flex-wrap items-center gap-1 rounded-md bg-background/90 p-1 shadow" data-testid="map-plan-toggle">
          <span className="px-1 text-xs font-bold">表示中:</span>
          <ToggleGroup type="single" variant="outline" size="sm" value={String(mapPlan)} aria-label="地図に表示する案"
            onValueChange={(v) => v && setMapOverride(+v)}>
            {plans.map((p, k) => p.routes.length ? (
              <ToggleGroupItem key={k} value={String(k)} className="h-7 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                {p.name}
              </ToggleGroupItem>
            ) : null)}
          </ToggleGroup>
        </div>
      )}
      <div className="pointer-events-none absolute left-2 right-14 top-12 max-w-[22rem] rounded-md bg-background/90 p-1.5 text-xs shadow" data-testid="map-legend">
        {legendPlan && legendPlan.routes.length > 0 && data
          ? <><b>{legendPlan.name}・{data.facility_labels[data.facility_order[selFac]]}</b>: オレンジ＝行けなくなる地区（500m）／青の破線＝止める路線</>
          : '路線を選ぶと、行けなくなる地区が表示されます'}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader appId={APP} compact actions={<SourceDialog sources={sources} title="出典・前提・ライセンス" />} />
      <StepLayout title={TITLES[step].title} hint={TITLES[step].hint} aside={aside}>
        {error && (
          <Alert variant="destructive" className="mb-3"><AlertTriangle className="size-4" /><AlertTitle>読み込めませんでした</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {step === 'cond' && condPanel}
        {step === 'planA' && planPanel(0)}
        {step === 'planB' && planPanel(1)}
        {step === 'verdict' && verdictPanel()}
        {step === 'export' && exportPanel()}
      </StepLayout>
    </>
  )
}
