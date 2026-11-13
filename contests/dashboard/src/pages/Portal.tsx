import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { APPS, CONTESTS, isNewPlan } from '@/apps/registry'
import { CONTEST_INFO, type ContestInfo } from '@/apps/contests-info'
import { LATEST } from '@/apps/eval-results'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STATUS_REASON, contestCounts } from '@/data/status'
import { ContestPanel, nextDeadline } from '@/pages/Overview'
import { EvalSummary, MOCK_NOTICE, ROUND_NOTICE } from '@/pages/EvalPanels'
import { Question, asOf } from '@/pages/Progress'

const HASH_KEY = '#open='
/** URL ハッシュ（#open=id,id）から、開いている詳細を読む。要素の id と一致しない書式なので、読み込み時にブラウザがスクロールすることはない */
const readOpen = (): string[] => CONTEST_INFO.some((c) => `#${c.id}` === window.location.hash) ? [window.location.hash.slice(1)] : readOpenList()
const readOpenList = (): string[] =>
  window.location.hash.startsWith(HASH_KEY)
    ? window.location.hash.slice(HASH_KEY.length).split(',').filter((id) => CONTEST_INFO.some((c) => c.id === id))
    : []

const COLS = 'lg:grid-cols-[15rem_minmax(0,1.1fr)_9.5rem_minmax(0,1fr)_1.5rem]'

/** 一覧の1行（ボタン）。クリックで直下に詳細が開く。行の位置は変えない */
function ContestRow({ info, open, onToggle }: { info: ContestInfo; open: boolean; onToggle: () => void }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const doneDeadlines = info.deadlines.filter((d) => d.doneAt)
  const { done, left } = contestCounts(info.id)
  const pct = Math.round((done / (done + left)) * 100)
  const next = st.next[0]
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      className={`grid w-full items-start gap-x-3 gap-y-1.5 rounded-lg px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${COLS}`}
    >
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-bold leading-tight">{contest.name.replace(/20.*$/, '')}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          <span>
            次の締切 <span className="font-bold">{nd.text}</span>
          </span>
          <Remaining at={nd.at} />
        </span>
        {doneDeadlines.map((d) => (
          <span key={d.label} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span aria-hidden>✓</span>
            {d.label} {d.doneLabel ?? '済'}（{Number(d.doneAt!.split('-')[1])}/{Number(d.doneAt!.split('-')[2])}）
          </span>
        ))}
      </span>
      <span className="min-w-0 space-y-0.5 text-xs">
        <span className="inline-flex items-center rounded border-2 border-slate-800 px-1.5 py-0.5 text-sm font-bold" data-testid="row-status">
          <span aria-hidden>▲&nbsp;</span>提出不可
        </span>
        <span className="block">{STATUS_REASON[info.id]}</span>
      </span>
      <span className="space-y-1 text-xs" data-testid="row-progress">
        <span className="block font-bold">
          <span aria-hidden>✓</span> {done} 済・<span aria-hidden>□</span> {left} 残
        </span>
        <span className="block h-2 w-full overflow-hidden rounded-sm border border-slate-600 bg-white" aria-hidden>
          <span className="block h-full bg-slate-700" style={{ width: `${pct}%` }} />
        </span>
        <span className="sr-only">
          全 {done + left} 項目のうち {done} 件済
        </span>
      </span>
      <span className="min-w-0 space-y-0.5 text-xs">
        <span className="block font-bold text-muted-foreground lg:hidden">総司令官の次の一手</span>
        <span className="flex items-start gap-1.5">
          {next.decision && <Question>判断</Question>}
          <span className="min-w-0 font-medium" data-testid="row-next">{next.text}</span>
        </span>
      </span>
      <ChevronDown aria-hidden className={`hidden size-5 self-center transition-transform lg:block ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

export default function Portal() {
  const [open, setOpen] = useState<string[]>(readOpen)
  const [evalOpen, setEvalOpen] = useState(false)
  const toggle = (id: string) => {
    const next = open.includes(id) ? open.filter((x) => x !== id) : [...open, id]
    setOpen(next)
    // ハッシュは replaceState で書き換える（スクロールもフォーカス移動も起きない）
    window.history.replaceState(null, '', next.length ? `${HASH_KEY}${next.join(',')}` : window.location.pathname + window.location.search)
  }
  const sorted = [...CONTEST_INFO].sort((a, b) => Date.parse(nextDeadline(a).at) - Date.parse(nextDeadline(b).at))
  return (
    <div className="mx-auto max-w-6xl space-y-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-lg font-bold lg:text-xl">統合ダッシュボード</h1>
        <span className="text-xs text-muted-foreground">{asOf} 時点・締切の近い順。行を押すと、その下に詳細が開きます</span>
      </header>
      <ul className="space-y-0.5 text-xs" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄（氏名・所属・体制・経験）が未記入</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span>main へのマージ待ち（締切なし）: PR #13・#14・#12</span>
        </li>
      </ul>

      <section aria-label="コンペ一覧" data-testid="contest-list" className="space-y-1.5">
        <div className={`hidden gap-x-3 px-3 text-xs font-bold text-muted-foreground lg:grid ${COLS}`} aria-hidden>
          <span>コンペ・次の締切</span>
          <span>状況</span>
          <span>進捗（項目数）</span>
          <span>総司令官の次の一手（判断が先）</span>
          <span />
        </div>
        {sorted.map((info) => {
          const isOpen = open.includes(info.id)
          return (
            <div key={info.id} className="rounded-lg border-2 border-slate-600 bg-card" data-testid={`contest-${info.id}`}>
              <ContestRow info={info} open={isOpen} onToggle={() => toggle(info.id)} />
              {isOpen && (
                <div
                  id={`detail-${info.id}`}
                  role="region"
                  aria-label={`${info.tabName}の詳細`}
                  className="border-t-2 border-slate-600 p-3"
                  data-testid={`detail-${info.id}`}
                >
                  <ContestPanel info={info} onOpenEval={() => setEvalOpen(true)} />
                </div>
              )}
            </div>
          )
        })}
      </section>

      <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" title={`${MOCK_NOTICE}${ROUND_NOTICE}`}>
            AI評価（模擬・{LATEST.date.slice(5).replace('-', '/')}）を見る
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>AI評価（模擬）</DialogTitle>
            <DialogDescription>{MOCK_NOTICE}</DialogDescription>
          </DialogHeader>
          <EvalSummary />
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は reports/ops/status-20261113.md。今の案{APPS.filter((a) => !isNewPlan(a)).length}件と、新しい案（比較用・未選定）
        {APPS.filter(isNewPlan).length}件のデモを、各コンペの詳細で隣どうしに並べています。
      </p>
    </div>
  )
}
