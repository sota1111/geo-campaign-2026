import { DeadlineChip, Remaining } from '@/components/shared/Remaining'
import { type ContestId } from '@/apps/registry'
import { CONTEST_INFO } from '@/apps/contests-info'
import { PROGRESS_AS_OF, plansByContest, type Owner, type PlanProgress, type TodoItem } from '@/data/progress'
import { CONTEST_STATUS, crossItems } from '@/data/status'

export const asOf = PROGRESS_AS_OF.slice(5).replace('-', '/')


/** 担当の札。色に頼らず、文言と形で区別する。担当が不明な項目は札を出さない */
export function OwnerTag({ owner }: { owner?: Owner }) {
  if (!owner) return null
  if (owner === '総司令官') return <span className="rounded bg-slate-800 px-1 text-xs font-bold text-white">担当: 総司令官</span>
  return <span className="rounded border border-slate-600 px-1 text-xs font-bold">担当: {owner}</span>
}

/** 判断待ち・要確認は ？ を付ける（アンバーの枠＋記号＋文言） */
export function Question({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded border border-amber-600 bg-amber-100 px-1 text-xs font-bold text-amber-950">
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

/** そのコンペの判断待ち。選ばれていない案の作業は、判断の下に畳む */
function DecisionList({ contest }: { contest: ContestId }) {
  const items = crossItems().filter((i) => i.kind === 'decision' && i.contest === contest)
  if (items.length === 0) return <span className="text-muted-foreground">なし</span>
  return (
    <ul className="space-y-1" data-testid="contest-decisions">
      {items.map((r) => (
        <li key={r.text} className="rounded border-l-4 border-amber-600 bg-amber-50 px-1.5 py-1" data-testid="decision-item">
          <Question>判断</Question> {r.text.replace(PREFIX, '')}
          {r.label && <span className="ml-1 text-xs text-muted-foreground">（締切 {r.label}）</span>}{' '}
          <OwnerTag owner="総司令官" />
          {r.children && r.children.length > 0 && (
            <details className="mt-1 rounded border border-dashed border-slate-500 bg-card px-1.5 py-0.5 text-xs" data-testid="conditional-tasks">
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
        </li>
      ))}
    </ul>
  )
}

/** 各コンペの詳細の最上段: 提出までの状況 */
export function ContestStatusBox({ contest }: { contest: ContestId }) {
  const info = CONTEST_INFO.find((c) => c.id === contest)
  const st = CONTEST_STATUS[contest]
  if (!info || !st) return null
  return (
    <section
      aria-label="提出までの状況"
      className="rounded-lg border-2 border-slate-700 bg-card p-3"
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
        <dt className="font-bold">判断待ち</dt>
        <dd>
          <DecisionList contest={contest} />
        </dd>
        <dt className="font-bold">次にやること</dt>
        <dd>
          <ol className="space-y-1">
            {st.next.filter((n) => !n.decision).map((n, i) => (
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
