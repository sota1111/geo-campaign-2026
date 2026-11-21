import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { NEW_PLAN_LABEL, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_LABEL, contestDecisionTexts, otherNextCount } from '@/data/status'
import { PLANS } from '@/data/progress'
import { contestColor } from '@/data/colors'
import { CONTESTS } from '@/apps/registry'
import { appUrl, contestUrl } from '@/lib/data'
import { pendingLabel, useIsPending } from '@/lib/availability'

/** 小カードに添える、そのアプリの案の進み具合（PLANS の1件。同じコンペの案だけ。出さない案は除く） */
function planOf(a: AppMeta) {
  return PLANS.find((p) => p.contest === a.contest && p.intent !== '出さない' && (p.appIds ?? (p.appId ? [p.appId] : [])).includes(a.id))
}

/** アプリの小カード。押すとそのアプリのページ（審査待ち・未収録のアプリは、未収録の案内のページ）へ移る */
export function MiniCard({ a }: { a: AppMeta }) {
  const isNew = isNewPlan(a)
  const missing = useIsPending(a)
  const color = contestColor(a.contest)
  const plan = planOf(a)
  return (
    <motion.a
      href={appUrl(a.id)}
      data-app-card={a.id}
      data-app-link={a.id}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={`flex min-w-0 flex-col gap-1 rounded-lg border-2 border-l-8 bg-white p-2 text-xs shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${color.edge} ${isNew ? 'border-dashed border-slate-500' : 'border-slate-300'}`}
    >
      <span className="flex flex-wrap items-center gap-1">
        {isNew ? (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white" data-testid="new-plan-tag">{NEW_PLAN_LABEL}</span>
        ) : (
          <span className="rounded border border-slate-600 px-1.5 py-0.5 font-bold" data-testid="current-plan-tag">今の案</span>
        )}
        {missing && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-950" data-testid={`mini-pending-${a.id}`}>{pendingLabel(a)}</span>
        )}
      </span>
      <span className="text-sm font-bold leading-snug text-slate-900">{a.name}</span>
      <span className="line-clamp-2 leading-snug text-slate-700" title={a.purpose}>{a.purpose}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-slate-800">
        {plan && (
          <>
            <span className={`rounded border px-1 ${plan.intent === '提出予定' ? 'border-slate-700 font-bold' : 'border-dashed border-slate-500'}`}>{plan.intent}</span>
            <span className="tabular-nums" title="案の進み具合（reports/ops の進捗一覧）">
              <span aria-hidden>✓</span>
              <span className="sr-only">済</span>
              {plan.done.length}<span aria-hidden>□</span>
              <span className="sr-only">残り</span>
              {plan.todo.length + (plan.decisions?.length ?? 0)}
            </span>
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 font-bold text-slate-900">
          {missing ? '未収録の案内へ' : 'アプリを開く'}
          <ArrowRight className="size-3" aria-hidden />
        </span>
      </span>
    </motion.a>
  )
}

/**
 * コンペの大カード。上の帯（コンペ名・次の締切・提出可否・判断待ち・次にやること）を押すとコンペ概要ページへ、
 * 下に並ぶ小カード（アプリ）を押すとそのアプリのページへ移る。コンペごとに色と記号を持つ（色だけに頼らない）。
 */
export function BigCard({ info, index }: { info: ContestInfo; index: number }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const color = contestColor(info.id)
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const asks = contestDecisionTexts(info.id)
  const next = st.next.find((n) => !n.decision) ?? st.next[0]
  const more = otherNextCount(info.id)
  const apps = orderedAppsByContest(info.id)
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className={`overflow-hidden rounded-xl border-2 shadow-sm ${color.tint}`}
      data-testid={`contest-${info.id}`}
      aria-label={contest.name}
    >
      <a
        href={contestUrl(info.id)}
        data-testid={`row-${info.id}`}
        data-contest-card={info.id}
        className="block focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-slate-900"
        title={`${contest.name}の概要・進捗・審査基準を見る`}
      >
        <span className={`flex items-center justify-between gap-2 px-3 py-2 ${color.band}`}>
          <span className="text-base font-bold leading-tight">
            <span aria-hidden>{color.mark} </span>
            {contest.name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-bold">
            概要・進捗へ
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </span>
        <span className="block space-y-1.5 bg-white/70 px-3 py-2 text-xs">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="row-deadline">
            <span>
              次の締切 <span className="font-bold">{nd.text}</span>
              {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
            </span>
            <Remaining at={nd.at} />
            <span className="font-bold" data-testid="row-status" title={st.gap}>
              <span aria-hidden>▲ </span>提出不可
              <span className="font-normal">（{STATUS_LABEL[info.id]}）</span>
            </span>
          </span>
          <span className="block rounded border-l-4 border-amber-700 bg-amber-50 px-1.5 py-1 leading-snug" data-testid="row-asks">
            <span className="font-bold text-amber-950">
              <span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件
            </span>
            {asks.length > 0 && (
              <span className="mt-0.5 block" title={asks.join(' ／ ')}>
                {asks[0]}
                {asks.length > 1 && `（ほか${asks.length - 1}件）`}
              </span>
            )}
          </span>
          <span className="block leading-snug" title={next.text}>
            <span className="font-bold">次にやること: </span>
            <span className="font-medium" data-testid="row-next">{next.text}</span>
            {more > 0 && <span className="ml-1 whitespace-nowrap text-slate-700" data-testid="row-more">（ほか{more}件）</span>}
          </span>
        </span>
      </a>
      <div className="px-3 pb-3 pt-2">
        <h3 className="mb-1.5 text-xs font-bold text-slate-900">
          このコンペのアプリ（{apps.length}件）
        </h3>
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]" data-testid={`apps-${info.id}`}>
          {apps.map((a) => (
            <MiniCard key={a.id} a={a} />
          ))}
        </div>
      </div>
    </motion.article>
  )
}
