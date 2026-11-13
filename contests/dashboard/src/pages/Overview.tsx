import { useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CircleHelp, ExternalLink, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSample } from '@/apps/_samples'
import { normalUrl, sampleUrl } from '@/components/layout/SampleBar'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { APPS, CARDS_ONLY, CONTESTS, NEW_PLAN_LABEL, appsByContest, getApp, isNewPlan, type AppMeta, type CardOnly, type ContestId } from '@/apps/registry'
import { appUrl, siteRoot } from '@/lib/data'
import { ContestProgress } from '@/pages/Progress'
import { CONTEST_INFO, type ContestInfo } from '@/apps/contests-info'
import { AppScoreLine } from '@/pages/EvalPanels'

/** 次に来る、まだ済んでいない締切（済んだ締切は除く。全部過ぎていれば最後の締切） */
export function nextDeadline(info: ContestInfo) {
  const now = Date.now()
  const open = info.deadlines.filter((d) => !d.doneAt)
  return open.find((d) => new Date(d.at).getTime() > now) ?? open[open.length - 1] ?? info.deadlines[info.deadlines.length - 1]
}

/** 新しい案（比較用・未選定）の目印。色だけに頼らず、黒地の文言と破線の枠で示す */
function NewPlanTag() {
  return (
    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white" data-testid="new-plan-tag">
      {NEW_PLAN_LABEL}
    </span>
  )
}

/** デモを持たない案（提出文のみ）のカード。開くボタンは置かない */
function CardOnlyCard({ c }: { c: CardOnly }) {
  const contest = CONTESTS.find((x) => x.id === c.contest)
  return (
    <Card data-app-card={c.id} className="flex flex-col gap-2 border-2 border-dashed border-slate-500 bg-slate-50 py-3">
      <CardHeader className="gap-1 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <NewPlanTag />
          <span className="rounded border border-slate-500 px-1.5 py-0.5 text-xs font-bold">{c.demoAppId ? '提出文のみ（デモは AED マップ）' : 'デモなし'}</span>
        </div>
        <CardTitle className="text-base leading-tight" data-testid={`card-only-title-${c.id}`}>{c.name}</CardTitle>
        <CardDescription className="text-xs">
          {contest?.short}／{c.division}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 px-4 text-xs">
        <p data-testid={`card-only-note-${c.id}`}>{c.note}</p>
      </CardContent>
      <CardFooter className="flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 text-xs">
        {c.deadline && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" />
            <span className="whitespace-nowrap">締切 {c.deadline}</span>
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
          {c.docs.map((d) => (
            <a
              key={d.path}
              href={`${siteRoot()}${d.path}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-8 items-center gap-1 py-1.5 font-medium text-primary underline underline-offset-2"
              data-testid={`card-only-doc-${c.id}`}
            >
              {d.label}
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">（新しいタブで開く）</span>
            </a>
          ))}
          {c.demoAppId && (
            <Button asChild size="sm" title={`「${getApp(c.demoAppId)?.name}」のデモを開きます`}>
              <a href={`${appUrl(c.demoAppId)}?from=${c.contest}`} data-testid={`card-only-demo-${c.id}`}>
                デモを開く <ArrowRight className="size-4" aria-hidden />
              </a>
            </Button>
          )}
        </span>
      </CardFooter>
    </Card>
  )
}

function AppCard({ a, contestId, note, onOpenEval, paired }: { a: AppMeta; contestId: ContestId; note?: string; onOpenEval: () => void; paired?: boolean }) {
  const isNew = isNewPlan(a)
  const contest = CONTESTS.find((c) => c.id === a.contest)
  // 概要登録が要るコンペ（UDC）は、カードの締切が本応募の締切であることを示す（済んだ概要登録は出さない）
  const pre = CONTEST_INFO.find((c) => c.id === a.contest)?.deadlines.some((d) => d.label === '概要登録')
  return (
    <Card data-app-card={a.id} className={`flex flex-col gap-2 py-3 ${isNew ? 'border-2 border-dashed border-slate-500 bg-slate-50' : ''}`}>
      <CardHeader className="gap-1 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {isNew && <NewPlanTag />}
          {!isNew && paired && (
            <span className="rounded border border-slate-500 px-1.5 py-0.5 text-xs font-bold" data-testid="current-plan-tag">
              今の案
            </span>
          )}
          <DataBadge kind={a.dataKind} />
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
            <Users className="size-3" />
            {a.audience}
          </span>
        </div>
        <CardTitle className="text-base leading-tight">{a.name}</CardTitle>
        <CardDescription className="text-xs">
          {contest?.short}／{a.division}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 px-4 text-xs">
        <p>{a.purpose}</p>
        {isNew && a.pairNote && (
          <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium" data-testid={`pair-note-${a.id}`}>
            {a.pairNote}
          </p>
        )}
        {isNew && a.alsoCompare?.map((id) => {
          const o = getApp(id)
          return o ? (
            <p key={id} className="mt-1.5">
              <a href={appUrl(id)} className="inline-flex min-h-8 items-center gap-1 py-1.5 font-medium text-primary underline underline-offset-2" data-testid={`also-card-link-${a.id}`}>
                作品①「{o.name}」と見比べる
                <ArrowRight className="size-3" aria-hidden />
              </a>
            </p>
          ) : null
        })}
        {isNew && a.stateNote && (
          <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium" data-testid={`state-note-${a.id}`}>
            いまの状態: {a.stateNote}
          </p>
        )}
        {isNew && (
          <p className="mt-1.5 text-muted-foreground">AI模擬評価はまだありません。元の静的版をそのまま表示します（実行サンプルなし）。</p>
        )}
        {note && (
          <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium" data-testid={`app-note-${a.id}`}>
            {note}
          </p>
        )}
        <div className="mt-1.5">
          <AppScoreLine appId={a.id} contest={contestId} onOpen={onOpenEval} />
        </div>
      </CardContent>
      <CardFooter className="flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4">
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap" title={a.deadline}>
            {pre ? '本応募締切' : '締切'} {a.deadline.replace(/（.*/, '')}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {getSample(a.id) && (
            <Button asChild size="sm" variant="outline" title="AI（Sonnet）の模擬利用を再現して開きます（実在の利用ではありません）">
              <a href={sampleUrl(a.id)}>実行サンプル</a>
            </Button>
          )}
          <Button asChild size="sm">
            <a href={normalUrl(a.id)}>
              開く <ArrowRight className="size-4" />
            </a>
          </Button>
        </span>
      </CardFooter>
    </Card>
  )
}


function Section({ title, children, className = '' }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card p-3 ${className}`}>
      <h3 className="mb-1.5 text-sm font-bold">{title}</h3>
      {children}
    </section>
  )
}

/** デスクトップでは開いたまま、スマホ幅では閉じて始める（縦の長さを抑える）。見出しに件数を出し、隠さない */
function FoldSection({ title, className = '', children }: { title: React.ReactNode; className?: string; children: React.ReactNode }) {
  const [open] = useState(() => typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 1024px)').matches)
  return (
    <details open={open} className={`rounded-lg border bg-card p-3 ${className}`}>
      <summary className="cursor-pointer text-sm font-bold marker:text-foreground">{title}</summary>
      <div className="mt-1.5">{children}</div>
    </details>
  )
}

export function ContestPanel({ info, onOpenEval }: { info: ContestInfo; onOpenEval: () => void }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const apps = appsByContest(info.id)
  const current = apps.filter((a) => !isNewPlan(a))
  const newCount = apps.length - current.length + CARDS_ONLY.filter((c) => c.contest === info.id).length
  // 今の案ごとに、その隣に新しい案を並べる（同じ大会・部門の中で比べる）
  // 組のある群を先に並べる（第一画面に、今の案と新しい案の組が入るように）
  const groups = current
    .map((a) => ({
      head: a,
      news: apps.filter((x) => isNewPlan(x) && x.pairWith === a.id),
      cards: CARDS_ONLY.filter((c) => c.contest === info.id && c.pairWith === a.id),
    }))
    .sort((x, y) => Number(y.news.length + y.cards.length > 0) - Number(x.news.length + x.cards.length > 0))
  // 新しい案があるコンペでは、今の案すべてに「今の案」の札を付ける
  const hasNew = newCount > 0
  return (
    <div className="space-y-3">
      <ContestProgress contest={info.id} />
        {/* アプリ */}
        <section aria-label={`${contest.short}向けのアプリ`} className="space-y-2">
          <h3 className="text-sm font-bold">
            このコンペ向けのアプリ（{current.length}件{newCount > 0 && `＋新しい案 ${newCount}件`}）
            <span className="ml-2 text-xs font-normal text-muted-foreground" data-testid="overview-sample-note">
              「実行サンプル」は AI（Sonnet）の模擬利用の再現で、実在の利用実績ではありません。
            </span>
          </h3>
          {groups.map((g) => (
            <div key={g.head.id} className={hasNew && groups.length > 1 ? 'space-y-1 pt-2' : ''} data-testid={`group-${g.head.id}`}>
              {hasNew && groups.length > 1 && (
                <h4 className="text-xs font-bold text-muted-foreground" data-testid={`group-title-${g.head.id}`}>
                  {g.head.division}
                </h4>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {[g.head, ...g.news].map((a) => (
                  <AppCard key={a.id} a={a} contestId={info.id} note={info.appNotes?.[a.id]} onOpenEval={onOpenEval} paired={hasNew} />
                ))}
                {g.cards.map((c) => (
                  <CardOnlyCard key={c.id} c={c} />
                ))}
              </div>
            </div>
          ))}
          {info.alsoApps?.map((x) => {
            const a = getApp(x.id)
            if (!a) return null
            return (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-xs">
                <span>
                  <span className="font-bold">もう1件: </span>
                  {a.name}（{x.note}）
                </span>
                <Button asChild size="sm" variant="outline">
                  <a href={normalUrl(a.id)}>
                    開く <ArrowRight className="size-4" />
                  </a>
                </Button>
              </div>
            )
          })}
        </section>
      <details className="rounded-lg border bg-muted/30 p-2" data-testid="contest-info">
        <summary className="cursor-pointer text-sm font-bold">募集内容・審査基準・注意点（開いて見る）</summary>
        <div className="mt-2 space-y-3">
      <div className="grid items-start gap-3 lg:grid-cols-[3fr_2fr]">
        {/* 概要と締切 */}
        <div className="rounded-lg border bg-card p-3">
          <h2 className="text-base font-bold">{contest.name}</h2>
          <p className="mt-1 text-sm">{info.summary}</p>
          <dl className="mt-2 grid gap-x-3 gap-y-1 border-t pt-2 text-xs grid-cols-[auto_1fr]">
            <dt className="font-bold">実装</dt>
            <dd>{info.implementation}</dd>
            <dt className="font-bold">賞</dt>
            <dd>{info.prize}</dd>
            <dt className="font-bold">公式</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              {info.sources.map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-800 underline underline-offset-2">
                  {s.label}
                  <ExternalLink className="size-3" aria-hidden />
                  <span className="sr-only">（公式サイト。新しいタブで開く）</span>
                </a>
              ))}
            </dd>
          </dl>
        </div>

        {/* 注意点（デスクトップでは右列に上から並べ、初期画面に出す） */}
        <Section title="注意点（要項で確認できた、失格・無効につながりうる条件）" className="border-amber-400">
          <ul className="space-y-1 text-xs">
            {info.cautions.map((s) => (
              <li key={s} className="flex gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          {info.afterAward && (
            <div className="mt-2 border-t pt-1.5">
              <h4 className="text-xs font-bold">失格条件ではない、通過・受賞後の条件</h4>
              <ul className="mt-1 space-y-1 text-xs">
                {info.afterAward.map((s) => (
                  <li key={s} className="flex gap-1.5">
                    <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-slate-700" aria-hidden />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

      </div>
      <div className="grid items-start gap-3 lg:grid-cols-3">
        <Section title={info.criteriaTitle}>
          <ul className="space-y-1 text-xs">
            {info.criteria.map((c) => (
              <li key={c.name}>
                <span className="font-bold">{c.name}</span>
                {c.tag && <span className="ml-1 rounded border px-1 text-xs">{c.tag}</span>}
                {c.desc && <span className="text-muted-foreground">　{c.desc}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t pt-1.5 text-xs text-muted-foreground">{info.criteriaNote}</p>
        </Section>
        <FoldSection title={`提出物と流れ（${info.submission.length}件）`}>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {info.submission.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </FoldSection>
        <FoldSection title={`未確認（${info.unconfirmed.length}件。要項から確認できていない。応募前に要確認）`} className="border-dashed">
          <ul className="space-y-1 text-xs">
            {info.unconfirmed.map((s) => (
              <li key={s} className="flex gap-1.5">
                <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-violet-800" aria-hidden />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </FoldSection>
      </div>
        </div>
      </details>
    </div>
  )
}
