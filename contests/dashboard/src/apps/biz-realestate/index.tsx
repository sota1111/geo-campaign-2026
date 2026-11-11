import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, CheckCircle2, HelpCircle, Printer, Search, Loader2, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { fetchData } from '@/lib/data'
import { cn } from '@/lib/utils'
import { analyze, HAZ, OVERLAYS, reverseGeocode, searchAddress, type SearchHit } from './collect'
import {
  buildDigest, buildSheet, glossaryFor, pickSearchHit, SAMPLE_ANSWERS, SAMPLE_FACTS, summarize,
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
  { name: 'サンプル（架空）', note: '「サンプルの1枚シートを見る」で出るシートは架空の土地の例。実在の土地の情報ではない。' },
]

const QUESTIONS: { key: keyof Answers; legend: string; options: [string, string][] }[] = [
  { key: 'building', legend: '土地に建物はありますか', options: [['不明', '分からない'], ['あり', 'ある'], ['なし', 'ない']] },
  { key: 'landUse', legend: '地目（登記上の種類）', options: [['不明', '分からない'], ['農地', '田・畑（農地）'], ['その他', '宅地・その他']] },
  { key: 'road', legend: '道路に接していますか', options: [['不明', '分からない'], ['あり', '接している'], ['なし', '接していない・不明確']] },
  { key: 'registered', legend: '相続登記は済んでいますか', options: [['不明', '分からない'], ['済', '済んでいる'], ['未', 'まだ']] },
]
const SHORT: Record<string, string> = { building: '建物', landUse: '地目', road: '道路への接し方', registered: '相続登記' }
const BASIS = { data: 'データ', answer: 'あなたの回答による', none: 'データなし' } as const

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

function headline(f: Facts): string {
  const rows = summarize(f)
  const get = (k: string) => rows.find((r) => r.key === k)
  const z = get('zone')!, fl = get('flood')!
  return `用途地域: ${z.value}。洪水（想定最大規模）: ${fl.value}。`
}

export default function App() {
  const [data, setData] = useState<AreaData | null>(null)
  const [dataError, setDataError] = useState(false)
  const [pin, setPin] = useState<{ lon: number; lat: number } | null>(null)
  const [facts, setFacts] = useState<Facts | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [overlay, setOverlay] = useState('none')
  const [showZones, setShowZones] = useState(true)
  const [status, setStatus] = useState('地図で土地を指すと、ここに状況が出ます。')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [hit, setHit] = useState<SearchHit | null>(null)
  const [address, setAddress] = useState<string | null | 'loading'>(null)
  const hitMarker = useRef<maplibregl.Marker | null>(null)
  const hitBannerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const seq = useRef(0)
  const sheetRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay

  useEffect(() => {
    fetchData<AreaData>('biz-realestate', 'tokushima.json').then(setData).catch(() => {
      setDataError(true)
    })
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
    hitMarker.current = mk
    return () => { mk.remove() }
  }, [hit])

  // シートの先頭（タイトル→要約）に合わせる。描画後のレイアウト変化で途中に止まらないよう、後から位置を補正する
  const scrollToSheet = useCallback(() => {
    const go = (behavior: ScrollBehavior) => {
      const el = sheetRef.current
      if (!el) return
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior })
    }
    go('smooth')
    setTimeout(() => go('auto'), 800)
  }, [])
  const pendingScroll = useRef(false)
  useEffect(() => {
    if (!pendingScroll.current || !facts) return
    pendingScroll.current = false
    requestAnimationFrame(scrollToSheet)
  }, [facts, address, scrollToSheet])
  // 検索で移動したら、案内（「この位置を土地として使う」）が見える位置へ
  useEffect(() => {
    if (hit) setTimeout(() => hitBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150)
  }, [hit])

  // ---- 操作 ----
  const choose = useCallback(async (lon: number, lat: number, label = '地図で指した土地') => {
    const mine = ++seq.current
    setPin({ lon, lat })
    setHit(null)
    setBusy(true)
    setAddress('loading')
    setStatus('公開データを集めています…（終わると自動で1枚シートへ移動します）')
    const [f, addr] = await Promise.all([analyze(data, lon, lat, label), reverseGeocode(lon, lat)])
    if (mine !== seq.current) return
    setBusy(false)
    pendingScroll.current = true
    setFacts(f)
    setAddress(addr)
    const bits = f.inArea ? '' : 'この地点は地図データの範囲（徳島市周辺）の外です。用途地域・公共交通は出ません。'
    setStatus(`位置を指定しました。${bits}`)
  }, [data])

  const onMapClick = useCallback((ll: { lng: number; lat: number }) => { void choose(ll.lng, ll.lat) }, [choose])

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
    // 「駅」を含む検索語は駅名の候補を優先。それ以外は徳島市周辺の候補を優先
    const h = pickSearchHit(q, hits, data)
    if (!h) {
      setStatus(failed ? '検索に失敗しました（通信できませんでした）。地図を直接クリックしてください。' : '見つかりませんでした。地図を直接クリックしてください。')
      return
    }
    mapRef.current?.jumpTo({ center: [h.lon, h.lat], zoom: 15 })
    setHit(h)
    setStatus(`「${h.title}」の位置（地図のマーカー）に移動しました。`)
  }

  const showSample = () => {
    seq.current++
    setPin(null)
    setBusy(false)
    setFacts(SAMPLE_FACTS)
    setAnswers(SAMPLE_ANSWERS)
    setAddress(null)
    setStatus('サンプル（架空）の土地の1枚シートです。実在の土地ではありません。')
    setTimeout(scrollToSheet, 150)
  }

  const sheet = useMemo(() => (facts ? buildSheet(facts, answers) : null), [facts, answers])
  const rows = useMemo(() => (facts ? summarize(facts) : []), [facts])
  const coord = facts && !facts.sample && pin ? `（北緯${pin.lat.toFixed(4)}度 東経${pin.lon.toFixed(4)}度）` : ''
  const addrText = address === 'loading' ? '住所を取得中…' : address ? address : '住所を取得できなかった'
  const where = facts && !facts.sample && pin ? `指定した位置: ${addrText}付近${coord}` : ''
  const digest = useMemo(() => (facts && sheet ? buildDigest(facts, sheet) : []), [facts, sheet])
  const glossary = useMemo(() => {
    if (!sheet) return []
    const t = JSON.stringify(sheet.exits) + sheet.missing.join('') + digest.join('') + rows.map((r) => r.value).join('')
    // 相続土地国庫帰属制度は「手放す」の注記に常にあるため、用語の説明にも常に載せる
    return glossaryFor(t + '国庫帰属')
  }, [sheet, digest, rows])
  const keyRows = rows.filter((r) => r.key === 'zone' || r.key === 'flood')

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader appId="biz-realestate" actions={<SourceDialog sources={SOURCES} />} />

      <ol className="grid gap-2 text-sm sm:grid-cols-3 print:hidden" aria-label="使い方の3ステップ">
        <li className="rounded-md border bg-card p-3"><b>1.</b> 土地の場所を地図で指す（住所検索もできます）</li>
        <li className="rounded-md border bg-card p-3"><b>2.</b> 地図では分からないことを選ぶ（任意）</li>
        <li className="rounded-md border bg-card p-3"><b>3.</b> 下に出る1枚シートを印刷・PDF保存する</li>
      </ol>

      <Alert className="print:hidden">
        <AlertTitle>動く最小限のデモです</AlertTitle>
        <AlertDescription>
          地図データは徳島市のみ。金額の推定や「売るべき」といった結論は出しません。法律・税金の助言ではなく、相談先に聞くことの一覧です。
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-5 print:hidden">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>1. 土地の場所を地図で指す</CardTitle>
            <CardDescription>地図をクリック（タップ）すると、その位置を土地として扱います。ドラッグで移動、右上のボタンで拡大縮小。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void runSearch(query) }} role="search">
              <Label htmlFor="rs-q" className="sr-only">住所・目印を検索</Label>
              <Input id="rs-q" type="search" className="min-w-0 flex-1 basis-48" placeholder="例: 徳島駅、徳島市役所、徳島市幸町" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
              <Button type="submit"><Search className="size-4" />検索</Button>
              <Button type="button" variant="outline" onClick={() => {
                // 駅舎の位置は同梱の駅データ（鉄道駅の座標）を優先
                const h = pickSearchHit('徳島駅', [], data) ?? { lon: 134.5515, lat: 34.07451, title: '徳島駅' }
                mapRef.current?.jumpTo({ center: [h.lon, h.lat], zoom: 15 })
                setHit(h)
                setStatus(`「${h.title}」の位置（地図のマーカー）に移動しました。`)
              }}>徳島駅付近を表示</Button>
            </form>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="rs-overlay" className="text-sm">重ねる地図</Label>
                <Select value={overlay} onValueChange={setOverlay}>
                  <SelectTrigger id="rs-overlay" className="w-64 max-w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OVERLAYS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="rs-zones" checked={showZones} onCheckedChange={(v) => setShowZones(v === true)} />
                <Label htmlFor="rs-zones" className="text-sm">用途地域の範囲を重ねる</Label>
              </div>
            </div>
            {hit && (
              <div ref={hitBannerRef} className="space-y-2 rounded-lg border-2 border-sky-700 bg-sky-50 p-3 scroll-mt-16" data-testid="use-hit" role="status">
                <p className="text-base font-bold">「{hit.title}」の位置に移動しました（地図の青いマーカー）。次はどちらかを選んでください。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="lg" className="h-auto min-h-11 whitespace-normal py-2 text-base" onClick={() => void choose(hit.lon, hit.lat, `検索した位置（${hit.title}）`)}>
                    <MapPin className="size-5" />この位置（{hit.title}）を土地として使う
                  </Button>
                  <Button type="button" size="lg" variant="outline" className="h-auto min-h-11 whitespace-normal py-2 text-base" onClick={() => { setHit(null); setStatus('地図をクリックして、土地の位置を指してください。') }}>
                    地図をクリックして位置を変える
                  </Button>
                </div>
              </div>
            )}
            <MapView
              center={CENTER}
              zoom={14}
              layers={layers}
              onClick={onMapClick}
              onMapReady={onMapReady}
              basemap="std"
              attribution="ハザードマップポータルサイト（国土地理院）／国土数値情報 用途地域（国土交通省）"
              className="h-[380px] cursor-crosshair sm:h-[460px]"
              ariaLabel="地図。クリックまたはタップで土地の位置を指定"
            />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="用途地域の凡例">
              {[['#0072B2', '住居系'], ['#E69F00', '商業系'], ['#CC79A7', '工業系']].map(([c, t]) => (
                <li key={t} className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm border" style={{ background: c, opacity: 0.6 }} />{t}</li>
              ))}
              <li className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-white bg-[#D55E00] ring-1 ring-neutral-500" />指した土地</li>
            </ul>
            {dataError && <p className="text-sm text-orange-700">用途地域・公共交通のデータを読み込めませんでした（地図と災害データだけで動きます）。</p>}
            <Button type="button" variant="secondary" onClick={showSample}>地図で指さずに、サンプル（架空）の土地の1枚シートを見る</Button>
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>2. 地図では分からないことを選ぶ（任意）</CardTitle>
              <CardDescription>選ぶと、下の1枚シートの「手放す」「売る」などの内容が変わります（未選択でもシートは作れます）。選んだ内容は、この端末の中だけで使い、送信・保存はしません。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. 1枚シートを印刷・PDF保存する</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p id="rs-status" role="status" className="text-sm" data-testid="status">
                {busy && <Loader2 className="mr-1 inline size-4 animate-spin" />}
                {status}
              </p>
              {keyRows.length > 0 && facts && !busy && (
                <dl className="rounded-md border bg-muted/40 p-2 text-sm" data-testid="quick-result">
                  {keyRows.map((r) => (
                    <div key={r.key} className="flex gap-2 py-0.5">
                      <dt className="w-28 shrink-0 font-medium">{r.label}</dt>
                      <dd className="min-w-0 flex-1">{r.value}</dd>
                    </div>
                  ))}
                  <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={scrollToSheet}>下の1枚シートを見る</Button>
                </dl>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={!sheet} onClick={() => window.print()}><Printer className="size-4" />印刷・PDFで保存する</Button>
                <span className="text-xs text-muted-foreground">印刷画面で「PDFに保存」を選ぶとPDFになります。</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div ref={sheetRef} className="scroll-mt-16">
        {sheet ? (
          <Card className="print-sheet print:rounded-none print:border-0 print:p-0 print:shadow-none" id="rs-sheet" data-testid="sheet" aria-live="polite">
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
                  <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{digest.map((d) => <li key={d}>{d}</li>)}</ul>
                </section>
              )}
              <section aria-label="あなたの回答" data-testid="answers" className="rounded-md border p-2 text-sm print:p-1 print:text-[7.5pt]">
                <h3 className="text-sm font-bold print:text-[9pt]">あなたの回答（手順2で選んだ内容）</h3>
                <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
                  {QUESTIONS.map((q) => {
                    const v = answers[q.key] ?? '不明'
                    const label = q.options.find((o) => o[0] === v)?.[1] ?? '分からない'
                    return <li key={q.key}>{SHORT[q.key as string]}：<b className={v === '不明' ? 'font-normal text-muted-foreground print:text-black' : ''}>{label}</b></li>
                  })}
                </ul>
                <p className="text-xs text-muted-foreground print:text-[6.5pt] print:text-black">変えると、下の各出口の「あなたの回答による」印の項目が変わります。</p>
              </section>
              <section aria-label="記号の見かた" data-testid="legend" className="rounded-md border bg-muted/30 p-2 text-xs print:p-1 print:text-[6.5pt]">
                <p className="mb-0.5 font-bold">記号の見かた</p>
                <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 print:grid-cols-2">
                  <li className="flex items-center gap-1"><CheckCircle2 className="size-3.5 shrink-0 text-sky-700" aria-hidden />＝ 公開データを取得でき、特に注意点がない（「区域に入らない」を含む）</li>
                  <li className="flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0 text-orange-700" aria-hidden />＝ 注意が必要（想定区域に入る）</li>
                  <li className="flex items-center gap-1"><HelpCircle className="size-3.5 shrink-0 text-neutral-600" aria-hidden />＝ 分からない（データにない・範囲外・取得できなかった）</li>
                  <li><span className="mr-1 inline-block rounded border px-1">データ</span>＝ 公開データから分かったこと</li>
                  <li><span className="mr-1 inline-block rounded border-2 border-orange-700 px-1 font-bold">あなたの回答による</span>＝ 手順2で選んだ内容が反映された項目（未選択は「分からない」扱い）</li>
                  <li><span className="mr-1 inline-block rounded border px-1">データなし</span>＝ 該当データがなく、一般的な確認のみ</li>
                </ul>
              </section>
              <section aria-label="この土地の条件">
                <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">この土地の条件（公開データから）</h3>
                <dl className="grid gap-x-4 sm:grid-cols-2 print:grid-cols-2" data-testid="summary">
                  {rows.map((r) => {
                    const T = TONE[r.tone]
                    return (
                      <div key={r.key} className="flex gap-1.5 border-b py-1 print:py-0.5" data-testid={`row-${r.key}`}>
                        <T.icon className={cn('mt-0.5 size-4 shrink-0 print:size-3', T.cls)} aria-hidden />
                        <span className="sr-only">{T.sr}：</span>
                        <dt className="w-24 shrink-0 font-medium sm:w-32 print:w-20">{r.label}</dt>
                        <dd className="min-w-0 flex-1">{r.value}</dd>
                      </div>
                    )
                  })}
                </dl>
              </section>

              <section aria-label="4つの出口ごとの聞くこと">
                <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">4つの出口ごとに、専門家に聞くこと</h3>
                <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-1.5">
                  {sheet.exits.map((e) => (
                    <div key={e.key} className="rounded-md border p-3 print:break-inside-avoid print:p-1.5" data-testid={`exit-${e.key}`}>
                      <h4 className="mb-1 text-base font-bold print:mb-0.5 print:text-[9pt]">{e.label}</h4>
                      {e.key === 'release' && (
                        <p className="mb-1 text-xs text-muted-foreground print:text-[6.5pt] print:text-black">相続土地国庫帰属制度（国庫帰属）＝相続した土地を、一定の条件で国に引き取ってもらう制度。</p>
                      )}
                      <ul className="space-y-2 print:space-y-0.5">
                        {e.items.map((it, i) => (
                          <li key={i} className="text-sm print:text-[7.5pt]">
                            <span className="block">
                              <span className={cn('mr-1 inline-block rounded border px-1 text-[11px] print:text-[6.5pt]', it.basis === 'answer' && 'border-2 border-orange-700 bg-orange-50 font-bold print:bg-white')}>{BASIS[it.basis]}</span>
                              {it.fact}
                            </span>
                            <span className="block font-medium text-sky-900 print:text-black">→ {it.ask}（{it.who}）</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-1.5">
                <section>
                  <h3 className="text-sm font-bold print:text-[9pt]">データにない項目（相談先で確かめる）</h3>
                  <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{sheet.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                </section>
                <section>
                  <h3 className="text-sm font-bold print:text-[9pt]">別の公的サイトで確認する項目（この画面では取得していません）</h3>
                  <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{sheet.otherItems.map((m) => <li key={m}>{m}</li>)}</ul>
                </section>
              </div>

              {glossary.length > 0 && (
                <section aria-label="用語の説明" data-testid="glossary">
                  <h3 className="text-sm font-bold print:text-[9pt]">用語の説明</h3>
                  <ul className="text-xs print:text-[6.5pt]">{glossary.map((g) => <li key={g.term} className="print:mr-2 print:inline"><b>{g.term}</b>＝{g.text}</li>)}</ul>
                </section>
              )}

              <p className="text-xs text-muted-foreground print:text-[6.5pt] print:text-black">
                出典:国土地理院タイル・住所検索・逆ジオコーダ（町名の表示）、ハザードマップポータルサイト（国土地理院）、国土数値情報 用途地域データ（国土交通省・令和元年度版・徳島県）を加工して作成、GTFSデータリポジトリ（CC BY 4.0）。
                取引価格・地価などは国土交通省「不動産情報ライブラリ」（https://www.reinfolib.mlit.go.jp/）で確認。
                国のデータを加工した参考情報であり、法的・税務的な判断や査定ではありません。区域境界付近や古いデータでは実際と異なります。必ず相談先で確認してください。
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="print:hidden">
            <CardContent className="py-6 text-sm text-muted-foreground">
              ここに1枚シートが出ます。地図で土地を指すか、サンプルを開いてください。
            </CardContent>
          </Card>
        )}
      </div>

      <style>{`
@media print {
  @page { size: A4; margin: 7mm; }
  body * { visibility: visible; }
  body *:not(.print-sheet):not(.print-sheet *):not(:has(.print-sheet)) { display: none !important; }
  body *:has(.print-sheet) { display: block !important; position: static !important; padding: 0 !important; margin: 0 !important;
    min-height: 0 !important; height: auto !important; width: auto !important; max-width: none !important; overflow: visible !important;
    transform: none !important; border: 0 !important; box-shadow: none !important; background: #fff !important; }
  .print-sheet { color: #000; background: #fff; }
  .print-sheet * { color: inherit; }
  html, body { background: #fff !important; }
}`}</style>
    </div>
  )
}
