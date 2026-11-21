import type { AppMeta } from '@/apps/registry'
import { PLANS } from '@/data/progress'

/** 出典の小さな添え書き */
export function Src({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 text-[0.6875rem] text-slate-600">［出典: {children}］</span>
}

/** アプリのカードに添える、そのアプリの案の進み具合（PLANS の1件。同じコンペの案だけ。出さない案は除く） */
export function planOf(a: AppMeta) {
  return PLANS.find((p) => p.contest === a.contest && p.intent !== '出さない' && (p.appIds ?? (p.appId ? [p.appId] : [])).includes(a.id))
}
