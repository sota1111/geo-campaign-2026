import { useMemo, useState } from 'react'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { DEFAULT_WEIGHTS, clone, rank, type Dataset } from './lib'

const NATIVE_SELECT =
  'h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
const CHANGES = ['新設', '拡大', '変位', '植生消失'] as const
const FLOW = ['衛星が前回との変化を検出', '変化の種類を点数に足す', '巡視候補の上位が入れ替わる', '職員が現地で確認（違反の判断は職員）']

/**
 * 主手順3: 衛星由来の変化量が点数に入ると、巡視の優先順位がどう決まり直るかを、架空の12地点で体験する。
 * 実データ（横須賀市の716か所）には触れない。変化の種類・検出日・配点はすべて架空・仮置き。
 * 実データ版は衛星由来の変化量が未接続（公開の衛星解析を地点ごとに取り込めていない。検討結果は出典ダイアログに記載）。
 * 配点 0% ＝ 実データ版の今の状態（衛星由来の変化量が未接続）と同じ作り。
 */
/** 架空の12地点の順位。pct＝衛星由来の変化量の配点（0〜100%）。0 は衛星なし
 *  （変化の種類・検出日からの経過・季節変動の判定は、いずれも衛星の解析結果なので、衛星なしでは 0 にする） */
export function satRank(fictional: Dataset, pct: number) {
  const w = clone(DEFAULT_WEIGHTS)
  for (const k of Object.keys(w.change)) w.change[k] = Math.round((w.change[k] * pct) / 100)
  w.ageMax = Math.round((w.ageMax * pct) / 100)
  w.seasonalPenalty = Math.round((w.seasonalPenalty * pct) / 100)
  return rank(fictional.sites, w, fictional.refDate, [], 'sample')
}

export function SatContrast({ fictional, pct: pctV, setPct, onTouched }: {
  fictional: Dataset; pct: number; setPct: (v: number) => void; onTouched: () => void
}) {
  const [only, setOnly] = useState('all')
  const [byDate, setByDate] = useState(false)
  const base = useMemo(() => satRank(fictional, 0), [fictional])
  const withSat = useMemo(() => satRank(fictional, pctV), [fictional, pctV])
  // 上位5が初めて入れ替わる配点（この架空データの場合）
  const firstSwap = useMemo(() => {
    const ids = new Set(base.slice(0, 5).map((s) => s.id))
    return [25, 50, 75, 100].find((p) => satRank(fictional, p).slice(0, 5).some((s) => !ids.has(s.id))) ?? null
  }, [fictional, base])
  const baseRank = new Map(base.map((s) => [s.id, s]))
  const moved = withSat.filter((s) => baseRank.get(s.id)?.rank !== s.rank).length
  const top5Base = base.slice(0, 5)
  const top5Sat = withSat.slice(0, 5)
  const top5BaseIds = new Set(top5Base.map((s) => s.id))
  const top5SatIds = new Set(top5Sat.map((s) => s.id))
  const top5Changed = top5Sat.filter((s) => !top5BaseIds.has(s.id)).length
  const rows = withSat
    .filter((s) => only === 'all' || s.change === only)
    .sort((a, b) => (byDate ? (b.detected ?? '').localeCompare(a.detected ?? '') : 0))

  return (
    <div className="space-y-3 rounded-md border-2 border-dashed border-amber-500 bg-amber-50/40 p-2.5 text-sm" data-testid="sat-contrast">
      <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="衛星の変化が巡視の優先順位を決める流れ">
        {FLOW.map((t, i) => (
          <li key={t} className="flex items-center gap-1">
            <span className="rounded-full border border-amber-600 bg-background px-2 py-0.5">{i + 1} {t}</span>
            {i < FLOW.length - 1 && <ArrowRight className="size-3 text-muted-foreground" aria-hidden />}
          </li>
        ))}
      </ol>
      <Alert className="border-amber-500 bg-amber-100">
        <FlaskConical className="size-4" />
        <AlertTitle className="flex flex-wrap items-center gap-2">
          架空の12地点です
          <Badge variant="outline" className="border-dashed border-amber-600 bg-background text-amber-900">◇架空値</Badge>
        </AlertTitle>
        <AlertDescription className="text-xs text-amber-950">
          <p>
            右の図と下の表は、地点・変化の種類・検出日・配点がすべて架空・仮置きの12地点で、実際の衛星解析の結果でも、横須賀市の実データでもありません。
            実データ版は衛星由来の変化量が未接続のため、「衛星の変化が点数に入ると、巡視の優先順位が決まり直る」流れだけをここで体験します。
            「衛星なし」は地形・許可届出・区域だけの点数、「衛星あり」はそこへ衛星が出す変化の種類・検出日・季節変動の判定を加えた点数です。
          </p>
        </AlertDescription>
      </Alert>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium" id="sat-contrast-label">衛星由来の変化量の配点（架空）を動かす</label>
          <span className="text-lg font-bold" data-testid="sat-contrast-out">{pctV}%</span>
        </div>
        <Slider
          value={[pctV]} min={0} max={100} step={25} aria-labelledby="sat-contrast-label"
          onValueChange={([v]) => { setPct(v); if (v > 0) onTouched() }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0% 未接続と同じ（実データ版の今）</span>
          <span>100% 仮置きの配点どおり</span>
        </div>
      </div>
      <p className="text-xs" aria-live="polite" data-testid="sat-contrast-summary">
        {pctV === 0
          ? `変化量を点数に入れていない状態です。スライダーを右へ動かすと、順位が決まり直ります${firstSwap ? `（上位5の入れ替わりは ${firstSwap}% から）` : ''}。`
          : `順位が変わった地点は ${moved} か所、上位5か所に新しく入った地点は ${top5Changed} か所です（架空値）。`}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs" data-testid="sat-contrast-top5">
        {([['衛星なし（今月の候補 上位5）', top5Base, false], ['衛星あり（今月の候補 上位5）', top5Sat, true]] as const).map(([label, list, sat]) => (
          <div key={label} className="rounded-md border bg-background p-1.5">
            <div className="mb-0.5 font-medium">{label}</div>
            <ol className="space-y-0.5">
              {list.map((s) => {
                const isNew = sat && !top5BaseIds.has(s.id)
                const dropped = !sat && pctV > 0 && !top5SatIds.has(s.id)
                return (
                  <li key={s.id} className={cn(isNew && 'font-semibold', dropped && 'text-muted-foreground')}>
                    {s.name}<span className="text-muted-foreground">（{s.change}）</span>
                    {isNew && <span className="ml-1 text-amber-800">▲衛星で上位に</span>}
                    {dropped && <span className="ml-1">▽外れる</span>}
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <label className="flex items-center gap-1" htmlFor="sat-contrast-only">衛星が検出した変化で絞る
          <select id="sat-contrast-only" value={only} onChange={(e) => setOnly(e.target.value)} className={NATIVE_SELECT}>
            <option value="all">すべて</option>
            {CHANGES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1" htmlFor="sat-contrast-sort">並び順
          <select id="sat-contrast-sort" value={byDate ? 'date' : 'score'} onChange={(e) => setByDate(e.target.value === 'date')} className={NATIVE_SELECT}>
            <option value="score">点数の高い順</option>
            <option value="date">衛星の検出が新しい順</option>
          </select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-md border bg-background [&_td]:px-1.5 [&_th]:px-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>順位<div className="text-[10px] font-normal text-muted-foreground">衛星なし→今</div></TableHead>
              <TableHead>架空の地点（衛星が検出した変化）</TableHead>
              <TableHead className="text-right">点数<div className="text-[10px] font-normal text-muted-foreground">衛星なし→今</div></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const b = baseRank.get(s.id)!
              const d = b.rank - s.rank
              return (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {b.rank}位 → <b>{s.rank}位</b>{' '}
                    <span className="text-muted-foreground">{d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : '→'}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">{s.name}<span className="text-muted-foreground">（{s.change}・架空）</span><div className="text-[10px] text-muted-foreground">検出日 {s.detected}（架空）</div></TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs">{b.score} → <b>{s.score}</b></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        実運用では、光学衛星の時系列で裸地化や造成を、SAR衛星で曇天・降雨期の変化を捉え、「どこを先に見るか」の点数に加える想定です（提案書B）。
        違反の判断は職員が現地で行います。
      </p>
    </div>
  )
}
