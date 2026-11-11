import { useCallback, useEffect, useState } from 'react'

/** localStorage に JSON で保存する useState。キーは 'アプリid:名前' の形で衝突を避けること */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 容量超過・プライベートモードは無視 */
    }
  }, [key, value])
  const reset = useCallback(() => setValue(initial), [initial])
  return [value, setValue, reset] as const
}
