/**
 * オントロジー画面（ontology/index.html）の純粋なロジック。
 * 入力は contests/ontology/graph.json（ノード・エッジ）と next-actions.json（次の行動。どちらも Python で生成してリポジトリに置く）。
 * ここでは React に依らず、型・見た目の対応表・既定の絞り込み・近傍の展開・影響の強調・配置を扱う。
 */

export interface GSource { path: string | null; locator: string | null; url: string | null }
export interface GNode {
  id: string
  type: string
  label: string
  status: string | null
  sources: GSource[]
  props: Record<string, unknown>
}
export interface GEdge { source: string; target: string; rel: string; label: string; props?: Record<string, unknown> }
export interface GraphData {
  asOf: string
  generatedBy?: string
  legend: Record<string, { label: string }>
  relations: Record<string, string>
  nodes: GNode[]
  edges: GEdge[]
}

export interface Blocker { type: string; severity: string | null; certainty: string | null; label: string; source: string; owner: string; action: string }
export interface SubmissionAction {
  submission: string
  label: string
  app: string
  contest: string
  readiness: string
  counts: Record<string, number>
  deadline: { at: string | null; label: string | null }
  nextStage: { stage: string; unit: string; agent: string; humanGate: boolean } | null
  blockerOwners: string[]
  blockers: Blocker[]
}
export interface UnitAction { due: string | null; app: string; submission: string | null; action: string; why: string; source: string }
export interface CommanderDecision { decision: string; type: string; label: string; due: string | null; source: string }
export interface DataImpact { apps: Record<string, string>; submissions: { submission: string; contest: string; division: string | null }[]; label: string; why: string | null }
export interface NextActions {
  asOf: string
  generatedBy: string
  notes: string[]
  summary: Record<string, number>
  submissions: SubmissionAction[]
  unitActions: Record<string, UnitAction[]>
  commanderDecisions: CommanderDecision[]
  dataImpactAll: Record<string, DataImpact>
  unitLabels: Record<string, string>
}

// ---------------------------------------------------------------- 見た目（色・形・記号・言葉）
export type Cat = 'contest' | 'plan' | 'block' | 'gate' | 'data' | 'work'
export type Shape = 'pill' | 'round' | 'square' | 'dashed' | 'double'

/** 種類のまとまりごとの色（背景・枠・文字）。色だけに頼らず、記号・形・言葉も付ける。いずれも文字は AA 以上 */
export const CAT: Record<Cat, { label: string; box: string; chip: string }> = {
  contest: { label: 'コンペ・枠', box: 'bg-indigo-50 border-indigo-800 text-indigo-950', chip: 'bg-indigo-800 text-white' },
  plan: { label: '案・応募', box: 'bg-teal-50 border-teal-800 text-teal-950', chip: 'bg-teal-800 text-white' },
  block: { label: '止めているもの', box: 'bg-red-50 border-red-800 text-red-950', chip: 'bg-red-800 text-white' },
  gate: { label: '総司令官の判断', box: 'bg-amber-100 border-amber-800 text-amber-950', chip: 'bg-amber-800 text-white' },
  data: { label: 'データ・ライセンス', box: 'bg-green-50 border-green-800 text-green-950', chip: 'bg-green-800 text-white' },
  work: { label: '作業・PR・監査・部隊', box: 'bg-slate-100 border-slate-700 text-slate-900', chip: 'bg-slate-700 text-white' },
}
export const SHAPE_CLASS: Record<Shape, string> = {
  pill: 'rounded-full border-2',
  round: 'rounded-xl border-[3px]',
  square: 'rounded-none border-2',
  dashed: 'rounded-md border-2 border-dashed',
  double: 'rounded-md border-4 border-double',
}
export const SHAPE_WORD: Record<Shape, string> = { pill: '楕円', round: '角丸の太枠', square: '四角', dashed: '破線', double: '二重線' }

export interface TypeStyle { label: string; cat: Cat; symbol: string; shape: Shape; rank: number }
export const TYPE_STYLE: Record<string, TypeStyle> = {
  Contest: { label: 'コンペ', cat: 'contest', symbol: '◆', shape: 'pill', rank: 0 },
  Division: { label: '部門', cat: 'contest', symbol: '◇', shape: 'square', rank: 1 },
  Theme: { label: 'テーマ', cat: 'contest', symbol: '◇', shape: 'dashed', rank: 1 },
  Deadline: { label: '締切', cat: 'contest', symbol: '◔', shape: 'dashed', rank: 1 },
  Criterion: { label: '審査基準', cat: 'contest', symbol: '☆', shape: 'dashed', rank: 1 },
  Rule: { label: 'ルール', cat: 'contest', symbol: '§', shape: 'dashed', rank: 1 },
  SubmissionLimit: { label: '提出可能数・字数', cat: 'contest', symbol: '#', shape: 'dashed', rank: 1 },
  Submission: { label: '応募（案×コンペ）', cat: 'plan', symbol: '▣', shape: 'double', rank: 2 },
  App: { label: 'アプリ・案', cat: 'plan', symbol: '●', shape: 'round', rank: 4 },
  Finding: { label: '指摘', cat: 'block', symbol: '!', shape: 'square', rank: 3 },
  UnfilledField: { label: '未記入欄', cat: 'block', symbol: '□', shape: 'square', rank: 3 },
  UnconfirmedDataCondition: { label: '未確認のデータ条件', cat: 'block', symbol: '?', shape: 'square', rank: 3 },
  MissingDeliverable: { label: '未作成の提出物', cat: 'block', symbol: '∅', shape: 'square', rank: 3 },
  SelectionDecision: { label: '案の選定（総司令官）', cat: 'gate', symbol: '★', shape: 'pill', rank: 3 },
  SubmissionDecision: { label: '提出の判断（総司令官）', cat: 'gate', symbol: '★', shape: 'pill', rank: 3 },
  RegistryChange: { label: 'registry 変更（総司令官）', cat: 'gate', symbol: '★', shape: 'pill', rank: 3 },
  PageDeletion: { label: 'ページ削除（総司令官）', cat: 'gate', symbol: '★', shape: 'pill', rank: 3 },
  HumanGate: { label: '人間の関門（総司令官）', cat: 'gate', symbol: '★', shape: 'pill', rank: 3 },
  Decision: { label: '判断（済み）', cat: 'gate', symbol: '✓', shape: 'dashed', rank: 3 },
  Escalation: { label: 'エスカレーション', cat: 'gate', symbol: '▲', shape: 'dashed', rank: 3 },
  Dataset: { label: 'データ', cat: 'data', symbol: '▤', shape: 'square', rank: 5 },
  License: { label: 'ライセンス・利用条件', cat: 'data', symbol: '©', shape: 'dashed', rank: 6 },
  Task: { label: '作業', cat: 'work', symbol: '☐', shape: 'square', rank: 3 },
  PullRequest: { label: 'PR', cat: 'work', symbol: '⇄', shape: 'square', rank: 3 },
  Audit: { label: '監査', cat: 'work', symbol: '◎', shape: 'square', rank: 3 },
  Unit: { label: '部隊', cat: 'work', symbol: '◈', shape: 'pill', rank: 7 },
  Commander: { label: '総司令官', cat: 'gate', symbol: '★', shape: 'pill', rank: 7 },
  Stage: { label: '標準の流れの段階', cat: 'work', symbol: '▷', shape: 'square', rank: 7 },
}
export function styleOf(type: string): TypeStyle {
  return TYPE_STYLE[type] ?? { label: type, cat: 'work', symbol: '・', shape: 'square', rank: 7 }
}

/** 人間の関門（案の選定・提出・registry 変更・ページ削除）。部隊や自動処理では進めない（doctrine/roe.md） */
export const GATE_TYPES = ['SelectionDecision', 'SubmissionDecision', 'RegistryChange', 'PageDeletion', 'HumanGate']
export const isGate = (n: GNode) => GATE_TYPES.includes(n.type)

// ---------------------------------------------------------------- 既定の絞り込み
/** 既定で出す種類: コンペ・応募・アプリ・止めているもの（指摘は失格級のみ。未記入欄・総司令官の判断・部門は「図に出す種類」で足す） */
export const DEFAULT_TYPES = ['Contest', 'Submission', 'App', 'Finding', 'UnconfirmedDataCondition', 'MissingDeliverable']
export const DEFAULT_SEVERITIES = ['失格級']
/** 既定では線を引かない関係（多くて読めなくなるため。切り替えで出せる。カードの「つながり」には常に出る） */
export const OPTIONAL_RELS: Record<string, string> = { fitsContest: '出せるコンペ（◎○△）の線', competesWith: '同じ枠で競合する案の線' }
/** 画面に線として描かない関係（fit は fitsContest と同じ組。◎○△×？はカードに出す） */
export const HIDDEN_RELS = ['fit']

export interface ViewState {
  types: string[]
  severities: string[]
  extra: string[] // 選んで足したノード（絞り込みに関係なく出す）
  expanded: string[] // 近傍を展開したノード
  focus: string | null // 「近傍だけ表示」の中心
  impactOf: string | null // 「もしこのデータが使えなければ」のデータ
  rels: string[] // 出す任意の関係
}
export const defaultView = (): ViewState => ({ types: [...DEFAULT_TYPES], severities: [...DEFAULT_SEVERITIES], extra: [], expanded: [], focus: null, impactOf: null, rels: [] })

export interface Index {
  byId: Map<string, GNode>
  adj: Map<string, GEdge[]> // 両方向（fit は除く）
  all: Map<string, GEdge[]> // 両方向（fit を含む。カード用）
}
export function buildIndex(g: GraphData): Index {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const adj = new Map<string, GEdge[]>()
  const all = new Map<string, GEdge[]>()
  const push = (m: Map<string, GEdge[]>, k: string, e: GEdge) => {
    const a = m.get(k)
    if (a) a.push(e)
    else m.set(k, [e])
  }
  for (const e of g.edges) {
    push(all, e.source, e)
    if (e.target !== e.source) push(all, e.target, e)
    if (HIDDEN_RELS.includes(e.rel)) continue
    push(adj, e.source, e)
    if (e.target !== e.source) push(adj, e.target, e)
  }
  return { byId, adj, all }
}
export const other = (e: GEdge, id: string) => (e.source === id ? e.target : e.source)
export function neighbors(ix: Index, id: string): string[] {
  return [...new Set((ix.adj.get(id) ?? []).map((e) => other(e, id)))]
}

/** データを使えなくなったとき影響を受けるノード（アプリ・応募・コンペ・部門）。next-actions.json の dataImpactAll から */
export function impactSet(na: NextActions | null, datasetId: string | null): Set<string> {
  const s = new Set<string>()
  const d = datasetId && na ? na.dataImpactAll[datasetId] : null
  if (!d) return s
  for (const a of Object.keys(d.apps)) s.add(a)
  for (const x of d.submissions) {
    s.add(x.submission)
    s.add(x.contest)
    if (x.division) s.add(x.division)
  }
  return s
}

/** いま画面に出すノード id の集合 */
export function visibleIds(g: GraphData, ix: Index, v: ViewState, na: NextActions | null, selected: string | null): Set<string> {
  if (v.focus && ix.byId.has(v.focus)) return new Set([v.focus, ...neighbors(ix, v.focus)])
  const out = new Set<string>()
  for (const n of g.nodes) {
    if (!v.types.includes(n.type)) continue
    if (n.type === 'Finding' && !v.severities.includes(n.status ?? '')) continue
    out.add(n.id)
  }
  for (const id of v.extra) if (ix.byId.has(id)) out.add(id)
  for (const id of v.expanded) if (ix.byId.has(id)) for (const m of neighbors(ix, id)) out.add(m)
  if (v.impactOf && ix.byId.has(v.impactOf)) {
    out.add(v.impactOf)
    for (const id of impactSet(na, v.impactOf)) if (ix.byId.has(id)) out.add(id)
  }
  if (selected && ix.byId.has(selected)) out.add(selected)
  return out
}

export function visibleEdges(g: GraphData, ids: Set<string>, v: ViewState): GEdge[] {
  return g.edges.filter((e) => {
    if (HIDDEN_RELS.includes(e.rel)) return false
    if (e.rel in OPTIONAL_RELS && !v.rels.includes(e.rel)) return false
    return ids.has(e.source) && ids.has(e.target)
  })
}

// ---------------------------------------------------------------- 配置（種類ごとの列。列の中は、つながる相手の位置の平均で並べる）
export const NODE_W = 210
export const NODE_H = 46
const COL_GAP = 90
const ROW_GAP = 8

export function layout(nodes: GNode[], edges: GEdge[]): Map<string, { x: number; y: number }> {
  const cols = new Map<number, GNode[]>()
  const order = new Map<string, number>()
  const typeOrder = Object.keys(TYPE_STYLE)
  const sorted = [...nodes].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.label.localeCompare(b.label, 'ja'))
  sorted.forEach((n, i) => {
    const r = styleOf(n.type).rank
    if (!cols.has(r)) cols.set(r, [])
    cols.get(r)!.push(n)
    order.set(n.id, i)
  })
  const ranks = [...cols.keys()].sort((a, b) => a - b)
  const nb = new Map<string, string[]>()
  for (const e of edges) {
    if (!nb.has(e.source)) nb.set(e.source, [])
    if (!nb.has(e.target)) nb.set(e.target, [])
    nb.get(e.source)!.push(e.target)
    nb.get(e.target)!.push(e.source)
  }
  const pos = new Map<string, number>() // 列内の順位
  for (const r of ranks) cols.get(r)!.forEach((n, i) => pos.set(n.id, i))
  const typeById = new Map(nodes.map((n) => [n.id, n]))
  const rankOf = (id: string) => styleOf(typeById.get(id)!.type).rank
  const sweep = (rs: number[], cmp: (mine: number, theirs: number) => boolean) => {
    for (const r of rs) {
      const col = cols.get(r)!
      const keyed = col.map((n, i) => {
        const ps = (nb.get(n.id) ?? []).filter((m) => cmp(r, rankOf(m))).map((m) => pos.get(m)!)
        return { n, k: ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : i }
      })
      keyed.sort((a, b) => a.k - b.k || (order.get(a.n.id)! - order.get(b.n.id)!))
      cols.set(r, keyed.map((x) => x.n))
      cols.get(r)!.forEach((n, i) => pos.set(n.id, i))
    }
  }
  for (let pass = 0; pass < 3; pass++) {
    sweep(ranks, (mine, theirs) => theirs < mine)
    sweep([...ranks].reverse(), (mine, theirs) => theirs > mine)
  }
  // 縦に長くなりすぎる列（止めているもの等）は、同じ種類のまとまりの中で折り返して横に並べる
  const tallest = Math.max(12, ...ranks.filter((r) => r !== 3).map((r) => cols.get(r)!.length))
  const out = new Map<string, { x: number; y: number }>()
  let cx = 0
  for (const r of ranks) {
    const col = cols.get(r)!
    const parts = Math.max(1, Math.ceil(col.length / tallest))
    const per = Math.ceil(col.length / parts)
    col.forEach((n, i) => {
      const sub = Math.floor(i / per)
      out.set(n.id, { x: (cx + sub) * (NODE_W + COL_GAP), y: (i % per) * (NODE_H + ROW_GAP) })
    })
    cx += parts
  }
  return out
}

// ---------------------------------------------------------------- 検索・一覧
export function searchNodes(g: GraphData, q: string, limit = 80): GNode[] {
  const words = q.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return g.nodes.filter((n) => {
    const hay = `${n.label} ${styleOf(n.type).label} ${n.status ?? ''}`
    return words.every((w) => hay.includes(w))
  }).slice(0, limit)
}

/** 応募の「止めているもの」（next-actions の blockers）を、グラフ上のノードに結ぶ（ラベル一致。つながる相手の中から） */
export function blockerNodeId(ix: Index, submissionId: string, label: string): string | null {
  for (const e of ix.adj.get(submissionId) ?? []) {
    const m = other(e, submissionId)
    if (ix.byId.get(m)?.label === label) return m
  }
  return null
}

export const appIdOf = (nodeId: string) => (nodeId.startsWith('id:app/') ? nodeId.slice('id:app/'.length) : null)
export const contestIdOf = (nodeId: string) => (nodeId.startsWith('id:contest/') ? nodeId.slice('id:contest/'.length) : null)

export const READINESS_MARK: Record<string, string> = {
  提出不可: '✕ 提出不可',
  要修正あり: '△ 要修正あり',
  未監査: '？ 未監査',
  選定待ち: '？ 選定待ち',
  提出可能な状態: '✓ 提出可能な状態（提出は総司令官）',
}
