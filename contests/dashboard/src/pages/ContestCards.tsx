import { motion } from 'motion/react'
import { ArrowRight } from 'lucide-react'
import { NEW_PLAN_LABEL, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { DataBadge } from '@/components/shared/DataBadge'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_LABEL, contestDecisionTexts, otherNextCount } from '@/data/status'
import { PLANS } from '@/data/progress'
import { contestColor } from '@/data/colors'
import { CONTESTS } from '@/apps/registry'
import { appUrl, contestUrl } from '@/lib/data'
import { pendingLabel, useIsPending } from '@/lib/availability'

/** 出典の小さな添え書き */
export function Src({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 text-[0.6875rem] text-slate-600">［出典: {children}］</span>
}

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
      title={a.purpose}
      className={`flex min-w-0 flex-col gap-1 rounded-lg border-2 border-l-8 bg-white p-2 text-xs shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${color.edge} ${isNew ? 'border-slate-500' : 'border-slate-300'}`}
    >
      <span className="flex flex-wrap items-center gap-1">
        {isNew ? (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white" data-testid="new-plan-tag">{NEW_PLAN_LABEL}</span>
        ) : (
          <span className="rounded border border-slate-600 px-1.5 py-0.5 font-bold" data-testid="current-plan-tag">今の案</span>
        )}
        <DataBadge kind={a.dataKind} className="px-1.5 py-0 text-xs" />
        {missing && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-950" data-testid={`mini-pending-${a.id}`}>{pendingLabel(a)}</span>
        )}
      </span>
      <span className="text-sm font-bold leading-snug text-slate-900">{a.name}</span>
      <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-800">
        {plan && (
          <>
            <span className={`rounded border px-1 ${plan.intent === '提出予定' ? 'border-slate-700 font-bold' : 'border-dashed border-slate-500'}`}>{plan.intent}</span>
            <span className="tabular-nums" title="案の進み具合（reports/ops の進捗一覧）">
              済{plan.done.length}・残{plan.todo.length + (plan.decisions?.length ?? 0)}
            </span>
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-0.5 font-bold text-slate-900">
          {missing ? '未収録の案内' : '開く'}
          <ArrowRight className="size-3" aria-hidden />
        </span>
      </span>
    </motion.a>
  )
}

/** 今の案と、その隣に置く新しい案を1つの組にする（概要ページと同じ組） */
function groupsOf(info: ContestInfo) {
  const apps = orderedAppsByContest(info.id)
  const cur = apps.filter((a) => !isNewPlan(a))
  const groups = cur.map((c) => ({ head: c, items: [c, ...apps.filter((x) => isNewPlan(x) && x.pairWith === c.id)] }))
  const used = new Set(groups.flatMap((g) => g.items.map((x) => x.id)))
  const orphans = apps.filter((a) => !used.has(a.id))
  return orphans.length ? [...groups, { head: orphans[0], items: orphans }] : groups
}

/**
 * コンペの大カード。上の帯（コンペ名・次の締切・提出可否・判断待ち・次にやること）を押すとコンペ概要ページへ、
 * 下に並ぶ小カード（アプリ）を押すとそのアプリのページへ移る。コンペごとに色と記号を持つ（色だけに頼らない）。
 * 概要・審査基準・主なルール・提出可能数は、折りたたみ（<details>）に入れて、全文は概要ページに置く。
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
        className="group block outline-none focus-visible:shadow-[inset_0_0_0_3px_#fff,inset_0_0_0_6px_#0f172a]"
        title={`${contest.name}の概要・進捗・審査基準を見る`}
      >
        <span className={`flex items-center justify-between gap-2 px-3 py-1.5 transition-[filter] group-hover:brightness-110 ${color.band}`}>
          <span className="text-base font-bold leading-tight">
            <span aria-hidden>{color.mark} </span>
            {contest.name}
          </span>
          <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-bold group-hover:underline">
            概要・進捗へ
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </span>
        <span className="block space-y-1 bg-white/70 px-3 py-1.5 text-xs leading-snug">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="row-deadline">
            <span>
              次の締切 <span className="font-bold">{nd.text}</span>
              {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
            </span>
            <Remaining at={nd.at} />
            <span className="font-bold" data-testid="row-status" title={st.gap}>
              <span aria-hidden>▲ </span>
              {STATUS_LABEL[info.id]}
              <span className="font-normal">（提出不可）</span>
            </span>
          </span>
          <span className="block" data-testid="row-asks" title={asks.join(' ／ ')}>
            <span className="rounded bg-amber-100 px-1 font-bold text-amber-950">
              <span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件
            </span>{' '}
            {asks[0]}
            {asks.length > 1 && `（ほか${asks.length - 1}件）`}
          </span>
          <span className="block" title={next.text}>
            <span className="font-bold">次にやること: </span>
            <span className="font-medium" data-testid="row-next">{next.text}</span>
            {more > 0 && <span className="ml-1 whitespace-nowrap text-slate-700" data-testid="row-more">（ほか{more}件）</span>}
          </span>
        </span>
      </a>
      <details className="border-t bg-white/70 px-3 py-1 text-xs" data-testid={`facts-${info.id}`}>
        <summary className="cursor-pointer py-1 font-bold">概要・審査基準・主なルール・提出可能数を見る（出典つき。全文は概要ページ）</summary>
        <dl className="grid gap-x-4 gap-y-2 pb-2 md:grid-cols-2">
          <div>
            <dt className="font-bold">概要（何を募集するか）</dt>
            <dd className="leading-snug">{info.summary}<Src>{info.sources[0].label}</Src></dd>
          </div>
          <div>
            <dt className="font-bold">審査基準</dt>
            <dd className="leading-snug">
              {info.criteria.map((c) => c.name).join('・')}
              <Src>{info.criteriaTitle}。{info.criteriaNote}</Src>
            </dd>
          </div>
          <div>
            <dt className="font-bold">主なルール</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 leading-snug">
                {info.keyRules.map((r) => (
                  <li key={r.text}>
                    {r.unconfirmed && <span className="font-bold">（要確認）</span>}
                    {r.text}
                    <Src>{r.src}</Src>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="rounded border-l-4 border-slate-700 bg-slate-50 px-1.5 py-1">
            <dt className="font-bold">提出可能数</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 leading-snug">
                {info.limits.map((r) => (
                  <li key={r.text} data-testid="limit-item">
                    {r.unconfirmed && <span className="font-bold">（未確認）</span>}
                    {r.text}
                    <Src>{r.src}</Src>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        </dl>
      </details>
      <div className="px-3 pb-2 pt-1.5">
        <h3 className="mb-1 text-xs font-bold text-slate-900">このコンペのアプリ（{apps.length}件）</h3>
        <div className="flex flex-wrap items-stretch gap-2" data-testid={`apps-${info.id}`}>
          {groupsOf(info).map((g) => (
            <div
              key={g.head.id}
              className={`grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))] ${g.items.length > 1 ? 'rounded-lg border-2 border-dashed border-slate-500 bg-white/60 p-1.5' : ''}`}
              style={{ flexGrow: g.items.length, flexBasis: `${g.items.length * 12.5}rem` }}
              data-app-group={g.head.id}
              role="group"
              aria-label={g.items.length > 1 ? `${g.head.division}: 今の案と新しい案の組` : undefined}
            >
              {g.items.length > 1 && (
                <span className="col-span-full text-[0.6875rem] font-bold text-slate-800">比べる組: {g.head.division}（今の案と新しい案）</span>
              )}
              {g.items.map((a) => (
                <MiniCard key={a.id} a={a} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </motion.article>
  )
}
