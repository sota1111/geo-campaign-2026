import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { CONTESTS, isNewPlan, orderedAppsByContest } from '@/apps/registry'
import { appUrl } from '@/lib/data'
import { contestsByDeadline } from '@/apps/contests-info'
import { asOf } from '@/pages/Progress'

/** ポータル（統合ダッシュボード）の外枠。各アプリは独立ページなので、リンクは通常の <a>（同じタブ） */
function PortalSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <a href="./index.html" className="px-2 py-1 text-sm font-bold leading-tight">
          統合ダッシュボード
          <span className="block text-xs font-normal text-muted-foreground">4つのコンペ・今の案7件＋新しい案</span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        {/* 本文の一覧と同じ、締切の近い順 */}
        {contestsByDeadline().map((i) => CONTESTS.find((c) => c.id === i.id)!).map((c) => (
          <SidebarGroup key={c.id}>
            <SidebarGroupLabel className="h-auto whitespace-normal py-1 leading-tight">{c.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {orderedAppsByContest(c.id).map((a) => (
                  <SidebarMenuItem key={a.id}>
                    <SidebarMenuButton asChild className="h-auto min-h-8">
                      <a href={appUrl(a.id)} data-app-link={a.id}>
                        <span className="flex w-full flex-col items-start gap-0.5 py-0.5">
                          <span>{a.name}</span>
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
