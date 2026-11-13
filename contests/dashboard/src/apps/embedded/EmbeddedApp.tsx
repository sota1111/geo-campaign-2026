import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { NEW_PLAN_LABEL, getApp } from '@/apps/registry'
import { appUrl, siteRoot } from '@/lib/data'

/**
 * 新しい案（比較用・未選定）の独立ページ。元の静的版（public/embedded/<embed>/、copy-data が元からコピー）を
 * そのまま iframe で開く。数値・注意書き・出典は元の静的版のもの（React では書き直していない）。
 * 上の帯: 「新しい案（比較用・未選定）」の表示、隣に置く今の案へのリンク、静的版を単独で開くリンク。
 */
export function EmbeddedApp({ appId }: { appId: string }) {
  const app = getApp(appId)
  if (!app?.embed) return null
  const pair = app.pairWith ? getApp(app.pairWith) : undefined
  const src = `${siteRoot()}embedded/${app.embed}/index.html`
  return (
    <div className="flex flex-col gap-2" data-testid="embedded-app">
      <PageHeader
        appId={appId}
        compact
        actions={
          <SourceDialog
            sources={[
              {
                name: '元の静的版（出典・ライセンスは画面内の「出典」欄と、元アプリの README に従う）',
                note: `${app.originalPath}。このページは元の静的版を変更せずに表示しています。`,
              },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-slate-500 bg-slate-50 px-3 py-1.5 text-xs">
        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white" data-testid="new-plan-badge">
          {NEW_PLAN_LABEL}
        </span>
        <h1 className="text-sm font-bold">{app.name}</h1>
        <span className="text-muted-foreground">{app.dataNote}</span>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {pair && (
            <a href={appUrl(pair.id)} className="font-medium text-primary underline underline-offset-2">
              今の案「{pair.name}」を開いて見比べる
            </a>
          )}
          <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2">
            この案だけ別タブで開く
            <ExternalLink className="size-3" aria-hidden />
            <span className="sr-only">（新しいタブで開く）</span>
          </a>
        </span>
        {app.pairNote && <p className="basis-full font-medium">{app.pairNote}</p>}
      </div>
      <iframe
        title={`${app.name}（${NEW_PLAN_LABEL}）`}
        src={src}
        className="h-[calc(100dvh-9.5rem)] min-h-[600px] w-full rounded-md border bg-white"
        data-testid="embedded-frame"
      />
    </div>
  )
}
