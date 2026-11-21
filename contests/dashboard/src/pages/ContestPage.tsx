import { useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { PrizeBreakdown } from '@/components/shared/PrizeBreakdown'
import { PendingNote } from '@/components/shared/PendingNote'
import { useIsPending } from '@/lib/availability'
import { CARDS_ONLY, CONTESTS, NEW_PLAN_LABEL, getApp, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { getSample } from '@/apps/_samples'
import { sampleUrl } from '@/components/layout/SampleBar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EVAL3 } from '@/apps/eval3'
import { ContestEval3 } from '@/pages/Eval3Panels'
import { AppScoreLine, EvalSummary } from '@/pages/EvalPanels'
import { CardOnlyCard } from '@/pages/CardOnlyCard'
import { Src } from '@/pages/ContestCards'
import { ContestProgress } from '@/pages/Progress'
import { contestColor } from '@/data/colors'
import { CONTEST_INFO } from '@/apps/contests-info'
import { appUrl, portalUrl } from '@/lib/data'
import { asOf } from '@/pages/Progress'
import { PlanDivisions, PlanLine } from '@/components/shared/PlanCount'
import { loadTargets, planView } from '@/lib/fit'

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

function AppLinkCard({ a, note, onOpenEval }: { a: AppMeta; note?: string; onOpenEval: () => void }) {
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
        {note && <p className="mt-1.5 border-l-2 border-slate-500 pl-2 font-medium" data-testid={`app-note-${a.id}`}>{note}</p>}
        <div className="mt-1.5">
          <AppScoreLine appId={a.id} contest={a.contest} onOpen={onOpenEval} />
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-2 px-4">
        {getSample(a.id) && (
          <Button asChild size="sm" variant="outline" title="AI（Sonnet）の模擬利用を再現して開きます（実在の利用ではありません）">
            <a href={sampleUrl(a.id)}>実行サンプル</a>
          </Button>
        )}
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
  const [evalOpen, setEvalOpen] = useState(false)
  const color = contestColor(meta.id)
  const plan = planView(meta.id, loadTargets())
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
        <h1 className={`rounded-lg px-3 py-2 text-xl font-bold leading-tight ${color.band}`}><span aria-hidden>{color.mark} </span>{meta.name}</h1>
      </header>

      <Section id="contest-overview" title="概要・目的">
        <p className="text-sm" data-testid="contest-summary">{info.summary}</p>
        <p className="text-sm text-muted-foreground">{implementation}</p>
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

      <Section id="contest-prize" title="賞金・賞の内訳">
        <PrizeBreakdown prize={info.prize} />
      </Section>

      <Section id="contest-planned" title="提出予定数（総司令官が決めた、出すつもりの件数）">
        <div className="text-sm">
          <PlanLine view={plan} contestId={meta.id} />
        </div>
        {plan.parts.some((p) => p.chosen !== null) && <div className="text-sm"><PlanDivisions view={plan} contestId={meta.id} /></div>}
        <p className="text-xs text-muted-foreground">
          「選んだ」は、統合ダッシュボードで提出先に選んだ件数（このブラウザの下書き）です。
          {meta.id === 'satellite-2026' && 'スポンサー向けと一般の区別は下書きに持たないため、合計の件数だけで比べます。'}
          {plan.planned === null && '総司令官の指示がないため「未定」とし、数は作っていません。'}
          これは要項の上限である下の「提出可能数」とは別です。［出典: {plan.src}］
        </p>
      </Section>

      {/* 並びはトップのカードと同じ優先順位（概要 → 審査基準 → 賞金 → 提出予定 → 進捗 …）。
          提出までの状況・判断待ち・次にやること・案ごとのチェックリスト（トップ画面の詳細欄から移した） */}
      <section aria-label="進捗" className="space-y-2" data-testid="contest-status">
        <h2 className="border-b pb-1 text-base font-bold">進捗（{asOf} 時点の記録）</h2>
        <ContestProgress contest={meta.id} />
      </section>

      <Section id="contest-apps" title="このコンペで挑むアプリ">
        {hasNew && (
          <p className="text-xs text-muted-foreground">「{NEW_PLAN_LABEL}」は、今の案と見比べるための案です。どれで出すかは総司令官が選びます。</p>
        )}
        <div className="space-y-4">
          {[...groups.map((g) => ({ key: g.cur.id, title: g.cur.division, items: g.items })), ...(orphans.length ? [{ key: 'other', title: 'その他', items: orphans }] : [])].map((g) => (
            <div key={g.key} className="rounded-lg border p-3" data-app-group={g.key}>
              <h3 className="mb-2 text-sm font-bold">{g.title}{g.items.length > 1 ? '（今の案と新しい案）' : ''}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.items.map((a) => <AppLinkCard key={a.id} a={a} note={info.appNotes?.[a.id]} onOpenEval={() => setEvalOpen(true)} />)}
                {CARDS_ONLY.filter((c) => c.contest === meta.id && c.pairWith === g.key).map((c) => <CardOnlyCard key={c.id} c={c} />)}
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

      <Section id="contest-eval" title="AI評価（模擬）">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEvalOpen(true)} data-testid="open-eval">
            AI評価（模擬・第3回 {EVAL3.date.slice(5).replace('-', '/')}）を見る
          </Button>
          <span className="text-xs text-muted-foreground">すべて AI による模擬評価で、実際の審査結果ではありません。</span>
        </div>
        <details data-testid="eval3-details">
          <summary className="cursor-pointer text-sm font-bold">第3回の比較図（今の案と新しい案）を開く</summary>
          <ContestEval3 contest={meta.id} />
        </details>
      </Section>

      <Section id="contest-limits" title="提出可能数（1人・1チームが出せる件数）">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {info.limits.map((r) => (
            <li key={r.text} className="break-words" data-testid="limit-item">
              {r.unconfirmed && <span className="font-bold">（未確認）</span>}
              {r.text}
              <Src>{r.src}</Src>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">要項に書かれていない事項は「要項に記載なし」「未確認」のまま載せています。推測で数字は入れていません。</p>
      </Section>

      <Section id="contest-conditions" title="主なルール・応募条件・注意点">
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
      <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
        <DialogContent className="max-h-[85vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-5xl sm:p-6 [&>*]:min-w-0" data-testid="eval-dialog">
          <DialogHeader>
            <DialogTitle className="pr-6">AI評価（模擬）　最新は第3回（{EVAL3.date.slice(5).replace('-', '/')}）</DialogTitle>
            <DialogDescription className="text-xs">
              すべて AI による模擬評価で、実際の審査結果ではありません。回によって評価した AI と人数が違います。第3回は {EVAL3.model} {EVAL3.evaluatorCount}名、第1・2回は Sonnet 各4名で、下の区画で分けて示します。
            </DialogDescription>
          </DialogHeader>
          <EvalSummary />
        </DialogContent>
      </Dialog>
    </article>
  )
}
