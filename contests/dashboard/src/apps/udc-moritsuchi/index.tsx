import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Crosshair, Download, History, LocateFixed, MapPin, Search, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { downloadGeoJson, downloadText } from '@/components/shared/downloadText'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { useHashState } from '@/components/shared/useHashState'
import { parseHashQuery } from '@/components/shared/hashState'
import { fetchData } from '@/lib/data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  ATAMI_STATION, KINDS, KIND_LABEL, distText, fillCenter, fmtDate, inCoverage, kindDescription,
  makeRecord, nearbyFills, nearestFill, reportText, sanitizeRecords, toCSV, toGeoJSON, fromGeoJSON,
  type FillFeature, type MwRecord, type NearFill,
} from './lib'
import { KIND_HELP, NEAR_M, nearSummary, searchPlaces, type PlaceHit } from './search'

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

function stamp() {
  return fmtDate(new Date()).replace(/[- :]/g, '').slice(0, 12)
}

function bboxOf(f: FillFeature): [[number, number], [number, number]] {
  const ring = f.geometry.coordinates[0]
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]]
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
  const [rawRecords, setRawRecords] = useLocalStorage<MwRecord[]>('udc-moritsuchi:records', [])
  const records = useMemo(() => sanitizeRecords(rawRecords), [rawRecords])
  const [tab, setTab] = useState('look')
  const [selFill, setSelFill] = useState<string | null>(null)
  const [selRec, setSelRec] = useState<string | null>(null)
  const [pick, setPick] = useState<{ lng: number; lat: number; nearFill: NearFill | null } | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [ioMsg, setIoMsg] = useState('')
  const [clearOpen, setClearOpen] = useState(false)
  const [origin, setOrigin] = useState<{ label: string; lng: number; lat: number }>({ label: '熱海駅（目安の位置）', ...ATAMI_STATION })
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PlaceHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchMsg, setSearchMsg] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

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
  const mapWrapRef = useRef<HTMLDivElement>(null)
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
    if (map) map.getCanvas().style.cursor = tab === 'rec' ? 'crosshair' : ''
  }, [tab, mapReady])

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
        id: 'pick', type: 'circle',
        data: pick ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pick.lng, pick.lat] } } : EMPTY_FC,
        paint: { 'circle-radius': 12, 'circle-color': '#CC79A7', 'circle-stroke-color': '#000', 'circle-stroke-width': 4 },
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
    mapRef.current?.fitBounds(bboxOf(f), { padding: 70, maxZoom: 17, duration: 600 })
    if (window.innerWidth < 1024) mapWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [fills])

  const goOrigin = (o: { label: string; lng: number; lat: number }) => {
    setOrigin(o)
    mapRef.current?.flyTo({ center: [o.lng, o.lat], zoom: 14.5, duration: 600 })
    if (window.innerWidth < 1024) mapWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const goStation = () => goOrigin({ label: '熱海駅（目安の位置）', ...ATAMI_STATION })

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

  /** この造成地を昔の写真で見る: 寄って、昔の写真に切り替え、「2 見比べる」へ */
  const viewOld = (id: string, which: 'ort_old10' | 'gazo1') => {
    focusFill(id)
    setOld(which)
    setOp('50')
    changeTab('compare')
  }

  /* ---------- 位置の選択 ---------- */
  const choosePos = useCallback((lng: number, lat: number) => {
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
      selectRecord(id, true)
    } else if (layerId === 'fills-fill') {
      setSelFill(String(f.properties?.id))
    }
  }
  const onMapClick = ({ lng, lat }: { lng: number; lat: number }) => {
    if (recHit.current) {
      recHit.current = false
      return
    }
    if (tab === 'rec') choosePos(lng, lat)
  }

  const changeTab = (t: string) => {
    setTab(t)
    if (t !== 'rec') {
      setPick(null)
      setPickMsg('')
    }
    if (t === 'rec' && window.innerWidth < 1024) mapWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // 保存後は通報文カードへ自動スクロール
  useEffect(() => {
    if (!justSaved || tab !== 'out') return
    const t = setTimeout(() => {
      reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setJustSaved(false)
    }, 150)
    return () => clearTimeout(t)
  }, [justSaved, tab])

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
    setTab('out')
    setIoMsg('')
    setJustSaved(true)
    toast.success('記録を保存しました。通報文のたたき台を表示します。')
    mapRef.current?.easeTo({ center: [rec.lng, rec.lat], duration: 400 })
  }

  const selectRecord = (id: string, openTab: boolean) => {
    setSelRec(id)
    if (openTab) changeTab('out')
    const r = records.find((x) => x.id === id)
    if (r) mapRef.current?.easeTo({ center: [r.lng, r.lat], duration: 400 })
  }

  const removeRecord = (id: string) => {
    setRawRecords((prev) => sanitizeRecords(prev).filter((x) => x.id !== id))
    if (selRec === id) setSelRec(null)
  }

  const selectedRecord = records.find((r) => r.id === selRec) ?? null
  const report = selectedRecord ? reportText(selectedRecord) : ''

  const copy = async (text: string, okMsg: string) => {
    try {
      await navigator.clipboard.writeText(text)
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
    const path = i < 0 ? window.location.hash : window.location.hash.slice(0, i)
    const url = window.location.href.split('#')[0] + path + '?' + q.toString()
    void copy(url, '表示中の地図のURLをコピーしました')
  }

  const exportGeo = () => {
    if (!records.length) return setIoMsg('書き出す記録がありません。')
    downloadGeoJson(`moritsuchi-records-${stamp()}.geojson`, toGeoJSON(records))
    setIoMsg('GeoJSONを書き出しました。')
  }
  const exportCsv = () => {
    if (!records.length) return setIoMsg('書き出す記録がありません。')
    downloadText(`moritsuchi-records-${stamp()}.csv`, toCSV(records), 'text/csv;charset=utf-8')
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

  const outOfCoverage = pick ? !inCoverage(pick.lng, pick.lat) : false

  const fillCard = (actions: boolean) => (
    <Card aria-live="polite">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">選んだ盛土造成地の情報</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm" data-testid="fill-info">
        {selFillFeature ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <b>{selFillFeature.properties.id}（{selFillFeature.properties.city}）</b>
              <KindBadge kind={selFillFeature.properties.kind} />
            </div>
            <div>盛土区分: <b>{selFillFeature.properties.kind}</b>＝{KIND_HELP[selFillFeature.properties.kind] ?? ''}</div>
            <div>{kindDescription(selFillFeature.properties.kind)}</div>
            <p className="text-xs text-muted-foreground">
              範囲は「概ね」の位置です。直ちに危険という意味ではなく、安全性の確認が必要な場所を示します。最新の状況は市の窓口で確認してください。
            </p>
            {actions && (
              <div className="space-y-2 rounded-md border bg-accent/40 p-2">
                <div className="flex items-center gap-1 text-sm font-medium"><History className="size-4" />この場所を昔の写真で見る</div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => viewOld(selFillFeature.properties.id, 'ort_old10')}>1961〜69年の写真で見る</Button>
                  <Button size="sm" onClick={() => viewOld(selFillFeature.properties.id, 'gazo1')}>1974〜78年の写真で見る</Button>
                </div>
                <p className="text-xs text-muted-foreground">押すと、この造成地へ寄って昔の写真に切り替わり、スライダーで今と見比べられます。</p>
              </div>
            )}
            {actions && (
              <Button size="sm" variant="outline" onClick={() => {
                focusFill(selFillFeature.properties.id)
                changeTab('rec')
              }}>
                <Crosshair className="size-4" />この造成地の近くで記録する
              </Button>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">地図上の色付きの範囲をタップするか、上の一覧から選ぶと、盛土造成地の型と情報が出ます。</p>
        )}
      </CardContent>
    </Card>
  )

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader appId="udc-moritsuchi" actions={<SourceDialog sources={SOURCES} />} />

      <Tabs value={tab} onValueChange={changeTab} className="space-y-4">
      <nav aria-label="手順" className="sticky top-0 z-20 -mx-1 bg-background/95 px-1 py-2 backdrop-blur">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1">
          <TabsTrigger value="look" className="flex-col gap-0 py-1.5 text-xs sm:text-sm"><span>1 確かめる</span><span className="hidden text-[10px] font-normal text-muted-foreground sm:block">場所と型</span></TabsTrigger>
          <TabsTrigger value="compare" className="flex-col gap-0 py-1.5 text-xs font-bold sm:text-sm data-[state=inactive]:border-primary/60 data-[state=inactive]:text-primary"><span className="flex items-center gap-1"><History className="size-3.5" />2 見比べる</span><span className="hidden text-[10px] font-normal text-muted-foreground sm:block">昔の航空写真</span></TabsTrigger>
          <TabsTrigger value="rec" className="flex-col gap-0 py-1.5 text-xs sm:text-sm"><span>3 記録する</span><span className="hidden text-[10px] font-normal text-muted-foreground sm:block">変化を保存</span></TabsTrigger>
          <TabsTrigger value="out" className="flex-col gap-0 py-1.5 text-xs sm:text-sm"><span>4 届ける{records.length > 0 && <Badge variant="secondary" className="ml-1 px-1">{records.length}</Badge>}</span><span className="hidden text-[10px] font-normal text-muted-foreground sm:block">通報文・書き出し</span></TabsTrigger>
        </TabsList>
      </nav>

      <Alert>
        <AlertTriangle className="size-4" />
        <AlertTitle>対象は静岡県 熱海市・伊東市のみ</AlertTitle>
        <AlertDescription>
          <p className="text-sm">
            表示している盛土造成地は<b>「安全性の確認が必要な盛土造成地」で、直ちに危険な場所ではありません</b>。すべての盛土造成地が載っているわけでもなく、このページは危険かどうかの判定をしません。上のボタンの順（確かめる→見比べる→記録→届ける）に進めます。
          </p>
        </AlertDescription>
      </Alert>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div ref={mapWrapRef} className="scroll-mt-16 space-y-2 lg:sticky lg:top-4 lg:self-start">
          <MapView
            className="h-[340px] sm:h-[480px] lg:h-[calc(100vh-9rem)] lg:min-h-[480px]"
            center={initialView.center}
            zoom={initialView.zoom}
            basemap="pale"
            showBasemapSwitcher={false}
            layers={layers}
            clickableLayerIds={['rec', 'fills-fill']}
            onFeatureClick={onFeatureClick}
            onClick={onMapClick}
            onMapReady={onMapReady}
            attribution="大規模盛土造成地：国土数値情報（国土交通省）"
            ariaLabel="盛土ウォッチの地図"
          />
          <p className="text-xs text-muted-foreground">
            背景：国土地理院（{BASES.find((b) => b.id === base)?.label ?? '標準'}
            {old !== 'none' ? `＋昔の写真 ${OLDS.find((o) => o.id === old)?.label}` : ''}）。白丸＝探した地点（初期は熱海駅の目安の位置）。
            {tab === 'rec' && (pick ? '　ピンク色の丸＝選んだ位置。' : '　▶ 地図をタップして記録の位置を決めてください。')}
          </p>
        </div>

        <div className="min-w-0">
            {/* ---- 1 確かめる ---- */}
            <TabsContent value="look" className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">① 自宅の周りを探す（住所・駅名）</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <form onSubmit={doSearch} className="flex gap-2" role="search">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="住所・駅名（例: 熱海駅、咲見町）"
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
                            <Badge variant={h.inArea ? 'secondary' : 'outline'} className="shrink-0">
                              {h.inArea ? '対象範囲内' : '対象範囲外'}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">検索は国土地理院の地名検索（GETのみ）を使います。入力した文字だけが送られ、記録は送られません。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={goStation}><MapPin className="size-4" />熱海駅の近くへ</Button>
                    {JUMPS.map((j) => (
                      <Button key={j.label} size="sm" variant="outline"
                        onClick={() => mapRef.current?.flyTo({ center: [j.lng, j.lat], zoom: j.z, duration: 600 })}>
                        {j.label}へ移動
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">② 「{origin.label}」から近い盛土造成地</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm" data-testid="near-summary">{nearSummary(stationList)}</p>
                  <p className="text-xs text-muted-foreground">
                    距離は地図上の直線距離の目安です（白丸が起点。熱海駅の位置は案内用の目安）。選ぶと地図が移動し、型が下に出ます。
                  </p>
                  <ul className="space-y-1.5" aria-label="近い盛土造成地">
                    {stationList.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => focusFill(d.id)}
                          aria-pressed={selFill === d.id}
                          className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${selFill === d.id ? 'border-primary bg-accent' : ''}`}
                        >
                          <span className="min-w-0">
                            <span className="font-medium">{d.id}</span>
                            <span className="ml-2 text-muted-foreground">起点から{metersLabel(d)}{!d.inside && d.distM <= NEAR_M ? '（近く）' : ''}</span>
                          </span>
                          <KindBadge kind={d.kind} />
                        </button>
                      </li>
                    ))}
                    {!stationList.length && !loadError && <li className="text-sm text-muted-foreground">読み込み中…</li>}
                  </ul>
                </CardContent>
              </Card>

              {fillCard(true)}

              <Card>
                <CardContent className="space-y-2 pt-4">
                  <div className="text-sm font-medium">凡例</div>
                  <ul className="space-y-1 text-xs" aria-label="凡例">
                    {Object.keys(KIND_COLOR).map((k) => (
                      <li key={k} className="flex items-center gap-2">
                        <span className="inline-block size-3.5 shrink-0 rounded-sm border-2" style={{ borderColor: KIND_COLOR[k], background: KIND_COLOR[k] + '70' }} />
                        <span><b>{k === '区分なし' ? '区分なし' : k}</b>＝{KIND_HELP[k]}</span>
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <span className="inline-block size-3.5 shrink-0 rounded-full border-2 border-black bg-[#F0E442]" />自分の記録
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="inline-block size-3.5 shrink-0 rounded-full border-2 border-black bg-white" />探した地点（初期は熱海駅の目安）
                    </li>
                  </ul>
                  <Button size="sm" variant="outline" onClick={copyLink}><Copy className="size-4" />いまの表示のURLをコピー</Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---- 2 見比べる ---- */}
            <TabsContent value="compare" className="space-y-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">昔の写真と今を見比べる</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                    <li>年代を選ぶ（地図が昔の写真に変わります）</li>
                    <li>スライダーを動かして、今と昔を行き来する</li>
                    <li>谷が埋められた跡や、道・建物の増え方を見比べる</li>
                  </ol>
                  {selFillFeature ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border bg-accent/40 p-2 text-sm">
                      <span>見ている場所:</span>
                      <b>{selFillFeature.properties.id}</b>
                      <KindBadge kind={selFillFeature.properties.kind} />
                      <Button size="sm" variant="outline" onClick={() => focusFill(selFillFeature.properties.id)}>この造成地へ寄る</Button>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
                      盛土造成地がまだ選ばれていません。「1 確かめる」で選ぶと、その場所に寄って見比べられます。
                      <Button size="sm" variant="outline" className="ml-2" onClick={() => changeTab('look')}>1 確かめるへ</Button>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">昔の写真</Label>
                    <ToggleGroup type="single" variant="outline" value={old} aria-label="年代別の空中写真"
                      onValueChange={(v) => v && setOld(v)} className="flex-wrap justify-start">
                      {OLDS.map((o) => <ToggleGroupItem key={o.id} value={o.id} className="px-3 text-sm">{o.label}</ToggleGroupItem>)}
                    </ToggleGroup>
                  </div>
                  <div className={old === 'none' ? 'opacity-50' : ''}>
                    <Label htmlFor="mw-op" className="text-xs text-muted-foreground">見比べ（左＝現在の背景、右＝昔の写真）</Label>
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span>今</span>
                      <Slider id="mw-op" min={0} max={100} step={5} value={[op]} disabled={old === 'none'}
                        onValueChange={(v) => setOp(String(v[0]))} aria-label="昔の写真の濃さ" />
                      <span>昔</span>
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
                  {fills.length > 0 && selFillFeature && (
                    <Button onClick={() => { changeTab('rec') }} variant="secondary" size="sm">気づいたことを記録する（3 記録する）</Button>
                  )}
                </CardContent>
              </Card>
              {fillCard(false)}
            </TabsContent>

            {/* ---- 2 記録する ---- */}
            <TabsContent value="rec" className="space-y-3">
              <Alert>
                <AlertTitle>記録の前に</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-0.5 pl-5">
                    <li>公道など立ち入ってよい場所から。盛土や私有地、立入禁止の場所には入らない。</li>
                    <li>人や車のナンバーが写る写真は共有しない。</li>
                    <li>差し迫った危険（崩れそう・水が噴き出す等）は、記録より先に119番・110番や市の防災窓口へ。</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <Card>
                <CardContent className="space-y-3 pt-4">
                  <p className={`rounded-md border-2 p-2 text-sm font-medium ${pick ? 'border-primary bg-accent/40' : 'border-dashed border-primary'}`}>
                    {pick ? '① 位置を選びました（地図のピンク色の丸）。違えば、もう一度地図をタップ。' : '① 地図をタップして位置を決めてください（まだ選ばれていません）'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={locate}><LocateFixed className="size-4" />現在地を使う</Button>
                    <Button size="sm" variant="outline" onClick={useCenter}><Crosshair className="size-4" />地図の中心を使う</Button>
                  </div>
                  <p className="text-sm" data-testid="pick-pos">
                    位置: {pick ? `${pick.lat.toFixed(5)}, ${pick.lng.toFixed(5)}` : '未選択'}
                  </p>
                  {pickMsg && <p className="text-sm text-muted-foreground" role="status">{pickMsg}</p>}
                  {outOfCoverage && (
                    <Alert variant="destructive" data-testid="out-of-coverage">
                      <AlertTriangle className="size-4" />
                      <AlertTitle>対象範囲の外です</AlertTitle>
                      <AlertDescription>熱海市・伊東市の外のため、盛土造成地データとの比較はできません（記録は可能です）。</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>

              <form onSubmit={save} autoComplete="off" className="space-y-3">
                <p className="text-sm"><b>② 内容を入れて保存:</b></p>
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
                <Button type="submit" disabled={!pick} className="w-full">この場所を記録する（この端末に保存）</Button>
                {!pick && <p className="text-xs text-muted-foreground">位置が未選択です。先に地図をタップしてください。</p>}
              </form>
              <p className="text-xs text-muted-foreground">
                記録はこの端末のブラウザ内だけに保存され、外部へ送信されません。ブラウザのデータを消すと消えます。写真はこのページでは保存しません。
              </p>
            </TabsContent>

            {/* ---- 3 届ける ---- */}
            <TabsContent value="out" className="space-y-3">
              <p className="text-sm">
                記録 <b data-testid="rec-count">{records.length}</b> 件。地図上の黄色い丸（黒ふち）が自分の記録です。
              </p>
              <ul className="space-y-2" aria-label="記録の一覧">
                {!records.length && (
                  <li className="rounded-md border p-3 text-sm text-muted-foreground">まだ記録がありません。「3 記録する」から追加できます。</li>
                )}
                {records.map((r) => (
                  <li key={r.id} className={`space-y-1 rounded-md border p-3 text-sm ${r.id === selRec ? 'border-primary bg-accent/50' : ''}`}>
                    <div className="font-medium">{KIND_LABEL[r.kind]}</div>
                    <div>{r.observedAt}{r.blurred ? '（位置ぼかし）' : ''}</div>
                    <div>{distText(r.nearFill)}</div>
                    {r.outOfCoverage && <div className="text-xs text-destructive">※対象範囲外の位置</div>}
                    {r.memo && <div className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{r.memo}</div>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button size="sm" variant="outline" onClick={() => selectRecord(r.id, false)}>通報文を作る</Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRecord(r.id)}><Trash2 className="size-4" />削除</Button>
                    </div>
                  </li>
                ))}
              </ul>

              {selectedRecord && (
                <Card ref={reportRef} className="scroll-mt-20 border-2 border-primary">
                  <CardHeader className="pb-2"><CardTitle className="text-base">通報文のたたき台</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Textarea readOnly rows={10} value={report} aria-label="通報文のたたき台" className="text-sm" data-testid="report-text" />
                    <Button size="lg" className="w-full" onClick={() => copy(report, 'コピーしました。市の窓口へ電話・メール・フォームで伝えるときに使えます')}><Copy className="size-5" />文面をコピー</Button>
                    <Button size="lg" variant="outline" className="w-full" onClick={exportGeo}><Download className="size-5" />GeoJSONで書き出す（記録をファイルに保存）</Button>
                    <p className="text-xs text-muted-foreground">
                      このページは送信しません。文面をコピーして、自治体の窓口（電話・メール・フォーム）へ。通報先は市町村・県で異なるため、各自治体の案内を確認してください。静岡県の例は国のガイドライン2.3に紹介されています。
                    </p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">書き出し・読み込み</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={exportGeo}><Download className="size-4" />GeoJSONで書き出す</Button>
                    <Button size="sm" variant="outline" onClick={exportCsv}><Download className="size-4" />CSVで書き出す</Button>
                    <Button size="sm" variant="outline" asChild>
                      <label htmlFor="mw-import" className="cursor-pointer"><Upload className="size-4" />GeoJSONを読み込む</label>
                    </Button>
                    <input id="mw-import" type="file" className="sr-only" accept=".geojson,.json,application/geo+json,application/json" onChange={onImport} />
                    <Button size="sm" variant="destructive" disabled={!records.length} onClick={() => setClearOpen(true)}>
                      <Trash2 className="size-4" />全記録を消す
                    </Button>
                  </div>
                  <p className="text-sm" role="status" data-testid="io-msg">{ioMsg}</p>
                  <p className="text-xs text-muted-foreground">
                    書き出したファイルは、自治会の仲間への共有や、地図ソフト（QGIS等）での確認に使えます。読み込みはこの端末内で行い、外部へ送信しません。
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
        </div>
      </div>
      </Tabs>

      <footer className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
        <p>
          出典: 国土交通省 国土数値情報「大規模盛土造成地」A54（2023年版・データ基準日 2023-03-31、CC BY 4.0）／国土地理院 地理院タイル。位置は加工しています。詳しくは右上の「出典・ライセンス」。
        </p>
        <p>
          より正確な確認は国の
          <a className="underline" href="https://disaportal.gsi.go.jp/hazardmap/maps/index.html" target="_blank" rel="noreferrer">重ねるハザードマップ</a>
          と各自治体の案内で。宅地建物取引業法に基づく重要事項説明等の根拠には利用できません。
        </p>
      </footer>

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
    </div>
  )
}
