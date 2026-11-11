import { ArrowLeft, ArrowRight, Radar, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
}

export type CalibResult = Calibration & { ex0: Exclusion | null; ex1: Exclusion | null; pastCount: number }

function Metric({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3" data-testid={testId}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

function StepIntro({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-base">
        <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{n}</span>
        {title}
      </CardTitle>
      <CardDescription>{children}</CardDescription>
    </CardHeader>
  )
}

/* ---------- 1 絞る ---------- */
export function Step1({
  round, w, setW, candidates, msg, prev, focus, onFocus, onNext, detail,
}: {
  round: number
  w: number
  setW: (v: number) => void
  candidates: Scored[]
  msg: string
  prev: PrevInfo | null
  focus: string | null
  onFocus: (id: string) => void
  onNext: () => void
  detail: React.ReactNode
}) {
  const km = candidates.reduce((a, s) => a + s.lenM, 0) / 1000
  const top = candidates.slice(0, 10)
  const best = candidates[0]
  const showPrev = prev !== null && round > 1
  return (
    <Card>
      <StepIntro n={1} title={`絞る：点数を付けて、先に確かめたい区間を知る（第${round}回）`}>
        区間の点数は「衛星の指標」と「下水道台帳の布設年の古さ」の重み付き和です。衛星は空洞を直接見つけず、調べる順番を決める入口です。
      </StepIntro>
      <CardContent className="space-y-4">
        {msg && prev && (
          <Alert className="border-primary/40 bg-primary/5" data-testid="calib-msg">
            <AlertTitle>第{prev.round}回 → 第{round}回：較正の反映結果</AlertTitle>
            <AlertDescription className="w-full space-y-2 text-foreground">
              <p>{msg}</p>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>項目</TableHead><TableHead className="text-right">第{prev.round}回</TableHead><TableHead className="text-right">第{round}回</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow><TableCell>衛星指標の重み</TableCell><TableCell className="text-right">{pct(prev.oldW)}%</TableCell><TableCell className="text-right">{pct(prev.newW)}%</TableCell></TableRow>
                  <TableRow><TableCell>候補の1位（走査済みを除く）</TableCell><TableCell className="text-right">{prev.topId}</TableCell><TableCell className="text-right">{prev.newTopId}</TableCell></TableRow>
                  <TableRow><TableCell>上位10区間で順位が入れ替わった数</TableCell><TableCell className="text-right">—</TableCell><TableCell className="text-right" data-testid="changed">{prev.changed} 区間</TableCell></TableRow>
                </TableBody>
              </Table>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Metric label="未調査の生活道路" value={`${candidates.length} 区間`} sub={`合計 ${fmt1(km)} km`} testId="m-count" />
          <Metric
            label="点数が最も高い区間（第1位）"
            value={best ? best.id : '—'}
            sub={best ? `点数 ${best.score.toFixed(2)}／区画 ${best.cell}／布設 ${best.year}年` : ''}
            testId="m-top"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium" id="w-label">衛星指標の重み</label>
            <span className="text-lg font-bold" data-testid="w-out">{pct(w)}%</span>
          </div>
          <Slider
            value={[pct(w)]}
            min={0}
            max={100}
            step={10}
            aria-labelledby="w-label"
            onValueChange={([v]) => setW(v / 100)}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0% 台帳（管の古さ）だけ</span>
            <span>100% 衛星指標だけ</span>
          </div>
          <p className="text-xs text-muted-foreground">動かすと下の表と地図の色が変わります。第3段階の較正で自動的に更新されます。</p>
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">点数の高い順（上位10区間。行をタップすると地図で位置と内訳を表示）</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">順位</TableHead>
                <TableHead>区間</TableHead>
                <TableHead>区画</TableHead>
                <TableHead className="text-right">布設年</TableHead>
                <TableHead className="text-right">点数</TableHead>
                {showPrev && <TableHead className="text-right">前回</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((s, i) => {
                const p = prev?.rank[s.id]
                const d = p ? p - (i + 1) : 0
                return (
                  <TableRow
                    key={s.id}
                    tabIndex={0}
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
                    {showPrev && (
                      <TableCell className="text-right text-xs">
                        {p ? `${p}位 ${d > 0 ? `▲${d}` : d < 0 ? `▽${-d}` : '＝'}` : '—'}
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        {detail && (
          <div>
            <div className="mb-1 text-sm font-medium">選んだ区間の内訳</div>
            {detail}
          </div>
        )}

        {round > 1 && (
          <p className="text-xs text-muted-foreground">第{round}回の順位ができました。続けて、この順位で地中レーダの対象をもう一度選べます。</p>
        )}
        <Button className="w-full" onClick={onNext} data-testid="to2">
          {round > 1 ? `第${round}回の候補で、もう一度選ぶ` : '次へ：確かめる区間を選ぶ'} <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  )
}

/* ---------- 2 選ぶ ---------- */
export function Step2({
  budgetKm, setBudgetKm, segs, candidates, selected, toggle, focus, onFocus, onAuto, onClear, onBack, onNext,
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
  onBack: () => void
  onNext: () => void
}) {
  const km = totalKm(segs, selected)
  const over = km > budgetKm + 1e-9
  const rows = candidates.filter((s, i) => i < 15 || selected.has(s.id))
  const canNext = selected.size > 0 && !over
  const top15 = new Set(candidates.slice(0, 15).map((s) => s.id))
  const inTop = [...selected].filter((id) => top15.has(id)).length
  return (
    <Card>
      <StepIntro n={2} title="選ぶ：地中レーダを走らせる区間を、予算（走行延長）内で決める">
        「点数の上位から自動で選ぶ」を押すか、表のチェック・地図の道路タップで手直しします。
      </StepIntro>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium" id="bud-label">走らせられる延長（予算＝走行延長に換算した仮の値）</label>
            <span className="text-lg font-bold" data-testid="bud-out">{fmt1(budgetKm)} km</span>
          </div>
          <Slider value={[budgetKm]} min={1} max={8} step={0.5} aria-labelledby="bud-label" onValueChange={([v]) => setBudgetKm(v)} />
          <p className="text-xs text-muted-foreground">考え方: 調査費や車両台数の制約を「地中レーダ車が走れる道のり（km）」に置き換えています。金額への換算はしていません。仮の値で、実際の調査能力を表すものではありません。</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={onAuto} data-testid="auto"><Wand2 />点数の上位から自動で選ぶ</Button>
          <Button variant="outline" onClick={onClear} data-testid="clear">選択をクリア</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          延長の上限（{fmt1(budgetKm)}km）に収まるまで、点数の高い順に選びます。表の上位15区間に入らない区間も含まれます。
        </p>

        <div className="space-y-1" aria-live="polite">
          <div className="flex items-baseline justify-between text-sm">
            <span>選択中 <b className="text-lg" data-testid="sel-count">{selected.size}</b> 区間</span>
            <span className={cn('font-medium', over && 'text-[#b45309]')} data-testid="sel-km">
              {fmt1(km)} / {fmt1(budgetKm)} km
            </span>
          </div>
          <Progress value={Math.min(100, (km / budgetKm) * 100)} className={over ? '[&>div]:bg-[#b45309]' : ''} />
          {selected.size > 0 && (
            <div className="text-xs text-muted-foreground" data-testid="sel-breakdown">
              上位15区間のうち {inTop} 区間＋それ以外 {selected.size - inTop} 区間を選びました。
            </div>
          )}
          {over && <div className="text-sm font-medium text-[#b45309]">▲ 上限を超えています。区間を外すか、延長を増やしてください。</div>}
        </div>

        <div>
          <div className="mb-1 text-sm font-medium">候補 {rows.length} 区間（点数の高い順の上位15区間{rows.length > 15 ? `＋それ以外で選択中の ${rows.length - 15} 区間` : ''}。うち選択中 {selected.size} 区間）</div>
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
                    <Checkbox
                      checked={selected.has(s.id)}
                      onCheckedChange={() => toggle(s.id)}
                      aria-label={`区間 ${s.id} を選ぶ`}
                    />
                  </TableCell>
                  <TableCell>{s.id}</TableCell>
                  <TableCell className="text-right font-medium">{s.score.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{s.lenM} m</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-1 text-xs text-muted-foreground">地図の道路をタップしても選択／解除できます（未調査の生活道路のみ。幹線と調査済みは対象外）。</p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack}><ArrowLeft />戻る</Button>
          <Button className="flex-1" onClick={onNext} disabled={!canNext} data-testid="to3">
            次へ：結果を戻す <ArrowRight />
          </Button>
        </div>
        {!canNext && (
          <p className="text-xs text-muted-foreground">
            {selected.size === 0 ? '先に区間を選ぶと、次へ進めます。' : '予算内に収めると、次へ進めます。'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/* ---------- 3 戻す ---------- */
export function Step3({
  round, segs, ranked, selected, revealed, lastBatch, results, calib, surveyed, cellSat, onScan, onBack, onApply,
}: {
  round: number
  segs: Segment[]
  ranked: Scored[]
  selected: Set<string>
  revealed: boolean
  lastBatch: string[]
  results: Map<string, boolean>
  calib: CalibResult | null
  surveyed: Scanned[]
  cellSat: CellSat
  onScan: () => void
  onBack: () => void
  onApply: () => void
}) {
  const km = totalKm(segs, selected)
  const batch = lastBatch.map((id) => ({ id, hit: results.get(id) === true, score: ranked.find((s) => s.id === id)?.score ?? 0 }))
  const hit = batch.filter((b) => b.hit).length
  return (
    <Card>
      <StepIntro n={3} title="戻す：走査結果を点数に戻して、較正する">
        調査の結果から、衛星と台帳のどちらの重みが「当たりやすい」かを探し、次の絞り込み（第{round + 1}回）に反映します。
      </StepIntro>
      <CardContent className="space-y-4">
        {!revealed ? (
          <>
            <p className="text-sm">
              選んだ <b data-testid="s3-count">{selected.size}</b> 区間（{fmt1(km)} km）を地中レーダで走査した、と想定して結果を表示します。
            </p>
            <p className="text-xs text-muted-foreground">結果は乱数で作ったシミュレーションで、実際の走査結果ではありません。</p>
            {selected.size === 0 && (
              <Alert><AlertDescription>まだ走査する区間がありません。「2 選ぶ」で区間を選んでください。</AlertDescription></Alert>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={onBack}><ArrowLeft />戻る</Button>
              <Button className="flex-1" onClick={onScan} disabled={selected.size === 0} data-testid="scan">
                <Radar />走査結果を見る（サンプル）
              </Button>
            </div>
          </>
        ) : (
          <>
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
                {batch.slice(0, 12).map((b) => (
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
            {batch.length > 12 && <p className="text-xs text-muted-foreground">ほか {batch.length - 12} 区間（地図に表示）</p>}

            {calib && calib.w === null && (
              <Alert className="border-amber-500 bg-amber-50 text-amber-950">
                <AlertTitle>較正に使える結果が不足しています</AlertTitle>
                <AlertDescription className="text-amber-900">
                  空洞あり {calib.pos} 件・なし {calib.neg} 件（各3件以上で較正）。重みは変えません。
                </AlertDescription>
              </Alert>
            )}
            {calib && calib.w !== null && (
              <div className="space-y-2">
                <p className="text-sm">
                  これまでの調査結果（過去の調査 {calib.pastCount} 区間＋今回までの走査 {results.size} 区間。すべてサンプル）に照らして、重みを探しました。
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
              </div>
            )}
            <Button className="w-full" onClick={onApply} data-testid="apply">
              較正を反映して第{round + 1}回へ <ArrowRight />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
