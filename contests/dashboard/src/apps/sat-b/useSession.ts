import { useEffect, useState } from 'react'
import { isSampleMode } from '@/lib/sample'

/**
 * sessionStorage に JSON で保存する useState。タブを閉じると消えるので、開いた直後は必ず空（initial）から始まる。
 * 前の利用者・別の評価者の記録が見えてしまうのを避けるため、盛土巡視台帳の記録と重みはこちらに保存する。
 * 実行サンプル（?sample=1）では読み書きせず、sampleInitial（なければ initial）から始まるメモリ上の状態になる。
 */
export function useSessionState<T>(key: string, initial: T, sampleInitial?: T) {
  const sample = isSampleMode()
  const [value, setValue] = useState<T>(() => {
    if (sample) return sampleInitial ?? initial
    try {
      const raw = window.sessionStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    if (sample) return
    try { window.sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* 容量超過・プライベートモードは無視 */ }
  }, [key, value, sample])
  return [value, setValue] as const
}
