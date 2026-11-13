import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { NEW_PLAN_LABEL, getApp } from '@/apps/registry'
import { appUrl, fromContest, siteRoot } from '@/lib/data'

/**
 * 新しい案（比較用・未選定）の独立ページ。元の静的版（public/embedded/<embed>/、copy-data が元からコピー）を
 * そのまま iframe で開く。数値・注意書き・出典は元の静的版のもの（React では書き直していない）。
 * 上の帯: 「新しい案（比較用・未選定）」の表示、隣に置く今の案へのリンク、静的版を単独で開くリンク。
 */
export function EmbeddedApp({ appId }: { appId: string }) {
  const app = getApp(appId)
  if (!app?.embed) return null
  const pair = app.pairWith ? getApp(app.pairWith) : undefined
  const also = (app.alsoCompare ?? []).map((id) => getApp(id)).filter((a): a is NonNullable<typeof a> => !!a)
  const from = fromContest()
  const src = `${siteRoot()}embedded/${app.embed}/index.html`
  return (
    // 高さ = 画面の高さ − 固定ヘッダー − main の余白。iframe が残りを埋め、ページ全体の縦スクロールを出さない（iframe の末尾が必ず画面内に入る）
    <div className="flex h-[calc(100dvh-8.5rem)] flex-col gap-2 md:h-[calc(100dvh-5.5rem)]" data-testid="embedded-app">
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
      {/* 案の名前は上のヘッダー（スマホは名前、デスクトップは名前＋部門）に出す。帯は札とリンクと、比べるときの制約・今の状態だけ */}
      <h1 className="sr-only">{app.name}</h1>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-slate-500 bg-slate-50 px-3 py-1.5 text-xs">
        <span className="rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white" data-testid="new-plan-badge">
          {NEW_PLAN_LABEL}
        </span>
        {pair && (
          <a href={appUrl(pair.id)} className="font-medium text-primary underline underline-offset-2" data-testid="pair-link">
            今の案「{pair.name}」と見比べる
          </a>
        )}
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2 max-sm:rounded-md max-sm:border max-sm:border-primary max-sm:px-2 max-sm:py-1"
          data-testid="open-alone"
        >
          この案だけ別タブで開く
          <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only">（新しいタブで開く）</span>
        </a>
        {also.map((a) => (
          <a key={a.id} href={appUrl(a.id)} className="font-medium text-primary underline underline-offset-2" data-testid={`also-link-${a.id}`}>
            作品①「{a.name}」と見比べる
          </a>
        ))}
        {from === 'ichibiz-2026' && (
          <p className="basis-full text-muted-foreground" data-testid="band-from">
            イチBiz アイデア部門 IN1 のデモとして表示中（戻ると IN1 のカードに着きます）。
          </p>
        )}
        {app.pairNote && <p className="basis-full font-medium">{app.pairNote}</p>}
        {app.stateNote && (
          <p className="basis-full font-medium" data-testid="band-state-note">
            いまの状態: {app.stateNote}
          </p>
        )}
        {app.demoTitle && (
          <p className="basis-full text-muted-foreground" data-testid="band-demo-title">
            画面内の見出しは「{app.demoTitle}」（デモの呼び名）。提出文の提案名称は「{app.name}」。
          </p>
        )}
      </div>
      <iframe
        title={`${app.name}（${NEW_PLAN_LABEL}）`}
        src={src}
        className="min-h-[420px] w-full flex-1 rounded-md border bg-white"
        data-testid="embedded-frame"
      />
    </div>
  )
}
