import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { CONTESTS, appsByContest, getApp } from '@/apps/registry'

function NavItem({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <NavLink to={to} end={end} onClick={() => isMobile && setOpenMobile(false)}>
      {({ isActive }) => (
        <SidebarMenuButton asChild isActive={isActive} className="h-auto min-h-8">
          <span>{children}</span>
        </SidebarMenuButton>
      )}
    </NavLink>
  )
}

function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <Link to="/" className="px-2 py-1 text-sm font-bold leading-tight">
          統合ダッシュボード
          <span className="block text-xs font-normal text-muted-foreground">4つのコンペ・7つのデモアプリ</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <NavItem to="/" end>
                  <LayoutDashboard className="size-4" />
                  概要
                </NavItem>
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
                    <NavItem to={`/apps/${a.id}`}>
                      <span className="flex w-full flex-col items-start gap-0.5 py-0.5">
                        <span>{a.name}</span>
                        <span className="flex flex-wrap items-center gap-1">
                          <DataBadge kind={a.dataKind} className="px-1.5 py-0 text-[10px]" />
                          <span className="text-[10px] text-muted-foreground">{a.audience}</span>
                        </span>
                      </span>
                    </NavItem>
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

function Crumbs() {
  const { pathname } = useLocation()
  const m = pathname.match(/^\/apps\/([^/]+)/)
  const app = m ? getApp(m[1]) : undefined
  const contest = app ? CONTESTS.find((c) => c.id === app.contest) : undefined
  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {app ? (
            <BreadcrumbLink asChild>
              <Link to="/">概要</Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage>概要</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {app && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem className="hidden sm:inline-flex">{contest?.short}</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden sm:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>{app.name}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function AppShell() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
            <SidebarTrigger aria-label="メニューを開閉" />
            <Separator orientation="vertical" className="h-5" />
            <Crumbs />
          </header>
          <main className="min-w-0 flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
