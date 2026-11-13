import { useState } from 'react'
import { DeadlineChip, Remaining } from '@/components/shared/Remaining'
import { CONTESTS, type ContestId } from '@/apps/registry'
import { CONTEST_INFO } from '@/apps/contests-info'
import { PROGRESS_AS_OF, PROGRESS_SOURCE, plansByContest, type Owner, type PlanProgress, type TodoItem } from '@/data/progress'
import { CONTEST_STATUS, crossItems, type CrossItem } from '@/data/status'

const asOf = PROGRESS_AS_OF.slice(5).replace('-', '/')
const contestShort = (id: ContestId | 'registry') => (id === 'registry' ? '登録情報' : (CONTESTS.find((c) => c.id === id)?.short ?? id))

/** 「提出までの状況」の id。「状況を見る」とタブの切り替えがここへスクロールする */
export const statusId = (c: ContestId) => `status-${c}`

/** 担当の札。色に頼らず、文言と形で区別する。担当が不明な項目は札を出さない */
function OwnerTag({ owner }: { owner?: Owner }) {
  if (!owner) return null
  if (owner === '総司令官') return <span className="rounded bg-slate-800 px-1 text-xs font-bold text-white">担当: 総司令官</span>
  return <span className="rounded border border-slate-600 px-1 text-xs font-bold">担当: {owner}</span>
}

/** 判断待ち・要確認は ？ を付ける（アンバーの枠＋記号＋文言） */
function Question({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-amber-600 bg-amber-100 px-1 text-xs font-bold text-amber-950">
      <span aria-hidden>？</span>
      {children}
    </span>
  )
}

/** 文中の reports/ のパスを本文から外し、あとに添える */
function splitRef(t: string) {
  const ref = t.match(/reports\/[\w./-]+/)?.[0]
  if (!ref) return { text: t }
  return { text: t.replace(ref, '').replace(/。\s*）/, '）').replace(/（\s*）/, ''), ref }
}

/** 出典のパスは「詳細」だけを見せ、パスは title に置く（長いパスで折り返さない） */
function Ref({ r }: { r?: string }) {
  return r ? (
    <span className="ml-1 text-xs text-muted-foreground" title={r}>
      （詳細: {r.split('/').pop()}）
    </span>
  ) : null
}

const PREFIX = /^(衛星|イチBiz|UDC|ODPT)[ :]\s*/

/** ポータルの先頭: 全コンペ横断の「総司令官のやること」。いちばん近い締切だけ開き、他は件数付きで畳む。判断を先、作業を後に並べる */
export function PortalProgress({ onOpenStatus }: { onOpenStatus: (id: ContestId) => void }) {
  const [wide] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 1024px)').matches)
  const items = crossItems()
  const groups: { key: string; at?: string; label: string; rows: CrossItem[] }[] = []
  for (const it of items) {
    const key = it.at ?? 'none'
    let g = groups.find((x) => x.key === key)
    if (!g) groups.push((g = { key, at: it.at, label: '', rows: [] }))
    g.rows.push(it)
    if (it.label.length > g.label.length) g.label = it.label
  }
  const nDec = items.filter((i) => i.kind === 'decision').length
  const nCond = items.reduce((n, i) => n + (i.children?.length ?? 0), 0)
  return (
    <section aria-label="総司令官のやること" className="space-y-1.5 rounded-lg border-2 border-slate-700 bg-card p-3" data-testid="portal-progress">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-bold">
        総司令官のやること
        <span className="text-xs font-normal text-muted-foreground">
          締切順・{asOf} 時点（判断 {nDec}件・作業 {items.length - nDec}件。未選定の案の作業 {nCond}件は判断の下に畳む）
        </span>
        <span className="text-xs font-normal">
          <Question>判断</Question> 決める事項（先に並べる）　<span aria-hidden>□</span> 作業
        </span>
      </h2>
      <ul className="space-y-0.5 text-xs lg:flex lg:gap-6" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄（氏名・所属・体制・経験）が未記入</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span>main へのマージ待ち（締切なし）: PR #13・#14・#12（詳細: {PROGRESS_SOURCE}）</span>
        </li>
      </ul>
      <div data-testid="progress-tasks">
        {(() => {
        const cards = groups.map((g, gi) => {
          const dec = g.rows.filter((r) => r.kind === 'decision').length
          const task = g.rows.length - dec
          return (
            <details key={g.key} open={gi === 0} className="rounded-md border border-slate-500 p-2" data-testid="task-group">
              <summary className="cursor-pointer text-sm font-bold">
                {g.at ? `締切 ${g.label}` : '締切の記載なし'}
                {g.at && (
                  <>
                    {' '}
                    <Remaining at={g.at} />
                  </>
                )}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  （{dec > 0 && `判断${dec}`}
                  {dec > 0 && task > 0 && '・'}
                  {task > 0 && `作業${task}`}）
                </span>
              </summary>
              <ul className="mt-1.5 space-y-1 text-xs">
                {g.rows.map((r, i) => (
                  <li
                    key={i}
                    className={`flex gap-1.5 ${r.kind === 'decision' ? 'rounded border-l-4 border-amber-600 bg-amber-50 px-1.5 py-1' : ''}`}
                    data-testid={r.kind === 'decision' ? 'decision-item' : 'task-item'}
                  >
                    {r.kind === 'decision' ? (
                      <span className="shrink-0">
                        <Question>判断</Question>
                      </span>
                    ) : (
                      <>
                        <span aria-hidden className="font-bold">□</span>
                        <span className="sr-only">作業: </span>
                      </>
                    )}
                    <div className="min-w-0">
                      <span className="mr-1 rounded border border-slate-500 px-1 font-bold">{contestShort(r.contest)}</span>
                      {r.who && <span className="mr-1 font-bold">{r.who}</span>}
                      {r.text.replace(PREFIX, '')}
                      {r.kind === 'decision' && r.contest !== 'registry' && (
                        <button
                          type="button"
                          onClick={() => onOpenStatus(r.contest as ContestId)}
                          className="ml-1 inline-flex min-h-8 items-center text-xs font-medium text-primary underline underline-offset-2"
                        >
                          状況を見る
                        </button>
                      )}
                      {r.children && r.children.length > 0 && (
                        <details className="mt-1 rounded border border-dashed border-slate-500 bg-card px-1.5 py-0.5" data-testid="conditional-tasks">
                          <summary className="cursor-pointer font-medium">選んだ案で必要になる作業（{r.children.length}件）</summary>
                          <ul className="mt-1 space-y-1 pb-1">
                            {r.children.map((c, j) => (
                              <li key={j} className="flex gap-1.5" data-testid="conditional-item">
                                <span aria-hidden className="font-bold">□</span>
                                <span className="sr-only">作業（選んだ場合）: </span>
                                <span className="min-w-0">
                                  <span className="mr-1 font-bold">{c.who}</span>
                                  {c.text}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )
        })
        const others = cards.slice(1)
        return wide ? (
          <div className="grid items-start gap-2 lg:grid-cols-[1fr_2fr]">
            {cards[0]}
            <div className="grid items-start gap-2 lg:grid-cols-2">{others}</div>
          </div>
        ) : (
          <div className="space-y-2">
            {cards[0]}
            <details className="rounded-md border border-slate-500 p-2" data-testid="other-groups">
              <summary className="cursor-pointer text-sm font-bold">ほかの締切 {others.length}件（開くと件数と内容）</summary>
              <div className="mt-2 space-y-2">{others}</div>
            </details>
          </div>
        )
        })()}
      </div>
    </section>
  )
}

/** 各コンペのタブの最上段: 提出までの状況 */
export function ContestStatusBox({ contest }: { contest: ContestId }) {
  const info = CONTEST_INFO.find((c) => c.id === contest)
  const st = CONTEST_STATUS[contest]
  if (!info || !st) return null
  return (
    <section
      id={statusId(contest)}
      tabIndex={-1}
      aria-label="提出までの状況"
      className="scroll-mt-14 rounded-lg border-2 border-slate-700 bg-card p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
      data-testid={`contest-status-${contest}`}
    >
      <h3 className="text-base font-bold">
        提出までの状況<span className="ml-2 text-xs font-normal text-muted-foreground">{asOf} 時点</span>
      </h3>
      <dl className="mt-1.5 grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-bold">締切</dt>
        <dd className="flex flex-wrap gap-x-4 gap-y-1" data-testid="contest-deadlines">
          {info.deadlines.map((d) => (
            <DeadlineChip key={d.label} d={d} />
          ))}
        </dd>
        <dt className="font-bold">済んだこと</dt>
        <dd data-testid="contest-done">
          <span aria-hidden>✓ </span>
          {st.done}
        </dd>
        <dt className="font-bold">提出可能か</dt>
        <dd className="font-bold" data-testid="contest-gap">
          <span aria-hidden>▲ </span>
          {st.gap}
        </dd>
        <dt className="font-bold">次にやること</dt>
        <dd>
          <ol className="space-y-1">
            {st.next.map((n, i) => (
              <li key={n.text} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" data-testid="next-action">
                <span className="font-bold">{i + 1}.</span>
                {n.decision && <Question>判断</Question>}
                <span>{n.text}</span>
                <OwnerTag owner={n.owner} />
              </li>
            ))}
          </ol>
        </dd>
      </dl>
    </section>
  )
}

const INTENT_CLS: Record<PlanProgress['intent'], string> = {
  提出予定: 'bg-slate-800 text-white',
  比較中: 'border border-slate-600',
  出さない: 'border border-dashed border-slate-600 bg-slate-100',
}

/** 出さないと決めた案: 1行に畳む。作業は出さない（残作業は IN1 の側にある） */
function DecidedOutRow({ p }: { p: PlanProgress }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-dashed border-slate-500 bg-slate-50 px-3 py-1.5 text-xs" data-testid={`plan-progress-${p.id}`}>
      <span className="font-bold">{p.name}</span>
      <span className={`rounded px-1.5 py-0.5 font-bold ${INTENT_CLS[p.intent]}`} data-testid="plan-intent">{p.intent}</span>
      <span data-testid="plan-decided">{p.decided}</span>
    </p>
  )
}

function PlanCard({ p }: { p: PlanProgress }) {
  const [plan, ...rest] = p.kind.split('・')
  const doneRows = p.done.map(splitRef)
  const nLeft = p.todo.length + (p.decisions?.length ?? 0)
  return (
    <article className="rounded-lg border bg-card p-3" data-testid={`plan-progress-${p.id}`}>
      <header className="space-y-0.5">
        <h4 className="text-sm font-bold">{p.name}</h4>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-bold ${plan === '新しい案' ? 'border border-dashed border-slate-600' : 'border border-slate-600'}`} data-testid="plan-kind">{plan}</span>
          <span className={`rounded px-1.5 py-0.5 font-bold ${INTENT_CLS[p.intent]}`} data-testid="plan-intent">
            {p.intent}
            {p.intentNote && `（${p.intentNote}）`}
          </span>
          {rest.length > 0 && <span className="text-muted-foreground">{rest.join('・')}</span>}
        </p>
      </header>
      <details className="mt-1.5 text-xs" data-testid="plan-details">
        <summary className="cursor-pointer font-bold" data-testid="plan-summary">
          <span aria-hidden>✓</span> {p.done.length}件済・<span aria-hidden>□</span> {nLeft}件残
          <span className="ml-1.5 font-normal text-muted-foreground">開いて詳細を見る</span>
        </summary>
        <ul className="mt-1.5 space-y-1" data-testid="plan-checklist">
          {doneRows.map((d) => (
            <li key={d.text} className="flex gap-1.5">
              <span aria-hidden className="font-bold">✓</span>
              <span className="sr-only">完了: </span>
              <span className="min-w-0">
                {d.text}
                <Ref r={d.ref} />
              </span>
            </li>
          ))}
          {p.todo.map((t: TodoItem) => (
            <li key={t.text} className="flex gap-1.5">
              <span aria-hidden className="font-bold">{t.tag ? '？' : '□'}</span>
              <span className="sr-only">未完了: </span>
              <span className="min-w-0">
                {t.text}{' '}
                <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                  {t.tag && <Question>{t.tag}</Question>}
                  <OwnerTag owner={t.owner} />
                </span>
              </span>
            </li>
          ))}
          {p.decisions?.map((t) => (
            <li key={t} className="flex gap-1.5">
              <span aria-hidden className="font-bold">？</span>
              <span className="min-w-0">
                {t}{' '}
                <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                  <Question>判断待ち</Question>
                  <OwnerTag owner="総司令官" />
                </span>
              </span>
            </li>
          ))}
          {p.improve?.map((t) => {
            const s = splitRef(t)
            return (
              <li key={t} className="flex gap-1.5">
                <span aria-hidden className="font-bold">＋</span>
                <span className="min-w-0">
                  <span className="mr-1 rounded border border-slate-500 px-1 font-bold">改善の余地</span>
                  {s.text}
                  <Ref r={s.ref} />
                </span>
              </li>
            )
          })}
        </ul>
      </details>
    </article>
  )
}

/** コンペのタブ: 提出までの状況、その下に案ごとの要約（詳細は開いて見る） */
export function ContestProgress({ contest }: { contest: ContestId }) {
  const plans = plansByContest(contest)
  if (plans.length === 0) return null
  const active = plans.filter((p) => p.intent !== '出さない')
  const out = plans.filter((p) => p.intent === '出さない')
  return (
    <div className="space-y-2">
      <ContestStatusBox contest={contest} />
      <section aria-label="案ごとのチェックリスト" className="space-y-1.5" data-testid={`contest-progress-${contest}`}>
        <h3 className="text-sm font-bold">
          案ごとの進み具合
          <span className="ml-2 text-xs font-normal text-muted-foreground">✓ 済　□ 残り　？ 判断待ち・要確認（各案の「開いて詳細を見る」で一覧）</span>
        </h3>
        <div className="grid gap-2 lg:grid-cols-2">
          {active.map((p) => (
            <PlanCard key={p.id} p={p} />
          ))}
        </div>
        {out.map((p) => (
          <DecidedOutRow key={p.id} p={p} />
        ))}
      </section>
    </div>
  )
}
