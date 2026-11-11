import { Bot, Bug, CircleHelp, Flag } from 'lucide-react'
import { APPS, CONTESTS, type ContestId } from '@/apps/registry'
import {
  A_ITEMS,
  A_MAX,
  APP_EVALS,
  B_ITEMS,
  B_MAX,
  COMMON_UNVERIFIED,
  EVALUATORS,
  EVAL_DATE,
  PORTAL_FINDINGS,
  RUBRIC_PATH,
  cMax,
  cSetOf,
  evalOf,
  pct,
  sum,
  type CSet,
} from '@/apps/eval-results'

export const MOCK_NOTICE = `AI（Sonnet）による模擬評価（${EVAL_DATE}）です。実際の審査結果ではありません。`

/** 点数は改修前の画面に対するもの。再評価するまで改修後の点数は出さない */
export const BEFORE_NOTICE = `この評価は改修前（${EVAL_DATE}）の画面に対するものです。その後の改修は反映しておらず、再評価はまだです。`

/** 点と割合。色に頼らず「点/満点（割合）」の数字と細い棒で示す */
export function Score({ label, score, max, className = '' }: { label: string; score: number; max: number; className?: string }) {
  const p = pct(score, max)
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1.5 ${className}`}>
      <span className="font-bold">{label}</span>
      <span className="whitespace-nowrap tabular-nums">
        {score}/{max}（{p}%）
      </span>
      <span aria-hidden className="relative hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:inline-block">
        <span className="absolute inset-y-0 left-0 bg-slate-700" style={{ width: `${p}%` }} />
      </span>
    </span>
  )
}

/** アプリカード用の小さな点数表示 */
export function AppScoreLine({ appId, contest }: { appId: string; contest: ContestId }) {
  const ev = evalOf(appId)
  if (!ev) return null
  const c = cSetOf(appId, contest) ?? ev.c[0]
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" data-testid={`score-line-${appId}`}>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Bot className="size-3" aria-hidden />
        AI評価（改修前の画面）
      </span>
      <Score label="B" score={sum(ev.b)} max={B_MAX} />
      <Score label="C" score={sum(c.items.map((i) => i.score))} max={cMax(c)} />
    </p>
  )
}

function ItemList({ names, scores, max = 5 }: { names: string[]; scores: number[]; max?: number }) {
  return (
    <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
      {names.map((n, i) => (
        <li key={n} className="flex justify-between gap-2 border-b border-dotted py-0.5">
          <span>{n}</span>
          <span className="font-bold tabular-nums">
            {scores[i]}/{max}
          </span>
        </li>
      ))}
    </ul>
  )
}

function CBlock({ c }: { c: CSet }) {
  const total = sum(c.items.map((i) => i.score))
  return (
    <div className="space-y-1">
      <p className="text-xs">
        <Score label={`C（${c.label}）`} score={total} max={cMax(c)} />
      </p>
      <ItemList names={c.items.map((i) => i.name)} scores={c.items.map((i) => i.score)} />
      {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
    </div>
  )
}

/** コンペのタブ内に置く「AI評価の結果」。既定は閉じておき、見出し行に点数だけ出す */
export function ContestEval({ contest }: { contest: ContestId }) {
  const evals = APP_EVALS.filter((e) => e.c.some((c) => c.contest === contest))
  if (!evals.length) return null
  const short = CONTESTS.find((c) => c.id === contest)?.short
  return (
    <details className="group rounded-lg border bg-card" data-testid={`eval-${contest}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm font-bold marker:text-foreground">
        <Bot className="size-4" aria-hidden />
        AI評価の結果（{short}）
        <span className="text-xs font-normal text-muted-foreground">
          項目別の内訳・優先度「高」の改善提案・不具合を見る（{MOCK_NOTICE}{BEFORE_NOTICE}）
        </span>
      </summary>
      <div className="space-y-4 border-t p-3">
        {evals.map((ev) => {
          const app = APPS.find((a) => a.id === ev.appId)!
          const c = ev.c.find((x) => x.contest === contest)!
          return (
            <article key={ev.appId} className="space-y-2" data-testid={`eval-app-${ev.appId}`}>
              <h4 className="text-sm font-bold">
                {app.name}
                <span className="ml-2 break-all text-xs font-normal text-muted-foreground">評価者{ev.evaluator}／出典 {ev.report}</span>
              </h4>
              <div className="space-y-1">
                <p className="text-xs">
                  <Score label="B 操作性・デザイン" score={sum(ev.b)} max={B_MAX} />
                </p>
                <ItemList names={B_ITEMS} scores={ev.b} />
              </div>
              <CBlock c={c} />
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <h5 className="mb-0.5 flex items-center gap-1 text-xs font-bold">
                    <Flag className="size-3.5" aria-hidden />
                    優先度「高」の改善提案
                  </h5>
                  {ev.high.length ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {ev.high.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">「高」の提案は報告書にありません（中・低は報告書）。</p>
                  )}
                </div>
                <div>
                  <h5 className="mb-0.5 flex items-center gap-1 text-xs font-bold">
                    <Bug className="size-3.5" aria-hidden />
                    見つかった不具合・迷った箇所
                  </h5>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs">
                    {ev.bugs.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          )
        })}
        <p className="border-t pt-2 text-xs text-muted-foreground">
          採点基準: {RUBRIC_PATH}（各項目0〜5点）。報告書はリポジトリ内のパスで、この画面からは開けません。評価で確認できなかった範囲は「全体の一覧」タブ。
        </p>
      </div>
    </details>
  )
}

function Bar({ p }: { p: number }) {
  return (
    <span aria-hidden className="mt-0.5 block h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted">
      <span className="block h-full bg-slate-700" style={{ width: `${p}%` }} />
    </span>
  )
}

function Cell({ score, max }: { score: number; max: number }) {
  return (
    <td className="px-2 py-1 align-top">
      <span className="font-bold tabular-nums">
        {score}/{max}
      </span>
      <span className="ml-1 tabular-nums">（{pct(score, max)}%）</span>
      <Bar p={pct(score, max)} />
    </td>
  )
}

/** 全体の要約タブ */
export function EvalSummary() {
  const rows = APP_EVALS.flatMap((ev) => {
    const app = APPS.find((a) => a.id === ev.appId)!
    return ev.c.map((c) => ({ ev, app, c }))
  })
  return (
    <div className="space-y-3" data-testid="eval-summary">
      <div className="rounded-lg border-2 border-slate-700 bg-slate-50 p-3 text-sm" role="note">
        <p className="flex items-center gap-1.5 font-bold">
          <Bot className="size-4" aria-hidden />
          {MOCK_NOTICE}
        </p>
        <p className="mt-1 text-xs font-bold" data-testid="eval-before-notice">
          {BEFORE_NOTICE}
        </p>
        <p className="mt-1 text-xs">
          評価者はSonnet 4名。ポータルから出発し、画面を操作して採点しました（基準: {RUBRIC_PATH}）。A はポータル（25点）、B は各アプリの操作性・デザイン（35点）、C は各コンペの審査基準に照らした採点です。審査員の採点や順位を予測するものではありません。
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-lg border bg-card p-3" aria-label="全アプリの点数一覧">
          <h3 className="mb-1.5 text-sm font-bold">全アプリの点数（B 操作性・デザイン／C コンペの審査基準）</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="eval-table">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-2 py-1 font-bold">コンペ</th>
                  <th className="px-2 py-1 font-bold">アプリ</th>
                  <th className="px-2 py-1 font-bold">B（満点{B_MAX}）</th>
                  <th className="px-2 py-1 font-bold">C（コンペ別）</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ev, app, c }) => {
                  const contest = CONTESTS.find((x) => x.id === c.contest)
                  return (
                    <tr key={`${ev.appId}-${c.contest}`} className="border-b last:border-0" data-row={`${ev.appId}-${c.contest}`}>
                      <td className="px-2 py-1 align-top font-medium">{contest?.short}</td>
                      <td className="px-2 py-1 align-top">{app.name}</td>
                      <Cell score={sum(ev.b)} max={B_MAX} />
                      <Cell score={sum(c.items.map((i) => i.score))} max={cMax(c)} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            生活アクセス診断マップは ODPT と UDC 作品①の両方に出すため、Cを2行で示します（Bは共通）。Cの満点は、ODPT・イチBizが各4項目で20点、UDCが3項目で15点、衛星が5項目で25点です。
          </p>
        </section>

        <section className="rounded-lg border bg-card p-3" aria-label="ポータルの評価">
          <h3 className="mb-1.5 text-sm font-bold">A ポータル（満点{A_MAX}）　評価者4名の点</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="eval-a-table">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-1 py-1 font-bold">評価者</th>
                  {A_ITEMS.map((n) => (
                    <th key={n} className="px-1 py-1 font-bold" title={n}>
                      {n.slice(0, 2)}
                    </th>
                  ))}
                  <th className="px-1 py-1 font-bold">計</th>
                </tr>
              </thead>
              <tbody>
                {EVALUATORS.map((e) => (
                  <tr key={e.n} className="border-b last:border-0" title={e.scope}>
                    <td className="px-1 py-1 font-medium">
                      {e.n}
                      <span className="sr-only">（{e.scope}）</span>
                    </td>
                    {e.a.map((s, i) => (
                      <td key={i} className="px-1 py-1 tabular-nums">
                        {s}
                      </td>
                    ))}
                    <td className="px-1 py-1 font-bold tabular-nums">
                      {sum(e.a)}/{A_MAX}（{pct(sum(e.a), A_MAX)}%）
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            列は {A_ITEMS.map((n) => n).join('／')}（各5点）。評価者1は UDC・ODPT のタブのみ精読。担当: {EVALUATORS.map((e) => `${e.n}＝${e.scope}`).join('、')}。
          </p>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-3" aria-label="ポータルへの指摘">
          <h3 className="mb-1.5 flex items-center gap-1 text-sm font-bold">
            <Flag className="size-4" aria-hidden />
            ポータルへの指摘（改修前の画面に対するもの。一部は改修済み）
          </h3>
          <ul className="space-y-1 text-xs">
            {PORTAL_FINDINGS.map((f) => (
              <li key={f.text} className="flex gap-1.5">
                <span className="mt-px shrink-0 whitespace-nowrap rounded border px-1 font-bold">優先度{f.priority}</span>
                <span>
                  {f.text}
                  <span className="text-muted-foreground">（評価者{f.by.join('・')}）</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-dashed bg-card p-3" aria-label="評価で確認できなかった範囲">
          <h3 className="mb-1.5 flex items-center gap-1 text-sm font-bold">
            <CircleHelp className="size-4 text-violet-800" aria-hidden />
            評価で確認できなかった範囲
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {COMMON_UNVERIFIED.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer font-medium">評価者ごとの未検証の範囲</summary>
            <ul className="mt-1 space-y-1">
              {EVALUATORS.map((e) => (
                <li key={e.n}>
                  <span className="font-bold">評価者{e.n}</span>（{e.scope}／出典 {e.report}）
                  <ul className="list-disc pl-4">
                    {e.unverified.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  )
}
