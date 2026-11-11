// URL ハッシュ（#/route?a=1&b=2）のクエリ部に状態を保存する純関数群。共有リンク用。
export function parseHashQuery(hash: string): URLSearchParams {
  const i = hash.indexOf('?')
  return new URLSearchParams(i < 0 ? '' : hash.slice(i + 1))
}

export function withHashQuery(hash: string, params: URLSearchParams): string {
  const i = hash.indexOf('?')
  const path = i < 0 ? hash : hash.slice(0, i)
  const q = params.toString()
  return q ? `${path}?${q}` : path
}
