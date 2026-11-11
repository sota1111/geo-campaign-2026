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

/** 実行サンプル中だけ、ヘッダーの下に出る帯。被験者の報告と「通常の使い方に切り替える」 */
export function SampleBar({ appId }: { appId: string }) {
  const run = getSample(appId)
  if (!isSampleMode() || !run) return null
  return (
    <div
      data-testid="sample-bar"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-violet-300 bg-violet-50 px-3 py-1 text-xs text-violet-950 md:h-9 md:flex-nowrap md:py-0"
    >
      <PlayCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 md:truncate">
        <b>実行サンプル</b>：{run.round}の試験で {run.tester} 被験者が操作した結果を再現しています。手順を押すと、被験者がその手順でしたことが出ます。操作しても保存されません。
      </span>
      <Dialog>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" className="h-7 shrink-0 bg-background">
            <FileText className="size-3.5" />
            被験者の報告
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>被験者の報告（{run.round}・{run.tester}）</DialogTitle>
            <DialogDescription>使い方は伝えず、使用目的だけを伝えて操作してもらいました。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">伝えた使用目的</h3>
              <p>{run.purpose}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">被験者の結論</h3>
              <p>{run.conclusion}</p>
            </section>
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground">操作の経過</h3>
              <ul className="list-disc space-y-0.5 pl-5">{run.process.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </section>
            {run.feedback.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground">迷った点・要望</h3>
                <ul className="list-disc space-y-0.5 pl-5">{run.feedback.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Button asChild size="sm" className="h-7 shrink-0">
        <a href={normalUrl(appId)} data-testid="sample-exit">
          <RotateCcw className="size-3.5" />
          通常の使い方に切り替える
        </a>
      </Button>
    </div>
  )
}

/** 実行サンプル中、表示中の手順で被験者がしたこと（StepLayout が本文の先頭に出す） */
export function SampleStepNote({ appId, stepId }: { appId?: string; stepId?: string }) {
  if (!appId || !stepId || !isSampleMode()) return null
  const note = getSample(appId)?.notes[stepId]
  if (!note) return null
  return (
    <div data-testid="sample-step-note" className="mb-3 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-950">
      <b>被験者がこの手順でしたこと：</b>
      {note}
    </div>
  )
}
