import { ArrowRight, CalendarClock, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { CONTESTS, NEW_PLAN_LABEL, getApp, type CardOnly } from '@/apps/registry'
import { appUrl, siteRoot } from '@/lib/data'


/** 新しい案（比較用・未選定）の目印。色だけに頼らず、黒地の文言と破線の枠で示す */
function NewPlanTag() {
  return (
    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-bold text-white" data-testid="new-plan-tag">
      {NEW_PLAN_LABEL}
    </span>
  )
}

/** デモを持たない案（提出文のみ）のカード。開くボタンは置かない */
export function CardOnlyCard({ c }: { c: CardOnly }) {
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
