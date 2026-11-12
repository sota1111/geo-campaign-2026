import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { SourceDialog } from '@/components/shared/SourceDialog'
import { StepLayout } from '@/components/shared/StepLayout'
import { useAppSteps } from '@/components/shared/AppSteps'
import { downloadText, toCsv } from '@/components/shared/downloadText'
import { markCsv } from '../_samples/mark'
import { BusinessDialog } from './Business'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { dataUrl } from '@/lib/data'
import { isSampleMode } from '@/lib/sample'
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

/** 第1回の走査: 選んだ区間を走査済みにして、較正の結果を作る（通常操作と実行サンプルで共通） */
function scanOf(segs: Segment[], selected: Set<string>, results: Map<string, boolean>, cellSat: Record<string, number>, w: number) {
  const nextResults = new Map(results)
  const nextSegs = segs.map((s) => {
    if (!selected.has(s.id)) return s
    nextResults.set(s.id, s.sim_cavity)
    return { ...s, surveyed: true }
  })
  const data3 = nextSegs.filter((s) => s.surveyed).map((s) => ({ ...s, hit: s.sim_cavity }))
  const c = calibrate(data3, cellSat)
  const calib: CalibResult = {
    ...c,
    ex0: exclusionAccuracy(data3, cellSat, w),
    ex1: c.w === null ? null : exclusionAccuracy(data3, cellSat, c.w),
    pastCount: data3.length - nextResults.size,
  }
  return { nextResults, nextSegs, calib }
}

/** 較正の反映: 次回の重み・比較用の情報・説明文を作る */
function applyOf(segs: Segment[], cellSat: Record<string, number>, w: number, round: number, calib: CalibResult | null, scannedCount: number) {
  const before = candidatesOf(rank(segs, cellSat, w))
  const rankMap: Record<string, number> = {}
  before.forEach((s, i) => (rankMap[s.id] = i + 1))
  const newW = calib && calib.w !== null ? calib.w : w
  const after = candidatesOf(rank(segs, cellSat, newW))
  const changed = after.slice(0, 10).filter((s, i) => before[i]?.id !== s.id).length
  const prev: PrevInfo = {
    rank: rankMap, topId: before[0]?.id ?? '', round, oldW: w, newW, newTopId: after[0]?.id ?? '', changed,
    calibrated: !!(calib && calib.w !== null), scanned: scannedCount,
  }
  let msg: string
  if (calib && calib.w !== null) {
    msg = `${newW === w ? `衛星指標の重みは ${pct(w)}% のまま（調査結果に照らしても最も当たりやすい重みでした）。` : `衛星指標の重みを ${pct(w)}% から ${pct(newW)}% に更新しました。`}${before[0]?.id === after[0]?.id ? `走査した区間を除く候補の1位は変わらず ${after[0]?.id}（2位以下が入れ替わり）` : `走査した区間を除く候補の1位は ${before[0]?.id} から ${after[0]?.id} に変わり`}、上位10区間のうち ${changed} 区間で順位が入れ替わっています。`
  } else {
    msg = '較正に使える結果が不足していたため、重みは変えていません（走査済みの区間が候補から外れた分だけ順位が繰り上がります）。'
  }
  return { prev, msg, newW }
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
    let alive = true
    fetch(dataUrl('sat-a', 'sample.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<SampleData>
      })
      .then((d) => {
        if (!alive) return
        setData(d)
        const base = d.segments.map((s) => ({ ...s }))
        if (!isSampleMode()) {
          setSegs(base)
          return
        }
        // 実行サンプル: 被験者の操作（初期の重み 50%・予算 3.0 km で「点数の上位から自動で選ぶ」→ 走査 → 較正を反映 →
        // 第2回の順位を確認）を、実データで同じ計算にかけて再現する。表示値は直書きしない。
        const cs = Object.fromEntries(d.cells.map((c) => [c.id, satNorm(c.disp)]))
        const w0 = 0.5
        const ids = new Set(selectByBudget(rank(base, cs, w0), 3))
        const sc = scanOf(base, ids, new Map(), cs, w0)
        const ap = applyOf(sc.nextSegs, cs, w0, 1, sc.calib, ids.size)
        setSegs(sc.nextSegs)
        setResults(sc.nextResults)
        setPrev(ap.prev)
        setMsg(ap.msg)
        setW(ap.newW)
        setRound(2)
        setViewedTop(true)
        setStep('round2')
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
    // 手順1は、区間を1つ選んで点数の内訳を見たら済
    setViewedTop(true)
  }
  const exportTargets = () => {
    const rk = new Map(candidates.map((s, i) => [s.id, i + 1]))
    const rows = [...selected].map((id) => ranked.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => (rk.get(a.id) ?? 999) - (rk.get(b.id) ?? 999))
      .map((s) => [rk.get(s.id) ?? '', s.id, s.cell, s.lenM, s.year, s.score.toFixed(2), `${pct(w)}%`, '架空データ（サンプル市）'])
    downloadText('survey-targets.csv', markCsv(toCsv([['rank', 'segment_id', 'cell', 'length_m', 'laid_year', 'score', 'satellite_weight', 'data_note'], ...rows])), 'text/csv;charset=utf-8')
  }
  const exportRound2 = () => {
    const rows = candidates.slice(0, 10).map((s, i) => [i + 1, s.id, s.cell, s.lenM, s.year, s.score.toFixed(2), prev?.rank[s.id] ?? '', `${pct(w)}%`, '架空データ（サンプル市）'])
    downloadText(`round${round}-ranking.csv`, markCsv(toCsv([['rank', 'segment_id', 'cell', 'length_m', 'laid_year', 'score', 'previous_rank', 'satellite_weight', 'data_note'], ...rows])), 'text/csv;charset=utf-8')
  }
  const onSegmentClick = (id: string) => {
    focusRow(id)
    if (step !== 'pick') return
    const s = segs.find((x) => x.id === id)
    if (s && s.cls === 'life' && !s.surveyed) toggle(id)
  }

  const doScan = () => {
    const ids = [...selected]
    const { nextResults, nextSegs, calib: c } = scanOf(segs, selected, results, cellSat, w)
    setCalib(c)
    setResults(nextResults)
    setSegs(nextSegs)
    setLastBatch(ids)
    setSelected(new Set())
    setRevealed(true)
  }

  const applyCalib = () => {
    // 反映前の順位（走査済みを除いた候補の順位）を記録して、第2回との比較に使う
    const r = applyOf(segs, cellSat, w, round, calib, lastBatch.length)
    setPrev(r.prev)
    setMsg(r.msg)
    setW(r.newW)
    setRound(round + 1)
    setRevealed(false)
    setCalib(null)
    setLastBatch([])
    setFocus(null)
  }

  const scanned = results.size > 0
  useAppSteps(
    [
      { id: 'top', title: '候補区間の点数を見る', hint: '表の行を選んで内訳を見る（データは架空）', action: '表の行を1つ選ぶと完了', done: viewedTop },
      { id: 'weight', title: '衛星指標の重みを変えてみる', hint: 'スライダーで順位が変わる', action: 'スライダーを動かすと完了', optional: true, done: wTouched },
      {
        id: 'pick', title: '予算（走行延長）内で調査対象を選ぶ', hint: '「点数の上位から自動で選ぶ」',
        done: scanned || (selected.size > 0 && totalKm(segs, selected) <= budgetKm + 1e-9),
      },
      { id: 'scan', title: '走査結果を見る', hint: '結果は乱数のシミュレーション', done: scanned },
      { id: 'apply', title: '較正を反映して第2回へ進む', hint: '重みが更新され順位が作り直される', action: revealed ? 'ボタンを押すと完了' : undefined, done: round > 1 },
      { id: 'round2', title: '第2回の順位を確かめる', hint: '第1回との対比を見る', action: round > 1 ? '第2回の順位ができました。ここを押して確かめる' : undefined, done: round > 1 && viewedR2 },
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
        <>
          <BusinessDialog />
          <SourceDialog
            title="出典・データの扱い・限界"
            sources={SOURCES}
            trigger={<Button variant="outline" size="sm"><Info className="size-4" />出典・限界</Button>}
          />
        </>
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
        round={round}
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
      <div className="shrink-0 border-t bg-card px-3 py-1.5 text-xs" aria-live="polite" data-testid="detail">
        <div className="space-y-0.5">
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

      </div>
      <div className="flex shrink-0 items-center gap-x-3 gap-y-1 overflow-x-auto whitespace-nowrap border-t bg-card px-3 py-1.5 text-[11px] md:flex-wrap md:overflow-visible md:whitespace-normal [&>*]:shrink-0" data-testid="legend">
        <span className="font-medium">凡例</span>
        <span className="flex items-center gap-1">点数 低<span className="inline-block h-2 w-14 rounded" style={{ background: 'linear-gradient(90deg,#dbe5ec,#f4b942,#8e1b6b)' }} />高</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 border-t-4 border-dashed border-[#6f7d86]" />調査済み・幹線</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-6 rounded bg-[#00a3c4]" />選択中</span>
        <span className="flex items-center gap-1">
          <svg width="14" height="13" viewBox="0 0 26 24" aria-hidden><polygon points="13,2 24,22 2,22" fill="#d55e00" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" /></svg>空洞の疑い
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5.5" fill="#fff" stroke="#0072b2" strokeWidth="2.5" /></svg>異常なし
        </span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-[#7fa3c0]" />区画の青み＝地表変位</span>
      </div>
    </div>
  ) : (
    <Skeleton className="h-full w-full" />
  )

  return (
    <>
      {header}
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
                onExport={exportTargets}
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
              <Round2Panel round={round} msg={msg} prev={prev} candidates={candidates} focus={focus} onFocus={focusRow} onExport={exportRound2} />
            )}
          </>
        )}
      </StepLayout>
    </>
  )
}
