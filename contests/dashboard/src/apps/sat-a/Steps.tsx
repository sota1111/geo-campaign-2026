import { Radar, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  aucAt, totalKm, type Calibration, type CellSat, type Exclusion, type Scanned, type Scored, type Segment,
} from './logic'

const pct = (x: number) => Math.round(x * 100)
const fmt1 = (x: number) => x.toFixed(1)

export interface PrevInfo {
  rank: Record<string, number>
  topId: string
  round: number
  oldW: number
  newW: number
  newTopId: string
  changed: number
  calibrated: boolean
  scanned: number
}
export type CalibResult = Calibration & { ex0: Exclusion | null; ex1: Exclusion | null; pastCount: number }

function Metric({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function WeightSlider({ w, setW }: { w: number; setW: (v: number) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium" id="w-label">衛星指標の重み</label>
        <span className="text-lg font-bold" data-testid="w-out">{pct(w)}%</span>
      </div>
      <Slider value={[pct(w)]} min={0} max={100} step={10} aria-labelledby="w-label" onValueChange={([v]) => setW(v / 100)} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0% 台帳（管の古さ）だけ</span>
        <span>100% 衛星指標だけ</span>
      </div>
    </div>
  )
}

/** 順位表。showPrev で前回順位と変動を出す */
function RankTable({
  rows, focus, onFocus, prev,
}: { rows: Scored[]; focus: string | null; onFocus: (id: string) => void; prev?: PrevInfo | null }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">順位</TableHead>
          <TableHead>区間</TableHead>
          <TableHead>区画</TableHead>
          <TableHead className="text-right">布設年</TableHead>
          <TableHead className="text-right">点数</TableHead>
          {prev && <TableHead className="text-right">前回</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s, i) => {
          const p = prev?.rank[s.id]
          const d = p ? p - (i + 1) : 0
          return (
            <TableRow
              key={s.id}
              tabIndex={0}
              data-testid="rank-row"
              data-state={focus === s.id ? 'selected' : undefined}
              className="cursor-pointer"
              onClick={() => onFocus(s.id)}
              onKeyDown={(e) => e.key === 'Enter' && onFocus(s.id)}
            >
              <TableCell className="font-medium">{i + 1}</TableCell>
              <TableCell>{s.id}</TableCell>
              <TableCell>{s.cell}</TableCell>
              <TableCell className="text-right">{s.year}</TableCell>
              <TableCell className="text-right font-medium">{s.score.toFixed(2)}</TableCell>
              {prev && (
                <TableCell className="text-right text-xs">{p ? `${p}位 ${d > 0 ? `▲${d}` : d < 0 ? `▽${-d}` : '＝'}` : '—'}</TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/* ---------- 1 候補区間の点数を見る ---------- */
export function TopPanel({
  candidates, focus, onFocus,
}: { candidates: Scored[]; focus: string | null; onFocus: (id: string) => void }) {
  const km = candidates.reduce((a, s) => a + s.lenM, 0) / 1000
  const best = candidates[0]
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        点数 ＝ 衛星の指標と、下水道台帳の布設年の古さの重み付き和。衛星は空洞を直接見つけず、調べる順番を決める入口です。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="未調査の生活道路" value={`${candidates.length} 区間`} sub={`合計 ${fmt1(km)} km`} testId="m-count" />
        <Metric
          label="点数が最も高い区間"
          value={best ? best.id : '—'}
          sub={best ? `点数 ${best.score.toFixed(2)}／区画 ${best.cell}／布設 ${best.year}年` : ''}
          testId="m-top"
        />
      </div>
      <div className="text-sm font-medium">点数の高い順 上位10区間（行をタップすると地図に表示）</div>
      <RankTable rows={candidates.slice(0, 10)} focus={focus} onFocus={onFocus} />
    </div>
  )
}

/* ---------- 2 重みを変えてみる ---------- */
export function WeightPanel({ w, setW, candidates, focus, onFocus }: {
  w: number; setW: (v: number) => void; candidates: Scored[]; focus: string | null; onFocus: (id: string) => void
}) {
  return (
    <div className="space-y-3">
      <WeightSlider w={w} setW={setW} />
      <p className="text-xs text-muted-foreground">動かすと、順位と地図の道路の色が変わります。第3段階の較正で、調査結果に合わせて自動的に更新されます。</p>
      <div className="text-sm font-medium">上位5区間（重みに応じて入れ替わります）</div>
      <RankTable rows={candidates.slice(0, 5)} focus={focus} onFocus={onFocus} />
    </div>
  )
}

/* ---------- 3 予算内で調査対象を選ぶ ---------- */
export function PickPanel({
  budgetKm, setBudgetKm, segs, candidates, selected, toggle, focus, onFocus, onAuto, onClear,
}: {
  budgetKm: number
  setBudgetKm: (v: number) => void
  segs: Segment[]
  candidates: Scored[]
  selected: Set<string>
  toggle: (id: string) => void
  focus: string | null
  onFocus: (id: string) => void
  onAuto: () => void
  onClear: () => void
}) {
  const km = totalKm(segs, selected)
  const over = km > budgetKm + 1e-9
  const rows = candidates.filter((s, i) => i < 15 || selected.has(s.id))
  const top15 = new Set(candidates.slice(0, 15).map((s) => s.id))
  const inTop = [...selected].filter((id) => top15.has(id)).length
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium" id="bud-label">走らせられる延長（予算＝走行延長に換算した仮の値）</label>
          <span className="shrink-0 text-lg font-bold" data-testid="bud-out">{fmt1(budgetKm)} km</span>
        </div>
        <Slider value={[budgetKm]} min={1} max={8} step={0.5} aria-labelledby="bud-label" onValueChange={([v]) => setBudgetKm(v)} />
        <p className="text-xs text-muted-foreground">
          調査費や車両台数の制約を、地中レーダ車が走れる道のり（km）に置き換えています。金額への換算はしていません。仮の値で、実際の調査能力を表すものではありません。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onAuto} data-testid="auto"><Wand2 />点数の上位から自動で選ぶ</Button>
        <Button size="sm" variant="outline" onClick={onClear} data-testid="clear">選択をクリア</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        延長の上限（{fmt1(budgetKm)}km）に収まるまで、点数の高い順に選びます。表の上位15区間に入らない区間も含まれます。地図の道路をタップしても選択／解除できます。
      </p>

      <div className="space-y-1" aria-live="polite">
        <div className="flex items-baseline justify-between text-sm">
          <span>選択中 <b className="text-lg" data-testid="sel-count">{selected.size}</b> 区間</span>
          <span className={cn('font-medium', over && 'text-[#b45309]')} data-testid="sel-km">{fmt1(km)} / {fmt1(budgetKm)} km</span>
        </div>
        <Progress value={Math.min(100, (km / budgetKm) * 100)} className={over ? '[&>div]:bg-[#b45309]' : ''} />
        {selected.size > 0 && (
          <div className="text-xs text-muted-foreground" data-testid="sel-breakdown">
            上位15区間のうち {inTop} 区間＋それ以外 {selected.size - inTop} 区間を選びました。
          </div>
        )}
        {over && <div className="text-sm font-medium text-[#b45309]">▲ 上限を超えています。区間を外すか、延長を増やしてください。</div>}
      </div>

      <div className="text-sm font-medium">候補 {rows.length} 区間（点数の高い順）</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">選択</TableHead>
            <TableHead>区間</TableHead>
            <TableHead className="text-right">点数</TableHead>
            <TableHead className="text-right">延長</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow
              key={s.id}
              data-state={selected.has(s.id) ? 'selected' : undefined}
              className={cn(focus === s.id && 'outline outline-1 -outline-offset-1 outline-neutral-500')}
              onClick={() => onFocus(s.id)}
            >
              <TableCell>
                <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} aria-label={`区間 ${s.id} を選ぶ`} />
              </TableCell>
              <TableCell>{s.id}</TableCell>
              <TableCell className="text-right font-medium">{s.score.toFixed(2)}</TableCell>
              <TableCell className="text-right">{s.lenM} m</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ---------- 4 走査結果を見る ---------- */
export function ScanPanel({
  segs, ranked, selected, revealed, lastBatch, results, onScan,
}: {
  segs: Segment[]
  ranked: Scored[]
  selected: Set<string>
  revealed: boolean
  lastBatch: string[]
  results: Map<string, boolean>
  onScan: () => void
}) {
  const km = totalKm(segs, selected)
  const batch = lastBatch.map((id) => ({ id, hit: results.get(id) === true, score: ranked.find((s) => s.id === id)?.score ?? 0 }))
  const hit = batch.filter((b) => b.hit).length
  if (!revealed) {
    return (
      <div className="space-y-3">
        {results.size > 0 ? (
          <Alert><AlertDescription>走査結果は反映済みです。再び走査するには、第2回で調査対象を選び直してください。</AlertDescription></Alert>
        ) : (
          <p className="text-sm">
            選んだ <b data-testid="s3-count">{selected.size}</b> 区間（{fmt1(km)} km）を地中レーダで走査した、と想定して結果を表示します。
          </p>
        )}
        <p className="text-xs text-muted-foreground">結果は乱数で作ったシミュレーションで、実際の走査結果ではありません。</p>
        {selected.size === 0 && results.size === 0 && (
          <Alert><AlertDescription>走査する区間がありません。「予算内で調査対象を選ぶ」の手順で区間を選んでください。</AlertDescription></Alert>
        )}
        <Button size="sm" onClick={onScan} disabled={selected.size === 0} data-testid="scan"><Radar />走査結果を見る（サンプル）</Button>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Metric label="走査した区間" value={`${batch.length}`} />
        <Metric label="▲ 空洞の疑い" value={`${hit}`} testId="s3-hit" />
        <Metric label="○ 異常なし" value={`${batch.length - hit}`} />
      </div>
      <p className="text-xs text-muted-foreground">
        疑いありの区間は管内カメラ調査等の追加確認に回す想定です（このデモでは扱いません）。地図にも結果の印を出しています。
      </p>
      <Table>
        <TableHeader>
          <TableRow><TableHead>区間</TableHead><TableHead className="text-right">点数</TableHead><TableHead>結果（サンプル）</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {batch.map((b) => (
            <TableRow key={b.id}>
              <TableCell>{b.id}</TableCell>
              <TableCell className="text-right">{b.score.toFixed(2)}</TableCell>
              <TableCell>
                {b.hit ? <Badge className="bg-[#d55e00] text-white">▲ 疑い</Badge> : <Badge variant="outline" className="border-[#0072b2] text-[#0072b2]">○ なし</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ---------- 5 較正を反映して第2回へ ---------- */
export function ApplyPanel({
  round, revealed, calib, surveyed, cellSat, resultsCount, applied, onApply,
}: {
  round: number
  revealed: boolean
  calib: CalibResult | null
  surveyed: Scanned[]
  cellSat: CellSat
  resultsCount: number
  applied: PrevInfo | null
  onApply: () => void
}) {
  if (!revealed) {
    return (
      <div className="space-y-3">
        {applied ? (
          <Alert className="border-primary/40 bg-primary/5">
            <AlertTitle>第{round}回に反映済みです</AlertTitle>
            <AlertDescription className="text-foreground">
              衛星指標の重みは {pct(applied.oldW)}% → {pct(applied.newW)}%。結果は「第2回の順位を確かめる」の手順で見られます。
            </AlertDescription>
          </Alert>
        ) : (
          <Alert><AlertDescription>較正には走査結果が必要です。「走査結果を見る」の手順で結果を出してください。</AlertDescription></Alert>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {calib && calib.w === null && (
        <Alert className="border-amber-500 bg-amber-50 text-amber-950">
          <AlertTitle>較正に使える結果が不足しています</AlertTitle>
          <AlertDescription className="text-amber-900">空洞あり {calib.pos} 件・なし {calib.neg} 件（各3件以上で較正）。重みは変えません。</AlertDescription>
        </Alert>
      )}
      {calib && calib.w !== null && (
        <>
          <p className="text-sm">
            これまでの調査結果（過去の調査 {calib.pastCount} 区間＋今回までの走査 {resultsCount} 区間。すべてサンプル）に照らして、重みを探しました。
          </p>
          <Table>
            <TableHeader>
              <TableRow><TableHead>点数のつけ方</TableHead><TableHead className="text-right">当たりやすさ(AUC)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow><TableCell>台帳のみ（衛星0%）</TableCell><TableCell className="text-right">{calib.ledgerOnly?.toFixed(2)}</TableCell></TableRow>
              <TableRow><TableCell>衛星のみ（100%）</TableCell><TableCell className="text-right">{calib.satOnly?.toFixed(2)}</TableCell></TableRow>
              <TableRow data-state="selected">
                <TableCell className="font-medium">採用: 衛星 {pct(calib.w)}%</TableCell>
                <TableCell className="text-right font-medium" data-testid="auc-adopted">{aucAt(surveyed, cellSat, calib.w)?.toFixed(2)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            AUC: 空洞のあった区間が、なかった区間より高い点数になる確率。0.5＝でたらめ（当てずっぽう）と同じ、1.0＝完全に当たる。数字が大きいほど、その重みで調べる順番が当たりやすいという意味です。
            {calib.ex1 && `点数が下位の半分とした区間（${calib.ex1.n}区間）のうち異常なしだった割合は ${pct(calib.ex1.rate)}%${calib.ex0 ? `（較正前の重みでは ${pct(calib.ex0.rate)}%）` : ''}。`}
            架空データ上の値で、実際の精度や提案の効果を示すものではありません。
          </p>
        </>
      )}
      <Button size="sm" onClick={onApply} data-testid="apply">較正を反映して第{round + 1}回へ進む</Button>
    </div>
  )
}

/* ---------- 6 第2回の順位を確かめる ---------- */
export function Round2Panel({
  round, msg, prev, candidates, focus, onFocus,
}: {
  round: number
  msg: string
  prev: PrevInfo | null
  candidates: Scored[]
  focus: string | null
  onFocus: (id: string) => void
}) {
  if (!prev || round < 2) {
    return <Alert><AlertDescription>第2回の順位はまだありません。「較正を反映して第2回へ進む」まで済ませると、ここに第1回との対比が出ます。</AlertDescription></Alert>
  }
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" data-testid="what-changed">
        {prev.calibrated
          ? prev.newW === prev.oldW
          ? `何が変わったか: 調査結果に照らしても重み（衛星${pct(prev.newW)}%）は変わらず、走査済み${prev.scanned}区間を除いた順位を作り直しました。`
          : `何が変わったか: 調査結果に照らして当たりやすい重み（衛星${pct(prev.newW)}%）に更新し、走査済み${prev.scanned}区間を除いた順位を作り直しました。`
          : `何が変わったか: 結果が不足していたため重みは据え置き、走査済み${prev.scanned}区間を除いた順位を作り直しました。`}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="calib-msg">{msg}</p>
      <Table>
        <TableHeader>
          <TableRow><TableHead>項目</TableHead><TableHead className="text-right">第{prev.round}回</TableHead><TableHead className="text-right">第{round}回</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow><TableCell>衛星指標の重み</TableCell><TableCell className="text-right">{pct(prev.oldW)}%</TableCell><TableCell className="text-right">{pct(prev.newW)}%</TableCell></TableRow>
          <TableRow>
            <TableCell>候補の1位</TableCell>
            <TableCell className="text-right">{prev.topId}</TableCell>
            <TableCell className="text-right">{prev.topId === prev.newTopId ? '変わらず' : prev.newTopId}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>上位10の入れ替わり</TableCell><TableCell className="text-right">—</TableCell>
            <TableCell className="text-right" data-testid="changed">{prev.changed} 区間</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div className="text-sm font-medium">第{round}回の順位 上位10区間（「前回」＝第{prev.round}回の順位）</div>
      <RankTable rows={candidates.slice(0, 10)} focus={focus} onFocus={onFocus} prev={prev} />
    </div>
  )
}
