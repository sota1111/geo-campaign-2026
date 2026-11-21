import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { NEW_PLAN_LABEL, isNewPlan, getApp, CONTESTS, type AppMeta, type ContestId } from '@/apps/registry'
import { nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { DataBadge } from '@/components/shared/DataBadge'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_LABEL, contestDecisionTexts, otherNextCount } from '@/data/status'
import { contestColor } from '@/data/colors'
import { FIT_COLUMNS } from '@/data/app-fit'
import { appUrl, contestUrl } from '@/lib/data'
import { pendingLabel, useIsPending } from '@/lib/availability'
import { Src, planOf } from '@/pages/ContestCards'
import {
  MARK_WORD, appsForColumn, appsForContest, cellOf, columnShort, columnsOf, contestScore, isSelectable, totalScore,
  type ActiveCaution, type Targets,
} from '@/lib/fit'

const appName = (id: string) => getApp(id)?.name ?? id

/** 押した先がボタン・リンク・折りたたみのときは、カード本体の「選択」を起こさない */
function isInteractive(el: EventTarget | null): boolean {
  return el instanceof Element && !!el.closest('a, button, summary, details, input, label')
}

/**
 * コンペのカード（4枚を横一列に並べる）。本体を押す（または「このコンペで並べる」）と、アプリの行が
 * このコンペとの関連の強い順に並び替わる。「概要・進捗へ →」でコンペ概要ページ（contest/<id>/）へ。
 */
export function ContestTopCard({
  info, selected, onSelect, targets,
}: { info: ContestInfo; selected: boolean; onSelect: () => void; targets: Targets }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const color = contestColor(info.id)
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const asks = contestDecisionTexts(info.id)
  const next = st.next.find((n) => !n.decision) ?? st.next[0]
  const more = otherNextCount(info.id)
  const cols = columnsOf(info.id)
  const chosen = appsForContest(targets, info.id)
  return (
    <article
      data-testid={`contest-${info.id}`}
      data-contest-card={info.id}
      data-selected={selected ? 'true' : 'false'}
      aria-label={contest.name}
      onClick={(e) => {
        if (!isInteractive(e.target)) onSelect()
      }}
      className={`flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 shadow-sm ${color.tint} ${selected ? 'outline outline-4 outline-offset-2 outline-slate-900' : ''}`}
    >
      <h3 className={`flex items-start justify-between gap-2 px-3 py-1.5 text-sm font-bold leading-snug ${color.band}`}>
        <span className="min-w-0">
          <span aria-hidden>{color.mark} </span>
          {contest.name}
        </span>
        {selected && <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-xs text-slate-900" data-testid="selected-tag"><span aria-hidden>✓ </span>選択中</span>}
      </h3>
      <div className="flex flex-1 flex-col gap-1.5 bg-white/70 px-3 py-2 text-xs leading-snug">
        <a
          href={contestUrl(info.id)}
          data-testid={`row-${info.id}`}
          className="inline-flex min-h-8 items-center gap-0.5 self-start font-bold text-slate-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          title={`${contest.name}の概要・進捗・審査基準を見る`}
        >
          概要・進捗へ
          <ArrowRight className="size-4" aria-hidden />
        </a>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="row-deadline">
          <span>
            次の締切 <span className="font-bold">{nd.text}</span>
            {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
          </span>
          <Remaining at={nd.at} />
        </p>
        {info.id === 'ichibiz-2026' && (
          <ul className="space-y-0.5 rounded border border-slate-300 bg-white px-1.5 py-1" data-testid="ichibiz-divisions" aria-label="3つの部門">
            {cols.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-bold">{c.division}</span>
                <span className="text-slate-800">締切 {c.deadline.replace('2026-', '').replace('-', '/')}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="font-bold" data-testid="row-status" title={st.gap}>
          <span aria-hidden>▲ </span>
          {STATUS_LABEL[info.id]}
          <span className="font-normal">（提出不可）</span>
        </p>
        <p data-testid="row-asks" title={asks.join(' ／ ')}>
          <span className="rounded bg-amber-100 px-1 font-bold text-amber-950">
            <span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件
          </span>{' '}
          {asks[0]}
          {asks.length > 1 && `（ほか${asks.length - 1}件）`}
        </p>
        <p title={next.text}>
          <span className="font-bold">次にやること: </span>
          <span data-testid="row-next">{next.text}</span>
          {more > 0 && <span className="ml-1 whitespace-nowrap text-slate-700">（ほか{more}件）</span>}
        </p>

        <div className="rounded border-l-4 border-slate-700 bg-slate-50 px-1.5 py-1" data-testid={`targets-${info.id}`} aria-live="polite">
          <p className="font-bold">このコンペに出すアプリ {chosen.length}件</p>
          {info.id === 'ichibiz-2026' ? (
            <ul className="mt-0.5 space-y-0.5">
              {cols.map((c) => {
                const ids = appsForColumn(targets, c.id)
                return (
                  <li key={c.id}>
                    {c.division} {ids.length}件{ids.length > 0 && `: ${ids.map(appName).join('、')}`}
                  </li>
                )
              })}
            </ul>
          ) : chosen.length ? (
            <ul className="mt-0.5 list-disc pl-4">
              {chosen.map((id) => (
                <li key={id}>{appName(id)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-700">まだ選んでいません（アプリのカードで選べます）</p>
          )}
        </div>

        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          data-testid={`pick-${info.id}`}
          className={`mt-auto min-h-9 rounded-md border-2 border-slate-900 px-2 py-1 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
        >
          {selected ? <><span aria-hidden>✓ </span>このコンペで並べている（もう一度押すと解除）</> : 'このコンペで並べる'}
        </button>
      </div>
      <details className="border-t bg-white/70 px-3 py-1 text-xs" data-testid={`facts-${info.id}`}>
        <summary className="min-h-8 cursor-pointer py-1 font-bold">概要・審査基準・主なルール・提出可能数</summary>
        <dl className="space-y-2 pb-2">
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
    </article>
  )
}

/**
 * アプリのカード。名前を押すとアプリのページへ。「提出先」の欄で、出せるコンペ（◎○△。？は要確認つき）を複数選べる。
 * × は選べず、理由を出す。選んだコンペがあれば、そのコンペの行を強調する。
 */
export function AppFitCard({
  a, rank, contest, targets, onToggle, cautioned,
}: {
  a: AppMeta
  rank: number
  contest: ContestId | null
  targets: Targets
  onToggle: (appId: string, columnId: string) => void
  cautioned: boolean
}) {
  const isNew = isNewPlan(a)
  const missing = useIsPending(a)
  const color = contestColor(a.contest)
  const plan = planOf(a)
  const chosen = targets[a.id] ?? []
  const hl = contest ? columnsOf(contest).map((c) => c.id) : []
  return (
    <li
      data-app-card={a.id}
      data-rank={rank}
      className={`flex w-72 shrink-0 snap-start flex-col gap-1.5 rounded-lg border-2 border-l-8 bg-white p-2 text-xs shadow-sm ${color.edge} ${isNew ? 'border-slate-500' : 'border-slate-300'}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold tabular-nums text-slate-900" title="いまの並びでの順位">{rank}位</span>
        {isNew ? (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white" data-testid="new-plan-tag">{NEW_PLAN_LABEL}</span>
        ) : (
          <span className="rounded border border-slate-600 px-1.5 py-0.5 font-bold" data-testid="current-plan-tag">今の案</span>
        )}
        <DataBadge kind={a.dataKind} className="px-1.5 py-0 text-xs" />
        {missing && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-950" data-testid={`mini-pending-${a.id}`}>{pendingLabel(a)}</span>
        )}
        {cautioned && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-950" data-testid={`caution-tag-${a.id}`}><span aria-hidden>▲ </span>注意あり</span>
        )}
      </div>
      <h3 className="text-sm font-bold leading-snug text-slate-900">
        <a
          href={appUrl(a.id)}
          data-app-link={a.id}
          title={a.purpose}
          className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {a.name}
        </a>
      </h3>
      <p className="leading-snug text-slate-800">{a.purpose}</p>

      <fieldset className="min-w-0 rounded border border-slate-400 p-1.5" data-testid={`fit-${a.id}`}>
        <legend className="px-1 font-bold">
          提出先（選ぶ）{chosen.length > 0 && <span data-testid={`chosen-count-${a.id}`}> {chosen.length}件</span>}
        </legend>
        <ul className="space-y-1">
          {FIT_COLUMNS.map((col) => {
            const cell = cellOf(a.id, col.id)
            if (!cell) return null
            const ok = isSelectable(cell)
            const on = chosen.includes(col.id)
            const emph = hl.includes(col.id)
            const id = `t-${a.id}-${col.id}`
            return (
              <li
                key={col.id}
                data-fit-row={col.id}
                data-emph={emph ? 'true' : undefined}
                className={`rounded px-1 py-0.5 ${emph ? 'border-2 border-slate-900 bg-yellow-50 font-bold' : 'border border-transparent'}`}
              >
                <label htmlFor={id} className={`flex min-h-7 items-center gap-1.5 ${ok ? 'cursor-pointer' : 'cursor-not-allowed text-slate-700'}`}>
                  <input
                    id={id}
                    type="checkbox"
                    checked={on}
                    disabled={!ok}
                    onChange={() => onToggle(a.id, col.id)}
                    aria-describedby={ok ? undefined : `${id}-why`}
                    className="size-4 shrink-0 accent-slate-900"
                    data-testid={id}
                  />
                  <span className="min-w-0 flex-1">
                    {emph && <span aria-hidden>▶ </span>}
                    {columnShort(col)}
                  </span>
                  <span className="shrink-0 whitespace-nowrap font-bold" data-testid={`mark-${a.id}-${col.id}`}>
                    <span aria-hidden>{cell.mark} </span>
                    {MARK_WORD[cell.mark]}
                  </span>
                </label>
                {!ok && (
                  <p id={`${id}-why`} className="ml-5 mt-0.5 font-normal leading-snug text-slate-800" data-testid={`why-${a.id}-${col.id}`}>
                    選べません: {cell.reason}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        <details className="mt-1">
          <summary className="min-h-7 cursor-pointer py-1 font-bold">判定の理由と出典（◎○△？）</summary>
          <ul className="space-y-1.5 pb-1">
            {FIT_COLUMNS.map((col) => {
              const cell = cellOf(a.id, col.id)
              if (!cell || cell.mark === '×') return null
              return (
                <li key={col.id} className="leading-snug">
                  <span className="font-bold">{columnShort(col)} {cell.mark} {MARK_WORD[cell.mark]}</span>
                  <span className="block text-slate-800">{cell.reason}</span>
                  <span className="block text-[0.6875rem] text-slate-700">［出典: {cell.source}］</span>
                </li>
              )
            })}
          </ul>
        </details>
      </fieldset>

      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-800">
        {plan && (
          <>
            <span className={`rounded border px-1 ${plan.intent === '提出予定' ? 'border-slate-700 font-bold' : 'border-dashed border-slate-500'}`}>{plan.intent}</span>
            <span className="tabular-nums" title="案の進み具合（reports/ops の進捗一覧）">
              済{plan.done.length}・残{plan.todo.length + (plan.decisions?.length ?? 0)}
            </span>
          </>
        )}
        <a
          href={appUrl(a.id)}
          className="ml-auto inline-flex min-h-8 items-center gap-0.5 font-bold text-slate-900 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {missing ? '未収録の案内' : 'アプリを開く'}
          <ArrowRight className="size-3" aria-hidden />
        </a>
      </div>
    </li>
  )
}

/** 横一列に並べた、その行の中だけ横スクロールする入れ物。左右の送りボタンと、いまの位置の表示つき */
export function ScrollRow({ label, children, resetKey }: { label: string; children: React.ReactNode; resetKey?: string }) {
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ left: true, right: false })
  const update = () => {
    const el = ref.current
    if (!el) return
    setEdge({ left: el.scrollLeft <= 2, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
  }
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = 0
    update()
  }, [resetKey])
  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const go = (dir: -1 | 1) => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 200), behavior: reduce ? 'auto' : 'smooth' })
  }
  const btn = 'inline-flex min-h-9 shrink-0 items-center whitespace-nowrap gap-0.5 rounded-md border-2 border-slate-900 bg-white px-2 text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:border-slate-400 disabled:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-800">
        <button type="button" className={btn} onClick={() => go(-1)} disabled={edge.left} aria-label={`${label}を左へ送る`} data-testid="row-prev">
          <ChevronLeft className="size-4" aria-hidden />前へ
        </button>
        <button type="button" className={btn} onClick={() => go(1)} disabled={edge.right} aria-label={`${label}を右へ送る`} data-testid="row-next-btn">
          次へ<ChevronRight className="size-4" aria-hidden />
        </button>
        <span>横にスクロールできます（ボタン・横スワイプ・行を選んで左右の矢印キー）</span>
      </div>
      <ul
        ref={ref}
        onScroll={update}
        tabIndex={0}
        aria-label={label}
        data-testid="app-row"
        className="flex snap-x items-start gap-3 overflow-x-auto overscroll-x-contain pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {children}
      </ul>
    </div>
  )
}

/** 選んだ組み合わせが当たった注意。その場で出す（読み上げにも通知する） */
export function CautionList({ items }: { items: ActiveCaution[] }) {
  return (
    <div role="status" aria-live="polite" data-testid="cautions">
      {items.length > 0 && (
        <section className="space-y-2 rounded-lg border-2 border-amber-700 bg-amber-50 p-2 text-xs text-amber-950" aria-label="提出先の選び方への注意">
          <h3 className="text-sm font-bold"><span aria-hidden>▲ </span>選んだ組み合わせへの注意 {items.length}件（情報部の注意。判定ではなく確認事項です）</h3>
          <ul className="space-y-2">
            {items.map((c) => (
              <li key={c.caution.id + c.why} data-caution={c.caution.id} className="rounded border border-amber-700 bg-white p-1.5">
                <p className="font-bold">注意 {c.caution.id}: {c.why}</p>
                <p>対象: {c.apps.map(appName).join('、')}</p>
                <p className="leading-snug">{c.caution.text}</p>
                <p className="text-[0.6875rem]">［出典: {c.caution.source}］</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export { contestScore, totalScore }
