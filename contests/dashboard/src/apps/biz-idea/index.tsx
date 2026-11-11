import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { toast } from 'sonner'
import { AlertTriangle, Check, Download, MapPin, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { useAppSteps } from '@/components/shared/AppSteps'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  CERTAINTY, CHECKS, KINDS, LICENSES, OVERLAYS, VISIBILITY,
  circlePoly, createRecord, crossCheck, fmtDist, gsiLink, isPublishable, nearby, publishBlockers, recommendOverlays, setVerified, toGeoJSON,
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
  claimedKinds: [], certainty: '不明', visibility: 'undecided', license: 'CC BY 4.0', checked: [],
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

/** ブラウザ標準の select（Radix Select は閉じた直後の操作を取りこぼすことがあるため、保存まわりでは使わない） */
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

const Req = () => <span className="rounded bg-black px-1 text-[10px] font-normal text-white">必須</span>
const Opt = () => <span className="rounded border px-1 text-[10px] font-normal text-muted-foreground">任意</span>

/** 直近に保存した記録の「いま」の状態に合わせた案内（保存直後・確認後・公開後で文面が変わる） */
function SavedNotice({ rec, onConfirm, onList, onNext }: {
  rec: MemoryRecord; onConfirm: () => void; onList: (anchor?: string) => void; onNext: () => void
}) {
  const publishable = isPublishable(rec)
  let title: string
  let body: string
  if (!rec.verified) {
    title = `「${rec.placeName}」を「未確認」の記録として保存しました`
    body = `未確認のままでは公開分に入りません。次は「確認済みにする…」を押してください（公開範囲もそこで選びます${rec.visibility === 'undecided' ? '。いまは未定です' : ''}）。`
  } else if (publishable) {
    title = `「${rec.placeName}」は確認済み・公開です。公開分に入りました`
    body = '次は書き出しです。「公開分を書き出し」を押すと GeoJSON を作ります。'
  } else {
    title = `「${rec.placeName}」は確認済みですが、公開分には入っていません`
    body = `理由: ${publishBlockers(rec).join('、')}。一覧の行で公開範囲などを変えられます。`
  }
  return (
    <div className="space-y-1.5 rounded-md border-2 border-[#0072B2] bg-blue-50 p-2 text-sm text-blue-950" role="status">
      <p><b>✓ {title}</b></p>
      <p className="text-xs">{body}</p>
      <div className="flex flex-wrap gap-2">
        {!rec.verified && <Button type="button" size="sm" onClick={onConfirm}>確認済みにする…（確認役を兼ねる）</Button>}
        {publishable && <Button type="button" size="sm" onClick={() => onList('step-publish')}>書き出しへ進む</Button>}
        {!publishable && rec.verified && <Button type="button" size="sm" variant="outline" onClick={() => onList()}>記録の一覧を見る</Button>}
        {!rec.verified && <Button type="button" size="sm" variant="outline" onClick={() => onList()}>記録の一覧を見る</Button>}
        <Button type="button" size="sm" variant="outline" onClick={onNext}>続けて別の話を記録する</Button>
      </div>
    </div>
  )
}

/** 公開までの流れ。current: 今どこか（record=記録, verify=確認, publish=書き出し） */
function FlowDiagram({ current }: { current: 'record' | 'verify' | 'publish' }) {
  const steps = [
    { id: 'record', title: '記録（手順4）', sub: '聞き取り担当（必ず「未確認」）' },
    { id: 'verify', title: '確認（手順5）', sub: '確認役が出典などを確かめる' },
    { id: 'publish', title: '公開分として書き出し（手順6）', sub: '確認済み＋公開範囲「公開」＋利用条件あり' },
  ]
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-2" aria-label="公開までの流れ">
      <ol className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-1 flex-col items-stretch gap-1 sm:flex-row sm:items-center">
            <div className={`flex-1 rounded border p-2 text-xs ${current === s.id ? 'border-2 border-black bg-white font-bold' : 'bg-white/60'}`}>
              <div>{s.title}{current === s.id && '（いまここ）'}</div>
              <div className="font-normal text-muted-foreground">{s.sub}</div>
            </div>
            {i < steps.length - 1 && <span aria-hidden className="text-center text-muted-foreground">▼<span className="hidden sm:inline">　</span></span>}
          </li>
        ))}
      </ol>
      <p className="text-xs leading-relaxed">
        このデモでは、<b>あなたが確認役を兼ねて「確認済み」にできます</b>。実運用では図書館・郷土資料館等の担当者が行います。
      </p>
    </div>
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
  const [flash, setFlash] = useState(false)
  const [lastSavedId, setLastSavedId] = useState('')
  const [mapIdle, setMapIdle] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)
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

  /* 地図の準備: 重ね合わせの再適用（背景切替で style が作り直されるため）とズーム監視 */
  const onMapReady = useCallback((m: maplibregl.Map) => {
    setMap(m)
    m.once('idle', () => setMapIdle(true))
    const reapply = () => applyOverlay(m, overlayRef.current.id, overlayRef.current.opacity / 100)
    m.on('load', reapply)
    m.on('style.load', reapply)
    m.on('zoomend', () => setZoom(Math.round(m.getZoom() * 10) / 10))
  }, [])

  /* 画面の移動は、利用者が「次にやること」などのボタンを押した結果としてだけ行う。
     タブ見出しを直接押したとき、地名の選択・保存・書き出しのときは、タブもスクロールも動かさない */
  const goTab = useCallback((t: string, anchorId?: string) => {
    setTab(t)
    // タブ切替後の描画を待ち、目的の位置が現れたら1回だけ（瞬時に）移動する。途中でずれないよう smooth は使わない
    let tries = 0
    const attempt = () => {
      const el = anchorId ? document.getElementById(anchorId) : null
      if (anchorId && !el && tries++ < 20) { requestAnimationFrame(attempt); return }
      requestAnimationFrame(() => (el ?? tabsRef.current)?.scrollIntoView({ block: 'start', behavior: 'auto' }))
    }
    requestAnimationFrame(attempt)
  }, [])

  /* 手順2「伝承碑と突き合わせる」: 突き合わせ結果（2-1）が画面に表示されたら済。2-2 の操作では済にならない */
  const [resultEl, setResultEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!resultEl || !form.claimedKinds.length) return
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setDone((d) => (d.cross ? d : { ...d, cross: true }))
    }, { threshold: 0.2 })
    io.observe(resultEl)
    return () => io.disconnect()
  }, [resultEl, form.claimedKinds.length])

  useEffect(() => {
    if (!map) return
    applyOverlay(map, overlayId, opacity / 100)
  }, [map, overlayId, opacity])

  const overlay = OVERLAYS.find((o) => o.id === overlayId) ?? OVERLAYS[0]
  const chooseOverlay = (id: string) => {
    setOverlayId(id)
    if (id !== 'none') setDone((d) => ({ ...d, overlay: true }))
    const o =OVERLAYS.find((x) => x.id === id)
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
    toast.success(`「${p.name}」を選びました。次は手順「伝承碑と突き合わせる」です`)
    map?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 })
  }, [map, closePopup])

  const setPin = useCallback((lon: number, lat: number) => {
    closePopup()
    setFocus({ lon, lat, place: null })
    setForm((f) => (!f.placeName || /（架空）$/.test(f.placeName) ? { ...f, placeName: '', claimedKinds: [] } : f))
    setErrors([])
    toast.success('新しい地名の位置を指定しました。次は手順「伝承碑と突き合わせる」です')
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
    if (!r.ok) {
      setErrors(r.errors)
      toast.error(`記録できません: ${r.errors[0]}${r.errors.length > 1 ? ` ほか${r.errors.length - 1}件` : ''}`)
      return
    }
    setErrors([])
    setRecords((rs) => [...rs, r.record])
    setLastSavedId(r.record.id)
    // 二重登録を防ぐため、話・出典・語り手だけ空に戻す。地名・位置などは「続けて記録」のために保持する
    setForm((f) => ({ ...f, story: '', basis: '', teller: '' }))
    toast.success(`「${r.record.placeName}」を未確認の記録として地図に残しました。話・出典・語り手の欄は空に戻しました（地名と位置はそのまま）`)
  }
  /** 続けて別の話を記録する: 地名と位置はそのままで、話の欄へ移る（押した結果としての移動） */
  const nextRecord = () => {
    setLastSavedId('')
    setErrors([])
    setTab('rec')
    setTimeout(() => {
      const el = document.getElementById('f-story')
      el?.scrollIntoView({ block: 'center', behavior: 'auto' })
      el?.focus({ preventScroll: true })
    }, 150)
  }
  const fillSample = (p: SamplePlace) => {
    setForm((f) => ({ ...f, story: p.story, basis: p.basis, teller: p.teller }))
    setFlash(true)
    setTimeout(() => setFlash(false), 2500)
    toast.success('サンプルの語り（架空）を「聞き取った話」「話の出典」「語り手」に入力しました。下の入力欄で確認できます')
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
    downloadGeoJson(`chimei-kioku-${onlyPub ? 'public' : 'all'}.geojson`, gj)
    const fname = `chimei-kioku-${onlyPub ? 'public' : 'all'}.geojson`
    setExportNote(`${gj.features.length}件を GeoJSON で書き出しました（${fname}）。${onlyPub ? '公開分です。' : '未確認を含む内部用です。公開には使いません。'}端末内で作成し、送信はしていません。`)
    toast.success(`${gj.features.length}件を書き出しました（${fname}）`)
    if (onlyPub) setDone((d) => ({ ...d, published: true }))
  }
  const publishableCount = records.filter(isPublishable).length
  const savedRec = records.find((r) => r.id === lastSavedId) ?? null

  /* 左サイドバー（スマホは上部）の手順。done は実際の操作の結果から判定する */
  const unverified = records.filter((r) => !r.verified)
  useAppSteps([
    {
      id: 'place', title: '地名を選ぶ', hint: '地名と語りは架空のサンプル', done: !!focus,
      onSelect: () => goTab('pick'),
    },
    {
      id: 'cross', title: '伝承碑と突き合わせる', hint: '半径内の自然災害伝承碑（実データ）と比べる', done: done.cross,
      onSelect: () => goTab('check', focus ? 'step-2-1-result' : undefined),
    },
    {
      id: 'overlay', title: '昔の地図・写真と重ねる', hint: '空中写真・低湿地など。おすすめ表示あり', done: done.overlay,
      onSelect: () => goTab('check', 'step-2-2'),
      // 手順3は2-2の先頭へ。地名未選択でも2-2のカードは表示される
    },
    {
      id: 'record', title: '聞き取りを記録する', hint: '保存すると「未確認」になる', done: records.length > 0,
      onSelect: () => goTab('rec'),
    },
    {
      id: 'confirm', title: '確認して公開範囲を選ぶ', hint: 'デモでは自分が確認役を兼ねる',
      done: records.some((r) => r.verified && r.visibility !== 'undecided'),
      onSelect: () => {
        if (unverified.length) { goTab('list'); openConfirm(unverified[unverified.length - 1]) } else goTab(records.length ? 'list' : 'rec')
      },
    },
    {
      id: 'export', title: '公開分を書き出す', hint: '確認済み・公開の記録だけ（GeoJSON）', done: done.published,
      onSelect: () => goTab('list', 'step-publish'),
    },
  ])
  const confirmRec = records.find((r) => r.id === confirmId) ?? null

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

      <p className="rounded-md border bg-muted/40 p-2 text-sm">
        <b>進め方:</b> 左の「手順」（スマホは上部の手順表示）を上から順に押すと、各手順の操作位置へ移ります。操作すると自動で「済」になります。
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        {/* 地図 */}
        <div className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div className="relative">
          {!mapIdle && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/80" role="status">
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
            className="h-[340px] lg:h-[calc(100vh-9rem)] lg:min-h-[420px]"
            ariaLabel="地名の記憶マップ。オレンジの地名ピン、青い丸の自然災害伝承碑、残した記録のピンを表示"
            clickableLayerIds={['lore']}
            onFeatureClick={onFeatureClick}
            onClick={onMapClick}
            onMapReady={onMapReady}
            layers={layers}
            attribution={overlayId !== 'none' ? `国土地理院 地理院タイル（${overlay.label}）／自然災害伝承碑（国土地理院）` : '自然災害伝承碑（国土地理院）'}
          />
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="凡例">
            <li className="flex items-center gap-1.5"><span className="rounded bg-[#D55E00] px-1.5 py-0.5 font-bold text-white">名</span>地名（サンプル・架空）</li>
            <li className="flex items-center gap-1.5"><span className="inline-block size-3.5 rounded-full border-2 border-white bg-[#0072B2] ring-1 ring-[#0072B2]" />自然災害伝承碑（実データ）</li>
            <li className="flex items-center gap-1.5"><span className="rounded border-2 border-dashed border-[#CC79A7] bg-white px-1.5 text-[#7a3a62]">？</span>残した記録（未確認）</li>
            <li className="flex items-center gap-1.5"><span className="rounded border-2 border-[#CC79A7] bg-white px-1.5 text-[#7a3a62]">✓</span>確認済み</li>
          </ul>
        </div>

        {/* 操作パネル */}
        <div className="min-w-0 space-y-3">
        <Tabs ref={tabsRef} value={tab} onValueChange={setTab} className="min-w-0 scroll-mt-2">
          <TabsList className="grid h-auto w-full grid-cols-4">
            <TabsTrigger value="pick" className="px-1 text-xs sm:text-sm">地名</TabsTrigger>
            <TabsTrigger value="check" className="px-1 text-xs sm:text-sm">確かめる</TabsTrigger>
            <TabsTrigger value="rec" className="px-1 text-xs sm:text-sm">記録</TabsTrigger>
            <TabsTrigger value="list" className="flex-col gap-0 px-1 text-xs sm:text-sm">
              一覧・書出
              <span className="text-[10px] font-normal text-muted-foreground">記録 {records.length}件</span>
            </TabsTrigger>
          </TabsList>

          {/* 1 地名 */}
          <TabsContent value="pick" className="space-y-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">地名を選ぶ（手順1・広島市安佐南区周辺）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {focus && (
                  <p className="rounded-md border-2 border-[#0072B2] bg-blue-50 p-2 text-sm" role="status">
                    選択中: <b>{focus.place ? focus.place.name : `新しい位置（経度 ${focus.lon.toFixed(4)}・緯度 ${focus.lat.toFixed(4)}）`}</b>
                    <span className="block text-xs">ほかの地名を押すと選び直せます。次は、左の手順「伝承碑と突き合わせる」を押してください。</span>
                  </p>
                )}
                <Note>地図上のオレンジの地名か、下の一覧から選びます（どれも架空）。地図の何もない所をクリック／タップすると、新しい地名の位置を指定できます。</Note>
                {!places.length && (
                  <div className="space-y-2" role="status" aria-label="地名を読み込み中">
                    {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                )}
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
            <div className="flex flex-wrap gap-2" role="navigation" aria-label="確かめるタブの手順">
              <Button size="sm" variant="outline" onClick={() => document.getElementById('step-2-1')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
                {done.cross ? "✓ " : ""}手順2 伝承碑と突き合わせる
              </Button>
              <Button size="sm" variant="outline" onClick={() => document.getElementById('step-2-2')?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
                {done.overlay ? "✓ " : ""}手順3 昔の地図・写真と重ねる
              </Button>
            </div>
            {!focus ? (
              <Alert><MapPin className="size-4" /><AlertTitle>先に地名を選んでください</AlertTitle>
                <AlertDescription>
                  <Button size="sm" variant="outline" onClick={() => setTab('pick')}>地名の一覧へ（手順1）</Button>
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

                <Card id="step-2-1" className="scroll-mt-2">
                  <CardHeader className="pb-2"><CardTitle className="text-base">伝承碑と突き合わせる（手順2・近くの自然災害伝承碑）</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="radius-select">伝承碑を探す範囲</Label>
                      <NativeSelect id="radius-select" value={String(radius)} onChange={(v) => setRadius(Number(v))}
                        options={[500, 1000, 2000, 5000].map((r) => [String(r), `半径 ${fmtDist(r)}`])} />
                    </div>
                    <KindsField idPrefix="k-check" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
                    <div ref={setResultEl} id="step-2-1-result" aria-live="polite" className="scroll-mt-28 space-y-2">
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

            <Card id="step-2-2" className="scroll-mt-28">
              <CardHeader className="pb-2"><CardTitle className="text-base">昔の地図・写真と重ねる（手順3・国土地理院）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
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
                  <Note>地図が重なって見えたら、下の「見て気づいたこと」にチェックします。見えなくても、話が誤りという意味ではありません。</Note>
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
                </Note>
                {overlay.minzoom != null && zoom < overlay.minzoom && (
                  <Note>※ 現在の縮尺では表示されません。地図を拡大してください。</Note>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">見て気づいたこと（手順3・自分の目で見て選ぶ）</CardTitle></CardHeader>
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
                <Button onClick={() => goTab('rec')} disabled={!focus}>聞き取りを記録する（手順4）へ</Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* 3 記録 */}
          <TabsContent value="rec" className="space-y-3">
            {!focus ? (
              <Alert><MapPin className="size-4" /><AlertTitle>先に地名を選ぶか、地図で位置を指定してください</AlertTitle>
                <AlertDescription><Button size="sm" variant="outline" onClick={() => setTab('pick')}>地名の一覧へ（手順1）</Button></AlertDescription></Alert>
            ) : (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">聞き取りを記録して地図に残す（手順4）</CardTitle></CardHeader>
                <CardContent>
                  <form onSubmit={submit} noValidate className="space-y-3">
                    <div className="rounded-md border-2 border-black bg-yellow-50 p-2 text-sm" aria-label="入力項目">
                      <p><b>必須</b>: 地名／聞き取った話／話の出典／位置（地名を選ぶか、地図で指定済み）</p>
                      <p className="text-xs text-muted-foreground"><b>任意</b>: 語り手・聞いた日・種類・語られている災害・確からしさ。公開範囲・利用条件は初期値のまま保存できます（公開範囲は確認のときに決めます）。</p>
                    </div>
                    <FlowDiagram current="record" />
                    <Note>この端末のブラウザ（localStorage）にだけ保存し、サーバーには送りません。実在の人の話を入力する場合は本人の同意を得てください（デモでは架空の内容を入力してください）。新しい記録は必ず<b>「未確認」</b>から始まります。</Note>
                    {focus.place && (
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => fillSample(focus.place!)}
                      >
                        サンプルの語り（架空）を入力欄に写す
                      </Button>
                    )}
                    <div className="space-y-1"><Label htmlFor="f-name">地名 <Req /></Label>
                      <Input id="f-name" maxLength={40} autoComplete="off" value={form.placeName} onChange={(e) => set('placeName', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-type">種類</Label>
                      <NativeSelect id="f-type" value={form.placeType} onChange={(v) => set('placeType', v)} options={PLACE_TYPES.map((t) => [t, t])} /></div>
                    <div className="space-y-1"><Label htmlFor="f-teller">語り手（仮名・匿名可） <Opt /></Label>
                      <Input id="f-teller" className={flashCls} maxLength={40} autoComplete="off" placeholder="例：語り手F（架空）" value={form.teller} onChange={(e) => set('teller', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-date">聞いた日 <Opt /></Label>
                      <Input id="f-date" type="date" value={form.heardOn} onChange={(e) => set('heardOn', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-story">聞き取った話 <Req /></Label>
                      <Textarea id="f-story" className={flashCls} rows={4} maxLength={600} value={form.story} onChange={(e) => set('story', e.target.value)} /></div>
                    <div className="space-y-1"><Label htmlFor="f-basis">話の出典（誰から・どの資料で） <Req /></Label>
                      <Input id="f-basis" className={flashCls} maxLength={200} autoComplete="off" value={form.basis} onChange={(e) => set('basis', e.target.value)} /></div>
                    <KindsField idPrefix="k-rec" value={form.claimedKinds} onChange={(v) => set('claimedKinds', v)} />
                    <div className="space-y-1"><Label htmlFor="f-cert">確からしさ</Label>
                      <NativeSelect id="f-cert" value={form.certainty} onChange={(v) => set('certainty', v)} options={[...CERTAINTY].reverse().map((c) => [c, c])} /></div>
                    <div className="space-y-1"><Label htmlFor="f-vis">公開範囲</Label>
                      <NativeSelect id="f-vis" value={form.visibility} onChange={(v) => set('visibility', v)} options={Object.entries(VISIBILITY)} />
                      <Note>初期値は「未定」で、勝手に公開されることはありません。公開分に入るには「公開」を選び、さらに確認済みにする必要があります（あとで一覧からも変更できます）。</Note></div>
                    <div className="space-y-1"><Label htmlFor="f-lic">利用条件</Label>
                      <NativeSelect id="f-lic" value={form.license} onChange={(v) => set('license', v)} options={Object.entries(LICENSES)} /></div>
                    <Note>位置: 経度 {focus.lon.toFixed(5)}・緯度 {focus.lat.toFixed(5)}{focus.place ? '（サンプル地名の位置）' : '（地図で指定）'}。「確かめたこと」で選んだ項目: {form.checked.length}件</Note>
                    {errors.length > 0 && (
                      <Alert variant="destructive" role="alert"><AlertTitle>記録できません</AlertTitle>
                        <AlertDescription>{errors.map((m) => <span key={m} className="block">{m}</span>)}</AlertDescription></Alert>
                    )}
                    <div className="sticky bottom-0 -mx-6 space-y-2 border-t bg-background/95 px-6 py-3 backdrop-blur">
                      {savedRec && <SavedNotice rec={savedRec} onConfirm={() => openConfirm(savedRec)} onList={(a) => goTab('list', a)} onNext={nextRecord} />}
                      <Button type="submit" className="w-full">記録して地図に残す（未確認）</Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 4 一覧・書き出し */}
          <TabsContent value="list" className="space-y-3">
            <FlowDiagram current={records.length === 0 ? 'record' : publishableCount > 0 ? 'publish' : 'verify'} />
            {savedRec && <SavedNotice rec={savedRec} onConfirm={() => openConfirm(savedRec)} onList={(a) => goTab('list', a)} onNext={nextRecord} />}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">残した記録の確認・公開範囲（手順5・{records.length}件）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {!records.length && <Note>まだありません。「記録」タブで記録すると、ここに並びます。</Note>}
                <ul className="space-y-2">
                  {records.map((r) => (
                    <li
                      key={r.id}
                      id={`rec-row-${r.id}`}
                      className={`space-y-1.5 rounded-md border p-3 text-sm ${r.id === lastSavedId ? 'border-2 border-[#0072B2] bg-blue-50' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <b>{r.placeName}</b>
                        {r.id === lastSavedId && <Badge className="bg-black text-white hover:bg-black">いま保存</Badge>}
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
                        {!r.verified && (
                          <Button size="sm" onClick={() => openConfirm(r)}>
                            確認済みにする…（確認役を兼ねる）
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

            <Card id="step-publish" className="scroll-mt-28">
              <CardHeader className="pb-2"><CardTitle className="text-base">公開分を書き出す（手順6・GeoJSON）</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-2 rounded-md border-2 border-[#0072B2] p-3">
                    <b className="text-sm">公開分（確認済みのみ）</b>
                    <Note>確認済み・公開範囲「公開」・利用条件あり（「利用不可」以外）の記録だけ。公開用にはこちらを使います。</Note>
                    <p className="text-sm">いまの公開分: <b>{publishableCount}件</b></p>
                    <Button className="w-full" onClick={() => exportGeo(true)}><Download className="size-4" />公開分を書き出し</Button>
                  </div>
                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <b className="text-sm">全記録（未確認を含む・内部用）</b>
                    <Note>非公開を除くすべて（未確認を含む）。確認作業や内部の見直し用で、<b>公開には使いません</b>。</Note>
                    <p className="text-sm">対象: <b>{records.filter((r) => r.visibility !== 'private').length}件</b></p>
                    <Button variant="outline" className="w-full" onClick={() => exportGeo(false)}><Download className="size-4" />全記録を書き出し</Button>
                  </div>
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
                          {!r.verified && (
                            <Button size="sm" onClick={() => openConfirm(r)}>
                              確認済みにする…
                            </Button>
                          )}
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
                <Note>書き出したGeoJSONは、地域のオープンデータサイト等に掲載する想定です（このデモは掲載しません）。</Note>
                <Note>ファイルは端末内で作成し、送信しません。地名に「（架空）」が付く記録は、このデモのための架空の内容です。実際の公開データとしては使わないでください。</Note>
                <Button variant="outline" size="sm" className="border-red-700 text-red-800" disabled={!records.length} onClick={() => setConfirmClear(true)}>
                  この端末の記録を全消去
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        </div>
      </div>

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
    </div>
  )
}
