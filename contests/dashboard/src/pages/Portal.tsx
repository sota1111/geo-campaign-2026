import { useRef, useState, useSyncExternalStore } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { APPS, CONTESTS, isNewPlan } from '@/apps/registry'
import { CONTEST_INFO, contestsByDeadline, nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { LATEST } from '@/apps/eval-results'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STAGES, STATUS_LABEL, STATUS_REASON, otherNextCount, type Stage } from '@/data/status'
import { ContestPanel } from '@/pages/Overview'
import { EvalSummary, MOCK_NOTICE, ROUND_NOTICE } from '@/pages/EvalPanels'
import { Question, asOf } from '@/pages/Progress'

const HASH_KEY = '#open='
/**
 * URL ハッシュ（#open=id,id）から、開いている詳細を読む（ブラウザの「戻る」で開いた状態を戻すため）。
 * 古い形式の #<コンペid> は読まない。アプリからの戻り（index.html）は常に全行が閉じた一覧。
 * 要素の id と一致しない書式なので、読み込み時にブラウザがスクロールすることはない
 */
const readOpen = (): string[] =>
  window.location.hash.startsWith(HASH_KEY)
    ? window.location.hash.slice(HASH_KEY.length).split(',').filter((id) => CONTEST_INFO.some((c) => c.id === id))
    : []

/** スマホ幅（640px 未満）か。詳細を行の下ではなく、下から出るシートで開くために使う */
const NARROW = '(max-width: 639.98px)'
function useNarrow(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(NARROW)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  )
}

const COLS = 'lg:grid-cols-[13rem_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1fr)_1.5rem]'

const STAGE_WORD: Record<Stage['mark'], string> = { '✓': '済', '？': '判断待ち', '□': 'これから' }
const STAGE_CLS: Record<Stage['mark'], string> = {
  '✓': 'border-slate-500 bg-slate-100',
  '？': 'border-amber-600 bg-amber-100 text-amber-950',
  '□': 'border-dashed border-slate-500 bg-white',
}

/** 提出までの段階。件数ではなく、段階ごとの印（✓ 済／？ 判断待ち／□ これから）と文言で示す。色だけに頼らない */
function Stages({ contest }: { contest: ContestInfo['id'] }) {
  return (
    <ol className="flex flex-wrap gap-1" aria-label="提出までの段階" data-testid="row-progress">
      {STAGES[contest].map((s) => (
        <li
          key={s.label}
          className={`whitespace-nowrap rounded border px-1 py-px text-xs font-bold leading-snug ${STAGE_CLS[s.mark]}`}
          data-testid="row-stage"
          data-mark={s.mark}
        >
          {s.label} <span aria-hidden>{s.mark}</span>
          <span className="sr-only">（{STAGE_WORD[s.mark]}）</span>
          {s.note && <span className={`font-normal ${s.mark === '✓' ? 'hidden lg:inline' : ''}`}>（{s.note}）</span>}
        </li>
      ))}
    </ol>
  )
}

/** 一覧の1行（ボタン）。クリックで一覧の上に重ねたパネルに詳細が開く。行の位置もページの高さも変えない */
function ContestRow({ info, open, onToggle }: { info: ContestInfo; open: boolean; onToggle: () => void }) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const next = st.next[0]
  const more = otherNextCount(info.id)
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 lg:gap-y-0.5 lg:py-2 ${COLS} ${open ? 'bg-muted ring-2 ring-inset ring-slate-800' : ''}`}
    >
      {/* 1段目（スマホ）: コンペ名と開閉の目印。デスクトップは5列の1段目・2段目に並べる */}
      <span className="col-start-1 row-start-1 min-w-0 text-sm font-bold leading-tight lg:col-start-1">
        {contest.name.replace(/20.*$/, '')}
      </span>
      <ChevronDown aria-hidden className={`col-start-2 row-start-1 size-5 transition-transform lg:hidden ${open ? 'rotate-180' : ''}`} />
      {/* 2段目（スマホ）: 状況の札・締切・残り日数 */}
      <span className="col-span-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs lg:contents">
        <span className="inline-flex items-center rounded border-2 border-slate-800 px-1.5 py-px text-xs font-bold lg:col-start-2 lg:row-start-1 lg:py-0.5 lg:text-sm" data-testid="row-status">
          <span aria-hidden>▲&nbsp;</span>
          <span className="sr-only">提出不可: </span>
          {STATUS_LABEL[info.id]}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 lg:col-start-1 lg:row-start-2">
          <span data-testid="row-deadline">
            <span className="lg:hidden">締切</span>
            <span className="hidden lg:inline">次の締切</span> <span className="font-bold">{nd.text}</span>
            {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
          </span>
          <Remaining at={nd.at} />
        </span>
        <span className="hidden lg:col-start-2 lg:row-start-2 lg:block" data-testid="row-reason">{STATUS_REASON[info.id]}</span>
      </span>
      <span className="col-span-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1">
        <Stages contest={info.id} />
      </span>
      <span className="col-span-2 min-w-0 text-xs lg:col-span-1 lg:col-start-4 lg:row-span-2 lg:row-start-1">
        <span className="flex items-start gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-bold text-muted-foreground lg:hidden">次の一手</span>
          {next.decision && <Question>判断</Question>}
          <span className="min-w-0 font-medium" data-testid="row-next">
            {next.text}
            {more > 0 && <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground" data-testid="row-more">（ほか{more}件）</span>}
          </span>
        </span>
      </span>
      <ChevronDown aria-hidden className={`hidden size-5 self-center transition-transform lg:col-start-5 lg:row-span-2 lg:row-start-1 lg:block ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

export default function Portal() {
  const [open, setOpen] = useState<string[]>(readOpen)
  const [evalOpen, setEvalOpen] = useState(false)
  const narrow = useNarrow()
  const write = (next: string[]) => {
    setOpen(next)
    // ハッシュは replaceState で書き換える（スクロールもフォーカス移動も起きない）
    window.history.replaceState(null, '', next.length ? `${HASH_KEY}${next.join(',')}` : window.location.pathname + window.location.search)
  }
  const rowEl = (id: string) => document.querySelector<HTMLElement>(`[data-testid=row-${id}]`)
  const toggle = (id: string) => {
    write(open.includes(id) ? [] : [id])
  }
  // 詳細は幅によらず一覧の上に重ねるパネル（スマホ: 下から、デスクトップ: 右から）。背景ページの高さは変わらない
  const sheetId = open[open.length - 1]
  const lastId = useRef<string | undefined>(undefined)
  if (sheetId) lastId.current = sheetId
  const sheetInfo = CONTEST_INFO.find((c) => c.id === sheetId)
  const sorted = contestsByDeadline()
  return (
    <div className="mx-auto max-w-6xl space-y-2">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="sr-only text-xl font-bold lg:not-sr-only">統合ダッシュボード</h1>
        <span className="text-xs text-muted-foreground">
          {asOf} 時点・締切順<span className="hidden sm:inline">。行を押すと詳細が開きます</span>　<span aria-hidden>✓</span> 済　<span aria-hidden>？</span> 判断待ち{' '}
          <span aria-hidden>□</span> これから
        </span>
      </header>
      <ul className="space-y-0.5 text-xs" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄<span className="hidden sm:inline">（氏名・所属・体制・経験）</span>が未記入</span>
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
          <span>提出までの段階</span>
          <span>総司令官の次の一手（判断が先）</span>
          <span />
        </div>
        {sorted.map((info) => {
          const isOpen = open.includes(info.id)
          return (
            <div key={info.id} className="rounded-lg border-2 border-slate-600 bg-card" data-testid={`contest-${info.id}`}>
              <ContestRow info={info} open={isOpen} onToggle={() => toggle(info.id)} />
            </div>
          )
        })}
      </section>

      <Sheet open={!!sheetInfo} onOpenChange={(o) => !o && write([])}>
        <SheetContent
          side={narrow ? 'bottom' : 'right'}
          showCloseButton={false}
          className={narrow ? 'max-h-[88dvh] gap-0 rounded-t-xl p-0' : 'w-[min(44rem,92vw)] gap-0 p-0 sm:max-w-none'}
          onCloseAutoFocus={(e) => {
            // 閉じたあと、行にフォーカスを戻す。行へのスクロールはさせない
            e.preventDefault()
            if (lastId.current) rowEl(lastId.current)?.focus({ preventScroll: true })
          }}
          data-testid="detail-sheet"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-600 px-3 py-2">
            <SheetTitle className="text-base">{sheetInfo?.tabName}の詳細</SheetTitle>
            <Button variant="outline" size="sm" className="min-h-9" onClick={() => write([])} data-testid="sheet-close">
              <X className="size-4" aria-hidden />
              閉じる
            </Button>
          </div>
          <nav aria-label="別のコンペの詳細へ切り替え" className="grid shrink-0 grid-cols-4 gap-1 border-b border-slate-300 px-3 py-1.5" data-testid="sheet-switch">
            {sorted.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => write([c.id])}
                aria-pressed={c.id === sheetId}
                data-testid={`switch-${c.id}`}
                className={`min-h-9 rounded border-2 px-1 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${c.id === sheetId ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-500 bg-card hover:bg-muted'}`}
              >
                {c.id === sheetId && <span aria-hidden>● </span>}
                {c.tabName}
              </button>
            ))}
          </nav>
          <SheetDescription className="sr-only">コンペの詳細。閉じると一覧に戻ります。</SheetDescription>
          <div
            key={sheetId}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
            id={sheetInfo ? `detail-${sheetInfo.id}` : undefined}
            data-testid={sheetInfo ? `detail-${sheetInfo.id}` : undefined}
          >
            {sheetInfo && <ContestPanel info={sheetInfo} onOpenEval={() => setEvalOpen(true)} />}
          </div>
        </SheetContent>
      </Sheet>

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
