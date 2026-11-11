import { useCallback, useEffect, useState } from 'react'
import { isSampleMode } from '@/lib/sample'

/** localStorage に JSON で保存する useState。キーは 'アプリid:名前' の形で衝突を避けること。
 *  実行サンプル（?sample=1）では読み書きせず、initial（またはページが渡すサンプルの値）から始まるメモリ上の状態になる */
export function useLocalStorage<T>(key: string, initial: T, sampleInitial?: T) {
  const sample = isSampleMode()
  const [value, setValue] = useState<T>(() => {
    if (sample) return sampleInitial ?? initial
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    if (sample) return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* 容量超過・プライベートモードは無視 */
    }
  }, [key, value, sample])
  const reset = useCallback(() => setValue(initial), [initial])
  return [value, setValue, reset] as const
}
