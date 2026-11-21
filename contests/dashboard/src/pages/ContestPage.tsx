import { ArrowLeft, ArrowRight, ExternalLink, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { Remaining } from '@/components/shared/Remaining'
import { CONTESTS, NEW_PLAN_LABEL, getApp, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { CONTEST_INFO } from '@/apps/contests-info'
import { appUrl, portalUrl } from '@/lib/data'

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

function AppLinkCard({ a, paired }: { a: AppMeta; paired: boolean }) {
  const isNew = isNewPlan(a)
  return (
    <Card data-app-card={a.id} className={`flex flex-col gap-2 py-3 ${isNew ? 'border-2 border-dashed border-slate-500 bg-slate-50' : ''}`}>
      <CardHeader className="gap-1 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {isNew && (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white" data-testid="new-plan-tag">{NEW_PLAN_LABEL}</span>
          )}
          {!isNew && paired && (
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
      </CardContent>
      <CardFooter className="px-4">
        <Button asChild size="sm">
          <a href={appUrl(a.id)} data-app-link={a.id}>
            このアプリを開く <ArrowRight className="size-4" aria-hidden />
          </a>
        </Button>
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
  const also = (info.alsoApps ?? []).map((x) => ({ ...x, app: getApp(x.id) })).filter((x) => x.app)
  return (
    <article className="mx-auto max-w-5xl space-y-6">
      <a href={portalUrl()} className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-primary underline underline-offset-2" data-testid="back-portal">
        <ArrowLeft className="size-4" aria-hidden />
        統合ダッシュボードへ戻る
      </a>
      <header className="space-y-2">
        <h1 className="text-xl font-bold leading-tight">{meta.name}</h1>
        <p className="text-sm" data-testid="contest-summary">{info.summary}</p>
        <p className="text-sm text-muted-foreground">{info.implementation}</p>
      </header>

      <Section id="contest-apps" title="このコンペで挑むアプリ">
        {hasNew && (
          <p className="text-xs text-muted-foreground">「{NEW_PLAN_LABEL}」は、今の案と見比べるための案です。どれで出すかは総司令官が選びます。</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => <AppLinkCard key={a.id} a={a} paired={apps.some((x) => isNewPlan(x) && x.pairWith === a.id)} />)}
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

      <Section id="contest-criteria" title={`審査基準（${info.criteriaTitle}）`}>
        <ul className="space-y-1.5 text-sm">
          {info.criteria.map((c) => (
            <li key={c.name}>
              <span className="font-medium">{c.name}</span>
              {c.tag && <span className="ml-1.5 rounded border px-1 py-px text-xs">{c.tag}</span>}
              <span className="block text-muted-foreground">{c.desc}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{info.criteriaNote}</p>
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
