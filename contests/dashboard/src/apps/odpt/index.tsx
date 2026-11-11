import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { parseHashQuery, withHashQuery } from '@/components/shared/hashState'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { fetchData } from '@/lib/data'
import { Conclusion, type CondState } from './Conclusion'
import { Seg } from './Seg'
import {
  AboutPanel, COLORS, ComparePanel, RegionPanel, StopsPanel, WhatIfPanel, type WhatIfData,
} from './panels'
import {
  DAYS, DAY_FULL, PERIODS, PERIOD_LABEL, cellStatus, fmtMin, indexCells, lastService, lostPopulation, meshBounds, meshCodeAt,
  needLevel, nearbyNodes, parseGsi, parseQuery, regionForPoint, searchStops, shortName, stopLabels, verdict, writeQuery,
  type Day, type Lost, type Period, type RegionData, type RegionIndex,
} from './lib'

type View = { bounds?: [[number, number], [number, number]]; center?: [number, number]; zoom?: number }
type Pt = [number, number]
type Cand = { title: string; lon: number; lat: number; rid: string | null }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const HIDDEN = ['==', 1, 0]
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname) || window.location.protocol === 'file:'
const todayIso = () => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const SOURCES = [
  { name: '公共交通の時刻表（GTFS）', provider: 'GTFSデータリポジトリ／公共交通オープンデータセンター（各事業者）', license: 'フィードごとに CC0 1.0／CC BY 4.0 等（「出典・前提」タブに事業者別の一覧）', url: 'https://www.gtfs-data.jp/', note: '停留所の集約・本数集計・到達時間の計算という加工を行っています。' },
  { name: '人口', provider: '政府統計の総合窓口（e-Stat）令和2年国勢調査 地域メッシュ統計', license: '政府統計の総合窓口の利用規約（出典明記）', url: 'https://www.e-stat.go.jp/', note: '250mメッシュを500mに集約。加工して作成。' },
  { name: '病院・学校・鉄道駅', provider: '国土数値情報（国土交通省）P04-20・P29-21・N02-22', license: '国土数値情報の利用規約（出典明記）', url: 'https://nlftp.mlit.go.jp/ksj/', note: '加工して作成。' },
  { name: '背景地図', provider: '国土地理院 地理院タイル', url: 'https://maps.gsi.go.jp/development/ichiran.html' },
  { name: '住所・駅名の検索', provider: '国土地理院 地名検索API（GETのみ）', url: 'https://msearch.gsi.go.jp/address-search/AddressSearch', note: '検索したときだけ入力文字列を国土地理院へ送ります。' },
]

function readInit() {
  const q = window.location.hash.split('?')[1] ?? ''
  return parseQuery(q)
}

export default function App() {
  const init = useMemo(readInit, [])
  const [index, setIndex] = useState<RegionIndex | null>(null)
  const [regionId, setRegionId] = useState<string>(init.region ?? 'toyama')
  const [data, setData] = useState<RegionData | null>(null)
  const [whatif, setWhatif] = useState<WhatIfData | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [cond, setCond] = useState<CondState>({ fi: init.fi ?? 0, day: init.day ?? 'wd', per: init.per ?? 'm', w: init.w ?? 30 })
  const [pt, setPt] = useState<Pt | null>(null)
  const [placeLabel, setPlaceLabel] = useState('')
  const [route, setRoute] = useState<string | null>(null)
  const [view, setView] = useState<View>({})
  const [vis, setVis] = useState({ cells: true, nodes: true, routes: true, fac: true, rail: true })
  const [tab, setTab] = useState('stops')
  const [query, setQuery] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [cands, setCands] = useState<Cand[]>([])
  const [searching, setSearching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [all, setAll] = useState<RegionData[] | null>(null)
  const [allErr, setAllErr] = useState<string | null>(null)
  const pending = useRef<{ pt: Pt | null; route: string | null }>({ pt: init.pt ?? null, route: init.route ?? null })
  const mapRef = useRef<maplibregl.Map | null>(null)
  const conclusionRef = useRef<HTMLDivElement>(null)
  const reqRef = useRef(0)

  // 地域の一覧
  useEffect(() => {
    fetchData<RegionIndex>('odpt', 'index.json').then(setIndex).catch((e: Error) => setLoadErr(e.message))
  }, [])

  // 地域のデータ（地域を切り替えた時に読み込む）
  useEffect(() => {
    if (!index) return
    const id = index.regions.some((r) => r.id === regionId) ? regionId : index.regions[0].id
    if (id !== regionId) { setRegionId(id); return }
    const req = ++reqRef.current
    setLoadErr(null)
    Promise.all([
      fetchData<RegionData>('odpt', `${id}.json`),
      fetchData<WhatIfData>('odpt', `whatif_${id}.json`).catch(() => null),
    ]).then(([d, w]) => {
      if (req !== reqRef.current) return
      const p = pending.current
      pending.current = { pt: null, route: null }
      setData(d)
      setWhatif(w)
      setCond((c) => ({
        ...c,
        fi: c.fi >= d.facility_order.length ? 0 : c.fi,
        w: d.params.thresholds.includes(c.w) ? c.w : d.params.thresholds[0],
      }))
      setPt(p.pt)
      if (!p.pt) setPlaceLabel('')
      setRoute(p.route != null && w?.routes[p.route] && d.routes[+p.route] ? p.route : null)
      if (p.pt) setView({ center: p.pt, zoom: 14 })
      else setView({ bounds: [[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[3]]] })
    }).catch((e: Error) => { if (req === reqRef.current) setLoadErr(e.message) })
  }, [index, regionId])

  const cellIdx = useMemo(() => (data ? indexCells(data.cells) : {}), [data])
  const need = data ? needLevel(data.params.thresholds, cond.w) : 0

  // 共有リンク（URLのハッシュに状態を反映）
  const queryStr = useMemo(
    () => (data ? writeQuery({ region: data.id, fi: cond.fi, day: cond.day, per: cond.per, w: cond.w, route, pt }) : ''),
    [data, cond, route, pt],
  )
  useEffect(() => {
    if (!queryStr) return
    const params = new URLSearchParams(queryStr)
    const next = withHashQuery(window.location.hash || '#/apps/odpt', params)
    window.history.replaceState(null, '', window.location.pathname + window.location.search + next)
  }, [queryStr])
  const shareUrl = useMemo(() => {
    const path = (window.location.hash || '#/apps/odpt').split('?')[0]
    return `${window.location.origin}${window.location.pathname}${window.location.search}${path}?${queryStr}`
  }, [queryStr])

  // 路線を止めたら？
  const impact = useMemo(() => {
    const out: Record<string, Lost> = {}
    if (!data || !whatif) return out
    for (const r of Object.keys(whatif.routes)) out[r] = lostPopulation(data.cells, whatif.routes[r], cond.fi, cond.day, cond.per, need)
    return out
  }, [data, whatif, cond, need])
  const lostIdx = route && impact[route] ? impact[route].idx : null

  const selectRoute = useCallback((r: string | null) => {
    setRoute(r)
    if (r == null || !data || !whatif) return
    const bb = [180, 90, -180, -90]
    const ext = (x: number, y: number) => { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y) }
    const im = lostPopulation(data.cells, whatif.routes[r], cond.fi, cond.day, cond.per, need)
    Object.keys(im.idx).forEach((k) => { const b = meshBounds(data.cells[+k][0]); ext(b[0], b[1]); ext(b[2], b[3]) })
    if (bb[0] > bb[2]) data.patterns.filter((p) => String(p[0]) === r).forEach((p) => p[1].forEach((i) => ext(data.nodes[i][0], data.nodes[i][1])))
    if (bb[0] <= bb[2]) setView({ bounds: [[bb[0], bb[1]], [bb[2], bb[3]]] })
  }, [data, whatif, cond, need])

  // 選んだ地点の診断
  const diag = useMemo(() => {
    if (!data || !pt) return null
    const code = meshCodeAt(pt[0], pt[1])
    const ci = cellIdx[code]
    const cell = ci != null ? data.cells[ci] : null
    const v = verdict(cell, {
      fi: cond.fi, day: cond.day, per: cond.per, w: cond.w, thresholds: data.params.thresholds, startHours: data.params.start_hours,
      facLabel: data.facility_labels[data.facility_order[cond.fi]],
    })
    const near = nearbyNodes(data.nodes, pt[0], pt[1], data.params.walk_in_m, 6)
    return { cell, v, near, labels: stopLabels(data.nodes, near, data.routes), lastWd: lastService(data.nodes, near, 'wd'), lastHol: lastService(data.nodes, near, 'hol') }
  }, [data, pt, cellIdx, cond])

  const copyText = useMemo(() => {
    if (!diag || !data) return ''
    const fmtLast = (l: ReturnType<typeof lastService>) => (l ? `${fmtMin(l.t)}（${l.name}・約${l.m}m）` : '運行なし')
    const lines = [
      `【生活アクセス診断】${placeLabel || '選んだ地点'}（${shortName(data.name)}）`,
      diag.v ? `${diag.v.main}。${diag.v.cmp}${diag.v.extra}` : 'この地点は診断範囲外です（停留所から遠い、または人口データなし）。',
      diag.near.length
        ? `近くの停留所の最終便（${data.params.walk_in_m}m以内）: 平日 ${fmtLast(diag.lastWd)}／休日（日曜ダイヤ） ${fmtLast(diag.lastHol)}`
        : `${data.params.walk_in_m}m以内に停留所がありません。`,
      shareUrl + (isLocal() ? '\n※いまは手元の確認用アドレスです。公開後のアドレスで共有してください。' : ''),
      '（生活アクセス診断マップ。時刻表データによる推計で、実際の運行を保証するものではありません）',
    ]
    return lines.join('\n')
  }, [diag, data, placeLabel, shareUrl])

  const writeClipboard = useCallback(async (text: string, ok: () => void) => {
    const fallback = () => {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      let done = false
      try { done = document.execCommand('copy') } catch { /* 下で通知 */ }
      ta.remove()
      if (done) ok()
      else {
        const pv = document.getElementById('odpt-copy-preview') as HTMLTextAreaElement | null
        pv?.focus(); pv?.select()
        toast.error('自動でコピーできませんでした。下の文面を選択しました。Ctrl+C（スマホは長押し）でコピーしてください')
      }
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallback)
    else fallback()
  }, [])

  const onCopy = useCallback(() => {
    writeClipboard(copyText, () => { setCopied(true); toast.success('結論とリンクをコピーしました'); setTimeout(() => setCopied(false), 3000) })
  }, [copyText, writeClipboard])
  useEffect(() => { setCopied(false) }, [copyText])

  // 地点の選択・移動
  const showConclusion = () => setTimeout(() => conclusionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50)
  const choosePoint = useCallback((lon: number, lat: number, label: string, zoomTo: boolean) => {
    setPt([lon, lat])
    setPlaceLabel(label)
    setTab('stops')
    if (zoomTo) mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 500 })
    showConclusion()
  }, [])

  const goCand = useCallback((c: Cand) => {
    if (!c.rid) return
    setSearchMsg(`「${c.title}」を調べました。結論は上の「この地点の結論」に出ています。`)
    if (data && c.rid === data.id) choosePoint(c.lon, c.lat, c.title, true)
    else {
      pending.current = { pt: [c.lon, c.lat], route: null }
      setPlaceLabel(c.title)
      setRegionId(c.rid)
      showConclusion()
    }
  }, [data, choosePoint])

  const doSearch = useCallback(async (qraw: string) => {
    const q = qraw.trim()
    if (!q) { setSearchMsg('住所や駅名を入力してください。'); return }
    if (!index) return
    setSearching(true); setSearchMsg('検索中…'); setCands([])
    let rs: Cand[] = []
    let failed = false
    try {
      const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q))
      if (!r.ok) throw new Error('status ' + r.status)
      rs = parseGsi(await r.json()).map((h) => ({ ...h, rid: regionForPoint(index.regions, h.lon, h.lat) }))
    } catch { failed = true }
    const cur = data?.id
    rs = rs.map((r, i) => ({ r, k: (r.rid === cur ? 0 : r.rid ? 1 : 2) * 10000 + i })).sort((a, b) => a.k - b.k).map((x) => x.r).slice(0, 5)
    // 地名検索で見つからない／接続できないときは、読み込み済みの地域の停留所名から探す
    if (!rs.some((r) => r.rid) && data) {
      searchStops(data.nodes, q.replace(/^.*[都道府県市区町村]/, '') || q).forEach((s) => {
        rs.push({ title: `${s.name}（停留所）`, lon: data.nodes[s.i][0], lat: data.nodes[s.i][1], rid: data.id })
      })
    }
    setSearching(false)
    const first = rs.find((r) => r.rid)
    if (!first) {
      setSearchMsg(failed
        ? '検索できませんでした（国土地理院の地名検索に接続できません）。ネットワークを確認するか、地図をタップして地点を選んでください。'
        : rs.length
          ? `見つかった場所（${rs[0].title}）は、収録している5地域（${index.regions.map((x) => shortName(x.name)).join('・')}）の範囲外です。`
          : `「${q}」に該当する場所が見つかりませんでした。`)
      return
    }
    goCand(first)
    setCands(rs.filter((r) => r !== first))
  }, [index, data, goCand])

  const onMapClick = useCallback(({ lng, lat }: { lng: number; lat: number }) => {
    setSearchMsg('地図で選んだ地点を調べました。結果は上の「この地点の結論」に出ています。')
    setCands([])
    choosePoint(lng, lat, '', false)
  }, [choosePoint])

  const onExample = () => {
    setQuery('富山市大町')
    if (regionId !== 'toyama') { pending.current = { pt: null, route: null }; setRegionId('toyama') }
    doSearch('富山市大町')
  }

  // 5地域比較: タブを開いた時に全地域を読み込む
  useEffect(() => {
    if (tab !== 'compare' || all || !index) return
    Promise.all(index.regions.map((r) => fetchData<RegionData>('odpt', `${r.id}.json`))).then(setAll).catch((e: Error) => setAllErr(e.message))
  }, [tab, all, index])

  // ---------- 地図レイヤー ----------
  const staticGeo = useMemo(() => {
    if (!data) return null
    return {
      nodes: { type: 'FeatureCollection', features: data.nodes.map((n, i) => ({ type: 'Feature', properties: { i, wd: n[3][3], hol: n[4][3] }, geometry: { type: 'Point', coordinates: [n[0], n[1]] } })) } as GeoJSON.FeatureCollection,
      routes: { type: 'FeatureCollection', features: data.patterns.map((p) => ({ type: 'Feature', properties: { r: p[0] }, geometry: { type: 'LineString', coordinates: p[1].map((i) => [data.nodes[i][0], data.nodes[i][1]]) } })) } as GeoJSON.FeatureCollection,
      rail: { type: 'FeatureCollection', features: (data.rail ?? []).map((r) => ({ type: 'Feature', properties: { name: r[2], op: r[3] }, geometry: { type: 'Point', coordinates: [r[0], r[1]] } })) } as GeoJSON.FeatureCollection,
    }
  }, [data])
  const cellGeo = useMemo(() => {
    if (!data) return EMPTY
    return {
      type: 'FeatureCollection',
      features: data.cells.map((c, k) => {
        const b = meshBounds(c[0])
        return {
          type: 'Feature',
          properties: { st: lostIdx && lostIdx[k] ? 'lost' : cellStatus(c, cond.fi, cond.day, cond.per, need), pop: c[1] },
          geometry: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] },
        }
      }),
    } as GeoJSON.FeatureCollection
  }, [data, cond, need, lostIdx])
  const facGeo = useMemo(() => {
    if (!data) return EMPTY
    const key = data.facility_order[cond.fi]
    return { type: 'FeatureCollection', features: data.facilities[key].map((f) => ({ type: 'Feature', properties: { t: key, name: f[2] }, geometry: { type: 'Point', coordinates: [f[0], f[1]] } })) } as GeoJSON.FeatureCollection
  }, [data, cond.fi])
  const hlGeo = useMemo(() => {
    if (!data || !diag) return EMPTY
    const rs = new Set<number>()
    diag.near.forEach((o) => data.nodes[o.i][5].forEach((r) => rs.add(r)))
    return { type: 'FeatureCollection', features: data.patterns.filter((p) => rs.has(p[0])).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p[1].map((i) => [data.nodes[i][0], data.nodes[i][1]]) } })) } as GeoJSON.FeatureCollection
  }, [data, diag])
  const wiGeo = useMemo(() => {
    if (!data || !route) return EMPTY
    return { type: 'FeatureCollection', features: data.patterns.filter((p) => String(p[0]) === route).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p[1].map((i) => [data.nodes[i][0], data.nodes[i][1]]) } })) } as GeoJSON.FeatureCollection
  }, [data, route])
  const ptGeo = useMemo(
    () => (pt ? ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } }] } as GeoJSON.FeatureCollection) : EMPTY),
    [pt],
  )

  const layers = useMemo<MapLayer[]>(() => {
    if (!data || !staticGeo) return []
    const f = (on: boolean) => (on ? undefined : HIDDEN)
    const facKey = data.facility_order[cond.fi]
    return [
      { id: 'cells', type: 'fill', data: cellGeo, filter: f(vis.cells), paint: {
        'fill-color': ['match', ['get', 'st'], 'walk', COLORS.walk, 'transit', COLORS.transit, 'lost', COLORS.lost, 'rail', COLORS.rail, COLORS.none],
        'fill-opacity': ['case', ['==', ['get', 'st'], 'lost'], 0.95, ['interpolate', ['linear'], ['get', 'pop'], 0, 0.3, 50, 0.45, 300, 0.65]],
        'fill-outline-color': 'rgba(255,255,255,0.35)' } },
      { id: 'routes', type: 'line', data: staticGeo.routes, filter: f(vis.routes), paint: { 'line-color': '#444', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 14, 1.8], 'line-opacity': 0.5 } },
      { id: 'routes-hl', type: 'line', data: hlGeo, filter: f(vis.routes), paint: { 'line-color': '#1b4f8a', 'line-width': 3.5, 'line-opacity': 0.9 } },
      { id: 'routes-wi', type: 'line', data: wiGeo, filter: f(vis.routes), paint: { 'line-color': '#B03A8C', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } },
      { id: 'nodes', type: 'circle', data: staticGeo.nodes, filter: f(vis.nodes), paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 13, 3.5, 16, 7],
        'circle-color': ['step', ['get', cond.day], '#9e9e9e', 1, '#fdd49e', 6, '#fdbb84', 16, '#fc8d59', 41, '#e34a33', 101, '#b30000'],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 0.8 } },
      { id: 'rail', type: 'circle', data: staticGeo.rail, filter: f(vis.rail), paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 5], 'circle-color': '#fff', 'circle-stroke-color': '#555', 'circle-stroke-width': 1.6 } },
      { id: 'fac', type: 'circle', data: facGeo, filter: f(vis.fac), paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 7],
        'circle-color': facKey === 'hospital' ? '#8e24aa' : '#f9a825', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } },
      { id: 'pt', type: 'circle', data: ptGeo, paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-color': '#000000', 'circle-stroke-width': 4 } },
    ]
  }, [data, staticGeo, cellGeo, facGeo, hlGeo, wiGeo, ptGeo, vis, cond.day, cond.fi])

  const regionList = index?.regions ?? []
  const facLabel = data?.facility_labels[data.facility_order[cond.fi]] ?? ''
  const exampleFor: Record<string, string> = { kumamoto: '熊本駅、熊本市中央区水前寺', toyama: '富山駅、富山市大町', tokushima: '徳島駅、徳島市幸町', iida: '飯田駅、飯田市主税町', tokyo: '王子駅、北区赤羽' }

  const setC = (p: Partial<CondState>) => setCond((c) => ({ ...c, ...p }))

  // 診断範囲の注記・データ期限
  const dataWarn = useMemo(() => {
    if (!data) return ''
    const iso = todayIso()
    const expired = data.feeds.filter((f) => f.valid[1] && f.valid[1] < iso)
    const soon = data.feeds.filter((f) => f.valid[1] && f.valid[1] >= iso && f.valid[1] < data.public_until)
    if (expired.length) return `有効期間が切れたデータが${expired.length}件あります（${expired.map((f) => `${f.org} ${f.valid[1]}`).slice(0, 3).join('、')}${expired.length > 3 ? ' ほか' : ''}）。ダイヤが変わっている可能性があり、この診断は現在の運行を示しません。`
    if (soon.length) return `${soon.length}件のデータは${soon.map((f) => f.valid[1]!).sort()[0]}から順に有効期間が終わります。切れた後は最新のGTFSで作り直す必要があります。`
    return ''
  }, [data])

  if (loadErr && !data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader appId="odpt" />
        <Alert variant="destructive">
          <AlertTitle>診断データを表示できませんでした</AlertTitle>
          <AlertDescription>
            通信の不調や、古い画面が残っていることが原因の場合があります。<Button size="sm" className="ml-2" onClick={() => window.location.reload()}>ページを読み込み直す</Button>
            <span className="mt-1 block text-xs">詳細: {loadErr}</span>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  const bounds = view.bounds

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader appId="odpt" actions={<SourceDialog sources={SOURCES} />} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* 1. 場所と条件 */}
        <Card className="min-w-0 gap-3 py-4 lg:col-start-1 lg:row-start-1">
          <CardHeader className="px-4">
            <CardTitle className="text-base">1. 場所を選ぶ　2. 条件を選ぶ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4">
            <div className="space-y-1">
              <div className="text-sm font-medium" id="odpt-region">診断地域（いまの地域: <b>{data ? shortName(data.name) : '読み込み中'}</b>）</div>
              <Seg
                label="診断地域"
                value={regionId}
                options={regionList.map((r) => ({ value: r.id, label: shortName(r.name) }))}
                onChange={(id) => { pending.current = { pt: null, route: null }; setPt(null); setPlaceLabel(''); setRegionId(id) }}
              />
              {data && <p className="text-xs text-muted-foreground">{data.reason}</p>}
            </div>
            <form
              role="search"
              className="space-y-1"
              onSubmit={(e) => { e.preventDefault(); doSearch(query) }}
            >
              <label htmlFor="odpt-q" className="text-sm font-medium">住所・駅名で探す（または地図をタップ）</label>
              <div className="flex gap-2">
                <Input id="odpt-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} autoComplete="off"
                  placeholder={`例: ${exampleFor[regionId] ?? '駅名や住所'}`} />
                <Button type="submit" disabled={searching || !index}><Search className="size-4" />探す</Button>
              </div>
              <div className="text-sm" aria-live="polite" data-testid="search-msg">
                {searchMsg}
                {cands.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-xs text-muted-foreground">他の候補:</span>
                    {cands.map((c, i) => (
                      <Button key={i} type="button" size="sm" variant="outline" disabled={!c.rid} onClick={() => goCand(c)}>
                        {c.title}{c.rid ? '' : '（収録範囲外）'}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </form>
            {data && (
              <div className="space-y-2 border-t pt-3">
                <div className="grid grid-cols-[4.5rem_1fr] items-start gap-x-2 gap-y-2 text-sm">
                  <span className="pt-2 font-medium">行き先</span>
                  <Seg label="行き先" value={cond.fi} options={data.facility_order.map((k, i) => ({ value: i, label: data.facility_labels[k] }))} onChange={(fi) => setC({ fi })} />
                  <span className="pt-2 font-medium">曜日</span>
                  <Seg label="曜日" value={cond.day} options={DAYS.map((k) => ({ value: k as Day, label: DAY_FULL[k] }))} onChange={(day) => setC({ day })} />
                  <span className="pt-2 font-medium">出発</span>
                  <Seg label="出発時刻" value={cond.per} options={PERIODS.map((k) => ({ value: k as Period, label: `${PERIOD_LABEL[k]}${data.params.start_hours[k]}時` }))} onChange={(per) => setC({ per })} />
                  <span className="pt-2 font-medium">許容時間</span>
                  <Seg label="許容時間" value={cond.w} options={data.params.thresholds.map((w) => ({ value: w, label: `${w}分以内` }))} onChange={(w) => setC({ w })} />
                </div>
                <p className="text-xs text-muted-foreground">平日＝水曜のダイヤ、休日＝日曜のダイヤで計算（祝日・臨時ダイヤは未反映）。</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3. 結論 */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <Conclusion
            ref={conclusionRef}
            data={data}
            cond={cond}
            hasPoint={Boolean(pt) && Boolean(data)}
            placeLabel={placeLabel}
            verdict={diag?.v ?? null}
            popInfo={diag?.cell ? { pop: diag.cell[1], pop65: diag.cell[2] } : null}
            lastWd={diag?.lastWd ?? null}
            lastHol={diag?.lastHol ?? null}
            nearest={diag && data && diag.near[0] ? { name: diag.labels[0], m: Math.round(diag.near[0].d), wd: data.nodes[diag.near[0].i][3], hol: data.nodes[diag.near[0].i][4] } : null}
            nearCount={diag?.near.length ?? 0}
            walkInM={data?.params.walk_in_m ?? 600}
            copyText={copyText}
            onCopy={onCopy}
            copied={copied}
            onExample={onExample}
            loading={!data || searching}
          />
        </div>

        {/* 地図 */}
        <div className="min-w-0 space-y-2 lg:col-start-1 lg:row-start-2">
          {!data ? (
            <Skeleton className="h-[360px] w-full lg:h-[520px]" />
          ) : (
            <MapView
              className="h-[380px] lg:h-[520px]"
              center={view.center ?? data.center}
              zoom={view.zoom ?? 10}
              bounds={bounds}
              layers={layers}
              onClick={onMapClick}
              onMapReady={(m) => {
                mapRef.current = m
                // 親の幅が後から決まっても地図がはみ出さない・欠けないようにする
                new ResizeObserver(() => m.resize()).observe(m.getContainer())
              }}
              attribution="国勢調査・国土数値情報・各事業者GTFS（加工して作成）"
              ariaLabel="診断マップ（地図をタップするとその地点を診断します）"
            />
          )}
          <Card className="gap-2 py-3">
            <CardContent className="space-y-2 px-4 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1" role="group" aria-label="表示切替">
                {([['cells', '診断メッシュ'], ['nodes', '停留所（本数）'], ['routes', '路線'], ['fac', `施設（${facLabel || '病院'}）`], ['rail', '鉄道駅（未収録）']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center gap-1.5 text-sm">
                    <Checkbox checked={vis[k]} onCheckedChange={(c) => setVis((v) => ({ ...v, [k]: c === true }))} />{l}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <b>メッシュ（500m四方）の色</b>
                <Sw c={COLORS.walk} l="歩いて行ける" /><Sw c={COLORS.transit} l="公共交通で行ける" /><Sw c={COLORS.none} l="行けない" />
                <Sw c={COLORS.rail} l="鉄道駅が近い（未評価）" />{lostIdx && <Sw c={COLORS.lost} l="路線を止めると行けなくなる" />}
                <span className="text-muted-foreground">濃いほど人口が多い</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <b>停留所の色（1日の発車本数）</b>
                {[['#9e9e9e', '0'], ['#fdd49e', '1-5'], ['#fdbb84', '6-15'], ['#fc8d59', '16-40'], ['#e34a33', '41-100'], ['#b30000', '101+']].map(([c, l]) => <Sw key={l} c={c} l={l} round />)}
                <Sw c={facLabel === '病院' || !facLabel ? '#8e24aa' : '#f9a825'} l={facLabel || '病院'} round />
                <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-black bg-white" />選んだ地点</span>
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                <li>メッシュ: 地図を約500m四方に区切った区画。人口はこの単位で数えています。</li>
                <li>GTFS: バスなどの時刻表・停留所を、決まった形式で公開したオープンデータ。</li>
                <li>行けない: 歩いても、収録した公共交通でも許容時間内に着けない（未収録の便は含まない）。</li>
              </ul>
            </CardContent>
          </Card>
          {data && (
            <Alert>
              <AlertTitle>診断の範囲（実データ・収録した範囲のみ）</AlertTitle>
              <AlertDescription className="block">
                収録しているのは{data.coverage.sources.join('・')}のGTFS {data.coverage.feeds}件（{data.coverage.modes.join('・')}）のみ。
                {data.coverage.modes.filter((m) => m !== 'バス').length ? `鉄道は${data.coverage.modes.filter((m) => m !== 'バス').join('・')}のみ収録し、JR等そのほかの鉄道は未収録です。` : '鉄道（JR等）は未収録です。'}
                デマンド交通・予約制の便も未収録です。
                {data.coverage.rail_checked && ` 未収録の鉄道の駅から徒歩${data.params.rail_walk_min}分圏で行けない地区は、赤ではなく灰色「鉄道駅が近い（未評価）」にしています。`}
                {dataWarn && <b className="mt-1 block text-orange-800">データの期限: {dataWarn}</b>}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* 詳細タブ */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-2">
          <Tabs value={tab} onValueChange={setTab}>
            <div className="overflow-x-auto">
              <TabsList className="w-max">
                <TabsTrigger value="stops">近くの停留所</TabsTrigger>
                <TabsTrigger value="region">地域全体</TabsTrigger>
                <TabsTrigger value="whatif">路線を止めたら？</TabsTrigger>
                <TabsTrigger value="compare">5地域比較</TabsTrigger>
                <TabsTrigger value="about">出典・前提</TabsTrigger>
              </TabsList>
            </div>
            {!data ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <>
                <TabsContent value="stops"><StopsPanel data={data} cond={cond} cell={diag?.cell ?? null} near={diag?.near ?? []} labels={diag?.labels ?? []} /></TabsContent>
                <TabsContent value="region"><RegionPanel data={data} cond={cond} /></TabsContent>
                <TabsContent value="whatif"><WhatIfPanel data={data} whatif={whatif} cond={cond} route={route} onRoute={selectRoute} impact={impact} /></TabsContent>
                <TabsContent value="compare">
                  {index && <ComparePanel index={index} all={all} cond={cond} data={data} loading={!all && !allErr} error={allErr} />}
                </TabsContent>
                <TabsContent value="about">
                  <AboutPanel data={data} url={isLocal() ? '公開URLをここに記入' : shareUrl.replace(/[#?].*$/, '')} date={todayIso()}
                    onCopyCite={(t) => writeClipboard(t, () => toast.success('出典の例文をコピーしました'))} />
                </TabsContent>
              </>
            )}
          </Tabs>
          <p className="mt-3 text-xs text-muted-foreground">
            この画面の状態（地域・行き先・曜日・時間帯・許容時間・選んだ路線・調べた地点）は、ブラウザのアドレス欄のリンクに入っています。
          </p>
        </div>
      </div>
    </div>
  )
}

function Sw({ c, l, round }: { c: string; l: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block size-3 border border-black/30 ${round ? 'rounded-full' : 'rounded-sm'}`} style={{ background: c }} />{l}
    </span>
  )
}
