/**
 * サイトのルート（dist/ 直下）への相対パス。
 * ポータルは './'、各アプリページ（apps/<id>/index.html）は HTML の #root に付けた data-root="../../"。
 * base './' のままサブパス配置・file:// でも動くよう、ページの位置から解決する。
 */
export function siteRoot(): string {
  if (typeof document === 'undefined') return './'
  return document.getElementById('root')?.dataset.root ?? './'
}

/** 統合ダッシュボード（ポータル）の URL。tab を渡すと、そのコンペのタブを開いた状態で戻れる（例 satellite-2026） */
export function portalUrl(tab?: string): string {
  return `${siteRoot()}index.html${tab ? `#${tab}` : ''}`
}

/** ?from=<コンペ id> で開かれたとき、そのコンペ id（戻り先のタブ用）。知らない値は無視する */
export function fromContest(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const v = new URLSearchParams(window.location.search).get('from')
  return v && ['odpt-2026', 'udc-2026', 'satellite-2026', 'ichibiz-2026'].includes(v) ? v : undefined
}

/** 各アプリの独立ページの URL */
export function appUrl(appId: string): string {
  return `${siteRoot()}apps/${appId}/index.html`
}

/** data/<appId>/<file> の URL（どのページからでもサイトルートの public/data/ を指す） */
export function dataUrl(appId: string, file: string): string {
  return `${siteRoot()}data/${appId}/${file}`
}

/** data/<appId>/<file> を JSON として読む */
export async function fetchData<T = unknown>(appId: string, file: string): Promise<T> {
  const res = await fetch(dataUrl(appId, file))
  if (!res.ok) throw new Error(`データを読み込めません: ${appId}/${file} (${res.status})`)
  return (await res.json()) as T
}
