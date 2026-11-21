import { Hourglass } from 'lucide-react'
import { pendingLabel, pendingText, useIsPending } from '@/lib/availability'
import type { AppMeta } from '@/apps/registry'

/** 元のソースが審査待ちの PR にだけあり、このビルドに含まれていない案に、案内を出す（含まれていれば何も出さない） */
export function PendingNote({ app, className = '' }: { app: AppMeta; className?: string }) {
  const pending = useIsPending(app)
  if (!pending) return null
  return (
    <p className={`flex gap-1.5 rounded border-2 border-dashed border-amber-700 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-950 ${className}`} data-testid={`pending-${app.id}`} role="note">
      <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-bold">{pendingLabel(app)}: </span>
        {pendingText(app)}
      </span>
    </p>
  )
}
