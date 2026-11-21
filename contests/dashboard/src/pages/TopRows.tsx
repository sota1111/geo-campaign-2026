import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { NEW_PLAN_LABEL, isNewPlan, getApp, CONTESTS, type AppMeta, type ContestId } from '@/apps/registry'
import { CONTEST_INFO, nextDeadline, type ContestInfo } from '@/apps/contests-info'
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

/** 画面の高さ・幅（カードの中身を、利用できる高さに合わせて増減するため）。1280px 未満は縦スクロールしてよいので全部出す */
function useViewport() {
  const read = () => (typeof window === 'undefined' ? { w: 1513, h: 784 } : { w: window.innerWidth, h: window.innerHeight })
  const [v, setV] = useState(read)
  useEffect(() => {
    const f = () => setV(read())
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return v
}
/** 幅 1024px 以上は「画面の高さに合わせて詰める」（4枚を横に並べ、縦スクロールなし）。未満は全部出して縦に積む */
export function useFit(): boolean {
  return useViewport().w >= 1024
}
/**
 * 各カードを最大の表示（lv 0）から始め、可変部分が入れ物より高いとき、段階（lv）を上げて行数・件数を減らしていく（入るところで止まるので、ボタンの上に空白が残らない）。
 * フォントや描画の違いがあっても、行の途中で切れず、下端のボタンが必ず見える。画面の大きさ・中身・Web フォント読み込みが変わると 0 からやり直す。
 */
function useFitLevel(deps: string, max: number) {
  const ref = useRef<HTMLDivElement>(null)
  const { w, h } = useViewport()
  const [fontTick, setFontTick] = useState(0)
  const [, setRz] = useState(0)
  // 入れ物の高さが（隣のカードの段階が変わって）変わったときにも、はみ出しを確かめ直す
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setRz((n) => n + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    document.fonts?.ready.then(() => setFontTick((n) => n + 1))
  }, [])
  const key = `${w}x${h}|${fontTick}|${deps}`
  const [st, setSt] = useState({ key, lv: 0 })
  const lv = st.key === key ? st.lv : 0
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // 端数のはみ出し（1px 未満）も見逃さないよう、最後の子の下端でも確かめる
    const last = el.lastElementChild as HTMLElement | null
    const over = el.scrollHeight > el.clientHeight || (!!last && last.getBoundingClientRect().bottom > el.getBoundingClientRect().bottom + 0.1)
    if (over && lv < max) setSt({ key, lv: lv + 1 })
  })
  return { ref, lv }
}

/**
 * コンペカードの表示の優先順位（残す順）: 見出し帯（名前・次の締切・提出可否）→ 概要 → 審査基準 → 総司令官の判断待ち → 次にやること → 主なルール → 提出可能数 → このコンペに出すアプリの件数。
 * 入りきらないときは下位から削る（行数 → 「ほか n 件」 → 非表示）。概要と審査基準は最後まで残し、削るのは最終手段（概要 3→2→1 行、審査基準 全項目→2→1 行）。
 * lv: -1 = 全項目・全文（幅 1024px 未満で縦に積むとき）、0 = 全項目（各2行まで）、1 以上 = 下位から削る。
 */
export const CARD_MAX_LV = 19
export function cardPlan(lv: number) {
  const c2 = 'line-clamp-2'
  const all = lv < 0
  return {
    c2,
    // 下位から: 件数の行(1) → 提出可能数(2〜4) → 主なルール(5〜7) → 次にやること(8〜10) → 判断待ち(11〜14) → 審査基準・概要の行数(15〜19)
    hideTargets: lv >= 1,
    nLimits: all ? 99 : lv >= 2 ? 1 : 2,
    limitsClamp: lv >= 3 ? 'line-clamp-1' : c2,
    hideLimits: lv >= 4,
    nRules: all ? 99 : lv >= 5 ? 1 : 2,
    rulesClamp: lv >= 6 ? 'line-clamp-1' : c2,
    hideRules: lv >= 7,
    nNext: all ? 99 : lv >= 8 ? 1 : 2,
    hideNext: lv >= 10,
    nextClamp: lv >= 9 ? 'line-clamp-1' : c2,
    nAsks: all ? 99 : lv >= 12 ? 1 : lv >= 11 ? 2 : 3,
    hideAsks: lv >= 14,
    cl: lv >= 13 ? 'line-clamp-1' : c2,
    // 概要は最大3行（最後の手段でだけ2行）、審査基準は全項目（最後の手段でだけ1行ずつ省略）
    sumClamp: all ? '' : lv >= 16 ? 'line-clamp-2' : 'line-clamp-3',
    hideSummary: false,
    critClamp: all ? '' : lv >= 19 ? 'line-clamp-1' : lv >= 15 ? 'line-clamp-2' : 'line-clamp-3',
    hideCrit: false,
  }
}

const SHORT_WORD: Record<string, string> = { '◎': 'このコンペ向け', '○': '出せる', '△': '条件付き', '×': '出せない', '？': '要確認' }

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
  const nexts = st.next.filter((n) => !n.decision)
  const next = nexts[0] ?? st.next[0]
  const fit = useFit()
  const { ref: regRef, lv: lv0 } = useFitLevel(`${info.id}|${fit}|${selected}|${appsForContest(targets, info.id).length}`, CARD_MAX_LV + 1)
  const pl = cardPlan(fit ? lv0 - 1 : -1)
  const { hideSummary, sumClamp, hideCrit, critClamp, hideRules, nRules, rulesClamp, hideLimits, nLimits, limitsClamp, hideTargets, nAsks, nNext, cl, hideNext, nextClamp, hideAsks } = pl
  const hideDiv = hideTargets
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
      className={`relative flex h-full min-h-0 min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 shadow-sm ${color.tint} ${selected ? 'outline outline-4 outline-offset-2 outline-slate-900' : ''}`}
    >
      <h3 className={`flex items-center justify-between gap-2 px-2.5 py-1 text-sm font-bold leading-tight ${color.band}`}>
        <span className="min-w-0 truncate" title={contest.name}>
          <span aria-hidden>{color.mark} </span>
          {contest.name}
        </span>
        {selected && <span className="shrink-0 rounded bg-white px-1.5 text-xs text-slate-900" data-testid="selected-tag"><span aria-hidden>✓ </span>選択中</span>}
      </h3>
      <div className="flex min-h-0 flex-1 flex-col bg-white/70 px-2.5 py-1 text-[0.8125rem] leading-snug">
      <div ref={regRef} className={`flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden`}>
        <p className="flex flex-wrap items-center gap-x-2" data-testid="row-deadline">
          <span className="whitespace-nowrap">
            次の締切 <span className="font-bold">{nd.text}</span>
            <Remaining at={nd.at} />
          </span>
          {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
        </p>
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="font-bold" data-testid="row-status" title={st.gap}>
            <span aria-hidden>▲ </span>
            {STATUS_LABEL[info.id]}
            <span className="font-normal">（提出不可）</span>
          </span>
        </p>
        {!hideSummary && <p className={`shrink-0 ${sumClamp}`} data-testid="card-summary" title={info.summary}><span className="font-bold">概要 </span>{info.summary}</p>}
        {!hideCrit && <p className={`shrink-0 ${critClamp}`} data-testid="card-criteria" title={info.criteria.map((c) => c.name).join('・')}>
          <span className="font-bold">審査基準 </span>{info.criteria.map((c) => c.name).join('・')}
        </p>}
        {!hideAsks && (
        <Sec
          testid="row-asks"
          title={asks.join(' ／ ')}
          label={<span className="rounded bg-amber-100 px-1 font-bold text-amber-950"><span aria-hidden>？ </span>総司令官の判断待ち {asks.length}件</span>}
          extra={asks.length > nAsks ? `（先頭${nAsks}件。全文は下の折りたたみ）` : ''}
          items={asks.slice(0, nAsks).map((t) => ({ key: t, node: t, text: t }))}
          clamp={cl}
        />
        )}
        {!hideNext && (
        <Sec
          testid="card-next"
          label={<span className="font-bold">次にやること</span>}
          extra={nexts.length > nNext ? `（ほか${nexts.length - nNext}件）` : ''}
          items={nexts.slice(0, nNext).map((n) => ({
            key: n.text,
            text: n.text,
            node: <>{n === next ? <span data-testid="row-next">{n.text}</span> : n.text}<span className="text-slate-700">（{n.owner}）</span></>,
          }))}
          clamp={nextClamp}
        />
        )}
        {!hideRules && <Sec
          testid="card-rules"
          label={<span className="font-bold">主なルール</span>}
          extra={info.keyRules.length > nRules ? `（ほか${info.keyRules.length - nRules}件）` : ''}
          items={info.keyRules.slice(0, nRules).map((r) => ({ key: r.text, text: r.text, node: <>{r.unconfirmed && '（要確認）'}{r.text}</> }))}
          clamp={rulesClamp}
        />}
        {!hideLimits && <Sec
          testid="card-limits"
          label={<span className="font-bold">提出可能数</span>}
          extra={info.limits.length > nLimits ? `（ほか${info.limits.length - nLimits}件）` : ''}
          items={info.limits.slice(0, nLimits).map((r) => ({ key: r.text, text: r.text, node: <>{r.unconfirmed && '（未確認）'}{r.text}</> }))}
          clamp={limitsClamp}
        />}
        {info.id === 'ichibiz-2026' && !hideDiv && (
          <p className="text-xs text-slate-800" data-testid="ichibiz-divisions" aria-label="3つの部門" title={cols.map((c) => `${c.division} ${c.deadline.replace('2026-', '').replace('-', '/')}`).join('／')}>
            {cols.map((c, i) => (
              <span key={c.id}>
                {i > 0 && '／'}
                <span className="font-bold">{c.division}</span> {c.deadline.replace('2026-', '').replace('-', '/')}・{appsForColumn(targets, c.id).length}件
              </span>
            ))}
          </p>
        )}
        {!hideTargets && (
        <p className="shrink-0 truncate" data-testid={`targets-${info.id}`} aria-live="polite" title={chosen.map(appName).join('、')}>
          <span className="font-bold">このコンペに出すアプリ {chosen.length}件</span>
          <span className="text-slate-800">{chosen.length ? `：${chosen.map(appName).join('、')}` : '（未選択）'}</span>
        </p>
        )}
      </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <button
            type="button"
            aria-pressed={selected}
            onClick={onSelect}
            data-testid={`pick-${info.id}`}
            className={`min-h-11 rounded-md border-2 border-slate-900 px-2 text-xs font-bold md:min-h-8 ${focus} ${selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-900 hover:bg-slate-100'}`}
          >
            {selected ? <><span aria-hidden>✓ </span>並べ替え中（解除）</> : 'このコンペで並べる'}
          </button>
          <a
            href={contestUrl(info.id)}
            data-testid={`row-${info.id}`}
            className={`inline-flex min-h-11 items-center gap-0.5 font-bold md:min-h-8 text-slate-900 underline underline-offset-2 ${focus}`}
            title={`${contest.name}の概要・進捗・審査基準を見る`}
          >
            概要・進捗へ
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
      </div>
      <details className="border-t bg-white/70 px-2.5 text-xs" data-testid={`facts-${info.id}`}>
        <summary className="min-h-7 cursor-pointer truncate py-1 font-bold" title="判断待ち・次にやること・概要・審査基準・ルール・提出可能数の全文">全文と出典（概要・審査基準・ルール・提出可能数）</summary>
        {/* 開いた中身はカードの中だけでスクロールする（カードの高さは変えず、アプリの行を押し出さない） */}
        <dl className="absolute inset-x-0 bottom-7 top-7 z-10 space-y-2 overflow-y-auto border-y-2 border-slate-400 bg-white px-2.5 py-2" tabIndex={0} aria-label={`${contest.name}の詳細（この枠の中でスクロールします）`}>
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

/** コンペカードの1区画。見出しの後ろに先頭の1件を続けて1段落にし（1件のとき）、複数件のときは見出しの下に箇条書きにする */
function Sec({
  testid, title, label, extra, items, clamp,
}: { testid: string; title?: string; label: React.ReactNode; extra: string; items: { key: string; node: React.ReactNode; text: string }[]; clamp: string }) {
  const extraNode = extra && <span className="text-slate-700">{extra}</span>
  if (items.length <= 1) {
    return (
      <p className={`shrink-0 ${clamp}`} data-testid={testid} title={title ?? items[0]?.text}>
        {label}{extraNode} {items[0]?.node}
      </p>
    )
  }
  return (
    <div className="shrink-0" data-testid={testid} title={title}>
      <p>{label}{extraNode}</p>
      <ul className="list-disc pl-4">
        {items.map((it) => <li key={it.key} className={clamp} title={it.text}>{it.node}</li>)}
      </ul>
    </div>
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
            <p className="text-xs">［出典: {c.caution.source}］</p>
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
  const fit = useFit()
  const plan = planOf(a)
  const info = CONTEST_INFO.find((c) => c.id === a.contest)!
  const nd = plan ? { at: plan.deadlineAt, text: plan.deadlineLabel } : nextDeadline(info)
  const left = plan ? [...plan.todo.map((t) => t.text), ...(plan.decisions ?? [])] : []
  const { ref: regRef, lv: lv0 } = useFitLevel(`${a.id}|${fit}|${chosen.length}|${contest}`, 12)
  // 最大（残りの作業 5件・目的 3行）から始め、入るところまで減らす
  const lv = fit ? lv0 : -1
  const nLeft = lv < 0 ? 99 : lv >= 8 ? 0 : Math.max(1, 5 - lv)
  const purposeClamp = lv < 0 ? '' : lv >= 4 ? 'line-clamp-1' : lv >= 2 ? 'line-clamp-2' : 'line-clamp-3'
  const tight = lv >= 5
  const chosenCols = FIT_COLUMNS.filter((c) => chosen.includes(c.id))
  return (
    <li
      data-app-card={a.id}
      data-rank={rank}
      className={`relative flex h-full w-72 min-h-0 shrink-0 snap-start flex-col gap-1 p-2 overflow-hidden rounded-lg border-2 border-l-8 bg-white text-[0.8125rem] leading-snug shadow-sm lg:w-[calc((100%-1.5rem)/3.7)] ${color.edge} ${isNew ? 'border-slate-500' : 'border-slate-300'}`}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1 text-xs">
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
        {plan && <span className={`rounded border px-1 ${plan.intent === '提出予定' ? 'border-slate-700 font-bold' : 'border-dashed border-slate-500'}`}>{plan.intent}</span>}
      </div>
      <div ref={regRef} className={`flex min-h-0 flex-1 flex-col gap-1 overflow-hidden`}>
      <h3 className={`${lv >= 10 ? 'line-clamp-1' : 'line-clamp-2'} shrink-0 text-base font-bold leading-tight text-slate-900`}>
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
      {lv < 9 && <p className={`shrink-0 ${purposeClamp} text-slate-800`} title={a.purpose} data-testid="card-purpose">
        <span className="font-bold">目的 </span>{a.purpose}
      </p>}
      <ul className={`grid shrink-0 gap-y-0.5 min-[1100px]:grid-cols-2 min-[1100px]:gap-x-1 ${lv >= 6 ? 'grid-cols-2 gap-x-1' : 'grid-cols-1'}`} aria-label="出せるコンペ（◎このコンペ向け ○出せる △条件付き ×出せない ？要確認）">
        {MINI.map((m) => {
          const cell = bestCell(a.id, m.id)
          const emph = contest === m.id
          const picked = columnsOf(m.id).some((c) => chosen.includes(c.id))
          return (
            <li
              key={m.id}
              data-fit-mini={m.id}
              data-emph={emph ? 'true' : undefined}
              className={`flex items-center gap-1 rounded px-1 ${picked ? 'border-2 border-slate-900 bg-slate-900 font-bold text-white' : emph ? 'border-2 border-slate-900 bg-yellow-50 font-bold' : 'border border-slate-300'}`}
              title={cell ? `${m.label}: ${cell.mark} ${MARK_WORD[cell.mark]}` : m.label}
            >
              <span className="shrink-0">{picked && <span aria-hidden>✓</span>}{!picked && emph && <span aria-hidden>▶</span>}{m.label}{picked && <span className="sr-only">（選択済み）</span>}</span>
              <span className="min-w-0 truncate" data-testid={`mini-mark-${a.id}-${m.id}`}>
                <span className="font-bold">{cell?.mark ?? '－'}</span>
                <span className="text-[0.75rem]"> {cell ? SHORT_WORD[cell.mark] : ''}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p data-testid={`chosen-${a.id}`} className={`${tight ? 'line-clamp-1' : 'line-clamp-2'} shrink-0`} title={chosenCols.map(columnShort).join('、')}>
        <span className="font-bold"><span aria-hidden>✓ </span>選んだ提出先 {chosenCols.length}件</span>
        <span className="text-slate-800">{chosenCols.length ? `：${chosenCols.map(columnShort).join('、')}` : '（未選択）'}</span>
      </p>
      <div data-testid={`plan-${a.id}`} className="shrink-0">
        <p className="flex flex-wrap items-center gap-x-2" data-testid={`app-deadline-${a.id}`}>
          {plan && (
            <span className="font-bold tabular-nums" title="案の進み具合（reports/ops の進捗一覧）">
              済{plan.done.length}・残{left.length}
              {left.length > 0 && <span className="font-normal text-slate-700">{nLeft > 0 && `（先頭${Math.min(nLeft, left.length)}件${left.length > nLeft ? `・ほか${left.length - nLeft}件` : ''}）`}</span>}
            </span>
          )}
          <span className="whitespace-nowrap">締切 <span className="font-bold">{nd.text}</span> <Remaining at={nd.at} /></span>
        </p>
        {left.length > 0 && (
          <ul className="list-disc pl-4">
            {left.slice(0, nLeft).map((t) => <li key={t} className={lv >= 3 ? 'line-clamp-1' : 'line-clamp-2'} title={t}>{t}</li>)}
          </ul>
        )}
      </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <a
          href={appUrl(a.id)}
          data-testid={`open-app-${a.id}`}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-0.5 whitespace-nowrap rounded-md border-2 border-slate-900 bg-slate-900 px-1.5 text-xs font-bold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 md:min-h-8"
        >
          アプリを開く<ArrowRight className="size-4 max-xl:hidden" aria-hidden />
        </a>
        <FitPopover a={a} contest={contest} chosen={chosen} onToggle={onToggle} cautions={cautions} />
        {cautions.length > 0 && (
          <span className="rounded border border-amber-700 bg-amber-50 px-1 text-xs font-bold text-amber-950" data-testid={`caution-tag-${a.id}`}><span aria-hidden>▲ </span>注意</span>
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
          className="min-h-11 flex-1 whitespace-nowrap rounded-md md:min-h-8 border-2 border-slate-900 bg-white px-1.5 text-xs font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          aria-label={`${a.name}の提出先を選ぶ（${chosen.length}件選択中）`}
        >
          提出先<span className="max-xl:hidden">を選ぶ</span><span data-testid={`chosen-count-${a.id}`}>（{chosen.length}件）</span>
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
            <p className="mb-1 text-xs leading-snug text-slate-800">右の記号は関連の判定（情報部）。左のチェックが、あなたの選択です。</p>
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
                    <label htmlFor={id} className={`flex min-h-11 items-center gap-1.5 md:min-h-8 ${ok ? 'cursor-pointer' : 'cursor-not-allowed text-slate-700'}`}>
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
                        <summary className="min-h-11 cursor-pointer py-2.5 font-normal underline md:min-h-8 md:py-1">選べない理由</summary>
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
                      <span className="block text-xs text-slate-700">［出典: {cell.source}］</span>
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
          <PopoverPrimitive.Close className="mt-1 min-h-11 rounded-md md:min-h-8 border-2 border-slate-900 bg-white px-2 text-xs font-bold hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-slate-900">
            閉じる
          </PopoverPrimitive.Close>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** 横一列に並べた、その行の中だけ横スクロールする入れ物。左右の送りボタンと「n件中 m〜k件目」つき */
export function ScrollRow({ label, children, resetKey, total, toolbar, empty }: { label: string; children: React.ReactNode; resetKey?: string; total: number; toolbar?: React.ReactNode; empty?: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null)
  const [edge, setEdge] = useState({ left: true, right: false })
  const [range, setRange] = useState({ from: 1, to: 1 })
  const update = () => {
    const el = ref.current
    if (!el) return
    setEdge({ left: el.scrollLeft <= 2, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 })
    const box = el.getBoundingClientRect()
    const kids = [...el.children] as HTMLElement[]
    const all = kids.map((k, i) => ({ i, r: k.getBoundingClientRect() }))
    // 全部見えているカードの数で数える（一部だけ見えているカードは数えない。1枚も全部見えないときだけ一部見えを使う）
    const full = all.filter(({ r }) => r.left >= box.left - 2 && r.right <= box.right + 2)
    const vis = full.length ? full : all.filter(({ r }) => r.right > box.left + 8 && r.left < box.right - 8)
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
    <div className="flex min-h-0 flex-1 flex-col">
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
        <span className="hidden 2xl:inline">ボタン・スワイプ・左右の矢印キーで横に送れます</span>
        {toolbar}
      </div>
      {total === 0 && empty && <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border-2 border-dashed border-slate-500 bg-white p-4 text-center" data-testid="app-empty">{empty}</div>}
      <ul
        ref={ref}
        onScroll={update}
        tabIndex={0}
        aria-label={label}
        data-testid="app-row"
        className={`${total === 0 && empty ? 'hidden' : 'flex'} min-h-0 flex-1 snap-x items-stretch gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900`}
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
