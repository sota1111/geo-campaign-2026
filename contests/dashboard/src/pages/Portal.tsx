import { MotionConfig } from 'motion/react'
import { APPS, isNewPlan } from '@/apps/registry'
import { contestsByDeadline } from '@/apps/contests-info'
import { BigCard } from '@/pages/ContestCards'
import { asOf } from '@/pages/Progress'
import { OVERALL, PROGRESS_SOURCE } from '@/data/progress'

/**
 * ポータル（統合ダッシュボードのトップ）。コンペごとの大カード（締切順。色と記号つき）の中に、アプリの小カードを並べる。
 * 大カードの上の帯を押すとコンペ概要ページ（contest/<id>/）へ、小カードを押すとそのアプリのページ（apps/<id>/）へ移る。
 * 案ごとのチェックリスト・判断待ちの詳細・AI評価などの詳細は、コンペ概要ページにある。
 */
export default function Portal() {
  const sorted = contestsByDeadline()
  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-6xl space-y-3">
        <h1 className="sr-only">統合ダッシュボード</h1>
        <header className="text-xs text-slate-700" data-testid="portal-legend">
          {asOf} 時点・締切順。コンペの帯を押すと概要・進捗へ、アプリのカードを押すとアプリへ移ります　<span aria-hidden>✓</span> 済　<span aria-hidden>□</span> 残り　<span aria-hidden>？</span> 総司令官の判断待ち
        </header>
        <ul className="space-y-0.5 text-xs" data-testid="progress-overall">
          <li className="flex gap-1.5">
            <span aria-hidden>▲</span>
            <span className="font-bold">どの案も提出不可: 本人欄（氏名・所属・体制・経験）が未記入</span>
          </li>
          <li className="flex gap-1.5">
            <span aria-hidden>▲</span>
            <span title={OVERALL[1]}>マージ保留（総司令官補佐が止めた PR）: PR #35・#36・#18・#19・#27</span>
          </li>
        </ul>

        <section aria-label="コンペ" data-testid="contest-list" className="grid items-start gap-3">
          {sorted.map((c, i) => (
            <BigCard key={c.id} info={c} index={i} />
          ))}
        </section>

        <div className="border-t pt-2 text-xs" data-testid="progress-overall-full">
          <p className="font-bold">全体（{PROGRESS_SOURCE}）</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {OVERALL.map((t) => (
              <li key={t} className="break-words">{t}</li>
            ))}
          </ul>
        </div>
        <p className="border-t pt-2 text-xs text-slate-700" data-testid="portal-source">
          出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は {PROGRESS_SOURCE}（{asOf} 時点）。今の案{APPS.filter((a) => !isNewPlan(a)).length}件と、新しい案（比較用・未選定）
          {APPS.filter(isNewPlan).length}件のデモを、各コンペの大カードの中に並べています。
        </p>
      </div>
    </MotionConfig>
  )
}
