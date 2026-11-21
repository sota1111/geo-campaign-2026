import { useState, useSyncExternalStore } from 'react'
import { ChartRadar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { APPS, CONTESTS, isNewPlan } from '@/apps/registry'
import { CONTEST_INFO, contestsByDeadline, nextDeadline, type ContestInfo } from '@/apps/contests-info'
import { EVAL3 } from '@/apps/eval3'
import { ContestCard, MobileCard } from '@/pages/ContestCards'
import { ContestPanel } from '@/pages/Overview'
import { EvalSummary } from '@/pages/EvalPanels'
import { asOf } from '@/pages/Progress'
import { OVERALL, PROGRESS_SOURCE } from '@/data/progress'
import { STATUS_LABEL, STATUS_REASON } from '@/data/status'

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
  // 何も選んでいないとき: デスクトップもスマホも最初のコンペを開いておく（詳細欄を空にせず、行の高さも位置も選択で変えない）。
  // 選んでいる行をもう一度押しても解除しない。別の行を1回押せば切り替わる
  const selectedId = open[0] ?? sorted[0].id
  const info = CONTEST_INFO.find((c) => c.id === selectedId)
  const Card = narrow ? MobileCard : ContestCard
  const select = (id: string) => write([id])
  const onRowKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid=contest-list] button[data-testid^=row-]')]
    const i = rows.indexOf(e.currentTarget as HTMLElement)
    rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus({ preventScroll: true })
  }
  // 詳細欄の中だけを動かす（一覧の scrollY・行 top は変えない）。押した人の操作に限る。
  // 図のまとまり（見出し・凡例・図）の先頭を詳細欄の上端に合わせ、同じ視野に入れる
  const jumpToEval3 = () => {
    const box = document.getElementById(`detail-${selectedId}`)
    const target = box?.querySelector<HTMLElement>('[data-testid=eval3-figure]') ?? box?.querySelector<HTMLElement>('[data-testid=eval3-contest]')
    if (!box || !target) return
    box.scrollTop += target.getBoundingClientRect().top - box.getBoundingClientRect().top - 6
    target.querySelector<HTMLElement>('[data-testid=eval3-figure-heading]')?.focus({ preventScroll: true })
  }
  return (
    // ページ全体を画面の高さに収める（上部バー 3rem と main の余白を引く）。詳細欄が残りを使い、中だけスクロールする
    <div className="mx-auto flex h-[calc(100dvh-3rem-1.5rem)] min-h-[32rem] max-w-6xl flex-col gap-1.5 md:-my-4 md:h-[calc(100dvh-3rem-1rem)]">
      <h1 className="sr-only">統合ダッシュボード</h1>
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-3 lg:hidden">
        <span className="text-xs text-muted-foreground">
          {asOf} 時点・締切順<span className="hidden sm:inline">。カードを押すと下の欄に詳細が出ます</span>　<span aria-hidden>✓</span> 済　<span aria-hidden>□</span> 残り　<span aria-hidden>？</span> 判断待ち
        </span>
      </header>
      <ul className="shrink-0 space-y-0.5 text-xs lg:flex lg:gap-x-5 lg:space-y-0" data-testid="progress-overall">
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span className="font-bold">どの案も提出不可: 本人欄<span className="hidden sm:inline">（氏名・所属・体制・経験）</span>が未記入</span>
        </li>
        <li className="flex gap-1.5">
          <span aria-hidden>▲</span>
          <span title={OVERALL[1]}>マージ保留（総司令官補佐が止めた PR）: PR #35・#36・#18・#19・#27</span>
        </li>
      </ul>

      {/* 進捗カード: 締切の近い順。スマホは1列の固定高のカード、タブレットは2列、デスクトップは4列。押しても画面は動かず、下の詳細欄が切り替わる */}
      <section aria-label="コンペの進捗カード" data-testid="contest-list" className="grid shrink-0 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {sorted.map((c) => (
          <div key={c.id} className="rounded-lg border-2 border-slate-600 bg-card" data-testid={`contest-${c.id}`}>
            <Card info={c} selected={c.id === selectedId} onSelect={() => select(c.id)} onKey={onRowKey} />
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
          <h2 className="min-w-0 text-sm font-bold sm:text-base" data-testid="detail-title">{info ? `${info.tabName}の詳細` : '詳細（上のカードを押す）'}</h2>
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
          {info && (
            <p className="mb-2 text-xs" data-testid="detail-reason">
              <span className="font-bold"><span aria-hidden>▲ </span>提出不可（{STATUS_LABEL[info.id]}）: </span>
              {STATUS_REASON[info.id]}
            </p>
          )}
          {info ? (
            <ContestPanel info={info} onOpenEval={() => setEvalOpen(true)} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">上のカードを選ぶと、そのコンペの詳細がここに出ます。</p>
          )}
          <div className="mt-4 border-t pt-2 text-xs" data-testid="progress-overall-full">
            <p className="font-bold">全体（{PROGRESS_SOURCE}）</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {OVERALL.map((t) => (
                <li key={t} className="break-words">{t}</li>
              ))}
            </ul>
          </div>
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground" data-testid="portal-source">
            出典: 各コンペの公式要項（取得日 2026-11-09）、進捗は {PROGRESS_SOURCE}（{asOf} 時点）。今の案{APPS.filter((a) => !isNewPlan(a)).length}件と、新しい案（比較用・未選定）
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
