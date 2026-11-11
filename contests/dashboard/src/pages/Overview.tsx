import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { DataBadge } from '@/components/shared/DataBadge'
import { APPS, CONTESTS } from '@/apps/registry'

export default function Overview() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">統合ダッシュボード</h1>
        <p className="text-sm text-muted-foreground">
          4つのコンペ向けに作った7つのデモアプリです。使いたい目的に合うカードから開いてください。
          データの種類は各カードのバッジ（実データ／架空データ／一部架空）で確認できます。
        </p>
      </header>
      <section aria-label="アプリ一覧" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {APPS.map((a) => {
          const contest = CONTESTS.find((c) => c.id === a.contest)
          return (
            <Card key={a.id} data-app-card={a.id} className="flex flex-col">
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DataBadge kind={a.dataKind} />
                </div>
                <CardTitle className="text-lg">{a.name}</CardTitle>
                <CardDescription>
                  {contest?.name}／{a.division}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-3 text-sm">
                <p>{a.purpose}</p>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                  <span>締切: {a.deadline}</span>
                </p>
                <p className="text-xs text-muted-foreground">{a.dataNote}</p>
              </CardContent>
              <CardFooter>
                <Button asChild className="w-full">
                  <Link to={`/apps/${a.id}`}>
                    開く <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          )
        })}
      </section>
    </div>
  )
}
