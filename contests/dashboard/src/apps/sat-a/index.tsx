import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { StepLayout } from '@/components/shared/StepLayout'
import { useAppSteps } from '@/components/shared/AppSteps'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dataUrl } from '@/lib/data'
import { SatMap } from './SatMap'
import {
  ApplyPanel, PickPanel, Round2Panel, ScanPanel, TopPanel, WeightPanel, type CalibResult, type PrevInfo,
} from './Steps'
import { SOURCES } from './About'
import {
  NOW_YEAR, ageNorm, calibrate, candidatesOf, exclusionAccuracy, rank, satNorm, selectByBudget, totalKm,
  type SampleData, type Segment,
} from './logic'

type StepId = 'top' | 'weight' | 'pick' | 'scan' | 'apply' | 'round2'
const pct = (x: number) => Math.round(x * 100)

const TITLES: Record<StepId, string> = {
  top: '候補区間の点数を見る',
  weight: '衛星指標の重みを変えてみる（任意）',
  pick: '予算（走行延長）内で調査対象を選ぶ',
  scan: '走査結果を見る',
  apply: '較正を反映して第2回へ進む',
  round2: '第2回の順位を確かめる',
}
const HINTS: Record<StepId, string> = {
  top: '最も点数の高い区間を確かめる（データはすべて架空）',
  weight: 'スライダーで点数と順位が変わる',
  pick: '「点数の上位から自動で選ぶ」か、地図・表で手直し',
  scan: '結果は乱数のシミュレーション',
  apply: '重みが更新され、順位が作り直される',
  round2: '第1回との対比を見る',
}

export default function App() {
  const [data, setData] = useState<SampleData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [segs, setSegs] = useState<Segment[]>([])
  const [step, setStep] = useState<StepId>('top')
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
  const [prev, setPrev] = useState<PrevInfo | null>(null)
  const [viewedTop, setViewedTop] = useState(false)
  const [wTouched, setWTouched] = useState(false)
  const [viewedR2, setViewedR2] = useState(false)

  useEffect(() => {
    if (round > 1 && step === 'round2') setViewedR2(true)
  }, [round, step])
  useEffect(() => {
    if (step === 'top') setViewedTop(true)
  }, [step])

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
  const focusRow = (id: string) => {
    setFocus(id)
  }
  const onSegmentClick = (id: string) => {
    focusRow(id)
    if (step !== 'pick') return
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
    const changed = after.slice(0, 10).filter((s, i) => before[i]?.id !== s.id).length
    setPrev({
      rank: rankMap, topId: before[0]?.id ?? '', round, oldW: w, newW, newTopId: after[0]?.id ?? '', changed,
      calibrated: !!(calib && calib.w !== null), scanned: lastBatch.length,
    })
    if (calib && calib.w !== null) {
      setMsg(
        `${newW === w ? `衛星指標の重みは ${pct(w)}% のまま（調査結果に照らしても最も当たりやすい重みでした）。` : `衛星指標の重みを ${pct(w)}% から ${pct(newW)}% に更新しました。`}${before[0]?.id === after[0]?.id ? `走査した区間を除く候補の1位は変わらず ${after[0]?.id}（2位以下が入れ替わり）` : `走査した区間を除く候補の1位は ${before[0]?.id} から ${after[0]?.id} に変わり`}、上位10区間のうち ${changed} 区間で順位が入れ替わっています。`,
      )
    } else {
      setMsg('較正に使える結果が不足していたため、重みは変えていません（走査済みの区間が候補から外れた分だけ順位が繰り上がります）。')
    }
    setW(newW)
    setRound(round + 1)
    setRevealed(false)
    setCalib(null)
    setLastBatch([])
    setFocus(null)
  }

  const scanned = results.size > 0
  useAppSteps(
    [
      { id: 'top', title: '候補区間の点数を見る', hint: '最も高い区間を確かめる（データは架空）', done: viewedTop },
      { id: 'weight', title: '衛星指標の重みを変えてみる', hint: 'スライダーで順位が変わる', optional: true, done: wTouched },
      {
        id: 'pick', title: '予算（走行延長）内で調査対象を選ぶ', hint: '「点数の上位から自動で選ぶ」',
        done: scanned || (selected.size > 0 && totalKm(segs, selected) <= budgetKm + 1e-9),
      },
      { id: 'scan', title: '走査結果を見る', hint: '結果は乱数のシミュレーション', done: scanned },
      { id: 'apply', title: '較正を反映して第2回へ進む', hint: '重みが更新され順位が作り直される', done: round > 1 },
      { id: 'round2', title: '第2回の順位を確かめる', hint: '第1回との対比を見る', done: round > 1 && viewedR2 },
    ],
    {
      activeId: step,
      onSelectStep: (id) => setStep(id as StepId),
      description:
        '道路管理者として、路面下の空洞調査の候補区間を衛星の指標などで絞り込み、地中レーダ調査の対象を予算内で選び、その結果を次の絞り込みに活かす流れを確かめる。',
    },
  )

  const header = (
    <PageHeader
      appId="sat-a"
      compact
      actions={
        <SourceDialog
          title="出典・データの扱い・限界"
          sources={SOURCES}
          trigger={<Button variant="outline" size="sm"><Info className="size-4" />出典・限界</Button>}
        />
      }
    />
  )

  if (error) {
    return (
      <>
        {header}
        <div className="p-4">
          <Alert><AlertTriangle /><AlertTitle>データを読み込めませんでした</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
        </div>
      </>
    )
  }

  const focusSeg = focus ? ranked.find((s) => s.id === focus) : undefined
  const mapStep = step === 'top' || step === 'weight' ? '1' : '2'

  const aside = data ? (
    <div className="flex h-full flex-col">
      <SatMap
        className="min-h-0 flex-1"
        cells={data.cells}
        cellSat={cellSat}
        ranked={ranked}
        selected={selected}
        focus={focus}
        step={mapStep}
        results={results}
        onSegmentClick={onSegmentClick}
      />
      <div className="relative flex shrink-0 items-start gap-3 border-t bg-card px-3 py-2 text-xs" data-testid="detail" aria-live="polite">
        <div className="min-w-0 flex-1 space-y-0.5">
          {focusSeg ? (
            <>
              <div>
                <b>区間 {focusSeg.id}</b>（{focusSeg.cls === 'arterial' ? '幹線・調査済み' : '生活道路'}）／区画 {focusSeg.cell}／{focusSeg.lenM} m／布設 {focusSeg.year}年（経過 {NOW_YEAR - focusSeg.year}年）
              </div>
              <div>
                点数 <b>{focusSeg.score.toFixed(2)}</b> ＝ 衛星 {pct(w)}% × 区画値 {cellSat[focusSeg.cell].toFixed(2)} ＋ 台帳 {pct(1 - w)}% × 古さ {ageNorm(focusSeg.year).toFixed(2)}
                <span className="text-muted-foreground">
                  ／{focusSeg.cls === 'arterial'
                    ? '過去に調査済み（点数の対象外）'
                    : focusSeg.surveyed
                      ? results.has(focusSeg.id) ? `走査結果: ${results.get(focusSeg.id) ? '▲ 疑い' : '○ なし'}（シミュレーション）` : '過去に調査済み'
                      : selected.has(focusSeg.id) ? '選択中' : '未調査'}
                </span>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">地図の道路、または表の行をタップすると、点数の内訳を表示します。</span>
          )}
        </div>
        <details className="shrink-0">
          <summary className="cursor-pointer font-medium">凡例</summary>
          <div className="absolute bottom-full right-2 z-30 w-72 space-y-1.5 rounded-md border bg-card p-3 shadow-lg">
            <div>道路の色＝点数（高いほど先に確かめたい）</div>
            <div className="h-2.5 w-full rounded" style={{ background: 'linear-gradient(90deg,#dbe5ec,#f4b942,#8e1b6b)' }} />
            <div className="flex justify-between"><span>低</span><span>高</span></div>
            <div className="flex items-center gap-2"><span className="inline-block w-8 border-t-4 border-dashed border-[#6f7d86]" />調査済み・幹線（対象外）</div>
            <div className="flex items-center gap-2"><span className="inline-block h-1.5 w-8 rounded bg-[#00a3c4]" />選択した区間</div>
            <div className="flex items-center gap-2">
              <span className="inline-block size-3.5 rounded-full border-2 border-white bg-[#d55e00] outline outline-1 outline-neutral-500" />▲ 空洞の疑い
              <span className="inline-block size-2.5 rounded-full border-2 border-[#0072b2] bg-white" />○ 異常なし
            </div>
            <div className="flex items-center gap-2"><span className="inline-block size-3.5 rounded bg-[#7fa3c0]" />区画の青み＝地表変位の指標（サンプル値）</div>
          </div>
        </details>
      </div>
    </div>
  ) : (
    <Skeleton className="h-full w-full" />
  )

  return (
    <>
      {header}
      <p className="shrink-0 border-b bg-amber-50 px-4 py-1 text-xs text-amber-950" data-testid="fiction-note">
        ◇ 道路・衛星指標・調査結果はすべて架空のサンプルです（実在の場所・精度・効果を示しません）。第{round}回
      </p>
      <StepLayout title={TITLES[step]} hint={HINTS[step]} aside={aside}>
        {!data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <>
            {step === 'top' && <TopPanel candidates={candidates} focus={focus} onFocus={focusRow} />}
            {step === 'weight' && (
              <WeightPanel
                w={w}
                setW={(v) => { setW(v); setWTouched(true) }}
                candidates={candidates}
                focus={focus}
                onFocus={focusRow}
              />
            )}
            {step === 'pick' && (
              <PickPanel
                budgetKm={budgetKm}
                setBudgetKm={setBudgetKm}
                segs={segs}
                candidates={candidates}
                selected={selected}
                toggle={toggle}
                focus={focus}
                onFocus={focusRow}
                onAuto={() => setSelected(new Set(selectByBudget(ranked, budgetKm)))}
                onClear={() => setSelected(new Set())}
              />
            )}
            {step === 'scan' && (
              <ScanPanel
                segs={segs}
                ranked={ranked}
                selected={selected}
                revealed={revealed}
                lastBatch={lastBatch}
                results={results}
                onScan={doScan}
              />
            )}
            {step === 'apply' && (
              <ApplyPanel
                round={round}
                revealed={revealed}
                calib={calib}
                surveyed={surveyedSet()}
                cellSat={cellSat}
                resultsCount={results.size}
                applied={round > 1 ? prev : null}
                onApply={applyCalib}
              />
            )}
            {step === 'round2' && (
              <Round2Panel round={round} msg={msg} prev={prev} candidates={candidates} focus={focus} onFocus={focusRow} />
            )}
          </>
        )}
      </StepLayout>
    </>
  )
}
