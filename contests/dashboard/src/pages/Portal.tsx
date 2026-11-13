import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChartRadar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { APPS, CONTESTS, isNewPlan } from '@/apps/registry'
import { CONTEST_INFO, contestsByDeadline, nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { EVAL3 } from '@/apps/eval3'
import { Remaining } from '@/components/shared/Remaining'
import { CONTEST_STATUS, STAGES, STATUS_LABEL, STATUS_REASON, otherNextCount, type Stage } from '@/data/status'
import { ContestPanel } from '@/pages/Overview'
import { EvalSummary } from '@/pages/EvalPanels'
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

/** スマホ幅（640px 未満）か。一覧を1行の帯に縮めるかの判断に使う */
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

const COLS = 'lg:grid-cols-[14rem_minmax(0,0.85fr)_minmax(0,1.6fr)_minmax(0,1fr)]'

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
          {s.note && <span className={`font-normal ${s.mark === '✓' ? 'hidden' : ''}`}>（{s.note}）</span>}
        </li>
      ))}
    </ol>
  )
}

type RowProps = { info: ContestInfo; selected: boolean; onSelect: () => void; onKey: (e: React.KeyboardEvent) => void }

/** 縮めた1行（スマホで詳細を選んだあと）。コンペ名・状況・段階の印だけ。1行 40px 前後で、4行とも常に見えて押せる */
function CompactRow({ info, selected, onSelect, onKey }: RowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      data-compact
      className={`flex min-h-10 w-full items-center gap-x-2 rounded-lg px-2 py-1 text-left text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      <span aria-hidden className="w-3 shrink-0">{selected ? '▶' : ''}</span>
      <span className="shrink-0 text-sm font-bold">{info.tabName}</span>
      <span className="min-w-0 flex-1 truncate font-bold" data-testid="row-status">
        <span aria-hidden>▲ </span>
        <span className="sr-only">提出不可: </span>
        {STATUS_LABEL[info.id]}
      </span>
      <ol className="flex shrink-0 gap-0.5" aria-label="提出までの段階" data-testid="row-progress">
        {STAGES[info.id].map((st) => (
          <li key={st.label} className={`rounded border px-1 text-xs font-bold ${STAGE_CLS[st.mark]}`} data-testid="row-stage" data-mark={st.mark}>
            <span aria-hidden>{st.mark}</span>
            <span className="sr-only">{st.label}（{STAGE_WORD[st.mark]}）</span>
          </li>
        ))}
      </ol>
    </button>
  )
}

/** 一覧の1行（ボタン）。選ぶと下の詳細欄が切り替わる。行の位置もページの高さも変えない */
function ContestRow({ info, selected, onSelect, onKey }: RowProps) {
  const contest = CONTESTS.find((c) => c.id === info.id)!
  const st = CONTEST_STATUS[info.id]
  const nd = nextDeadline(info)
  const next = st.next[0]
  const more = otherNextCount(info.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      onKeyDown={onKey}
      aria-pressed={selected}
      aria-controls={`detail-${info.id}`}
      data-testid={`row-${info.id}`}
      className={`relative grid w-full grid-cols-[minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg px-3 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-slate-800 lg:gap-y-0 lg:py-0.5 ${COLS} ${selected ? 'bg-muted ring-2 ring-inset ring-slate-800' : 'bg-card'}`}
    >
      {/* 1段目（スマホ）: コンペ名。デスクトップは5列の1段目・2段目に並べる */}
      <span className="col-start-1 row-start-1 min-w-0 text-sm font-bold leading-tight lg:col-start-1">
        {contest.name.replace(/20.*$/, '')}
      </span>
      {/* 選択中の目印。余白の中に置き、折り返しや行の高さを変えない */}
      <span aria-hidden className="absolute left-1 top-1/2 -translate-y-1/2 text-[0.625rem]">{selected ? '▶' : ''}</span>
      {/* 2段目（スマホ）: 状況の札・締切・残り日数 */}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs lg:contents">
        <span className="inline-flex items-center rounded border-2 border-slate-800 px-1.5 py-px text-xs font-bold lg:col-start-2 lg:row-start-1 lg:py-0" data-testid="row-status">
          <span aria-hidden>▲&nbsp;</span>
          <span className="sr-only">提出不可: </span>
          {STATUS_LABEL[info.id]}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 lg:col-start-1 lg:row-start-2">
          <span data-testid="row-deadline">
            <span className="lg:hidden">締切</span>
            <span className="hidden lg:inline">締切</span> <span className="font-bold">{nd.text}</span>
            {info.deadlines.length > 1 && <span>（{nd.label}）</span>}
          </span>
          <Remaining at={nd.at} />
        </span>
        <span className="hidden lg:col-start-2 lg:row-start-2 lg:line-clamp-2" data-testid="row-reason" title={STATUS_REASON[info.id]}>{STATUS_REASON[info.id]}</span>
      </span>
      <span className="lg:col-start-3 lg:row-span-2 lg:row-start-1">
        <Stages contest={info.id} />
      </span>
      <span className="min-w-0 text-xs lg:col-start-4 lg:row-span-2 lg:row-start-1">
        <span className="flex items-start gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-bold text-muted-foreground lg:hidden">次の一手</span>
          {next.decision && <Question>判断</Question>}
          <span className="min-w-0 font-medium" data-testid="row-next">
            {next.text}
            {more > 0 && <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground" data-testid="row-more">（ほか{more}件）</span>}
          </span>
        </span>
      </span>
    </button>
  )
}

export default function Portal() {
  const [open, setOpen] = useState<string[]>(readOpen)
  const [evalOpen, setEvalOpen] = useState(false)
  const narrow = useNarrow()
  const sorted = contestsByDeadline()
  const write = (next: string[]) => {
    setOpen(next)
    // ハッシュは replaceState で書き換える（スクロールもフォーカス移動も起きない）
    window.history.replaceState(null, '', next.length ? `${HASH_KEY}${next.join(',')}` : window.location.pathname + window.location.search)
  }
  // 何も選んでいないとき: デスクトップは最初のコンペを開いておく（詳細欄を空にしない）。
  // スマホは4コンペの状況・進捗の一覧を第一画面に全部見せるため、選ぶまで詳細欄は案内のみ
  const picked = open[0]
  const selectedId = picked ?? (narrow ? undefined : sorted[0].id)
  const info = CONTEST_INFO.find((c) => c.id === selectedId)
  // スマホで選んだあとは、一覧を1行ずつに縮めて詳細欄の高さを確保する
  const compact = narrow && !!picked
  // 押した行にフォーカスを残す（スマホで行の種類が入れ替わると、要素が作り直されてフォーカスが外れるため）
  const refocus = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (!refocus.current) return
    document.querySelector<HTMLElement>(`[data-testid=row-${refocus.current}]`)?.focus({ preventScroll: true })
    refocus.current = undefined
  })
  const select = (id: string) => {
    // スマホでは、選んでいる行をもう一度押すと一覧が元の大きさに戻る。デスクトップは常にどれかが選ばれている
    refocus.current = id
    write(narrow && picked === id ? [] : [id])
  }
  const onRowKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=contest-list] button[data-testid^=row-]')]
    const i = rows.indexOf(e.currentTarget as HTMLElement)
    rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true })
  }
  // 詳細欄の中だけを動かす（一覧の scrollY・行 top は変えない）。押した人の操作に限る
  const jumpToEval3 = () => {
    const box = document.getElementById(`detail-${selectedId}`)
    const sec = box?.querySelector<HTMLElement>('[data-testid=eval3-contest]')
    if (!box || !sec) return
    const b = box.getBoundingClientRect()
    const toSection = sec.getBoundingClientRect().top - b.top - 8
    // 詳細欄が低くて、節の先頭に合わせると図が見切れるときは、図の全体が見える位置までにする（見出しは上に外れてよい）
    const svg = sec.querySelector('svg[data-testid=radar]')?.getBoundingClientRect()
    const toSvg = svg ? Math.min(svg.bottom - b.bottom + 8, svg.top - b.top - 4) : toSection
    box.scrollTop += Math.max(toSection, toSvg)
    sec.querySelector<HTMLElement>('[data-testid=eval3-heading]')?.focus({ preventScroll: true })
  }
  return (
    // ページ全体を画面の高さに収める（上部バー 3rem と main の余白を引く）。詳細欄が残りを使い、中だけスクロールする
    <div className="mx-auto flex h-[calc(100dvh-3rem-1.5rem)] min-h-[32rem] max-w-6xl flex-col gap-1.5 md:-my-4 md:h-[calc(100dvh-3rem-1rem)]">
      <h1 className="sr-only">統合ダッシュボード</h1>
      <header className="flex shrink-0flex-wrap items-baseline justify-between gap-x-3 lg:hidden">
        <span className="text-xs text-muted-foreground">
          {asOf} 時点・締切順<span className="hidden sm:inline">。行を押すと下の欄に詳細が出ます</span>　<span aria-hidden>✓</span> 済　<span aria-hidden>？</span> 判断待ち{' '}
          <span aria-hidden>□</span> これから
        </span>
      </header>
      <ul className="shrink-0 space-y-0.5 text-xs lg:flex lg:gap-x-5 lg:space-y-0" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄<span className="hidden sm:inline">（氏名・所属・体制・経験）</span>が未記入</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span>main へのマージ待ち（締切なし）: PR #13・#14・#12</span>
        </li>
      </ul>

      <section aria-label="コンペ一覧" data-testid="contest-list" className="shrink-0 space-y-0.5">
        {!compact && (
          <div className={`hidden gap-x-3 px-3 text-xs font-bold text-muted-foreground lg:grid ${COLS}`} aria-hidden>
            <span>コンペ・締切順</span>
            <span>状況</span>
            <span>提出までの段階　✓ 済　？ 判断待ち　□ これから</span>
            <span>総司令官の次の一手（判断が先）</span>
          </div>
        )}
        {sorted.map((c) => (
          <div key={c.id} className="rounded-lg border-2 border-slate-600 bg-card" data-testid={`contest-${c.id}`}>
            {compact ? (
              <CompactRow info={c} selected={c.id === selectedId} onSelect={() => select(c.id)} onKey={onRowKey} />
            ) : (
              <ContestRow info={c} selected={c.id === selectedId} onSelect={() => select(c.id)} onKey={onRowKey} />
            )}
          </div>
        ))}
      </section>

      {/* 詳細欄: 一覧の下に全幅で固定。重ねない・暗くしない。この欄の中だけがスクロールする */}
      <section
        aria-label="選んだコンペの詳細"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-slate-600 bg-card"
        data-testid="detail-pane"
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b-2 border-slate-600 px-3 py-1.5">
          <h2 className="min-w-0 text-sm font-bold sm:text-base" data-testid="detail-title">{info ? `${info.tabName}の詳細` : '詳細（上の行を押す）'}</h2>
          <div className="flex min-w-0 items-center gap-1.5">
            {info && (
              <Button variant="outline" size="sm" className="min-h-9 border-2 border-slate-700 font-bold" onClick={jumpToEval3} data-testid="jump-eval3" title="この詳細の中の、第3回AI評価（今の案と新しい案の採点の形）の節へ移ります">
                <ChartRadar className="size-4" aria-hidden />
                第3回の比較へ
              </Button>
            )}
            <Button variant="outline" size="sm" className="min-h-9" onClick={() => setEvalOpen(true)} title="AI評価（模擬）。最新は第3回（GPT-6.1 sol low 10名）。第1・2回（Sonnet 4名）も同じ画面で見られます。" data-testid="open-eval">
              <span className="sm:hidden">AI評価を見る</span>
              <span className="hidden sm:inline">AI評価（模擬・第3回 {EVAL3.date.slice(5).replace('-', '/')}）を見る</span>
            </Button>
          </div>
        </div>
        <div
          key={selectedId ?? 'none'}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
          id={info ? `detail-${info.id}` : undefined}
          data-testid={info ? `detail-${info.id}` : 'detail-empty'}
          role="region"
          aria-label={info ? `${info.tabName}の詳細` : '詳細'}
          tabIndex={0}
        >
          {info ? (
            <ContestPanel info={info} onOpenEval={() => setEvalOpen(true)} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">上の一覧の行を選ぶと、そのコンペの詳細がここに出ます。</p>
          )}
          <p className="mt-4 border-t pt-2 text-xs text-muted-foreground" data-testid="portal-source">
            出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は reports/ops/status-20261113.md。今の案{APPS.filter((a) => !isNewPlan(a)).length}件と、新しい案（比較用・未選定）
            {APPS.filter(isNewPlan).length}件のデモを、各コンペの詳細で隣どうしに並べています。
          </p>
        </div>
      </section>

      <Dialog open={evalOpen} onOpenChange={setEvalOpen}>
        <DialogContent className="max-h-[85vh] grid-cols-[minmax(0,1fr)] overflow-y-auto p-4 sm:max-w-5xl sm:p-6 [&>*]:min-w-0" data-testid="eval-dialog">
          <DialogHeader>
            <DialogTitle className="pr-6">AI評価（模擬）　最新は第3回（{EVAL3.date.slice(5).replace('-', '/')}）</DialogTitle>
            <DialogDescription className="text-xs">
              すべて AI による模擬評価で、実際の審査結果ではありません。回によって評価した AI と人数が違います。第3回は {EVAL3.model} {EVAL3.evaluatorCount}名、第1・2回は Sonnet 各4名で、下の区画で分けて示します。
            </DialogDescription>
          </DialogHeader>
          <EvalSummary />
        </DialogContent>
      </Dialog>
    </div>
  )
}
