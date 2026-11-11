import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ClipboardList, Download, MapPin, Route as RouteIcon, SatelliteDish } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataBadge } from '@/components/shared/DataBadge'
import { SourceDialog, type SourceItem } from '@/components/shared/SourceDialog'
import { downloadText } from '@/components/shared/downloadText'
import { useHashState } from '@/components/shared/useHashState'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { fetchData } from '@/lib/data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_REAL, RESULTS, buildReal, buildSample, clone, filterSites, hitStats, planRoute,
  rank, toCSV, type Dataset, type Mode, type PatrolResult, type RealRaw, type Ranked, type RealWeights,
  type SampleRaw, type SampleWeights, type Weights,
} from './lib'
import { SampleFrame, SiteMap, TilePhoto } from './parts'

const PAGE = 25
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

function useIsDesktop() {
  const q = '(min-width: 1024px)'
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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader appId="sat-b" actions={<SourceDialog sources={SOURCES} />} />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="データの切り替え">
        <span className="text-sm font-medium">データ:</span>
        <ToggleGroup
          type="single" variant="outline" value={mode}
          onValueChange={(v) => v && setMode(v)}
        >
          <ToggleGroupItem value="real" className="px-3">実データ（横須賀市）</ToggleGroupItem>
          <ToggleGroupItem value="sample" className="px-3">架空サンプル</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {error && (
        <Alert variant="destructive"><AlertTitle>データを読み込めません</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      )}
      {!data && !error && <Skeleton className="h-64 w-full" />}
      {data && <Body key={mode} mode={mode} ds={data[mode]} />}
    </div>
  )
}

function Body({ mode, ds }: { mode: Mode; ds: Dataset }) {
  const real = mode === 'real'
  const [tab, setTab] = useHashState('tab', 'ledger')
  const [results, setResults] = useLocalStorage<PatrolResult[]>(`sat-b:results:${mode}`, [])
  const [weights, setWeights] = useLocalStorage<Weights>(`sat-b:weights:${mode}`, clone(real ? DEFAULT_WEIGHTS_REAL : DEFAULT_WEIGHTS))
  const [sel, setSel] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [recSite, setRecSite] = useState<string>('')
  const [cap, setCap] = useState(5)
  const isDesktop = useIsDesktop()

  const ranked = useMemo(() => rank(ds.sites, weights, ds.refDate, results, mode), [ds, weights, results, mode])
  const selSite = ranked.find((s) => s.id === sel) ?? null
  const plan = useMemo(() => planRoute(ranked, ds.origin, Math.max(1, Math.min(30, cap || 1))), [ranked, ds, cap])
  const resetAll = () => {
    setResults([])
    setWeights(clone(real ? DEFAULT_WEIGHTS_REAL : DEFAULT_WEIGHTS))
    toast.success('この端末に保存された記録と重みを消して、最初の状態に戻しました')
  }

  const visited = ranked.filter((s) => s.latest).length
  const hits = ranked.filter((s) => s.latest?.result === '是正対象').length
  const note = real ? '実データ: 国土数値情報A54/A56・地理院DEM。衛星由来の変化は未接続' : 'サンプル（架空）'

  const select = (id: string) => { setSel(id); if (!isDesktop) setDetailOpen(true) }
  const goRecord = (id: string) => {
    setRecSite(id); setDetailOpen(false); setTab('record')
    toast(`③ 結果の記録に切り替えました（地点: ${id}）`)
  }

  return (
    <>
      <Alert className={cn(real ? 'border-sky-300 bg-sky-50' : 'border-dashed border-amber-400 bg-amber-50')}>
        <SatelliteDish className="size-4" />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          {real ? <>実データ版（神奈川県横須賀市・大規模盛土造成地 {ds.sites.length}か所）</> : <>架空サンプル（実在の盛土ではありません）</>}
          <DataBadge kind={real ? 'real' : 'fictional'} />
          {real && <Badge variant="outline" className="border-dashed border-amber-500 bg-amber-100 text-amber-900">衛星由来の変化量: 未接続</Badge>}
        </AlertTitle>
        <AlertDescription className="text-foreground">
          {real ? (
            <p>造成地の位置・型・規制区域は国土数値情報、標高差と傾斜は地理院DEM、写真は地理院タイルの実データです。
              <b>{NOT_CONNECTED}</b>。実運用では Sentinel-1/2 で算出する想定で、今の点数は実指標（型・区域・面積・標高差・傾斜）だけの暫定です。
              衛星は「どこを先に見るか」を示すだけで、違反の判断は職員が現地で行います。巡視結果は利用者の入力です。</p>
          ) : (
            <p>地点・区域・変化量・許可届出・巡視結果はすべて架空で、実在の盛土や衛星解析結果ではありません。</p>
          )}
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="台帳の件数" value={`${ranked.length}か所`} sub={real ? '横須賀市（A54）' : '架空'} />
        <Metric label="巡視を記録済み" value={`${visited}か所`} sub={`未巡視 ${ranked.length - visited}か所／この端末のブラウザに保存された記録です`} />
        <Metric label="最新の結果が是正対象" value={`${hits}か所`} sub="記録した結果から集計" />
        <Metric label="衛星由来の変化量" value={real ? '未接続' : '架空'} sub={real ? '点数に含まれない' : 'サンプルの値'} warn={real} />
      </div>

      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        記録（{results.length}件）はこの端末のブラウザ（localStorage）に保存されたもので、外部へは送信されません。前の利用者の記録が残っている場合があります。
        <ResetDialog onReset={resetAll} count={results.length} />
      </p>

      <section aria-label="使い方（3ステップ）" className="space-y-1.5">
        <p className="text-sm font-medium">使い方: 今月の巡視先を決めて、計画を書き出し、結果を記録します</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Step n={1} icon={<MapPin className="size-4" />} title="台帳で優先度を確認" body="点数の高い順に並びます。行を選ぶと内訳と前後の写真が見られます。" onClick={() => setTab('ledger')} active={tab === 'ledger'} />
          <Step n={2} icon={<RouteIcon className="size-4" />} title="巡視計画をCSVに書き出す" body="件数を入れると、上位から回り順に並びます。" onClick={() => setTab('plan')} active={tab === 'plan'} />
          <Step n={3} icon={<ClipboardList className="size-4" />} title="巡視結果を記録" body="記録は台帳の「最新の巡視」に反映されます。" onClick={() => setTab('record')} active={tab === 'record'} />
        </div>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:grid-cols-5">
          <TabsTrigger value="ledger">① 台帳</TabsTrigger>
          <TabsTrigger value="plan">② 巡視計画</TabsTrigger>
          <TabsTrigger value="record">③ 結果の記録</TabsTrigger>
          <TabsTrigger value="tune">④ 検出条件の見直し</TabsTrigger>
          <TabsTrigger value="about">出典・注意</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <LedgerTab
            ds={ds} mode={mode} ranked={ranked} sel={sel} onSelect={select} isDesktop={isDesktop}
            note={note} onRecord={goRecord} selSite={selSite} results={results}
          />
        </TabsContent>
        <TabsContent value="plan">
          <PlanTab ds={ds} mode={mode} ranked={ranked} plan={plan} cap={cap} setCap={setCap} note={note} onRecord={goRecord} onSelect={select} sel={sel} />
        </TabsContent>
        <TabsContent value="record">
          <RecordTab
            ds={ds} mode={mode} ranked={ranked} results={results} setResults={setResults}
            recSite={recSite || ranked[0]?.id || ''} setRecSite={setRecSite} plan={plan.route} onReset={resetAll}
            onShowLedger={(id) => { setSel(id); setTab('ledger') }}
          />
        </TabsContent>
        <TabsContent value="tune">
          <TuneTab ds={ds} mode={mode} results={results} weights={weights} setWeights={setWeights} />
        </TabsContent>
        <TabsContent value="about"><AboutTab mode={mode} ds={ds} /></TabsContent>
      </Tabs>

      {!isDesktop && (
        <Sheet open={detailOpen && !!selSite} onOpenChange={setDetailOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4">
            <SheetHeader className="p-0">
              <SheetTitle>{selSite?.id}</SheetTitle>
              <SheetDescription>順位 {selSite?.rank}／点数 {selSite?.score}</SheetDescription>
            </SheetHeader>
            {selSite && <SiteDetail s={selSite} mode={mode} results={results} onRecord={goRecord} />}
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

function Metric({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card className={cn('gap-1 py-3', warn && 'border-dashed border-amber-500 bg-amber-50')}>
      <CardContent className="px-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function Step({ n, icon, title, body, onClick, active }: {
  n: number; icon: React.ReactNode; title: string; body: string; onClick: () => void; active: boolean
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn('flex items-start gap-3 rounded-md border p-2 text-left sm:p-3 transition-colors hover:bg-accent', active && 'border-primary bg-accent')}
    >
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</span>
      <span className="space-y-0.5">
        <span className="flex items-center gap-1 text-sm font-medium">{icon}{title}</span>
        <span className="hidden text-xs text-muted-foreground sm:block">{body}</span>
      </span>
    </button>
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

// ---------------- ① 台帳 ----------------
function LedgerTab({ ds, mode, ranked, sel, onSelect, isDesktop, note, onRecord, selSite, results }: {
  ds: Dataset; mode: Mode; ranked: Ranked[]; sel: string | null; onSelect: (id: string) => void; isDesktop: boolean
  note: string; onRecord: (id: string) => void; selSite: Ranked | null; results: PatrolResult[]
}) {
  const real = mode === 'real'
  const [zone, setZone] = useState('all')
  const [second, setSecond] = useState('all')
  const [unvisited, setUnvisited] = useState(false)
  const [shown, setShown] = useState(PAGE)
  const zs = real ? ['宅地造成等工事規制区域', '特定盛土等規制区域', '区域外'] : ['特定盛土等規制区域', '宅地造成等工事規制区域', '区域外']
  const ps = real ? ['谷埋め型', '腹付け型', '区分なし'] : ['許可・届出なし', '確認中', '許可・届出あり']
  const rows = useMemo(
    () => filterSites(ranked, mode, { zone: zone === 'all' ? '' : zone, second: second === 'all' ? '' : second, unvisited }),
    [ranked, mode, zone, second, unvisited],
  )
  // 選択した地点が一覧の外にあれば、表示件数を広げる
  useEffect(() => {
    if (!sel) return
    const i = rows.findIndex((s) => s.id === sel)
    if (i >= shown) setShown(i + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])
  const reset = () => setShown(PAGE)

  const exportLedger = () =>
    downloadText('ledger.csv', real
      ? toCSV(['rank', 'score', 'id', 'type', 'area_m2', 'relief_m', 'slope_deg', 'zone', 'lat', 'lon', 'latest_result', 'data_note'],
          ranked.map((s) => [s.rank, s.score, s.id, s.type, s.areaM2, s.reliefM, s.slopeDeg, s.zone, s.lat, s.lon, s.latest?.result ?? '', note]))
      : toCSV(['rank', 'score', 'id', 'name', 'change', 'zone', 'permit', 'detected', 'latest_result', 'data_note'],
          ranked.map((s) => [s.rank, s.score, s.id, s.name, s.change, s.zone, s.permit, s.detected, s.latest?.result ?? '', note])),
    'text/csv;charset=utf-8')

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">区域</Label>
            <Select value={zone} onValueChange={(v) => { setZone(v); reset() }}>
              <SelectTrigger className="w-52 max-w-full" aria-label="区域で絞り込む"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {zs.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{real ? '型' : '許可・届出'}</Label>
            <Select value={second} onValueChange={(v) => { setSecond(v); reset() }}>
              <SelectTrigger className="w-40" aria-label={real ? '型で絞り込む' : '許可・届出で絞り込む'}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべて</SelectItem>
                {ps.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox checked={unvisited} onCheckedChange={(c) => { setUnvisited(c === true); reset() }} />未巡視のみ
          </Label>
          <Button variant="outline" size="sm" className="ml-auto" onClick={exportLedger}><Download className="size-4" />台帳をCSVで書き出す</Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {rows.length}件中 {Math.min(rows.length, shown)}件を表示（点数の高い順）。行を選ぶと地図と内訳が出ます。写真の「前」は1974〜78年、「現在」は地理院のシームレス写真です。
        </p>
        <p className="text-xs text-muted-foreground sm:hidden">表は左右にスクロールできます →</p>
        <div className="overflow-x-auto rounded-md border [&_td]:px-2 [&_th]:px-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>順位</TableHead>
                <TableHead>点数</TableHead>
                <TableHead>ID</TableHead>
                {real ? (
                  <>
                    <TableHead>前</TableHead>
                    <TableHead>現在</TableHead>
                    <TableHead>型</TableHead>
                    <TableHead className="hidden 2xl:table-cell">面積(m²)</TableHead>
                    <TableHead className="hidden 2xl:table-cell">標高差(m)</TableHead>
                    <TableHead className="hidden 2xl:table-cell">傾斜(°)</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead>名称</TableHead><TableHead>変化</TableHead>
                    <TableHead className="hidden 2xl:table-cell">区域</TableHead><TableHead>許可・届出</TableHead>
                  </>
                )}
                <TableHead>最新の巡視</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, shown).map((s) => (
                <TableRow
                  key={s.id} data-id={s.id} data-state={s.id === sel ? 'selected' : undefined}
                  className="cursor-pointer" tabIndex={0}
                  onClick={() => onSelect(s.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id) } }}
                >
                  <TableCell className="font-medium">{s.rank}</TableCell>
                  <TableCell className="font-semibold">{s.score}</TableCell>
                  <TableCell className="min-w-24 whitespace-normal break-all text-xs sm:text-sm">{s.id}</TableCell>
                  {real ? (
                    <>
                      <TableCell className="w-16"><TilePhoto site={s} which="before" crop={96} className="size-14" /></TableCell>
                      <TableCell className="w-16"><TilePhoto site={s} which="now" crop={96} className="size-14" /></TableCell>
                      <TableCell className="whitespace-nowrap">{s.type}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{s.areaM2}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{s.reliefM ?? '算出不可'}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{s.slopeDeg ?? '算出不可'}</TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell>{s.name}</TableCell><TableCell>{s.change}</TableCell>
                      <TableCell className="hidden 2xl:table-cell">{s.zone}</TableCell><TableCell>{s.permit}</TableCell>
                    </>
                  )}
                  <TableCell><ResultTag r={s.latest} /></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={real ? 10 : 8}>該当なし</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        {rows.length > shown && <Button variant="outline" onClick={() => setShown(shown + PAGE)}>さらに表示（+{PAGE}件）</Button>}
      </div>

      <div className="min-w-0 space-y-3 lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
        <SiteMap ds={ds} rows={rows} sel={sel} onSelect={onSelect} className="h-64 lg:h-[220px]" />
        <p className="text-xs text-muted-foreground">
          {real
            ? '造成地の位置（国土数値情報 A54）と規制区域（A56）の概略図。濃い茶ほど優先度が高い（淡い橙＝低い）。大きい点は上位20か所。'
            : '模式図（実在の地図ではありません）。濃いほど優先度が高い。数字は順位。'}
        </p>
        {isDesktop && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{selSite ? `${selSite.id}（順位 ${selSite.rank}／点数 ${selSite.score}）` : '地点の詳細'}</CardTitle>
            </CardHeader>
            <CardContent>
              {selSite
                ? <SiteDetail s={selSite} mode={mode} results={results} onRecord={onRecord} />
                : <p className="text-sm text-muted-foreground">左の表か地図で地点を選ぶと、点数の内訳と巡視記録が見られます。</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function SiteDetail({ s, mode, results, onRecord }: { s: Ranked; mode: Mode; results: PatrolResult[]; onRecord: (id: string) => void }) {
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
            <dt className="text-muted-foreground">衛星由来の変化</dt><dd><b>未接続</b>（実運用では Sentinel-1/2 で算出）。点数に含めていません</dd>
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
              <span>{label}</span>
              {p == null
                ? <span className="shrink-0 font-medium text-amber-800">— 点数に含めない</span>
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
        <Button size="sm" onClick={() => onRecord(s.id)}><ClipboardList className="size-4" />この地点の結果を記録する</Button>
        {real && s.lat != null && (
          <Button size="sm" variant="outline" asChild>
            <a href={`https://maps.gsi.go.jp/#17/${s.lat}/${s.lon}/`} target="_blank" rel="noopener noreferrer">地理院地図で開く</a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------- ② 巡視計画 ----------------
function PlanTab({ ds, mode, ranked, plan, cap, setCap, note, onRecord, onSelect, sel }: {
  ds: Dataset; mode: Mode; ranked: Ranked[]; plan: ReturnType<typeof planRoute<Ranked>>; cap: number; setCap: (n: number) => void; note: string
  onRecord: (id: string) => void; onSelect: (id: string) => void; sel: string | null
}) {
  const real = mode === 'real'
  const exportPlan = () => {
    downloadText('patrol-plan.csv',
      toCSV(['order', 'id', 'score', 'type_or_change', 'zone', 'data_note'],
        plan.route.map((s, i) => [i + 1, s.id, s.score, real ? s.type : s.change, s.zone, note])),
      'text/csv;charset=utf-8')
    toast.success(`巡視計画 ${plan.route.length}か所を patrol-plan.csv として書き出しました`)
  }
  const header = ['order', 'id', 'score', 'type_or_change', 'zone', 'data_note']
  const csvRows = plan.route.map((s, i) => [i + 1, s.id, s.score, real ? s.type : s.change, s.zone, note])
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sat-b-cap">今回の巡視可能件数（1〜30）</Label>
            <Input id="sat-b-cap" type="number" min={1} max={30} value={cap} className="w-28"
              onChange={(e) => setCap(Math.max(0, Math.min(30, Math.round(+e.target.value) || 0)))} />
          </div>
          <Button onClick={exportPlan} disabled={!plan.route.length}><Download className="size-4" />計画をCSVで書き出す</Button>
          <p className="basis-full text-sm text-muted-foreground">
            {real
              ? '点数の高い順に上位N件を選び、市役所付近からの回り順（地図上の直線距離の最近傍法）で並べます。道路事情・立入可否は考慮しません。'
              : '点数の高い順に上位N件を選び、役所からの回り順（地図上の直線距離の最近傍法）で並べます。実際の道路事情・立入可否は考慮しません。'}
          </p>
          <p className="basis-full text-sm">
            <b>同点のときの並べ方</b>: 点数が同じ場合は面積の大きい順、面積も同じなら ID の順で順位を付けています（台帳と同じ順位です）。
            下の表の「点数の内訳」で、なぜその地点が選ばれたかを確認できます。
          </p>
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">優先度の上位 {plan.route.length}か所（回る順）</p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>回る順</TableHead><TableHead>ID</TableHead><TableHead>点数（順位）</TableHead>
                <TableHead className="hidden sm:table-cell">{real ? '型・面積' : '変化・許可届出'}</TableHead>
                <TableHead className="hidden md:table-cell">点数の内訳</TableHead><TableHead>記録</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.route.map((s, i) => (
                <TableRow key={s.id} data-state={s.id === sel ? 'selected' : undefined} className="cursor-pointer" onClick={() => onSelect(s.id)}>
                  <TableCell className="font-bold">{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.id}
                    {s.latest && <Badge variant="outline" className="ml-1 gap-1 align-middle"><span aria-hidden>✔</span>巡視済み（{s.latest.date}）</Badge>}
                    <div className="mt-1 whitespace-normal md:hidden"><PartsInline parts={s.parts} /></div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{s.score}（{s.rank}位）</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{real ? `${s.type}・${s.areaM2} m²` : `${s.change}・${s.permit}`}</TableCell>
                  <TableCell className="hidden whitespace-normal md:table-cell"><PartsInline parts={s.parts} /></TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRecord(s.id) }}>記録する</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-sm text-muted-foreground">
          {real
            ? `地図上の周回距離の目安: 約${(plan.total / 1000).toFixed(1)} km（直線距離の合計。道路距離ではありません）`
            : `地図上の周回距離の目安: ${Math.round(plan.total)}（模式図の単位。実距離ではありません）`}
        </p>
        <p className="text-xs text-muted-foreground">{NOT_CONNECTED}。順位は型・区域・面積・標高差・傾斜だけで決まっています。</p>
      </div>

      <div className="min-w-0 space-y-1">
        <SiteMap ds={ds} rows={ranked} sel={sel} onSelect={onSelect} route={plan.route} className="h-72 lg:h-[400px]" />
        <p className="text-xs text-muted-foreground">青い丸の番号が回る順、「起」が出発地（{ds.origin.name}）。点線は直線で結んだ目安の経路です。</p>
      </div>

      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">書き出す内容のプレビュー（patrol-plan.csv・{csvRows.length}行）</p>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow>{header.map((h) => <TableHead key={h} className="font-mono text-xs">{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>
              {csvRows.map((r) => (
                <TableRow key={String(r[1])}>{r.map((c, j) => <TableCell key={j} className="whitespace-nowrap text-xs">{c}</TableCell>)}</TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">この表がそのままCSV（UTF-8・BOM付き）の中身です。「計画をCSVで書き出す」で保存されます。</p>
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
          {p == null ? <span className="text-amber-800">衛星由来の変化 未接続（点数外）</span> : <>{label.split('（')[0]} <b className="font-mono">{p >= 0 ? '+' : ''}{p}</b></>}
        </li>
      ))}
    </ul>
  )
}

// ---------------- ③ 結果の記録 ----------------
function RecordTab({ ds, mode, ranked, results, setResults, recSite, setRecSite, onShowLedger, plan, onReset }: {
  ds: Dataset; mode: Mode; ranked: Ranked[]; results: PatrolResult[]; setResults: (r: PatrolResult[]) => void
  recSite: string; setRecSite: (id: string) => void; onShowLedger: (id: string) => void
  plan: Ranked[]; onReset: () => void
}) {
  const real = mode === 'real'
  const [date, setDate] = useState(dateStr())
  const [who, setWho] = useState('')
  const [result, setResult] = useState<string>(RESULTS[0])
  const [memo, setMemo] = useState('')
  const [saved, setSaved] = useState<PatrolResult | null>(null)
  const shownSaved = saved && results.length > 0 ? saved : null
  // 計画の中で、いま保存した地点より後ろの未記録の地点（なければ先頭から探す）
  const nextSite = useMemo(() => {
    if (!saved) return null
    const i = plan.findIndex((s) => s.id === saved.siteId)
    const order = [...plan.slice(i + 1), ...plan.slice(0, Math.max(0, i + 1))]
    return order.find((s) => !s.latest && s.id !== saved.siteId) ?? null
  }, [plan, saved])
  const goNext = () => {
    if (!nextSite) return
    setRecSite(nextSite.id); setSaved(null)
    toast(`次の地点に切り替えました: ${nextSite.id}`)
  }
  const rec = ranked.find((s) => s.id === recSite)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!who.trim() || !date || !recSite) return
    const r: PatrolResult = { siteId: recSite, date, who: who.trim(), result, memo: memo.trim() }
    setResults([...results, r])
    setSaved(r); setMemo('')
    toast.success(`${r.siteId} の巡視結果を記録しました。台帳の「最新の巡視」に反映されています`)
  }
  const exportRec = () =>
    downloadText('patrol-records.csv',
      toCSV(['site_id', 'patrol_date', 'patroller', 'result', 'memo'], results.map((r) => [r.siteId, r.date, r.who, r.result, r.memo])),
      'text/csv;charset=utf-8')

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <Card className="min-w-0 self-start">
        <CardHeader>
          <CardTitle className="text-base">巡視結果を1件記録する</CardTitle>
          <CardDescription>
            記録はこのブラウザの localStorage にだけ保存され、外部へ送信しません。氏名等の個人情報は入れないでください（巡視者は役職名や班名で構いません）。
            実データ版と架空サンプルで記録は別に保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <Label>地点{rec ? `（順位 ${rec.rank}／点数 ${rec.score}）` : ''}</Label>
              <Select value={recSite} onValueChange={setRecSite}>
                <SelectTrigger className="w-full" aria-label="巡視した地点"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ranked.map((s) => <SelectItem key={s.id} value={s.id}>{s.rank}位 {s.id}{real ? ` ${s.type}` : ` ${s.name}`}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sat-b-date">巡視日</Label>
                <Input id="sat-b-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sat-b-who">巡視者（必須）</Label>
                <Input id="sat-b-who" required maxLength={40} value={who} placeholder="例: 盛土班" onChange={(e) => setWho(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>結果</Label>
              <Select value={result} onValueChange={setResult}>
                <SelectTrigger className="w-full" aria-label="巡視の結果"><SelectValue /></SelectTrigger>
                <SelectContent>{RESULTS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sat-b-memo">メモ（任意）</Label>
              <Input id="sat-b-memo" maxLength={200} value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
            <Button type="submit" className="w-full sm:w-auto">記録する</Button>
          </form>
          {shownSaved && (
            <Alert className="mt-3 border-sky-300 bg-sky-50">
              <AlertTitle>記録しました: {shownSaved.siteId}</AlertTitle>
              <AlertDescription className="text-foreground">
                <p>{shownSaved.date}「{shownSaved.result}」。台帳の「最新の巡視」に反映されています。</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onShowLedger(shownSaved.siteId)}>台帳で確認する</Button>
                  {nextSite
                    ? <Button size="sm" onClick={goNext}>計画の次の地点を記録する（{nextSite.id}）</Button>
                    : <span className="self-center text-xs text-muted-foreground">計画の地点はすべて記録済みです</span>}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <p className="text-sm font-medium">記録一覧（{results.length}件）</p>
            <p className="text-xs text-muted-foreground">この端末のブラウザに保存された記録です（外部へ送信されません）。前の利用者の記録が残っている場合があります。</p>
          </div>
          <Button variant="outline" size="sm" onClick={exportRec} disabled={!results.length}><Download className="size-4" />記録をCSVで書き出す</Button>
          <ResetDialog onReset={onReset} count={results.length} />
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead>巡視日</TableHead><TableHead>ID</TableHead><TableHead>巡視者</TableHead><TableHead>結果</TableHead><TableHead>メモ</TableHead></TableRow></TableHeader>
            <TableBody>
              {results.map((r, i) => ({ r, i })).reverse().map(({ r, i }) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap">{r.date}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.siteId}
                    {isLatestOfMany(results, i) && <Badge className="ml-1 align-middle">最新</Badge>}
                  </TableCell>
                  <TableCell>{r.who}</TableCell>
                  <TableCell><ResultTag r={{ ...r, date: '' }} /></TableCell>
                  <TableCell className="whitespace-normal">{r.memo}</TableCell>
                </TableRow>
              ))}
              {!results.length && <TableRow><TableCell colSpan={5}>記録なし</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">データ: {ds.kind === 'real' ? '実データ（横須賀市）' : '架空サンプル'}</p>
      </div>
    </div>
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
      <p className="text-xs text-muted-foreground">重みとしきい値の初期値は説明用の仮置きで、根拠のある値ではありません。{real && NOT_CONNECTED + '。'}</p>
    </div>
  )
}

// ---------------- 出典・注意 ----------------
function AboutTab({ mode, ds }: { mode: Mode; ds: Dataset }) {
  const real = mode === 'real'
  return (
    <div className="max-w-3xl space-y-4 text-sm">
      {real ? (
        <>
          <p><b>データ出典</b>（取得日 {ds.refDate}、いずれも GET で取得）</p>
          <SourceList />
          <Alert>
            <AlertTitle>できていること・いないこと</AlertTitle>
            <AlertDescription className="block space-y-1 text-foreground">
              <p>出せた項目: 位置、型、面積、造成地内の標高差と平均傾斜、規制区域の内外と区分、前後の写真、巡視計画、巡視結果の記録と書き出し、型ごとの集計。</p>
              <p><b>出せない項目（推測値で埋めていません）</b>: 衛星由来の変化量・変化の開始時期・SARの変位（未接続）、許可・届出の有無、盛土の高さ・土量、造成の時期。</p>
              <p>写真は撮影年代の異なる航空写真で、衛星で検出する直近の変化を示すものではありません。</p>
            </AlertDescription>
          </Alert>
          <p className="text-muted-foreground">
            加工: 面積・標高差・平均傾斜・区域内外は本デモ用に算出。標高差は造成地ポリゴン内の最大−最小で、盛土の高さそのものではありません（自然地形の高低差を含む）。
            A56 は概略データで、横須賀市では市全域が「宅地造成等工事規制区域」として収録され、区域外の造成地は3件、特定盛土等規制区域は含まれません。
            写真タイルは外部（地理院）から取得するため、オフラインでは「写真なし」と表示されます。
          </p>
        </>
      ) : <p>架空サンプルです。区域名は宅地造成及び特定盛土等規制法の区分名称。第三者データを含みません。</p>}
      <p className="text-muted-foreground">限界: 巡視の回り順は直線距離の最近傍法（道路・立入可否は考慮しない）。記録はブラウザ内のみで、複数職員での共有・認証・監査ログはありません。衛星は「どこを先に見るか」の端緒で、違反の判断は職員が現地で行います。</p>
    </div>
  )
}

function SourceList() {
  return (
    <ul className="space-y-2">
      {SOURCES.slice(0, 3).map((s) => (
        <li key={s.name} className="rounded-md border p-3">
          <div className="font-medium">{s.name}</div>
          <div className="text-muted-foreground">提供: {s.provider}／{s.license}</div>
          <div>{s.note}</div>
          {s.url && <a className="break-all text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>}
        </li>
      ))}
    </ul>
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
