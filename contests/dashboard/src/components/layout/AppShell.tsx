import { LayoutDashboard } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { CONTESTS, appsByContest } from '@/apps/registry'
import { appUrl } from '@/lib/data'

/** ポータル（統合ダッシュボード）の外枠。各アプリは独立ページなので、リンクは通常の <a>（同じタブ） */
function PortalSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <a href="./index.html" className="px-2 py-1 text-sm font-bold leading-tight">
          統合ダッシュボード
          <span className="block text-xs font-normal text-muted-foreground">4つのコンペ・7つのデモアプリ</span>
        </a>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive className="h-auto min-h-8">
                  <a href="./index.html">
                    <LayoutDashboard className="size-4" />
                    概要
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {CONTESTS.map((c) => (
          <SidebarGroup key={c.id}>
            <SidebarGroupLabel className="h-auto whitespace-normal py-1 leading-tight">{c.name}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {appsByContest(c.id).map((a) => (
                  <SidebarMenuItem key={a.id}>
                    <SidebarMenuButton asChild className="h-auto min-h-8">
                      <a href={appUrl(a.id)} data-app-link={a.id}>
                        <span className="flex w-full flex-col items-start gap-0.5 py-0.5">
                          <span>{a.name}</span>
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
            <span className="text-sm font-medium">概要</span>
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
