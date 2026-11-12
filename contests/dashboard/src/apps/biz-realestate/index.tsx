import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { AlertTriangle, CheckCircle2, Copy, HelpCircle, Printer, Search, Loader2, MapPin } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StepLayout } from '@/components/shared/StepLayout'
import { useAppSteps } from '@/components/shared/AppSteps'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog, type SourceItem } from '@/components/shared/SourceDialog'
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
import { isSampleMode } from '@/lib/sample'
import { cn } from '@/lib/utils'
import { analyze, HAZ, OVERLAYS, reverseGeocode, searchAddress, type SearchHit } from './collect'
import {
  buildDigest, buildSheet, GLOSSARY, glossaryFor, libPrintLine, pickSearchHit, splitForPrint, SAMPLE_ANSWERS, sheetToText, summarize,
  type Answers, type AreaData, type Exit, type Facts, type Tone, type Zone,
} from './lib'
import {
  isReinfolibData, lookupLibrary, REINFOLIB_ATTRIBUTION, REINFOLIB_CREDIT, REINFOLIB_PROCESSED, REINFOLIB_RESPONSIBILITY, REINFOLIB_URL, type ReinfolibData,
} from './reinfolib'

const LIB_URL = REINFOLIB_URL
const CENTER: [number, number] = [134.5548, 34.0703]
const BASE_SOURCES = [
  { name: '地図（背景）', provider: '国土地理院', url: 'https://maps.gsi.go.jp/development/ichiran.html', note: '国土地理院タイル（淡色・標準・写真）。' },
  { name: '災害リスク', provider: 'ハザードマップポータルサイト（国土地理院）', url: 'https://disaportal.gsi.go.jp/', note: '洪水浸水想定区域（想定最大規模）・高潮・津波・土砂災害警戒区域の公開タイル。指した1点の画素の色を読んでおり、区域境界付近では実際と異なることがある。深さの区分は凡例色からの目安。' },
  { name: '標高（参考値）', provider: '国土地理院', note: '標高タイル（DEM PNG, z14）から読み取った参考値。測量ではない。' },
  { name: '用途地域・建ぺい率・容積率', provider: '国土交通省 国土数値情報（A29-19 令和元年度版・徳島県）を加工して作成', license: 'CC BY 4.0（一部制限）。市区町村ごとの利用条件あり', note: '最新の都市計画とは異なる場合がある。徳島市分の利用条件は公開前に要確認。' },
  { name: 'バス停・鉄道駅', provider: 'GTFSデータリポジトリ掲載の徳島市営バス・徳島バス・上八万コミュニティバス・松茂町・北島町・鳴門市のGTFS', license: 'CC BY 4.0', note: '直線距離のみ。便数や運行日は含まない。' },
  { name: '住所検索', provider: '国土地理院 住所検索API', note: 'キー不要のGET。入力語が国土地理院に届く。' },
  { name: '町名の表示（逆ジオコーダ）', provider: '国土地理院 逆ジオコーダ（LonLatToAddress）', url: 'https://maps.gsi.go.jp/development/api.html', note: 'キー不要のGET。指した位置の緯度経度が国土地理院に届く。町名までで、番地は出ない。利用条件は国土地理院サイトの利用規約に従う（出典: 国土地理院）。' },
  { name: '例（徳島駅付近）', note: '「徳島駅付近の例で試す」で出るシートは、徳島駅の位置（実在の位置）で公開データを取得したもの。ただし実在の相続土地ではなく、「あなたの回答」の欄は例として置いた架空の回答。' },
]
function buildSources(lib: ReinfolibData | null) {
  const got = libSectionNames(lib)
  return [
    ...BASE_SOURCES.slice(0, -1),
    lib
      ? { name: '不動産情報ライブラリ（事前に取得した同梱データ）', provider: '国土交通省「不動産情報ライブラリ」のAPI（' + got.join('・') + '）。取得日 ' + lib.fetchedAt, url: LIB_URL, license: '不動産情報ライブラリ利用規約・API利用規約（公共データ利用規約 第1.0版）。' + REINFOLIB_ATTRIBUTION, note: '画面の「ライブラリ由来」の印の付いた行が、このデータによる。ビルド前に手元でAPIから取得して同梱したもので、ブラウザからAPIは呼んでいない。' + REINFOLIB_PROCESSED + '。取引価格は町名ごとの中央値で、個別の物件の価格ではない。地価公示・地価調査は標準地の価格で、この土地の価格ではない。' + REINFOLIB_CREDIT + '。' + REINFOLIB_RESPONSIBILITY + '。' }
      : { name: '不動産情報ライブラリ（この画面では未取得）', provider: '国土交通省「不動産情報ライブラリ」', url: LIB_URL, note: 'この画面の数値・判定は、ライブラリのAPIからは取得していない（取得データ reinfolib.json が同梱されていない、または読み込めなかった）。ライブラリで確認できる項目（取引価格・地価公示・将来人口・医療機関・小学校区・区域区分、用途地域や洪水浸水想定区域の最新情報）は、この画面の手順3と1枚シートに「ライブラリで確認する項目」として示すだけ。' },
    BASE_SOURCES[BASE_SOURCES.length - 1],
  ]
}
function libSectionNames(lib: ReinfolibData | null) {
  return [lib?.division && '区域区分（XKT001）', lib?.landPrice && '地価公示・地価調査（XPT002）', lib?.trade && '取引価格（XIT001）'].filter(Boolean) as string[]
}
const DESCRIPTION = '相続した土地の所有者として、売る・貸す・活かす・手放すのどれにするか専門家に相談する前に、土地の条件と聞くべきことを1枚にまとめます。'

const QUESTIONS: { key: keyof Answers; legend: string; short: string; options: [string, string][] }[] = [
  { key: 'building', legend: '土地に建物はありますか', short: '建物', options: [['不明', '分からない'], ['あり', 'ある'], ['なし', 'ない']] },
  { key: 'landUse', legend: '地目（登記上の種類）', short: '地目', options: [['不明', '分からない'], ['農地', '田・畑（農地）'], ['その他', '宅地・その他']] },
  { key: 'road', legend: '道路に接していますか', short: '道路への接し方', options: [['不明', '分からない'], ['あり', '接している'], ['なし', '接していない・不明確']] },
  { key: 'registered', legend: '相続登記は済んでいますか', short: '相続登記', options: [['不明', '分からない'], ['済', '済んでいる'], ['未', 'まだ']] },
]
// この画面の項目と不動産情報ライブラリ（国土交通省）の対応。ライブラリのAPI名は提出文書（reinfolib.md・2026-11-09 公式API仕様で確認）による。
// ここに並ぶ項目は、ライブラリ以外のデータで出している（ライブラリ由来とは書かない）。ライブラリから取得した項目は「ライブラリ由来」の行で別に出す。
const LIB_SCREEN: { item: string; from: string; lib: string }[] = [
  { item: '用途地域・建ぺい率・容積率', from: '国土数値情報（令和元年度版・徳島県）を同梱', lib: 'ライブラリにも「用途地域」（XKT002）がある。最新はそちらで確認' },
  { item: '洪水浸水想定区域', from: 'ハザードマップポータル（国土地理院）のタイル', lib: 'ライブラリにも「洪水浸水想定区域（想定最大規模）」（XKT026）がある' },
  { item: '高潮・津波・土砂災害警戒区域', from: 'ハザードマップポータル（国土地理院）のタイル', lib: 'ライブラリでの提供は未確認' },
  { item: '標高・バス停・駅', from: '国土地理院の標高タイル、GTFSデータ', lib: 'ライブラリの項目としては確認していない' },
]
const LIB_ONLY: { key?: 'division' | 'trade' | 'landPrice'; text: string }[] = [{ key: 'division', text: '区域区分（市街化調整区域か。XKT001）' }, { key: 'trade', text: '周辺の取引価格の傾向（地区単位。XIT001）' }, { key: 'landPrice', text: '近くの地価公示・地価調査（XPT002）' }, { text: '将来推計人口（250mメッシュ。XKT013）' }, { text: '医療機関（XKT010）・小学校区（XKT004）' }]
const WHO = '相続した土地の持ち主が、売る・貸す・活かす・手放すを専門家に相談する前に、土地の条件と聞くことを1枚にまとめるシートです。'
const ORDER = ['place', 'answers', 'conditions', 'exits', 'print'] as const
const BASIS = { data: 'データ', library: 'ライブラリ由来', answer: 'あなたの回答による', none: 'データなし' } as const
const EXIT_LABEL: Record<Exit['key'], string> = { sell: '売る', rent: '貸す', use: '活かす', release: '手放す' }

const STEP_META: Record<string, { title: string; hint: string }> = {
  place: { title: '土地の場所を決める', hint: '住所・駅名で検索して「この位置を土地として使う」、または地図をクリック' },
  answers: { title: '地図では分からないことに答える', hint: '建物・地目・接道・相続登記。分からなければそのままで構いません' },
  conditions: { title: '土地の条件を確かめる', hint: '用途地域・災害の想定区域など（公開データから）' },
  exits: { title: '4つの出口の「聞くこと」を読む', hint: '売る・貸す・活かす・手放す。相談先に聞くことの一覧です' },
  print: { title: '1枚シートを読み、印刷・PDFで保存する', hint: 'シートを開けば完了。印刷は任意で、A4・1ページで出ます' },
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

// 実行サンプル（?sample=1）: 第6回試験の被験者の到達状態。検索語・答えた項目は報告のとおり（表示値は実データで再計算）
const SAMPLE_MODE = isSampleMode()
const SUBJECT_QUERY = '徳島駅'
const SUBJECT_ANSWERS: Answers = { landUse: 'その他', registered: '未' }
const SUBJECT_SEEN = { conditions: true, exits: true, print: true }
const EXAMPLE_PLACE = '徳島駅'

export default function App() {
  const [step, setStep] = useState(SAMPLE_MODE ? 'print' : 'place')
  const [data, setData] = useState<AreaData | null>(null)
  const [dataError, setDataError] = useState(false)
  const [pin, setPin] = useState<{ lon: number; lat: number } | null>(null)
  const [baseFacts, setFacts] = useState<Facts | null>(null)
  const [lib, setLib] = useState<ReinfolibData | null>(null)
  const [libTried, setLibTried] = useState(false)
  const [answers, setAnswers] = useState<Answers>(SAMPLE_MODE ? SUBJECT_ANSWERS : {})
  const [answered, setAnswered] = useState(SAMPLE_MODE)
  const [exitKey, setExitKey] = useState<Exit['key']>('sell')
  const [copied, setCopied] = useState(false)
  const [overlay, setOverlay] = useState('none')
  const [showZones, setShowZones] = useState(true)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(SAMPLE_MODE ? SUBJECT_QUERY : '')
  const [hit, setHit] = useState<SearchHit | null>(null)
  const [address, setAddress] = useState<string | null | 'loading'>(null)
  const [seen, setSeen] = useState<Record<string, boolean>>({})
  const [printed, setPrinted] = useState(false)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const desktop = useIsDesktop()
  const seq = useRef(0)
  const overlayRef = useRef(overlay)
  overlayRef.current = overlay

  useEffect(() => {
    fetchData<AreaData>('biz-realestate', 'tokushima.json').then(setData).catch(() => setDataError(true))
    // 不動産情報ライブラリの取得結果（任意）。無い・形が違う・読めない場合は null＝「ライブラリ由来」は一切出さない
    fetchData<unknown>('biz-realestate', 'reinfolib.json').then((j) => setLib(isReinfolibData(j))).catch(() => setLib(null)).finally(() => setLibTried(true))
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
    map.on('remove', () => { if (mapRef.current === map) mapRef.current = null })
    setMapEpoch((n) => n + 1)
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
  }, [hit, mapEpoch])

  // 地図の表示領域が変わった時（シートのプレビューとの切替）に大きさを合わせる
  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.resize(), 60)
    return () => clearTimeout(t)
  }, [step])

  // ---- 操作 ----
  const choose = useCallback(async (lon: number, lat: number, label = '地図で指した土地', example = false) => {
    const mine = ++seq.current
    setPin({ lon, lat })
    setHit(null)
    setBusy(true)
    setAddress('loading')
    setStatus('公開データを集めています…')
    const [f, addr] = await Promise.all([analyze(data, lon, lat, label), reverseGeocode(lon, lat)])
    if (mine !== seq.current) return
    setBusy(false)
    setFacts(example ? { ...f, example: true } : f)
    if (example) { setAnswers(SAMPLE_ANSWERS); setAnswered(true) }
    setAddress(addr)
    setStatus(f.inArea ? '公開データの取得が完了しました。' : 'この地点は地図データの範囲（徳島市周辺）の外です。用途地域・公共交通は出ません。')
  }, [data])

  // 実行サンプル: データが読めたら、被験者と同じく「徳島駅」の位置を土地として確定する（実データで再計算）
  const sampleDone = useRef(false)
  useEffect(() => {
    if (!SAMPLE_MODE || sampleDone.current || !data || !libTried) return
    sampleDone.current = true
    const h = pickSearchHit(SUBJECT_QUERY, [], data)
    if (h) void choose(h.lon, h.lat, `検索した位置（${h.title}）`)
  }, [data, libTried, choose])

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

  // 例: 徳島駅の位置（実在の位置）で、検索と同じく公開データを取得する。回答だけが例（架空）
  const showExample = () => {
    const h = pickSearchHit(EXAMPLE_PLACE, [], data) ?? { lon: 134.5515, lat: 34.07451, title: '徳島駅' }
    setHit(null)
    setQuery(EXAMPLE_PLACE)
    mapRef.current?.jumpTo({ center: [h.lon, h.lat], zoom: 15 })
    void choose(h.lon, h.lat, `例の位置（${h.title}）`, true)
  }

  // ライブラリ由来のデータは、同梱の取得結果をこの地点・住所に照らして足す（取得結果が無ければ何も足さない）
  const facts = useMemo<Facts | null>(() => {
    if (!baseFacts || !pin) return baseFacts
    return { ...baseFacts, lib: lookupLibrary(lib, pin.lon, pin.lat, typeof address === 'string' ? address : null) }
  }, [baseFacts, lib, pin, address])

  const sources = useMemo(() => buildSources(lib), [lib])
  const sheet = useMemo(() => (facts ? buildSheet(facts, answers) : null), [facts, answers])
  const rows = useMemo(() => (facts ? summarize(facts) : []), [facts])
  const digest = useMemo(() => (facts && sheet ? buildDigest(facts, sheet) : []), [facts, sheet])
  const coord = facts && !facts.example && pin ? `（北緯${pin.lat.toFixed(4)}度 東経${pin.lon.toFixed(4)}度）` : ''
  const addrText = address === 'loading' ? '住所を取得中…' : address ? address : '住所を取得できなかった'
  const exampleName = facts?.place.match(/（(.+)）$/)?.[1] ?? EXAMPLE_PLACE
  const where = !facts || !pin ? ''
    : facts.example && !address ? `例の位置: ${exampleName}付近（町名は取得できませんでした）`
    : `${facts.example ? '例の位置' : '指定した位置'}: ${addrText}付近${coord}`
  const printLib = useMemo(() => (facts ? libPrintLine(facts) : null), [facts])
  const glossary = useMemo(() => {
    if (!sheet) return []
    const t = JSON.stringify(sheet.exits) + sheet.missing.join('') + digest.join('') + rows.map((r) => r.value).join('')
    return glossaryFor(t + '国庫帰属')
  }, [sheet, digest, rows])

  // ---- 手順（サイドバー） ----
  // 土地が変わったら閲覧・印刷の記録をリセット。条件・4出口は、その手順を実際に開いたら「読んだ」とする
  useEffect(() => { setSeen(SAMPLE_MODE && facts ? SUBJECT_SEEN : {}); setPrinted(false) }, [facts])
  useEffect(() => {
    if (facts && (step === 'conditions' || step === 'exits' || step === 'print')) setSeen((s) => (s[step] ? s : { ...s, [step]: true }))
  }, [facts, step])
  useEffect(() => {
    const h = () => setPrinted(true)
    window.addEventListener('afterprint', h)
    return () => window.removeEventListener('afterprint', h)
  }, [])
  useAppSteps(
    (['place', 'answers', 'conditions', 'exits', 'print'] as const).map((id) => ({
      id,
      title: STEP_META[id].title,
      hint: STEP_META[id].hint.split('。')[0],
      action: id === 'place' && !facts ? '検索して「この位置を土地として使う」' : id === 'answers' && facts && !answered ? '回答を選ぶ、または「分からないまま済にする」' : undefined,
      // 手順1は操作で済、手順2は「回答を1つ選ぶ／分からないまま済にするを押す」で済、3〜5は「土地が決まった状態で表示したら済」（印刷は任意。印刷しても済になる）
      done: id === 'place' ? !!facts : id === 'answers' ? !!facts && answered : !!facts && (!!seen[id] || (id === 'print' && printed)),
    })),
    { activeId: step, onSelectStep: setStep, description: DESCRIPTION },
  )

  // ---- 1枚シート（画面の「手順5」プレビューと印刷で同じものを使う） ----
  const sheetEl = sheet && facts && (
    <Card className="print-sheet print:rounded-none print:border-0 print:p-0 print:shadow-none" id="rs-sheet" data-testid="sheet">
      <CardHeader className="print:p-0 print:pb-1">
        <CardTitle className="text-lg print:text-[13pt]">{sheet.title}</CardTitle>
        <p className="text-xs text-muted-foreground print:text-[8pt] print:text-black">
          {sheet.example && <Badge variant="outline" className="mr-1 border-orange-600 text-orange-800">例（回答は架空）</Badge>}
          {sheet.example && '徳島駅の位置の実データ。実在の相続土地ではありません。 '}
          {where} 作成日: {new Date().toLocaleDateString('ja-JP')}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 print:space-y-1 print:p-0 print:text-[7.5pt] print:leading-tight">
        {digest.length > 0 && (
          <section aria-label="まず確認すること" data-testid="digest" className="rounded-md border-2 border-sky-700 bg-sky-50 p-2 print:border print:bg-white print:p-1">
            <h3 className="text-sm font-bold print:text-[9pt]">まず確認すること（要約）</h3>
            <ul className="list-disc pl-5 text-sm print:text-[7.5pt]">{digest.map((d) => <li key={d}><Annotated text={d} /></li>)}</ul>
          </section>
        )}
        <section aria-label="あなたの回答" data-testid="answers" className="rounded-md border p-2 text-sm print:p-1 print:text-[7.5pt]">
          <h3 className="text-sm font-bold print:mr-2 print:inline print:text-[8pt]">{sheet.example ? 'あなたの回答（例・架空）' : 'あなたの回答'}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5 print:inline-flex print:gap-x-3">
            {QUESTIONS.map((q) => {
              const v = answers[q.key] ?? '不明'
              const label = q.options.find((o) => o[0] === v)?.[1] ?? '分からない'
              return <li key={q.key}>{q.short}：<b className={v === '不明' ? 'font-normal text-muted-foreground print:text-black' : ''}>{label}</b></li>
            })}
          </ul>
        </section>
        <MobileFold enabled={!desktop} title="記号の見かた">
        <section aria-label="記号の見かた" data-testid="legend" className="rounded-md border bg-muted/30 p-2 text-xs print:p-1 print:text-[6.5pt]">
          <p className="mb-0.5 font-bold print:mb-0 print:mr-2 print:inline">記号の見かた</p>
          <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 print:inline-flex print:flex-wrap print:gap-x-3 print:gap-y-0">
            <li className="flex items-center gap-1"><CheckCircle2 className="size-3.5 shrink-0 text-sky-700" aria-hidden /><span className="print:hidden">＝ 公開データを取得でき、特に注意点がない（「区域に入らない」を含む）</span><span className="hidden print:inline">＝特に注意点なし</span></li>
            <li className="flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0 text-orange-700" aria-hidden /><span className="print:hidden">＝ 注意が必要（想定区域に入る）</span><span className="hidden print:inline">＝注意が必要</span></li>
            <li className="flex items-center gap-1"><HelpCircle className="size-3.5 shrink-0 text-neutral-600" aria-hidden /><span className="print:hidden">＝ 分からない（データにない・範囲外・取得できなかった）</span><span className="hidden print:inline">＝分からない</span></li>
            <li><span className="mr-1 inline-block rounded border px-1">データ</span><span className="print:hidden">＝ 公開データから分かったこと</span><span className="hidden print:inline">＝公開データ</span></li>
            {lib && <li><span className="mr-1 inline-block rounded border-2 border-sky-700 bg-sky-50 px-1 font-bold">ライブラリ由来</span><span className="print:hidden">＝ 不動産情報ライブラリのAPIから取得したデータ</span><span className="hidden print:inline">＝不動産情報ライブラリのAPIから取得</span></li>}
            <li><span className="mr-1 inline-block rounded border-2 border-orange-700 px-1 font-bold">あなたの回答による</span><span className="print:hidden">＝ 選んだ回答が反映された項目</span><span className="hidden print:inline">＝回答が反映</span></li>
            <li><span className="mr-1 inline-block rounded border px-1">データなし</span><span className="print:hidden">＝ 該当データがなく、一般的な確認のみ</span><span className="hidden print:inline">＝一般的な確認のみ</span></li>
          </ul>
        </section>
        </MobileFold>
        <MobileFold enabled={!desktop} title="この土地の条件（手順3と同じ内容）">
        <section aria-label="この土地の条件">
          <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">この土地の条件（公開データから）</h3>
          <dl className="grid gap-x-4 sm:grid-cols-2 print:grid-cols-2">
            {rows.map((r) => {
              const T = TONE[r.tone]
              return (
                <div key={r.key} className={cn('flex gap-1.5 border-b py-1 print:py-0', r.key.startsWith('lib-') && r.key !== 'lib-division' && 'sm:col-span-2', r.key.startsWith('lib-') && printLib && 'print:hidden')}>
                  <T.icon className={cn('mt-0.5 size-4 shrink-0 print:size-3', T.cls)} aria-hidden />
                  <span className="sr-only">{T.sr}：</span>
                  <dt className="w-24 shrink-0 font-medium sm:w-32 print:w-20">{r.label}</dt>
                  <dd className="min-w-0 flex-1">{r.lib && <LibBadge />}<Annotated text={r.value} /></dd>
                </div>
              )
            })}
            {printLib && (
              // 印刷だけ: ライブラリに関する行を1行にまとめる（A4・1ページに収めるため。画面は上の行のまま）
              <div className="hidden gap-1.5 border-b print:col-span-2 print:flex print:py-0" data-testid="lib-print-row">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-sky-700" aria-hidden />
                <dt className="w-20 shrink-0 font-medium">区域・価格の参考</dt>
                <dd className="min-w-0 flex-1"><LibBadge />{printLib}</dd>
              </div>
            )}
          </dl>
        </section>
        </MobileFold>
        <section aria-label="4つの出口ごとの聞くこと">
          <h3 className="mb-1 text-sm font-bold print:mb-0.5 print:text-[9pt]">4つの出口ごとに、専門家に聞くこと</h3>
          {!desktop && <ExitPicker sheet={sheet} value={exitKey} onChange={setExitKey} />}
          <div className="grid gap-3 md:grid-cols-2 print:hidden">
            {sheet.exits.map((e) => <ExitBlock key={e.key} e={e} hiddenOnScreen={!desktop && e.key !== exitKey} />)}
          </div>
          {/* 印刷: 出口の順を保ったまま左右の高さをそろえて2段に分ける。途中で分かれた出口は右の段に「（続き）」の見出しを出す */}
          <div className="hidden print:grid print:grid-cols-2 print:items-start print:gap-1.5" data-testid="print-exits">
            {splitForPrint(sheet.exits).map((col, ci) => (
              <div key={ci}>
                {col.map((b) => <ExitBlock key={b.key + (b.cont ? '-cont' : '')} e={{ key: b.key, label: b.cont ? b.label + '（続き）' : b.label, items: b.items }} note={!b.cont} />)}
              </div>
            ))}
          </div>
        </section>
        <MobileFold enabled={!desktop} title="データにない項目・用語の説明・出典">
        <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2 print:gap-1.5">
          <MissingList sheet={sheet} part="missing" lib={!!lib} />
          <MissingList sheet={sheet} part="other" lib={!!lib} />
        </div>
        {glossary.length > 0 && (
          <section aria-label="用語の説明" data-testid="glossary">
            <h3 className="text-sm font-bold print:mr-2 print:inline print:text-[8pt]">用語の説明</h3>
            <ul className="text-xs print:text-[6.5pt]">{glossary.map((g) => <li key={g.term} className={cn('print:mr-2 print:inline', g.re.test('国庫帰属') && 'print:hidden')}><b>{g.term}</b>＝{g.text}</li>)}</ul>
          </section>
        )}
        <div className="mt-3 space-y-1 text-xs text-muted-foreground print:mt-0 print:space-y-0 print:text-[6.5pt] print:leading-tight print:text-black">
          <p>
            出典: 国土地理院（地図・住所検索・逆ジオコーダ・ハザードマップポータルサイト）、国土数値情報 用途地域（国土交通省・令和元年度・徳島県）を加工して作成、GTFSデータリポジトリ（CC BY 4.0）。
            {!lib && <>この画面は国土交通省「不動産情報ライブラリ」（https://www.reinfolib.mlit.go.jp/）のAPIから取得していません。上の「ライブラリで確認する項目」はそちらで確認してください。国のデータを加工した参考情報であり、</>}
            法的・税務的な判断や査定ではありません。区域境界付近や古いデータでは実際と異なります。必ず相談先で確認してください。
          </p>
          {/* 利用規約が求める表示（出典・加工の旨・第7条のクレジット・第8条の責任明示）。印刷でページをまたがない */}
          {lib && <p data-testid="lib-credit" className="break-inside-avoid">「ライブラリ由来」の項目は、{REINFOLIB_ATTRIBUTION}（{lib.fetchedAt}取得）。{REINFOLIB_PROCESSED}。{REINFOLIB_CREDIT}。{REINFOLIB_RESPONSIBILITY}。</p>}
        </div>
        </MobileFold>
      </CardContent>
    </Card>
  )

  const noLand = (
    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-land">
      {SAMPLE_MODE && !baseFacts ? '実行サンプルの土地を読み込んでいます…' : '土地の位置がまだ決まっていません。土地の位置を決める手順を済ませると、内容が出ます。'}
    </p>
  )

  const copyText = async () => {
    if (!sheet || !facts) return
    const lines = QUESTIONS.map((q) => `${q.short} ${q.options.find((o) => o[0] === (answers[q.key] ?? '不明'))?.[1] ?? '分からない'}`)
    try {
      await navigator.clipboard.writeText(sheetToText(sheet, rows, digest, where, lines))
      setCopied(true)
    } catch {
      setCopied(false)
      setStatus('コピーできませんでした。印刷・PDFで保存してください。')
    }
  }

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
              <Button type="button" variant="ghost" size="sm" className="h-auto min-h-11 px-2 text-xs md:min-h-7" onClick={() => moveTo(pickSearchHit('徳島駅', [], data) ?? { lon: 134.5515, lat: 34.07451, title: '徳島駅' })}>検索せずに徳島駅付近を表示</Button>
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
                <Label htmlFor="rs-zones" className="flex-1 py-2 text-sm md:py-0">用途地域の範囲</Label>
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
            <div className="space-y-1">
              <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal py-2 md:min-h-8" disabled={busy} data-testid="use-example" onClick={showExample}>
                {facts?.example ? '例の土地をもう一度取得する' : '徳島駅付近の例で試す'}
              </Button>
              <p className="text-xs text-muted-foreground">徳島駅の位置の公開データで試せます。実在の相続土地ではなく、回答は例（架空）です。{facts && !facts.example ? '別の土地に切り替わります。' : ''}</p>
            </div>
            <NextHint step="place" ready={!!facts && !busy} />
          </div>
        )
      case 'answers':
        return (
          <div className="space-y-3">
            <p className="text-sm">答えると各出口の聞くことが具体的になります。分からなければそのままで構いません。<span className="block text-xs text-muted-foreground">選んだ内容は、この端末の中だけで使い、送信・保存はしません。</span></p>
            {QUESTIONS.map((q) => (
              <div key={q.key} role="group" aria-label={q.legend}>
                <p className="mb-1 text-sm font-medium">{q.legend}</p>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="flex-wrap justify-start"
                  value={answers[q.key] ?? '不明'}
                  onValueChange={(v) => { setAnswers((a) => ({ ...a, [q.key]: v || '不明' })); setAnswered(true) }}
                >
                  {q.options.map(([v, l]) => <ToggleGroupItem key={v} value={v} className="h-auto min-h-11 whitespace-normal px-3 py-1.5 text-xs md:min-h-8 md:px-2 data-[state=on]:bg-sky-100 data-[state=on]:font-bold data-[state=on]:text-sky-900">{l}</ToggleGroupItem>)}
                </ToggleGroup>
              </div>
            ))}
            <p className="rounded-md bg-muted/50 p-2 text-xs" data-testid="answers-summary" role="status">
              {facts
                ? `回答はシートに反映されます（いま: ${QUESTIONS.map((q) => `${q.short} ${q.options.find((o) => o[0] === (answers[q.key] ?? '不明'))?.[1] ?? '分からない'}`).join('／')}）。`
                : '土地の位置を決めると、回答がシートに反映されます。'}
            </p>
            {facts && !answered && (
              <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal py-2" data-testid="skip-answers" onClick={() => setAnswered(true)}>どれも分からないので、このまま済にする</Button>
            )}
            {facts && answered && <p className="text-xs font-medium text-sky-900" role="status" data-testid="answers-done">この手順は済です（回答はいつでも変えられます）。</p>}
            <NextHint step="answers" ready={!!facts && answered} />
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
                    <dd className="min-w-0 flex-1">{r.lib && <LibBadge />}<Annotated text={r.value} /></dd>
                  </div>
                )
              })}
            </dl>
            <ul className="space-y-0.5 rounded-md bg-muted/40 p-2 text-xs" aria-label="記号の見かた">
              <li className="flex items-center gap-1"><CheckCircle2 className="size-3.5 shrink-0 text-sky-700" aria-hidden />データを取得でき、特に注意点がない</li>
              <li className="flex items-center gap-1"><AlertTriangle className="size-3.5 shrink-0 text-orange-700" aria-hidden />注意が必要（想定区域に入る）</li>
              <li className="flex items-center gap-1"><HelpCircle className="size-3.5 shrink-0 text-neutral-600" aria-hidden />分からない（データにない・範囲外・取得できなかった）</li>
            </ul>
            <LibraryBox lib={lib} sources={sources} />
            <NextHint step="conditions" ready />
          </div>
        )
      case 'exits':
        if (!sheet) return noLand
        return (
          <div className="space-y-3" data-testid="exits-panel">
            {!desktop && <ExitPicker sheet={sheet} value={exitKey} onChange={setExitKey} />}
            {sheet.exits.map((e) => <ExitBlock key={e.key} e={e} hiddenOnScreen={!desktop && e.key !== exitKey} />)}
            <MissingList sheet={sheet} part="missing" lib={!!lib} />
            <MissingList sheet={sheet} part="other" lib={!!lib} />
            <NextHint step="exits" ready />
          </div>
        )
      case 'print':
        return (
          <div className="space-y-3">
            <SustainCard lib={lib} />
            {!sheet ? noLand : (
              <>
                <p className="text-sm">土地の条件と4出口の「聞くこと」を、A4・1枚にまとめたシートです。印刷画面で「PDFに保存」を選ぶとPDFになります。相談先にメールなどで送る時は、テキストでコピーできます。</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="lg" className="min-h-11" onClick={() => { setPrinted(true); window.print() }}><Printer className="size-5" />印刷・PDFで保存する</Button>
                  <Button type="button" size="lg" variant="outline" className="min-h-11" data-testid="copy-text" onClick={() => void copyText()}><Copy className="size-5" />テキストでコピー</Button>
                </div>
                {printed && <p className="text-xs text-muted-foreground" role="status">印刷画面を開きました。</p>}
                {copied && <p className="text-xs text-muted-foreground" role="status" data-testid="copied">シートの内容をテキストでコピーしました（この端末のクリップボードだけ。送信はしていません）。</p>}
                <NextHint step="print" ready />
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
  // スマホは、地図を手順1〜3だけに出す（手順4・5では読む面積を広げる）。1枚シートはスマホでは手順パネル内に全幅で出し、入れ子スクロールにしない
  const showAside = desktop || step === 'place' || step === 'answers' || step === 'conditions'
  const initCenter = useMemo<[number, number]>(() => (pin ? [pin.lon, pin.lat] : CENTER), [showAside]) // eslint-disable-line react-hooks/exhaustive-deps

  const sheetWrap = (
    <div className={cn('rs-sheet-wrap bg-muted/30 p-3', desktop && 'h-full overflow-y-auto', !showSheet && 'hidden')} data-testid="sheet-wrap">
      {sheetEl}
    </div>
  )
  const aside = showAside ? (
    <div className="relative h-full">
      <div className={cn('h-full', showSheet && desktop && 'hidden')}>
        <MapView
          center={initCenter}
          zoom={14}
          layers={layers}
          onClick={step === 'place' ? onMapClick : undefined}
          onMapReady={onMapReady}
          basemap="std"
          attribution="ハザードマップポータル（国土地理院）／国土数値情報 用途地域（国土交通省）"
          className={cn('h-full', step === 'place' && 'cursor-crosshair')}
          ariaLabel="地図。手順1ではクリックまたはタップで土地の位置を指定"
        />
      </div>
      {/* 1枚シート（パソコン）: 手順5では画面に出す。それ以外でも印刷（Ctrl+P）に備えて DOM に残す */}
      {desktop && sheetWrap}
    </div>
  ) : undefined

  return (
    <>
      <PageHeader appId="biz-realestate" compact actions={<SourceDialog sources={sources} />} />
      <div className="shrink-0 space-y-0.5 border-b bg-muted/40 px-4 py-1.5 text-xs print:hidden" data-testid="who-why">
        <p className="font-bold text-foreground">{WHO}</p>
        <p className="text-muted-foreground">動く最小限のデモ（地図データは徳島市のみ）。金額の推定や「売るべき」は出さず、法律・税金の助言ではありません。</p>
      </div>
      <StepLayout title={meta.title} hint={meta.hint} aside={aside}>
        {panel}
        {!desktop && <div className={showSheet ? 'mt-3' : undefined}>{sheetWrap}</div>}
      </StepLayout>
      <style>{`
@media print {
  @page { size: A4; margin: 6mm; }
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

function NextHint({ step, ready }: { step: string; ready: boolean }) {
  const i = ORDER.indexOf(step as (typeof ORDER)[number])
  const next = ORDER[i + 1]
  if (!ready) return null
  return (
    <p className="rounded-md bg-sky-50 px-2 py-1.5 text-xs font-medium text-sky-900 print:hidden" data-testid="next-hint">
      {next ? `次は手順${i + 2}：${STEP_META[next].title}（手順バーから選びます。スマホは画面上部、パソコンは左）` : 'これで最後の手順です。印刷は任意で、シートは画面で読めます。'}
    </p>
  )
}

/** スマホの画面だけ、長い部分を開閉式にする（印刷には常に全部入る）。デスクトップは常に全部表示 */
function MobileFold({ enabled, title, children }: { enabled: boolean; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!enabled) return <>{children}</>
  return (
    <div className="space-y-2 print:space-y-1">
      <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-center justify-between rounded-md border bg-muted/30 px-3 text-left text-sm font-medium print:hidden" onClick={() => setOpen((o) => !o)} data-testid="fold-toggle">
        <span>{title}</span><span className="text-xs text-muted-foreground">{open ? '閉じる' : '開く'}</span>
      </button>
      <div className={cn('space-y-3 print:space-y-1', !open && 'hidden print:block')}>{children}</div>
    </div>
  )
}

function LibBadge() {
  return <span className="mr-1 inline-block rounded border-2 border-sky-700 bg-sky-50 px-1 text-[11px] font-bold text-sky-900 print:border print:bg-white print:text-[6.5pt] print:text-black" data-testid="lib-badge">ライブラリ由来</span>
}

function LibraryBox({ lib, sources }: { lib: ReinfolibData | null; sources: SourceItem[] }) {
  const got = libSectionNames(lib)
  return (
    <section className="space-y-1.5 rounded-md border-2 border-sky-700 p-2 text-xs" aria-label="不動産情報ライブラリとの関係" data-testid="lib-box">
      <h3 className="text-sm font-bold">不動産情報ライブラリ（国土交通省）との関係</h3>
      {lib ? (
        <>
          <p data-testid="lib-status">「ライブラリ由来」の印の付いた行は、ライブラリのAPIから事前に取得した徳島市のデータ（{got.join('・')}、取得日 {lib.fetchedAt}）をこの地点に照らしたもの。印のない行は、ライブラリから取得したものではありません。</p>
          {/* 規約の文（クレジット・責任の所在・加工の旨）は「出典・ライセンス」と1枚シートの下部に集める。ここは短い出典と導線だけ */}
          <p data-testid="lib-source-short">
            出典：国土交通省 不動産情報ライブラリ。利用規約のクレジットと責任の所在は
            <SourceDialog sources={sources} trigger={<button type="button" className="mx-0.5 inline min-h-6 font-bold text-primary underline underline-offset-2" data-testid="lib-terms-link">出典・ライセンス</button>} />
            と1枚シートの下部にあります。
          </p>
        </>
      ) : (
        <p data-testid="lib-status"><b>この画面の数値・判定は、ライブラリのAPIから取得したものではありません。</b>（ライブラリの取得データを読み込めませんでした。）</p>
      )}
      <details>
        <summary className="min-h-8 cursor-pointer py-1 font-bold">項目ごとの対応（ライブラリにもある項目・ライブラリで確認する項目）</summary>
        <ul className="mt-1 space-y-1">
          {LIB_SCREEN.map((r) => (
            <li key={r.item} className="rounded border p-1.5"><b>{r.item}</b>：{r.from}。<span className="text-sky-900">{r.lib}。</span></li>
          ))}
        </ul>
        <p className="mt-1.5 font-bold">ライブラリで確認する項目{lib ? '（この画面では取得していないもの）' : '（この画面では取得していません）'}</p>
        <ul className="list-disc pl-5">{LIB_ONLY.filter((m) => !(m.key && lib?.[m.key])).map((m) => <li key={m.text}>{m.text}</li>)}</ul>
        <p className="mt-1">不動産情報ライブラリ（国土交通省）へのリンク：<a className="text-primary underline" href={LIB_URL} target="_blank" rel="noreferrer">{LIB_URL}</a>（括弧内はライブラリのAPI名）</p>
      </details>
    </section>
  )
}

/** この構想の続け方（想定）。出典は提出文書（service.md）。書かれていないこと（料金・担い手）は「未定」 */
function SustainCard({ lib }: { lib: ReinfolibData | null }) {
  const rows: [string, string][] = [
    ['想定する使い手', '相続した土地の持ち主（無料）。自治体の空き家相談窓口（職員と相談者が同じシートを見る窓口版。有償）'],
    ['料金', '相続人は無料。窓口版の金額は未定'],
    ['データの更新', lib ? `不動産情報ライブラリのAPIから事前に取得して同梱（取得日 ${lib.fetchedAt}）。更新するには、手元でもう一度取得してから公開し直す` : '用途地域などは同梱データ（令和元年度版）。ライブラリの取得データは、この画面では読み込めていない'],
    ['更新・運用する担い手', '未定'],
    ['位置の扱い', '検索にだけ使い、記録しない'],
  ]
  return (
    <section className="rounded-md border p-2 text-xs" aria-label="この構想の続け方（想定）" data-testid="sustain">
      <h3 className="text-sm font-bold">この構想の続け方（想定）</h3>
      <dl className="mt-1 divide-y">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 py-1"><dt className="w-24 shrink-0 font-medium">{k}</dt><dd className="min-w-0 flex-1">{v}</dd></div>
        ))}
      </dl>
      <p className="mt-1 text-muted-foreground">提出文書の構想です。実施は決まっていません。</p>
    </section>
  )
}

function ExitPicker({ sheet, value, onChange }: { sheet: import('./lib').Sheet; value: Exit['key']; onChange: (k: Exit['key']) => void }) {
  return (
    <div role="group" aria-label="出口を選ぶ" className="print:hidden" data-testid="exit-picker">
      <p className="mb-1 text-xs text-muted-foreground">出口を1つ選ぶと、その出口の「聞くこと」だけ表示します（印刷とテキストのコピーには4つとも入ります）。</p>
      <ToggleGroup type="single" variant="outline" className="w-full" value={value} onValueChange={(v) => { if (v) onChange(v as Exit['key']) }}>
        {sheet.exits.map((e) => (
          <ToggleGroupItem key={e.key} value={e.key} className="h-auto min-h-11 flex-1 px-1 text-sm data-[state=on]:bg-sky-100 data-[state=on]:font-bold data-[state=on]:text-sky-900">
            {EXIT_LABEL[e.key]}<span className="ml-0.5 text-[11px] font-normal">（{e.items.length}）</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function useIsDesktop() {
  const q = '(min-width: 768px)'
  const [v, setV] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(q).matches))
  useEffect(() => {
    const m = window.matchMedia(q)
    const h = () => setV(m.matches)
    m.addEventListener('change', h)
    return () => m.removeEventListener('change', h)
  }, [])
  return v
}

function ExitBlock({ e, hiddenOnScreen = false, note = true }: { e: import('./lib').Exit; hiddenOnScreen?: boolean; note?: boolean }) {
  return (
    <div className={cn('rounded-md border p-3 print:mb-1.5 print:p-1.5', hiddenOnScreen && 'hidden print:block')} data-testid={`exit-${e.key}`}>
      <h4 className="mb-1 text-base font-bold print:mb-0.5 print:text-[9pt]">{e.label}</h4>
      {e.key === 'release' && note && (
        <p className="mb-1 text-xs text-muted-foreground print:text-[6.5pt] print:text-black">相続土地国庫帰属制度（国庫帰属）＝相続した土地を、一定の条件で国に引き取ってもらう制度。</p>
      )}
      <ul className="space-y-2 print:space-y-0.5">
        {e.items.map((it, i) => (
          <li key={i} className={cn('text-sm print:break-inside-avoid print:text-[7pt]', it.media === 'screen' && 'print:hidden', it.media === 'print' && 'hidden print:list-item')} data-media={it.media}>
            <span className="block print:inline">
              <span className={cn('mr-1 inline-block rounded border px-1 text-[11px] print:text-[6.5pt]', it.basis === 'answer' && 'border-2 border-orange-700 bg-orange-50 font-bold print:bg-white', it.basis === 'library' && 'border-2 border-sky-700 bg-sky-50 font-bold text-sky-900 print:bg-white print:text-black')}>{BASIS[it.basis]}</span>
              <Annotated text={it.fact} />
            </span>
            <span className="block font-medium text-sky-900 print:ml-1 print:inline print:text-black">→ <Annotated text={it.ask} />（{it.who}）</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MissingList({ sheet, part, lib }: { sheet: import('./lib').Sheet; part: 'missing' | 'other'; lib: boolean }) {
  const items = part === 'missing' ? sheet.missing : sheet.otherItems
  return (
    <section>
      <h3 className="text-sm font-bold print:text-[8pt] print:leading-tight">{part === 'missing' ? 'データにない項目（相談先で確かめる）' : (lib ? '不動産情報ライブラリ（国土交通省）で確認する項目（この地点で出ていないもの）' : '不動産情報ライブラリ（国土交通省）で確認する項目（この画面では取得していません）')}</h3>
      <ul className="list-disc pl-5 text-sm print:pl-4 print:text-[7pt] print:leading-tight">{items.map((m) => <li key={m}><Annotated text={m} /></li>)}</ul>
    </section>
  )
}
