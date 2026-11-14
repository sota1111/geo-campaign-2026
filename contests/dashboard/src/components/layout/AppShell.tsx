import { useState } from 'react'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { CONTESTS, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { appUrl } from '@/lib/data'
import { contestsByDeadline } from '@/apps/contests-info'
import { asOf } from '@/pages/Progress'

/** ポータル（統合ダッシュボード）の外枠。各アプリは独立ページなので、リンクは通常の <a>（同じタブ） */
/** 絞り込み: 名前・使う人・目的・部門・データの説明に、空白で区切った語がすべて含まれるか */
export function matchesAppQuery(a: AppMeta, q: string): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [a.name, a.audience, a.purpose, a.division, a.dataNote, a.demoTitle ?? ''].join(' ')
  return words.every((w) => hay.includes(w))
}

function PortalSidebar() {
  const [q, setQ] = useState('')
  const groups = contestsByDeadline()
    .map((i) => CONTESTS.find((c) => c.id === i.id)!)
    .map((c) => ({ c, apps: orderedAppsByContest(c.id).filter((a) => matchesAppQuery(a, q)) }))
  const hits = groups.reduce((n, g) => n + g.apps.length, 0)
  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <a href="./index.html" className="px-2 py-1 text-sm font-bold leading-tight">
          統合ダッシュボード
          <span className="block text-xs font-normal text-muted-foreground">4つのコンペ・今の案7件＋新しい案</span>
        </a>
        {/* 目的からアプリを探す（例: 通院・AED・盛土・遅れ）。一覧は下に長いので、語で絞り込めるようにする */}
        <label className="px-2 text-xs font-medium" htmlFor="app-filter">
          目的・地名からアプリを探す
        </label>
        <input
          id="app-filter"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="例: 病院、AED、盛土、遅れ、太陽光"
          className="mx-2 h-8 rounded-md border bg-background px-2 text-sm"
          data-testid="app-filter"
        />
        {q.trim() && (
          <p className="px-2 text-xs text-muted-foreground" role="status" data-testid="app-filter-count">
            {hits ? `${hits}件のアプリ` : '該当するアプリはありません'}
          </p>
        )}
      </SidebarHeader>
      <SidebarContent>
        {/* 本文の一覧と同じ、締切の近い順 */}
        {groups.filter((g) => g.apps.length).map(({ c, apps }) => (
          <SidebarGroup key={c.id}>
            <SidebarGroupLabel className="h-auto whitespace-normal py-1 leading-tight">{c.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {apps.map((a) => (
                  <SidebarMenuItem key={a.id}>
                    <SidebarMenuButton asChild className="h-auto min-h-8">
                      <a href={appUrl(a.id)} data-app-link={a.id}>
                        <span className="flex w-full flex-col items-start gap-0.5 py-0.5">
                          <span>{a.name}</span>
                          <span className="line-clamp-2 whitespace-normal text-xs font-normal leading-snug text-muted-foreground">{a.purpose}</span>
                          {isNewPlan(a) && (
                            <span className="rounded bg-slate-800 px-1.5 py-0 text-xs font-bold text-white">新しい案（比較用・未選定）</span>
                          )}
                          <span className="flex flex-wrap items-center gap-1">
                            <DataBadge kind={a.dataKind} className="px-1.5 py-0 text-xs" />
                            <span className="text-xs text-muted-foreground">{a.audience}</span>
                          </span>
                        </span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <PortalSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger aria-label="メニューを開閉" />
            <Separator orientation="vertical" className="h-5" />
            <span className="text-sm font-medium">統合ダッシュボード</span>
            <span className="text-xs text-muted-foreground">{asOf} 時点</span>
          </header>
          <main className="min-w-0 flex-1 p-3 md:p-6">{children}</main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
