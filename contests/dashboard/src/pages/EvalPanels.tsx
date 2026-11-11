import { Bot, Bug, CircleHelp, Flag } from 'lucide-react'
import { APPS, CONTESTS, type ContestId } from '@/apps/registry'
import {
  A_ITEMS,
  A_MAX,
  B_ITEMS,
  B_MAX,
  LATEST,
  PREVIOUS,
  RUBRIC_PATH,
  aTotal,
  bTotal,
  cMax,
  cSetOf,
  cTotal,
  deltaText,
  diffOf,
  evalOf,
  pct,
  type AppEval,
  type CSet,
} from '@/apps/eval-results'

/** 評価の表示がある場所には必ずこの2文（またはその短縮形）を添える */
export const MOCK_NOTICE = 'AI（Sonnet）による模擬評価で、実際の審査結果ではありません。'
export const ROUND_NOTICE = `第${LATEST.round}回（${LATEST.date}）は、第${PREVIOUS.round}回（${PREVIOUS.date}）の改修後の画面に対する評価です。この後の改修は反映していません。`

/** 日付を「11/12」の形にする */
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

/** アプリカード用の小さな一行。点数の内訳は「AI評価」タブ */
export function AppScoreLine({ appId, contest, onOpen }: { appId: string; contest: ContestId; onOpen?: () => void }) {
  const ev = evalOf(appId)
  if (!ev) return null
  const c = cSetOf(appId, contest) ?? ev.c[0]
  const d = diffOf(appId, c.contest)
  return (
    <p
      className="text-xs leading-snug text-muted-foreground"
      data-testid={`score-line-${appId}`}
      title={`${MOCK_NOTICE}${ROUND_NOTICE}`}
    >
      <Bot className="mr-1 inline size-3 align-[-1px]" aria-hidden />
      <span>
        AI模擬評価 {md(LATEST.date)}（改修後・審査結果ではない）
        <span className="ml-1 whitespace-nowrap font-bold tabular-nums text-foreground">
          B {bTotal(ev)}/{B_MAX}・C {cTotal(c)}/{cMax(c)}
        </span>
        {d && (
          <span className="whitespace-nowrap tabular-nums">
            （前回比 {deltaText(d.b)}/{deltaText(d.c)}）
          </span>
        )}
      </span>
      {onOpen && (
        <button type="button" onClick={onOpen} className="ml-1.5 font-medium text-sky-800 underline underline-offset-2">
          内訳
        </button>
      )}
    </p>
  )
}

/** 点と割合。色に頼らず「点/満点（割合）」の数字で示す */
function Score({ label, score, max }: { label: string; score: number; max: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span className="font-bold">{label}</span>
      <span className="whitespace-nowrap tabular-nums">
        {score}/{max}（{pct(score, max)}%）
      </span>
    </span>
  )
}

/** 前回→今回（差）。差は符号つきの文字で示す */
function Change({ prev, now, max }: { prev?: number; now: number; max: number }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {prev !== undefined && <span className="text-muted-foreground">{prev}→</span>}
      <span className="font-bold">
        {now}/{max}
      </span>
      {prev !== undefined && <span className="ml-1">（{deltaText(now - prev)}）</span>}
    </span>
  )
}

function Bar({ p }: { p: number }) {
  return (
    <span aria-hidden className="mt-0.5 block h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-muted">
      <span className="block h-full bg-slate-700" style={{ width: `${p}%` }} />
    </span>
  )
}

function Cell({ prev, now, max }: { prev?: number; now: number; max: number }) {
  return (
    <td className="px-2 py-1 align-top">
      <Change prev={prev} now={now} max={max} />
      <span className="ml-1 whitespace-nowrap tabular-nums text-muted-foreground">{pct(now, max)}%</span>
      <Bar p={pct(now, max)} />
    </td>
  )
}

function ItemList({ names, scores, prev, max = 5 }: { names: string[]; scores: number[]; prev?: number[]; max?: number }) {
  return (
    <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
      {names.map((n, i) => (
        <li key={n} className="flex justify-between gap-2 border-b border-dotted py-0.5">
          <span>{n}</span>
          <span className="whitespace-nowrap font-bold tabular-nums">
            {scores[i]}/{max}
            {prev && <span className="ml-1 font-normal">（前回{prev[i]}・{deltaText(scores[i] - prev[i])}）</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function CBlock({ c, prev }: { c: CSet; prev?: CSet }) {
  return (
    <div className="space-y-1">
      <p className="text-xs">
        <Score label={`C（${c.label}）`} score={cTotal(c)} max={cMax(c)} />
        {prev && <span className="ml-1">（前回{cTotal(prev)}・{deltaText(cTotal(c) - cTotal(prev))}）</span>}
      </p>
      <ItemList names={c.items.map((i) => i.name)} scores={c.items.map((i) => i.score)} prev={prev?.items.map((i) => i.score)} />
      {c.note && <p className="text-xs text-muted-foreground">{c.note}</p>}
    </div>
  )
}

function Bullets({ items, empty }: { items: string[]; empty: string }) {
  return items.length ? (
    <ul className="list-disc space-y-0.5 pl-4 text-xs">
      {items.map((h) => (
        <li key={h}>{h}</li>
      ))}
    </ul>
  ) : (
    <p className="text-xs text-muted-foreground">{empty}</p>
  )
}

/** アプリごとの詳細（第2回を主、第1回の提案・不具合は折りたたみ） */
function AppDetail({ ev }: { ev: AppEval }) {
  const app = APPS.find((a) => a.id === ev.appId)!
  const prev = evalOf(ev.appId, PREVIOUS)
  return (
    <details className="rounded-lg border bg-card" data-testid={`eval-app-${ev.appId}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm marker:text-foreground">
        <span className="font-bold">{app.name}</span>
        <span className="text-xs text-muted-foreground">
          {ev.c.map((c) => CONTESTS.find((x) => x.id === c.contest)?.short).join('・')}
        </span>
        <span className="text-xs tabular-nums">
          B {bTotal(ev)}/{B_MAX}
          {prev && `（前回${bTotal(prev)}・${deltaText(bTotal(ev) - bTotal(prev))}）`}
        </span>
      </summary>
      <div className="space-y-3 border-t p-3">
        <p className="break-all text-xs text-muted-foreground">
          第{LATEST.round}回 {LATEST.date}／評価者{ev.evaluator}／出典 {ev.report}
        </p>
        <div className="space-y-1">
          <p className="text-xs">
            <Score label="B 操作性・デザイン" score={bTotal(ev)} max={B_MAX} />
          </p>
          <ItemList names={B_ITEMS} scores={ev.b} prev={prev?.b} />
        </div>
        {ev.c.map((c) => (
          <CBlock key={c.contest + c.label} c={c} prev={prev?.c.find((x) => x.contest === c.contest && x.label === c.label)} />
        ))}
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h5 className="mb-0.5 flex items-center gap-1 text-xs font-bold">
              <Flag className="size-3.5" aria-hidden />
              優先度「高」の改善提案（第{LATEST.round}回）
            </h5>
            <Bullets items={ev.high} empty="「高」の提案は報告書にありません。" />
          </div>
          <div>
            <h5 className="mb-0.5 flex items-center gap-1 text-xs font-bold">
              <Bug className="size-3.5" aria-hidden />
              見つかった不具合・迷った箇所（第{LATEST.round}回）
            </h5>
            <Bullets items={ev.bugs} empty="報告書に記載なし。" />
          </div>
        </div>
        {prev && (
          <details className="rounded border border-dashed p-2 text-xs">
            <summary className="cursor-pointer font-medium">
              第{PREVIOUS.round}回（{PREVIOUS.date}・改修前の画面）の提案と不具合
            </summary>
            <p className="mt-1 break-all text-muted-foreground">出典 {prev.report}</p>
            <div className="mt-1 grid gap-3 lg:grid-cols-2">
              <div>
                <h5 className="mb-0.5 font-bold">優先度「高」の改善提案</h5>
                <Bullets items={prev.high} empty="「高」の提案は報告書にありません。" />
              </div>
              <div>
                <h5 className="mb-0.5 font-bold">見つかった不具合・迷った箇所</h5>
                <Bullets items={prev.bugs} empty="報告書に記載なし。" />
              </div>
            </div>
          </details>
        )}
      </div>
    </details>
  )
}

/** 「AI評価」タブの本体。評価の表示はここに集約する */
export function EvalSummary() {
  const rows = LATEST.apps.flatMap((ev) => {
    const app = APPS.find((a) => a.id === ev.appId)!
    return ev.c.map((c) => ({ ev, app, c }))
  })
  return (
    <div className="space-y-3" data-testid="eval-summary">
      <div className="rounded-lg border-2 border-slate-700 bg-slate-50 p-3 text-sm" role="note">
        <p className="flex items-center gap-1.5 font-bold">
          <Bot className="size-4 shrink-0" aria-hidden />
          {MOCK_NOTICE}
        </p>
        <p className="mt-1 text-xs font-bold" data-testid="eval-before-notice">
          {ROUND_NOTICE}第{PREVIOUS.round}回は改修前の画面です。
        </p>
        <p className="mt-1 text-xs">
          評価者は各回 Sonnet 4名。ポータルから出発し、画面を操作して採点しました（基準: {RUBRIC_PATH}）。A はポータル（{A_MAX}点）、B は各アプリの操作性・デザイン（{B_MAX}点）、C は各コンペの審査基準に照らした採点です。審査員の採点や順位を予測するものではありません。表の「前→今」は第{PREVIOUS.round}回→第{LATEST.round}回、（　）は差です。
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-lg border bg-card p-3" aria-label="全アプリの点数一覧">
          <h3 className="mb-1.5 text-sm font-bold">
            全アプリの点数（第{PREVIOUS.round}回 {md(PREVIOUS.date)} → 第{LATEST.round}回 {md(LATEST.date)}）
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="eval-table">
              <thead>
                <tr className="border-b text-left">
                  <th className="px-2 py-1 font-bold">コンペ／アプリ</th>
                  <th className="px-2 py-1 font-bold">B 操作性・デザイン</th>
                  <th className="px-2 py-1 font-bold">C コンペの審査基準</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ ev, app, c }) => {
                  const contest = CONTESTS.find((x) => x.id === c.contest)
                  const p = evalOf(ev.appId, PREVIOUS)
                  const pc = cSetOf(ev.appId, c.contest, PREVIOUS)
                  return (
                    <tr key={`${ev.appId}-${c.contest}`} className="border-b last:border-0" data-row={`${ev.appId}-${c.contest}`}>
                      <td className="min-w-28 px-2 py-1 align-top">
                        <span className="block font-medium">{contest?.short}</span>
                        {app.name}
                      </td>
                      <Cell prev={p && bTotal(p)} now={bTotal(ev)} max={B_MAX} />
                      <Cell prev={pc && cTotal(pc)} now={cTotal(c)} max={cMax(c)} />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            生活アクセス診断マップは ODPT と UDC 作品①の両方に出すため、Cを2行で示します（Bは共通）。Cの満点は、ODPT・イチBizが各4項目で20点、UDCが3項目で15点、衛星が5項目で25点です。各アプリの B・C は1名の評価者による採点です。
          </p>
        </section>

        <section className="rounded-lg border bg-card p-3" aria-label="ポータルの評価">
          <h3 className="mb-1.5 text-sm font-bold">
            A ポータル（満点{A_MAX}）　第{LATEST.round}回の評価者4名
          </h3>
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
                  <th className="px-1 py-1 font-bold">計（前回・差）</th>
                </tr>
              </thead>
              <tbody>
                {LATEST.evaluators.map((e, k) => {
                  const p = PREVIOUS.evaluators[k]
                  return (
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
                      <td className="whitespace-nowrap px-1 py-1 tabular-nums">
                        <span className="font-bold">
                          {aTotal(e)}/{A_MAX}
                        </span>
                        （{aTotal(p)}・{deltaText(aTotal(e) - aTotal(p))}）
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            列は {A_ITEMS.join('／')}（各5点）。担当: {LATEST.evaluators.map((e) => `${e.n}＝${e.scope}`).join('、')}。第{LATEST.round}回は4名とも A5（情報設計・視覚階層）が3点で、AI評価の表示がコンペ情報を押し下げているという指摘でした。この表示の集約はその対応です。
          </p>
        </section>
      </div>

      <section className="space-y-2" aria-label="アプリごとの内訳">
        <h3 className="text-sm font-bold">アプリごとの内訳・優先度「高」の提案・不具合（第{LATEST.round}回。開くと第{PREVIOUS.round}回も見られます）</h3>
        {LATEST.apps.map((ev) => (
          <AppDetail key={ev.appId} ev={ev} />
        ))}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-3" aria-label="ポータルへの指摘">
          <h3 className="mb-1.5 flex items-center gap-1 text-sm font-bold">
            <Flag className="size-4" aria-hidden />
            ポータルへの指摘（第{LATEST.round}回）
          </h3>
          <FindingList list={LATEST.findings} />
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer font-medium">第{PREVIOUS.round}回（改修前の画面）の指摘。アプリから戻ったときの戻り先タブは、第{LATEST.round}回で元のタブに戻ることを確認（評価者1・3・4）</summary>
            <div className="mt-1">
              <FindingList list={PREVIOUS.findings} />
            </div>
          </details>
        </section>

        <section className="rounded-lg border border-dashed bg-card p-3" aria-label="評価で確認できなかった範囲">
          <h3 className="mb-1.5 flex items-center gap-1 text-sm font-bold">
            <CircleHelp className="size-4 text-violet-800" aria-hidden />
            評価で確認できなかった範囲（第{LATEST.round}回）
          </h3>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {LATEST.unverified.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer font-medium">評価者ごとの未検証の範囲（第{LATEST.round}回）</summary>
            <ul className="mt-1 space-y-1">
              {LATEST.evaluators.map((e) => (
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
          <details className="mt-1.5 text-xs">
            <summary className="cursor-pointer font-medium">第{PREVIOUS.round}回の未検証の範囲</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {PREVIOUS.unverified.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        </section>
      </div>
    </div>
  )
}

function FindingList({ list }: { list: typeof LATEST.findings }) {
  return (
    <ul className="space-y-1 text-xs">
      {list.map((f) => (
        <li key={f.text} className="flex gap-1.5">
          <span className="mt-px shrink-0 self-start whitespace-nowrap rounded border px-1 font-bold">
            {f.priority === '食い違い' ? f.priority : `優先度${f.priority}`}
          </span>
          <span>
            {f.text}
            <span className="text-muted-foreground">（評価者{f.by.join('・')}）</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
