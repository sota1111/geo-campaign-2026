import { ArrowLeft, ArrowRight, ExternalLink, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { Remaining } from '@/components/shared/Remaining'
import { PendingNote } from '@/components/shared/PendingNote'
import { useIsPending } from '@/lib/availability'
import { CONTESTS, NEW_PLAN_LABEL, getApp, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { CONTEST_INFO } from '@/apps/contests-info'
import { appUrl, portalOpenUrl, portalUrl } from '@/lib/data'
import { CONTEST_STATUS } from '@/data/status'
import { nextDeadline } from '@/apps/contests-info'
import { asOf } from '@/pages/Progress'

const NO_DESC = '要項に説明の記載なし。'

function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="space-y-2" data-testid={id}>
      <h2 id={id} className="border-b pb-1 text-base font-bold">{title}</h2>
      {children}
    </section>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((t) => <li key={t} className="break-words">{t}</li>)}
    </ul>
  )
}

function AppLinkCard({ a }: { a: AppMeta }) {
  const isNew = isNewPlan(a)
  const missing = useIsPending(a)
  return (
    <Card data-app-card={a.id} className={`flex flex-col gap-2 py-3 ${isNew ? 'border-2 border-dashed border-slate-500 bg-slate-50' : ''}`}>
      <CardHeader className="gap-1 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {isNew && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white" data-testid="new-plan-tag">{NEW_PLAN_LABEL}</span>
          )}
          {!isNew && (
            <span className="rounded border border-slate-500 px-1.5 py-0.5 text-xs font-bold">今の案</span>
          )}
          <DataBadge kind={a.dataKind} />
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
            <Users className="size-3" aria-hidden />
            {a.audience}
          </span>
        </div>
        <CardTitle className="text-base leading-tight">{a.name}</CardTitle>
        <CardDescription className="text-xs">{a.division}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 px-4 text-xs">
        <p>{a.purpose}</p>
        {isNew && a.pairNote && <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium">{a.pairNote}</p>}
        {isNew && a.stateNote && <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium">いまの状態: {a.stateNote}</p>}
        <PendingNote app={a} className="mt-1.5" />
      </CardContent>
      <CardFooter className="px-4">
        {missing ? (
          <Button asChild size="sm" variant="outline" className="border-dashed border-amber-700">
            <a href={appUrl(a.id)} data-app-link={a.id}>概要だけ見る（未収録）</a>
          </Button>
        ) : (
          <Button asChild size="sm">
            <a href={appUrl(a.id)} data-app-link={a.id}>
              開く <ArrowRight className="size-4" aria-hidden />
            </a>
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

/** コンペの概要ページ。文言は CONTEST_INFO（出典は contests-info.ts の先頭に記載）。出典のない項目は出さない */
export default function ContestPage({ contestId }: { contestId: string }) {
  const meta = CONTESTS.find((c) => c.id === contestId)
  const info = CONTEST_INFO.find((c) => c.id === contestId)
  if (!meta || !info) {
    return <p className="text-sm">このコンペは見つかりません。<a className="underline" href={portalUrl()}>統合ダッシュボードへ戻る</a></p>
  }
  const apps = orderedAppsByContest(meta.id)
  const hasNew = apps.some(isNewPlan)
  const status = CONTEST_STATUS[meta.id]
  const next = nextDeadline(info)
  // 今の案の直後に対になる新しい案を置く組。組ごとに囲んで見せる
  const groups = apps.filter((a) => !isNewPlan(a)).map((cur) => ({ cur, items: [cur, ...apps.filter((x) => isNewPlan(x) && x.pairWith === cur.id)] }))
  const grouped = new Set(groups.flatMap((g) => g.items.map((x) => x.id)))
  const orphans = apps.filter((a) => !grouped.has(a.id))
  const implementation = info.summary.includes('実装不要') ? info.implementation.replace(/^実装は不要。/, '') : info.implementation
  const also = (info.alsoApps ?? []).map((x) => ({ ...x, app: getApp(x.id) })).filter((x) => x.app)
  return (
    <article className="mx-auto max-w-5xl space-y-6">
      <a href={portalUrl()} className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2" data-testid="back-portal">
        <ArrowLeft className="size-4" aria-hidden />
        統合ダッシュボードの一覧へ戻る
      </a>
      <header className="space-y-2">
        <h1 className="text-xl font-bold leading-tight">{meta.name}</h1>
      </header>

      <Section id="contest-overview" title="概要・目的">
        <p className="text-sm" data-testid="contest-summary">{info.summary}</p>
        <p className="text-sm text-muted-foreground">{implementation}</p>
      </Section>

      {/* 次の締切（残り日数は今日から数える） */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm" data-testid="next-deadline">
        <span className="font-bold">次の締切</span>
        <span>{next.label} {next.text}</span>
        <Remaining at={next.at} />
      </p>

      {/* 提出までの状況（ポータルの詳細欄と同じ文言）と、ポータルでそのコンペの詳細を開くリンク */}
      <p className="space-y-1 text-sm" data-testid="contest-status">
        <span className="block"><span className="font-bold">提出までの状況（{asOf} 時点の記録）</span>: {status.gap}</span>
        <a href={portalOpenUrl(meta.id)} className="inline-flex min-h-8 items-center gap-1 font-medium text-primary underline underline-offset-2" data-testid="open-in-portal">
          ポータルでこのコンペの詳細を開く <ArrowRight className="size-4" aria-hidden />
        </a>
      </p>

      <Section id="contest-apps" title="このコンペで挑むアプリ">
        {hasNew && (
          <p className="text-xs text-muted-foreground">「{NEW_PLAN_LABEL}」は、今の案と見比べるための案です。どれで出すかは総司令官が選びます。</p>
        )}
        <div className="space-y-4">
          {[...groups.map((g) => ({ key: g.cur.id, title: g.cur.division, items: g.items })), ...(orphans.length ? [{ key: 'other', title: 'その他', items: orphans }] : [])].map((g) => (
            <div key={g.key} className="rounded-lg border p-3" data-app-group={g.key}>
              <h3 className="mb-2 text-sm font-bold">{g.title}{g.items.length > 1 ? '（今の案と新しい案）' : ''}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((a) => <AppLinkCard key={a.id} a={a} />)}
              </div>
            </div>
          ))}
        </div>
        {also.map((x) => (
          <p key={x.id} className="text-sm">
            他コンペのアプリ:{' '}
            <a href={appUrl(x.id)} className="font-medium text-primary underline underline-offset-2">{x.app!.name}</a>
            （{x.note}）
          </p>
        ))}
      </Section>

      <Section id="contest-deadlines" title="締切">
        <ul className="space-y-1 text-sm">
          {info.deadlines.map((d) => (
            <li key={d.label} className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{d.label}</span>
              <span>{d.text}</span>
              {d.doneAt ? <span className="font-bold">✓ {d.doneLabel ?? '済'}</span> : <Remaining at={d.at} />}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="contest-criteria" title={info.criteriaTitle.includes('審査基準') ? info.criteriaTitle : '審査基準'}>
        {!info.criteriaTitle.includes('審査基準') && <p className="text-xs text-muted-foreground">{info.criteriaTitle}</p>}
        <ul className="space-y-1.5 text-sm">
          {info.criteria.map((c) => (
            <li key={c.name}>
              <span className="font-medium">{c.name}</span>
              {c.tag && <span className="ml-1.5 rounded border px-1 py-px text-xs">{c.tag}</span>}
              {c.desc !== NO_DESC && <span className="block text-muted-foreground">{c.desc}</span>}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{info.criteria.some((c) => c.desc === NO_DESC) && '各項目の説明は要項に記載なし。'}{info.criteriaNote}</p>
      </Section>

      <Section id="contest-conditions" title="主な応募条件・注意点">
        <h3 className="text-sm font-medium">提出のしかた</h3>
        <Bullets items={info.submission} />
        <h3 className="text-sm font-medium">失格・無効につながりうる条件</h3>
        <Bullets items={info.cautions} />
        {info.afterAward && (
          <>
            <h3 className="text-sm font-medium">通過・受賞後の条件</h3>
            <Bullets items={info.afterAward} />
          </>
        )}
        <h3 className="text-sm font-medium">賞</h3>
        <p className="text-sm">{info.prize}</p>
      </Section>

      <Section id="contest-unconfirmed" title="未確認の事項">
        <Bullets items={info.unconfirmed} />
      </Section>

      <Section id="contest-sources" title="出典（公式）">
        <ul className="space-y-1 text-sm">
          {info.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-primary underline underline-offset-2">
                {s.label}
                <ExternalLink className="size-3 shrink-0" aria-hidden />
                <span className="sr-only">（新しいタブで開く）</span>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </article>
  )
}
