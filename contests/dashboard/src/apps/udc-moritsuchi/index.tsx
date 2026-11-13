import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Crosshair, Download, LocateFixed, MapPin, Search, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { StepLayout } from '@/components/shared/StepLayout'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { downloadGeoJson, downloadText } from '@/components/shared/downloadText'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { useHashState } from '@/components/shared/useHashState'
import { useAppSteps } from '@/components/shared/AppSteps'
import { parseHashQuery } from '@/components/shared/hashState'
import { fetchData } from '@/lib/data'
import { isSampleMode, withSampleMark } from '@/lib/sample'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ATAMI_STATION, KINDS, KIND_LABEL, distText, fmtDate, inCoverage, kindDescription,
  ledgerSummary, makeRecord, nearbyFills, nearestFill, reportText, sanitizeRecords, toCSV, toGeoJSON, fromGeoJSON,
  type FillFeature, type MwRecord, type NearFill,
} from './lib'
import { KIND_HELP, NEAR_M, nearSummary, searchPlaces, type PlaceHit } from './search'
import { markCsv, markGeoJson } from '../_samples/mark'
import { KindExplain, SitePhotoCompare } from './SitePhotoCompare'

const TILE = 'https://cyberjapandata.gsi.go.jp/xyz/'
const KIND_COLOR: Record<string, string> = { 谷埋め型: '#D55E00', 腹付け型: '#56B4E9', 区分なし: '#999999' }
const KIND_COLOR_EXPR = ['match', ['get', 'kind'], '谷埋め型', KIND_COLOR['谷埋め型'], '腹付け型', KIND_COLOR['腹付け型'], KIND_COLOR['区分なし']]
const JUMPS = [
  { label: '熱海市', lng: 139.073, lat: 35.1, z: 13 },
  { label: '伊東市', lng: 139.1, lat: 34.96, z: 11.5 },
]
const BASES = [
  { id: 'std', label: '標準' },
  { id: 'pale', label: '淡色' },
  { id: 'photo', label: '航空写真(現在)' },
] as const
const OLDS = [
  { id: 'none', label: 'なし' },
  { id: 'ort_old10', label: '1961〜69年' },
  { id: 'gazo1', label: '1974〜78年' },
] as const
/** 記録する位置の輪の色。橙・青の造成地や写真の上でも見える濃い赤紫 */
const PICK_COLOR = '#A0145E'
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const RASTERS = [
  { id: 'mw-std', path: 'std', ext: 'png', minzoom: 5, maxzoom: 18 },
  { id: 'mw-photo', path: 'seamlessphoto', ext: 'jpg', minzoom: 5, maxzoom: 18 },
  { id: 'mw-ort_old10', path: 'ort_old10', ext: 'png', minzoom: 10, maxzoom: 17 },
  { id: 'mw-gazo1', path: 'gazo1', ext: 'jpg', minzoom: 10, maxzoom: 17 },
]

const SOURCES = [
  {
    name: '大規模盛土造成地（国土数値情報 A54、2023年版、データ基準日 2023-03-31）',
    provider: '国土交通省 国土数値情報（静岡県分から熱海市14か所・伊東市13か所を抽出。座標を小数5桁に丸め）',
    license: 'CC BY 4.0',
    url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A54-2023.html',
    note: '「安全性の確認が必要な盛土造成地」であり、直ちに危険な盛土造成地ではありません。すべての盛土造成地が載っているわけではありません。宅地建物取引業法に基づく重要事項説明等の根拠には使えません。',
  },
  {
    name: '背景地図（標準・淡色・シームレス空中写真・年代別の写真 1961〜1969年／1974〜1978年）',
    provider: '国土地理院 地理院タイル',
    license: '国土地理院コンテンツ利用規約',
    url: 'https://maps.gsi.go.jp/development/ichiran.html',
    note: '年代別の写真は撮影年・提供範囲に依存し、範囲外は空白になります（ズーム10〜17で表示）。',
  },
  { name: '地図描画: MapLibre GL JS', license: 'BSD-3-Clause' },
  {
    name: '背景: 不法・危険盛土等への対処方策ガイドライン（国土交通省・農林水産省）',
    note: '盛土は住民の通報で見つかることが多く、通報しやすい環境が重要としています。静岡県の通報先の例はガイドライン2.3に紹介されています。',
    url: 'https://www.mlit.go.jp/toshi/web/content/001634495.pdf',
  },
  {
    name: 'より正確な確認: 重ねるハザードマップ（土砂災害警戒区域などを重ねて表示できます）',
    provider: '国土地理院',
    url: 'https://disaportal.gsi.go.jp/hazardmap/maps/index.html',
  },
]

/** 実行サンプル（?sample=1）: 第6回の被験者の到達状態。値は reports/aggressor/20261111-r6/udc-moritsuchi.md による。
 *  報告にない位置は、地図の初期表示の中心（被験者が最初に見た地図の中心付近）で代用している */
const SAMPLE_REC_ID = 'sample-r6'
const SAMPLE_RECORD: MwRecord = makeRecord({
  id: SAMPLE_REC_ID, lng: 139.0765, lat: 35.1035, kind: 'crack', memo: '擁壁',
  observedAt: '2026-11-11 12:54', blurred: false, nearFill: null,
})

function stamp() {
  return fmtDate(new Date()).replace(/[- :]/g, '').slice(0, 12)
}

function bboxOf(f: FillFeature): [[number, number], [number, number]] {
  const ring = f.geometry.coordinates[0]
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
}

const DIRS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西']
/** 起点から見た造成地の方角（8方位）。造成地の範囲の中心との位置関係（データの座標から計算） */
function dirLabel(from: { lng: number; lat: number }, f: FillFeature | undefined): string {
  if (!f) return ''
  const [[w, s], [e, n]] = bboxOf(f)
  const dx = ((w + e) / 2 - from.lng) * Math.cos((from.lat * Math.PI) / 180)
  const dy = (s + n) / 2 - from.lat
  const k = Math.round((Math.atan2(dx, dy) / (Math.PI / 2)) * 2 + 8) % 8
  return DIRS[k]
}

function metersLabel(d: NearFill) {
  if (d.inside) return '範囲内'
  const m = d.distM < 100 ? Math.round(d.distM / 10) * 10 : Math.round(d.distM / 50) * 50
  return `約${m}m`
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-medium">
      <span className="inline-block size-3 rounded-sm border-2" style={{ borderColor: KIND_COLOR[kind] ?? '#999', background: (KIND_COLOR[kind] ?? '#999') + '70' }} />
      {kind}
    </span>
  )
}

export default function App() {
  const [fills, setFills] = useState<FillFeature[]>([])
  const [loadError, setLoadError] = useState('')
  const [rawRecords, setRawRecords] = useLocalStorage<MwRecord[]>('udc-moritsuchi:records', [], [SAMPLE_RECORD])
  const records = useMemo(() => sanitizeRecords(rawRecords), [rawRecords])
  const sample = isSampleMode()
  // 前回までに保存した記録（この端末に残っているもの）。手順4の「済」は、今回の操作で保存したときだけにする
  const [prevIds] = useState(() => new Set(sanitizeRecords(rawRecords).map((r) => r.id)))
  const [addedNow, setAddedNow] = useState(sample)
  const [importedN, setImportedN] = useState(0)
  const [step, setStep] = useState(sample ? 'prep' : 'place')
  const [selFill, setSelFill] = useState<string | null>(null)
  const [selRec, setSelRec] = useState<string | null>(sample ? SAMPLE_REC_ID : null)
  const [pick, setPick] = useState<{ lng: number; lat: number; nearFill: NearFill | null } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [ioMsg, setIoMsg] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [origin, setOrigin] = useState<{ label: string; lng: number; lat: number }>({ label: '熱海駅（例・目安の位置）', ...ATAMI_STATION })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchMsg, setSearchMsg] = useState('')
  const [didCompare, setDidCompare] = useState(sample)
  const [didLook, setDidLook] = useState(sample)
  const [savedMsg, setSavedMsg] = useState(sample ? `保存しました（${KIND_LABEL[SAMPLE_RECORD.kind]}／${SAMPLE_RECORD.observedAt}）。地図の黄色い丸が記録です。` : '')
  const [originChosen, setOriginChosen] = useState(sample)
  const [didPrepare, setDidPrepare] = useState(sample)

  const [base, setBase] = useHashState('base', 'std')
  const [old, setOld] = useHashState('old', 'none')
  const [opStr, setOp] = useHashState('op', '60')
  const op = Math.min(100, Math.max(0, Number(opStr) || 60))

  // フォーム
  const [kind, setKind] = useState('crack')
  const [when, setWhen] = useState(() => fmtDate(new Date()).replace(' ', 'T'))
  const [memo, setMemo] = useState('')
  const [blurred, setBlurred] = useState(false)
  const [pickMsg, setPickMsg] = useState('')

  const mapRef = useRef<maplibregl.Map | null>(null)
  const recHit = useRef(false)

  const initialView = useMemo(() => {
    const q = parseHashQuery(window.location.hash)
    const z = Number(q.get('z')), lat = Number(q.get('lat')), lng = Number(q.get('lng'))
    if (q.get('z') && q.get('lat') && q.get('lng') && isFinite(z) && z >= 5 && z <= 18 && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { center: [lng, lat] as [number, number], zoom: z }
    }
    return { center: [139.0765, 35.1035] as [number, number], zoom: 14 }
  }, [])

  useEffect(() => {
    fetchData<{ features: FillFeature[] }>('udc-moritsuchi', 'fills.geojson')
      .then((fc) => setFills(fc.features))
      .catch(() => setLoadError('盛土データを読み込めませんでした。ページを再読み込みしてください。'))
  }, [])

  // 実行サンプル: 被験者が選んだ造成地（最寄り）・昔の写真（1974〜78年）・保存した記録の近傍造成地を、実データから再計算して入れる
  useEffect(() => {
    if (!sample) return
    setOld('gazo1')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!sample || !fills.length) return
    const first = nearbyFills(origin.lng, origin.lat, fills, 1)[0]
    if (first) setSelFill(first.id)
    const nf = nearestFill(SAMPLE_RECORD.lng, SAMPLE_RECORD.lat, fills)
    setRawRecords((prev) => prev.map((r) => (r.id === SAMPLE_REC_ID ? { ...r, nearFill: nf } : r)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fills])

  /* ---------- 地図 ---------- */
  const onMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map
    map.setMinZoom(6)
    map.setMaxZoom(18)
    map.on('load', () => {
      // 現在の背景と年代別写真は、盛土レイヤーの下に自前で重ねる（共通 MapView は変更しない）
      for (const r of RASTERS) {
        map.addSource(r.id, {
          type: 'raster', tiles: [`${TILE}${r.path}/{z}/{x}/{y}.${r.ext}`], tileSize: 256, minzoom: r.minzoom, maxzoom: r.maxzoom,
          attribution: '国土地理院',
        })
        map.addLayer(
          { id: r.id, type: 'raster', source: r.id, layout: { visibility: 'none' } },
          map.getLayer('fills-fill') ? 'fills-fill' : undefined,
        )
      }
      setMapReady(true)
    })
    return undefined
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const vis = (id: string, on: boolean) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('mw-std', base === 'std')
    vis('mw-photo', base === 'photo')
    vis('mw-ort_old10', old === 'ort_old10')
    vis('mw-gazo1', old === 'gazo1')
    for (const id of ['mw-ort_old10', 'mw-gazo1']) map.setPaintProperty(id, 'raster-opacity', op / 100)
  }, [mapReady, base, old, op])

  useEffect(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = step === 'rec' ? 'crosshair' : ''
  }, [step, mapReady])

  const layers = useMemo<MapLayer[]>(() => {
    const recFc = toGeoJSON(records)
    for (const f of recFc.features) f.properties.sel = f.properties.id === selRec ? 1 : 0
    const fillsFc = { type: 'FeatureCollection', features: fills } as unknown as GeoJSON.FeatureCollection
    return [
      { id: 'fills-fill', type: 'fill', data: fillsFc, paint: { 'fill-color': KIND_COLOR_EXPR, 'fill-opacity': 0.45 } },
      { id: 'fills-line', type: 'line', data: fillsFc, paint: { 'line-color': KIND_COLOR_EXPR, 'line-width': 2.5 } },
      { id: 'fills-line-in', type: 'line', data: fillsFc, paint: { 'line-color': '#222', 'line-width': 1, 'line-dasharray': [2, 2] } },
      {
        id: 'fills-sel', type: 'line', data: fillsFc, filter: ['==', ['get', 'id'], selFill ?? ''],
        paint: { 'line-color': '#000', 'line-width': 5, 'line-opacity': 0.9 },
      },
      {
        id: 'station', type: 'circle',
        data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [origin.lng, origin.lat] } }] },
        paint: { 'circle-radius': 7, 'circle-color': '#ffffff', 'circle-stroke-color': '#000', 'circle-stroke-width': 3 },
      },
      {
        id: 'rec-halo', type: 'circle', data: recFc as unknown as GeoJSON.GeoJSON,
        paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 15, 11], 'circle-color': '#fff' },
      },
      {
        id: 'rec', type: 'circle', data: recFc as unknown as GeoJSON.GeoJSON,
        paint: {
          'circle-radius': ['case', ['==', ['get', 'sel'], 1], 11, 8], 'circle-color': '#F0E442',
          'circle-stroke-color': '#000', 'circle-stroke-width': 3,
        },
      },
      {
        id: 'pick-halo', type: 'circle',
        data: pick ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pick.lng, pick.lat] } } : EMPTY_FC,
        paint: { 'circle-radius': 21, 'circle-color': 'rgba(255,255,255,0.55)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      },
      {
        id: 'pick', type: 'circle',
        data: pick ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pick.lng, pick.lat] } } : EMPTY_FC,
        paint: { 'circle-radius': 16, 'circle-color': 'rgba(176,32,112,0.25)', 'circle-stroke-color': PICK_COLOR, 'circle-stroke-width': 5 },
      },
    ]
  }, [fills, records, selRec, selFill, pick, origin])

  const stationList = useMemo(
    () => nearbyFills(origin.lng, origin.lat, fills, 5),
    [fills, origin],
  )
  const selFillFeature = fills.find((f) => f.properties.id === selFill) ?? null

  const focusFill = useCallback((id: string) => {
    const f = fills.find((x) => x.properties.id === id)
    if (!f) return
    setSelFill(id)
    toast.success(`${id}（${f.properties.kind}）を選びました`)
    mapRef.current?.fitBounds(bboxOf(f), { padding: 70, maxZoom: 17, duration: 600 })
  }, [fills])

  /** 起点と、起点に近い造成地5件がすべて入る範囲に地図を合わせる */
  const fitOrigin = (o: { lng: number; lat: number }, duration = 600) => {
    const map = mapRef.current
    if (!map) return
    const near = nearbyFills(o.lng, o.lat, fills, 5)
    let w = o.lng, e = o.lng, so = o.lat, n = o.lat
    for (const d of near) {
      const f = fills.find((x) => x.properties.id === d.id)
      if (!f) continue
      for (const p of f.geometry.coordinates[0]) {
        w = Math.min(w, p[0]); e = Math.max(e, p[0]); so = Math.min(so, p[1]); n = Math.max(n, p[1])
      }
    }
    if (near.length) map.fitBounds([[w, so], [e, n]], { padding: 50, maxZoom: 15.5, duration })
    else map.flyTo({ center: [o.lng, o.lat], zoom: 14.5, duration })
  }
  const goOrigin = (o: { label: string; lng: number; lat: number }) => {
    setOrigin(o)
    setOriginChosen(true)
    fitOrigin(o)
  }

  // 最初の表示でも、熱海駅（例）と近い造成地が入る範囲にする（URLで表示範囲を指定した場合を除く）
  const fittedInitial = useRef(false)
  useEffect(() => {
    if (fittedInitial.current || !mapReady || !fills.length) return
    fittedInitial.current = true
    if (!parseHashQuery(window.location.hash).get('z')) fitOrigin(origin, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, fills])

  // 「確かめる」: 起点を決めたうえで表示したら済。造成地が未選択なら最寄りを選んだ状態で見せる
  useEffect(() => {
    if (step !== 'look' || !originChosen || !fills.length) return
    setDidLook(true)
    if (selFill === null) {
      const first = nearbyFills(origin.lng, origin.lat, fills, 1)[0]
      if (first) setSelFill(first.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, originChosen, fills])

  // 「見比べる」: 造成地を選んだうえで表示したら済。昔の写真が未選択なら1961〜69年を重ねて見せる
  useEffect(() => {
    if (step !== 'compare' || selFill === null) return
    setDidCompare(true)
    if (old === 'none') {
      setOld('ort_old10')
      setOp('50')
    }
    const f = fills.find((x) => x.properties.id === selFill)
    if (f) mapRef.current?.fitBounds(bboxOf(f), { padding: 70, maxZoom: 17, duration: 600 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selFill])
  const goStation = () => goOrigin({ label: '熱海駅（例・目安の位置）', ...ATAMI_STATION })

  const doSearch = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchMsg('')
    setHits(null)
    try {
      const r = await searchPlaces(query)
      setHits(r)
      setSearchMsg(r.length ? '' : '候補が見つかりませんでした。駅名や町名（例: 熱海駅、咲見町）で試してください。')
    } catch {
      setSearchMsg('検索できませんでした（国土地理院の地名検索に接続できません）。地図を動かして探すこともできます。')
    } finally {
      setSearching(false)
    }
  }

  /** 選択中の造成地へ地図を寄せる（見比べの年代を選んだ時など） */
  const fitSel = (id: string | null) => {
    const f = id ? fills.find((x) => x.properties.id === id) : null
    if (f) mapRef.current?.fitBounds(bboxOf(f), { padding: 70, maxZoom: 17, duration: 600 })
  }

  /* ---------- 位置の選択 ---------- */
  const choosePos = useCallback((lng: number, lat: number) => {
    setSavedMsg('')
    const nf = nearestFill(lng, lat, fills)
    setPick({ lng, lat, nearFill: nf })
    setPickMsg(
      inCoverage(lng, lat)
        ? distText(nf) + '。'
        : 'この位置は対象範囲（熱海市・伊東市）の外です。記録はできますが、盛土造成地データとの比較はできません。',
    )
  }, [fills])

  const onFeatureClick = (f: GeoJSON.Feature, layerId: string) => {
    if (layerId === 'rec') {
      recHit.current = true
      const id = String(f.properties?.id)
      selectRecord(id)
    } else if (layerId === 'fills-fill') {
      setSelFill(String(f.properties?.id))
    }
  }
  const onMapClick = ({ lng, lat }: { lng: number; lat: number }) => {
    if (recHit.current) {
      recHit.current = false
      return
    }
    if (step === 'rec') choosePos(lng, lat)
  }

  const goStep = (id: string) => {
    setStep(id)
    if (id !== 'rec') {
      setPick(null)
      setPickMsg('')
    }
  }

  const locate = () => {
    if (!navigator.geolocation) {
      setPickMsg('この端末では現在地を使えません。地図をタップしてください。')
      return
    }
    setPickMsg('現在地を取得中…（位置情報は端末内だけで使います）')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        choosePos(p.coords.longitude, p.coords.latitude)
        mapRef.current?.easeTo({ center: [p.coords.longitude, p.coords.latitude], zoom: Math.max(mapRef.current.getZoom(), 16) })
      },
      () => setPickMsg('現在地を取得できませんでした。地図をタップして位置を決めてください。'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const useCenter = () => {
    const c = mapRef.current?.getCenter()
    if (c) choosePos(c.lng, c.lat)
  }

  /* ---------- 記録 ---------- */
  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!pick) return
    const rec = makeRecord({
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      lng: pick.lng, lat: pick.lat, kind, memo,
      observedAt: when ? when.replace('T', ' ') : fmtDate(new Date()),
      blurred, nearFill: pick.nearFill,
    })
    if (rec.blurred) rec.nearFill = nearestFill(rec.lng, rec.lat, fills)
    setRawRecords((prev) => [...sanitizeRecords(prev), rec])
    setPick(null)
    setPickMsg('')
    setMemo('')
    setWhen(fmtDate(new Date()).replace(' ', 'T'))
    setSelRec(rec.id)
    setAddedNow(true)
    setIoMsg('')
    setSavedMsg(`保存しました（${KIND_LABEL[rec.kind]}／${rec.observedAt}）。地図の黄色い丸が記録です。`)
    toast.success('記録を保存しました')
    // 地図は動かさない（直前まで見ていた造成地との位置関係を保つ）。記録は選んだ位置にそのまま黄色い丸で出る
  }

  const selectRecord = (id: string) => {
    setSelRec(id)
    const r = records.find((x) => x.id === id)
    if (r) mapRef.current?.easeTo({ center: [r.lng, r.lat], duration: 400 })
  }

  const removeRecord = (id: string) => {
    setRawRecords((prev) => sanitizeRecords(prev).filter((x) => x.id !== id))
    if (selRec === id) setSelRec(null)
  }

  const selectedRecord = records.find((r) => r.id === selRec) ?? records[records.length - 1] ?? null
  const report = selectedRecord ? reportText(selectedRecord) : ''

  const copy = async (text: string, okMsg: string, prepared = false) => {
    try {
      await navigator.clipboard.writeText(text)
      if (prepared) setDidPrepare(true)
      toast.success(okMsg)
    } catch {
      toast.error('コピーできませんでした。文面を手動で選択してコピーしてください。')
    }
  }

  const copyLink = () => {
    const map = mapRef.current
    const q = parseHashQuery(window.location.hash)
    if (map) {
      const c = map.getCenter()
      q.set('z', map.getZoom().toFixed(1))
      q.set('lat', c.lat.toFixed(5))
      q.set('lng', c.lng.toFixed(5))
    }
    const i = window.location.hash.indexOf('?')
    const path = (i < 0 ? window.location.hash : window.location.hash.slice(0, i)) || '#/'
    const url = window.location.href.split('#')[0] + path + '?' + q.toString()
    void copy(url, '表示中の地図のURLをコピーしました')
  }

  const exportGeo = () => {
    if (!records.length) return setIoMsg('書き出す記録がありません。')
    downloadGeoJson(`moritsuchi-records-${stamp()}.geojson`, markGeoJson(toGeoJSON(records)))
    setDidPrepare(true)
    setIoMsg('GeoJSONを書き出しました。')
  }
  const exportCsv = () => {
    if (!records.length) return setIoMsg('書き出す記録がありません。')
    downloadText(`moritsuchi-records-${stamp()}.csv`, markCsv(toCSV(records)), 'text/csv;charset=utf-8')
    setDidPrepare(true)
    setIoMsg('CSVを書き出しました。')
  }
  const onImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const f = input.files?.[0]
    if (!f) return
    if (f.size > 2e6) {
      setIoMsg('ファイルが大きすぎます（2MBまで）。')
      input.value = ''
      return
    }
    const fr = new FileReader()
    fr.onload = () => {
      try {
        const r = fromGeoJSON(JSON.parse(String(fr.result)))
        const have = new Set(records.map((x) => x.id))
        const add = r.records.filter((x) => !have.has(x.id))
        setRawRecords((prev) => [...sanitizeRecords(prev), ...add])
        setImportedN((n) => n + add.length)
        setIoMsg(
          `${add.length}件を読み込みました` +
            (r.skipped ? `（形式が不正な${r.skipped}件は除外）` : '') +
            (r.records.length - add.length ? `（同じIDの${r.records.length - add.length}件は既存を維持）` : '') + '。',
        )
      } catch {
        setIoMsg('読み込めませんでした。GeoJSON（このアプリで書き出したもの）を選んでください。')
      }
      input.value = ''
    }
    fr.readAsText(f)
  }
  const clearAll = () => {
    setRawRecords([])
    setSelRec(null)
    setClearOpen(false)
    setIoMsg('全記録を消しました。')
  }

  const prevLeft = records.filter((r) => prevIds.has(r.id)).length
  const ledger = ledgerSummary(records)
  const outOfCoverage = pick ? !inCoverage(pick.lng, pick.lat) : false
  const originIsExample = origin.label.startsWith('熱海駅（例')

  const STEP_META: Record<string, { title: string; hint: string }> = {
    place: { title: '自宅の場所を入れる', hint: '住所・駅名で検索します（熱海駅は例です）' },
    look: { title: '近くの盛土造成地を確かめる', hint: '一覧から選び、型（谷埋め／腹付け）を見ます' },
    compare: { title: '昔の写真と見比べる', hint: '年代を選び、スライダーで今と昔を行き来します' },
    rec: { title: '台帳に記録を足す', hint: '地図をタップして位置を決め、気づいたことを1件ずつ台帳に足します' },
    prep: { title: '台帳にまとめて市に届ける', hint: '台帳をCSV／GeoJSONで書き出す。1件の通報文もコピーできます' },
    ref: { title: '参考（出典・注意）', hint: '任意。データの出典と使うときの注意です' },
  }

  // 左サイドバー（スマホは上部ステッパー）が唯一のナビゲーション。上から順に進めると目的を達成できる
  useAppSteps(
    [
      { id: 'place', title: STEP_META.place.title, hint: '住所・駅名で検索（熱海駅は例）', done: originChosen },
      { id: 'look', title: STEP_META.look.title, hint: '一覧から選び、型を見る', done: didLook },
      { id: 'compare', title: STEP_META.compare.title, hint: '1961〜69年／1974〜78年の写真と今', done: didCompare },
      { id: 'rec', title: STEP_META.rec.title, hint: '地図で位置を決めて台帳に足す', action: '今回1件保存すると完了', done: addedNow },
      { id: 'prep', title: STEP_META.prep.title, hint: '台帳の書き出し・通報文', action: '書き出すかコピーすると完了', done: didPrepare },
      { id: 'ref', title: STEP_META.ref.title, hint: '出典・注意・ハザードマップ', done: false, optional: true },
    ],
    {
      activeId: step,
      onSelectStep: goStep,
      description: '熱海市・伊東市の住民や自治会が、身近な盛土の変化を「地域の点検台帳」に記録し、まとめて書き出して市に届ける準備をします。',
    },
  )

  const legend = (
    <ul className="space-y-1 text-xs" aria-label="凡例">
      {Object.keys(KIND_COLOR).map((k) => (
        <li key={k} className="flex items-center gap-2">
          <span className="inline-block size-3.5 shrink-0 rounded-sm border-2" style={{ borderColor: KIND_COLOR[k], background: KIND_COLOR[k] + '70' }} />
          <span><b>{k}</b>＝{KIND_HELP[k]}</span>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="inline-block size-3.5 shrink-0 rounded-full border-2 border-black bg-white" />白丸＝探した地点（初期は熱海駅の例）
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-block size-3.5 shrink-0 rounded-full border-2 border-black bg-[#F0E442]" />黄色い丸＝保存した自分の記録
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-block size-4 shrink-0 rounded-full border-[3px] bg-white/60" style={{ borderColor: PICK_COLOR }} />濃い赤紫の輪＝記録する位置（保存前）
      </li>
    </ul>
  )

  const mapAside = (
    <div className="relative">
      <MapView
        className="h-full"
        center={initialView.center}
        zoom={initialView.zoom}
        basemap="pale"
        showBasemapSwitcher={false}
        layers={layers}
        clickableLayerIds={['rec', 'fills-fill']}
        onFeatureClick={onFeatureClick}
        onClick={onMapClick}
        onMapReady={onMapReady}
        cooperativeGestures={window.innerWidth < 768}
        attribution="大規模盛土造成地：国土数値情報（国土交通省）"
        ariaLabel="盛土ウォッチの地図"
      />
      <div className="pointer-events-none absolute bottom-7 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border bg-white/95 px-2 py-1 text-xs shadow" data-testid="map-legend">
        <b>色の意味</b>
        {(['谷埋め型', '腹付け型'] as const).map((k) => (
          <span key={k} className="flex items-center gap-1"><span className="inline-block size-3 rounded-sm border-2" style={{ borderColor: KIND_COLOR[k], background: KIND_COLOR[k] + '70' }} />{k}</span>
        ))}
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-black bg-[#F0E442]" />自分の記録</span>
        {step === 'rec' && <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-[3px] bg-white/60" style={{ borderColor: PICK_COLOR }} />記録する位置</span>}
      </div>
      {step === 'compare' && old !== 'none' && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-md bg-white/95 px-2 py-1 text-xs font-medium shadow" data-testid="compare-badge">
          スライダー: 左＝今（{BASES.find((b) => b.id === base)?.label}）／右＝昔（{OLDS.find((o) => o.id === old)?.label}）。昔の写真 {op}%
        </div>
      )}
      {step === 'rec' && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[70%] rounded-md bg-white/95 px-2 py-1 text-xs font-bold shadow">
          {pick ? '濃い赤紫の輪＝いま選んだ位置' : '▶ 地図をタップして位置を決めてください'}
        </div>
      )}
    </div>
  )

  const searchForm = (
    <div className="space-y-2">
      <Label htmlFor="mw-q" className="text-sm font-bold">自宅の住所を入れてください（駅名・町名でも可）</Label>
      <form onSubmit={doSearch} className="flex gap-2" role="search">
        <Input
          id="mw-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: 熱海駅、咲見町"
          aria-label="住所・駅名で探す"
        />
        <Button type="submit" disabled={searching || !query.trim()}>
          <Search className="size-4" />{searching ? '検索中' : '検索'}
        </Button>
      </form>
      {searchMsg && <p className="text-sm text-muted-foreground" role="status">{searchMsg}</p>}
      {hits && hits.length > 0 && (
        <ul className="space-y-1.5" aria-label="検索結果">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => { goOrigin({ label: h.title, lng: h.lng, lat: h.lat }); setHits(null) }}
              >
                <span className="min-w-0 break-words">{h.title}</span>
                <Badge variant={h.inArea ? 'secondary' : 'outline'} className="shrink-0">{h.inArea ? '対象範囲内' : '対象範囲外'}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const panelPlace = (
    <div className="space-y-3">
      <div className="space-y-0.5 text-sm" data-testid="near-origin">
        <p className="font-semibold">
          {originChosen
            ? `「${origin.label}」を起点にしました${originIsExample ? '（自宅の結果ではありません）' : ''}。`
            : '熱海駅（例）を表示中です。自宅の結果ではありません。'}
        </p>
        {originChosen && stationList[0] && (
          <p data-testid="place-nearest">
            最寄りの造成地: {stationList[0].id}（{stationList[0].kind}）{stationList[0].inside ? 'の範囲内' : `まで${metersLabel(stationList[0])}（直線）`}
          </p>
        )}
      </div>
      {searchForm}
      <p className="text-xs text-muted-foreground">検索は国土地理院の地名検索（GETのみ）を使います。入力した文字だけが送られ、記録は送られません。</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={goStation}><MapPin className="size-4" />熱海駅を例にする</Button>
        {JUMPS.map((j) => (
          <Button key={j.label} size="sm" variant="outline" onClick={() => mapRef.current?.flyTo({ center: [j.lng, j.lat], zoom: j.z, duration: 600 })}>
            {j.label}を表示
          </Button>
        ))}
      </div>
    </div>
  )

  const fillInfo = (
    <div className="space-y-1.5 rounded-md border p-3 text-sm" data-testid="fill-info" aria-live="polite">
      {selFillFeature ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <b>{selFillFeature.properties.id}（{selFillFeature.properties.city}）</b>
            <KindBadge kind={selFillFeature.properties.kind} />
          </div>
          <div>盛土区分: <b>{selFillFeature.properties.kind}</b>＝{KIND_HELP[selFillFeature.properties.kind] ?? ''}</div>
          <div>{kindDescription(selFillFeature.properties.kind)}</div>
          <p className="text-xs text-muted-foreground">
            範囲は「概ね」の位置です。最新の状況は市の窓口で確認してください。
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">一覧か地図上の色付きの範囲を選ぶと、盛土造成地の型と情報が出ます。</p>
      )}
    </div>
  )

  const panelLook = (
    <div className="space-y-3">
      <div className="rounded-md border-2 border-primary bg-accent/50 p-2">
        <div className="text-xs text-muted-foreground" data-testid="near-origin">起点: 「{origin.label}」{originIsExample && '（自宅の結果ではありません）'}</div>
        <div className="text-sm font-semibold" data-testid="near-summary">{nearSummary(stationList)}</div>
      </div>
      <ul className="space-y-1.5" aria-label="近い盛土造成地">
        {stationList.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => focusFill(d.id)}
              aria-pressed={selFill === d.id}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${selFill === d.id ? 'border-primary bg-accent ring-2 ring-primary' : ''}`}
            >
              <span className="min-w-0">
                <span className="font-medium">{d.id}</span>
                <span className="ml-2 text-muted-foreground" data-testid="fill-dir">
                  {d.inside ? '起点を含む範囲' : `起点の${dirLabel(origin, fills.find((x) => x.properties.id === d.id))}側 ${metersLabel(d)}`}{!d.inside && d.distM <= NEAR_M ? '（近く）' : ''}
                </span>
              </span>
              <KindBadge kind={d.kind} />
            </button>
          </li>
        ))}
        {!stationList.length && !loadError && <li className="text-sm text-muted-foreground">読み込み中…</li>}
      </ul>
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}
      {fillInfo}
      {legend}
    </div>
  )

  const panelCompare = (
    <div className="space-y-3">
      {selFillFeature ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 p-2 text-sm">
          <span>見ている場所:</span>
          <b>{selFillFeature.properties.id}</b>
          <KindBadge kind={selFillFeature.properties.kind} />
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">造成地は未選択です。手順2の一覧か、地図の色付きの範囲をタップして選ぶと、その造成地の昔の写真と今を見比べられます。</p>
      )}
      {selFillFeature && (
        <>
          <SitePhotoCompare key={selFillFeature.properties.id} fill={selFillFeature} onInteract={() => setDidCompare(true)} />
          <KindExplain kind={selFillFeature.properties.kind} />
        </>
      )}
      <div className="space-y-1 rounded-md border-2 border-dashed border-primary p-2 text-sm" data-testid="look-points">
        <div className="font-semibold">見るポイント（見方の例）</div>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>色付きの範囲（造成地）の中で、昔は谷・斜面・林や田畑だった所が、今は平らな宅地や道路になっていないか。</li>
          <li>範囲の外の地形（尾根・斜面）と比べ、昔の谷筋が今は道路や建物の下に隠れていないか。</li>
        </ul>
        <p className="text-xs text-muted-foreground">これは一般的な見方の例です。写真から危険かどうかは判定しません。</p>
      </div>
      <details className="rounded-md border p-2" data-testid="map-overlay-controls">
        <summary className="cursor-pointer text-sm font-bold">地図の上に昔の写真を重ねて見る（広い範囲を見たいとき）</summary>
      <div className="mt-2 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">昔の写真</Label>
        <ToggleGroup type="single" variant="outline" value={old} aria-label="年代別の空中写真"
          onValueChange={(v) => { if (!v) return; setOld(v); if (v !== 'none') { setOp('50'); fitSel(selFill) } }} className="flex-wrap justify-start">
          {OLDS.map((o) => <ToggleGroupItem key={o.id} value={o.id} className="px-3 text-sm">{o.label}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>
      <div className={old === 'none' ? 'opacity-50' : ''}>
        <Label htmlFor="mw-op" className="text-xs text-muted-foreground">見比べ（左＝現在の背景、右＝昔の写真）</Label>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="shrink-0 font-medium">今</span>
          <Slider id="mw-op" min={0} max={100} step={5} value={[op]} disabled={old === 'none'}
            onValueChange={(v) => setOp(String(v[0]))} aria-label="昔の写真の濃さ" />
          <span className="shrink-0 font-medium">昔{old !== 'none' ? `（${OLDS.find((o) => o.id === old)?.label}）` : ''}</span>
        </div>
        {old === 'none' && <p className="mt-1 text-xs">先に「昔の写真」の年代を選んでください。</p>}
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">現在の背景</Label>
        <ToggleGroup type="single" variant="outline" size="sm" value={base} aria-label="背景地図"
          onValueChange={(v) => v && setBase(v)} className="flex-wrap justify-start">
          {BASES.map((b) => <ToggleGroupItem key={b.id} value={b.id} className="px-3 text-xs">{b.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">「航空写真(現在)」にすると、同じ場所の今の写真と昔の写真を見比べられます。</p>
      </div>
      <p className="text-xs text-muted-foreground">
        昔の写真はズーム10〜17で表示され、撮影年・範囲により空白の場所があります。見比べは目視で、変化の自動判定はしません。
      </p>
      </div>
      </details>
    </div>
  )

  const panelRec = (
    <form onSubmit={save} autoComplete="off" className="relative flex flex-col gap-3 md:min-h-full">
      {/* 本文は手順パネル側の1本のスクロールにまかせる（内側にスクロール枠を重ねない）。保存ボタンの枠は下端に固定 */}
      <div className="space-y-3">
        <ul className="list-disc space-y-0.5 rounded-md border bg-accent/30 p-2 pl-6 text-xs">
          <li>公道など立ち入ってよい場所から。盛土や私有地、立入禁止の場所には入らない。</li>
          <li>人や車のナンバーが写る写真は共有しない。</li>
          <li>差し迫った危険（崩れそう・水が噴き出す等）は、記録より先に119番・110番や市の防災窓口へ。</li>
        </ul>
        <div className="space-y-2">
          <p className={`rounded-md border-2 p-2 text-sm font-medium ${pick ? 'border-primary bg-accent/40' : 'border-dashed border-primary'}`}>
            {pick ? '位置を選びました（地図の濃い赤紫の大きな輪）。違えば、もう一度地図をタップ。' : '地図をタップして位置を決めてください（まだ選ばれていません）'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={locate}><LocateFixed className="size-4" />現在地を使う</Button>
            <Button type="button" size="sm" variant="outline" onClick={useCenter}><Crosshair className="size-4" />地図の中心を使う</Button>
          </div>
          <p className="text-sm" data-testid="pick-pos">位置: {pick ? `${pick.lat.toFixed(5)}, ${pick.lng.toFixed(5)}` : savedMsg ? '保存済み（次の記録の位置を地図で選んでください）' : '未選択'}</p>
          {pickMsg && <p className="text-sm text-muted-foreground" role="status">{pickMsg}</p>}
          {outOfCoverage && (
            <Alert variant="destructive" data-testid="out-of-coverage">
              <AlertTriangle className="size-4" />
              <AlertTitle>対象範囲の外です</AlertTitle>
              <AlertDescription>熱海市・伊東市の外のため、盛土造成地データとの比較はできません（記録は可能です）。</AlertDescription>
            </Alert>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mw-kind">気づいたこと</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger id="mw-kind" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mw-when">気づいた日時</Label>
          <Input id="mw-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mw-memo">状況メモ（500字まで。個人が特定される情報は書かない）</Label>
          <Textarea id="mw-memo" rows={3} maxLength={500} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="mw-blur" checked={blurred} onCheckedChange={(v) => setBlurred(v === true)} />
          <Label htmlFor="mw-blur">位置を約100mにぼかして保存する</Label>
        </div>
        <p className="text-xs text-muted-foreground">
          {sample ? '実行サンプルでは保存されません（再読み込みで元に戻ります）。' : '記録はこの端末のブラウザ内だけに保存され、外部へ送信されません。ブラウザのデータを消すと消えます。'}写真は保存しません。
        </p>
      </div>
      <div className="mt-auto shrink-0 space-y-2 border-t bg-background pt-3 md:sticky md:bottom-0">
        {(savedMsg || records.length > 0) && (
          <p className="rounded-md border-2 border-primary bg-accent/50 p-2 text-sm font-medium" data-testid="saved-note" role="status">
            {savedMsg ? `✔ ${savedMsg}` : ''} 台帳の記録: {records.length}件
          </p>
        )}
        {prevLeft > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs" data-testid="prev-records">
            <span>前回までの記録が、この端末に{prevLeft}件残っています（この手順の「済」は、今回保存したときにつきます）。</span>
            <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setClearOpen(true)}><Trash2 className="size-3.5" />全記録を消す</Button>
          </div>
        )}
        <Button type="submit" disabled={!pick} className="w-full">台帳に足す（この端末に保存）</Button>
      </div>
    </form>
  )

  const panelPrep = (
    <div className="relative space-y-3">
      <div className="space-y-2 rounded-md border-2 border-primary p-3" data-testid="ledger">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-bold">地域の点検台帳</p>
          <p className="text-sm">この端末: <b data-testid="rec-count">{records.length}</b> 件{importedN > 0 ? `（うち今回読み込み ${importedN} 件）` : ''}</p>
        </div>
        {records.length > 0 ? (
          <div className="space-y-1 text-xs" data-testid="ledger-summary">
            <p>種類別: {ledger.byKind.map((k) => `${k.label} ${k.n}`).join('／')}</p>
            <p>
              近くの造成地（範囲内か{NEAR_M}m以内）別:{' '}
              {ledger.byFill.length ? ledger.byFill.map((f) => `${f.id}（${f.kind}）${f.n}件`).join('／') : 'なし'}
              {ledger.far > 0 && `／それ以外 ${ledger.far}件`}
              {ledger.outside > 0 && `／対象範囲外 ${ledger.outside}件`}
            </p>
            <p className="text-muted-foreground">件数を数えただけで、危険かどうかの判定ではありません。</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">台帳はまだ空です。「台帳に記録を足す」で1件足すか、仲間の台帳（GeoJSON）を読み込みます。</p>
        )}
        <p className="text-sm font-medium" data-testid="prep-status">
          {didPrepare ? '✔ 完了しました（台帳の書き出しか、通報文のコピーをしました）。' : 'この手順は、台帳を書き出すか、通報文をコピーすると完了します。'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-12 text-base" onClick={exportCsv} disabled={!records.length} data-testid="export-csv"><Download className="size-5" />台帳をCSVで書き出す</Button>
          <Button size="lg" variant="outline" className="h-12 text-base" onClick={exportGeo} disabled={!records.length}><Download className="size-5" />GeoJSONで書き出す</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          CSVは表計算ソフトで開けます。GeoJSONは、仲間に渡して読み込んでもらったり、地図ソフト（QGIS等）で確かめたりできます。このページは送信しません。
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">台帳の記録（足した順）</p>
        <ul className="space-y-1.5" aria-label="記録の一覧">
          {!records.length && <li className="rounded-md border p-2 text-sm text-muted-foreground">まだ記録がありません。</li>}
          {records.map((r) => (
            <li key={r.id} className={`space-y-0.5 rounded-md border p-2 text-sm ${r.id === selectedRecord?.id ? 'border-primary bg-accent/50' : ''}`}>
              <div className="font-medium">{KIND_LABEL[r.kind]}　<span className="font-normal">{r.observedAt}{r.blurred ? '（位置ぼかし）' : ''}</span></div>
              <div className="text-xs">{distText(r.nearFill)}</div>
              {r.outOfCoverage && <div className="text-xs text-destructive">※対象範囲外の位置</div>}
              {r.memo && <div className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{r.memo}</div>}
              <div className="flex gap-2 pt-0.5">
                <Button size="sm" variant="outline" onClick={() => selectRecord(r.id)}>この記録の通報文</Button>
                <Button size="sm" variant="ghost" onClick={() => removeRecord(r.id)}><Trash2 className="size-4" />削除</Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <label htmlFor="mw-import" className="cursor-pointer"><Upload className="size-4" />仲間の台帳（GeoJSON）を読み込む</label>
        </Button>
        <input id="mw-import" type="file" className="sr-only" accept=".geojson,.json,application/geo+json,application/json" onChange={onImport} />
        <Button size="sm" variant="destructive" disabled={!records.length} onClick={() => setClearOpen(true)}>
          <Trash2 className="size-4" />全記録を消す
        </Button>
      </div>
      <p className="text-sm" role="status" data-testid="io-msg">{ioMsg}</p>
      <p className="text-xs text-muted-foreground">
        読み込みはこの端末内で行い、外部へ送信しません。同じIDの記録は重ねて足さず、いまの台帳のものを残します。
      </p>

      {selectedRecord && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="text-sm font-semibold">1件の通報文のたたき台（選んだ記録）</div>
          <Textarea readOnly rows={7} value={report} aria-label="通報文のたたき台" className="text-sm" data-testid="report-text" />
          <Button variant="outline" onClick={() => copy(withSampleMark(report), 'コピーしました。市の窓口へ電話・メール・フォームで伝えるときに使えます', true)}><Copy className="size-4" />通報文をコピーする</Button>
          <p className="text-xs text-muted-foreground">
            通報先は「熱海市・伊東市の担当窓口」です。連絡先は各市の公式サイトで確認してください（このページには載せていません）。静岡県の例は国のガイドライン2.3に紹介されています。
          </p>
        </div>
      )}

      <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="sustain-note">
        <p className="font-medium text-foreground">台帳を集める人と、伝え先（想定）</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>台帳をつけるのは、自治会・自主防災組織の有志や住民を想定しています。各自が書き出したGeoJSON／CSVを持ち寄り、読み込んで1つにまとめると、地域の点検記録になります（複数人の持ち寄りはまだ実地では試していません）。</li>
          <li>伝え先は、市の盛土・造成を扱う担当課や防災の窓口（電話・メール・フォームなど、市ごとに異なります）を想定しています。特定の市や自治会との連携、運用の実績はまだありません。</li>
        </ul>
      </div>
    </div>
  )

  const panelRef = (
    <div className="space-y-3 text-sm">
      <p>
        表示している盛土造成地は<b>「安全性の確認が必要な盛土造成地」で、直ちに危険な場所ではありません</b>。すべての盛土造成地が載っているわけでも、宅地建物取引業法に基づく重要事項説明等の根拠に使えるわけでもありません。このページは危険かどうかの判定をしません。
      </p>
      <ul className="space-y-2">
        {SOURCES.map((x) => (
          <li key={x.name} className="rounded-md border p-2 text-xs">
            <div className="font-medium">{x.name}</div>
            {x.provider && <div className="text-muted-foreground">提供: {x.provider}</div>}
            {x.license && <div className="text-muted-foreground">ライセンス: {x.license}</div>}
            {x.note && <div>{x.note}</div>}
            {x.url && <a className="break-all text-primary underline" href={x.url} target="_blank" rel="noreferrer">{x.url}</a>}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" onClick={copyLink}><Copy className="size-4" />いまの地図表示のURLをコピー</Button>
    </div>
  )

  const panels: Record<string, React.ReactNode> = {
    place: panelPlace, look: panelLook, compare: panelCompare, rec: panelRec, prep: panelPrep, ref: panelRef,
  }
  const meta = STEP_META[step] ?? STEP_META.place

  return (
    <>
      <PageHeader appId="udc-moritsuchi" compact actions={<SourceDialog sources={SOURCES} />} />
      <p className="shrink-0 border-b bg-accent/40 px-4 py-1 text-xs" data-testid="caution-line">
        対象は熱海市・伊東市のみ。表示は「安全性の確認が必要な盛土造成地」で、直ちに危険ではなく、危険かどうかの判定はしません。
      </p>
      <StepLayout title={meta.title} hint={meta.hint} aside={mapAside}>
        {panels[step]}
      </StepLayout>

      <Dialog open={clearOpen} onOpenChange={setClearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>全記録を消しますか？</DialogTitle>
            <DialogDescription>この端末の記録 {records.length} 件をすべて消します。書き出していないと戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>やめる</Button>
            <Button variant="destructive" onClick={clearAll}>消す</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
