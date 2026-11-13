// 第3回評価（AI＝GPT-6.1 sol low の評価者10名）の集計結果の読み出し。数値は scripts/aggregate-eval3.mjs の出力
// （src/data/eval-r3.json）からだけ表示する。ここに点数は書かない。
import raw from '@/data/eval-r3.json'
import type { Eval3Data, Stat } from '../../scripts/eval3-lib.mjs'
import { APPS, CONTESTS, isNewPlan, type AppMeta, type ContestId } from './registry'

export const EVAL3 = raw as unknown as Eval3Data
export type { Stat, Eval3Data }

/** C の項目名（reports/ops/dashboard-rubric-20261111.md） */
export const C_LABELS: Record<string, string> = {
  'C-ODPT1': '社会課題解決への寄与',
  'C-ODPT2': 'オープンデータ活用のインパクト',
  'C-ODPT3': '技術的完成度',
  'C-ODPT4': 'UI/UXの完成度',
  'C-UDC1': '実用度',
  'C-UDC2': '完成度',
  'C-UDC3': '挑戦度',
  'C-SAT1': '募集テーマ合致性',
  'C-SAT2': '事業スコープ・衛星データ活用の妥当性',
  'C-SAT3': '事業の実現性・収益性',
  'C-SAT4': '事業化による社会発展性',
  'C-SAT5': 'システム開発の進捗（加点）',
  'C-BIZ1': '独創性',
  'C-BIZ2': '社会的インパクト',
  'C-BIZ3': '実現可能性',
  'C-BIZ4': '持続性',
}
const CONTEST_PREFIX: Record<ContestId, string> = {
  'odpt-2026': 'C-ODPT', 'udc-2026': 'C-UDC', 'satellite-2026': 'C-SAT', 'ichibiz-2026': 'C-BIZ',
}

/** そのコンペの C の項目キー（番号順） */
export function cKeysOf(contest: ContestId): string[] {
  const p = CONTEST_PREFIX[contest]
  return Object.keys(C_LABELS).filter((k) => k.startsWith(p))
}

/** 比べる組: 今の案ごとに、pairWith でその隣に並ぶ新しい案を付ける。組が2件以上のものを先に並べる */
export function compareGroups(contest: ContestId): AppMeta[][] {
  const apps = APPS.filter((a) => a.contest === contest)
  return apps
    .filter((a) => !isNewPlan(a))
    .map((a) => [a, ...apps.filter((x) => isNewPlan(x) && x.pairWith === a.id)])
    .sort((x, y) => y.length - x.length)
}

export function contestShort(id: ContestId): string {
  return CONTESTS.find((c) => c.id === id)?.short ?? id
}

/** 達成数の表示（例: 3/4名） */
export function goalText(g?: { achieved: number; n: number }): string {
  return g ? `${g.achieved}/${g.n}名` : '—'
}
export function statText(s: Stat | null | undefined): { mean: string; range: string; n: string } {
  return s ? { mean: s.mean.toFixed(2), range: `${s.min}〜${s.max}`, n: `${s.n}名` } : { mean: '—', range: '—', n: '—' }
}
