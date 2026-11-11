import { useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CircleHelp, ExternalLink, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getSample } from '@/apps/_samples'
import { normalUrl, sampleUrl } from '@/components/layout/SampleBar'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataBadge } from '@/components/shared/DataBadge'
import { APPS, CONTESTS, appsByContest, getApp, type AppMeta, type ContestId } from '@/apps/registry'
import { CONTEST_INFO, remainingText, type ContestInfo } from '@/apps/contests-info'
import { AppScoreLine, ContestEval, EvalSummary, MOCK_NOTICE } from '@/pages/EvalPanels'

/** 残り日数のバッジ。色だけに頼らず、文言と記号で緊急度を示す */
function Remaining({ at }: { at: string }) {
  const r = remainingText(at)
  const cls = r.past
    ? 'bg-muted text-muted-foreground'
    : r.urgent
      ? 'border border-amber-500 bg-amber-100 text-amber-950'
      : 'border border-sky-300 bg-sky-50 text-sky-950'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ${cls}`}>
      {r.urgent && <span aria-hidden>▲&nbsp;</span>}
      {r.text}
    </span>
  )
}

/** 最も近い、まだ過ぎていない締切（全部過ぎていれば最後の締切） */
function nextDeadline(info: ContestInfo) {
  const now = Date.now()
  return info.deadlines.find((d) => new Date(d.at).getTime() > now) ?? info.deadlines[info.deadlines.length - 1]
}

function AppCard({ a, contestId }: { a: AppMeta; contestId: ContestId }) {
  const contest = CONTESTS.find((c) => c.id === a.contest)
  return (
    <Card data-app-card={a.id} className="flex flex-col gap-2 py-3">
      <CardHeader className="gap-1 px-4">
        <div className="flex flex-wrap items-center gap-1.5">
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
        <p className="line-clamp-2" title={a.purpose}>
          {a.purpose}
        </p>
        <div className="mt-1.5">
          <AppScoreLine appId={a.id} contest={contestId} />
        </div>
      </CardContent>
      <CardFooter className="flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4">
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <CalendarClock className="size-3.5 shrink-0" />
          <span className="whitespace-nowrap" title={a.deadline}>
            締切 {a.deadline.replace(/（.*/, '')}
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

function Section({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border bg-card p-3 ${className}`}>
      <h3 className="mb-1.5 text-sm font-bold">{title}</h3>
      {children}
    </section>
  )
}

function ContestPanel({ info }: { info: ContestInfo }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const apps = appsByContest(info.id)
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-base font-bold">{contest.name}</h2>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {info.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-800 underline underline-offset-2">
                {s.label}（公式）
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only">（新しいタブで開く）</span>
              </a>
            ))}
          </span>
        </div>
        <p className="mt-1 text-sm">{info.summary}</p>
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
          <dt className="font-bold">締切</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1">
            {info.deadlines.map((d) => (
              <span key={d.label} className="inline-flex items-center gap-1.5">
                {d.label} {d.text}
                <Remaining at={d.at} />
              </span>
            ))}
          </dd>
          <dt className="font-bold">実装</dt>
          <dd>{info.implementation}</dd>
          <dt className="font-bold">賞</dt>
          <dd>{info.prize}</dd>
        </dl>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Section title={info.criteriaTitle}>
          <ul className="space-y-1 text-xs">
            {info.criteria.map((c) => (
              <li key={c.name}>
                <span className="font-bold">{c.name}</span>
                {c.tag && <span className="ml-1 rounded border px-1 text-[10px]">{c.tag}</span>}
                {c.desc && <span className="text-muted-foreground">　{c.desc}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 border-t pt-1.5 text-xs text-muted-foreground">{info.criteriaNote}</p>
        </Section>
        <Section title="提出物と流れ">
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {info.submission.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Section>
        <div className="space-y-3">
          <Section title="注意点（失格・無効につながりうる条件）" className="border-amber-400">
            <ul className="space-y-1 text-xs">
              {info.cautions.map((s) => (
                <li key={s} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="未確認（要項から確認できていない）" className="border-dashed">
            <ul className="space-y-1 text-xs">
              {info.unconfirmed.map((s) => (
                <li key={s} className="flex gap-1.5">
                  <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-violet-800" aria-hidden />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <section aria-label={`${contest.short}向けのアプリ`} className="space-y-2">
        <h3 className="text-sm font-bold">
          このコンペ向けのアプリ（{apps.length}件）
          <span className="ml-2 text-xs font-normal text-muted-foreground">「開く」で実際の画面、「実行サンプル」でAIの模擬利用を見られます。</span>
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {apps.map((a) => (
            <AppCard key={a.id} a={a} contestId={info.id} />
          ))}
        </div>
        {info.alsoApps?.map((x) => {
          const a = getApp(x.id)
          if (!a) return null
          return (
            <p key={x.id} className="text-xs">
              <span className="font-bold">もう1件: </span>
              {a.name}（{x.note}）{' '}
              <a href={normalUrl(a.id)} className="font-medium text-sky-800 underline underline-offset-2">
                開く
              </a>
            </p>
          )
        })}
      </section>

      <ContestEval contest={info.id} />
    </div>
  )
}

const EVAL_TAB = 'eval'

export default function Overview() {
  const initial =
    window.location.hash === `#${EVAL_TAB}` ? EVAL_TAB : (CONTEST_INFO.find((c) => `#${c.id}` === window.location.hash)?.id ?? CONTEST_INFO[0].id)
  const [tab, setTab] = useState<string>(initial)
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">統合ダッシュボード（4つのコンペ・7つのデモアプリ）</h1>
        <p className="text-xs text-muted-foreground">
          コンペを選ぶと、募集内容・締切・提出物・審査基準・注意点と、そのコンペ向けのアプリが見られます。バッジは実データ／架空データ／一部架空の区別です。
        </p>
        <p className="text-xs text-muted-foreground" data-testid="overview-sample-note">
          「実行サンプル」は、AI（Sonnet）が使用目的だけを与えられて操作した模擬利用を再現した画面です。実在の住民・職員の利用実績ではなく、何も保存されません。
        </p>
      </header>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-400 bg-slate-50 px-3 py-1.5 text-xs" data-testid="eval-banner">
        <span className="font-bold">AI評価の結果を掲載しています。</span>
        <span>{MOCK_NOTICE}</span>
        <button type="button" onClick={() => setTab(EVAL_TAB)} className="font-medium text-sky-800 underline underline-offset-2">
          全アプリの点数一覧を見る
        </button>
      </p>

      <Tabs value={tab} onValueChange={setTab} className="gap-3">
        <TabsList aria-label="コンペの選択" className="grid h-auto w-full group-data-[orientation=horizontal]/tabs:h-auto grid-cols-2 gap-1 lg:grid-cols-5">
          {CONTEST_INFO.map((info) => {
            const nd = nextDeadline(info)
            return (
              <TabsTrigger
                key={info.id}
                value={info.id}
                className="h-auto flex-col items-start gap-0.5 whitespace-normal text-foreground border-border px-3 py-1.5 text-left data-[state=active]:border-foreground"
              >
                <span className="text-sm font-bold">{CONTESTS.find((c) => c.id === info.id)?.name.replace(/20.*$/, '')}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal">
                  {nd.label} {nd.text}
                  <Remaining at={nd.at} />
                  <span className="text-muted-foreground">／アプリ{appsByContest(info.id).length}件</span>
                </span>
              </TabsTrigger>
            )
          })}
          <TabsTrigger
            value={EVAL_TAB}
            className="h-auto flex-col items-start gap-0.5 whitespace-normal text-foreground border-border px-3 py-1.5 text-left data-[state=active]:border-foreground"
          >
            <span className="text-sm font-bold">AI評価の全体</span>
            <span className="text-xs font-normal text-muted-foreground">全アプリの点数・ポータルの評価（模擬）</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value={EVAL_TAB} forceMount className="data-[state=inactive]:hidden">
          <EvalSummary />
        </TabsContent>
        {CONTEST_INFO.map((info) => (
          <TabsContent key={info.id} value={info.id} forceMount className="data-[state=inactive]:hidden">
            <ContestPanel info={info} />
          </TabsContent>
        ))}
      </Tabs>
      <p className="text-xs text-muted-foreground">
        出典: 各コンペの公式要項（取得日 2026-11-09）。要項で確認できていない事項は「未確認」と表示しています。全{APPS.length}アプリはサイドバーからも開けます。
      </p>
    </div>
  )
}
