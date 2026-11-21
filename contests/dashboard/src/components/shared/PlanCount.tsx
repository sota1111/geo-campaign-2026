import type { PlanState, PlanView } from '@/lib/fit'
import { planStateText } from '@/lib/fit'

/** 提出予定数（総司令官の決定）と、下書きで選んだ件数の比べ。記号と言葉で示す（色だけに頼らない）。要項の上限である「提出可能数」とは別 */
function Badge({ state, diff, short }: { state: PlanState; diff: number; short?: boolean }) {
  if (state === 'undecided') return null
  const { mark, word } = planStateText(state, diff)
  // 記号ではなく、言葉と枠で区別する（短い形は「あと1件」「予定どおり」「1件多い」）。▲✓ は別の意味に使うので使わない
  const tone = state === 'match' ? 'border-emerald-800 text-emerald-900' : state === 'short' ? 'border-dashed border-amber-800 text-amber-950' : 'border-red-800 text-red-900'
  return (
    <span className={`whitespace-nowrap rounded border px-1 font-bold ${tone}`} data-state={state}>
      <span aria-hidden>{mark}</span>
      {short ? word.replace('で予定', '').replace('予定より', '') : word}
    </span>
  )
}

function partsText(v: PlanView): string {
  return v.parts.length ? `（${v.parts.map((p) => `${p.label}${p.planned}`).join('・')}）` : ''
}

/** 「提出予定 2件（スポンサー1・一般1）／選んだ 1件 ▼あと1件で予定」。未定のコンペは「提出予定 未定／選んだ N件」 */
export function planSentence(v: PlanView): string {
  if (v.planned === null) return `提出予定 未定／選んだ ${v.chosen}件`
  const t = planStateText(v.state, v.diff)
  return `提出予定 ${v.planned}件${partsText(v)}／選んだ ${v.chosen}件 ${t.mark}${t.word}`
}

export function PlanLine({ view, contestId, hideParts }: { view: PlanView; contestId: string; hideParts?: boolean }) {
  const undecided = view.planned === null
  return (
    <p className="shrink-0" data-testid={`planned-${contestId}`} data-state={view.state} aria-live="polite" title={`${planSentence(view)}（${view.src}。要項の上限の「提出可能数」とは別）`}>
      <span className="font-bold">提出予定 {undecided ? '未定' : `${view.planned}件`}</span>
      {!undecided && !hideParts && <span>{partsText(view)}</span>}
      <span>／選んだ {view.chosen}件 </span>
      <Badge state={view.state} diff={view.diff} />
    </p>
  )
}

/** イチBiz の部門ごと: 「ビジネス 予定1・選んだ0 ▼あと1件」 */
export function PlanDivisions({ view, contestId, title }: { view: PlanView; contestId: string; title?: string }) {
  return (
    <p className="text-xs text-slate-800" data-testid="ichibiz-divisions" aria-label="部門ごとの提出予定と選んだ件数" title={title}>
      {view.parts.map((p, i) => (
        <span key={p.label} data-testid={`planned-part-${contestId}-${p.label}`} data-state={p.state}>
          {i > 0 && '／'}
          <span className="font-bold">{p.label}</span> 予定{p.planned}・<span className="whitespace-nowrap">選んだ{p.chosen ?? '？'}</span>{' '}
          <Badge state={p.state} diff={p.diff} short />
        </span>
      ))}
    </p>
  )
}
