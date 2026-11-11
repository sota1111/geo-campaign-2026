import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { DATA_KIND_LABEL, type DataKind } from '@/apps/registry'

// 色覚配慮: 赤/緑を使わず、青・橙(黄褐色)・紫＋記号で区別する
const STYLE: Record<DataKind, string> = {
  real: 'bg-sky-100 text-sky-900 border-sky-300',
  fictional: 'bg-amber-100 text-amber-900 border-amber-400 border-dashed',
  partial: 'bg-violet-100 text-violet-900 border-violet-300',
}
const MARK: Record<DataKind, string> = { real: '●', fictional: '◇', partial: '◐' }

export function DataBadge({ kind, label, className }: { kind: DataKind; label?: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1 font-medium', STYLE[kind], className)} data-kind={kind}>
      <span aria-hidden>{MARK[kind]}</span>
      {label ?? DATA_KIND_LABEL[kind]}
    </Badge>
  )
}
