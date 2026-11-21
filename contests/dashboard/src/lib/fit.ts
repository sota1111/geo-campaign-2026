import { CONTEST_INFO, type PlannedCount } from '@/apps/contests-info'
import { APPS, type AppMeta, type ContestId } from '@/apps/registry'
import { FIT_CAUTIONS, FIT_CELLS, FIT_COLUMNS, type FitCaution, type FitCell, type FitColumn, type FitMark } from '@/data/app-fit'

/** 記号の言葉（正本 app-contest-fit-20261121.md の「判定の規則」の意味欄どおり） */
export const MARK_WORD: Record<FitMark, string> = {
  '◎': 'このコンペ向けに作った',
  '○': '出せる',
  '△': '条件付き',
  '×': '出せない',
  '？': '要確認',
}

/** 列の短い名前（カード内の1行用） */
export function columnShort(col: FitColumn): string {
  switch (col.id) {
    case 'udc-2026': return 'UDC'
    case 'satellite-2026': return '衛星'
    case 'ichibiz-2026-business': return 'イチBiz ビジネス'
    case 'ichibiz-2026-idea': return 'イチBiz アイデア'
    case 'ichibiz-2026-realestate': return 'イチBiz 不動産'
    case 'odpt-2026': return 'ODPT'
    default: return col.name
  }
}

export function columnsOf(contest: ContestId): FitColumn[] {
  return FIT_COLUMNS.filter((c) => c.contest === contest)
}

export function cellOf(appId: string, columnId: string): FitCell | undefined {
  return FIT_CELLS.find((c) => c.app === appId && c.contest === columnId)
}

/** 選べるのは ◎○△ と ？（？は「要確認」つき）。× は選べない */
export function isSelectable(cell: FitCell | undefined): boolean {
  return !!cell && cell.mark !== '×'
}

/** 1つのコンペとの関連の強さ（score）。イチBiz は3部門のうち最大 */
export function contestScore(appId: string, contest: ContestId): number {
  return Math.max(0, ...columnsOf(contest).map((col) => cellOf(appId, col.id)?.score ?? 0))
}

/** 全列の score 合計 */
export function totalScore(appId: string): number {
  return FIT_COLUMNS.reduce((n, col) => n + (cellOf(appId, col.id)?.score ?? 0), 0)
}

/**
 * アプリの並び。先頭に来るのは「選んだアプリ」。
 *  - コンペを選んでいるとき: そのコンペ（イチBiz は3部門のどれか）を提出先に選んだアプリだけを先頭にする。他のコンペ向けに選んだアプリは先頭にせず、通常の並びに混ぜる。
 *  - コンペを選んでいないとき: 何かを提出先に選んだアプリを先頭にする。
 * それぞれの中は、コンペを選んだらそのコンペとの score の高い順、未選択なら全列の score 合計の高い順。
 * 同点は registry の並び（APPS の順）。targets を渡さなければ（選択なしとして）関連の強さだけで並べる。
 */
export function sortApps(apps: AppMeta[], contest: ContestId | null, targets: Targets = {}): AppMeta[] {
  const idx = (a: AppMeta) => APPS.findIndex((x) => x.id === a.id)
  const key = (a: AppMeta) => (contest ? contestScore(a.id, contest) : totalScore(a.id))
  const forContest = contest ? new Set(appsForContest(targets, contest)) : null
  const chosen = (a: AppMeta) => ((forContest ? forContest.has(a.id) : (targets[a.id]?.length ?? 0) > 0) ? 1 : 0)
  return [...apps].sort((a, b) => chosen(b) - chosen(a) || key(b) - key(a) || idx(a) - idx(b))
}

/** 提出先の選択: アプリ id → 列 id の配列 */
export type Targets = Record<string, string[]>

/** 外から来た値（localStorage 等）を、選べる組だけに絞る */
export function sanitizeTargets(raw: unknown): Targets {
  const out: Targets = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [app, cols] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(cols)) continue
    const ok = cols.filter((c): c is string => typeof c === 'string' && isSelectable(cellOf(app, c)))
    if (ok.length) out[app] = [...new Set(ok)]
  }
  return out
}

export function toggleTarget(t: Targets, appId: string, columnId: string): Targets {
  if (!isSelectable(cellOf(appId, columnId))) return t
  const cur = t[appId] ?? []
  const next = cur.includes(columnId) ? cur.filter((c) => c !== columnId) : [...cur, columnId]
  const out = { ...t }
  if (next.length) out[appId] = next
  else delete out[appId]
  return out
}

/** そのコンペ（イチBiz は3部門まとめて）に出すアプリの id（registry の並び） */
export function appsForContest(t: Targets, contest: ContestId): string[] {
  const cols = columnsOf(contest).map((c) => c.id)
  return APPS.filter((a) => (t[a.id] ?? []).some((c) => cols.includes(c))).map((a) => a.id)
}

/**
 * 「選んだ N件」の数え方（並び順の説明と提出予定数の比べで共通）。
 * コンペを渡せば、そのコンペ（イチBiz は3部門）の列に選んだ（アプリ×列）の組の数。渡さなければ全部の組の数。
 */
export function selectedCount(t: Targets, contest: ContestId | null): number {
  if (!contest) return Object.values(t).reduce((n, v) => n + v.length, 0)
  return columnsOf(contest).reduce((n, c) => appsForColumn(t, c.id).length + n, 0)
}

export function appsForColumn(t: Targets, columnId: string): string[] {
  return APPS.filter((a) => (t[a.id] ?? []).includes(columnId)).map((a) => a.id)
}

export interface ActiveCaution {
  caution: FitCaution
  /** 当たったアプリ */
  apps: string[]
  /** 何に当たったか（短い説明。画面に出す） */
  why: string
}

const byId = (id: string) => FIT_CAUTIONS.find((c) => c.id === id)!

/**
 * 選んだ組み合わせが、情報部の注意（cautions）に当たるかを調べる。
 * 当たりの条件（正本の注意の文言から読んだ。文言そのものは変えず、当たったときにそのまま出す）:
 *  C1 UDC に2件以上／C2 UDC に作品①②（odpt・udc-moritsuchi）以外、または3件以上／C3・C4 衛星に2件以上／C5 衛星に yabu・sugi・α／
 *  C6 イチBiz の同じ部門に2件以上、または同じアプリを2部門に／C7 solar-guard をビジネス部門に、または solar-guard と NB を同時に／
 *  C9 ODPT に2件以上／C13 C13 の対象アプリを2つ以上のコンペに
 */
export function activeCautions(t: Targets): ActiveCaution[] {
  const out: ActiveCaution[] = []
  const add = (id: string, apps: string[], why: string) => {
    if (apps.length) out.push({ caution: byId(id), apps: [...new Set(apps)], why })
  }
  const udc = appsForContest(t, 'udc-2026')
  if (udc.length >= 2) add('C1', udc, 'UDC に複数のアプリを選んでいます')
  add('C2', udc.filter((a) => a !== 'odpt' && a !== 'udc-moritsuchi'), 'UDC の登録枠は作品①②（odpt・udc-moritsuchi）。それ以外は、提出時にテーマを変えて出す場合に限ります')
  if (udc.length > 2) add('C2', udc, 'UDC の登録枠は2件です（同時に出せるのは最大2件の想定。未確認）')
  const sat = appsForContest(t, 'satellite-2026')
  if (sat.length >= 2) {
    const both = sat.includes('sat-b') && sat.includes('sat-alpha')
    add('C3', sat, both ? '衛星に B と α を両方選んでいます（同時提出は失格級）' : '衛星に複数のアプリを選んでいます')
    add('C4', sat, '衛星に複数のアプリ（同じ代表者の複数提案）を選んでいます')
  }
  add('C5', sat.filter((a) => ['sat-yabu', 'sat-sugi', 'sat-alpha'].includes(a)), '提案書の様式や未記入欄が残る案です')
  for (const col of columnsOf('ichibiz-2026')) {
    const apps = appsForColumn(t, col.id)
    if (apps.length >= 2) add('C6', apps, `${col.division}に複数のアプリを選んでいます`)
  }
  const bizCols = columnsOf('ichibiz-2026').map((c) => c.id)
  const multiDiv = APPS.filter((a) => bizCols.filter((id) => (t[a.id] ?? []).includes(id)).length >= 2).map((a) => a.id)
  add('C6', multiDiv, '同じアプリを複数の部門に選んでいます')
  const biz = appsForContest(t, 'ichibiz-2026')
  if ((t['biz-solar-guard'] ?? []).includes('ichibiz-2026-business')) add('C7', ['biz-solar-guard'], '太陽光 盗難対策マップをビジネス部門に選んでいます')
  else if (biz.includes('biz-solar-guard') && biz.includes('biz-business-nb')) add('C7', ['biz-solar-guard', 'biz-business-nb'], '太陽光 盗難対策マップと NB を両方選んでいます')
  const odpt = appsForContest(t, 'odpt-2026')
  if (odpt.length >= 2) add('C9', odpt, 'ODPT に複数のアプリを選んでいます')
  const c13 = byId('C13').apps
  const multiContest = APPS.filter((a) => {
    if (!c13.includes(a.id)) return false
    const cs = new Set(FIT_COLUMNS.filter((c) => (t[a.id] ?? []).includes(c.id)).map((c) => c.contest))
    return cs.size >= 2
  }).map((a) => a.id)
  add('C13', multiContest, '同じアプリを複数のコンペに選んでいます')
  return out
}

export const TARGETS_KEY = 'dashboard:submit-targets'

export function loadTargets(): Targets {
  try {
    const s = window.localStorage.getItem(TARGETS_KEY)
    if (!s) return {}
    const v = JSON.parse(s) as { targets?: unknown }
    return sanitizeTargets(v.targets)
  } catch {
    return {}
  }
}

export function saveTargets(t: Targets): boolean {
  try {
    window.localStorage.setItem(TARGETS_KEY, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), targets: t }))
    return true
  } catch {
    return false
  }
}

/** コピー・ダウンロード用の JSON（読みやすさのため名前を添える） */
export function targetsJson(t: Targets): string {
  const rows = APPS.filter((a) => t[a.id]?.length).map((a) => ({
    app: a.id,
    appName: a.name,
    targets: (t[a.id] ?? []).map((id) => {
      const col = FIT_COLUMNS.find((c) => c.id === id)!
      const cell = cellOf(a.id, id)!
      return { id, name: col.name, mark: cell.mark }
    }),
  }))
  return JSON.stringify(
    {
      note: 'このブラウザだけの下書き。正式な提出先は総司令官が参謀長に指示する',
      fitSource: 'reports/intel/app-contest-fit-20261121.json',
      savedAt: new Date().toISOString(),
      selections: rows,
    },
    null,
    2,
  )
}

// ---- 提出予定数（総司令官の決定）と、選んだ件数の比べ ----------------------------------------

export type PlanState = 'undecided' | 'match' | 'short' | 'over'

/** 状態の記号と言葉（色だけに頼らない） */
export function planStateText(state: PlanState, diff: number): { mark: string; word: string } {
  switch (state) {
    case 'match': return { mark: '✓', word: '予定どおり' }
    case 'short': return { mark: '▼', word: `あと${-diff}件で予定` }
    case 'over': return { mark: '▲', word: `予定より${diff}件多い` }
    default: return { mark: '', word: '' }
  }
}

export interface PlanPartView {
  label: string
  planned: number
  /** 区分ごとに数えられるとき（下書きに列がある）だけ数を持つ。持たない区分は null */
  chosen: number | null
  state: PlanState
  diff: number
}

export interface PlanView {
  planned: number | null
  chosen: number
  state: PlanState
  /** 選んだ − 予定。undecided のときは 0 */
  diff: number
  parts: PlanPartView[]
  src: string
}

function stateOf(planned: number, chosen: number): { state: PlanState; diff: number } {
  const diff = chosen - planned
  return { state: diff === 0 ? 'match' : diff < 0 ? 'short' : 'over', diff }
}

/**
 * 提出予定数と、いま提出先に選んでいる件数（下書き）を比べる。
 * 選んだ件数 = そのコンペの列に選んだ（アプリ×列）の組の数。衛星のスポンサー向け／一般は下書きに区別がないので、合計だけで比べる。
 */
export function planView(contestId: ContestId, t: Targets, plan?: PlannedCount): PlanView {
  const p = plan ?? CONTEST_INFO.find((c) => c.id === contestId)!.planned
  const chosen = selectedCount(t, contestId)
  const parts: PlanPartView[] = p.parts.map((x) => {
    const got = x.columnId ? appsForColumn(t, x.columnId).length : null
    return { label: x.label, planned: x.count, chosen: got, ...(got === null ? { state: 'undecided' as PlanState, diff: 0 } : stateOf(x.count, got)) }
  })
  if (p.total === null) return { planned: null, chosen, state: 'undecided', diff: 0, parts, src: p.src }
  return { planned: p.total, chosen, ...stateOf(p.total, chosen), parts, src: p.src }
}
