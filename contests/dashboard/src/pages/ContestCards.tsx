import { CONTESTS } from '@/apps/registry'
import { nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_LABEL, cardPlans, contestDecisionTexts, otherNextCount, type CardPlan } from '@/data/status'

/** 案の提出の見込み。色ではなく文言と枠の形で区別する（提出予定＝実線の太字、比較中＝破線） */
const INTENT_CLS: Record<CardPlan['intent'], string> = {
  提出予定: 'border-slate-700 font-bold',
  比較中: 'border-dashed border-slate-500',
  出さない: 'border-dashed border-slate-400',
}

export type CardProps = { info: ContestInfo; selected: boolean; onSelect: () => void; onKey: (e: React.KeyboardEvent) => void }

/** 案ごとの完了・残り。✓ 済の件数、□ 残りの件数、？ そのうち判断待ち・要確認 */
function PlanLines({ contest }: { contest: ContestInfo['id'] }) {
  const plans = cardPlans(contest)
  return (
    <ul className="grid gap-y-0.5 text-xs leading-snug" aria-label="案ごとの完了と残り" data-testid="card-plans">
      {plans.map((p) => (
        <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-1.5" data-testid="card-plan" data-plan={p.id}>
          <span className="min-w-0 truncate font-medium" title={p.short + (p.intentNote ? `（${p.intentNote}）` : '')}>
            {p.short}
          </span>
          <span className={`whitespace-nowrap rounded border px-1 ${INTENT_CLS[p.intent]}`} data-testid="card-plan-intent">
            {p.intent}
          </span>
          <span className="whitespace-nowrap tabular-nums" data-testid="card-plan-count">
            <span aria-hidden>✓</span>
            <span className="sr-only">済</span>
            {p.done}　<span aria-hidden>□</span>
            <span className="sr-only">残り</span>
            {p.left}
            {p.asks > 0 && (
              <span className="ml-1 rounded bg-amber-100 px-0.5 font-bold text-amber-950">
                <span aria-hidden>？</span>
                <span className="sr-only">うち判断待ち・要確認</span>
                {p.asks}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 案の数・済・残りの合計 */
export function planTotals(contest: ContestInfo['id']) {
  const plans = cardPlans(contest)
  return {
    n: plans.length,
    submit: plans.filter((p) => p.intent === '提出予定').length,
    compare: plans.filter((p) => p.intent === '比較中').length,
    done: plans.reduce((a, p) => a + p.done, 0),
    left: plans.reduce((a, p) => a + p.left, 0),
  }
}

/**
 * スマホのカード（固定の高さ 6rem）。選んでも解除しても大きさも位置も変わらない（一覧は縮めない）。
 * 1段目: コンペ名・状況・次の締切、2段目: 案の数と完了・残り、3段目: 判断待ちの数、4段目: 次にやること1行。
 */
export function MobileCard({ info, selected, onSelect, onKey }: CardProps) {
  const nd = nextDeadline(info)
  const next = CONTEST_STATUS[info.id].next.find((n) => !n.decision) ?? CONTEST_STATUS[info.id].next[0]
  const t = planTotals(info.id)
  const asks = contestDecisionTexts(info.id).length
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      data-mobile-row
      className={`grid h-[6rem] w-full grid-cols-[0.75rem_minmax(0,1fr)] content-center gap-x-1 gap-y-0.5 overflow-hidden rounded-lg px-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      <span aria-hidden className="row-span-4 self-center text-[0.625rem]">{selected ? '▶' : ''}</span>
      <span className="flex min-w-0 items-baseline gap-x-1.5 leading-tight">
        <span className="shrink-0 text-sm font-bold">{info.tabName}</span>
        <span className="min-w-0 flex-1 truncate font-bold" data-testid="row-status">
          <span aria-hidden>▲ </span>
          <span className="sr-only">提出不可: </span>
          {STATUS_LABEL[info.id]}
        </span>
        <span className="shrink-0 whitespace-nowrap" data-testid="row-deadline">
          締切 <span className="font-bold">{nd.text}</span>
        </span>
      </span>
      <span className="truncate leading-tight" data-testid="row-progress">
        案 {t.n}件（提出予定 {t.submit}・比較中 {t.compare}）　<span aria-hidden>✓</span>
        <span className="sr-only">済</span> {t.done}　<span aria-hidden>□</span>
        <span className="sr-only">残り</span> {t.left}
      </span>
      <span className="truncate font-bold leading-tight" data-testid="row-asks">
        <span aria-hidden>？</span>判断待ち {asks}件
      </span>
      <span className="flex min-w-0 items-center gap-1 leading-tight">
        <span className="shrink-0 font-bold text-muted-foreground">次</span>
        <span className="min-w-0 flex-1 truncate font-medium" data-testid="row-next">{next.text}</span>
      </span>
    </button>
  )
}

/**
 * コンペの進捗カード（ボタン）。選ぶと下の詳細欄が切り替わる。カードの位置もページの高さも変えない。
 * 上から: コンペ名＋状況、次の締切と残り日数、提出可否の1行、案ごとの完了・残り、判断待ち、次にやること
 */
export function ContestCard({ info, selected, onSelect, onKey }: CardProps) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const next = st.next.find((n) => !n.decision) ?? st.next[0]
  const asks = contestDecisionTexts(info.id)
  const more = otherNextCount(info.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      data-card
      className={`flex h-full w-full flex-col gap-1.5 rounded-lg p-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-bold leading-tight">
          <span aria-hidden className="mr-0.5 inline-block w-3 text-[0.625rem]">{selected ? '▶' : ''}</span>
          <span title={contest.name}>{info.tabName}</span>
        </span>
        <span className="inline-flex shrink-0 items-center rounded border-2 border-slate-800 px-1.5 py-px text-xs font-bold" data-testid="row-status">
          <span aria-hidden>▲&nbsp;</span>
          <span className="sr-only">提出不可: </span>
          {STATUS_LABEL[info.id]}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs" data-testid="row-deadline">
        <span>
          次の締切 <span className="font-bold">{nd.text}</span>
          {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
        </span>
        <Remaining at={nd.at} />
      </span>
      <span className="line-clamp-3 block text-xs leading-snug" data-testid="row-reason" title={st.gap}>
        <span className="font-bold"><span aria-hidden>▲ </span>提出可否: </span>
        {st.gap}
      </span>
      <span className="block text-xs" data-testid="row-progress-block">
        <span className="mb-0.5 block font-bold">案ごとの完了・残り</span>
        <PlanLines contest={info.id} />
      </span>
      <span className="block rounded border-l-4 border-amber-600 bg-amber-50 px-1.5 py-1 text-xs leading-snug" data-testid="row-asks">
        <span className="font-bold text-amber-950">
          <span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件
        </span>
        {asks.length > 0 && (
          <span className="mt-0.5 line-clamp-2 block" title={asks.join(' ／ ')}>
            {asks[0]}
            {asks.length > 1 && `（ほか${asks.length - 1}件）`}
          </span>
        )}
      </span>
      <span className="mt-auto line-clamp-3 block text-xs leading-snug" title={next.text}>
        <span className="font-bold">次にやること: </span>
        <span className="font-medium" data-testid="row-next">{next.text}</span>
        {more > 0 && <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground" data-testid="row-more">（ほか{more}件）</span>}
      </span>
    </button>
  )
}
