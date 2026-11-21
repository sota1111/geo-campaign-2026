import { APPS, CONTESTS } from '@/apps/registry'
import { nextDeadline, remainingText, type ContestInfo } from '@/apps/contests-info'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_LABEL, cardPlans, contestDecisionTexts, otherNextCount, type CardPlan } from '@/data/status'
import { useMissingPrs } from '@/lib/availability'

/** 案の提出の見込み。色ではなく文言と枠の形で区別する（提出予定＝実線の太字、比較中＝破線） */
const INTENT_CLS: Record<CardPlan['intent'], string> = {
  提出予定: 'border-slate-700 font-bold',
  比較中: 'border-dashed border-slate-500',
  出さない: 'border-dashed border-slate-400',
}

export type CardProps = { info: ContestInfo; selected: boolean; onSelect: () => void; onKey: (e: React.KeyboardEvent) => void }

interface Line {
  key: string
  label: string
  intent: CardPlan['intent']
  done: number
  left: number
  asks: number
  appIds: string[]
  title?: string
}

/** 案の行。比較中の案が多いコンペ（案が4件を超える）は、提出予定の案だけ1行ずつ、比較中は1行にまとめる */
function lines(contest: ContestInfo['id']): Line[] {
  const plans = cardPlans(contest)
  const one = (p: CardPlan): Line => ({ key: p.id, label: p.short, intent: p.intent, done: p.done, left: p.left, asks: p.asks, appIds: p.appIds, title: p.short + (p.intentNote ? `（${p.intentNote}）` : '') })
  if (plans.length <= 4) return plans.map(one)
  const cmp = plans.filter((p) => p.intent === '比較中')
  return [
    ...plans.filter((p) => p.intent !== '比較中').map(one),
    {
      key: 'compare',
      label: `比較中の${cmp.length}案`,
      intent: '比較中',
      done: cmp.reduce((a, p) => a + p.done, 0),
      left: cmp.reduce((a, p) => a + p.left, 0),
      asks: cmp.reduce((a, p) => a + p.asks, 0),
      appIds: cmp.flatMap((p) => p.appIds),
      title: cmp.map((p) => p.short).join('・'),
    },
  ]
}

function MissingChip({ appIds }: { appIds: string[] }) {
  const prs = useMissingPrs(appIds.map((id) => APPS.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a))
  if (!prs.length) return null
  return (
    <span className="whitespace-nowrap rounded border border-amber-700 bg-amber-50 px-1 text-[0.6875rem] font-bold text-amber-950" data-testid="card-plan-missing">
      審査待ち（{prs.join('・')}）・未収録
    </span>
  )
}

/** 案ごとの完了・残り。✓ 済の件数、□ 残りの件数、「要確認」＝判断待ち・要確認の印が付いた項目の数 */
function PlanLines({ contest }: { contest: ContestInfo['id'] }) {
  return (
    <ul className="grid gap-y-0.5 text-xs leading-snug" aria-label="案ごとの完了と残り" data-testid="card-plans">
      {lines(contest).map((p) => (
        <li key={p.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-1.5" data-testid="card-plan" data-plan={p.key}>
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 font-medium" title={p.title}>
            <span>{p.label}</span>
            <MissingChip appIds={p.appIds} />
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
              <span className="ml-1 rounded bg-amber-100 px-0.5 font-bold text-amber-950">要確認{p.asks}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** 総司令官の判断待ち（コンペごと。正本の「判断待ちの一覧」） */
function AsksBox({ contest }: { contest: ContestInfo['id'] }) {
  const asks = contestDecisionTexts(contest)
  return (
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
  )
}

function NextLine({ contest }: { contest: ContestInfo['id'] }) {
  const st = CONTEST_STATUS[contest]
  const next = st.next.find((n) => !n.decision) ?? st.next[0]
  const more = otherNextCount(contest)
  return (
    <span className="line-clamp-3 block text-xs leading-snug" title={next.text}>
      <span className="font-bold">次にやること: </span>
      <span className="font-medium" data-testid="row-next">{next.text}</span>
      {more > 0 && <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground" data-testid="row-more">（ほか{more}件）</span>}
    </span>
  )
}

/**
 * 幅の狭い画面で、上の一覧を細くした代わりに、詳細欄の先頭に出すカードの残りの中身
 * （提出可否・案ごとの完了と残り・判断待ち・次にやること）。1280px 以上のカードと同じ内容
 */
export function CardSummary({ info }: { info: ContestInfo }) {
  const st = CONTEST_STATUS[info.id]
  return (
    <div className="mb-2 space-y-1.5 rounded-lg border bg-muted/30 p-2" data-testid="card-summary">
      <p className="text-xs leading-snug">
        <span className="font-bold">提出可否: </span>
        {st.gap}
      </p>
      <div className="text-xs">
        <p className="mb-0.5 font-bold">案ごとの完了・残り</p>
        <PlanLines contest={info.id} />
      </div>
      <AsksBox contest={info.id} />
      <NextLine contest={info.id} />
    </div>
  )
}

/**
 * 幅 1280px 未満の細いタブ状のカード（固定の高さ 3rem）。選んでも大きさも位置も変わらない。
 * 1段目: コンペの短い名前・残り日数、2段目: 提出可否の記号と言葉・判断待ちの数
 */
export function TabCard({ info, selected, onSelect, onKey }: CardProps) {
  const nd = nextDeadline(info)
  const asks = contestDecisionTexts(info.id).length
  const r = remainingText(nd.at)
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      data-tab-card
      className={`grid h-11 w-full grid-cols-[0.75rem_minmax(0,1fr)] content-center gap-x-0.5 overflow-hidden rounded-lg px-1.5 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      <span aria-hidden className="row-span-2 self-center text-[0.625rem]">{selected ? '▶' : ''}</span>
      <span className="flex min-w-0 items-baseline gap-x-1.5 leading-tight" data-testid="row-deadline">
        <span className="shrink-0 text-sm font-bold">{info.tabName}</span>
        <span className="shrink-0 whitespace-nowrap font-bold">{r.urgent && <span aria-hidden>▲ </span>}{r.text}</span>
        <span className="min-w-0 truncate text-muted-foreground">{nd.text}</span>
      </span>
      <span className="flex min-w-0 items-baseline gap-x-1.5 leading-tight">
        <span className="min-w-0 truncate font-bold" data-testid="row-status">
          <span aria-hidden>▲ </span>提出不可
          <span className="sr-only">（{STATUS_LABEL[info.id]}）</span>
        </span>
        <span className="shrink-0 whitespace-nowrap font-bold" data-testid="row-asks">
          <span aria-hidden>？</span>判断待ち{asks}件
        </span>
      </span>
    </button>
  )
}

/**
 * 幅 1280px 以上のカード（ボタン）。選ぶと下の詳細欄が切り替わる。カードの位置もページの高さも変えない。
 * 上から: コンペ名、次の締切と残り日数、提出可否の1行、案ごとの完了・残り、判断待ち、次にやること
 */
export function ContestCard({ info, selected, onSelect, onKey }: CardProps) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const nd = nextDeadline(info)
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      data-card
      className={`flex h-full w-full flex-col gap-1 rounded-lg p-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      <span className="text-sm font-bold leading-tight">
        <span aria-hidden className="mr-0.5 inline-block w-3 text-[0.625rem]">{selected ? '▶' : ''}</span>
        <span title={contest.name}>{info.tabName}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs" data-testid="row-deadline">
        <span>
          次の締切 <span className="font-bold">{nd.text}</span>
          {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
        </span>
        <Remaining at={nd.at} />
      </span>
      <span className="block text-xs font-bold" data-testid="row-status" title={CONTEST_STATUS[info.id].gap}>
        <span aria-hidden>▲ </span>提出不可
        <span className="font-normal">（{STATUS_LABEL[info.id]}）</span>
      </span>
      <span className="block" data-testid="row-progress-block">
        <PlanLines contest={info.id} />
      </span>
      <AsksBox contest={info.id} />
      <span className="mt-auto block">
        <NextLine contest={info.id} />
      </span>
    </button>
  )
}
