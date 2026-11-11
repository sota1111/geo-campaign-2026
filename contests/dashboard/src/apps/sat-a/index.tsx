import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { dataUrl } from '@/lib/data'
import { SatMap } from './SatMap'
import { Step1, Step2, Step3, type CalibResult } from './Steps'
import { About, SOURCES } from './About'
import {
  NOW_YEAR, ageNorm, calibrate, candidatesOf, exclusionAccuracy, rank, satNorm, selectByBudget,
  type SampleData, type Segment,
} from './logic'

type StepId = '1' | '2' | '3'
const pct = (x: number) => Math.round(x * 100)

export default function App() {
  const [data, setData] = useState<SampleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [segs, setSegs] = useState<Segment[]>([])
  const [step, setStep] = useState<StepId>('1')
  const [w, setW] = useState(0.5)
  const [budgetKm, setBudgetKm] = useState(3)
  const [round, setRound] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Map<string, boolean>>(new Map())
  const [lastBatch, setLastBatch] = useState<string[]>([])
  const [revealed, setRevealed] = useState(false)
  const [calib, setCalib] = useState<CalibResult | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [prev, setPrev] = useState<{ rank: Record<string, number>; topId: string; round: number } | null>(null)

  useEffect(() => {
    let alive = true
    fetch(dataUrl('sat-a', 'sample.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SampleData>
      })
      .then((d) => {
        if (!alive) return
        setData(d)
        setSegs(d.segments.map((s) => ({ ...s })))
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [])

  const cellSat = useMemo(() => Object.fromEntries((data?.cells ?? []).map((c) => [c.id, satNorm(c.disp)])), [data])
  const ranked = useMemo(() => rank(segs, cellSat, w), [segs, cellSat, w])
  const candidates = useMemo(() => candidatesOf(ranked), [ranked])
  const surveyedSet = () => segs.filter((s) => s.surveyed).map((s) => ({ ...s, hit: s.sim_cavity }))

  const toggle = (id: string) => {
    setSelected((cur) => {
      const n = new Set(cur)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const onSegmentClick = (id: string) => {
    setFocus(id)
    if (step !== '2') return
    const s = segs.find((x) => x.id === id)
    if (s && s.cls === 'life' && !s.surveyed) toggle(id)
  }

  const doScan = () => {
    const ids = [...selected]
    const nextResults = new Map(results)
    const nextSegs = segs.map((s) => {
      if (!selected.has(s.id)) return s
      nextResults.set(s.id, s.sim_cavity)
      return { ...s, surveyed: true }
    })
    const data3 = nextSegs.filter((s) => s.surveyed).map((s) => ({ ...s, hit: s.sim_cavity }))
    const c = calibrate(data3, cellSat)
    setCalib({
      ...c,
      ex0: exclusionAccuracy(data3, cellSat, w),
      ex1: c.w === null ? null : exclusionAccuracy(data3, cellSat, c.w),
      pastCount: data3.length - nextResults.size,
    })
    setResults(nextResults)
    setSegs(nextSegs)
    setLastBatch(ids)
    setSelected(new Set())
    setRevealed(true)
  }

  const applyCalib = () => {
    // 反映前の順位（走査済みを除いた候補の順位）を記録して、第2回との比較に使う
    const before = candidatesOf(rank(segs, cellSat, w))
    const rankMap: Record<string, number> = {}
    before.forEach((s, i) => (rankMap[s.id] = i + 1))
    const newW = calib && calib.w !== null ? calib.w : w
    const after = candidatesOf(rank(segs, cellSat, newW))
    setPrev({ rank: rankMap, topId: before[0]?.id ?? '', round })
    if (calib && calib.w !== null) {
      const changed = after.slice(0, 10).filter((s, i) => before[i]?.id !== s.id).length
      setMsg(
        `較正済み: 衛星指標の重みを ${pct(w)}% から ${pct(newW)}% に更新しました。走査した区間を除く候補の1位は ${before[0]?.id} → ${after[0]?.id}、上位10区間のうち ${changed} 区間で順位が入れ替わっています（表の「前回」列）。`,
      )
    } else {
      setMsg('較正に使える結果が不足していたため、重みは変えていません（走査済みの区間が候補から外れた分だけ順位が繰り上がります）。')
    }
    setW(newW)
    setRound(round + 1)
    setRevealed(false)
    setCalib(null)
    setLastBatch([])
    setStep('1')
  }

  const autoSelect = () => setSelected(new Set(selectByBudget(ranked, budgetKm)))

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader appId="sat-a" />
        <Alert><AlertTriangle /><AlertTitle>データを読み込めませんでした</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    )
  }

  const focusSeg = focus ? ranked.find((s) => s.id === focus) : undefined
  const mapNode = data ? (
    <SatMap
      cells={data.cells}
      cellSat={cellSat}
      ranked={ranked}
      selected={selected}
      focus={focus}
      step={step}
      results={results}
      onSegmentClick={onSegmentClick}
      className="h-[320px] lg:h-[560px]"
    />
  ) : (
    <Skeleton className="h-[320px] w-full lg:h-[560px]" />
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        appId="sat-a"
        actions={<SourceDialog title="出典・データの扱い・限界" sources={SOURCES} trigger={<Button variant="outline" size="sm"><Info className="size-4" />出典・限界</Button>} />}
      />

      <Alert className="border-dashed border-amber-500 bg-amber-50 text-amber-950">
        <AlertTriangle className="text-amber-700" />
        <AlertTitle className="line-clamp-none">この画面の道路・衛星指標・調査結果はすべて架空のサンプルです</AlertTitle>
        <AlertDescription className="text-amber-900">
          実在の場所・精度・効果を示すものではありません。操作の流れ（絞る → 選ぶ → 戻す）を確かめるためのデモです。
        </AlertDescription>
      </Alert>

      <Tabs value={step} onValueChange={(v) => setStep(v as StepId)} className="gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <TabsList className="h-auto w-full flex-1 sm:w-auto sm:flex-none" aria-label="調査の段階">
            <TabsTrigger value="1" className="min-h-10 flex-1 px-3 sm:flex-none"><b>1</b> 絞る</TabsTrigger>
            <TabsTrigger value="2" className="min-h-10 flex-1 px-3 sm:flex-none"><b>2</b> 選ぶ</TabsTrigger>
            <TabsTrigger value="3" className="min-h-10 flex-1 px-3 sm:flex-none"><b>3</b> 戻す</TabsTrigger>
          </TabsList>
          <Badge variant="secondary" className="text-sm" data-testid="round">第{round}回</Badge>
          <span className="text-xs text-muted-foreground">
            流れ: 点数で候補を絞る → 予算内で地中レーダの対象を選ぶ → 結果を点数に戻して第{round + 1}回へ
          </span>
        </div>

        {!data ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
            <div className="order-2 min-w-0 space-y-4 lg:order-1">
              {step === '1' && (
                <Step1
                  round={round}
                  w={w}
                  setW={(v) => { setW(v); setMsg('') }}
                  candidates={candidates}
                  msg={msg}
                  prev={prev}
                  focus={focus}
                  onFocus={setFocus}
                  onNext={() => setStep('2')}
                />
              )}
              {step === '2' && (
                <Step2
                  budgetKm={budgetKm}
                  setBudgetKm={setBudgetKm}
                  segs={segs}
                  candidates={candidates}
                  selected={selected}
                  toggle={toggle}
                  focus={focus}
                  onFocus={setFocus}
                  onAuto={autoSelect}
                  onClear={() => setSelected(new Set())}
                  onBack={() => setStep('1')}
                  onNext={() => setStep('3')}
                />
              )}
              {step === '3' && (
                <Step3
                  round={round}
                  segs={segs}
                  ranked={ranked}
                  selected={selected}
                  revealed={revealed}
                  lastBatch={lastBatch}
                  results={results}
                  calib={calib}
                  surveyed={surveyedSet()}
                  cellSat={cellSat}
                  onScan={doScan}
                  onBack={() => setStep('2')}
                  onApply={applyCalib}
                />
              )}
            </div>

            <div className="order-1 min-w-0 space-y-3 lg:order-2">
              <div className="lg:sticky lg:top-2 space-y-3">
                {mapNode}
                <Card aria-live="polite" data-testid="detail">
                  <CardContent className="space-y-1 text-sm">
                    {focusSeg ? (
                      <>
                        <div className="font-medium">
                          区間 {focusSeg.id}（{focusSeg.cls === 'arterial' ? '幹線・調査済み' : '生活道路'}）
                        </div>
                        <div>区画 {focusSeg.cell}／長さ {focusSeg.lenM} m／布設 {focusSeg.year}年（経過 {NOW_YEAR - focusSeg.year}年）</div>
                        <div>
                          点数 <b>{focusSeg.score.toFixed(2)}</b> ＝ 衛星 {pct(w)}% × 区画値 {cellSat[focusSeg.cell].toFixed(2)} ＋ 台帳 {pct(1 - w)}% × 古さ {ageNorm(focusSeg.year).toFixed(2)}
                        </div>
                        <div className="text-muted-foreground">
                          {focusSeg.cls === 'arterial'
                            ? '過去に調査済み（サンプル）。点数の対象外。'
                            : focusSeg.surveyed
                              ? results.has(focusSeg.id)
                                ? `走査結果: ${results.get(focusSeg.id) ? '▲ 空洞の疑い' : '○ 異常なし'}（シミュレーション）`
                                : '過去に調査済み（サンプル）。'
                              : selected.has(focusSeg.id) ? '選択中。' : '未調査。'}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">地図の道路、または表の行をタップすると、点数の内訳を表示します。</span>
                    )}
                  </CardContent>
                </Card>
                <Legend />
              </div>
            </div>
          </div>
        )}
      </Tabs>

      <About />
    </div>
  )
}

function Legend() {
  return (
    <details className="rounded-md border bg-card px-3 py-2 text-xs">
      <summary className="cursor-pointer font-medium">地図の見かた（凡例）</summary>
      <div className="mt-2 space-y-1.5">
        <div>道路の色＝点数（高いほど先に確かめたい）</div>
        <div className="h-2.5 w-full rounded" style={{ background: 'linear-gradient(90deg,#dbe5ec,#f4b942,#8e1b6b)' }} />
        <div className="flex justify-between"><span>低</span><span>高</span></div>
        <div className="flex items-center gap-2"><span className="inline-block w-8 border-t-4 border-dashed border-[#6f7d86]" />調査済み・幹線（点数の対象外）</div>
        <div className="flex items-center gap-2"><span className="inline-block h-1.5 w-8 rounded bg-[#00a3c4]" />選択した区間</div>
        <div className="flex items-center gap-2">
          <span className="inline-block size-3.5 rounded-full border-2 border-white bg-[#d55e00] outline outline-1 outline-neutral-500" />▲ 空洞の疑い（大・濃い色）
          <span className="inline-block size-2.5 rounded-full border-2 border-[#0072b2] bg-white" />○ 異常なし（小・白抜き）
        </div>
        <div className="flex items-center gap-2"><span className="inline-block size-3.5 rounded bg-[#7fa3c0]" />背景の区画の青み＝地表変位の指標（濃いほど沈下傾向が大きい。サンプル値）</div>
      </div>
    </details>
  )
}
