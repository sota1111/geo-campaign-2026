import { Skeleton } from '@/components/ui/skeleton'

/** アプリページ読み込み中の骨組み（見出し＋操作欄＋地図の形） */
export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4" role="status" aria-label="読み込み中">
      <div className="space-y-2 border-b pb-4">
        <Skeleton className="h-8 w-2/3 max-w-sm" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-3 w-1/2 max-w-md" />
      </div>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
        <Skeleton className="h-[360px] w-full" />
      </div>
      <span className="sr-only">読み込み中…</span>
    </div>
  )
}
