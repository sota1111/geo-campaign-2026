import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { toast } from 'sonner'
import { AlertTriangle, Check, Download, MapPin, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { StepLayout } from '@/components/shared/StepLayout'
import { useAppSteps } from '@/components/shared/AppSteps'
import { downloadGeoJson } from '@/components/shared/downloadText'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { fetchData } from '@/lib/data'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Textarea } from '@/components/ui/textarea'
import {
  CERTAINTY, CHECKS, KINDS, LICENSES, OVERLAYS, VISIBILITY,
  circlePoly, createRecord, crossCheck, fmtDist, gsiLink, isPublishable, nearby, publishBlockers, recommendOverlays,
  setVerified, toGeoJSON,
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
type StepId = 'place' | 'cross' | 'overlay' | 'record' | 'confirm' | 'export'

const EMPTY_FORM: FormState = {
  placeName: '', placeType: '旧地名', teller: '', heardOn: '', story: '', basis: '',
  claimedKinds: [], certainty: '不明', visibility: 'undecided', license: 'CC BY 4.0', checked: [],
}
const PLACE_TYPES = ['旧地名', '小字', '通称地名', 'その他']
const EMPTY_RECORDS: MemoryRecord[] = []
const CENTER: [number, number] = [132.485, 34.475]
const DESCRIPTION = '地域の聞き取り担当として、地名にまつわる災害の言い伝えを公開データで確かめ、聞き取った話を記録して地図に残す。上から順に進めます。'

const STEP_INFO: Record<StepId, { title: string; hint: string }> = {
  place: { title: '地名を選ぶ', hint: '地名と語りは架空のサンプル。地図のオレンジのピンでも選べます' },
  cross: { title: '伝承碑と突き合わせる', hint: '語られている災害と、近くの自然災害伝承碑（実データ）を比べる' },
  overlay: { title: '昔の地図・写真と重ねる', hint: '地図に重ねて、目で見て気づいたことを選ぶ' },
  record: { title: '聞き取りを記録する', hint: '保存すると必ず「未確認」から始まります' },
  confirm: { title: '確認して公開範囲を選ぶ', hint: 'このデモでは、あなたが確認役を兼ねます' },
  export: { title: '公開分を書き出す', hint: '確認済み・公開の記録だけを GeoJSON にします' },
}

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

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
}
const Req = () => <span className="rounded bg-black px-1 text-[10px] font-normal text-white">必須</span>
const Opt = () => <span className="rounded border px-1 text-[10px] font-normal text-muted-foreground">任意</span>

/** ブラウザ標準の select（閉じた直後の操作を取りこぼさない） */
function NativeSelect({ id, value, onChange, options, className = '' }: {
  id?: string; value: string; onChange: (v: string) => void; options: [string, string][]; className?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${className}`}
    >
      {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  )
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

/** 直近に保存した記録の「いま」の状態に合わせた案内（移動ボタンはなし。次の手順はサイドバー） */
function SavedNotice({ rec }: { rec: MemoryRecord }) {
  const publishable = isPublishable(rec)
  let title: string
  let body: string
  if (!rec.verified) {
    title = `「${rec.placeName}」を「未確認」の記録として保存しました`
    body = '未確認のままでは公開分に入りません。次は左の手順「確認して公開範囲を選ぶ」です。'
  } else if (publishable) {
    title = `「${rec.placeName}」は確認済み・公開です。公開分に入りました`
    body = '次は左の手順「公開分を書き出す」です。'
  } else {
    title = `「${rec.placeName}」は確認済みですが、公開分には入っていません`
    body = `理由: ${publishBlockers(rec).join('、')}。`
  }
  return (
    <div className="space-y-0.5 rounded-md border-2 border-[#0072B2] bg-blue-50 p-2 text-sm text-blue-950" role="status">
      <p><b>✓ {title}</b></p>
      <p className="text-xs">{body}</p>
    </div>
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
  const [step, setStep] = useState<StepId>('place')
  const [errors, setErrors] = useState<string[]>([])
  const [lastSavedId, setLastSavedId] = useState('')
  const [flash, setFlash] = useState(false)
  const [mapIdle, setMapIdle] = useState(false)
  const [exportNote, setExportNote] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [zoom, setZoom] = useState(12)
  const [done, setDone] = useState({ cross: false, overlay: false, published: false })
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [dlgVis, setDlgVis] = useState('')
  const [dlgLic, setDlgLic] = useState('CC BY 4.0')
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

  const onMapReady = useCallback((m: maplibregl.Map) => {
    setMap(m)
    m.once('idle', () => setMapIdle(true))
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
    if (id !== 'none') setDone((d) => ({ ...d, overlay: true }))
    const o = OVERLAYS.find((x) => x.id === id)
    if (map && o?.minzoom != null && map.getZoom() < o.minzoom) map.easeTo({ zoom: o.minzoom, duration: 400 })
  }

  const near = useMemo(() => (focus && lore ? nearby(lore, focus.lon, focus.lat, radius) : []), [focus, lore, radius])
  const cross = useMemo(() => crossCheck(form.claimedKinds, near), [form.claimedKinds, near])

  /* 手順2: 突き合わせの結果を表示した（地名があり、災害の種類を選んだ状態で手順2を開いている）ら済 */
  useEffect(() => {
    if (step === 'cross' && focus && form.claimedKinds.length) setDone((d) => (d.cross ? d : { ...d, cross: true }))
  }, [step, focus, form.claimedKinds.length])

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
    toast.success(`「${p.name}」を選びました`)
    map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 })
  }, [map, closePopup])

  const setPin = useCallback((lon: number, lat: number) => {
    closePopup()
    setFocus({ lon, lat, place: null })
    setForm((f) => (!f.placeName || /（架空）$/.test(f.placeName) ? { ...f, placeName: '', claimedKinds: [] } : f))
    setErrors([])
    toast.success('新しい地名の位置を指定しました')
  }, [closePopup])

  const selectRef = useRef({ selectPlace, setPin })
  selectRef.current = { selectPlace, setPin }

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

  useEffect(() => {
    if (!map) return
    const ms: maplibregl.Marker[] = []
    const add = (element: HTMLElement, lon: number, lat: number, anchor: 'bottom' | 'center', onClick?: () => void) => {
      if (onClick) element.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
      ms.push(new maplibregl.Marker({ element, anchor }).setLngLat([lon, lat]).addTo(map))
    }
    places.forEach((p) => add(placePin(p.name, focus?.place?.id === p.id), p.lon, p.lat, 'bottom', () => selectRef.current.selectPlace(p)))
    records.forEach((r) => {
      if (r.visibility === 'private') return
      add(recordPin(r), r.lon, r.lat, 'bottom', () => { closePopup(); popupRef.current = recordPopup(map, r) })
    })
    if (focus && !focus.place) add(newPin(), focus.lon, focus.lat, 'center')
    return () => { ms.forEach((m) => m.remove()); ms.length = 0 }
  }, [map, places, records, focus, closePopup])

  /* 記録 */
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const r = createRecord({ ...form, lon: focus?.lon ?? null, lat: focus?.lat ?? null }, new Date().toISOString())
    if (!r.ok) {
      setErrors(r.errors)
      toast.error(`記録できません: ${r.errors[0]}${r.errors.length > 1 ? ` ほか${r.errors.length - 1}件` : ''}`)
      return
    }
    setErrors([])
    setRecords((rs) => [...rs, r.record])
    setLastSavedId(r.record.id)
    // 二重登録を防ぐため、話・出典・語り手だけ空に戻す。地名・位置などは続けて記録できるよう保持する
    setForm((f) => ({ ...f, story: '', basis: '', teller: '' }))
    toast.success(`「${r.record.placeName}」を未確認の記録として地図に残しました。話・出典・語り手の欄は空に戻しました`)
  }
  const fillSample = (p: SamplePlace) => {
    setForm((f) => ({ ...f, story: p.story, basis: p.basis, teller: p.teller }))
    setFlash(true)
    setTimeout(() => setFlash(false), 2500)
    toast.success('サンプルの語り（架空）を「聞き取った話」「話の出典」「語り手」に入力しました')
  }
  const flashCls = flash ? ' ring-2 ring-[#0072B2] bg-blue-50' : ''

  const updateRecord = (id: string, fn: (r: MemoryRecord) => MemoryRecord) => {
    closePopup()
    setRecords((rs) => rs.map((r) => (r.id === id ? fn(r) : r)))
  }
  const openConfirm = (r: MemoryRecord) => {
    setConfirmId(r.id)
    setDlgVis(r.visibility === 'undecided' ? '' : r.visibility)
    setDlgLic(r.license)
  }
  const doConfirm = () => {
    const rec = records.find((r) => r.id === confirmId)
    if (!rec || !dlgVis) return
    updateRecord(rec.id, (x) => ({ ...setVerified(x, '確認役（デモ）', new Date().toISOString()), visibility: dlgVis as MemoryRecord['visibility'], license: dlgLic }))
    toast.success(
      dlgVis === 'public' && dlgLic !== 'none'
        ? `「${rec.placeName}」を確認済み・公開にしました。公開分に入ります`
        : `「${rec.placeName}」を確認済みにしました（公開範囲「${VISIBILITY[dlgVis as keyof typeof VISIBILITY]}」のため、公開分には入りません）`,
    )
    setConfirmId(null)
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
    const fname = `chimei-kioku-${onlyPub ? 'public' : 'all'}.geojson`
    downloadGeoJson(fname, gj)
    setExportNote(`${gj.features.length}件を GeoJSON で書き出しました（${fname}）。${onlyPub ? '公開分です。' : '未確認を含む内部用です。公開には使いません。'}端末内で作成し、送信はしていません。`)
    toast.success(`${gj.features.length}件を書き出しました（${fname}）`)
    if (onlyPub) setDone((d) => ({ ...d, published: true }))
  }
  const publishableCount = records.filter(isPublishable).length
  const savedRec = records.find((r) => r.id === lastSavedId) ?? null
  const confirmRec = records.find((r) => r.id === confirmId) ?? null

  /* 左サイドバー（スマホは上部）の手順。done は実際の操作の結果から判定する */
  useAppSteps(
    [
      { id: 'place', title: '地名を選ぶ', hint: '地名と語りは架空のサンプル', done: !!focus },
      { id: 'cross', title: '伝承碑と突き合わせる', hint: '半径内の自然災害伝承碑（実データ）と比べる', done: done.cross },
      { id: 'overlay', title: '昔の地図・写真と重ねる', hint: '空中写真・低湿地など。おすすめ表示あり', done: done.overlay },
      { id: 'record', title: '聞き取りを記録する', hint: '保存すると「未確認」になる', done: records.length > 0 },
      {
        id: 'confirm', title: '確認して公開範囲を選ぶ', hint: 'デモでは自分が確認役を兼ねる',
        done: records.some((r) => r.verified && r.visibility !== 'undecided'),
      },
      { id: 'export', title: '公開分を書き出す', hint: '確認済み・公開の記録だけ（GeoJSON）', done: done.published },
    ],
    { activeId: step, onSelectStep: (id) => setStep(id as StepId), description: DESCRIPTION },
  )

  if (loadError) {
    return (
      <div className="p-4">
        <PageHeader appId="biz-idea" compact />
        <Alert variant="destructive"><AlertTitle>データを読み込めませんでした</AlertTitle><AlertDescription>{loadError}</AlertDescription></Alert>
      </div>
    )
  }

  const selectedLabel = focus ? (focus.place ? focus.place.name : `新しい位置（経度 ${focus.lon.toFixed(4)}・緯度 ${focus.lat.toFixed(4)}）`) : ''
  const needPlace = (
    <Alert><MapPin className="size-4" /><AlertTitle>先に地名を選んでください</AlertTitle>
      <AlertDescription>左の手順「地名を選ぶ」で、地名（サンプル）か地図上の位置を選びます。</AlertDescription></Alert>
  )

  /* ---- 手順ごとのパネル ---- */
  const placePanel = (
    <div className="space-y-3">
      {focus && (
        <div className="space-y-1 rounded-md border-2 border-[#0072B2] bg-blue-50 p-2 text-sm" role="status">
          <p>選択中: <b>{selectedLabel}</b></p>
          {focus.place && (
            <>
              <p className="rounded bg-white/70 p-1.5 text-xs">{focus.place.story}</p>
              <p className="text-xs">語り手: {focus.place.teller}／確からしさ（現状）: {focus.place.certainty}</p>
            </>
          )}
        </div>
      )}
      <Note>オレンジの地名か、下の一覧から選びます（どれも架空）。地図の何もない所をクリック／タップすると、新しい地名の位置を指定できます。</Note>
      {!places.length && (
        <div className="space-y-2" role="status" aria-label="地名を読み込み中">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      )}
      <ul className="space-y-2">
        {places.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => selectPlace(p)}
              aria-pressed={focus?.place?.id === p.id}
              className="w-full rounded-md border p-2.5 text-left text-sm hover:bg-accent aria-pressed:border-2 aria-pressed:border-black"
            >
              <Badge className="mr-2 bg-[#D55E00] text-white hover:bg-[#D55E00]">サンプル（架空）</Badge>
              <b>{p.name}</b>
              <span className="mt-1 block text-xs text-muted-foreground">{p.type}・語られている災害: {p.claimedKinds.join('・')}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  const crossPanel = !focus ? needPlace : (
    <div className="space-y-3">
      <p className="text-sm">選択中: <b>{selectedLabel}</b></p>
      <div className="space-y-1">
        <Label htmlFor="radius-select">伝承碑を探す範囲</Label>
        <NativeSelect id="radius-select" value={String(radius)} onChange={(v) => setRadius(Number(v))}
          options={[500, 1000, 2000, 5000].map((r) => [String(r), `半径 ${fmtDist(r)}`])} />
      </div>
      <KindsField idPrefix="k-check" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
      <div aria-live="polite" className="space-y-2" data-testid="cross-result">
        {!form.claimedKinds.length ? (
          <div className="rounded-md border p-3 text-sm">語られている災害の種類が未選択です。選ぶと、碑の種類と突き合わせます。</div>
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
    </div>
  )

  const overlayPanel = (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-md border-2 border-black bg-yellow-50 p-2">
        <p className="text-sm font-bold">
          おすすめ{form.claimedKinds.length ? `（語られている災害: ${form.claimedKinds.join('・')}）` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          {recommendOverlays(form.claimedKinds).map((rec) => {
            const o = OVERLAYS.find((x) => x.id === rec.id)!
            return (
              <Button key={rec.id} size="sm" variant={overlayId === rec.id ? 'default' : 'outline'} onClick={() => chooseOverlay(rec.id)}>
                {overlayId === rec.id && <Check className="size-3.5" />}{o.label}
                <span className="text-[10px] font-normal opacity-80">（{rec.because}）</span>
              </Button>
            )
          })}
        </div>
      </div>
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
        {overlay.minzoom != null && zoom < overlay.minzoom && ' ※ 現在の縮尺では表示されません。地図を拡大してください。'}
      </Note>
      <fieldset className="space-y-2 border-t pt-3">
        <legend className="text-sm font-bold">見て気づいたこと（自分の目で見て選ぶ）</legend>
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
        <Note>人が地図を見て気づいたことの記録です。当てはまらなくても、話が誤りという意味ではありません。選んだ項目は記録に添えられます。</Note>
      </fieldset>
    </div>
  )

  const recordPanel = !focus ? needPlace : (
    <form onSubmit={submit} noValidate className="relative flex min-h-full flex-col">
      <div className="flex-1 space-y-3">
        <div className="rounded-md border-2 border-black bg-yellow-50 p-2 text-sm">
          <p><b>必須</b>: 地名／聞き取った話／話の出典／位置（選択済み）</p>
          <p className="text-xs text-muted-foreground"><b>任意</b>: 語り手・聞いた日・種類・災害の種類・確からしさ。公開範囲は「未定」のまま保存でき、確認のときに決めます。</p>
        </div>
        <Note>この端末のブラウザ（localStorage）にだけ保存し、サーバーには送りません。実在の人の話を入力する場合は本人の同意を得てください（デモでは架空の内容を入力してください）。</Note>
        {focus.place && (
          <Button type="button" variant="outline" size="sm" onClick={() => fillSample(focus.place!)}>
            サンプルの語り（架空）を入力欄に写す
          </Button>
        )}
        <div className="space-y-1"><Label htmlFor="f-name">地名 <Req /></Label>
          <Input id="f-name" maxLength={40} autoComplete="off" value={form.placeName} onChange={(e) => set('placeName', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="f-story">聞き取った話 <Req /></Label>
          <Textarea id="f-story" className={flashCls} rows={3} maxLength={600} value={form.story} onChange={(e) => set('story', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="f-basis">話の出典（誰から・どの資料で） <Req /></Label>
          <Input id="f-basis" className={flashCls} maxLength={200} autoComplete="off" value={form.basis} onChange={(e) => set('basis', e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="f-teller">語り手（仮名・匿名可） <Opt /></Label>
          <Input id="f-teller" className={flashCls} maxLength={40} autoComplete="off" placeholder="例：語り手F（架空）" value={form.teller} onChange={(e) => set('teller', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label htmlFor="f-date">聞いた日 <Opt /></Label>
            <Input id="f-date" type="date" value={form.heardOn} onChange={(e) => set('heardOn', e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="f-type">種類 <Opt /></Label>
            <NativeSelect id="f-type" value={form.placeType} onChange={(v) => set('placeType', v)} options={PLACE_TYPES.map((t) => [t, t])} /></div>
        </div>
        <KindsField idPrefix="k-rec" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label htmlFor="f-cert">確からしさ <Opt /></Label>
            <NativeSelect id="f-cert" value={form.certainty} onChange={(v) => set('certainty', v)} options={[...CERTAINTY].reverse().map((c) => [c, c])} /></div>
          <div className="space-y-1"><Label htmlFor="f-lic">利用条件 <Opt /></Label>
            <NativeSelect id="f-lic" value={form.license} onChange={(v) => set('license', v)} options={Object.entries(LICENSES)} /></div>
        </div>
        <div className="space-y-1"><Label htmlFor="f-vis">公開範囲 <Opt /></Label>
          <NativeSelect id="f-vis" value={form.visibility} onChange={(v) => set('visibility', v)} options={Object.entries(VISIBILITY)} />
          <Note>初期値は「未定」で、勝手に公開されることはありません。公開分に入るには「公開」を選び、確認済みにする必要があります。</Note></div>
        <Note>位置: 経度 {focus.lon.toFixed(5)}・緯度 {focus.lat.toFixed(5)}{focus.place ? '（サンプル地名の位置）' : '（地図で指定）'}。手順3で選んだ「見て気づいたこと」: {form.checked.length}件</Note>
        {errors.length > 0 && (
          <Alert variant="destructive" role="alert"><AlertTitle>記録できません</AlertTitle>
            <AlertDescription>{errors.map((m) => <span key={m} className="block">{m}</span>)}</AlertDescription></Alert>
        )}
      </div>
      <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 space-y-2 border-t bg-background px-4 py-3">
        {savedRec && <SavedNotice rec={savedRec} />}
        <Button type="submit" className="w-full">記録して地図に残す（未確認）</Button>
      </div>
    </form>
  )

  const confirmPanel = (
    <div className="space-y-3">
      <Note>記録は必ず「未確認」から始まります。確認役が出典などを確かめて「確認済み」にし、公開範囲を選びます。このデモでは、あなたが確認役を兼ねます（実運用では図書館・郷土資料館等の担当者が行います）。</Note>
      {savedRec && <SavedNotice rec={savedRec} />}
      {!records.length && <div className="rounded-md border p-3 text-sm">まだ記録がありません。左の手順「聞き取りを記録する」で1件保存してください。</div>}
      <ul className="space-y-2">
        {records.map((r) => (
          <li
            key={r.id}
            className={`space-y-1.5 rounded-md border p-3 text-sm ${r.id === lastSavedId ? 'border-2 border-[#0072B2] bg-blue-50' : ''}`}
          >
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
            {!isPublishable(r) && <Note>公開分に入っていない理由: {publishBlockers(r).join('、')}</Note>}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5"><Label htmlFor={`vis-${r.id}`} className="text-xs">公開範囲</Label>
                <NativeSelect id={`vis-${r.id}`} value={r.visibility} options={Object.entries(VISIBILITY)}
                  onChange={(v) => updateRecord(r.id, (x) => ({ ...x, visibility: v as MemoryRecord['visibility'] }))} /></div>
              <div className="space-y-0.5"><Label htmlFor={`lic-${r.id}`} className="text-xs">利用条件</Label>
                <NativeSelect id={`lic-${r.id}`} value={r.license} options={Object.entries(LICENSES)}
                  onChange={(v) => updateRecord(r.id, (x) => ({ ...x, license: v }))} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => {
                map?.flyTo({ center: [r.lon, r.lat], zoom: 15, duration: 500 })
                if (r.visibility !== 'private' && map) { closePopup(); popupRef.current = recordPopup(map, r) }
              }}>地図で見る</Button>
              {!r.verified && <Button size="sm" onClick={() => openConfirm(r)}>確認済みにする…（確認役を兼ねる）</Button>}
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
      <Button variant="outline" size="sm" className="border-red-700 text-red-800" disabled={!records.length} onClick={() => setConfirmClear(true)}>
        この端末の記録を全消去
      </Button>
    </div>
  )

  const exportPanel = (
    <div className="space-y-3">
      <div className="space-y-2 rounded-md border-2 border-[#0072B2] p-3">
        <b className="text-sm">公開分（確認済みのみ）</b>
        <Note>確認済み・公開範囲「公開」・利用条件あり（「利用不可」以外）の記録だけ。公開用にはこちらを使います。</Note>
        <p className="text-sm">いまの公開分: <b>{publishableCount}件</b></p>
        <Button className="w-full" onClick={() => exportGeo(true)}><Download className="size-4" />公開分を書き出し</Button>
      </div>
      {exportNote && (
        <div className={`rounded-md border-2 p-3 text-sm font-bold ${/書き出しました/.test(exportNote) ? 'border-[#0072B2] bg-blue-50 text-blue-950' : 'border-[#D55E00] bg-orange-50 text-orange-950'}`} role="status">
          {/書き出しました/.test(exportNote) ? '✓ ' : '△ '}{exportNote}
        </div>
      )}
      {records.length > 0 && publishableCount === 0 && (
        <Alert className="border-[#D55E00] bg-orange-50 text-orange-950">
          <AlertTriangle className="size-4" />
          <AlertTitle>公開分は0件です</AlertTitle>
          <AlertDescription className="space-y-2 text-orange-950/90">
            <p className="font-bold">確認済みにすると公開分に入ります（公開範囲が「公開」であることも必要です）。</p>
            {records.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span>「{r.placeName}」: {publishBlockers(r).join('、')}</span>
                {!r.verified && <Button size="sm" onClick={() => openConfirm(r)}>確認済みにする…</Button>}
                {r.verified && r.visibility !== 'public' && (
                  <Button size="sm" variant="outline" onClick={() => updateRecord(r.id, (x) => ({ ...x, visibility: 'public' }))}>
                    公開範囲を「公開」にする
                  </Button>
                )}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}
      <div className="space-y-2 rounded-md border border-dashed p-3">
        <b className="text-sm">全記録（未確認を含む・内部用）</b>
        <Note>非公開を除くすべて（未確認を含む）。確認作業や内部の見直し用で、<b>公開には使いません</b>。対象: {records.filter((r) => r.visibility !== 'private').length}件</Note>
        <Button variant="outline" className="w-full" onClick={() => exportGeo(false)}><Download className="size-4" />全記録を書き出し</Button>
      </div>
      <Note>書き出したGeoJSONは、地域のオープンデータサイト等に掲載する想定です（このデモは掲載しません）。</Note>
      <Note>ファイルは端末内で作成し、送信しません。地名に「（架空）」が付く記録は、このデモのための架空の内容です。実際の公開データとしては使わないでください。</Note>
    </div>
  )

  const panels: Record<StepId, React.ReactNode> = {
    place: placePanel, cross: crossPanel, overlay: overlayPanel, record: recordPanel, confirm: confirmPanel, export: exportPanel,
  }

  const mapAside = (
    <div className="relative">
      {!mapIdle && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/80" role="status">
          <div className="space-y-2 text-center text-sm">
            <Skeleton className="mx-auto h-24 w-48" />
            地図を読み込み中…
          </div>
        </div>
      )}
      <MapView
        center={CENTER}
        zoom={12}
        basemap="std"
        className="!h-full !rounded-none !border-0"
        ariaLabel="地名の記憶マップ。オレンジの地名ピン、青い丸の自然災害伝承碑、残した記録のピンを表示"
        clickableLayerIds={['lore']}
        onFeatureClick={onFeatureClick}
        onClick={onMapClick}
        onMapReady={onMapReady}
        layers={layers}
        attribution={overlayId !== 'none' ? `国土地理院 地理院タイル（${overlay.label}）／自然災害伝承碑（国土地理院）` : '自然災害伝承碑（国土地理院）'}
      />
      <ul className="pointer-events-none absolute bottom-7 left-2 z-10 hidden space-y-0.5 rounded bg-white/90 p-1.5 text-[11px] shadow md:block" aria-label="凡例">
        <li className="flex items-center gap-1.5"><span className="rounded bg-[#D55E00] px-1 font-bold text-white">名</span>地名（サンプル・架空）</li>
        <li className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-full border-2 border-white bg-[#0072B2] ring-1 ring-[#0072B2]" />自然災害伝承碑（実データ）</li>
        <li className="flex items-center gap-1.5"><span className="rounded border-2 border-dashed border-[#CC79A7] bg-white px-1 text-[#7a3a62]">？</span>記録（未確認）</li>
        <li className="flex items-center gap-1.5"><span className="rounded border-2 border-[#CC79A7] bg-white px-1 text-[#7a3a62]">✓</span>確認済み</li>
      </ul>
    </div>
  )

  return (
    <>
      <PageHeader appId="biz-idea" compact actions={<SourceDialog sources={SOURCES} title="出典・利用条件・このデモの限界" />} />
      <p className="shrink-0 border-b bg-orange-50 px-4 py-1 text-xs text-orange-950">
        <AlertTriangle className="mr-1 inline size-3.5" />
        <b>デモ:</b> オレンジの地名と語りは<b>架空のサンプル</b>、青い丸（自然災害伝承碑）は<b>国土地理院の実データ</b>です。危険度は判定せず、記録はこの端末だけに保存します。
      </p>
      <StepLayout title={STEP_INFO[step].title} hint={STEP_INFO[step].hint} aside={mapAside}>
        {panels[step]}
      </StepLayout>

      <Dialog open={!!confirmRec} onOpenChange={(o) => { if (!o) setConfirmId(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認済みにして、公開範囲を選ぶ</DialogTitle>
            <DialogDescription>
              「{confirmRec?.placeName}」の出典などを確かめたものとして「確認済み」にします。このデモでは、あなたが確認役を兼ねます（実運用では図書館・郷土資料館等の担当者が行います）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label htmlFor="dlg-vis">公開範囲（必ず選んでください）</Label>
              <NativeSelect id="dlg-vis" value={dlgVis} onChange={setDlgVis}
                options={[...(dlgVis ? [] : [['', '選んでください']] as [string, string][]), ...(Object.entries(VISIBILITY).filter(([k]) => k !== 'undecided') as [string, string][])]} /></div>
            <div className="space-y-1"><Label htmlFor="dlg-lic">利用条件</Label>
              <NativeSelect id="dlg-lic" value={dlgLic} onChange={setDlgLic} options={Object.entries(LICENSES)} /></div>
            <Note>公開分として書き出されるのは、「公開」を選び、利用条件が「利用不可」以外のときだけです。</Note>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>やめる</Button>
            <Button disabled={!dlgVis} onClick={doConfirm}>確認済みにする</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>記録をすべて消しますか？</DialogTitle>
            <DialogDescription>この端末に保存した記録（{records.length}件）をすべて消します。元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>やめる</Button>
            <Button className="bg-red-800 text-white hover:bg-red-900" onClick={() => { setRecords([]); closePopup(); setConfirmClear(false); setLastSavedId('') }}>すべて消す</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
