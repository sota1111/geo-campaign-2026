import { appUrl } from '@/lib/data'
import { ArrowRight, CalendarClock, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { APPS, CONTESTS } from '@/apps/registry'

export default function Overview() {
  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">統合ダッシュボード（7つのデモアプリ）</h1>
        <p className="text-xs text-muted-foreground">
          目的と「誰向けか」に合うカードを開いてください。バッジは実データ／架空データ／一部架空の区別です。
        </p>
      </header>
      <section aria-label="アプリ一覧" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {APPS.map((a) => {
          const contest = CONTESTS.find((c) => c.id === a.contest)
          return (
            <Card key={a.id} data-app-card={a.id} className="flex flex-col gap-2 py-3">
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
              </CardContent>
              <CardFooter className="items-center justify-between gap-2 px-4">
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                  <CalendarClock className="size-3.5 shrink-0" />
                  <span className="truncate" title={a.deadline}>
                    締切 {a.deadline.replace(/（.*/, '')}
                  </span>
                </span>
                <Button asChild size="sm">
                  <a href={appUrl(a.id)}>
                    開く <ArrowRight className="size-4" />
                  </a>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </section>
    </div>
  )
}
