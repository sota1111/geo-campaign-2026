import { remainingText } from '@/apps/contests-info'

/** 残り日数のバッジ。色だけに頼らず、文言と記号で緊急度を示す */
export function Remaining({ at }: { at: string }) {
  const r = remainingText(at)
  const cls = r.past
    ? 'bg-muted text-muted-foreground'
    : r.urgent
      ? 'border border-amber-500 bg-amber-100 text-amber-950'
      : 'border border-sky-300 bg-sky-50 text-sky-950'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold ${cls}`}>
      {r.urgent && <span aria-hidden>▲&nbsp;</span>}
      {r.text}
    </span>
  )
}
