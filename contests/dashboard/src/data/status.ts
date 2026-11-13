// 各コンペの「提出までの状況」と、全コンペ横断の「総司令官のやること」。元データは progress.ts と同じ正本
// （reports/ops/status-20261113.md）。文言は正本を短く言い換えたもの。事実は変えない。
import type { ContestId } from '@/apps/registry'
import { DECISIONS, PLANS, commanderTasks, isConditionalPlan, type Owner } from '@/data/progress'

export interface NextAction {
  text: string
  /** 担当。事務局待ちは「待ち」。判断は総司令官 */
  owner: Owner
  /** 判断（決める事項）なら true */
  decision?: boolean
}

export interface ContestStatus {
  /** 済んだことの1行（正本の「完了」の要約） */
  done: string
  /** 提出可能か、あと何が足りないかの1行（名詞止め） */
  gap: string
  /** 次にやること（最大3つ） */
  next: NextAction[]
}

export const CONTEST_STATUS: Record<ContestId, ContestStatus> = {
  'udc-2026': {
    done: '概要登録（作品①②・11/9）／作品①のアプリ実装と説明の下書き／作品②のアイデア説明とデモ',
    gap: '提出不可（本応募）。公開URL・記入が未了。概要登録は済（11/9）',
    next: [
      { text: '作品②: 本応募でアプリにするか', owner: '総司令官', decision: true },
      { text: '作品①: アプリの公開URL', owner: '総司令官' },
      { text: '本応募フォームの案内（11月末、事務局から）', owner: '待ち' },
    ],
  },
  'satellite-2026': {
    done: '提案書とデモ（A・B・α）／αはアグレッサー・作戦研究班・憲兵まで',
    gap: '提出不可。申請者欄・体制欄が未記入、B とαが未決',
    next: [
      { text: 'B とαのどちらを出すか、FAQ7 の確認', owner: '総司令官', decision: true },
      { text: '申請者欄・体制欄の記入', owner: '総司令官' },
      { text: 'Word での体裁確認、フォームから提出', owner: '総司令官' },
    ],
  },
  'ichibiz-2026': {
    done: '全6案の提出文とデモ（ビジネス今の案・NB、アイデア今の案・IN1、不動産今の案・RN1）／ビジネス今の案は補足資料 PPT（7枚）',
    gap: '提出不可。本人欄・背景欄が未記入、部門ごとの出す案が未決',
    next: [
      { text: '部門ごとに今の案・新しい案・両方のどれを出すか', owner: '総司令官', decision: true },
      { text: '本人欄・背景欄の記入（生成AI条項のため本人の書き換えが必須）', owner: '総司令官' },
      { text: 'ビジネス部門 PPT の記入7か所', owner: '総司令官' },
    ],
  },
  'odpt-2026': {
    done: '診断マップのアプリ実装・初見ユーザー試験の改善／N2 のアプリ第1版と昼間1時間の品質測定',
    gap: '提出不可。アプリ未公開、応募フォーム下書き作業中、憲兵の監査は未実施',
    next: [
      { text: 'N2: 連続収集の場所と担当', owner: '総司令官', decision: true },
      { text: 'アプリの公開', owner: '総司令官' },
      { text: '応募フォーム各項目の下書き（PR #12）', owner: '部隊' },
    ],
  },
}

export interface CrossItem {
  at?: string
  label: string
  kind: 'decision' | 'task'
  contest: ContestId | 'registry'
  /** 案の短い名前（判断では空） */
  who: string
  text: string
  /** 判断の結果しだいで要る作業（まだ選ばれていない案の作業）。判断の行の下に畳んで出す */
  children?: CrossItem[]
}

const toTask = (r: ReturnType<typeof commanderTasks>[number]): CrossItem => ({
  at: r.plan.deadlineAt,
  label: r.plan.deadlineLabel,
  kind: 'task',
  contest: r.plan.contest,
  who: r.plan.short,
  text: r.task.text,
})

/**
 * 全コンペ横断の「総司令官のやること」（判断＋作業）。締切順、同じ締切の中は判断が先。締切の記載がない判断は最後。
 * まだ選ばれていない案（比較中）の作業は、紐づく判断の children に入れ、本体には出さない。
 */
export function crossItems(): CrossItem[] {
  const all = commanderTasks()
  const items: CrossItem[] = [
    ...DECISIONS.map((d) => ({
      at: d.deadlineAt,
      label: d.deadlineLabel ?? '',
      kind: 'decision' as const,
      contest: d.contest,
      who: '',
      text: d.text.replace(/^[^:]*: /, ''),
      children: all
        .filter((r) => d.plans?.includes(r.plan.id) && isConditionalPlan(r.plan))
        .map(toTask),
    })),
    ...commanderTasks(PLANS, false).map(toTask),
  ]
  const t = (x: CrossItem) => (x.at ? Date.parse(x.at) : Infinity)
  const k = (x: CrossItem) => (x.kind === 'decision' ? 0 : 1)
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => t(a.x) - t(b.x) || k(a.x) - k(b.x) || a.i - b.i)
    .map((v) => v.x)
}

/** 一覧の「状況」の理由（1行。CONTEST_STATUS.gap の要約。事実は同じ） */
export const STATUS_REASON: Record<ContestId, string> = {
  'udc-2026': '本応募: 公開URL・記入が未了（概要登録は済）',
  'satellite-2026': '申請者欄・体制欄が未記入、B とαが未決',
  'ichibiz-2026': '本人欄・背景欄が未記入、部門ごとの案が未決',
  'odpt-2026': 'アプリ未公開、応募フォーム下書き中、憲兵の監査は未実施',
}

/**
 * 一覧の「状況」の札。そのコンペで今いちばん止まっている理由の種類（根拠は正本の残作業）。
 * 4コンペで文言が重ならないようにしてある。提出可否は、一覧上部の「どの案も提出不可」が示す。
 */
export const STATUS_LABEL: Record<ContestId, string> = {
  'satellite-2026': '判断待ち',
  'ichibiz-2026': '判断・記入待ち',
  'udc-2026': '案内・公開待ち',
  'odpt-2026': '下書き・公開待ち',
}

/** 段階の印: ✓ 済、？ 判断待ち・要確認、□ 未着手・作業中 */
export type StageMark = '✓' | '？' | '□'
export interface Stage {
  label: string
  mark: StageMark
  /** 補足（かっこで添える） */
  note?: string
}

/**
 * 一覧の進捗: 提出までの段階。件数ではなく、何が済んで何が残っているかを段階の並びで示す。
 * 段階の名前はコンペごとに正本（reports/ops/status-20261113.md）の完了・残作業から決めた。
 * 比較中の案は「案の選定 ？」に分けて出し、提出予定の案の段階には混ぜない。
 */
export const STAGES: Record<ContestId, Stage[]> = {
  'satellite-2026': [
    { label: '提出文', mark: '✓' },
    { label: 'デモ', mark: '✓' },
    { label: '案の選定', mark: '？', note: 'B かα' },
    { label: '本人欄', mark: '□' },
    { label: '提出', mark: '□' },
  ],
  'ichibiz-2026': [
    { label: '提出文', mark: '✓' },
    { label: 'デモ', mark: '✓' },
    { label: '案の選定', mark: '？', note: '部門ごと' },
    { label: '本人欄・PPT', mark: '□' },
    { label: '登録', mark: '□' },
  ],
  'udc-2026': [
    { label: '概要登録', mark: '✓', note: '11/9' },
    { label: '説明・デモ', mark: '✓', note: '下書き' },
    { label: '作品②の形', mark: '？', note: 'アプリにするか' },
    { label: '公開URL', mark: '□' },
    { label: '本応募', mark: '□' },
  ],
  'odpt-2026': [
    { label: 'アプリ', mark: '✓' },
    { label: '提出文', mark: '□', note: '下書き中' },
    { label: 'N2', mark: '？', note: '収集の判断' },
    { label: '公開・監査', mark: '□' },
    { label: '提出', mark: '□' },
  ],
}

/** 総司令官への「次の一手」の、先頭以外の件数（詳細の「判断待ち」＋「次にやること」の合計から先頭の1件を引く） */
export function otherNextCount(contest: ContestId): number {
  const decisions = crossItems().filter((i) => i.kind === 'decision' && i.contest === contest).length
  const tasks = CONTEST_STATUS[contest].next.filter((n) => !n.decision).length
  return Math.max(0, decisions + tasks - 1)
}
