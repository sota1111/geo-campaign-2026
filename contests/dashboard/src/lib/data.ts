/** public/data/<appId>/<file> の URL（base './' でもサブパス配置でも動く） */
export function dataUrl(appId: string, file: string): string {
  return `${import.meta.env.BASE_URL}data/${appId}/${file}`
}

/** public/data/<appId>/<file> を JSON として読む */
export async function fetchData<T = unknown>(appId: string, file: string): Promise<T> {
  const res = await fetch(dataUrl(appId, file))
  if (!res.ok) throw new Error(`データを読み込めません: ${appId}/${file} (${res.status})`)
  return (await res.json()) as T
}
