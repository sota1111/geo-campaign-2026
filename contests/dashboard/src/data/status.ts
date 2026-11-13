// 各コンペの「提出までの状況」と、全コンペ横断の「総司令官のやること」。元データは progress.ts と同じ正本
// （reports/ops/status-20261113.md）。文言は正本を短く言い換えたもの。事実は変えない。
import type { ContestId } from '@/apps/registry'
import { DECISIONS, commanderTasks, type Owner } from '@/data/progress'

export interface NextAction {
  text: string
  /** 担当。事務局待ちは「待ち」 */
  owner: Owner | '待ち'
  /** 判断（決める事項）なら true */
  decision?: boolean
}

export interface ContestStatus {
  /** 提出可能か、あと何が足りないかの1行（名詞止め） */
  gap: string
  /** 次にやること（最大3つ） */
  next: NextAction[]
}

export const CONTEST_STATUS: Record<ContestId, ContestStatus> = {
  'udc-2026': {
    gap: '概要登録は済（11/9）。本応募は公開URL・記入が未了',
    next: [
      { text: '作品②: 本応募でアプリにするか', owner: '総司令官', decision: true },
      { text: '作品①: アプリの公開URL', owner: '総司令官' },
      { text: '本応募フォームの案内（11月末、事務局から）', owner: '待ち' },
    ],
  },
  'satellite-2026': {
    gap: '提出不可。申請者欄・体制欄が未記入、B とαが未決',
    next: [
      { text: 'B とαのどちらを出すか、FAQ7 の確認', owner: '総司令官', decision: true },
      { text: '申請者欄・体制欄の記入', owner: '総司令官' },
      { text: 'Word での体裁確認、フォームから提出', owner: '総司令官' },
    ],
  },
  'ichibiz-2026': {
    gap: '提出不可。本人欄・背景欄が未記入、部門ごとの出す案が未決',
    next: [
      { text: '部門ごとに今の案・新しい案・両方のどれを出すか', owner: '総司令官', decision: true },
      { text: '本人欄・背景欄の記入（生成AI条項のため本人の書き換えが必須）', owner: '総司令官' },
      { text: 'ビジネス部門 PPT の記入7か所', owner: '総司令官' },
    ],
  },
  'odpt-2026': {
    gap: '提出不可。アプリ未公開、応募フォーム下書き作業中、憲兵の監査は未実施',
    next: [
      { text: 'アプリの公開', owner: '総司令官' },
      { text: 'N2: 連続収集の場所と担当', owner: '総司令官', decision: true },
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
}

/** 全コンペ横断の「総司令官のやること」（判断＋作業）。締切順。締切の記載がない判断は最後 */
export function crossItems(): CrossItem[] {
  const items: CrossItem[] = [
    ...DECISIONS.map((d) => ({
      at: d.deadlineAt,
      label: d.deadlineLabel ?? '',
      kind: 'decision' as const,
      contest: d.contest,
      who: '',
      text: d.text.replace(/^[^:]*: /, ''),
    })),
    ...commanderTasks().map((r) => ({
      at: r.plan.deadlineAt,
      label: r.plan.deadlineLabel,
      kind: 'task' as const,
      contest: r.plan.contest,
      who: r.plan.short,
      text: r.task.text,
    })),
  ]
  const t = (x: CrossItem) => (x.at ? Date.parse(x.at) : Infinity)
  const k = (x: CrossItem) => (x.kind === 'decision' ? 0 : 1)
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => t(a.x) - t(b.x) || k(a.x) - k(b.x) || a.i - b.i)
    .map((v) => v.x)
}
