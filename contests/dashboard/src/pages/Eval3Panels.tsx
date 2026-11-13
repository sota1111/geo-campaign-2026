import { useEffect, useId, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { B_ITEMS, A_ITEMS } from '@/apps/eval-results'
import { C_LABELS, EVAL3, cKeysOf, compareGroups, goalText, statText, type Eval3Data, type Stat } from '@/apps/eval3'
import type { AppMeta, ContestId } from '@/apps/registry'
import { labelPos, polar, polygonPoints, ringPoints } from '@/lib/radar'

/** 系列の見分け: 色＋線種＋マーカー形（色だけに頼らない） */
export const SERIES_STYLES = [
  { color: '#0f172a', dash: undefined, marker: 'circle' },
  { color: '#b45309', dash: '7 3', marker: 'square' },
  { color: '#0369a1', dash: '2 3', marker: 'triangle' },
  { color: '#7e22ce', dash: '9 3 2 3', marker: 'diamond' },
  { color: '#be123c', dash: '4 2', marker: 'cross' },
  { color: '#15803d', dash: '12 3', marker: 'plus' },
] as const
type Style = (typeof SERIES_STYLES)[number]

export interface Series {
  key: string
  label: string
  values: (number | null)[]
  style: Style
}

function Marker({ x, y, style, size = 4.5 }: { x: number; y: number; style: Style; size?: number }) {
  const common = { fill: style.color, stroke: '#fff', strokeWidth: 1 }
  const s = size
  switch (style.marker) {
    case 'circle':
      return <circle cx={x} cy={y} r={s} {...common} />
    case 'square':
      return <rect x={x - s} y={y - s} width={s * 2} height={s * 2} {...common} />
    case 'triangle':
      return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y + s} ${x - s - 1},${y + s}`} {...common} />
    case 'diamond':
      return <polygon points={`${x},${y - s - 1} ${x + s + 1},${y} ${x},${y + s + 1} ${x - s - 1},${y}`} {...common} />
    case 'cross':
      return <path d={`M${x - s},${y - s}L${x + s},${y + s}M${x + s},${y - s}L${x - s},${y + s}`} stroke={style.color} strokeWidth={2.4} fill="none" />
    default:
      return <path d={`M${x - s},${y}L${x + s},${y}M${x},${y - s}L${x},${y + s}`} stroke={style.color} strokeWidth={2.4} fill="none" />
  }
}

export function LegendMark({ style }: { style: Style }) {
  return (
    <svg width="34" height="14" viewBox="0 0 34 14" aria-hidden className="shrink-0">
      <line x1="1" y1="7" x2="33" y2="7" stroke={style.color} strokeWidth="2" strokeDasharray={style.dash} />
      <Marker x={17} y={7} style={style} size={3.5} />
    </svg>
  )
}

const W = 340
const H = 290
const CX = W / 2
const CY = 145
const R = 100

/** レーダー本体。axisLabels は軸の短い名前（B1 など）。band は最小〜最大の幅（ポータル A 用） */
export function Radar({ title, axisLabels, series, band, max = 5 }: {
  title: string
  axisLabels: string[]
  series: Series[]
  band?: { min: (number | null)[]; max: (number | null)[] }
  max?: number
}) {
  const n = axisLabels.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="mx-auto h-auto w-full max-w-[22rem]" data-testid="radar">
      <title>{title}</title>
      {Array.from({ length: max }, (_, k) => k + 1).map((lv) => (
        <polygon key={lv} points={ringPoints(n, lv, max, CX, CY, R)} fill="none" stroke="#cbd5e1" strokeWidth={lv === max ? 1.4 : 0.8} />
      ))}
      {axisLabels.map((_, i) => {
        const p = polar(i, n, max, max, CX, CY, R)
        return <line key={i} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#cbd5e1" strokeWidth="0.8" />
      })}
      {[1, 3, 5].map((lv) => {
        const p = polar(0, n, lv, max, CX, CY, R)
        return (
          <text key={lv} x={p.x + 3} y={p.y + 3} fontSize="9" fill="#475569">
            {lv}
          </text>
        )
      })}
      {band && (
        <>
          <polygon points={polygonPoints(band.max, max, CX, CY, R)} fill="#0f172a" fillOpacity="0.06" stroke="#475569" strokeWidth="1" strokeDasharray="1.5 3" data-testid="radar-max" />
          <polygon points={polygonPoints(band.min, max, CX, CY, R)} fill="#fff" fillOpacity="0.7" stroke="#475569" strokeWidth="1" strokeDasharray="4 3" data-testid="radar-min" />
        </>
      )}
      {series.map((s) => (
        <polygon
          key={s.key}
          points={polygonPoints(s.values, max, CX, CY, R)}
          fill={s.style.color}
          fillOpacity={band ? 0.1 : 0.07}
          stroke={s.style.color}
          strokeWidth="2"
          strokeDasharray={s.style.dash}
          strokeLinejoin="round"
          data-testid={`radar-series-${s.key}`}
        />
      ))}
      {series.map((s) =>
        s.values.map((v, i) => {
          if (v == null) return null
          const p = polar(i, n, v, max, CX, CY, R)
          return <Marker key={`${s.key}-${i}`} x={p.x} y={p.y} style={s.style} />
        }),
      )}
      {axisLabels.map((l, i) => {
        const p = labelPos(i, n, CX, CY, R, 13)
        return (
          <text key={l} x={p.x} y={p.y + 4} textAnchor={p.anchor} fontSize="11" fontWeight="700" fill="#0f172a">
            {l}
          </text>
        )
      })}
    </svg>
  )
}

function Legend({ items }: { items: { key: string; label: string; style: Style }[] }) {
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="凡例" data-testid="radar-legend">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-1">
          <LegendMark style={s.style} />
          <span className="font-medium">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

const cell = 'px-1.5 py-1 align-top'

/** 表だけを閉じ込める横スクロール枠。はみ出すときは「横にスクロール」の案内を出す（キーボードでも動かせる） */
export function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOver(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="min-w-0 max-w-full">
      {over && (
        <p className="mb-0.5 text-[11px] font-bold text-slate-700" data-testid="scroll-hint">
          ← 表は横にスクロールできます →
        </p>
      )}
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        data-scroll-frame=""
        className={`max-w-full overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${over ? 'border border-slate-400' : ''}`}
      >
        {children}
      </div>
    </div>
  )
}

/** 同じ数値の表: 軸×系列、各セルは 平均（最小〜最大・評価者数） */
function ValueTable({ caption, axes, series, stats }: {
  caption: string
  axes: string[]
  series: { key: string; label: string; style: Style }[]
  stats: Record<string, (Stat | null | undefined)[]>
}) {
  return (
    <ScrollTable label={`${caption}（横にスクロールできる表）`}>
      <table className="w-full text-xs" style={{ minWidth: `${6.5 + 6.5 * series.length}rem` }} data-testid="radar-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left">
            <th className={`${cell} font-bold`} scope="col">項目</th>
            {series.map((s) => (
              <th key={s.key} className={`${cell} font-bold`} scope="col">
                <span className="inline-flex items-center gap-1">
                  <LegendMark style={s.style} />
                  {s.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {axes.map((a, i) => (
            <tr key={a} className="border-b last:border-0">
              <th scope="row" className={`${cell} min-w-[6.5rem] text-left font-medium`}>{a}</th>
              {series.map((s) => {
                const t = statText(stats[s.key]?.[i])
                return (
                  <td key={s.key} className={cell} data-cell={`${s.key}-${i}`}>
                    <span className="font-bold">{t.mean}</span>
                    <span className="block text-[11px] text-muted-foreground">{t.range}・{t.n}</span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  )
}

function Notice({ d, scope }: { d: Eval3Data; scope?: string }) {
  return (
    <div className="min-w-0 rounded-lg border-2 border-slate-700 bg-slate-50 p-2 text-[11px] leading-snug" role="note" data-testid="eval3-notice">
      <p className="flex items-center gap-1.5 text-xs font-bold">
        <Bot className="size-4 shrink-0" aria-hidden />
        AI（{d.model}）{d.evaluatorCount || 10}名による模擬評価で、実際の審査結果ではありません。
      </p>
      <p className="mt-1">
        評価日 {d.date}。出典: <code className="break-all">{d.source}</code>
        {scope && `（${scope}）`}。点は 0〜5 の整数、図は評価者の平均、人数は表の「名」。
      </p>
      {d.warnings.length > 0 && (
        <p className="mt-1 font-medium" data-testid="eval3-warnings">
          集計で形式の崩れた値を {d.warnings.length} 件除外しています（詳細は npm run eval3 の出力）。
        </p>
      )}
    </div>
  )
}

function Pending({ what }: { what: string }) {
  return (
    <p className="rounded-lg border-2 border-dashed border-slate-500 p-3 text-xs font-medium" data-testid="eval3-pending">
      第3回のAI評価（{EVAL3.model}）は評価中です。{what}は集計できしだい、ここにレーダーチャートで表示します。
    </p>
  )
}

/** 各コンペの詳細パネル内: 今の案と新しい案を重ねた B レーダーと、コンペの審査基準 C のレーダー */
export function ContestEval3({ contest, data = EVAL3 }: { contest: ContestId; data?: Eval3Data }) {
  const groups = compareGroups(contest)
  const all = groups.flat()
  const evaluated = all.filter((a) => data.apps[a.id])
  const [checked, setChecked] = useState<string[]>(() => groups[0].map((a) => a.id))
  const uid = useId()
  const styleOf = (id: string) => SERIES_STYLES[all.findIndex((a) => a.id === id) % SERIES_STYLES.length]
  const shown = all.filter((a) => checked.includes(a.id) && data.apps[a.id])
  const cKeys = cKeysOf(contest)
  const label = (a: AppMeta) => `${a.plan === 'new' ? '新' : '今'}: ${a.name}`

  const legend = shown.map((a) => ({ key: a.id, label: label(a), style: styleOf(a.id) }))
  const bSeries: Series[] = shown.map((a) => ({
    key: a.id, label: label(a), style: styleOf(a.id), values: data.apps[a.id].B.map((s) => s?.mean ?? null),
  }))
  const cSeries: Series[] = shown.map((a) => ({
    key: a.id, label: label(a), style: styleOf(a.id), values: cKeys.map((k) => data.apps[a.id].C[k]?.mean ?? null),
  }))
  const goalIds = [...new Set(shown.flatMap((a) => Object.keys(data.apps[a.id].goals)))].sort((x, y) =>
    x.localeCompare(y, 'en', { numeric: true }),
  )

  const setGroup = (ids: string[]) => setChecked(ids)
  const sameSet = (ids: string[]) => ids.length === checked.filter((c) => data.apps[c]).length && ids.every((id) => checked.includes(id))
  const evalIds = (g: AppMeta[]) => g.map((a) => a.id).filter((id) => data.apps[id])
  const presets = [
    ...groups.map((g) => ({
      key: g[0].id,
      ids: evalIds(g),
      text: g.length > 1 ? `${g[0].division.replace(/（.*$/, '')}の${g.length}案` : `${g[0].division.replace(/（.*$/, '')}のみ`,
    })),
    ...(groups.length > 1 ? [{ key: 'all', ids: evalIds(all), text: `全${all.length}案` }] : []),
  ].filter((p) => p.ids.length > 0)
  const boxes = (
    <div className="flex flex-col gap-y-0.5 sm:flex-row sm:flex-wrap sm:gap-x-4">
      {all.map((a) => {
        const has = !!data.apps[a.id]
        const id = `${uid}-${a.id}`
        return (
          <label key={a.id} htmlFor={id} className="flex min-h-8 min-w-0 items-center gap-1.5 text-xs">
            <input
              id={id}
              type="checkbox"
              className="size-4 shrink-0"
              disabled={!has}
              checked={checked.includes(a.id) && has}
              onChange={(e) => setChecked((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))}
            />
            <LegendMark style={styleOf(a.id)} />
            <span className="min-w-0">
              {label(a)}
              {has ? `（${data.apps[a.id].n}名）` : '（評価なし）'}
            </span>
          </label>
        )
      })}
    </div>
  )

  return (
    <section aria-label="AI評価（第3回）" className="min-w-0 space-y-2 rounded-lg border-2 border-slate-600 bg-card p-3" data-testid="eval3-contest">
      <h3 className="text-sm font-bold" tabIndex={-1} data-testid="eval3-heading">AI評価（第3回・{data.date.slice(5).replace('-', '/')}）今の案と新しい案の比較</h3>
      <Notice d={data} scope="数値は集計スクリプトの出力" />
      {!data.collected || evaluated.length === 0 ? (
        <Pending what="このコンペのアプリの比較" />
      ) : (
        <>
          <fieldset className="min-w-0 space-y-1">
            <legend className="text-xs font-bold">比べるアプリ</legend>
            {presets.length > 1 && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="部門ごとにまとめて選ぶ" data-testid="eval3-presets">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={sameSet(p.ids)}
                    onClick={() => setGroup(p.ids)}
                    data-testid={`eval3-preset-${p.key}`}
                    className={`min-h-8 rounded border-2 px-2 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-slate-800 ${sameSet(p.ids) ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-500 bg-card hover:bg-muted'}`}
                  >
                    {p.text}
                  </button>
                ))}
              </div>
            )}
            {all.length > 3 ? (
              <details className="min-w-0" data-testid="eval3-individual">
                <summary className="min-h-8 cursor-pointer py-1 text-xs font-medium underline underline-offset-2">個別に選ぶ（チェックで切り替え・{all.length}件）</summary>
                {boxes}
              </details>
            ) : (
              boxes
            )}
          </fieldset>
          {shown.length === 0 ? (
            <p className="text-xs font-medium">比べるアプリを1つ以上選んでください。</p>
          ) : (
            <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold">B 操作性・デザイン（B1〜B7、各5点）</h4>
                <Radar title="B 操作性・デザインのレーダーチャート" axisLabels={B_ITEMS.map((b) => b.slice(0, 2))} series={bSeries} />
                <Legend items={legend} />
                <ValueTable
                  caption="B 操作性・デザイン 平均（最小〜最大・評価者数）"
                  axes={B_ITEMS}
                  series={legend}
                  stats={Object.fromEntries(shown.map((a) => [a.id, data.apps[a.id].B]))}
                />
              </div>
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold">C コンペの審査基準（{cKeys.length}項目、各5点）</h4>
                <Radar title="C コンペの審査基準のレーダーチャート" axisLabels={cKeys.map((k) => k.replace('C-', ''))} series={cSeries} />
                <Legend items={legend} />
                <ValueTable
                  caption="C コンペの審査基準 平均（最小〜最大・評価者数）"
                  axes={cKeys.map((k) => `${k.replace('C-', '')} ${C_LABELS[k]}`)}
                  series={legend}
                  stats={Object.fromEntries(shown.map((a) => [a.id, cKeys.map((k) => data.apps[a.id].C[k])]))}
                />
              </div>
            </div>
          )}
          {shown.length > 0 && goalIds.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-bold">目標の達成数（画面から自力で答えを得た評価者の数／評価者数）</h4>
              <ScrollTable label="目標の達成数（横にスクロールできる表）">
                <table className="w-full text-xs" style={{ minWidth: `${6 + 6.5 * legend.length}rem` }} data-testid="goal-table">
                  <thead>
                    <tr className="border-b text-left">
                      <th className={`${cell} font-bold`} scope="col">目標</th>
                      {legend.map((s) => (
                        <th key={s.key} className={`${cell} font-bold`} scope="col">
                          <span className="inline-flex items-center gap-1">
                            <LegendMark style={s.style} />
                            {s.label}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {goalIds.map((g) => (
                      <tr key={g} className="border-b last:border-0">
                        <th scope="row" className={`${cell} text-left font-medium`}>{g}</th>
                        {shown.map((a) => (
                          <td key={a.id} className={cell} data-cell={`goal-${a.id}-${g}`}>
                            {goalText(data.apps[a.id].goals[g])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollTable>
              <p className="text-[11px] text-muted-foreground">目標の内容は reports/ops/dashboard-goals-20261111.md と 20261113.md。達成の判定は評価者の自己申告で、画面の事実との照合はこれから。</p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** 既存の評価まとめ内: ポータル A1〜A5 のレーダー（平均＋最小〜最大の幅） */
export function PortalEval3({ data = EVAL3 }: { data?: Eval3Data }) {
  const p = data.portal
  const style = SERIES_STYLES[0]
  return (
    <section aria-label="ポータルのAI評価（第3回）" className="min-w-0 space-y-2 rounded-lg border-2 border-slate-600 bg-card p-3" data-testid="eval3-portal">
      <h3 className="text-sm font-bold">ポータル A1〜A5 のAI評価（第3回・{data.date}）</h3>
      <Notice d={data} scope="ポータルは全評価者が採点" />
      {!data.collected || !p ? (
        <Pending what="ポータルの評価" />
      ) : (
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-1.5">
            <Radar
              title="ポータル A1〜A5 のレーダーチャート（平均と最小〜最大の幅）"
              axisLabels={A_ITEMS.map((a) => a.slice(0, 2))}
              series={[{ key: 'portal', label: '平均', style, values: p.A.map((s) => s?.mean ?? null) }]}
              band={{ min: p.A.map((s) => s?.min ?? null), max: p.A.map((s) => s?.max ?? null) }}
            />
            <ul className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="凡例" data-testid="radar-legend">
              <li className="flex items-center gap-1">
                <LegendMark style={style} />
                <span className="font-medium">平均（実線・丸）</span>
              </li>
              <li className="flex items-center gap-1">
                <svg width="34" height="14" aria-hidden><line x1="1" y1="7" x2="33" y2="7" stroke="#475569" strokeWidth="1.5" strokeDasharray="1.5 3" /></svg>
                <span className="font-medium">最大（点線）</span>
              </li>
              <li className="flex items-center gap-1">
                <svg width="34" height="14" aria-hidden><line x1="1" y1="7" x2="33" y2="7" stroke="#475569" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                <span className="font-medium">最小（破線）</span>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <ValueTable
              caption="ポータル A 平均（最小〜最大・評価者数）"
              axes={A_ITEMS}
              series={[{ key: 'portal', label: '平均（最小〜最大・名）', style }]}
              stats={{ portal: p.A }}
            />
            {Object.keys(p.goals).length > 0 && (
              <table className="w-full text-xs" data-testid="portal-goal-table">
                <caption className="sr-only">ポータルの目標の達成数</caption>
                <thead>
                  <tr className="border-b text-left">
                    <th className={`${cell} font-bold`} scope="col">目標</th>
                    <th className={`${cell} font-bold`} scope="col">達成数</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(p.goals).map(([g, t]) => (
                    <tr key={g} className="border-b last:border-0">
                      <th scope="row" className={`${cell} text-left font-medium`}>{g}</th>
                      <td className={cell} data-cell={`portal-goal-${g}`}>{goalText(t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
