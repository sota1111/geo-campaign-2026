import { useEffect, useState } from 'react'
import { ChevronRight, PanelLeft } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { DataBadge } from '@/components/shared/DataBadge'
import { pendingLabel, useIsPending } from '@/lib/availability'
import { CONTESTS, isNewPlan, orderedAppsByContest, type AppMeta } from '@/apps/registry'
import { appUrl, contestUrl, ontologyFiguresUrl, ontologyUrl, portalUrl } from '@/lib/data'
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

/** 審査待ちでこのビルドに含まれていない案の目印（サイドバー） */
function PendingTag({ a }: { a: AppMeta }) {
  const pending = useIsPending(a)
  if (!pending) return null
  return <span className="rounded border border-amber-700 bg-amber-50 px-1.5 text-xs font-bold text-amber-950">{pendingLabel(a)}</span>
}

function PortalSidebar({ activeContest }: { activeContest?: string }) {
  const { open, isMobile } = useSidebar()
  const [q, setQ] = useState('')
  const groups = contestsByDeadline()
    .map((i) => CONTESTS.find((c) => c.id === i.id)!)
    .map((c) => ({ c, apps: orderedAppsByContest(c.id).filter((a) => matchesAppQuery(a, q)) }))
  // コンペ画面を開いたとき、そのコンペ名がサイドバー内で見える位置まで、サイドバーの中だけをスクロールする（本文は動かさない）
  useEffect(() => {
    if (!activeContest) return
    const link = document.querySelector<HTMLElement>(`[data-contest-link="${activeContest}"]`)
    const box = link?.closest<HTMLElement>('[data-sidebar="content"]')
    if (!link || !box) return
    box.scrollTop += link.getBoundingClientRect().top - box.getBoundingClientRect().top - 8
  }, [activeContest])
  const hits = groups.reduce((n, g) => n + g.apps.length, 0)
  return (
    <Sidebar id="portal-sidebar" inert={!open && !isMobile ? true : undefined}>
      <SidebarHeader className="border-b">
        <a href={portalUrl()} className="px-2 py-1 text-sm font-bold leading-tight">
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
            <SidebarGroupLabel asChild className={`h-auto min-h-10 whitespace-normal border-l-4 py-1.5 text-sm font-bold leading-tight text-sidebar-foreground underline underline-offset-2 hover:bg-sidebar-accent ${activeContest === c.id ? 'border-primary bg-sidebar-accent' : 'border-transparent'}`}>
              <a
                href={contestUrl(c.id)}
                data-contest-link={c.id}
                aria-current={activeContest === c.id ? 'page' : undefined}
                title={`${c.name}の概要・目的・審査基準を見る`}
              >
                {c.name}
                <span className="ml-auto flex shrink-0 items-center gap-0.5 pl-1 text-xs font-normal no-underline">
                  {activeContest === c.id ? '表示中' : '概要'}
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              </a>
            </SidebarGroupLabel>
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
                          <PendingTag a={a} />
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

/** 左のメニュー（コンペ・アプリの一覧）を出し入れするボタン。既定は隠れている */
function MenuToggle() {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar()
  const shown = isMobile ? openMobile : open
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-expanded={shown}
      aria-controls="portal-sidebar"
      data-testid="menu-toggle"
      className="inline-flex min-h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border-2 border-slate-900 bg-white px-2 text-xs font-bold text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
    >
      <PanelLeft className="size-4" aria-hidden />
      {shown ? 'メニューを隠す' : 'メニューを出す'}
    </button>
  )
}

export function AppShell({ children, activeContest }: { children: React.ReactNode; activeContest?: string }) {
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={false}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
          data-testid="skip-link"
        >
          本文へ移動
        </a>
        <PortalSidebar activeContest={activeContest} />
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 border-b bg-background px-3">
            <MenuToggle />
            <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
            <a href={portalUrl()} className="whitespace-nowrap text-sm font-medium hover:underline">統合ダッシュボード</a>
            <a href={ontologyUrl()} className="whitespace-nowrap py-2 text-sm font-medium hover:underline" data-testid="ontology-link" title="コンペ・案・データ・止めているもの・作業・判断のつながりを図とカードで見る">
              <span className="sm:hidden">つながり図</span>
              <span className="hidden sm:inline">つながり図（オントロジー）</span>
            </a>
            <a href={ontologyFiguresUrl()} className="whitespace-nowrap py-2 text-sm font-medium hover:underline" data-testid="ontology-figures-link" title="オントロジーを、型・提出を止めているもの・次の行動・データ条件・適合の図で読む">
              図解（要約）
            </a>
            <span className="hidden text-xs text-muted-foreground lg:inline">提出状況は {asOf} 時点の記録</span>
          </header>
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-3 outline-none md:p-6">{children}</main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  )
}
