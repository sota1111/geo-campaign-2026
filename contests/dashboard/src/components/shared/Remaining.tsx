import { remainingText, type DeadlineInfo } from '@/apps/contests-info'

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

/** 締切の1件分。済んだ締切は、灰色の「✓ 登録済（11/9）」にして警告を出さない */
export function DeadlineChip({ d }: { d: DeadlineInfo }) {
  if (d.doneAt) {
    const [, m, day] = d.doneAt.split('-')
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="deadline-done">
        {d.label} {d.text}
        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-bold">
          <span aria-hidden>✓&nbsp;</span>
          {d.doneLabel ?? '済'}（{Number(m)}/{Number(day)}）
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {d.label} {d.text}
      <Remaining at={d.at} />
    </span>
  )
}
