import { useEffect, useState } from 'react'
import { FileText, PlayCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { appUrl } from '@/lib/data'
import { isSampleMode } from '@/lib/sample'
import { getSample } from '@/apps/_samples'

/** 通常の使い方の URL（サンプル指定なし・初期状態） */
export const normalUrl = (appId: string) => `${appUrl(appId)}#/`
/** 実行サンプルの URL */
export const sampleUrl = (appId: string) => `${appUrl(appId)}?sample=1#/`

/** 実行サンプル中だけ出る帯（1行）。AI による模擬利用であることの明示、AI の報告、「通常の使い方に切り替える」 */
export function SampleBar({ appId }: { appId: string }) {
  const run = getSample(appId)
  if (!isSampleMode() || !run) return null
  return (
    <div
      data-testid="sample-bar"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0 border-b border-violet-300 bg-violet-50 px-3 py-1 text-xs text-violet-950 md:h-9 md:flex-nowrap md:py-0"
    >
      <PlayCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 max-md:basis-[calc(100%-2rem)] md:truncate">
        <b>実行サンプル</b>：AI（{run.tester}）による模擬利用の再現（実在の利用ではありません・保存されません）
      </span>
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-10 shrink-0 bg-background md:h-7">
            <FileText className="size-3.5" />
            AIの報告
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>AI（{run.tester}）の模擬利用の報告（{run.round}）</DialogTitle>
            <DialogDescription>
              AI（{run.tester}）が、使い方は伝えられず使用目的だけを与えられて操作した模擬利用の記録です。実在の住民・職員などの利用実績ではありません。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AIに与えた使用目的（想定）</h3>
              <p>{run.purpose}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">AIの結論</h3>
              <p>{run.conclusion}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">操作の経過</h3>
              <ul className="list-disc space-y-0.5 pl-5">{run.process.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </section>
            {run.feedback.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">AIが迷った点・要望</h3>
                <ul className="list-disc space-y-0.5 pl-5">{run.feedback.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Button asChild size="sm" variant="link" className="h-10 shrink-0 px-1 text-violet-900 underline md:h-7">
        <a href={normalUrl(appId)} data-testid="sample-exit">
          <RotateCcw className="size-3.5" />
          通常の使い方に切り替える
        </a>
      </Button>
    </div>
  )
}

/** 実行サンプル中、表示中の手順で AI が模擬利用でしたこと（StepLayout が本文の先頭に出す）。既定は2行に省略し「詳しく」で開閉 */
export function SampleStepNote({ appId, stepId }: { appId?: string; stepId?: string }) {
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [stepId])
  if (!appId || !stepId || !isSampleMode()) return null
  const note = getSample(appId)?.notes[stepId]
  if (!note) return null
  return (
    <div data-testid="sample-step-note" className="mb-3 flex items-start gap-2 rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs text-violet-950">
      <p className={open ? 'min-w-0 flex-1' : 'line-clamp-2 min-w-0 flex-1'}>
        <b>AIが模擬利用でしたこと：</b>
        {note}
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-my-1 inline-flex h-8 shrink-0 items-center rounded px-1.5 font-medium text-violet-800 underline hover:bg-violet-100"
      >
        {open ? '閉じる' : '詳しく'}
      </button>
    </div>
  )
}
