import { useState } from 'react'
import { Remaining } from '@/components/shared/Remaining'
import { CONTESTS, type ContestId } from '@/apps/registry'
import { CONTEST_INFO } from '@/apps/contests-info'
import { PROGRESS_AS_OF, plansByContest, type Owner, type PlanProgress, type TodoItem } from '@/data/progress'
import { CONTEST_STATUS, crossItems, type CrossItem } from '@/data/status'

const asOf = PROGRESS_AS_OF.slice(5).replace('-', '/')
const contestShort = (id: ContestId | 'registry') => (id === 'registry' ? '登録情報' : (CONTESTS.find((c) => c.id === id)?.short ?? id))

/** 担当の札。色に頼らず、文言と形で区別する */
function OwnerTag({ owner }: { owner?: Owner | '待ち' }) {
  if (!owner) return <span className="rounded border border-dashed border-slate-400 px-1 text-xs text-muted-foreground">担当: 記載なし</span>
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

function Ref({ r }: { r?: string }) {
  return r ? <span className="ml-1 break-all text-xs text-muted-foreground">詳細: {r}</span> : null
}

/** ポータルの先頭: 全コンペ横断の「総司令官のやること」（締切順。1項目1行） */
export function PortalProgress({ onSelectContest }: { onSelectContest: (id: ContestId) => void }) {
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
  return (
    <section aria-label="総司令官のやること" className="space-y-2 rounded-lg border-2 border-slate-700 bg-card p-3" data-testid="portal-progress">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-bold">
        総司令官のやること
        <span className="text-xs font-normal text-muted-foreground">全コンペ・締切順・{asOf} 時点（{items.length}件）</span>
      </h2>
      <ul className="space-y-0.5 text-xs" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄（氏名・所属・体制・経験）が未記入</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span>main へのマージ待ち: PR #13・#14・#12（詳細: reports/ops/status-{PROGRESS_AS_OF.replaceAll('-', '')}.md）</span>
        </li>
      </ul>
      <p className="text-xs">
        <span aria-hidden>□</span> 作業　<Question>判断</Question> 決める事項
      </p>
      <div className="grid items-start gap-2 lg:grid-cols-3" data-testid="progress-tasks">
        {groups.map((g, gi) => (
          <details key={g.key} open={wide || gi === 0} className="rounded-md border border-slate-500 p-2" data-testid="task-group">
            <summary className="cursor-pointer text-sm font-bold">
              {g.at ? `締切 ${g.label}` : '締切の記載なし'}
              {g.at && (
                <>
                  {' '}
                  <Remaining at={g.at} />
                </>
              )}
              <span className="ml-1 text-xs font-normal text-muted-foreground">（{g.rows.length}件）</span>
            </summary>
            <ul className="mt-1.5 space-y-1 text-xs">
              {g.rows.map((r, i) => (
                <li key={i} className="flex gap-1.5" data-testid={r.kind === 'decision' ? 'decision-item' : 'task-item'}>
                  <span aria-hidden className="font-bold">{r.kind === 'decision' ? '？' : '□'}</span>
                  <span className="sr-only">{r.kind === 'decision' ? '判断: ' : '作業: '}</span>
                  <span className="min-w-0">
                    <span className="mr-1 rounded border border-slate-500 px-1 font-bold">{contestShort(r.contest)}</span>
                    {r.who && <span className="mr-1 font-bold">{r.who}</span>}
                    {r.text.replace(/^(衛星|イチBiz|UDC|ODPT)[ :]\s*/, '')}
                    {r.kind === 'decision' && r.contest !== 'registry' && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectContest(r.contest as ContestId)
                          window.scrollTo({ top: 0 })
                        }}
                        className="ml-1 inline-flex min-h-8 items-center text-xs font-medium text-primary underline underline-offset-2"
                      >
                        タブを開く
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ))}
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
    <section aria-label="提出までの状況" className="rounded-lg border-2 border-slate-700 bg-card p-3" data-testid={`contest-status-${contest}`}>
      <h3 className="text-base font-bold">
        提出までの状況<span className="ml-2 text-xs font-normal text-muted-foreground">{asOf} 時点</span>
      </h3>
      <dl className="mt-1.5 grid gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-bold">締切</dt>
        <dd className="flex flex-wrap gap-x-4 gap-y-1">
          {info.deadlines.map((d) => (
            <span key={d.label} className="inline-flex items-center gap-1.5">
              {d.label} {d.text}
              <Remaining at={d.at} />
            </span>
          ))}
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

function PlanCard({ p }: { p: PlanProgress }) {
  const [plan, ...rest] = p.kind.split('・')
  const doneRows = p.done.map(splitRef)
  return (
    <article className="rounded-lg border bg-card p-3" data-testid={`plan-progress-${p.id}`}>
      <header className="space-y-0.5">
        <h4 className="text-sm font-bold">{p.name}</h4>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-bold ${plan === '新しい案' ? 'border border-dashed border-slate-600' : 'border border-slate-600'}`} data-testid="plan-kind">{plan}</span>
          <span className={`rounded px-1.5 py-0.5 font-bold ${INTENT_CLS[p.intent]}`} data-testid="plan-intent">{p.intent}</span>
          {rest.length > 0 && <span className="text-muted-foreground">{rest.join('・')}</span>}
          <span className="text-muted-foreground">締切 {p.deadlineLabel}</span>
        </p>
      </header>
      {p.decided && (
        <p className="mt-1.5 border-l-4 border-slate-800 bg-slate-100 px-2 py-1 text-xs font-bold" data-testid="plan-decided">
          決定: {p.decided}
        </p>
      )}
      <ul className="mt-2 space-y-1 text-xs" data-testid="plan-checklist">
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
              {t} <Question>判断待ち</Question>
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
    </article>
  )
}

/** コンペのタブ: 提出までの状況、その下に案ごとのチェックリスト */
export function ContestProgress({ contest }: { contest: ContestId }) {
  const plans = plansByContest(contest)
  if (plans.length === 0) return null
  return (
    <div className="space-y-2">
      <ContestStatusBox contest={contest} />
      <section aria-label="案ごとのチェックリスト" className="space-y-1.5" data-testid={`contest-progress-${contest}`}>
        <h3 className="text-sm font-bold">
          案ごとのチェックリスト
          <span className="ml-2 text-xs font-normal text-muted-foreground">✓ 完了　□ 未完了（担当）　？ 判断待ち・要確認</span>
        </h3>
        <div className="grid gap-2 lg:grid-cols-2">
          {plans.map((p) => (
            <PlanCard key={p.id} p={p} />
          ))}
        </div>
      </section>
    </div>
  )
}
