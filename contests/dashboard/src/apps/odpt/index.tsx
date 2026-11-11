import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { MapView, type MapLayer } from '@/components/shared/MapView'
import { useAppSteps } from '@/components/shared/AppSteps'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { parseHashQuery, withHashQuery } from '@/components/shared/hashState'
import { StepLayout } from '@/components/shared/StepLayout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchData } from '@/lib/data'
import { CopyPanel, HolPanel, LastPanel, MapSummary, NoPoint, VerdictPanel, type CondState, type DiagView } from './Conclusion'
import { Seg } from './Seg'
import { TIPS, Term } from './Term'
import {
  AboutPanel, COLORS, ComparePanel, RegionPanel, StopsPanel, WhatIfPanel, type WhatIfData,
} from './panels'
import {
  distM, condIndex, levelLabel, DAYS, DAY_FULL, PERIODS, PERIOD_LABEL, cellStatus, fmtMin, indexCells, lastService, lostPopulation, meshBounds, meshCodeAt,
  needLevel, nearbyNodes, parseGsi, parseQuery, regionForPoint, searchStops, shortName, stopLabels, verdict, writeQuery,
  type Day, type Lost, type Period, type RegionData, type RegionIndex,
} from './lib'

type View = { bounds?: [[number, number], [number, number]]; center?: [number, number]; zoom?: number }
type Pt = [number, number]
type Cand = { title: string; lon: number; lat: number; rid: string | null; inCell?: boolean }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const HIDDEN = ['==', 1, 0]
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname) || window.location.protocol === 'file:'
const todayIso = () => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const STATIONS = [
  { label: '熊本駅', q: '熊本駅' }, { label: '富山駅', q: '富山駅' }, { label: '徳島駅', q: '徳島駅' },
  { label: '飯田駅', q: '飯田駅' }, { label: '王子駅', q: '王子駅' },
]

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
  const [step, setStep] = useState('place')
  const [legendOpen, setLegendOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  const [cands, setCands] = useState<Cand[]>([])
  const [searching, setSearching] = useState(false)
  const [copied, setCopied] = useState(false)
  const [condTouched, setCondTouched] = useState(false)
  const [seen, setSeen] = useState({ pt: '', cmp: false, last: false })
  const [copiedPt, setCopiedPt] = useState('')
  const [all, setAll] = useState<RegionData[] | null>(null)
  const [allErr, setAllErr] = useState<string | null>(null)
  const pending = useRef<{ pt: Pt | null; route: string | null }>({ pt: init.pt ?? null, route: init.route ?? null })
  const mapRef = useRef<maplibregl.Map | null>(null)
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
    const next = withHashQuery(window.location.hash || '#/', params)
    window.history.replaceState(null, '', window.location.pathname + window.location.search + next)
  }, [queryStr])
  const shareUrl = useMemo(() => {
    const path = (window.location.hash || '#/').split('?')[0]
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
    const fk = data.facility_order[cond.fi]
    let facility: { name: string; m: number; min: number } | null = null
    for (const f of data.facilities[fk] ?? []) {
      const d = distM(pt[0], pt[1], f[0], f[1])
      if (!facility || d < facility.m) facility = { name: f[2], m: d, min: 0 }
    }
    if (facility) facility = { name: facility.name, m: Math.round(facility.m), min: Math.max(1, Math.ceil((facility.m * data.params.detour) / data.params.walk_m_per_min)) }
    const lv = cell ? +cell[3][condIndex(cond.fi, cond.day, cond.per)] : 0
    const transitLevel = v && v.status === 'transit' && lv > 0 ? levelLabel(lv, data.params.thresholds) : null
    return { cell, v, near, facility, transitLevel, labels: stopLabels(data.nodes, near, data.routes), lastWd: lastService(data.nodes, near, 'wd'), lastHol: lastService(data.nodes, near, 'hol') }
  }, [data, pt, cellIdx, cond])

  const copyText = useMemo(() => {
    if (!diag || !data) return ''
    const fmtLast = (l: ReturnType<typeof lastService>) => (l ? `${fmtMin(l.t)}（${l.name}・約${l.m}m）` : '運行なし')
    const fl = data.facility_labels[data.facility_order[cond.fi]]
    const n = diag.near[0] ? data.nodes[diag.near[0].i] : null
    const lastTxt = n ? `／最寄りの停留所 ${diag.labels[0]}（約${Math.round(diag.near[0].d)}m）の最終 平日 ${n[3][3] > 0 ? fmtMin(n[3][5]) : '運行なし'}・休日 ${n[4][3] > 0 ? fmtMin(n[4][5]) : '運行なし'}` : ''
    const lines = [
      diag.v
        ? `【${placeLabel || '選んだ地点'}から${fl}へ】${DAY_FULL[cond.day]}${PERIOD_LABEL[cond.per]}${data.params.start_hours[cond.per]}時発・${cond.w}分以内: ${diag.v.yesNo}。${DAY_FULL[diag.v.otherDay]}は ${diag.v.otherYesNo}${lastTxt}`
        : `【${placeLabel || '選んだ地点'}】診断範囲外です（停留所から遠い、または人口データなし）`,
      shareUrl,
    ]
    return lines.join('\n')
  }, [diag, data, placeLabel, shareUrl, cond])

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
        toast.error('自動でコピーできませんでした。コピー用の文面を選択しました。Ctrl+C（スマホは長押し）でコピーしてください')
      }
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, fallback)
    else fallback()
  }, [])

  const ptKey = pt ? `${pt[0].toFixed(5)},${pt[1].toFixed(5)}` : ''
  const onCopy = useCallback(() => {
    writeClipboard(copyText, () => { setCopied(true); setCopiedPt(ptKey); toast.success('コピーしました。LINEやメールに貼り付けて送れます'); setTimeout(() => setCopied(false), 3000) })
  }, [copyText, writeClipboard, ptKey])
  useEffect(() => { setCopied(false) }, [copyText])

  // 地点の選択・移動
  const showConclusion = () => {}
  const choosePoint = useCallback((lon: number, lat: number, label: string, zoomTo: boolean) => {
    setPt([lon, lat])
    setPlaceLabel(label)
    if (zoomTo) mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 500 })
    showConclusion()
  }, [])

  const goCand = useCallback((c: Cand) => {
    if (!c.rid) return
    setSearchMsg(`「${c.title}」を調べました。地図の左上に結論の要点を出しました。詳しくは左のサイドバーの「行けるか結論を見る」へ。`)
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
    // 並び順: 選択中の地域で診断できる場所 → 選択中の地域の範囲内 → 他の収録地域 → 範囲外
    rs = rs.map((r) => ({ ...r, inCell: r.rid === cur && cellIdx[meshCodeAt(r.lon, r.lat)] != null }))
    rs = rs.map((r, i) => ({ r, k: (r.rid === cur ? (r.inCell ? 0 : 1) : r.rid ? 2 : 3) * 1e7 + (r.rid === cur && data ? Math.round(distM(r.lon, r.lat, data.center[0], data.center[1])) : i) })).sort((a, b) => a.k - b.k).map((x) => x.r).slice(0, 6)
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
    const others = rs.filter((r) => r !== first)
    setCands(others)
    if (others.length && !(first.rid === cur && !first.inCell)) {
      setSearchMsg(`「${first.title}」を調べました（結論の要点は地図の左上）。同じ名前の候補が他にもあります。場所が違う場合は、下の候補から選んでください。`)
    }
    if (first.rid === cur && !first.inCell) {
      setSearchMsg(`「${first.title}」は診断範囲外でした。別の地域の「${q}」かもしれません。${others.length ? '下の候補から選んでください。' : ''}`)
    }
  }, [index, data, goCand, cellIdx])

  const onMapClick = useCallback(({ lng, lat }: { lng: number; lat: number }) => {
    setSearchMsg('地図で選んだ地点を調べました。地図の左上に結論の要点を出しました。詳しくは左のサイドバーの「行けるか結論を見る」へ。')
    setCands([])
    choosePoint(lng, lat, '', false)
  }, [choosePoint])

  const onStation = (q: string) => {
    setQuery(q)
    doSearch(q)
  }

  // 5地域比較: タブを開いた時に全地域を読み込む
  useEffect(() => {
    if (step !== 'compare' || all || !index) return
    Promise.all(index.regions.map((r) => fetchData<RegionData>('odpt', `${r.id}.json`))).then(setAll).catch((e: Error) => setAllErr(e.message))
  }, [step, all, index])

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
  const exampleFor: Record<string, string> = { kumamoto: '熊本駅', toyama: '富山駅', tokushima: '徳島駅', iida: '飯田駅', tokyo: '王子駅' }

  const setC = (p: Partial<CondState>) => { setCondTouched(true); setCond((c) => ({ ...c, ...p })) }

  // ---- 左サイドバー（手順）。メインには選んだ手順の内容だけを出す。done は画面の状態・実際の操作で判定する ----
  const hasPt = Boolean(pt && data)
  const verdictShown = hasPt && diag?.v != null
  // 「比べた」「最終便を見た」は、その手順のパネルを開いた時点で済にする（自動では切り替えない）。地点を変えたらやり直し
  useEffect(() => {
    if (!verdictShown || (step !== 'hol' && step !== 'last')) return
    const k = step === 'hol' ? 'cmp' : 'last'
    setSeen((v) => (v.pt === ptKey ? { ...v, [k]: true } : { pt: ptKey, cmp: false, last: false, [k]: true }))
  }, [step, verdictShown, ptKey])
  const seenHere = seen.pt === ptKey
  const seenCmp = hasPt && seenHere && seen.cmp
  const seenLast = hasPt && seenHere && seen.last
  const condHint = data
    ? `いま: ${DAY_FULL[cond.day]}・${PERIOD_LABEL[cond.per]}${data.params.start_hours[cond.per]}時・${cond.w}分以内・${data.facility_labels[data.facility_order[cond.fi]]}`
    : '行き先・曜日・時刻・許容時間'
  const stepDefs = [
    { id: 'place', title: '場所を決める', hint: '住所・駅名で探す、または地図をタップ', done: hasPt },
    { id: 'cond', title: '条件を確認する', hint: condHint, done: condTouched, optional: true },
    { id: 'verdict', title: '行けるか結論を見る', hint: '行けます／行けません、徒歩か公共交通か', done: verdictShown },
    { id: 'hol', title: '休日（日曜ダイヤ）と比べる', hint: '平日との違いを確認', done: seenCmp || (verdictShown && cond.day === 'hol') },
    { id: 'last', title: '最寄りの停留所の最終便を見る', hint: '停留所名と、平日の最終の時刻', done: seenLast },
    { id: 'copy', title: '結論とリンクをコピーして送る', hint: 'LINEやメールに貼り付けて送れます', done: hasPt && copiedPt === ptKey },
    { id: 'region', title: '参考: 地域全体の集計', hint: '地域の人口に占める割合・65歳以上', done: false, optional: true },
    { id: 'whatif', title: '参考: 路線を止めたら？', hint: '行けなくなる人の数', done: false, optional: true },
    { id: 'compare', title: '参考: 5地域を比べる', hint: '同じ条件で並べる', done: false, optional: true },
    { id: 'about', title: '参考: 出典・前提', hint: 'データの出典・ライセンス・診断の前提', done: false, optional: true },
  ]
  useAppSteps(stepDefs, {
    activeId: step,
    onSelectStep: (id) => { setStep(id); if (id === 'cond') setCondTouched(true) },
    description: '車を運転しない家族が、公共交通か徒歩で病院などへ行けるかを、曜日・時間帯ごとに確かめ、結果を家族に送る。',
  })
  const stepTitle = stepDefs.find((x) => x.id === step)?.title ?? ''

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
  const dv: DiagView | null = data
    ? {
        data, cond, placeLabel, verdict: diag?.v ?? null,
        popInfo: diag?.cell ? { pop: diag.cell[1], pop65: diag.cell[2] } : null,
        lastWd: diag?.lastWd ?? null, lastHol: diag?.lastHol ?? null, nearCount: diag?.near.length ?? 0,
        nearest: diag && diag.near[0] ? { name: diag.labels[0], m: Math.round(diag.near[0].d), wd: data.nodes[diag.near[0].i][3], hol: data.nodes[diag.near[0].i][4] } : null,
        facility: diag?.facility ?? null, transitLevel: diag?.transitLevel ?? null, walkInM: data.params.walk_in_m,
      }
    : null
  const coverageTip = data
    ? `収録しているのは${data.coverage.sources.join('・')}のGTFS ${data.coverage.feeds}件（${data.coverage.modes.join('・')}）のみ。` +
      (data.coverage.modes.filter((m) => m !== 'バス').length ? `鉄道は${data.coverage.modes.filter((m) => m !== 'バス').join('・')}のみ収録し、JR等は未収録。` : '鉄道（JR等）は未収録。') +
      'デマンド交通・予約制の便も未収録です。実データに基づく推計。' + (dataWarn ? `【データの期限】${dataWarn}` : '')
    : '収録した事業者のバスのみが対象です。'
  const needPt = <NoPoint />

  const panel = !data || !dv ? (
    <div className="space-y-3" aria-busy="true" aria-label="読み込み中"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-24 w-full" /></div>
  ) : (
    <>
      {step === 'place' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-medium" id="odpt-region">診断地域（いま: <b>{shortName(data.name)}</b>）</div>
            <Seg
              label="診断地域"
              value={regionId}
              options={regionList.map((r) => ({ value: r.id, label: shortName(r.name) }))}
              onChange={(id) => { pending.current = { pt: null, route: null }; setPt(null); setPlaceLabel(''); setRegionId(id) }}
            />
            <p className="text-xs text-muted-foreground">{data.reason}</p>
          </div>
          <form role="search" className="space-y-1" onSubmit={(e) => { e.preventDefault(); doSearch(query) }}>
            <label htmlFor="odpt-q" className="text-sm font-medium">住所・駅名で探す（または地図をタップ）</label>
            <div className="flex gap-2">
              <Input id="odpt-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={80} autoComplete="off"
                placeholder={`例: ${exampleFor[regionId] ?? '駅名や住所'}`} />
              <Button type="submit" disabled={searching || !index}><Search className="size-4" />探す</Button>
            </div>
            <div className="text-sm" aria-live="polite" data-testid="search-msg">
              {searchMsg}
              {cands.length > 0 && (
                <div className="mt-2 space-y-1.5" data-testid="cands">
                  <p className="text-sm font-medium">他の候補（押すと、その場所を診断します）</p>
                  {cands.map((c, i) => (
                    <Button key={i} type="button" variant="outline" disabled={!c.rid} onClick={() => goCand(c)}
                      className="h-auto w-full justify-start whitespace-normal py-2 text-left text-sm">
                      {c.title}{c.rid ? (c.rid === data.id && !c.inCell ? '（診断範囲外）' : `（${shortName(index?.regions.find((x) => x.id === c.rid)?.name ?? '')}）`) : '（収録範囲外）'}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </form>
          {!hasPt && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">駅名の例:</span>
              {STATIONS.map((st) => (
                <Button key={st.q} variant="outline" size="sm" onClick={() => onStation(st.q)} disabled={searching}>{st.label}</Button>
              ))}
            </div>
          )}
        </div>
      )}
      {step === 'cond' && (
        <div className="space-y-2">
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
          <p className="text-xs text-muted-foreground">平日＝水曜のダイヤ、休日＝日曜のダイヤで計算（祝日・臨時ダイヤは未反映）。初期値のままで、平日の朝に30分以内で病院へ行けるかを調べられます。</p>
        </div>
      )}
      {step === 'verdict' && (hasPt ? <VerdictPanel d={dv} /> : needPt)}
      {step === 'hol' && (hasPt ? <HolPanel d={dv} /> : needPt)}
      {step === 'last' && (hasPt ? (
        <div className="space-y-4">
          <LastPanel d={dv} />
          <StopsPanel data={data} cond={cond} cell={diag?.cell ?? null} near={diag?.near ?? []} labels={diag?.labels ?? []} />
        </div>
      ) : needPt)}
      {step === 'copy' && (hasPt ? <CopyPanel copyText={copyText} onCopy={onCopy} copied={copied} isLocal={isLocal()} /> : needPt)}
      {step === 'region' && <RegionPanel data={data} cond={cond} />}
      {step === 'whatif' && <WhatIfPanel data={data} whatif={whatif} cond={cond} route={route} onRoute={selectRoute} impact={impact} />}
      {step === 'compare' && index && <ComparePanel index={index} all={all} cond={cond} data={data} loading={!all && !allErr} error={allErr} />}
      {step === 'about' && (
        <AboutPanel data={data} url={isLocal() ? '公開URLをここに記入' : shareUrl.replace(/[#?].*$/, '')} date={todayIso()}
          onCopyCite={(t) => writeClipboard(t, () => toast.success('出典の例文をコピーしました'))} />
      )}
    </>
  )

  const facLabel2 = facLabel || '病院'
  const mapAside = (
    <div className="relative h-full w-full">
      {!data ? (
        <Skeleton className="h-full w-full" />
      ) : (
        <MapView
          className="h-full w-full"
          center={view.center ?? data.center}
          zoom={view.zoom ?? 10}
          bounds={bounds}
          layers={layers}
          onClick={onMapClick}
          onMapReady={(m) => {
            mapRef.current = m
            new ResizeObserver(() => m.resize()).observe(m.getContainer())
          }}
          attribution="国勢調査・国土数値情報・各事業者GTFS（加工して作成）"
          ariaLabel="診断マップ（地図をタップするとその地点を診断します）"
        />
      )}
      <MapSummary d={dv} hasPoint={hasPt} />
      <div className="absolute bottom-7 left-2 z-10 max-w-[calc(100%-1rem)]">
        {legendOpen ? (
          <div className="max-h-[50vh] w-72 max-w-full space-y-1.5 overflow-y-auto rounded-md border bg-white/95 p-2 text-xs shadow" data-testid="legend">
            <div className="flex items-center justify-between"><b>凡例・表示切替</b><Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setLegendOpen(false)}>閉じる</Button></div>
            <div className="flex flex-wrap gap-x-3 gap-y-1" role="group" aria-label="表示切替">
              {([['cells', '診断エリア'], ['nodes', '停留所'], ['routes', '路線'], ['fac', `施設（${facLabel2}）`], ['rail', '鉄道駅（未収録）']] as const).map(([k, l]) => (
                <label key={k} className="flex items-center gap-1.5">
                  <Checkbox checked={vis[k]} onCheckedChange={(c) => setVis((v) => ({ ...v, [k]: c === true }))} />{l}
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>エリア（<Term tip={TIPS.mesh}>約500m四方</Term>）</b>
              <Sw c={COLORS.walk} l="歩いて行ける" /><Sw c={COLORS.transit} l="公共交通で行ける" /><Sw c={COLORS.none} l="行けない" />
              <Sw c={COLORS.rail} l="鉄道駅が近い（未評価）" />{lostIdx && <Sw c={COLORS.lost} l="路線を止めると行けなくなる" />}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <b>停留所（1日の本数）</b>
              {[['#9e9e9e', '0'], ['#fdd49e', '1-5'], ['#fdbb84', '6-15'], ['#fc8d59', '16-40'], ['#e34a33', '41-100'], ['#b30000', '101+']].map(([c, l]) => <Sw key={l} c={c} l={l} round />)}
              <Sw c={facLabel2 === '病院' ? '#8e24aa' : '#f9a825'} l={facLabel2} round />
              <span className="flex items-center gap-1"><span className="inline-block size-3 rounded-full border-2 border-black bg-white" />選んだ地点</span>
            </div>
            <p className="text-muted-foreground"><Term tip={TIPS.gtfs}>GTFS</Term>・<Term tip={TIPS.none}>行けない</Term>の意味は、言葉に触れると表示されます。</p>
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="h-7 border bg-white/95 px-2 text-xs shadow" onClick={() => setLegendOpen(true)}>凡例・表示切替</Button>
        )}
      </div>
    </div>
  )

  return (
    <>
      <PageHeader
        appId="odpt"
        compact
        actions={
          <>
            <Term tip={coverageTip}><Badge variant="outline" className="cursor-help">収録した範囲のバスのみ</Badge></Term>
            <SourceDialog sources={SOURCES} />
          </>
        }
      />
      <StepLayout title={stepTitle} hint={stepDefs.find((x) => x.id === step)?.hint} aside={mapAside}>
        {panel}
      </StepLayout>
    </>
  )
}

function Sw({ c, l, round }: { c: string; l: string; round?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block size-3 border border-black/30 ${round ? 'rounded-full' : 'rounded-sm'}`} style={{ background: c }} />{l}
    </span>
  )
}
