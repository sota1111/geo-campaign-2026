import { useEffect, useRef, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
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
 * コンペのカード（4枚を横一列に並べる。縦スクロールなしで画面に収めるため、高さを詰めてある）。
 * 本体を押す（または「このコンペで並べる」）と、アプリの行がこのコンペとの関連の強い順に並び替わる。
 * 「概要・進捗へ」でコンペ概要ページ（contest/<id>/）へ。概要・審査基準・ルール・提出可能数は折りたたみ。
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
  const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900'
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
      <h3 className={`flex items-center justify-between gap-2 px-2.5 py-1 text-sm font-bold leading-tight ${color.band}`}>
        <span className="min-w-0 truncate" title={contest.name}>
          <span aria-hidden>{color.mark} </span>
          {contest.name}
        </span>
        {selected && <span className="shrink-0 rounded bg-white px-1.5 text-xs text-slate-900" data-testid="selected-tag"><span aria-hidden>✓ </span>選択中</span>}
      </h3>
      <div className="flex flex-1 flex-col gap-1 bg-white/70 px-2.5 py-1.5 text-xs leading-snug">
        <p className="flex flex-wrap items-center gap-x-2" data-testid="row-deadline">
          <span>
            次の締切 <span className="font-bold">{nd.text}</span>
            {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
          </span>
          <Remaining at={nd.at} />
        </p>
        {info.id === 'ichibiz-2026' && (
          <p className="text-slate-800" data-testid="ichibiz-divisions" aria-label="3つの部門">
            {cols.map((c, i) => (
              <span key={c.id}>
                {i > 0 && '／'}
                <span className="font-bold">{c.division}</span> {c.deadline.replace('2026-', '').replace('-', '/')}・{appsForColumn(targets, c.id).length}件
              </span>
            ))}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-bold" data-testid="row-status" title={st.gap}>
            <span aria-hidden>▲ </span>
            {STATUS_LABEL[info.id]}
            <span className="font-normal">（提出不可）</span>
          </span>
          <span data-testid="row-asks" title={asks.join(' ／ ')}>
            <span className="rounded bg-amber-100 px-1 font-bold text-amber-950">
              <span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件
            </span>
          </span>
        </p>
        <p className="truncate" data-testid={`targets-${info.id}`} aria-live="polite" title={chosen.map(appName).join('、')}>
          <span className="font-bold">このコンペに出すアプリ {chosen.length}件</span>
          <span className="text-slate-800">{chosen.length ? `：${chosen.map(appName).join('、')}` : '（未選択）'}</span>
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            data-testid={`pick-${info.id}`}
            className={`min-h-8 rounded-md border-2 border-slate-900 px-2 text-xs font-bold ${focus} ${selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
          >
            {selected ? <><span aria-hidden>✓ </span>並べ替え中（解除）</> : 'このコンペで並べる'}
          </button>
          <a
            href={contestUrl(info.id)}
            data-testid={`row-${info.id}`}
            className={`inline-flex min-h-8 items-center gap-0.5 font-bold text-slate-900 underline underline-offset-2 ${focus}`}
            title={`${contest.name}の概要・進捗・審査基準を見る`}
          >
            概要・進捗へ
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      </div>
      <details className="border-t bg-white/70 px-2.5 text-xs" data-testid={`facts-${info.id}`}>
        <summary className="min-h-7 cursor-pointer py-1 font-bold">判断待ち・次にやること・概要・審査基準・ルール・提出可能数</summary>
        <dl className="space-y-2 pb-2">
          <div>
            <dt className="font-bold">総司令官の判断待ち（{asks.length}件）</dt>
            <dd>
              <ul className="list-disc space-y-0.5 pl-4 leading-snug">
                {asks.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </dd>
          </div>
          <div>
            <dt className="font-bold">次にやること</dt>
            <dd className="leading-snug" title={next.text}>
              <span data-testid="row-next">{next.text}</span>
              {more > 0 && <span className="ml-1 whitespace-nowrap text-slate-700">（ほか{more}件）</span>}
            </dd>
          </div>
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

/** 選んだ組が当たった注意（そのカードの中に出す。1行＋全文は折りたたみ） */
function CardCautions({ items }: { items: ActiveCaution[] }) {
  if (!items.length) return null
  return (
    <ul className="space-y-1" data-testid="card-cautions">
      {items.map((c) => (
        <li key={c.caution.id + c.why} data-caution={c.caution.id} className="rounded border border-amber-700 bg-amber-50 p-1 text-amber-950">
          <p className="font-bold"><span aria-hidden>▲ </span>注意 {c.caution.id}: {c.why}</p>
          <details>
            <summary className="min-h-7 cursor-pointer py-1 font-bold">全文と出典（確認事項で、判定ではありません）</summary>
            <p className="leading-snug">{c.caution.text}</p>
            <p className="text-[0.6875rem]">［出典: {c.caution.source}］</p>
          </details>
        </li>
      ))}
    </ul>
  )
}


/** カードに並べる4コンペ（イチBiz は3部門のうち最も強い関連の記号） */
const MINI: { id: ContestId; label: string }[] = [
  { id: 'udc-2026', label: 'UDC' },
  { id: 'satellite-2026', label: '衛星' },
  { id: 'ichibiz-2026', label: 'イチBiz' },
  { id: 'odpt-2026', label: 'ODPT' },
]
function bestCell(appId: string, contest: ContestId) {
  return columnsOf(contest)
    .map((c) => cellOf(appId, c.id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .sort((x, y) => y.score - x.score)[0]
}

/**
 * アプリのカード（小さく。順位・名前・案・データの種類・4コンペの記号・選んだ提出先の数だけ）。
 * 提出先の選択（チェック欄・× の理由・注意の全文・判定の理由）は、カード内の「提出先を選ぶ」で開く小さなポップオーバーに置く。
 */
export function AppFitCard({
  a, rank, contest, targets, onToggle, cautions,
}: {
  a: AppMeta
  rank: number
  contest: ContestId | null
  targets: Targets
  onToggle: (appId: string, columnId: string) => void
  cautions: ActiveCaution[]
}) {
  const isNew = isNewPlan(a)
  const missing = useIsPending(a)
  const color = contestColor(a.contest)
  const chosen = targets[a.id] ?? []
  return (
    <li
      data-app-card={a.id}
      data-rank={rank}
      className={`relative flex w-52 shrink-0 snap-start flex-col gap-1 rounded-lg border-2 border-l-8 bg-white p-1.5 text-xs shadow-sm ${color.edge} ${isNew ? 'border-slate-500' : 'border-slate-300'}`}
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-slate-100 px-1.5 font-bold tabular-nums text-slate-900" title="いまの並びでの順位">{rank}位</span>
        {isNew ? (
          <span className="rounded bg-slate-800 px-1.5 font-bold text-white" data-testid="new-plan-tag" title={NEW_PLAN_LABEL}>新しい案</span>
        ) : (
          <span className="rounded border border-slate-600 px-1.5 font-bold" data-testid="current-plan-tag">今の案</span>
        )}
        <DataBadge kind={a.dataKind} className="px-1.5 py-0 text-xs" />
        {missing && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1.5 font-bold text-amber-950" data-testid={`mini-pending-${a.id}`}>{pendingLabel(a)}</span>
        )}
      </div>
      <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-tight text-slate-900">
        <a
          href={appUrl(a.id)}
          data-app-link={a.id}
          title={`${a.purpose}（押すとアプリのページへ）`}
          className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {a.name}
          {missing && <span className="sr-only">（未収録の案内）</span>}
        </a>
      </h3>
      <ul className="grid grid-cols-2 gap-x-1 gap-y-0.5" aria-label="出せるコンペ（◎このコンペ向け ○出せる △条件付き ×出せない ？要確認）">
        {MINI.map((m) => {
          const cell = bestCell(a.id, m.id)
          const emph = contest === m.id
          return (
            <li
              key={m.id}
              data-fit-mini={m.id}
              data-emph={emph ? 'true' : undefined}
              className={`flex items-center justify-between rounded px-1 ${emph ? 'border-2 border-slate-900 bg-yellow-50 font-bold' : 'border border-slate-300'}`}
              title={cell ? `${m.label}: ${cell.mark} ${MARK_WORD[cell.mark]}` : m.label}
            >
              <span>{emph && <span aria-hidden>▶</span>}{m.label}</span>
              <span className="font-bold" data-testid={`mini-mark-${a.id}-${m.id}`}>
                {cell?.mark ?? '－'}
                <span className="sr-only"> {cell ? MARK_WORD[cell.mark] : ''}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <div className="mt-auto flex items-center gap-1">
        <FitPopover a={a} contest={contest} chosen={chosen} onToggle={onToggle} cautions={cautions} />
        {cautions.length > 0 && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1 font-bold text-amber-950" data-testid={`caution-tag-${a.id}`}><span aria-hidden>▲ </span>注意</span>
        )}
      </div>
    </li>
  )
}

/** 「提出先を選ぶ」ボタンと、開く小さなポップオーバー（画面は暗くしない。Esc・外を押すと閉じる） */
function FitPopover({
  a, contest, chosen, onToggle, cautions,
}: { a: AppMeta; contest: ContestId | null; chosen: string[]; onToggle: (appId: string, columnId: string) => void; cautions: ActiveCaution[] }) {
  const plan = planOf(a)
  const hl = contest ? columnsOf(contest).map((c) => c.id) : []
  const cols = FIT_COLUMNS.filter((col) => cellOf(a.id, col.id))
  const firstOk = cols.find((col) => isSelectable(cellOf(a.id, col.id)))?.id
  const [active, setActive] = useState<string | undefined>(firstOk)
  const listRef = useRef<HTMLUListElement>(null)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const boxes = [...(listRef.current?.querySelectorAll<HTMLInputElement>('input[type=checkbox]:not(:disabled)') ?? [])]
    const i = boxes.indexOf(document.activeElement as HTMLInputElement)
    if (i < 0) return
    e.preventDefault()
    boxes[(i + (e.key === 'ArrowDown' ? 1 : boxes.length - 1)) % boxes.length]?.focus()
  }
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          data-testid={`pick-targets-${a.id}`}
          className="min-h-8 flex-1 rounded-md border-2 border-slate-900 bg-white px-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          aria-label={`${a.name}の提出先を選ぶ（${chosen.length}件選択中）`}
        >
          提出先を選ぶ<span data-testid={`chosen-count-${a.id}`}>（{chosen.length}件）</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="bottom"
          align="start"
          collisionPadding={8}
          sideOffset={4}
          data-testid={`popover-${a.id}`}
          className="z-50 max-h-[min(32rem,calc(100vh-1rem))] w-[min(22rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border-2 border-slate-900 bg-white p-2 text-xs shadow-lg"
        >
          <p className="mb-1 text-sm font-bold">{a.name}</p>
          <fieldset className="min-w-0 rounded border border-slate-400 p-1.5" data-testid={`fit-${a.id}`}>
            <legend className="px-1 font-bold">
              提出先を選ぶ（{chosen.length}件選択中）
            </legend>
            <p className="mb-1 text-[0.6875rem] leading-snug text-slate-800">右の記号は関連の判定（情報部）。左のチェックが、あなたの選択です。</p>
            <ul className="space-y-0.5" ref={listRef} onKeyDown={onKey} role="group" aria-label={`${a.name}の提出先（上下の矢印キーで移動、スペースで選ぶ）`}>
              {cols.map((col) => {
                const cell = cellOf(a.id, col.id)!
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
                    <label htmlFor={id} className={`flex min-h-8 items-center gap-1.5 ${ok ? 'cursor-pointer' : 'cursor-not-allowed text-slate-700'}`}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={on}
                        disabled={!ok}
                        tabIndex={col.id === active ? 0 : -1}
                        onFocus={() => setActive(col.id)}
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
                      <details className="ml-5">
                        <summary className="min-h-8 cursor-pointer py-1 font-normal underline">選べない理由</summary>
                        <p id={`${id}-why`} className="mb-1 font-normal leading-snug text-slate-800" data-testid={`why-${a.id}-${col.id}`}>
                          選べません: {cell.reason}
                        </p>
                      </details>
                    )}
                  </li>
                )
              })}
            </ul>
            <details className="mt-1">
              <summary className="min-h-7 cursor-pointer py-1 font-bold">判定の理由と出典（◎○△？）</summary>
              <ul className="space-y-1.5 pb-1">
                {cols.map((col) => {
                  const cell = cellOf(a.id, col.id)!
                  if (cell.mark === '×') return null
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
          <div className="mt-1">
            <CardCautions items={cautions} />
          </div>
          {plan && (
            <p className="mt-1 text-slate-800">
              <span className={`mr-1 rounded border px-1 ${plan.intent === '提出予定' ? 'border-slate-700 font-bold' : 'border-dashed border-slate-500'}`}>{plan.intent}</span>
              <span className="tabular-nums" title="案の進み具合（reports/ops の進捗一覧）">
                済{plan.done.length}・残{plan.todo.length + (plan.decisions?.length ?? 0)}
              </span>
            </p>
          )}
          <PopoverPrimitive.Close className="mt-1 min-h-8 rounded-md border-2 border-slate-900 bg-white px-2 text-xs font-bold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900">
            閉じる
          </PopoverPrimitive.Close>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** 横一列に並べた、その行の中だけ横スクロールする入れ物。左右の送りボタンと「n件中 m〜k件目」つき */
export function ScrollRow({ label, children, resetKey, total, toolbar }: { label: string; children: React.ReactNode; resetKey?: string; total: number; toolbar?: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ left: true, right: false })
  const [range, setRange] = useState({ from: 1, to: 1 })
  const update = () => {
    const el = ref.current
    if (!el) return
    setEdge({ left: el.scrollLeft <= 2, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
    const box = el.getBoundingClientRect()
    const kids = [...el.children] as HTMLElement[]
    const vis = kids.map((k, i) => ({ i, r: k.getBoundingClientRect() })).filter(({ r }) => r.right > box.left + 8 && r.left < box.right - 8)
    if (vis.length) setRange({ from: vis[0].i + 1, to: vis[vis.length - 1].i + 1 })
  }
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = 0
    update()
  }, [resetKey, total])
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
        <span className="font-bold tabular-nums" data-testid="row-position" role="status">
          {total ? `${total}件中 ${range.from}〜${Math.min(range.to, total)}件目` : '0件'}
        </span>
        <span className="hidden md:inline">ボタン・スワイプ・左右の矢印キーで横に送れます</span>
        {toolbar}
      </div>
      <ul
        ref={ref}
        onScroll={update}
        tabIndex={0}
        aria-label={label}
        data-testid="app-row"
        className="flex snap-x gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {children}
      </ul>
    </div>
  )
}

/** 選んだ組み合わせの注意の件数（アプリの行の下。全文は該当カードの中）。読み上げにも通知する */
export function CautionSummary({ count }: { count: number }) {
  return (
    <div role="status" aria-live="polite" data-testid="cautions" className="text-xs font-bold text-amber-950">
      {count > 0 && (
        <p><span aria-hidden>▲ </span>選んだ組み合わせへの注意 {count}件（該当するカードの中に出しています。情報部の注意で、判定ではなく確認事項です）</p>
      )}
    </div>
  )
}

export { contestScore, totalScore }
