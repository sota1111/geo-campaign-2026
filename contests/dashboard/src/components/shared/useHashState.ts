import { useCallback, useEffect, useState } from 'react'
import { parseHashQuery, withHashQuery } from './hashState'

/**
 * URLハッシュのクエリに文字列状態を保存する（例: #/apps/odpt?lng=137.2&lat=36.7）。
 * 値が defaultValue と同じならキーを消す。コピーしたURLを開くと同じ状態になる。
 * 数値・真偽・オブジェクトは呼び出し側で変換（JSON.stringify など）すること。
 */
export function useHashState(key: string, defaultValue = ''): [string, (v: string) => void] {
  const read = useCallback(
    () => parseHashQuery(window.location.hash).get(key) ?? defaultValue,
    [key, defaultValue],
  )
  const [value, setValue] = useState(read)

  useEffect(() => {
    const onChange = () => setValue(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [read])

  const set = useCallback(
    (v: string) => {
      const params = parseHashQuery(window.location.hash)
      if (v === defaultValue) params.delete(key)
      else params.set(key, v)
      // replaceState はルーターに通知されないため、ルート自体は変わらない
      const next = withHashQuery(window.location.hash || '#/', params)
      window.history.replaceState(null, '', window.location.pathname + window.location.search + next)
      setValue(v)
    },
    [key, defaultValue],
  )
  return [value, set]
}
