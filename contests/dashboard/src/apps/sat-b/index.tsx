import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, SatelliteDish } from 'lucide-react'
import { StepLayout } from '@/components/shared/StepLayout'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataBadge } from '@/components/shared/DataBadge'
import { SourceDialog, type SourceItem } from '@/components/shared/SourceDialog'
import { downloadText } from '@/components/shared/downloadText'
import { useAppSteps } from '@/components/shared/AppSteps'
import { useHashState } from '@/components/shared/useHashState'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { fetchData } from '@/lib/data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_REAL, RESULTS, buildReal, buildSample, clone, filterSites, hitStats, planRoute,
  rank, toCSV, type Dataset, type Mode, type PatrolResult, type RealRaw, type Ranked, type RealWeights,
  type SampleRaw, type SampleWeights, type Weights,
} from './lib'
import { isSampleMode } from '@/lib/sample'
import { SAMPLE_RECORD } from './sample'
import { SampleFrame, SiteMap, TilePhoto } from './parts'
import { markCsv } from '../_samples/mark'


const PAGE = 25
const NATIVE_SELECT =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
// 結果の意味（このデモの実装上の扱い。業務上の正式な基準ではない）
const RESULT_HELP: [string, string][] = [
  ['是正対象', '現地で是正が必要と見たもの。「検出条件の見直し」では「当たり」として集計されます'],
  ['要継続観察', '今回は是正に至らないが、次回以降も見るもの'],
  ['問題なし', '現地で問題を確認しなかったもの'],
  ['立入不可・再訪', '立ち入れず確認できなかったもの。あらためて訪れる必要があります'],
]
const NOT_CONNECTED = '衛星由来の変化量は未接続（点数に含まれません）'

const SOURCES: SourceItem[] = [
  {
    name: '大規模盛土造成地 A54（2023年版、神奈川県）',
    provider: '国土交通省 国土数値情報', license: 'CC BY 4.0（取得日 2026-11-11）',
    url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A54.html',
    note: '造成地の位置・形・型（谷埋め型／腹付け型／区分なし）。自治体が公表した位置で、規制区域外の造成地も含みます。',
  },
  {
    name: '宅地造成等工事規制区域・特定盛土等規制区域 A56（2025年版、基準日 2025-07-18）',
    provider: '国土交通省 国土数値情報', license: 'CC BY 4.0（取得日 2026-11-11）',
    url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A56.html',
    note: '概略的な位置を示す資料で法的図書ではなく、申請・根拠資料には使えません。正確な区域は指定権者に確認してください。',
  },
  {
    name: '地理院タイル（標高タイル DEM5A／DEM10B、シームレス空中写真、年代別の空中写真 1974〜78年）',
    provider: '国土地理院', license: '国土地理院コンテンツ利用規約',
    url: 'https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html',
    note: '標高差・平均傾斜は本デモ用に算出（造成地ポリゴン内の最大−最小で、盛土の高さそのものではありません）。写真はブラウザが地理院から直接取得します。',
  },
  { name: '架空サンプル（12地点）', note: '地点・区域・変化量・許可届出・巡視結果はすべて架空です。第三者データを含みません。' },
]

const dateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`


interface Progress { data: boolean; ledger: boolean; plan: boolean; csv: boolean; record: boolean; check: boolean; last: string }
const NO_PROGRESS: Progress = { data: false, ledger: false, plan: false, csv: false, record: false, check: false, last: '' }
/** 被験者が済にした手順（報告: 手順1〜6を操作。CSV書き出しと巡視記録を実行） */
const SAMPLE_PROGRESS: Partial<Progress> = { data: true, ledger: true, plan: true, csv: true, record: true, check: true, last: SAMPLE_RECORD.siteId }
function useProgress(mode: Mode) {
  const key = `sat-b:progress:${mode}`
  const sample = isSampleMode()
  const [p, setP] = useState<Progress>(() => {
    // 実行サンプル: 被験者が済にした手順を済で始め、sessionStorage は読まない
    if (sample) return mode === 'real' ? { ...NO_PROGRESS, ...SAMPLE_PROGRESS } : NO_PROGRESS
    try { return { ...NO_PROGRESS, ...(JSON.parse(window.sessionStorage.getItem(key) ?? 'null') ?? {}) } } catch { return NO_PROGRESS }
  })
  const set = useCallback((patch: Partial<Progress>) => {
    setP((cur) => {
      const next = { ...cur, ...patch }
      if (sample) return next
      try { window.sessionStorage.setItem(key, JSON.stringify(next)) } catch { /* 無視 */ }
      return next
    })
  }, [key, sample])
  return [p, set] as const
}

function useIsDesktop() {
  const q = '(min-width: 768px)'
  const [v, setV] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(q).matches : true))
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setV(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return v
}


export default function App() {
  const [modeRaw, setMode] = useHashState('mode', 'real')
  const mode: Mode = modeRaw === 'sample' ? 'sample' : 'real'
  const [data, setData] = useState<{ real: Dataset; sample: Dataset } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchData<RealRaw>('sat-b', 'real.json'), fetchData<SampleRaw>('sat-b', 'sample.json')])
      .then(([r, s]) => alive && setData({ real: buildReal(r), sample: buildSample(s) }))
      .catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [])

  if (error) {
    return (
      <div className="p-4">
        <Alert variant="destructive"><AlertTitle>データを読み込めません</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    )
  }
  if (!data) return <div className="space-y-3"><PageHeader appId="sat-b" compact /><Skeleton className="h-64 w-full" /></div>
  return <Body key={mode} mode={mode} ds={data[mode]} setMode={setMode} />
}

type StepId = 'data' | 'ledger' | 'plan' | 'csv' | 'record' | 'check' | 'tune'
const STEP_INFO: Record<StepId, { title: string; hint: string }> = {
  data: { title: 'データを確かめる', hint: '実データ（横須賀市）の内容を確かめます' },
  ledger: { title: '台帳で優先度と内訳を見る', hint: '行か地図の点を選ぶと、地図の上に点数の内訳と前後の写真が出ます' },
  plan: { title: '件数を決めて計画を作る', hint: '巡視できる件数を入れると、優先度の上位から回り順に並びます' },
  csv: { title: '計画をCSVで書き出す', hint: '書き出す内容を確かめて保存します' },
  record: { title: '巡視結果を記録する', hint: '地点・巡視日・巡視者・結果を入れて「記録する」' },
  check: { title: '台帳に反映されたか確かめる', hint: '台帳の「最新の巡視」に、記録した結果が出ています' },
  tune: { title: '検出条件の見直し（参考）', hint: '巡視結果を集計し、型ごとの重みを手で調整します（任意）' },
}

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: string) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v)} aria-label="データの切り替え">
      <ToggleGroupItem value="real" className="h-7 px-2 text-xs">実データ（横須賀市）</ToggleGroupItem>
      <ToggleGroupItem value="sample" className="h-7 px-2 text-xs">架空サンプル</ToggleGroupItem>
    </ToggleGroup>
  )
}

function Body({ mode, ds, setMode }: { mode: Mode; ds: Dataset; setMode: (m: string) => void }) {
  const real = mode === 'real'
  // 実行サンプル（実データ版）: 被験者が最後に見た手順6の状態から始める
  const seed = isSampleMode() && real
  const [step, setStep] = useState<StepId>(seed ? 'check' : 'data')
  const [results, setResults] = useLocalStorage<PatrolResult[]>(`sat-b:results:${mode}`, [], seed ? [SAMPLE_RECORD] : [])
  const [weights, setWeights] = useLocalStorage<Weights>(`sat-b:weights:${mode}`, clone(real ? DEFAULT_WEIGHTS_REAL : DEFAULT_WEIGHTS))
  const [sel, setSel] = useState<string | null>(seed ? SAMPLE_RECORD.siteId : null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recSite, setRecSite] = useState<string>('')
  const [cap, setCap] = useState(5)
  const [zone, setZone] = useState('all')
  const [second, setSecond] = useState('all')
  const [unvisited, setUnvisited] = useState(false)
  const isDesktop = useIsDesktop()
  // 手順の進み具合（この画面を開いてからの操作で判定。前の利用者の記録は数えない）
  // 済の印はタブのセッションに保存し、再描画・再読み込みでは消さない（記録したデータの種類を変えた時だけ別管理）
  const [prog, setProg] = useProgress(mode)
  const dataChecked = prog.data, planSeen = prog.plan, planExported = prog.csv, recordedNow = prog.record, ledgerChecked = prog.check
  const lastRecorded = prog.last
  const setDataChecked = (b: boolean) => setProg({ data: b })
  useEffect(() => { if (step === 'plan' && !prog.plan) setProg({ plan: true }) }, [step, prog.plan, setProg])
  // 「見る」手順: 台帳を表示したら済（行の選択は任意の深掘り）
  useEffect(() => { if ((step === 'ledger' || sel) && !prog.ledger) setProg({ ledger: true }) }, [step, sel, prog.ledger, setProg])
  useEffect(() => { if (step === 'check' && prog.record && !prog.check) setProg({ check: true }) }, [step, prog.record, prog.check, setProg])

  const ranked = useMemo(() => rank(ds.sites, weights, ds.refDate, results, mode), [ds, weights, results, mode])
  const rows = useMemo(
    () => filterSites(ranked, mode, { zone: zone === 'all' ? '' : zone, second: second === 'all' ? '' : second, unvisited }),
    [ranked, mode, zone, second, unvisited],
  )
  const selSite = ranked.find((s) => s.id === sel) ?? null
  const plan = useMemo(() => planRoute(ranked, ds.origin, Math.max(1, Math.min(30, cap || 1))), [ranked, ds, cap])
  const note = real ? '実データ: 国土数値情報A54/A56・地理院DEM。衛星由来の変化は未接続' : 'サンプル（架空）'
  const resetAll = () => {
    setResults([])
    setWeights(clone(real ? DEFAULT_WEIGHTS_REAL : DEFAULT_WEIGHTS))
    toast.success('この端末に保存された記録と重みを消して、最初の状態に戻しました')
  }

  const select = (id: string) => { setSel(id); setDetailOpen(true) }
  
  useAppSteps(
    [
      { id: 'data', title: 'データを確かめる', hint: real ? '実データの内容を確認' : '「実データ（横須賀市）」を選ぶ', action: '確認ボタンを押すと完了', done: real && dataChecked },
      { id: 'ledger', title: '台帳で優先度と内訳を見る', hint: '台帳を開く。行を選ぶと内訳も見られる', done: prog.ledger },
      { id: 'plan', title: '件数を決めて計画を作る', hint: '巡視可能件数（初期値5）', done: planSeen },
      { id: 'csv', title: '計画をCSVで書き出す', action: '書き出すと完了', done: planExported },
      { id: 'record', title: '巡視結果を記録する', action: '記録すると完了', done: recordedNow },
      { id: 'check', title: '台帳に反映されたか確かめる', hint: '「最新の巡視」に結果が出る', done: ledgerChecked },
      { id: 'tune', title: '検出条件の見直し（参考）', optional: true, done: false },
    ],
    {
      activeId: step,
      onSelectStep: (id) => {
        if (id === 'check' && lastRecorded) { setSel(lastRecorded); setDetailOpen(false) }
        setStep(id as StepId)
      },
      description: '横須賀市の盛土規制の担当職員が、大規模盛土造成地の台帳から今月巡視する場所を決めて計画を書き出し、巡視結果を記録する。',
    },
  )

  const mapSel = step === 'record' ? recSite || null : sel
  const info = STEP_INFO[step]
  const showDetail = (step === 'ledger' || step === 'check') && detailOpen && !!selSite

  const aside = (
    <div className="relative h-full">
      <SiteMap
        ds={ds} rows={step === 'ledger' ? rows : ranked} sel={mapSel} onSelect={select}
        route={step === 'plan' || step === 'csv' ? plan.route : undefined} className="h-full"
      />
      {isDesktop && showDetail && selSite && (
        <div className="absolute inset-y-2 right-2 z-10 flex w-[min(24rem,calc(100%-1rem))] flex-col rounded-md border bg-background shadow-lg">
          <div className="flex shrink-0 items-start gap-2 border-b px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{selSite.id}</p>
              <p className="text-xs text-muted-foreground">順位 {selSite.rank}／点数 {selSite.score}</p>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="詳細を閉じる" onClick={() => setDetailOpen(false)}>閉じる</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <SiteDetail s={selSite} mode={mode} results={results} />
          </div>
        </div>
      )}
      <p className="pointer-events-none absolute bottom-6 left-2 z-10 max-w-[60%] rounded bg-background/85 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {real ? '濃い茶ほど優先度が高い（淡い橙＝低い）。大きい点は上位20か所' : '模式図（実在の地図ではありません）。濃いほど優先度が高い'}
      </p>
    </div>
  )

  return (
    <>
      <PageHeader
        appId="sat-b" compact
        actions={
          <>
            <span className="hidden items-center gap-2 md:flex">
              <ModeToggle mode={mode} setMode={setMode} />
              {real
                ? <Badge variant="outline" className="border-dashed border-amber-500 bg-amber-100 text-amber-900">衛星由来の変化量: 未接続</Badge>
                : <DataBadge kind="fictional" />}
            </span>
            <SourceDialog sources={SOURCES} />
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 md:hidden">
        <ModeToggle mode={mode} setMode={setMode} />
        {real
          ? <Badge variant="outline" className="border-dashed border-amber-500 bg-amber-100 text-amber-900">衛星由来の変化量: 未接続</Badge>
          : <DataBadge kind="fictional" />}
      </div>
      <StepLayout title={info.title} hint={info.hint} aside={aside}>
        {step === 'data' && (
          <DataPanel ds={ds} mode={mode} ranked={ranked} results={results} dataChecked={dataChecked} setDataChecked={setDataChecked} onReset={resetAll} />
        )}
        {step === 'ledger' && (
          <LedgerPanel
            mode={mode} rows={rows} sel={sel} onSelect={select} note={note} ranked={ranked}
            zone={zone} setZone={setZone} second={second} setSecond={setSecond} unvisited={unvisited} setUnvisited={setUnvisited}
          />
        )}
        {step === 'plan' && (
          <PlanPanel mode={mode} plan={plan} cap={cap} setCap={setCap} sel={sel} onSelect={select} />
        )}
        {step === 'csv' && <CsvPanel mode={mode} plan={plan} note={note} onExported={() => setProg({ csv: true })} />}
        {step === 'record' && (
          <RecordPanel
            mode={mode} ranked={ranked} planIds={plan.route.map((s) => s.id)} results={results} setResults={setResults} recSite={recSite}
            setRecSite={setRecSite} onRecorded={(id) => setProg({ record: true, last: id })}
          />
        )}
        {step === 'check' && (
          <CheckPanel plan={plan.route} mode={mode} ranked={ranked} results={results} sel={sel} onSelect={select} onReset={resetAll} />
        )}
        {step === 'tune' && <TuneTab ds={ds} mode={mode} results={results} weights={weights} setWeights={setWeights} />}
      </StepLayout>

      {!isDesktop && (
        <Sheet open={showDetail} onOpenChange={setDetailOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{selSite?.id}</SheetTitle>
              <SheetDescription>順位 {selSite?.rank}／点数 {selSite?.score}</SheetDescription>
            </SheetHeader>
            {selSite && <SiteDetail s={selSite} mode={mode} results={results} />}
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

function Metric({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-md border px-3 py-2', warn && 'border-dashed border-amber-500 bg-amber-50')}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ---------------- 1 データを確かめる ----------------
function DataPanel({ ds, mode, ranked, results, dataChecked, setDataChecked, onReset }: {
  ds: Dataset; mode: Mode; ranked: Ranked[]; results: PatrolResult[]
  dataChecked: boolean; setDataChecked: (b: boolean) => void; onReset: () => void
}) {
  const real = mode === 'real'
  const visited = ranked.filter((s) => s.latest).length
  return (
    <div className="space-y-3 text-sm">
      <Alert className={cn(real ? 'border-sky-300 bg-sky-50' : 'border-dashed border-amber-400 bg-amber-50')}>
        <SatelliteDish className="size-4" />
        <AlertTitle>{real ? `実データ版（神奈川県横須賀市・${ds.sites.length}か所）` : '架空サンプル（実在の盛土ではありません）'}</AlertTitle>
        <AlertDescription className="text-foreground">
          {real ? (
            <p>
              造成地の位置・型・規制区域は国土数値情報、標高差と傾斜は地理院DEM、写真は地理院タイルの実データです。
              <b>{NOT_CONNECTED}</b>。実運用では Sentinel-1/2 で算出する想定で、今の点数は型・区域・面積・標高差・傾斜だけの暫定です。
              衛星は「どこを先に見るか」を示すだけで、違反の判断は職員が現地で行います。内容を読んだら、下のボタンを押してください。
            </p>
          ) : (
            <p>地点・区域・変化量・許可届出・巡視結果はすべて架空で、実在の盛土や衛星解析結果ではありません。右上で「実データ（横須賀市）」に切り替えられます。</p>
          )}
        </AlertDescription>
      </Alert>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="台帳の件数" value={`${ranked.length}か所`} sub={real ? '横須賀市（A54）' : '架空'} />
        <Metric label="巡視を記録済み" value={`${visited}か所`} sub={`未巡視 ${ranked.length - visited}か所`} />
        <Metric label="記録の件数" value={`${results.length}件`} sub="この端末の記録" />
      </div>
      {real && (
        <Button
          variant={dataChecked ? 'secondary' : 'default'} className="h-auto w-full whitespace-normal py-2 text-left"
          aria-pressed={dataChecked} onClick={() => setDataChecked(!dataChecked)}
        >
          {dataChecked ? '✓ データの内容を確認しました' : 'データの内容を確認しました'}
        </Button>
      )}
      <div className="space-y-1.5 rounded-md border p-2 text-xs text-muted-foreground">
        <p>{isSampleMode() ? `記録（${results.length}件）は実行サンプルの再現で、どこにも保存されません。` : `記録（${results.length}件）はこの端末のブラウザ（localStorage）に保存されたもので、外部へは送信されません。前の利用者の記録が残っている場合があります。`}</p>
        <ResetDialog onReset={onReset} count={results.length} />
      </div>
      {real && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">できていること・いないこと</summary>
          <div className="mt-1 space-y-1">
            <p>出せた項目: 位置、型、面積、造成地内の標高差と平均傾斜、規制区域の内外と区分、前後の写真、巡視計画、巡視結果の記録と書き出し。</p>
            <p><b>出せない項目（推測値で埋めていません）</b>: 衛星由来の変化量・変化の開始時期・SARの変位、許可・届出の有無、盛土の高さ・土量、造成の時期。</p>
            <p>写真は撮影年代の異なる航空写真で、直近の変化を示すものではありません。規制区域（A56）は概略で、申請・根拠資料には使えません。出典は右上の「出典・ライセンス」。</p>
          </div>
        </details>
      )}
    </div>
  )
}

// ---------------- 2 台帳 ----------------
function LedgerPanel({ mode, rows, ranked, sel, onSelect, note, zone, setZone, second, setSecond, unvisited, setUnvisited }: {
  mode: Mode; rows: Ranked[]; ranked: Ranked[]; sel: string | null; onSelect: (id: string) => void; note: string
  zone: string; setZone: (v: string) => void; second: string; setSecond: (v: string) => void
  unvisited: boolean; setUnvisited: (b: boolean) => void
}) {
  const real = mode === 'real'
  const [shown, setShown] = useState(PAGE)
  const zs = real ? ['宅地造成等工事規制区域', '特定盛土等規制区域', '区域外'] : ['特定盛土等規制区域', '宅地造成等工事規制区域', '区域外']
  const ps = real ? ['谷埋め型', '腹付け型', '区分なし'] : ['許可・届出なし', '確認中', '許可・届出あり']
  useEffect(() => {
    if (!sel) return
    const i = rows.findIndex((s) => s.id === sel)
    if (i >= shown) setShown(i + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])
  const exportLedger = () =>
    downloadText('ledger.csv', markCsv(real
      ? toCSV(['rank', 'score', 'id', 'type', 'area_m2', 'relief_m', 'slope_deg', 'zone', 'lat', 'lon', 'latest_result', 'data_note'],
          ranked.map((s) => [s.rank, s.score, s.id, s.type, s.areaM2, s.reliefM, s.slopeDeg, s.zone, s.lat, s.lon, s.latest?.result ?? '', note]))
      : toCSV(['rank', 'score', 'id', 'name', 'change', 'zone', 'permit', 'detected', 'latest_result', 'data_note'],
          ranked.map((s) => [s.rank, s.score, s.id, s.name, s.change, s.zone, s.permit, s.detected, s.latest?.result ?? '', note]))),
    'text/csv;charset=utf-8')
  return (
    <div className="flex flex-col gap-2 md:h-full">
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <Select value={zone} onValueChange={(v) => { setZone(v); setShown(PAGE) }}>
          <SelectTrigger className="w-full" aria-label="区域で絞り込む"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">区域: すべて</SelectItem>
            {zs.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={second} onValueChange={(v) => { setSecond(v); setShown(PAGE) }}>
          <SelectTrigger className="w-full" aria-label={real ? '型で絞り込む' : '許可・届出で絞り込む'}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{real ? '型' : '許可・届出'}: すべて</SelectItem>
            {ps.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2 text-sm">
          <Checkbox checked={unvisited} onCheckedChange={(c) => { setUnvisited(c === true); setShown(PAGE) }} />未巡視のみ
        </Label>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={exportLedger}><Download className="size-3.5" />台帳の全件をCSVで保存（ledger.csv）</Button>
      </div>
      <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
        {rows.length}件中 {Math.min(rows.length, shown)}件（点数の高い順）。写真の「前」は1974〜78年、「現在」は地理院のシームレス写真。
      </p>
      <div className="overflow-x-auto rounded-md border md:min-h-0 md:flex-1 md:overflow-auto [&_[data-slot=table-container]]:overflow-visible [&_td]:px-1.5 [&_th]:px-1.5">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_var(--border)]">
            <TableRow>
              <TableHead>台帳順位</TableHead><TableHead>点数</TableHead>
              <TableHead>{real ? 'ID・型' : '名称・ID'}</TableHead>
              {real ? <><TableHead>前</TableHead><TableHead>現在</TableHead></> : <TableHead>変化</TableHead>}
              <TableHead>最新の巡視</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, shown).map((s) => (
              <TableRow
                key={s.id} data-id={s.id} data-state={s.id === sel ? 'selected' : undefined}
                className="cursor-pointer" tabIndex={0} onClick={() => onSelect(s.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id) } }}
              >
                <TableCell className="font-medium">{s.rank}</TableCell>
                <TableCell className="font-semibold">{s.score}</TableCell>
                <TableCell className="whitespace-normal break-all text-xs">
                  {real ? s.id : s.name}
                  <div className="text-muted-foreground">{real ? s.type : s.id}</div>
                </TableCell>
                {real ? (
                  <>
                    <TableCell className="w-11"><TilePhoto site={s} which="before" crop={96} className="size-10" /></TableCell>
                    <TableCell className="w-11"><TilePhoto site={s} which="now" crop={96} className="size-10" /></TableCell>
                  </>
                ) : <TableCell className="text-xs">{s.change}</TableCell>}
                <TableCell><ResultTag r={s.latest} /></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={real ? 6 : 5}>該当なし</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {rows.length > shown && <Button variant="outline" size="sm" className="shrink-0" onClick={() => setShown(shown + PAGE)}>さらに表示（+{PAGE}件）</Button>}
    </div>
  )
}

// ---------------- 3 計画 ----------------
type Plan = ReturnType<typeof planRoute<Ranked>>
function PlanPanel({ mode, plan, cap, setCap, sel, onSelect }: {
  mode: Mode; plan: Plan; cap: number; setCap: (n: number) => void; sel: string | null
  onSelect: (id: string) => void
}) {
  const real = mode === 'real'
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="sat-b-cap">今回の巡視可能件数（1〜30）</Label>
          <Input id="sat-b-cap" type="number" min={1} max={30} value={cap} className="w-28"
            onChange={(e) => setCap(Math.max(0, Math.min(30, Math.round(+e.target.value) || 0)))} />
        </div>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          点数の高い順に上位N件を選び、{real ? '市役所付近' : '役所'}からの回り順（地図上の直線距離の最近傍法）で並べます。道路事情・立入可否は考慮しません。
        </p>
      </div>
      <p className="text-xs">
        <b>同点のとき</b>は面積の大きい順、面積も同じなら ID の順（台帳と同じ順位）。内訳は各行の下に出ます。
      </p>
      <p className="rounded-md border border-dashed border-amber-500 bg-amber-50 p-1.5 text-xs">
        <b>この計画はCSVで書き出して保存してください。</b>画面を閉じると再計算されます（保存されるのは巡視結果の記録だけです）。
      </p>
      <p className="text-xs text-muted-foreground">
        {real
          ? `周回距離の目安: 約${(plan.total / 1000).toFixed(1)} km（直線距離の合計。道路距離ではありません）`
          : `周回距離の目安: ${Math.round(plan.total)}（模式図の単位。実距離ではありません）`}
        ／地図の青い番号が回る順、「起」が出発地です。
      </p>
      <div className="overflow-x-auto rounded-md border [&_td]:px-1.5 [&_th]:px-1.5">
        <Table>
          <TableHeader><TableRow><TableHead className="whitespace-nowrap">回る順</TableHead><TableHead>地点と点数の内訳</TableHead><TableHead className="whitespace-nowrap">点数・台帳順位</TableHead></TableRow></TableHeader>
          <TableBody>
            {plan.route.map((s, i) => (
              <TableRow key={s.id} data-state={s.id === sel ? 'selected' : undefined} className="cursor-pointer" onClick={() => onSelect(s.id)}>
                <TableCell className="font-bold">{i + 1}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="text-xs font-medium">{s.id}</span>
                  {s.latest && <Badge variant="outline" className="ml-1 gap-1 align-middle text-[10px]"><span aria-hidden>✔</span>巡視済み（{s.latest.date}）</Badge>}
                  <div className="mt-0.5"><PartsInline parts={s.parts} /></div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{s.score}点<div className="text-muted-foreground">台帳 {s.rank}位</div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ---------------- 4 CSV ----------------
function CsvPanel({ mode, plan, note, onExported }: { mode: Mode; plan: Plan; note: string; onExported: () => void }) {
  const real = mode === 'real'
  const header = ['order', 'id', 'score', 'type_or_change', 'zone', 'data_note']
  const csvRows = plan.route.map((s, i) => [i + 1, s.id, s.score, real ? s.type : s.change, s.zone, note])
  const exportPlan = () => {
    downloadText('patrol-plan.csv', markCsv(toCSV(header, csvRows)), 'text/csv;charset=utf-8')
    onExported()
    toast.success(`巡視計画 ${csvRows.length}か所を patrol-plan.csv として書き出しました`)
  }
  return (
    <div className="space-y-2 text-sm">
      <Button onClick={exportPlan} disabled={!csvRows.length} className="w-full sm:w-auto"><Download className="size-4" />計画をCSVで書き出す</Button>
      <p className="text-xs text-muted-foreground">書き出す内容のプレビュー（patrol-plan.csv・{csvRows.length}行・UTF-8 BOM付き）。この表がそのままCSVの中身です。件数は手順3で変えられます。</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow>{header.map((h) => <TableHead key={h} className="px-1.5 font-mono text-[10px]">{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {csvRows.map((r) => (
              <TableRow key={String(r[1])}>{r.map((c, j) => <TableCell key={j} className="whitespace-nowrap px-1.5 text-xs">{c}</TableCell>)}</TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ---------------- 5 記録 ----------------
function RecordPanel({ planIds, mode, ranked, results, setResults, recSite, setRecSite, onRecorded }: {
  planIds: string[]; mode: Mode; ranked: Ranked[]; results: PatrolResult[]; setResults: (r: PatrolResult[]) => void
  recSite: string; setRecSite: (id: string) => void; onRecorded: (id: string) => void
}) {
  const real = mode === 'real'
  const [date, setDate] = useState(dateStr())
  const [who, setWho] = useState('')
  const [result, setResult] = useState<string>('')
  const [memo, setMemo] = useState('')
  const [saved, setSaved] = useState<PatrolResult | null>(null)
  const [formError, setFormError] = useState<string[]>([])
  const [switched, setSwitched] = useState('')
  // 入った時に一度だけ、計画の未巡視の最初の地点を選んでおく（以後、記録前に勝手には変えない）
  useEffect(() => {
    if (recSite) return
    const first = planIds.find((id) => !ranked.find((s) => s.id === id)?.latest) ?? planIds[0] ?? ranked[0]?.id
    if (first) setRecSite(first)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const rec = ranked.find((s) => s.id === recSite)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problems: string[] = []
    if (!recSite) problems.push('地点を選んでください')
    if (!date) problems.push('巡視日を入れてください')
    if (!who.trim()) problems.push('巡視者を入れてください（役職名や班名で構いません）')
    if (!result) problems.push('結果を選んでください（選ぶまで記録できません）')
    if (problems.length) {
      setFormError(problems)
      toast.error(`記録できていません: ${problems.join('／')}`)
      return
    }
    setFormError([])
    const r: PatrolResult = { siteId: recSite, date, who: who.trim(), result, memo: memo.trim() }
    setResults([...results, r])
    setSaved(r); setMemo(''); setResult(''); onRecorded(r.siteId)
    // 記録後は、計画の次の未巡視の地点に切り替える（切り替えたことを下に明示する）
    const next = planIds.find((id) => id !== r.siteId && !ranked.find((s) => s.id === id)?.latest)
    if (next) { setRecSite(next); setSwitched(next) } else setSwitched('')
    toast.success(`${r.siteId} の巡視結果を記録しました`)
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3 text-sm">
      <p className="text-xs text-muted-foreground">
        {isSampleMode() ? '実行サンプルでは記録はどこにも保存されません（再読み込みで元に戻ります）。' : '記録はこのブラウザの localStorage にだけ保存され、外部へ送信しません。'}氏名等の個人情報は入れないでください。実データ版と架空サンプルで記録は別に保存されます。
      </p>
      <div className="space-y-1">
        <Label htmlFor="sat-b-site">地点{rec ? `（順位 ${rec.rank}／点数 ${rec.score}）` : ''}</Label>
        <select id="sat-b-site" aria-label="巡視した地点" value={recSite} onChange={(e) => setRecSite(e.target.value)} className={NATIVE_SELECT}>
          <optgroup label="手順3で作った計画の地点（回る順）">
            {planIds.map((id) => ranked.find((s) => s.id === id)).filter((s): s is Ranked => !!s).map((s) => (
              <option key={s.id} value={s.id}>{s.rank}位 {s.id}{real ? ` ${s.type}` : ` ${s.name}`}{s.latest ? '（巡視済み）' : ''}</option>
            ))}
          </optgroup>
          <optgroup label="台帳のそのほかの地点（順位順）">
            {ranked.filter((s) => !planIds.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.rank}位 {s.id}{real ? ` ${s.type}` : ` ${s.name}`}</option>)}
          </optgroup>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sat-b-date">巡視日</Label>
          <Input id="sat-b-date" type="date" lang="ja" value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">選択中: {date || '未入力'}（年-月-日）</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sat-b-who">巡視者（必須）</Label>
          <Input id="sat-b-who" maxLength={40} value={who} placeholder="例: 盛土班" onChange={(e) => setWho(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sat-b-result">結果（必須）</Label>
        <select id="sat-b-result" aria-label="巡視の結果" value={result} onChange={(e) => setResult(e.target.value)} className={NATIVE_SELECT}>
          <option value="">選んでください</option>
          {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <ul className="space-y-0.5 rounded-md bg-muted p-2 text-xs">
          {RESULT_HELP.map(([k, v]) => <li key={k}><b>{k}</b>: {v}</li>)}
          <li className="text-muted-foreground">※この画面での意味づけで、業務上の正式な基準ではありません。実際の判断は所属の基準に従ってください。</li>
        </ul>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sat-b-memo">メモ（任意）</Label>
        <Input id="sat-b-memo" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <Button type="submit" className="w-full sm:w-auto">記録する</Button>
      {formError.length > 0 && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>まだ記録していません</AlertTitle>
          <AlertDescription><ul className="list-disc pl-4">{formError.map((m) => <li key={m}>{m}</li>)}</ul></AlertDescription>
        </Alert>
      )}
      {saved && results.length > 0 && (
        <Alert className="border-sky-300 bg-sky-50">
          <AlertTitle>記録しました: {saved.siteId}</AlertTitle>
          <AlertDescription className="text-foreground">
            <p>{saved.date}「{saved.result}」。台帳の「最新の巡視」に反映されました（手順6で確かめられます）。</p>
            <p className="mt-1">{switched
              ? `地点を、計画の次の未巡視の地点（${switched}）に切り替えました。別の地点にするときは、上の地点欄で選び直してください。`
              : '計画の地点はすべて記録済みです。地点欄はそのままです。'}</p>
          </AlertDescription>
        </Alert>
      )}
    </form>
  )
}

// ---------------- 6 反映の確認 ----------------
function CheckPanel({ plan, ranked, results, sel, onSelect, onReset }: {
  plan: Ranked[]; mode: Mode; ranked: Ranked[]; results: PatrolResult[]; sel: string | null; onSelect: (id: string) => void; onReset: () => void
}) {
  const visited = ranked.filter((s) => s.latest)
  const planDone = plan.filter((s) => s.latest).length
  const exportRec = () =>
    downloadText('patrol-records.csv',
      markCsv(toCSV(['site_id', 'patrol_date', 'patroller', 'result', 'memo'], results.map((r) => [r.siteId, r.date, r.who, r.result, r.memo]))),
      'text/csv;charset=utf-8')
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <p className="text-xs font-medium">計画の{plan.length}件のうち、記録済み {planDone}件、未記録 {plan.length - planDone}件</p>
        <ul className="divide-y rounded-md border text-xs">
          {plan.map((s, i) => (
            <li key={s.id} data-plan-status={s.latest ? 'done' : 'todo'} className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0 break-all">回る順 {i + 1}　{s.id}</span>
              <span className="shrink-0">{s.latest ? <ResultTag r={s.latest} /> : <span className="text-muted-foreground">未記録</span>}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">台帳の「最新の巡視」（記録のある地点・{visited.length}か所）</p>
        <div className="overflow-x-auto rounded-md border [&_td]:px-1.5 [&_th]:px-1.5">
          <Table>
            <TableHeader><TableRow><TableHead>台帳順位</TableHead><TableHead>地点</TableHead><TableHead>最新の巡視</TableHead></TableRow></TableHeader>
            <TableBody>
              {visited.map((s) => (
                <TableRow key={s.id} data-id={s.id} data-state={s.id === sel ? 'selected' : undefined} className="cursor-pointer" onClick={() => onSelect(s.id)}>
                  <TableCell className="font-medium">{s.rank}</TableCell>
                  <TableCell className="whitespace-normal break-all text-xs">{s.id}<div className="text-muted-foreground">点数 {s.score}</div></TableCell>
                  <TableCell><ResultTag r={s.latest} /></TableCell>
                </TableRow>
              ))}
              {!visited.length && <TableRow><TableCell colSpan={3}>まだ記録がありません。手順5で1件記録してください。</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">行を選ぶと、地図とその地点の詳細（巡視履歴つき）が出ます。</p>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-xs font-medium">記録一覧（{results.length}件）</p>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={exportRec} disabled={!results.length}><Download className="size-3.5" />巡視記録の一覧をCSVで保存（patrol-records.csv）</Button>
        </div>
        <p className="text-xs text-muted-foreground">{isSampleMode() ? '実行サンプルの再現した記録です（保存されません）。' : 'この端末のブラウザに保存された記録です（外部へ送信されません）。前の利用者の記録が残っている場合があります。'}</p>
        <div className="overflow-x-auto rounded-md border [&_td]:px-1.5 [&_th]:px-1.5">
          <Table>
            <TableHeader><TableRow><TableHead>巡視日</TableHead><TableHead>ID</TableHead><TableHead>巡視者</TableHead><TableHead>結果</TableHead><TableHead>メモ</TableHead></TableRow></TableHeader>
            <TableBody>
              {results.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap text-xs">{r.date}</TableCell>
                  <TableCell className="whitespace-normal break-all text-xs">
                    {r.siteId}
                    {isLatestOfMany(results, i) && <Badge className="ml-1 align-middle">最新</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{r.who}</TableCell>
                  <TableCell><ResultTag r={{ ...r, date: '' }} /></TableCell>
                  <TableCell className="whitespace-normal text-xs">{r.memo}</TableCell>
                </TableRow>
              ))}
              {!results.length && <TableRow><TableCell colSpan={5}>記録なし</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <ResetDialog onReset={onReset} count={results.length} />
      </div>
    </div>
  )
}


function ResultTag({ r }: { r: PatrolResult | null }) {
  if (!r) return <span className="text-muted-foreground">未巡視</span>
  // 色に頼らず記号も付ける
  const mark = { 是正対象: '▲', 要継続観察: '◆', 問題なし: '○', '立入不可・再訪': '■' }[r.result] ?? '・'
  return (
    <span className="whitespace-nowrap">
      <Badge variant="outline" className="gap-1"><span aria-hidden>{mark}</span>{r.result}</Badge>
      {r.date && <span className="block text-xs">{r.date}</span>}
    </span>
  )
}


function SiteDetail({ s, mode, results }: { s: Ranked; mode: Mode; results: PatrolResult[] }) {
  const real = mode === 'real'
  const hist = results.filter((r) => r.siteId === s.id).reverse()
  return (
    <div className="space-y-3 text-sm">
      {real ? (
        <div className="grid grid-cols-2 gap-2">
          <figure><TilePhoto site={s} which="before" /><figcaption className="text-xs text-muted-foreground">前: 1974〜78年（地理院）</figcaption></figure>
          <figure><TilePhoto site={s} which="now" /><figcaption className="text-xs text-muted-foreground">現在（地理院シームレス写真）。黄線＝造成地</figcaption></figure>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2"><SampleFrame after={false} /><SampleFrame after /></div>
      )}
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1">
        {real ? (
          <>
            <dt className="text-muted-foreground">型</dt><dd>{s.type}（A54）</dd>
            <dt className="text-muted-foreground">面積</dt><dd>約{s.areaM2} m²</dd>
            <dt className="text-muted-foreground">標高</dt>
            <dd>{s.reliefM == null ? '算出不可（小規模でDEMの画素が少ない）' : `区域内の標高差 ${s.reliefM} m／平均傾斜 ${s.slopeDeg}°／平均標高 ${s.elevM} m（DEM${s.demRes}、${s.demPx}画素）`}</dd>
            <dt className="text-muted-foreground">区域</dt><dd>{s.zone}（A56。概略）</dd>
          </>
        ) : (
          <>
            <dt className="text-muted-foreground">検出日</dt><dd>{s.detected}（サンプル）</dd>
            <dt className="text-muted-foreground">面積</dt><dd>約{s.areaM2} m²（サンプル）</dd>
            <dt className="text-muted-foreground">メモ</dt><dd>{s.note}</dd>
          </>
        )}
      </dl>
      <div>
        <div className="mb-1 font-medium">点数の内訳（合計 {s.score}）</div>
        <ul className="space-y-0.5 rounded-md border p-2">
          {s.parts.map(([label, p]) => (
            <li key={label} className="flex justify-between gap-2">
              <span>{p == null ? '衛星由来' : label}</span>
              {p == null
                ? <span className="shrink-0 font-medium text-amber-800">点数外</span>
                : <span className="shrink-0 font-mono">{p >= 0 ? '+' : ''}{p}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-1 font-medium">巡視履歴</div>
        {hist.length
          ? <ul className="space-y-0.5">{hist.map((r, i) => <li key={i}>{r.date} {r.result}{r.memo ? `（${r.memo}）` : ''}</li>)}</ul>
          : <span className="text-muted-foreground">なし</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {real && s.lat != null && (
          <Button size="sm" variant="outline" asChild>
            <a href={`https://maps.gsi.go.jp/#17/${s.lat}/${s.lon}/`} target="_blank" rel="noopener noreferrer">地理院地図で開く</a>
          </Button>
        )}
      </div>
    </div>
  )
}



/** 点数の内訳を短く並べる（例: 型 +25）。未接続は点数に含めない旨を出す */
function PartsInline({ parts }: { parts: Ranked['parts'] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
      {parts.map(([label, p]) => (
        <li key={label} className="whitespace-nowrap">
          {p == null ? <span className="text-amber-800">衛星由来: 点数外</span> : <>{label.split('（')[0]} <b className="font-mono">{p >= 0 ? '+' : ''}{p}</b></>}
        </li>
      ))}
    </ul>
  )
}


// ---------------- ④ 検出条件の見直し ----------------
function TuneTab({ ds, mode, results, weights, setWeights }: {
  ds: Dataset; mode: Mode; results: PatrolResult[]; weights: Weights; setWeights: (w: Weights) => void
}) {
  const real = mode === 'real'
  const key = real ? 'type' : 'change'
  const st = hitStats(ds.sites, results, key)
  const def = (real ? DEFAULT_WEIGHTS_REAL.type : DEFAULT_WEIGHTS.change) as Record<string, number>
  const cur = (real ? (weights as RealWeights).type : (weights as SampleWeights).change) as Record<string, number>
  const set = (c: string, v: number) => {
    const w = clone(weights)
    const target = (real ? (w as RealWeights).type : (w as SampleWeights).change) as Record<string, number>
    target[c] = Math.max(0, Math.min(50, v || 0))
    setWeights(w)
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        巡視結果を、{real ? '型（実データ）' : '変化の種類（サンプル）'}ごとに集計します。件数が少ないうちは率を出さず、重みの見直しは職員が判断します（自動では変えません）。
        重みを変えると、台帳の点数と順位にすぐ反映されます。
      </p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>区分</TableHead><TableHead>巡視件数</TableHead><TableHead>是正対象</TableHead><TableHead>初期の重み</TableHead><TableHead>変更後の重み（0〜50）</TableHead></TableRow></TableHeader>
          <TableBody>
            {Object.keys(def).map((c) => {
              const o = st[c] ?? { n: 0, hit: 0 }
              return (
                <TableRow key={c}>
                  <TableCell className="whitespace-nowrap">{c}</TableCell>
                  <TableCell>{o.n}</TableCell>
                  <TableCell className="whitespace-normal">{o.hit}{o.n >= 5 ? `（${Math.round((100 * o.hit) / o.n)}%）` : '（件数が少なく率は出しません）'}</TableCell>
                  <TableCell>{def[c]}</TableCell>
                  <TableCell><Input type="number" min={0} max={50} className="w-24" aria-label={`${c}の重み`} value={cur[c]} onChange={(e) => set(c, +e.target.value)} /></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <Button variant="outline" size="sm" onClick={() => { setWeights(clone(real ? DEFAULT_WEIGHTS_REAL : DEFAULT_WEIGHTS)); toast('重みを初期値に戻しました') }}>重みを初期値に戻す</Button>
      <p className="text-xs text-muted-foreground">重みとしきい値の初期値は説明用の仮置きで、根拠のある値ではありません。</p>
    </div>
  )
}



/** 同じ地点に複数の記録があり、i 番目がその地点の最新のとき true */
function isLatestOfMany(results: PatrolResult[], i: number): boolean {
  const id = results[i].siteId
  let n = 0, last = -1
  for (let k = 0; k < results.length; k++) if (results[k].siteId === id) { n++; last = k }
  return n > 1 && last === i
}

function ResetDialog({ onReset, count }: { onReset: () => void; count: number }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={count === 0}>記録をすべて消して最初の状態に戻す</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>記録をすべて消して最初の状態に戻しますか</DialogTitle>
          <DialogDescription>
            このデータ（実データ／架空サンプルのうち表示中の側）について、この端末のブラウザに保存された巡視記録 {count}件と、検出条件の重みの変更を消します。元に戻せません。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>やめる</Button>
          <Button variant="destructive" onClick={() => { onReset(); setOpen(false) }}>すべて消す</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}