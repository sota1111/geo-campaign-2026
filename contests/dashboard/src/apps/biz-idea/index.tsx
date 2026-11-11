import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { toast } from 'sonner'
import { AlertTriangle, Check, CircleHelp, Download, MapPin, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { downloadGeoJson } from '@/components/shared/downloadText'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
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
import {
  CERTAINTY, CHECKS, KINDS, LICENSES, OVERLAYS, VISIBILITY,
  circlePoly, createRecord, crossCheck, fmtDist, gsiLink, isPublishable, nearby, setVerified, toGeoJSON,
  type LoreItem, type MemoryRecord, type SamplePlace,
} from './logic'
import { applyOverlay, lorePopup, newPin, placePin, recordPin, recordPopup } from './mapHelpers'

interface SamplesFile { notice: string; places: SamplePlace[] }
interface LoreFile { source: string; items: LoreItem[] }
interface Focus { lon: number; lat: number; place: SamplePlace | null }
interface FormState {
  placeName: string; placeType: string; teller: string; heardOn: string; story: string; basis: string
  claimedKinds: string[]; certainty: string; visibility: string; license: string; checked: string[]
}

const EMPTY_FORM: FormState = {
  placeName: '', placeType: '旧地名', teller: '', heardOn: '', story: '', basis: '',
  claimedKinds: [], certainty: '不明', visibility: 'public', license: 'CC BY 4.0', checked: [],
}
const PLACE_TYPES = ['旧地名', '小字', '通称地名', 'その他']
const EMPTY_RECORDS: MemoryRecord[] = []
const CENTER: [number, number] = [132.485, 34.475]

const SOURCES = [
  {
    name: '自然災害伝承碑（地図上の青い丸・実データ）', provider: '国土地理院',
    note: '地理院地図で公開されている自然災害伝承碑のうち、広島市安佐南区周辺の点を切り出して同梱。名称・建立年・災害種別・所在地・伝承内容の文のみ。写真は取り込まず地理院地図へのリンクにしています（広島市分の写真は二次利用に利用申請が必要とされているため）。',
    url: 'https://www.gsi.go.jp/bousaichiri/denshouhi.html',
  },
  {
    name: '背景地図・空中写真（1945〜50年／1961〜69年）・明治期の低湿地・治水地形分類図・色別標高図', provider: '国土地理院 地理院タイル',
    note: '出典を表示してリアルタイムに読み込んでいます。範囲・凡例は国土地理院の公開ページを確認してください。',
    url: 'https://maps.gsi.go.jp/development/ichiran.html',
  },
  {
    name: '地名・語り手・話（オレンジのピン・サンプル）', provider: 'このデモの作成者',
    note: 'すべて架空です。位置は操作例のための仮置きで、実在の小字や旧地名、地名の由来、実在の人物の証言とは関係ありません。',
  },
  { name: '地図ライブラリ MapLibre GL JS', license: 'BSD-3-Clause' },
]

/** 小さな見出し付きの注意書き */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function KindsField({ value, onChange, idPrefix }: { value: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">語られている災害の種類</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-sm" htmlFor={`${idPrefix}-${k}`}>
            <Checkbox
              id={`${idPrefix}-${k}`}
              checked={value.includes(k)}
              onCheckedChange={(c) => onChange(c ? [...value, k] : value.filter((x) => x !== k))}
            />
            {k}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export default function BizIdeaApp() {
  const [lore, setLore] = useState<LoreItem[] | null>(null)
  const [places, setPlaces] = useState<SamplePlace[]>([])
  const [loadError, setLoadError] = useState('')
  const [records, setRecords] = useLocalStorage<MemoryRecord[]>('biz-idea:records', EMPTY_RECORDS)
  const [focus, setFocus] = useState<Focus | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [radius, setRadius] = useState(1000)
  const [overlayId, setOverlayId] = useState('none')
  const [opacity, setOpacity] = useState(70)
  const [tab, setTab] = useState('pick')
  const [errors, setErrors] = useState<string[]>([])
  const [lastSaved, setLastSaved] = useState('')
  const [exportNote, setExportNote] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [zoom, setZoom] = useState(12)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const featureClickedRef = useRef(false)
  const overlayRef = useRef({ id: overlayId, opacity })
  overlayRef.current = { id: overlayId, opacity }

  useEffect(() => {
    Promise.all([
      fetchData<SamplesFile>('biz-idea', 'samples.json'),
      fetchData<LoreFile>('biz-idea', 'lore.json'),
    ])
      .then(([s, l]) => { setPlaces(s.places); setLore(l.items) })
      .catch((e: Error) => setLoadError(e.message))
  }, [])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const closePopup = useCallback(() => { popupRef.current?.remove(); popupRef.current = null }, [])

  /* 地図の準備: 重ね合わせの再適用（背景切替で style が作り直されるため）とズーム監視 */
  const onMapReady = useCallback((m: maplibregl.Map) => {
    setMap(m)
    const reapply = () => applyOverlay(m, overlayRef.current.id, overlayRef.current.opacity / 100)
    m.on('load', reapply)
    m.on('style.load', reapply)
    m.on('zoomend', () => setZoom(Math.round(m.getZoom() * 10) / 10))
  }, [])

  useEffect(() => {
    if (!map) return
    applyOverlay(map, overlayId, opacity / 100)
  }, [map, overlayId, opacity])

  const overlay = OVERLAYS.find((o) => o.id === overlayId) ?? OVERLAYS[0]
  const chooseOverlay = (id: string) => {
    setOverlayId(id)
    const o = OVERLAYS.find((x) => x.id === id)
    // ズームが小さすぎると何も見えないので、見える縮尺まで寄せる
    if (map && o?.minzoom != null && map.getZoom() < o.minzoom) map.easeTo({ zoom: o.minzoom, duration: 400 })
  }

  /* 選択と突き合わせ */
  const near = useMemo(() => (focus && lore ? nearby(lore, focus.lon, focus.lat, radius) : []), [focus, lore, radius])
  const cross = useMemo(() => crossCheck(form.claimedKinds, near), [form.claimedKinds, near])

  const selectPlace = useCallback((p: SamplePlace) => {
    closePopup()
    setFocus({ lon: p.lon, lat: p.lat, place: p })
    setForm({
      ...EMPTY_FORM,
      placeName: p.name,
      placeType: PLACE_TYPES.includes(p.type) ? p.type : 'その他',
      claimedKinds: p.claimedKinds,
      certainty: p.certainty,
    })
    setErrors([])
    setTab('check')
    map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 })
  }, [map, closePopup])

  const setPin = useCallback((lon: number, lat: number) => {
    closePopup()
    setFocus({ lon, lat, place: null })
    setForm((f) => (!f.placeName || /（架空）$/.test(f.placeName) ? { ...f, placeName: '', claimedKinds: [] } : f))
    setErrors([])
    setTab('check')
  }, [closePopup])

  const selectRef = useRef({ selectPlace, setPin })
  selectRef.current = { selectPlace, setPin }

  /* 地図のレイヤー（伝承碑の点・探索半径） */
  const layers = useMemo<MapLayer[]>(() => {
    if (!lore) return []
    const loreFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: lore.map((it) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [it.lon, it.lat] }, properties: { id: it.id },
      })),
    }
    const radiusFc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: focus ? [circlePoly(focus.lon, focus.lat, radius)] : [],
    }
    return [
      { id: 'radius-fill', type: 'fill', data: radiusFc, paint: { 'fill-color': '#0072B2', 'fill-opacity': 0.08 } },
      { id: 'radius-line', type: 'line', data: radiusFc, paint: { 'line-color': '#0072B2', 'line-width': 2, 'line-dasharray': [2, 2] } },
      {
        id: 'lore', type: 'circle', data: loreFc,
        paint: { 'circle-radius': 8, 'circle-color': '#0072B2', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 },
      },
    ]
  }, [lore, focus, radius])

  const onFeatureClick = useCallback((f: GeoJSON.Feature) => {
    featureClickedRef.current = true
    const it = lore?.find((x) => x.id === (f.properties as { id?: string } | null)?.id)
    if (it && map) {
      closePopup()
      popupRef.current = lorePopup(map, it)
    }
  }, [lore, map, closePopup])

  const onMapClick = useCallback(({ lng, lat }: { lng: number; lat: number }) => {
    if (featureClickedRef.current) { featureClickedRef.current = false; return }
    selectRef.current.setPin(lng, lat)
  }, [])

  /* マーカー（地名・残した記録・新規位置） */
  useEffect(() => {
    if (!map) return
    const ms: maplibregl.Marker[] = []
    const add = (element: HTMLElement, lon: number, lat: number, anchor: 'bottom' | 'center', onClick?: () => void) => {
      if (onClick) element.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      ms.push(new maplibregl.Marker({ element, anchor }).setLngLat([lon, lat]).addTo(map))
    }
    places.forEach((p) => add(placePin(p.name, focus?.place?.id === p.id), p.lon, p.lat, 'bottom', () => selectRef.current.selectPlace(p)))
    records.forEach((r) => {
      if (r.visibility === 'private') return // 非公開は地図に出さない
      add(recordPin(r), r.lon, r.lat, 'bottom', () => { closePopup(); popupRef.current = recordPopup(map, r) })
    })
    if (focus && !focus.place) add(newPin(), focus.lon, focus.lat, 'center')
    return () => { ms.forEach((m) => m.remove()); ms.length = 0 }
  }, [map, places, records, focus, closePopup])

  /* 記録 */
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = createRecord({ ...form, lon: focus?.lon ?? null, lat: focus?.lat ?? null }, new Date().toISOString())
    if (!r.ok) { setErrors(r.errors); return }
    setErrors([])
    setRecords((rs) => [...rs, r.record])
    setLastSaved(r.record.placeName)
    setForm((f) => ({ ...f, story: '', basis: '' }))
    setTab('list')
    toast.success(`「${r.record.placeName}」を未確認の記録として地図に残しました`)
  }
  const updateRecord = (id: string, fn: (r: MemoryRecord) => MemoryRecord) => {
    closePopup()
    setRecords((rs) => rs.map((r) => (r.id === id ? fn(r) : r)))
  }
  const removeRecord = (id: string) => { closePopup(); setRecords((rs) => rs.filter((r) => r.id !== id)) }

  const exportGeo = (onlyPub: boolean) => {
    const gj = toGeoJSON(records, { onlyPublishable: onlyPub, exportedAt: new Date().toISOString() })
    if (!gj.features.length) {
      setExportNote(onlyPub
        ? '公開分がありません。記録を「確認済み」にし、公開範囲を「公開」、利用条件を「利用不可」以外にすると含まれます。'
        : '書き出せる記録がありません。')
      return
    }
    downloadGeoJson(`chimei-kioku-${onlyPub ? 'public' : 'all'}.geojson`, gj)
    setExportNote(`${gj.features.length}件を書き出しました（端末内で作成。送信はしていません）。`)
  }
  const publishableCount = records.filter(isPublishable).length

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader appId="biz-idea" />
        <Alert variant="destructive"><AlertTitle>データを読み込めませんでした</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader appId="biz-idea" actions={<SourceDialog sources={SOURCES} title="出典・利用条件・このデモの限界" />} />

      <Alert className="border-orange-300 bg-orange-50 text-orange-950">
        <AlertTriangle className="size-4" />
        <AlertTitle>このページはデモです。地名と語りは「サンプル（架空）」です</AlertTitle>
        <AlertDescription className="text-orange-950/90">
          <span>
            オレンジの地名・語り手・話はすべて架空で、実在の地名の由来や人物の証言ではありません。青い丸（自然災害伝承碑）だけが国土地理院の実データです。
            災害の危険度は判定しません。入力した記録はこの端末のブラウザにだけ保存され、外部へは送信しません。
          </span>
        </AlertDescription>
      </Alert>

      <Card>
        <CardContent className="py-3">
          <ol className="grid gap-2 text-sm sm:grid-cols-4">
            <li><b>1 地名を選ぶ</b><br /><span className="text-muted-foreground">一覧か地図のオレンジのピン。何もない所をクリックすると新しい位置</span></li>
            <li><b>2 公開データで確かめる</b><br /><span className="text-muted-foreground">近くの伝承碑との突き合わせ、昔の空中写真などを重ねる</span></li>
            <li><b>3 聞き取りを記録</b><br /><span className="text-muted-foreground">記録は必ず「未確認」から始まる</span></li>
            <li><b>4 確認・書き出し</b><br /><span className="text-muted-foreground">確認済み・公開の記録だけが公開用データになる</span></li>
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        {/* 地図 */}
        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <MapView
            center={CENTER}
            zoom={12}
            basemap="std"
            className="h-[340px] lg:h-[calc(100vh-9rem)] lg:min-h-[420px]"
            ariaLabel="地名の記憶マップ。オレンジの地名ピン、青い丸の自然災害伝承碑、残した記録のピンを表示"
            clickableLayerIds={['lore']}
            onFeatureClick={onFeatureClick}
            onClick={onMapClick}
            onMapReady={onMapReady}
            layers={layers}
            attribution={overlayId !== 'none' ? `国土地理院 地理院タイル（${overlay.label}）／自然災害伝承碑（国土地理院）` : '自然災害伝承碑（国土地理院）'}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="凡例">
            <li className="flex items-center gap-1.5"><span className="rounded bg-[#D55E00] px-1.5 py-0.5 font-bold text-white">名</span>地名（サンプル・架空）</li>
            <li className="flex items-center gap-1.5"><span className="inline-block size-3.5 rounded-full border-2 border-white bg-[#0072B2] ring-1 ring-[#0072B2]" />自然災害伝承碑（実データ）</li>
            <li className="flex items-center gap-1.5"><span className="rounded border-2 border-dashed border-[#CC79A7] bg-white px-1.5 text-[#7a3a62]">？</span>残した記録（未確認）</li>
            <li className="flex items-center gap-1.5"><span className="rounded border-2 border-[#CC79A7] bg-white px-1.5 text-[#7a3a62]">✓</span>確認済み</li>
          </ul>
        </div>

        {/* 操作パネル */}
        <Tabs value={tab} onValueChange={setTab} className="min-w-0">
          <TabsList className="grid h-auto w-full grid-cols-4">
            <TabsTrigger value="pick" className="px-1 text-xs sm:text-sm">1 地名</TabsTrigger>
            <TabsTrigger value="check" className="px-1 text-xs sm:text-sm">2 確かめる</TabsTrigger>
            <TabsTrigger value="rec" className="px-1 text-xs sm:text-sm">3 記録</TabsTrigger>
            <TabsTrigger value="list" className="px-1 text-xs sm:text-sm">4 一覧・書出{records.length ? `(${records.length})` : ''}</TabsTrigger>
          </TabsList>

          {/* 1 地名 */}
          <TabsContent value="pick" className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">1 地名を選ぶ（広島市安佐南区周辺）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Note>地図上のオレンジの地名か、下の一覧から選びます（どれも架空）。地図の何もない所をクリック／タップすると、新しい地名の位置を指定できます。</Note>
                {!places.length && <Note>読み込み中…</Note>}
                <ul className="space-y-2">
                  {places.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => selectPlace(p)}
                        aria-pressed={focus?.place?.id === p.id}
                        className="w-full rounded-md border p-3 text-left text-sm hover:bg-accent aria-pressed:border-2 aria-pressed:border-black"
                      >
                        <Badge className="mr-2 bg-[#D55E00] text-white hover:bg-[#D55E00]">サンプル（架空）</Badge>
                        <b>{p.name}</b>
                        <span className="mt-1 block text-xs text-muted-foreground">{p.type}・語られている災害: {p.claimedKinds.join('・')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 2 確かめる */}
          <TabsContent value="check" className="space-y-3">
            {!focus ? (
              <Alert><MapPin className="size-4" /><AlertTitle>先に地名を選んでください</AlertTitle>
                <AlertDescription>
                  <Button size="sm" variant="outline" onClick={() => setTab('pick')}>1 地名の一覧へ</Button>
                </AlertDescription></Alert>
            ) : (
              <>
                <Card>
                  <CardContent className="space-y-2 py-4 text-sm">
                    {focus.place ? (
                      <>
                        <Badge className="bg-[#D55E00] text-white hover:bg-[#D55E00]">サンプル（架空）</Badge>{' '}
                        <b>{focus.place.name}</b>（{focus.place.type}）
                        <p className="rounded bg-muted p-2">{focus.place.story}</p>
                        <p>語り手: {focus.place.teller}</p>
                        <p>出典: {focus.place.basis}</p>
                        <p>確からしさ（現状）: <Badge variant="outline">{focus.place.certainty}</Badge></p>
                      </>
                    ) : (
                      <>
                        <b>新しい地名の位置</b>（経度 {focus.lon.toFixed(5)}・緯度 {focus.lat.toFixed(5)}）
                        <Note>語られている災害の種類を下で選ぶと、突き合わせの結果が変わります。</Note>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">近くの自然災害伝承碑との突き合わせ</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="radius-select">伝承碑を探す範囲</Label>
                      <Select value={String(radius)} onValueChange={(v) => setRadius(Number(v))}>
                        <SelectTrigger id="radius-select" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[500, 1000, 2000, 5000].map((r) => <SelectItem key={r} value={String(r)}>半径 {fmtDist(r)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <KindsField idPrefix="k-check" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
                    <div aria-live="polite" className="space-y-2">
                      {!form.claimedKinds.length ? (
                        <div className="rounded-md border p-3 text-sm">語られている災害の種類が未選択です。上で選ぶと、碑の種類と突き合わせます。</div>
                      ) : cross.level === 'clue' ? (
                        <div className="rounded-md border-2 border-[#0072B2] bg-blue-50 p-3 text-sm text-blue-950">
                          <b>◎ 手がかりあり</b>: 半径{fmtDist(radius)}以内に、語られている種類（{cross.matchedKinds.join('・')}）の伝承碑が <b>{cross.hits.length}件</b>あります。
                          <Note>碑は「その近くで災害があった」ことの手がかりです。地名との因果や、その場所の危険度は示しません。</Note>
                        </div>
                      ) : (
                        <div className="rounded-md border-2 border-dashed border-neutral-500 bg-neutral-50 p-3 text-sm">
                          <b>△ 公開データでは見つからず</b>: 半径{fmtDist(radius)}以内に、語られている種類（{form.claimedKinds.join('・')}）の伝承碑はありません。
                          <Note>碑が建てられていないだけの場合もあり、話が誤りという意味ではありません。範囲を広げるか、郷土資料・語り手への再確認で確かめます。</Note>
                        </div>
                      )}
                      {near.length ? (
                        <>
                          <Note>範囲内の伝承碑（全種類・近い順・上位5件／全{near.length}件）。地図の青い丸でも見られます。</Note>
                          <ul className="space-y-1.5">
                            {near.slice(0, 5).map((n) => (
                              <li key={n.item.id} className="rounded border p-2 text-sm">
                                <b>{n.item.name}</b>（{n.item.year}年・{n.item.kind}）{fmtDist(n.dist)}
                                <details className="mt-1 text-xs">
                                  <summary className="cursor-pointer">伝承内容</summary>
                                  {n.item.info.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')}{' '}
                                  <a className="text-blue-700 underline" href={gsiLink(n.item.lon, n.item.lat, 17)} target="_blank" rel="noopener noreferrer">地理院地図で見る</a>
                                </details>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <Note>この範囲に、収録した伝承碑はありません（収録範囲は安佐南区周辺のみ）。</Note>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">重ねて見る地図（国土地理院）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div role="radiogroup" aria-label="重ねる地図" className="grid grid-cols-2 gap-2">
                  {OVERLAYS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={overlayId === o.id}
                      onClick={() => chooseOverlay(o.id)}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-2 text-left text-xs hover:bg-accent aria-checked:border-2 aria-checked:border-black aria-checked:bg-accent aria-checked:font-bold"
                    >
                      <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border">
                        {overlayId === o.id && <Check className="size-3" />}
                      </span>
                      {o.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="opacity-slider">濃さ {opacity}%</Label>
                  <Slider id="opacity-slider" min={20} max={100} step={5} value={[opacity]} onValueChange={(v) => setOpacity(v[0])} />
                </div>
                <Note>
                  {overlay.note}
                  {overlayId !== 'none' && '（出典: 国土地理院 地理院タイル）'}
                  {overlay.minzoom != null && ` 表示される縮尺: ズーム${overlay.minzoom}〜${overlay.maxzoom}（現在ズーム${zoom}）。`}
                </Note>
                {overlay.minzoom != null && zoom < overlay.minzoom && (
                  <Note>※ 現在の縮尺では表示されません。地図を拡大してください。</Note>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">確かめたこと（自分の目で見て選ぶ）</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {CHECKS.map((c, i) => (
                  <label key={c} htmlFor={`chk-${i}`} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      id={`chk-${i}`} className="mt-0.5"
                      checked={form.checked.includes(c)}
                      onCheckedChange={(v) => set('checked', v ? [...form.checked, c] : form.checked.filter((x) => x !== c))}
                    />
                    {c}
                  </label>
                ))}
                <Note>ここで選ぶのは、人が地図を見て気づいたことの記録です。当てはまらなくても、話が誤りという意味ではありません。</Note>
                <Button onClick={() => setTab('rec')} disabled={!focus}>3 聞き取りを記録する</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3 記録 */}
          <TabsContent value="rec" className="space-y-3">
            {!focus ? (
              <Alert><MapPin className="size-4" /><AlertTitle>先に地名を選ぶか、地図で位置を指定してください</AlertTitle>
                <AlertDescription><Button size="sm" variant="outline" onClick={() => setTab('pick')}>1 地名の一覧へ</Button></AlertDescription></Alert>
            ) : (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">3 聞き取りを記録して地図に残す</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={submit} noValidate className="space-y-3">
                    <Note>この端末のブラウザ（localStorage）にだけ保存し、サーバーには送りません。実在の人の話を入力する場合は本人の同意を得てください（デモでは架空の内容を入力してください）。新しい記録は必ず<b>「未確認」</b>から始まります。</Note>
                    {focus.place && (
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => setForm((f) => ({ ...f, story: focus.place!.story, basis: focus.place!.basis, teller: focus.place!.teller }))}
                      >
                        サンプルの語り（架空）を入力欄に写す
                      </Button>
                    )}
                    <div className="space-y-1"><Label htmlFor="f-name">地名</Label>
                      <Input id="f-name" maxLength={40} autoComplete="off" value={form.placeName} onChange={(e) => set('placeName', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-type">種類</Label>
                      <Select value={form.placeType} onValueChange={(v) => set('placeType', v)}>
                        <SelectTrigger id="f-type" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{PLACE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label htmlFor="f-teller">語り手（仮名・匿名可）</Label>
                      <Input id="f-teller" maxLength={40} autoComplete="off" placeholder="例：語り手F（架空）" value={form.teller} onChange={(e) => set('teller', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-date">聞いた日</Label>
                      <Input id="f-date" type="date" value={form.heardOn} onChange={(e) => set('heardOn', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-story">聞き取った話</Label>
                      <Textarea id="f-story" rows={4} maxLength={600} value={form.story} onChange={(e) => set('story', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-basis">話の出典（誰から・どの資料で）</Label>
                      <Input id="f-basis" maxLength={200} autoComplete="off" value={form.basis} onChange={(e) => set('basis', e.target.value)} /></div>
                    <KindsField idPrefix="k-rec" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
                    <div className="space-y-1"><Label htmlFor="f-cert">確からしさ</Label>
                      <Select value={form.certainty} onValueChange={(v) => set('certainty', v)}>
                        <SelectTrigger id="f-cert" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{[...CERTAINTY].reverse().map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label htmlFor="f-vis">公開範囲</Label>
                      <Select value={form.visibility} onValueChange={(v) => set('visibility', v)}>
                        <SelectTrigger id="f-vis" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(VISIBILITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <div className="space-y-1"><Label htmlFor="f-lic">利用条件</Label>
                      <Select value={form.license} onValueChange={(v) => set('license', v)}>
                        <SelectTrigger id="f-lic" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(LICENSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select></div>
                    <Note>位置: 経度 {focus.lon.toFixed(5)}・緯度 {focus.lat.toFixed(5)}{focus.place ? '（サンプル地名の位置）' : '（地図で指定）'}。「確かめたこと」で選んだ項目: {form.checked.length}件</Note>
                    {errors.length > 0 && (
                      <Alert variant="destructive" role="alert"><AlertTitle>記録できません</AlertTitle>
                        <AlertDescription>{errors.map((m) => <span key={m} className="block">{m}</span>)}</AlertDescription></Alert>
                    )}
                    <Button type="submit" className="w-full">記録して地図に残す（未確認）</Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 4 一覧・書き出し */}
          <TabsContent value="list" className="space-y-3">
            {lastSaved && (
              <Alert className="border-[#0072B2] bg-blue-50 text-blue-950">
                <CircleHelp className="size-4" />
                <AlertTitle>「{lastSaved}」を「未確認」の記録として残しました</AlertTitle>
                <AlertDescription className="text-blue-950/90">
                  未確認の記録は、公開用データには含まれません。確認役が確かめて「確認済み」になった記録のうち、公開範囲が「公開」で利用条件が「利用不可」以外のものだけが公開分です。
                </AlertDescription>
              </Alert>
            )}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">残した記録（{records.length}件）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!records.length && <Note>まだありません。「3 記録」で記録すると、ここに並びます。</Note>}
                <ul className="space-y-2">
                  {records.map((r) => (
                    <li key={r.id} className="space-y-1.5 rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <b>{r.placeName}</b>
                        {r.verified
                          ? <Badge className="bg-[#0072B2] text-white hover:bg-[#0072B2]">✓ 確認済み</Badge>
                          : <Badge variant="outline" className="border-dashed border-[#D55E00] text-[#7a3000]">？ 未確認</Badge>}
                        <Badge variant="secondary">{VISIBILITY[r.visibility]}</Badge>
                        <Badge variant="secondary">{r.certainty}</Badge>
                        {isPublishable(r) && <Badge className="bg-[#0072B2] text-white hover:bg-[#0072B2]">公開分に含む</Badge>}
                        {r.visibility === 'private' && <Badge variant="outline">地図に出ません</Badge>}
                      </div>
                      <p>{r.story}</p>
                      <Note>出典: {r.basis}／語り手: {r.teller}／{r.license}</Note>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => {
                          map?.flyTo({ center: [r.lon, r.lat], zoom: 15, duration: 500 })
                          if (r.visibility !== 'private' && map) { closePopup(); popupRef.current = recordPopup(map, r) }
                        }}>地図で見る</Button>
                        {!r.verified && (
                          <Button size="sm" variant="outline" onClick={() => updateRecord(r.id, (x) => setVerified(x, '確認役（デモ）', new Date().toISOString()))}>
                            確認役として確認済みにする（デモ）
                          </Button>
                        )}
                        {r.visibility !== 'private' && (
                          <Button size="sm" variant="outline" onClick={() => updateRecord(r.id, (x) => ({ ...x, visibility: 'private' }))}>
                            本人・家族の求めで非公開にする
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="border-red-700 text-red-800" onClick={() => removeRecord(r.id)}>
                          <Trash2 className="size-3.5" />削除
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">書き出し（GeoJSON）</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button onClick={() => exportGeo(true)}><Download className="size-4" />公開分を書き出し（{publishableCount}件）</Button>
                  <Button variant="outline" onClick={() => exportGeo(false)}><Download className="size-4" />非公開以外すべて</Button>
                </div>
                <Note>「公開分」は、確認済み・公開・利用条件ありの記録だけです。「非公開以外すべて」は未確認も含む内部確認用で、公開には使いません。ファイルは端末内で作成し、送信しません。</Note>
                <Note>※ 地名に「（架空）」が付く記録は、このデモのための架空の内容です。実際の公開データとしては使わないでください。</Note>
                {exportNote && <p className="rounded bg-muted p-2 text-sm" role="status">{exportNote}</p>}
                <Button variant="outline" size="sm" className="border-red-700 text-red-800" disabled={!records.length} onClick={() => setConfirmClear(true)}>
                  この端末の記録を全消去
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>記録をすべて消しますか？</DialogTitle>
            <DialogDescription>この端末に保存した記録（{records.length}件）をすべて消します。元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>やめる</Button>
            <Button className="bg-red-800 text-white hover:bg-red-900" onClick={() => { setRecords([]); closePopup(); setConfirmClear(false); setLastSaved('') }}>すべて消す</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
