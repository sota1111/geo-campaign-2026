import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getApp } from '@/apps/registry'
import { appUrl, contestUrl, ontologyDataUrl, ontologyFiguresUrl } from '@/lib/data'
import { MARK_WORD } from '@/lib/fit'
import {
  CAT, DEFAULT_SEVERITIES, DEFAULT_TYPES, GATE_TYPES, OPTIONAL_RELS, READINESS_MARK, SHAPE_CLASS, TYPE_STYLE,
  appIdOf, blockerNodeId, buildIndex, buildLanes, contestIdOf, contestOfSubmission, defaultView, impactSet, isGate, neighbors, other, searchNodes, styleOf, visibleEdges, visibleIds,
  type Cat, type GNode, type GraphData, type NextActions, type ViewState,
} from '@/lib/ontology'
import { GraphView } from '@/pages/ontology/GraphView'
import { Lanes } from '@/pages/ontology/Lanes'

const SEVERITIES = ['失格級', '要修正', '軽微']
const btn = 'min-h-9 whitespace-nowrap rounded-md border-2 border-slate-900 bg-white px-2 text-xs font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:border-slate-400 disabled:text-slate-600'
const btnOn = 'min-h-9 whitespace-nowrap rounded-md border-2 border-slate-900 bg-slate-900 px-2 text-xs font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'

type Tab = 'subs' | 'units' | 'gates' | 'impact' | 'types' | 'list'
type Mode = 'lanes' | 'graph'

/** 「2026-11-30T12:00:00+09:00」→「11/30 12:00」 */
export function fmtDue(s: string | null | undefined): string {
  if (!s) return '締切の記録なし'
  const m = /^\d{4}-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(s)
  if (!m) return s
  return `${Number(m[1])}/${Number(m[2])}${m[3] ? ' ' + m[3] : ''}`
}

/** ノードの小さな札（記号・形・種類の言葉）。色だけに頼らない */
function TypeTag({ type }: { type: string }) {
  const st = styleOf(type)
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 text-[11px] font-bold leading-5 ${CAT[st.cat].box} ${SHAPE_CLASS[st.shape]}`}>
      <span aria-hidden>{st.symbol}</span>
      {st.label}
    </span>
  )
}

/** 凡例（図の上に常に出す）。色は種類のまとまり、形・記号・言葉で種類を区別する */
function Legend() {
  const cats = Object.keys(CAT) as Cat[]
  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-1 text-[11px]" aria-label="凡例" data-testid="legend">
      {cats.map((c) => {
        const types = Object.entries(TYPE_STYLE).filter(([, s]) => s.cat === c)
        return (
          <li key={c} className={`inline-flex items-center gap-1 rounded border-2 px-1.5 leading-5 ${CAT[c].box}`}>
            <span aria-hidden className="font-bold">{[...new Set(types.map(([, s]) => s.symbol))].slice(0, 4).join('')}</span>
            <span className="font-bold">{CAT[c].label}</span>
          </li>
        )
      })}
      <li className="text-slate-800">矢印は「から → へ」。形（楕円・四角・破線・二重線）と記号と言葉でも区別</li>
    </ul>
  )
}

export default function OntologyPage() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [na, setNa] = useState<NextActions | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<ViewState>(defaultView)
  const [mode, setMode] = useState<Mode>('lanes')
  const [contestSel, setContestSel] = useState<string>('')
  const [selected, setSelected] = useState<string | null>(null)
  const [centerOn, setCenterOn] = useState<{ ids: string[]; n: number } | null>(null)
  const [tab, setTab] = useState<Tab>('subs')
  const [q, setQ] = useState('')
  const counter = useRef(0)
  const cardTitle = useRef<HTMLHeadingElement>(null)
  const lanesBox = useRef<HTMLDivElement>(null)
  const [focusReq, setFocusReq] = useState(0)

  useEffect(() => {
    let live = true
    Promise.all(['graph.json', 'next-actions.json'].map(async (f) => {
      const r = await fetch(ontologyDataUrl(f))
      if (!r.ok) throw new Error(`${f} を読み込めません（${r.status}）`)
      return r.json()
    }))
      .then(([g, n]) => { if (live) { setGraph(g as GraphData); setNa(n as NextActions) } })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])

  const ix = useMemo(() => (graph ? buildIndex(graph) : null), [graph])
  // 既定のコンペ: 締切がいちばん近い応募のコンペ（next-actions は締切順）
  const firstContest = na?.submissions[0]?.contest ?? 'all'
  const contest = view.impactOf ? 'all' : contestSel || firstContest
  const visible = useMemo(() => (graph && ix ? visibleIds(graph, ix, view, na, selected) : new Set<string>()), [graph, ix, view, na, selected])
  const shownNodes = useMemo(() => (graph ? graph.nodes.filter((n) => visible.has(n.id)) : []), [graph, visible])
  const shownEdges = useMemo(() => (graph ? visibleEdges(graph, visible, view) : []), [graph, visible, view])
  const highlight = useMemo(() => impactSet(na, view.impactOf), [na, view.impactOf])
  const groups = useMemo(() => {
    const gs = ix && na ? buildLanes(ix, na, view, contest) : []
    if (!view.impactOf) return gs
    // 影響を受ける応募を先頭に（画面の外に隠れないように）
    const hit = (id: string) => (highlight.has(id) ? 0 : 1)
    return gs
      .map((g) => ({ ...g, lanes: [...g.lanes].sort((a, b) => hit(a.sub.id) - hit(b.sub.id)) }))
      .sort((a, b) => Math.min(...a.lanes.map((l) => hit(l.sub.id))) - Math.min(...b.lanes.map((l) => hit(l.sub.id))))
  }, [ix, na, view, contest, highlight])

  // 選んだ結果をカードの見出しへ（フォーカス）。一覧・次の行動から選んだときだけ
  useEffect(() => {
    if (focusReq) cardTitle.current?.focus({ preventScroll: true })
  }, [focusReq])
  // レーンの中だけをスクロールして、選んだノードを見える位置へ（ページは動かさない）
  useEffect(() => {
    const box = lanesBox.current
    if (!box || !selected || mode !== 'lanes') return
    const el = [...box.querySelectorAll<HTMLElement>('[data-node-id]')].find((x) => x.dataset.nodeId === selected)
    if (!el) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < b.top) box.scrollTop += r.top - b.top - 8
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8
  }, [selected, mode, contest])

  useEffect(() => {
    if (view.impactOf && lanesBox.current) lanesBox.current.scrollTop = 0
  }, [view.impactOf])

  const select = useCallback((id: string, opts: { center?: boolean; focusCard?: boolean } = {}) => {
    if (!ix?.byId.has(id)) return
    setSelected(id)
    setView((v) => (v.extra.includes(id) ? v : { ...v, extra: [...v.extra, id] }))
    if (id.startsWith('id:sub/')) {
      const c = contestOfSubmission(ix, id)
      if (c) setContestSel(c)
    }
    if (opts.center !== false) setCenterOn({ ids: [id], n: ++counter.current })
    if (opts.focusCard) setFocusReq((n) => n + 1)
  }, [ix])
  const fromPanel = useCallback((id: string) => select(id, { focusCard: true }), [select])
  const onGraphSelect = useCallback((id: string) => select(id, { center: false }), [select])
  const onLaneSelect = useCallback((id: string) => select(id, { center: false }), [select])

  if (error) return <p role="alert" className="rounded-md border-2 border-red-800 bg-red-50 p-3 text-sm font-bold text-red-950">つながり図のデータを読み込めませんでした: {error}</p>
  if (!graph || !ix || !na) return <p role="status" className="p-3 text-sm">読み込み中…</p>

  const sel = selected ? ix.byId.get(selected) ?? null : null
  const counts = new Map<string, number>()
  for (const n of graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
  // 「アプリ・案」は、適合判定のあるもの（トップ・図解と同じ範囲）。提出文だけの案は別に言葉で添える
  const fitApps = new Set(graph.edges.filter((e) => e.rel === 'fit').map((e) => e.source))
  const appOnlyDoc = (counts.get('App') ?? 0) - fitApps.size
  counts.set('App', fitApps.size)
  const isDefault = JSON.stringify({ ...view, extra: [], expanded: [], focus: null, impactOf: null }) === JSON.stringify({ ...defaultView() })
  const appName = (appId: string, fallback: string) => {
    const id = appIdOf(appId)
    return (id && getApp(id)?.name) || ix.byId.get(appId)?.label || fallback
  }
  const contests = [...new Map(na.submissions.map((s) => [s.contest, ix.byId.get(s.contest)?.label ?? s.contest])).entries()]
  const effMode: Mode = view.focus ? 'graph' : mode

  const toggle = (key: 'types' | 'severities' | 'rels', v: string) =>
    setView((s) => ({ ...s, [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v] }))
  const toGraph = (center?: string[]) => {
    setMode('graph')
    if (center) setCenterOn({ ids: center, n: ++counter.current })
  }
  const impactIds = view.impactOf ? [view.impactOf, ...impactSet(na, view.impactOf)].filter((i) => ix.byId.has(i)) : []

  const modeBtn = (m: Mode, label: string) => (
    <button type="button" className={effMode === m ? btnOn : btn} aria-pressed={effMode === m} onClick={() => { setMode(m); if (m === 'lanes') setView((v) => ({ ...v, focus: null })) }} data-testid={`mode-${m}`}>{label}</button>
  )

  return (
    <div className="mx-auto flex max-w-[96rem] flex-col gap-2 lg:h-[calc(100vh-6rem)]" data-testid="ontology-page">
      <header className="shrink-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-lg font-bold">つながり図（オントロジー）</h1>
          <p className="text-xs text-slate-800">
            {graph.asOf} 時点の記録（{graph.nodes.length} ノード・{graph.edges.length} つながり）。案の選定・提出・registry 変更・ページ削除は<strong>総司令官の判断</strong>で、この画面からは進めません。
          </p>
          <a href={ontologyFiguresUrl()} className="text-xs font-bold text-blue-900 underline" data-testid="onto-figures-link">図解ページ（要約: 止めているもの・次の行動・データ条件・適合を図で読む）へ</a>
          <a href="#next-panel" className="sr-only focus:not-sr-only focus:rounded-md focus:bg-slate-900 focus:px-2 focus:py-1 focus:text-xs focus:font-bold focus:text-white">図の前の「次の行動」へ移動</a>
        </div>
        <details className="text-xs">
          <summary className="min-h-7 cursor-pointer font-bold">この画面について・出典</summary>
          <div className="space-y-1 rounded border border-slate-400 bg-white p-2">
            <p>正本は contests/ontology/campaign.jsonld（RDF/OWL の JSON-LD）。この画面は graph.json・next-actions.json を読むだけで、更新は contests/ontology/ のコマンドで再生成します（手順は contests/ontology/README.md）。</p>
            <ul className="list-disc pl-5">{na.notes.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        </details>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* 左の列（DOM では先）: カードは高さ固定の領域。押した一覧は動かない。スマホではカードは画面下のシート */}
        <div className="order-2 flex min-h-0 min-w-0 flex-col gap-3 lg:order-1">
          <div className={sel ? 'fixed inset-x-0 bottom-0 z-30 max-h-[50vh] overflow-y-auto border-t-4 border-slate-900 bg-white p-2 shadow-[0_-4px_12px_rgba(0,0,0,0.25)] lg:static lg:z-auto lg:max-h-none lg:shrink-0 lg:h-[44%] lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none' : 'hidden lg:block lg:shrink-0 lg:h-[44%]'} data-testid="card-region">
            <div className="lg:h-full lg:overflow-y-auto">
              <NodeCard
                node={sel}
                titleRef={cardTitle}
                ix={ix}
                na={na}
                focused={!!view.focus}
                inLanes={effMode === 'lanes'}
                onSelect={fromPanel}
                onExpand={(id) => { setView((v) => ({ ...v, expanded: v.expanded.includes(id) ? v.expanded : [...v.expanded, id] })); toGraph([id]) }}
                onFocus={(id) => { setView((v) => ({ ...v, focus: v.focus ? null : id })); if (!view.focus) setMode('graph'); setCenterOn({ ids: [id], n: ++counter.current }) }}
                onGraph={(id) => toGraph([id])}
                onImpact={(id) => { setView((v) => ({ ...v, impactOf: v.impactOf === id ? null : id })); setTab('impact') }}
                impactOf={view.impactOf}
                onClose={() => setSelected(null)}
              />
            </div>
          </div>
          <section id="next-panel" tabIndex={-1} aria-label="次の行動・絞り込み・一覧" className="min-h-0 rounded-md border-2 border-slate-700 bg-white p-2 outline-none lg:flex-1 lg:overflow-y-auto" data-testid="next-panel">
            <PanelTabs tab={tab} setTab={setTab} />
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-2 text-xs">
              {tab === 'subs' && <SubsTab na={na} ix={ix} select={fromPanel} />}
              {tab === 'units' && <UnitsTab na={na} ix={ix} select={fromPanel} />}
              {tab === 'gates' && <GatesTab na={na} select={fromPanel} />}
              {tab === 'impact' && (
                <ImpactTab
                  na={na}
                  ix={ix}
                  select={fromPanel}
                  impactOf={view.impactOf}
                  setImpactOf={(id) => {
                    setView((v) => ({ ...v, impactOf: id }))
                    if (id) {
                      const ids = [id, ...impactSet(na, id)].filter((i) => ix.byId.has(i))
                      setCenterOn({ ids, n: ++counter.current })
                    }
                  }}
                  onGraph={() => toGraph(impactIds)}
                />
              )}
              {tab === 'types' && (
                <Filters view={view} counts={counts} appOnlyDoc={appOnlyDoc} toggle={toggle} reset={() => { setView(defaultView()); setSelected(null); setMode('lanes') }} clearExtra={() => setView((v) => ({ ...v, extra: [], expanded: [], focus: null }))} hasExtra={view.extra.length + view.expanded.length > 0 || !!view.focus} />
              )}
              {tab === 'list' && <NodeList graph={graph} shown={shownNodes} q={q} setQ={setQ} selected={selected} select={fromPanel} />}
            </div>
          </section>
        </div>

        {/* 図（スマホでは先頭に見せる） */}
        <section aria-label="つながりの図" className="order-1 flex min-h-0 min-w-0 flex-col gap-1.5 lg:order-2" data-testid="graph-region">
          <Legend />
          <div className="flex flex-wrap items-center gap-1.5">
            {modeBtn('lanes', '応募ごとのレーン')}
            {modeBtn('graph', 'つながり（グラフ）')}
            {effMode === 'lanes' && (
              <div className="flex flex-wrap gap-1" role="group" aria-label="コンペで絞る">
                <button type="button" className={contest === 'all' ? btnOn : btn} aria-pressed={contest === 'all'} onClick={() => setContestSel('all')}>全コンペ</button>
                {contests.map(([id, label]) => (
                  <button key={id} type="button" className={contest === id ? btnOn : btn} aria-pressed={contest === id} onClick={() => setContestSel(id)} title={label}>
                    {label.replace(/^(.{7}).*$/, '$1…')}
                  </button>
                ))}
              </div>
            )}
          </div>
          {view.impactOf && (
            <p className="rounded border-2 border-fuchsia-800 bg-fuchsia-50 p-1.5 text-xs font-bold text-fuchsia-950" data-testid="impact-banner">
              もし「{na.dataImpactAll[view.impactOf]?.label ?? view.impactOf}」が使えなければ、影響を受けるものに「影響」の札と紫の枠（他は薄く）。
              <button type="button" className={btn + ' ml-2'} onClick={() => setView((v) => ({ ...v, impactOf: null }))}>強調をやめる</button>
            </p>
          )}
          <p className="text-xs text-slate-800" data-testid="onto-shown">
            {effMode === 'lanes'
              ? `応募 ${groups.reduce((n, g) => n + g.lanes.length, 0)} 件のレーン。止めているものは各応募に上位 2 件まで（残りは「ほか n 件」＝カードで全件）。${isDefault ? '既定: 失格級の指摘・未記入欄・未確認のデータ条件・提出物の欠落。' : ''}アプリの名前は応募のノードの中です。`
              : `いま図に出しているのは ${shownNodes.length} ノード・${shownEdges.length} つながり${view.focus ? '（選んだノードの近傍だけ）' : ''}。図の中はドラッグで動かし、左下の＋－ボタンか2本指で拡大縮小します。選んだノードの線にだけ、つながりの名前が出ます。`}
          </p>
          <div
            ref={lanesBox}
            className={`min-h-0 overflow-auto rounded-md border-2 border-slate-700 bg-white ${effMode === 'graph' ? 'h-[70vh] lg:h-auto lg:flex-1' : 'lg:flex-1'}`}
            data-testid="graph-area"
          >
            {effMode === 'lanes'
              ? <Lanes groups={groups} selected={selected} highlight={highlight} impactOn={!!view.impactOf} appName={appName} onSelect={onLaneSelect} />
              : <GraphView nodes={shownNodes} edges={shownEdges} selected={selected} highlight={highlight} impactOn={!!view.impactOf} onSelect={onGraphSelect} centerOn={centerOn} />}
          </div>
        </section>
      </div>
      {sel && <div className="h-[50vh] shrink-0 lg:hidden" aria-hidden />}
    </div>
  )
}

function PanelTabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'subs', label: '応募ごと' },
    { id: 'units', label: '部隊ごと' },
    { id: 'gates', label: '総司令官の判断待ち' },
    { id: 'impact', label: 'データが使えなければ' },
    { id: 'types', label: '図に出す種類' },
    { id: 'list', label: 'ノード一覧・検索' },
  ]
  return (
    <>
      <h2 className="text-sm font-bold">次の行動・絞り込み・一覧</h2>
      <div role="tablist" aria-label="左の列の見方" className="mt-1 flex flex-wrap gap-1">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} className={tab === t.id ? btnOn : btn} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- カード
function NodeCard({ node, titleRef, inLanes, onGraph, ix, na, focused, onSelect, onExpand, onFocus, onImpact, impactOf, onClose }: {
  node: GNode | null
  titleRef: React.RefObject<HTMLHeadingElement | null>
  inLanes: boolean
  onGraph: (id: string) => void
  ix: ReturnType<typeof buildIndex>
  na: NextActions
  focused: boolean
  onSelect: (id: string) => void
  onExpand: (id: string) => void
  onFocus: (id: string) => void
  onImpact: (id: string) => void
  impactOf: string | null
  onClose: () => void
}) {
  if (!node) {
    return (
      <section aria-label="選んだものの詳細" className="rounded-md border-2 border-dashed border-slate-500 bg-white p-3 text-sm" data-testid="node-card-empty">
        <h2 className="font-bold">カード（選んだものの詳細）</h2>
        <p className="mt-1 text-xs text-slate-800">図のノード、下の「次の行動」、ノードの一覧のどれかを選ぶと、ここに詳細（状態・出典・つながっている相手）が出ます。</p>
      </section>
    )
  }
  const st = styleOf(node.type)
  const edges = ix.all.get(node.id) ?? []
  const groups = new Map<string, { label: string; ids: string[] }>()
  for (const e of edges) {
    const out = e.source === node.id
    const key = `${out ? '→' : '←'} ${e.rel === 'blockedBy' ? '指摘・欠落（要修正・軽微を含む全件）' : e.label}`
    const g = groups.get(key) ?? { label: key, ids: [] }
    const o = other(e, node.id)
    if (!g.ids.includes(o)) g.ids.push(o)
    groups.set(key, g)
  }
  const appId = appIdOf(node.id)
  const registered = appId ? getApp(appId) : undefined
  const contestId = contestIdOf(node.id)
  const fits = node.type === 'App' ? edges.filter((e) => e.rel === 'fit' && e.source === node.id) : []
  const subCounts = node.props.counts as Record<string, number> | undefined
  const next = node.props.nextStage as { stage: string; unit: string; humanGate: boolean } | undefined
  const dl = node.props.deadline as { at: string | null } | undefined
  const sources = node.sources.filter((s) => s.path || s.url)
  const url = typeof node.props.url === 'string' ? node.props.url : null
  const impact = node.type === 'Dataset' ? na.dataImpactAll[node.id] : undefined
  return (
    <section aria-label="選んだものの詳細" className="space-y-2 rounded-md border-2 border-slate-900 bg-white p-3 text-sm" data-testid="node-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <TypeTag type={node.type} />
          <h2 ref={titleRef} tabIndex={-1} className="break-words text-base font-bold leading-snug outline-none focus-visible:underline" data-testid="node-card-title">{node.label}</h2>
        </div>
        <button type="button" className={btn} onClick={onClose} aria-label="カードを閉じる">閉じる</button>
      </div>
      {node.status && <p className="text-xs"><span className="font-bold">状態:</span> {READINESS_MARK[node.status] ?? node.status}</p>}
      {(isGate(node) || GATE_TYPES.includes(node.type)) && (
        <p className="rounded border-2 border-amber-800 bg-amber-100 p-2 text-xs font-bold text-amber-950" data-testid="gate-note">
          ★ 総司令官の判断です。案の選定・提出・registry 変更・ページ削除は、部隊や自動処理では進めません。
        </p>
      )}
      {node.type === 'Submission' && (
        <div className="space-y-0.5 text-xs">
          {dl?.at && <p><span className="font-bold">締切:</span> {fmtDue(dl.at)}</p>}
          {subCounts && <p><span className="font-bold">内訳:</span> 失格級 {subCounts['失格級'] ?? 0}（確定 {subCounts['失格級（確定）'] ?? 0}・要確認 {subCounts['失格級（要確認）'] ?? 0}）・要修正 {subCounts['要修正'] ?? 0}・未記入欄ファイル {subCounts['未記入欄ファイル'] ?? 0}・データ条件 {subCounts['データ条件'] ?? 0}</p>}
          {next && <p><span className="font-bold">標準の流れの次:</span> {next.unit}（{next.stage}）{next.humanGate && <strong> ★ 総司令官の判断</strong>}</p>}
        </div>
      )}
      {node.type === 'App' && (
        <div className="space-y-0.5 text-xs">
          {typeof node.props.purpose === 'string' && <p>{node.props.purpose}</p>}
          {typeof node.props.audience === 'string' && <p><span className="font-bold">対象:</span> {node.props.audience}</p>}
        </div>
      )}
      {fits.length > 0 && (
        <details className="text-xs">
          <summary className="min-h-9 cursor-pointer font-bold">出せるコンペ（◎○△×？。情報部の判定）</summary>
          <ul className="mt-1 space-y-0.5">
            {fits.map((e) => (
              <li key={e.target}>
                <button type="button" className="text-left underline" onClick={() => onSelect(e.target)}>{ix.byId.get(e.target)?.label ?? e.target}</button>
                {' '}<strong>{String(e.props?.mark)} {MARK_WORD[String(e.props?.mark) as keyof typeof MARK_WORD] ?? ''}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(registered || contestId || url) && (
        <p className="flex flex-wrap gap-2 text-xs">
          {registered && <a className={btn + ' inline-flex items-center'} href={appUrl(appId!)} data-testid="card-app-link">アプリを開く（apps/{appId}/）</a>}
          {contestId && <a className={btn + ' inline-flex items-center'} href={contestUrl(contestId)} data-testid="card-contest-link">コンペの概要（contest/{contestId}/）</a>}
          {url && <a className={btn + ' inline-flex items-center'} href={url} target="_blank" rel="noreferrer">GitHub の PR を開く</a>}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => onExpand(node.id)} data-testid="expand-btn">近傍を展開（{neighbors(ix, node.id).length}件）</button>
        {inLanes && <button type="button" className={btn} onClick={() => onGraph(node.id)} data-testid="to-graph-btn">つながり表示で見る</button>}
        <button type="button" className={focused ? btnOn : btn} aria-pressed={focused} onClick={() => onFocus(node.id)} data-testid="focus-btn">{focused ? '全体に戻す' : '近傍だけ表示'}</button>
        {node.type === 'Dataset' && (
          <button type="button" className={impactOf === node.id ? btnOn : btn} aria-pressed={impactOf === node.id} onClick={() => onImpact(node.id)} data-testid="impact-btn">もしこのデータが使えなければ</button>
        )}
      </div>
      {impact && impactOf === node.id && <p className="text-xs font-bold text-fuchsia-950">影響の一覧は、左の列の「データが使えなければ」にあります（図でも強調中）。</p>}
      <div>
        <h3 className="text-xs font-bold">つながっている相手（{edges.length}件。→ はこのノードから、← はこのノードへ）</h3>
        <div className="mt-1 space-y-1">
          {[...groups.values()].map((g) => (
            <details key={g.label} open={g.ids.length <= 4} className="text-xs">
              <summary className="min-h-7 cursor-pointer font-bold">{g.label}（{g.ids.length}）</summary>
              <ul className="space-y-0.5 pl-3">
                {g.ids.map((id) => {
                  const n = ix.byId.get(id)
                  return n ? (
                    <li key={id}>
                      <button type="button" className="inline-flex w-full items-start gap-1 text-left underline decoration-slate-400 hover:bg-slate-100" onClick={() => onSelect(id)}>
                        <span aria-hidden className="shrink-0">{styleOf(n.type).symbol}</span>
                        <span className="min-w-0 break-words">{n.label}{n.status ? `（${n.status}）` : ''}</span>
                      </button>
                    </li>
                  ) : null
                })}
              </ul>
            </details>
          ))}
          {!groups.size && <p className="text-xs">つながりはありません。</p>}
        </div>
      </div>
      <div>
        <h3 className="text-xs font-bold">出典</h3>
        {sources.length ? (
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-xs">
            {sources.map((s, i) => <li key={i} className="break-all">{s.path ?? s.url}{s.locator ? `（${s.locator}）` : ''}</li>)}
          </ul>
        ) : <p className="text-xs">出典の記録なし（グラフの構造から導いたノード）。</p>}
        {Array.isArray(node.props.extracted) && <p className="mt-1 text-xs">未抽出の項目: {(node.props.extracted as string[]).join(' ／ ')}</p>}
      </div>
    </section>
  )
}

function ImpactList({ impact, ix, select }: { impact: NextActions['dataImpactAll'][string]; ix: ReturnType<typeof buildIndex>; select: (id: string) => void }) {
  const apps = Object.entries(impact.apps)
  const subs = impact.submissions
  return (
    <div className="space-y-1 rounded border-2 border-fuchsia-800 bg-fuchsia-50 p-2 text-xs text-fuchsia-950" data-testid="impact-list">
      <p className="font-bold">もし「{impact.label}」が使えなければ、響くもの（図で「影響」の札と紫の枠）</p>
      {impact.why && <p>理由の記録: {impact.why}</p>}
      <p className="font-bold">アプリ（{apps.length}件）</p>
      <ul className="space-y-0.5">{apps.map(([id, name]) => <li key={id}><button type="button" className="text-left underline" onClick={() => select(id)}>● {name}</button></li>)}</ul>
      <p className="font-bold">応募（{subs.length}件）</p>
      <ul className="space-y-0.5">
        {subs.length ? subs.map((s) => (
          <li key={s.submission}><button type="button" className="text-left underline" onClick={() => select(s.submission)}>▣ {ix.byId.get(s.submission)?.label ?? s.submission}</button></li>
        )) : <li>応募に結ばれたアプリはありません（アプリだけに響く）。</li>}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------- 次の行動（左の列のタブの中身）
function SubsTab({ na, ix, select }: { na: NextActions; ix: ReturnType<typeof buildIndex>; select: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <p>
        {Object.entries(na.summary).map(([k, v]) => `${READINESS_MARK[k] ?? k} ${v}件`).join('　')}（締切の近い順。押すと図でその応募を選び、カードに詳細が出ます）
      </p>
      <p>「提出を止めているもの」は、失格級の指摘・未記入欄・未確認のデータ条件・提出物の欠落の件数です（<strong>要修正と軽微は除く</strong>。カードの「指摘・欠落」は要修正・軽微を含む全件なので多くなります）。</p>
      <ul className="space-y-1.5">
        {na.submissions.map((s) => {
          const hard = s.blockers.filter((b) => !(b.type === 'Finding' && b.severity === '要修正'))
          return (
            <li key={s.submission} className="rounded border border-slate-400 p-1.5" data-testid="sub-item">
              <button type="button" className="w-full text-left font-bold underline" onClick={() => select(s.submission)}>{s.label}</button>
              <p>
                <strong>{READINESS_MARK[s.readiness] ?? s.readiness}</strong>　締切 {fmtDue(s.deadline.at)}　失格級 {s.counts['失格級']}・要修正 {s.counts['要修正']}・未記入欄 {s.counts['未記入欄ファイル']}
              </p>
              {s.nextStage && <p>流れの次: {s.nextStage.unit}（{s.nextStage.stage}）{s.nextStage.humanGate && <strong> ★ 総司令官の判断</strong>}</p>}
              {hard.length > 0 && (
                <details>
                  <summary className="min-h-7 cursor-pointer font-bold">提出を止めているもの（{hard.length}件。要修正は除く）</summary>
                  <ul className="space-y-0.5 pl-3">
                    {hard.map((b, i) => {
                      const nid = blockerNodeId(ix, s.submission, b.label)
                      return (
                        <li key={i}>
                          {nid ? <button type="button" className="text-left underline" onClick={() => select(nid)}>{b.label}</button> : b.label}
                          {' '}<span>（{b.severity ?? b.type}{b.certainty ? `・${b.certainty}` : ''}。担当の推定: {na.unitLabels[b.owner] ?? b.owner}）</span>
                        </li>
                      )
                    })}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function UnitsTab({ na, ix, select }: { na: NextActions; ix: ReturnType<typeof buildIndex>; select: (id: string) => void }) {
  const order = ['commander', 'intelligence', 'recon', 'engineer', 'aggressor', 'operations-research', 'military-police', 'design-reviewer']
  const keys = [...order.filter((k) => na.unitActions[k]), ...Object.keys(na.unitActions).filter((k) => !order.includes(k))]
  return (
    <div className="space-y-1.5">
      <p>標準の流れで次に来る部隊と、止めているものを解消する担当（担当は規則による推定）。締切の近い順。押すと図で応募（なければアプリ）を選びます。</p>
      {keys.map((k) => {
        const acts = na.unitActions[k]
        const head = acts.slice(0, 8)
        const rest = acts.slice(8)
        const row = (a: (typeof acts)[number], i: number) => (
          <li key={i}>
            <button type="button" className="text-left underline" onClick={() => select(a.submission ?? a.app)}>
              [{fmtDue(a.due)}] {ix.byId.get(a.app)?.label ?? a.app}
            </button>
            <span>: {a.action}</span>
          </li>
        )
        return (
          <details key={k} open={k === 'commander'} className="rounded border border-slate-400 p-1.5" data-testid="unit-group">
            <summary className="min-h-7 cursor-pointer font-bold">{na.unitLabels[k] ?? k}{k === 'commander' ? '（人が行う作業・判断）' : ''}（{acts.length}件）</summary>
            <ul className="mt-1 space-y-1">{head.map(row)}</ul>
            {rest.length > 0 && (
              <details className="mt-1">
                <summary className="min-h-7 cursor-pointer font-bold">残り {rest.length} 件</summary>
                <ul className="mt-1 space-y-1">{rest.map(row)}</ul>
              </details>
            )}
          </details>
        )
      })}
    </div>
  )
}

function GatesTab({ na, select }: { na: NextActions; select: (id: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="rounded border-2 border-amber-800 bg-amber-100 p-1.5 font-bold text-amber-950">★ 案の選定・提出・registry 変更・ページ削除は総司令官の判断です。ここに並ぶものは自動では進みません（{na.commanderDecisions.length}件）。</p>
      <ul className="space-y-1">
        {na.commanderDecisions.map((d) => (
          <li key={d.decision} data-testid="gate-item">
            <button type="button" className="text-left underline" onClick={() => select(d.decision)}>
              ★ [{fmtDue(d.due)}] {styleOf(d.type).label}: {d.label}
            </button>
            <span className="block break-all text-slate-700">出典 {d.source}</span>
            {d.includes && d.includes.length > 0 && (
              <details className="ml-3">
                <summary className="min-h-7 cursor-pointer font-bold">含む {d.includes.length} 件（同じコンペ・日の案の選定の関門・応募ごとの判断）</summary>
                <ul className="space-y-0.5 pl-3">
                  {d.includes.map((i) => (
                    <li key={i.decision}><button type="button" className="text-left underline" onClick={() => select(i.decision)}>★ {i.label}</button></li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ImpactTab({ na, ix, select, impactOf, setImpactOf, onGraph }: { na: NextActions; ix: ReturnType<typeof buildIndex>; select: (id: string) => void; impactOf: string | null; setImpactOf: (id: string | null) => void; onGraph: () => void }) {
  const ids = Object.keys(na.dataImpactAll).filter((k) => Object.keys(na.dataImpactAll[k].apps).length > 0).sort((a, b) => na.dataImpactAll[a].label.localeCompare(na.dataImpactAll[b].label, 'ja'))
  const cur = impactOf ? na.dataImpactAll[impactOf] : undefined
  return (
    <div className="space-y-1.5">
      <p>データを選ぶと、そのデータが使えなくなったとき（利用条件が×など）に響くアプリ・応募を、図で「影響」の札と紫の枠で強調します（next_actions.py の --unusable と同じ考え方で、ビルド時に計算済み）。</p>
      <label htmlFor="impact-select" className="block font-bold">データ（{ids.length}件）</label>
      <select id="impact-select" className="h-9 w-full rounded-md border-2 border-slate-900 bg-white px-1" value={impactOf ?? ''} onChange={(e) => setImpactOf(e.target.value || null)} data-testid="impact-select">
        <option value="">選んでいません</option>
        {ids.map((k) => <option key={k} value={k}>{na.dataImpactAll[k].label}</option>)}
      </select>
      {cur && <ImpactList impact={cur} ix={ix} select={select} />}
      {impactOf && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={onGraph} data-testid="impact-graph-btn">つながり表示で見る（影響のノード全部が入る）</button>
          <button type="button" className={btn} onClick={() => setImpactOf(null)}>強調をやめる</button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- 絞り込み（凡例）
function Filters({ view, counts, appOnlyDoc, toggle, reset, clearExtra, hasExtra }: {
  view: ViewState
  counts: Map<string, number>
  appOnlyDoc: number
  toggle: (k: 'types' | 'severities' | 'rels', v: string) => void
  reset: () => void
  clearExtra: () => void
  hasExtra: boolean
}) {
  const cats = Object.keys(CAT) as Cat[]
  return (
    <div className="text-xs" data-testid="filters">
      <h3 className="text-sm font-bold">図に出す種類（凡例を兼ねる）</h3>
      <p className="mt-1">色は種類のまとまり、形と記号と言葉で種類を区別します。チェックで出し入れします。</p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={reset} data-testid="reset-btn">既定に戻す</button>
        {hasExtra && <button type="button" className={btn} onClick={clearExtra}>足したノード・近傍の展開を戻す</button>}
      </div>
      {cats.map((c) => (
        <fieldset key={c} className="mt-2">
          <legend className={`mb-1 rounded px-1.5 font-bold ${CAT[c].chip}`}>{CAT[c].label}</legend>
          <ul className="grid grid-cols-1 gap-x-2 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-1">
            {Object.entries(TYPE_STYLE).filter(([t, s]) => s.cat === c && (counts.get(t) ?? 0) > 0).map(([t, s]) => (
              <li key={t}>
                <label className="flex min-h-7 items-center gap-1.5">
                  <input type="checkbox" checked={view.types.includes(t)} onChange={() => toggle('types', t)} data-testid={`type-${t}`} />
                  <span className={`inline-flex items-center gap-1 px-1.5 text-[11px] font-bold leading-5 ${CAT[s.cat].box} ${SHAPE_CLASS[s.shape]}`}><span aria-hidden>{s.symbol}</span>{s.label}</span>
                  <span className="text-slate-700">{counts.get(t)}件{t === 'App' && appOnlyDoc > 0 ? `（＋提出文のみ ${appOnlyDoc}）` : ''}{DEFAULT_TYPES.includes(t) ? '・既定' : ''}</span>
                </label>
                {t === 'Finding' && view.types.includes('Finding') && (
                  <div className="ml-6 flex flex-wrap gap-x-3" role="group" aria-label="指摘の重さ">
                    {SEVERITIES.map((sv) => (
                      <label key={sv} className="flex min-h-7 items-center gap-1">
                        <input type="checkbox" checked={view.severities.includes(sv)} onChange={() => toggle('severities', sv)} />
                        {sv}{DEFAULT_SEVERITIES.includes(sv) ? '（既定）' : ''}
                      </label>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
      <fieldset className="mt-2">
        <legend className="font-bold">多い線（既定では引かない）</legend>
        {Object.entries(OPTIONAL_RELS).map(([r, label]) => (
          <label key={r} className="flex min-h-7 items-center gap-1.5">
            <input type="checkbox" checked={view.rels.includes(r)} onChange={() => toggle('rels', r)} />
            {label}
          </label>
        ))}
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------- ノードの一覧（検索つき。キーボードで選べる）
function NodeList({ graph, shown, q, setQ, selected, select }: { graph: GraphData; shown: GNode[]; q: string; setQ: (s: string) => void; selected: string | null; select: (id: string) => void }) {
  const hits = useMemo(() => searchNodes(graph, q), [graph, q])
  const list = q.trim() ? hits : shown
  return (
    <section id="onto-list" aria-label="ノードの一覧" className="text-xs" data-testid="node-list">
      <h2 className="text-sm font-bold">ノードの一覧と検索</h2>
      <label htmlFor="onto-q" className="mt-1 block font-bold">全 {graph.nodes.length} ノードから探す（名前・種類・状態）</label>
      <input id="onto-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: 失格級、盛土、P13、PR #36" className="h-9 w-full rounded-md border-2 border-slate-900 bg-white px-2" data-testid="onto-search" />
      <p role="status" className="mt-1" data-testid="onto-list-count">
        {q.trim() ? hits.length ? `${hits.length}件が見つかりました（先頭 80 件まで）。押すと選び、図にも足します` : '見つかりません。言い換えるか、種類名（例: 失格級、指摘、データ）で探してください' : `いま図に出している ${shown.length} ノード。押すと選びます`}
      </p>
      <ul className="mt-1 space-y-0.5">
        {list.map((n) => (
          <li key={n.id}>
            <button type="button" aria-current={selected === n.id ? 'true' : undefined} onClick={() => select(n.id)} className={`flex min-h-8 w-full items-start gap-1 rounded px-1 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900 ${selected === n.id ? 'bg-slate-200 font-bold' : ''}`}>
              <span aria-hidden className="shrink-0">{styleOf(n.type).symbol}</span>
              <span className="min-w-0 break-words"><span className="font-bold">{styleOf(n.type).label}</span> {n.label}{n.status ? `（${n.status}）` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
