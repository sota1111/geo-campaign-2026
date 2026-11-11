import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, CheckCircle2, HelpCircle, Printer, Search, Loader2, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StepLayout } from '@/components/shared/StepLayout'
import { useAppSteps } from '@/components/shared/AppSteps'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fetchData } from '@/lib/data'
import { cn } from '@/lib/utils'
import { analyze, HAZ, OVERLAYS, reverseGeocode, searchAddress, type SearchHit } from './collect'
import {
  buildDigest, buildSheet, GLOSSARY, glossaryFor, pickSearchHit, SAMPLE_ANSWERS, SAMPLE_FACTS, summarize,
  type Answers, type AreaData, type Facts, type Tone, type Zone,
} from './lib'

const CENTER: [number, number] = [134.5548, 34.0703]
const SOURCES = [
  { name: '地図（背景）', provider: '国土地理院', url: 'https://maps.gsi.go.jp/development/ichiran.html', note: '国土地理院タイル（淡色・標準・写真）。' },
  { name: '災害リスク', provider: 'ハザードマップポータルサイト（国土地理院）', url: 'https://disaportal.gsi.go.jp/', note: '洪水浸水想定区域（想定最大規模）・高潮・津波・土砂災害警戒区域の公開タイル。指した1点の画素の色を読んでおり、区域境界付近では実際と異なることがある。深さの区分は凡例色からの目安。' },
  { name: '標高（参考値）', provider: '国土地理院', note: '標高タイル（DEM PNG, z14）から読み取った参考値。測量ではない。' },
  { name: '用途地域・建ぺい率・容積率', provider: '国土交通省 国土数値情報（A29-19 令和元年度版・徳島県）を加工して作成', license: 'CC BY 4.0（一部制限）。市区町村ごとの利用条件あり', note: '最新の都市計画とは異なる場合がある。徳島市分の利用条件は公開前に要確認。' },
  { name: 'バス停・鉄道駅', provider: 'GTFSデータリポジトリ掲載の徳島市営バス・徳島バス・上八万コミュニティバス・松茂町・北島町・鳴門市のGTFS', license: 'CC BY 4.0', note: '直線距離のみ。便数や運行日は含まない。' },
  { name: '住所検索', provider: '国土地理院 住所検索API', note: 'キー不要のGET。入力語が国土地理院に届く。' },
  { name: '町名の表示（逆ジオコーダ）', provider: '国土地理院 逆ジオコーダ（LonLatToAddress）', url: 'https://maps.gsi.go.jp/development/api.html', note: 'キー不要のGET。指した位置の緯度経度が国土地理院に届く。町名までで、番地は出ない。利用条件は国土地理院サイトの利用規約に従う（出典: 国土地理院）。' },
  { name: 'この画面にないもの', provider: '国土交通省「不動産情報ライブラリ」（https://www.reinfolib.mlit.go.jp/）', note: '取引価格・地価・将来人口・医療機関・小学校区は、そちらで確認する項目として示すだけで、この画面では取得していない。' },
  { name: 'サンプル（架空）', note: '「サンプル（架空）の土地を使う」で出るシートは架空の土地の例。実在の土地の情報ではない。' },
]
const DESCRIPTION = '相続した土地の所有者として、売る・貸す・活かす・手放すのどれにするか専門家に相談する前に、土地の条件と聞くべきことを1枚にまとめます。'

const QUESTIONS: { key: keyof Answers; legend: string; short: string; options: [string, string][] }[] = [
  { key: 'building', legend: '土地に建物はありますか', short: '建物', options: [['不明', '分からない'], ['あり', 'ある'], ['なし', 'ない']] },
  { key: 'landUse', legend: '地目（登記上の種類）', short: '地目', options: [['不明', '分からない'], ['農地', '田・畑（農地）'], ['その他', '宅地・その他']] },
  { key: 'road', legend: '道路に接していますか', short: '道路への接し方', options: [['不明', '分からない'], ['あり', '接している'], ['なし', '接していない・不明確']] },
  { key: 'registered', legend: '相続登記は済んでいますか', short: '相続登記', options: [['不明', '分からない'], ['済', '済んでいる'], ['未', 'まだ']] },
]
const BASIS = { data: 'データ', answer: 'あなたの回答による', none: 'データなし' } as const

const STEP_META: Record<string, { title: string; hint: string }> = {
  place: { title: '土地の場所を決める', hint: '住所・駅名で検索して「この位置を土地として使う」、または地図をクリック' },
  answers: { title: '地図では分からないことに答える（任意）', hint: '建物・地目・接道・相続登記。選ぶとシートに反映されます' },
  conditions: { title: '土地の条件を確かめる', hint: '用途地域・災害の想定区域など（公開データから）' },
  exits: { title: '4つの出口の「聞くこと」を読む', hint: '売る・貸す・活かす・手放す。相談先に聞くことの一覧です' },
  print: { title: '印刷・PDFで保存する', hint: '印刷すると1枚シートだけがA4・1ページで出ます' },
}

// ---- 専門用語のその場の説明（ツールチップ。タップでも開閉） ----
const TERM_RE = new RegExp('(' + GLOSSARY.map((g) => g.re.source).join('|') + ')')
function Term({ word }: { word: string }) {
  const [open, setOpen] = useState(false)
  const g = GLOSSARY.find((x) => x.re.test(word))
  if (!g) return <>{word}</>
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="cursor-help underline decoration-dotted underline-offset-2"
          aria-label={`${word}の説明：${g.text}`}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => !o) }}
        >
          {word}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs"><b>{g.term}</b>＝{g.text}</TooltipContent>
    </Tooltip>
  )
}
function Annotated({ text }: { text: string }) {
  return <>{text.split(TERM_RE).map((p, i) => (i % 2 === 1 ? <Term key={i} word={p} /> : p))}</>
}

function zoneClass(name: string) {
  return name.includes('商業') ? 'com' : name.includes('工業') ? 'ind' : 'res'
}
function zonesToGeoJSON(zones: Zone[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({
      type: 'Feature',
      properties: { name: z.name, cls: zoneClass(z.name) },
      geometry: { type: 'MultiPolygon', coordinates: z.polys as unknown as GeoJSON.Position[][][] },
    })),
  }
}

const TONE: Record<Tone, { icon: typeof CheckCircle2; cls: string; sr: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-sky-700', sr: '確認できた' },
  warn: { icon: AlertTriangle, cls: 'text-orange-700', sr: '注意' },
  unknown: { icon: HelpCircle, cls: 'text-neutral-600', sr: '分からない・取得できない' },
}

export default function App() {
  const [step, setStep] = useState('place')
  const [data, setData] = useState<AreaData | null>(null)
  const [dataError, setDataError] = useState(false)
  const [pin, setPin] = useState<{ lon: number; lat: number } | null>(null)
  const [facts, setFacts] = useState<Facts | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [overlay, setOverlay] = useState('none')
  const [showZones, setShowZones] = useState(true)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState<SearchHit | null>(null)
  const [address, setAddress] = useState<string | null | 'loading'>(null)
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const [printed, setPrinted] = useState(false)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const seq = useRef(0)
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay

  useEffect(() => {
    fetchData<AreaData>('biz-realestate', 'tokushima.json').then(setData).catch(() => setDataError(true))
  }, [])

  // ---- 地図レイヤー ----
  const zoneGeo = useMemo(() => (data ? zonesToGeoJSON(data.zones) : null), [data])
  const layers = useMemo<MapLayer[]>(() => {
    const out: MapLayer[] = []
    if (zoneGeo && showZones) {
      const color = ['match', ['get', 'cls'], 'com', '#E69F00', 'ind', '#CC79A7', '#0072B2']
      out.push({ id: 'zones', type: 'fill', data: zoneGeo, paint: { 'fill-color': color, 'fill-opacity': 0.28, 'fill-outline-color': color } })
    }
    out.push({
      id: 'pin',
      type: 'circle',
      data: { type: 'FeatureCollection', features: pin ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pin.lon, pin.lat] } }] : [] },
      paint: { 'circle-color': '#D55E00', 'circle-radius': 9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    })
    return out
  }, [zoneGeo, showZones, pin])

  // ハザードの重ね（元アプリと同じタイルURL）。背景切替でスタイルが変わっても付け直す
  const applyOverlay = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const def = OVERLAYS.find((o) => o.value === overlayRef.current)
    if (map.getLayer('hazard')) map.removeLayer('hazard')
    if (map.getSource('hazard-src')) map.removeSource('hazard-src')
    if (!def || !def.layer) return
    map.addSource('hazard-src', { type: 'raster', tiles: [`${HAZ}${def.layer}/{z}/{x}/{y}.png`], tileSize: 256, maxzoom: 17, attribution: 'ハザードマップポータルサイト（国土地理院）' })
    map.addLayer({ id: 'hazard', type: 'raster', source: 'hazard-src', paint: { 'raster-opacity': 0.65 } }, map.getLayer('zones') ? 'zones' : map.getLayer('pin') ? 'pin' : undefined)
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (map.isStyleLoaded()) applyOverlay()
    else map.once('idle', applyOverlay)
  }, [overlay, applyOverlay])
  const onMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map
    map.on('style.load', applyOverlay)
  }, [applyOverlay])

  // 検索結果・駅のマーカーとラベル
  useEffect(() => {
    const map = mapRef.current
    if (!map || !hit) return
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none'
    const lab = document.createElement('span')
    lab.textContent = hit.title
    lab.style.cssText = 'background:#fff;border:2px solid #0072B2;color:#003a5c;font:700 12px sans-serif;padding:1px 6px;border-radius:4px;white-space:nowrap'
    const dot = document.createElement('span')
    dot.style.cssText = 'width:12px;height:12px;background:#0072B2;border:2px solid #fff;border-radius:2px;margin-top:3px;box-shadow:0 0 0 1px #003a5c'
    el.append(lab, dot)
    const mk = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([hit.lon, hit.lat]).addTo(map)
    return () => { mk.remove() }
  }, [hit])

  // 地図の表示領域が変わった時（シートのプレビューとの切替）に大きさを合わせる
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 60)
    return () => clearTimeout(t)
  }, [step])

  // ---- 操作 ----
  const choose = useCallback(async (lon: number, lat: number, label = '地図で指した土地') => {
    const mine = ++seq.current
    setPin({ lon, lat })
    setHit(null)
    setBusy(true)
    setAddress('loading')
    setStatus('公開データを集めています…')
    const [f, addr] = await Promise.all([analyze(data, lon, lat, label), reverseGeocode(lon, lat)])
    if (mine !== seq.current) return
    setBusy(false)
    setFacts(f)
    setAddress(addr)
    setStatus(f.inArea ? '' : 'この地点は地図データの範囲（徳島市周辺）の外です。用途地域・公共交通は出ません。')
  }, [data])

  const onMapClick = useCallback((ll: { lng: number; lat: number }) => { void choose(ll.lng, ll.lat) }, [choose])

  const moveTo = (h: SearchHit) => {
    mapRef.current?.jumpTo({ center: [h.lon, h.lat], zoom: 15 })
    setHit(h)
    setStatus(`「${h.title}」の位置（地図の青いマーカー）に移動しました。`)
  }
  const runSearch = async (q: string) => {
    q = q.trim()
    if (!q) return
    setStatus('検索しています…')
    setHit(null)
    let hits: SearchHit[] = []
    let failed = false
    try {
      hits = await searchAddress(q)
    } catch {
      failed = true
    }
    // 「駅」を含む検索語は駅データの座標を優先。それ以外は徳島市周辺の候補を優先
    const h = pickSearchHit(q, hits, data)
    if (!h) {
      setStatus(failed ? '検索に失敗しました（通信できませんでした）。地図を直接クリックしてください。' : '見つかりませんでした。地図を直接クリックしてください。')
      return
    }
    moveTo(h)
  }

  const showSample = () => {
    seq.current++
    setPin(null)
    setHit(null)
    setBusy(false)
    setFacts(SAMPLE_FACTS)
    setAnswers(SAMPLE_ANSWERS)
    setAddress(null)
    setStatus('サンプル（架空）の土地を使っています。実在の土地ではありません。')
  }

  const sheet = useMemo(() => (facts ? buildSheet(facts, answers) : null), [facts, answers])
  const rows = useMemo(() => (facts ? summarize(facts) : []), [facts])
  const digest = useMemo(() => (facts && sheet ? buildDigest(facts, sheet) : []), [facts, sheet])
  const coord = facts && !facts.sample && pin ? `（北緯${pin.lat.toFixed(4)}度 東経${pin.lon.toFixed(4)}度）` : ''
  const addrText = address === 'loading' ? '住所を取得中…' : address ? address : '住所を取得できなかった'
  const where = facts && !facts.sample && pin ? `指定した位置: ${addrText}付近${coord}` : ''
  const glossary = useMemo(() => {
    if (!sheet) return []
    const t = JSON.stringify(sheet.exits) + sheet.missing.join('') + digest.join('') + rows.map((r) => r.value).join('')
    return glossaryFor(t + '国庫帰属')
  }, [sheet, digest, rows])

  // ---- 手順（サイドバー） ----
  // 土地が変わったら閲覧・印刷の記録をリセット。条件・4出口は、その手順を実際に開いたら「読んだ」とする
  useEffect(() => { setSeen({}); setPrinted(false) }, [facts])
  useEffect(() => {
    if (facts && (step === 'conditions' || step === 'exits')) setSeen((s) => (s[step] ? s : { ...s, [step]: true }))
  }, [facts, step])
  useEffect(() => {
    const h = () => setPrinted(true)
    window.addEventListener('afterprint', h)
    return () => window.removeEventListener('afterprint', h)
  }, [])
  const answered = QUESTIONS.some((q) => (answers[q.key] ?? '不明') !== '不明')
  useAppSteps(
    (['place', 'answers', 'conditions', 'exits', 'print'] as const).map((id) => ({
      id,
      title: STEP_META[id].title.replace('（任意）', ''),
      hint: STEP_META[id].hint.split('。')[0],
      optional: id === 'answers',
      done: id === 'place' ? !!facts : id === 'answers' ? answered : id === 'print' ? !!facts && printed : !!facts && !!seen[id],
    })),
    { activeId: step, onSelectStep: setStep, description: DESCRIPTION },
  )

  // ---- 1枚シート（画面の「手順5」プレビューと印刷で同じものを使う） ----
  const sheetEl = sheet && facts && (
    <Card className="print-sheet print:rounded-none print:border-0 print:p-0 print:shadow-none" id="rs-sheet" data-testid="sheet">
      <CardHeader className="print:p-0 print:pb-1">
        <CardTitle className="text-lg print:text-[13pt]">{sheet.title}</CardTitle>
        <p className="text-xs text-muted-foreground print:text-[8pt] print:text-black">
          {sheet.sample && <Badge variant="outline" className="mr-1 border-orange-600 text-orange-800">サンプル（架空）</Badge>}
          {sheet.sample && '実在の土地ではありません。 '}
          {where} 作成日: {new Date().toLocaleDateString('ja-JP')}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 print:space-y-1.5 print:p-0 print:text-[7.5pt] print:leading-tight">
        {digest.length > 0 && (
          <section aria-label="まず確認すること" data-testid="digest" className="rounded-md border-2 border-sky-700 bg-sky-50 p-2 print:border print:bg-white print:p-1">
            <h3 className="text-sm font-bold print:text-[9pt]">まず確認すること（要約）</h3>
            <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{digest.map((d) => <li key={d}><Annotated text={d} /></li>)}</ul>
          </section>
        )}
        <section aria-label="あなたの回答" data-testid="answers" className="rounded-md border p-2 text-sm print:p-1 print:text-[7.5pt]">
          <h3 className="text-sm font-bold print:text-[9pt]">あなたの回答</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            {QUESTIONS.map((q) => {
              const v = answers[q.key] ?? '不明'
              const label = q.options.find((o) => o[0] === v)?.[1] ?? '分からない'
              return <li key={q.key}>{q.short}：<b className={v === '不明' ? 'font-normal text-muted-foreground print:text-black' : ''}>{label}</b></li>
            })}
          </ul>
        </section>
        <section aria-label="記号の見かた" data-testid="legend" className="rounded-md border bg-muted/30 p-2 text-xs print:p-1 print:text-[6.5pt]">
          <p className="mb-0.5 font-bold">記号の見かた</p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2">
            <li className="flex items-center gap-1"><CheckCircle2 className="size-3.5 shrink-0 text-sky-700" aria-hidden />＝ 公開データを取得でき、特に注意点がない（「区域に入らない」を含む）</li>
            <li className="flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0 text-orange-700" aria-hidden />＝ 注意が必要（想定区域に入る）</li>
            <li className="flex items-center gap-1"><HelpCircle className="size-3.5 shrink-0 text-neutral-600" aria-hidden />＝ 分からない（データにない・範囲外・取得できなかった）</li>
            <li><span className="mr-1 inline-block rounded border px-1">データ</span>＝ 公開データから分かったこと</li>
            <li><span className="mr-1 inline-block rounded border-2 border-orange-700 px-1 font-bold">あなたの回答による</span>＝ 選んだ回答が反映された項目</li>
            <li><span className="mr-1 inline-block rounded border px-1">データなし</span>＝ 該当データがなく、一般的な確認のみ</li>
          </ul>
        </section>
        <section aria-label="この土地の条件">
          <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">この土地の条件（公開データから）</h3>
          <dl className="grid gap-x-4 sm:grid-cols-2 print:grid-cols-2">
            {rows.map((r) => {
              const T = TONE[r.tone]
              return (
                <div key={r.key} className="flex gap-1.5 border-b py-1 print:py-0.5">
                  <T.icon className={cn('mt-0.5 size-4 shrink-0 print:size-3', T.cls)} aria-hidden />
                  <span className="sr-only">{T.sr}：</span>
                  <dt className="w-24 shrink-0 font-medium sm:w-32 print:w-20">{r.label}</dt>
                  <dd className="min-w-0 flex-1"><Annotated text={r.value} /></dd>
                </div>
              )
            })}
          </dl>
        </section>
        <section aria-label="4つの出口ごとの聞くこと">
          <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">4つの出口ごとに、専門家に聞くこと</h3>
          <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-1.5">
            {sheet.exits.map((e) => <ExitBlock key={e.key} e={e} />)}
          </div>
        </section>
        <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-1.5">
          <MissingList sheet={sheet} part="missing" />
          <MissingList sheet={sheet} part="other" />
        </div>
        {glossary.length > 0 && (
          <section aria-label="用語の説明" data-testid="glossary">
            <h3 className="text-sm font-bold print:text-[9pt]">用語の説明</h3>
            <ul className="text-xs print:text-[6.5pt]">{glossary.map((g) => <li key={g.term} className="print:mr-2 print:inline"><b>{g.term}</b>＝{g.text}</li>)}</ul>
          </section>
        )}
        <p className="text-xs text-muted-foreground print:text-[6.5pt] print:text-black">
          出典: 国土地理院タイル・住所検索・逆ジオコーダ（町名の表示）、ハザードマップポータルサイト（国土地理院）、国土数値情報 用途地域データ（国土交通省・令和元年度版・徳島県）を加工して作成、GTFSデータリポジトリ（CC BY 4.0）。
          取引価格・地価などは国土交通省「不動産情報ライブラリ」（https://www.reinfolib.mlit.go.jp/）で確認。
          国のデータを加工した参考情報であり、法的・税務的な判断や査定ではありません。区域境界付近や古いデータでは実際と異なります。必ず相談先で確認してください。
        </p>
      </CardContent>
    </Card>
  )

  const noLand = (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-land">
      土地の位置がまだ決まっていません。土地の位置を決める手順を済ませると、内容が出ます。
    </p>
  )

  // ---- 手順ごとのパネル ----
  const panel = (() => {
    switch (step) {
      case 'place':
        return (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void runSearch(query) }} role="search">
                <Label htmlFor="rs-q" className="sr-only">住所・目印を検索</Label>
                <Input id="rs-q" type="search" className="min-w-0 flex-1" placeholder="例: 徳島駅、徳島市役所、幸町" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button type="submit"><Search className="size-4" />検索</Button>
              </form>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => moveTo(pickSearchHit('徳島駅', [], data) ?? { lon: 134.5515, lat: 34.07451, title: '徳島駅' })}>検索せずに徳島駅付近を表示</Button>
            </div>
            {hit && (
              <div className="space-y-2 rounded-lg border-2 border-sky-700 bg-sky-50 p-3" data-testid="use-hit" role="status">
                <p className="text-sm font-bold">「{hit.title}」の位置が土地ですか？（地図の青いマーカー）</p>
                <Button type="button" size="lg" className="h-auto min-h-11 whitespace-normal py-2 text-base" onClick={() => void choose(hit.lon, hit.lat, `検索した位置（${hit.title}）`)}>
                  <MapPin className="size-5" />この位置（{hit.title}）を土地として使う
                </Button>
                <p className="text-xs text-muted-foreground">違う場合は、地図で土地の位置をクリックしてください。</p>
              </div>
            )}
            <div className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-medium">地図に重ねる</p>
              <div className="flex items-center gap-2">
                <Label htmlFor="rs-overlay" className="shrink-0 text-sm">ハザード</Label>
                <Select value={overlay} onValueChange={setOverlay}>
                  <SelectTrigger id="rs-overlay" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OVERLAYS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="rs-zones" checked={showZones} onCheckedChange={(v) => setShowZones(v === true)} />
                <Label htmlFor="rs-zones" className="text-sm">用途地域の範囲</Label>
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="地図の凡例">
                {[['#0072B2', '住居系'], ['#E69F00', '商業系'], ['#CC79A7', '工業系']].map(([c, t]) => (
                  <li key={t} className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm border" style={{ background: c, opacity: 0.6 }} />{t}</li>
                ))}
                <li className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-white bg-[#D55E00] ring-1 ring-neutral-500" />指した土地</li>
              </ul>
            </div>
            <p className="text-sm" role="status" data-testid="status">
              {busy && <Loader2 className="mr-1 inline size-4 animate-spin" />}
              {facts && !busy && where ? <b>{where}</b> : null} {status}
            </p>
            {dataError && <p className="text-sm text-orange-700">用途地域・公共交通のデータを読み込めませんでした（地図と災害データだけで動きます）。</p>}
            <Button type="button" variant="secondary" size="sm" onClick={showSample}>サンプル（架空）の土地を使う</Button>
          </div>
        )
      case 'answers':
        return (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">選んだ内容は、この端末の中だけで使い、送信・保存はしません。未選択でもシートは作れます。</p>
            {QUESTIONS.map((q) => (
              <div key={q.key} role="group" aria-label={q.legend}>
                <p className="mb-1 text-sm font-medium">{q.legend}</p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="flex-wrap justify-start"
                  value={answers[q.key] ?? '不明'}
                  onValueChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v || '不明' }))}
                >
                  {q.options.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="h-auto whitespace-normal px-2 py-1.5 text-xs data-[state=on]:bg-sky-100 data-[state=on]:font-bold data-[state=on]:text-sky-900">{l}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
            ))}
            <p className="rounded-md bg-muted/50 p-2 text-xs" data-testid="answers-summary" role="status">
              {facts
                ? `回答はシートに反映されます（いま: ${QUESTIONS.map((q) => `${q.short} ${q.options.find((o) => o[0] === (answers[q.key] ?? '不明'))?.[1] ?? '分からない'}`).join('／')}）。`
                : '土地の位置を決めると、回答がシートに反映されます。'}
            </p>
          </div>
        )
      case 'conditions':
        if (!facts) return noLand
        return (
          <div className="space-y-3" data-testid="conditions-panel">
            {where && <p className="text-sm font-medium">{where}</p>}
            <dl data-testid="summary">
              {rows.map((r) => {
                const T = TONE[r.tone]
                return (
                  <div key={r.key} className="flex gap-1.5 border-b py-1.5 text-sm" data-testid={`row-${r.key}`}>
                    <T.icon className={cn('mt-0.5 size-4 shrink-0', T.cls)} aria-hidden />
                    <span className="sr-only">{T.sr}：</span>
                    <dt className="w-28 shrink-0 font-medium">{r.label}</dt>
                    <dd className="min-w-0 flex-1"><Annotated text={r.value} /></dd>
                  </div>
                )
              })}
            </dl>
            <ul className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs" aria-label="記号の見かた">
              <li className="flex items-center gap-1"><CheckCircle2 className="size-3.5 shrink-0 text-sky-700" aria-hidden />データを取得でき、特に注意点がない</li>
              <li className="flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0 text-orange-700" aria-hidden />注意が必要（想定区域に入る）</li>
              <li className="flex items-center gap-1"><HelpCircle className="size-3.5 shrink-0 text-neutral-600" aria-hidden />分からない（データにない・範囲外・取得できなかった）</li>
            </ul>
          </div>
        )
      case 'exits':
        if (!sheet) return noLand
        return (
          <div className="space-y-3" data-testid="exits-panel">
            {sheet.exits.map((e) => <ExitBlock key={e.key} e={e} />)}
            <MissingList sheet={sheet} part="missing" />
            <MissingList sheet={sheet} part="other" />
          </div>
        )
      case 'print':
        return (
          <div className="space-y-3">
            {!sheet ? noLand : (
              <>
                <p className="text-sm">土地の条件と4出口の「聞くこと」を、A4・1枚にまとめたシートです。印刷画面で「PDFに保存」を選ぶとPDFになります。</p>
                <Button type="button" size="lg" onClick={() => { setPrinted(true); window.print() }}><Printer className="size-5" />印刷・PDFで保存する</Button>
                {printed && <p className="text-xs text-muted-foreground" role="status">印刷画面を開きました。</p>}
              </>
            )}
          </div>
        )
      default:
        return null
    }
  })()

  const showSheet = step === 'print' && !!sheetEl
  const meta = STEP_META[step]

  const aside = (
    <div className="relative h-full">
      <div className={cn('h-full', showSheet && 'hidden')}>
        <MapView
          center={CENTER}
          zoom={14}
          layers={layers}
          onClick={step === 'place' ? onMapClick : undefined}
          onMapReady={onMapReady}
          basemap="std"
          attribution="ハザードマップポータルサイト（国土地理院）／国土数値情報 用途地域（国土交通省）"
          className={cn('h-full', step === 'place' && 'cursor-crosshair')}
          ariaLabel="地図。手順1ではクリックまたはタップで土地の位置を指定"
        />
      </div>
      {/* 1枚シート: 手順5では画面に出す。それ以外でも印刷（Ctrl+P）に備えて DOM に残す */}
      <div className={cn('rs-sheet-wrap h-full overflow-y-auto bg-muted/30 p-3', !showSheet && 'hidden')} data-testid="sheet-wrap">
        {sheetEl}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader appId="biz-realestate" compact actions={<SourceDialog sources={SOURCES} />} />
      <p className="shrink-0 border-b bg-muted/40 px-4 py-1 text-xs text-muted-foreground print:hidden">
        動く最小限のデモ（地図データは徳島市のみ）。金額の推定や「売るべき」は出さず、法律・税金の助言ではありません。
      </p>
      <StepLayout title={meta.title} hint={meta.hint} aside={aside}>
        {panel}
      </StepLayout>
      <style>{`
@media print {
  @page { size: A4; margin: 7mm; }
  html, body, #root { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
  body * { visibility: visible; }
  body *:not(.print-sheet):not(.print-sheet *):not(:has(.print-sheet)) { display: none !important; }
  body *:has(.print-sheet) { display: block !important; position: static !important; padding: 0 !important; margin: 0 !important;
    min-height: 0 !important; height: auto !important; max-height: none !important; width: auto !important; max-width: none !important; overflow: visible !important;
    transform: none !important; border: 0 !important; box-shadow: none !important; background: #fff !important; }
  .print-sheet { color: #000; background: #fff; }
  .print-sheet * { color: inherit; }
}`}</style>
    </>
  )
}

function ExitBlock({ e }: { e: import('./lib').Exit }) {
  return (
    <div className="rounded-md border p-3 print:break-inside-avoid print:p-1.5" data-testid={`exit-${e.key}`}>
      <h4 className="mb-1 text-base font-bold print:mb-0.5 print:text-[9pt]">{e.label}</h4>
      {e.key === 'release' && (
        <p className="mb-1 text-xs text-muted-foreground print:text-[6.5pt] print:text-black">相続土地国庫帰属制度（国庫帰属）＝相続した土地を、一定の条件で国に引き取ってもらう制度。</p>
      )}
      <ul className="space-y-2 print:space-y-0.5">
        {e.items.map((it, i) => (
          <li key={i} className="text-sm print:text-[7.5pt]">
            <span className="block">
              <span className={cn('mr-1 inline-block rounded border px-1 text-[11px] print:text-[6.5pt]', it.basis === 'answer' && 'border-2 border-orange-700 bg-orange-50 font-bold print:bg-white')}>{BASIS[it.basis]}</span>
              <Annotated text={it.fact} />
            </span>
            <span className="block font-medium text-sky-900 print:text-black">→ <Annotated text={it.ask} />（{it.who}）</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MissingList({ sheet, part }: { sheet: import('./lib').Sheet; part: 'missing' | 'other' }) {
  const items = part === 'missing' ? sheet.missing : sheet.otherItems
  return (
    <section>
      <h3 className="text-sm font-bold print:text-[9pt]">{part === 'missing' ? 'データにない項目（相談先で確かめる）' : '別の公的サイトで確認する項目（この画面では取得していません）'}</h3>
      <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{items.map((m) => <li key={m}><Annotated text={m} /></li>)}</ul>
    </section>
  )
}
