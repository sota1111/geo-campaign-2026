import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

export interface SourceItem {
  name: string
  /** 提供者 */
  provider?: string
  license?: string
  url?: string
  note?: string
}

/** 出典・ライセンスの一覧ダイアログ。trigger を省略すると「出典・ライセンス」ボタンが出る */
export function SourceDialog({
  sources, title = '出典・ライセンス', trigger,
}: { sources: SourceItem[]; title?: string; trigger?: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm"><Info className="size-4" />出典・ライセンス</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>このページで使っているデータの出典です。</DialogDescription>
        </DialogHeader>
        <ul className="space-y-3 text-sm">
          {sources.map((s) => (
            <li key={s.name} className="rounded-md border p-3">
              <div className="font-medium">{s.name}</div>
              {s.provider && <div className="text-muted-foreground">提供: {s.provider}</div>}
              {s.license && <div className="text-muted-foreground">ライセンス: {s.license}</div>}
              {s.note && <div className="mt-1">{s.note}</div>}
              {s.url && (
                <a className="mt-1 block break-all text-primary underline" href={s.url} target="_blank" rel="noreferrer">
                  {s.url}
                </a>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
