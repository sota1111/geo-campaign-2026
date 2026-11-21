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
  ApplyPanel, PickPanel, Round2Panel, ScanPanel, TopPanel, WeightPanel, type CalibResult, type LoadInfo, type PrevInfo,
} from './Steps'
import { VerifyPanel, type VerifyData } from './Verify'
import { SOURCES } from './About'
import {
  NOW_YEAR, ADOPT_REASON, adoptWeight, ageNorm, calibrate, candidatesOf, exclusionAccuracy, parseOutcomes, rank, satNorm, scannedFrom, selectByBudget, topShift, totalKm,
  type DataFile, type DemoData, type Scanned, type Segment,
} from './logic'

type StepId = 'top' | 'weight' | 'pick' | 'scan' | 'apply' | 'round2' | 'verify'
const pct = (x: number) => Math.round(x * 100)
const W0 = 0.1 // この地区は衛星でほとんど絞れないため、台帳中心（衛星10%）から始める
const yearTxt = (y: number | null) => (y == null ? '不明' : `${y}年`)

const TITLES: Record<StepId, string> = {
  top: '候補区間の点数を見る',
  weight: '衛星指標の重みを変えてみる（任意）',
  pick: '予算（走行延長）内で調査対象を選ぶ',
  scan: '調査結果（CSV）を入れる',
  apply: '較正を反映して第2回へ進む',
  round2: '第2回の順位を確かめる',
  verify: '実データで確かめる（参考）',
}
const HINTS: Record<StepId, string> = {
  top: '豊中市北東部の実データで点数を付けた候補区間を見る',
  weight: 'スライダーで点数と順位が変わる',
  pick: '「点数の上位から自動で選ぶ」か、地図・表で手直し',
  scan: '一次審査後に GMS3 の結果を入れる枠（CSV。説明用デモは既定オフ）',
  apply: '結果が入ると重みを較正し、順位を作り直す',
  round2: '第1回との対比を見る',
  verify: '陥没の件数との照合・全国の文脈（因果・精度は言わない）',
}

/** 入った結果（空洞あり/なし）から較正の結果を作る */
function calibOf(scanned: Scanned[], cellSat: Record<string, number>, w: number): CalibResult {
  const c = calibrate(scanned, cellSat)
  return {
    ...c,
    ad: adoptWeight(c, scanned, cellSat, w),
    ex0: exclusionAccuracy(scanned, cellSat, w),
    ex1: c.w === null ? null : exclusionAccuracy(scanned, cellSat, c.w),
    n: scanned.length,
  }
}

/** 較正の反映: 次回の重み・比較用の情報・説明文を作る */
function applyOf(segs: Segment[], cellSat: Record<string, number>, w: number, round: number, calib: CalibResult | null, scannedCount: number) {
  const before = candidatesOf(rank(segs, cellSat, w))
  const rankMap: Record<string, number> = {}
  before.forEach((s, i) => (rankMap[s.id] = i + 1))
  const newW = calib ? calib.ad.w : w
  const after = candidatesOf(rank(segs, cellSat, newW))
  const changed = after.slice(0, 10).filter((s, i) => before[i]?.id !== s.id).length
  const prev: PrevInfo = {
    rank: rankMap, topId: before[0]?.id ?? '', round, oldW: w, newW, newTopId: after[0]?.id ?? '', changed,
    calibrated: !!(calib && calib.w !== null), scanned: scannedCount, reason: calib ? calib.ad.reason : 'short',
  }
  let msg: string
  if (calib && calib.w !== null) {
    msg = `${calib.ad.adopt ? `衛星指標の重みを ${pct(w)}% から ${pct(newW)}% に更新しました。` : `衛星指標の重みは ${pct(w)}% のまま（${ADOPT_REASON[calib.ad.reason ?? 'same']}）。`}${before[0]?.id === after[0]?.id ? `結果が入った区間を除く候補の1位は変わらず ${after[0]?.id}（2位以下が入れ替わり）` : `結果が入った区間を除く候補の1位は ${before[0]?.id} から ${after[0]?.id} に変わり`}、上位10区間のうち ${changed} 区間で順位が入れ替わっています。`
  } else {
    msg = '較正に使える結果が不足していたため、重みは変えていません（結果が入った区間が候補から外れた分だけ順位が繰り上がります）。'
  }
  return { prev, msg, newW }
}

async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('shift_jis').decode(buf)
  }
}

export default function App() {
  const [data, setData] = useState<DataFile | null>(null)
  const [verify, setVerify] = useState<VerifyData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<StepId>('top')
  const [w, setW] = useState(W0)
  const [budgetKm, setBudgetKm] = useState(3)
  const [round, setRound] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 空洞の結果。既定では空（実データには空洞の結果が無い）。利用者の CSV か、説明用デモ（架空）でだけ入る
  const [results, setResults] = useState<Map<string, boolean>>(new Map())
  const [demo, setDemo] = useState(false)
  // 同梱の見本 CSV（架空の値）を入れたか／利用者自身の CSV を入れたか（note 列の「架空の見本」で判定）
  const [srcSample, setSrcSample] = useState(false)
  const [srcUser, setSrcUser] = useState(false)
  const [demoData, setDemoData] = useState<DemoData | null>(null)
  const [loadInfo, setLoadInfo] = useState<LoadInfo | null>(null)
  const [roundAdded, setRoundAdded] = useState(0)
  const [focus, setFocus] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [prev, setPrev] = useState<PrevInfo | null>(null)
  const [viewedTop, setViewedTop] = useState(false)
  const [wTouched, setWTouched] = useState(false)
  const [viewedR2, setViewedR2] = useState(false)
  const [viewedVerify, setViewedVerify] = useState(false)
  // 手順2「選ぶ」は、区間を選んだときだけ完了にする（CSV を入れただけでは完了にしない）
  const [pickedOnce, setPickedOnce] = useState(false)
  // 書き出した直後の確認表示（ファイル名・区間数・延長）。選択を変えたら消す
  const [exportMsg, setExportMsg] = useState('')
  useEffect(() => setExportMsg(''), [selected])

  useEffect(() => {
    if (round > 1 && step === 'round2') setViewedR2(true)
  }, [round, step])
  useEffect(() => {
    if (step === 'verify') setViewedVerify(true)
  }, [step])

  useEffect(() => {
    let alive = true
    fetch(dataUrl('sat-a', 'toyonaka.json'))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DataFile>
      })
      .then(async (d) => {
        if (!alive) return
        setData(d)
        if (!isSampleMode()) return
        // 実行サンプル: 説明用デモ（架空の結果）で、初期の重み・予算 3.0 km のまま「点数の上位から自動で選ぶ」→ 走査 → 較正を反映 →
        // 第2回の順位を確認、の流れを同じ計算にかけて再現する。表示値は直書きしない。地図には常に「架空」と出る。
        const dm = (await (await fetch(dataUrl('sat-a', 'demo_sim.json'))).json()) as DemoData
        if (!alive) return
        const hit = new Set(dm.hit)
        const cs = Object.fromEntries(d.cells.map((c) => [c.id, satNorm(c.disp)]))
        const res = new Map<string, boolean>(dm.past.map((id) => [id, hit.has(id)]))
        const withS = (m: Map<string, boolean>) => d.segments.map((s) => ({ ...s, surveyed: m.has(s.id) }))
        const ids = selectByBudget(rank(withS(res), cs, W0), 3)
        for (const id of ids) res.set(id, hit.has(id))
        const segs2 = withS(res)
        const calib = calibOf(scannedFrom(segs2, res), cs, W0)
        const ap = applyOf(segs2, cs, W0, 1, calib, ids.length)
        setDemoData(dm)
        setDemo(true)
        setResults(res)
        setPrev(ap.prev)
        setMsg(ap.msg)
        setW(ap.newW)
        setRound(2)
        setViewedTop(true)
        setPickedOnce(true)
        setStep('round2')
      })
      .catch((e) => alive && setError(String(e)))
    fetch(dataUrl('sat-a', 'verify.json'))
      .then((r) => (r.ok ? (r.json() as Promise<VerifyData>) : null))
      .then((v) => alive && v && setVerify(v))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const baseSegs = data?.segments
  // 結果が入った区間だけ surveyed（候補から外れる）
  const segs = useMemo<Segment[]>(() => (baseSegs ?? []).map((s) => ({ ...s, surveyed: results.has(s.id) })), [baseSegs, results])
  useEffect(() => {
    if (selected.size > 0 && totalKm(segs, selected) <= budgetKm + 1e-9) setPickedOnce(true)
  }, [selected, budgetKm, segs])
  const cellSat = useMemo(() => Object.fromEntries((data?.cells ?? []).map((c) => [c.id, satNorm(c.disp)])), [data])
  const cellById = useMemo(() => Object.fromEntries((data?.cells ?? []).map((c) => [c.id, c])), [data])
  const ranked = useMemo(() => rank(segs, cellSat, w), [segs, cellSat, w])
  const candidates = useMemo(() => candidatesOf(ranked), [ranked])
  const surveyedSet = useMemo(() => scannedFrom(segs, results), [segs, results])
  const calibNow = useMemo(() => calibOf(surveyedSet, cellSat, w), [surveyedSet, cellSat, w])
  // 較正を反映したら上位10が何区間入れ替わるか（反映前に結論として先に出す）
  const previewChanged = useMemo(() => (calibNow.w !== null ? applyOf(segs, cellSat, w, 1, calibNow, 0).prev.changed : null), [segs, cellSat, w, calibNow])

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
  // 書き出し CSV の出どころ表記。見本 CSV（架空の値）で較正した順位を「実データ」と書かない
  const dataNote = demo ? '説明用デモ（結果は架空）'
    : srcSample ? '見本 CSV（架空の値）で較正。地中レーダの結果は実際の調査結果ではありません'
      : srcUser ? 'あなたが入れた調査結果による（衛星・道路・台帳は豊中市北東部の実データ。調査結果の出所はあなたが確認）'
        : '実データ（豊中市北東部。衛星・道路・台帳）'
  const exportTargets = () => {
    const rk = new Map(candidates.map((s, i) => [s.id, i + 1]))
    const mid = (s: Segment, k: 0 | 1) => ((s.coords[0][k] + s.coords[1][k]) / 2).toFixed(6)
    const rows = [...selected].map((id) => ranked.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => (rk.get(a.id) ?? 999) - (rk.get(b.id) ?? 999))
      // cavity 列は空欄。調査後に あり／なし を書いて、そのまま手順「戻す」で入れられる（空欄の行は読み飛ばす）
      .map((s) => [rk.get(s.id) ?? '', s.id, mid(s, 1), mid(s, 0), s.cell, s.lenM, s.year ?? '', s.score.toFixed(2), `${pct(w)}%`, dataNote, ''])
    downloadText('survey-targets.csv', markCsv(toCsv([['rank', 'segment_id', 'lat', 'lon', 'cell', 'length_m', 'laid_year', 'score', 'satellite_weight', 'data_note', 'cavity'], ...rows])), 'text/csv;charset=utf-8')
    setExportMsg(`survey-targets.csv（${rows.length} 区間）をダウンロードフォルダに保存。調査後、空欄の cavity 列に あり／なし を書いて結果の手順で入れます`)
  }
  const exportRound2 = () => {
    const rows = candidates.slice(0, 10).map((s, i) => [i + 1, s.id, s.cell, s.lenM, s.year ?? '', s.score.toFixed(2), prev?.rank[s.id] ?? '', `${pct(w)}%`, dataNote])
    downloadText(`round${round}-ranking.csv`, markCsv(toCsv([['rank', 'segment_id', 'cell', 'length_m', 'laid_year', 'score', 'previous_rank', 'satellite_weight', 'data_note'], ...rows])), 'text/csv;charset=utf-8')
  }
  const onSegmentClick = (id: string) => {
    focusRow(id)
    if (step !== 'pick') return
    const s = segs.find((x) => x.id === id)
    if (s && s.cls === 'life' && !s.surveyed) toggle(id)
  }

  /** 結果を足す（累計）。同じ区間は上書き。足した区間は選択から外す */
  const addResults = (add: Map<string, boolean>) => {
    let fresh = 0
    for (const id of add.keys()) if (!results.has(id)) fresh++
    setRoundAdded((n) => n + fresh)
    setResults(new Map([...results, ...add]))
    setSelected((cur) => new Set([...cur].filter((id) => !add.has(id))))
  }
  /** 調査結果の CSV を取り込む（区間ID または緯度・経度。処理はブラウザ内だけ） */
  const onFile = async (file: File) => {
    if (demo) return
    const text = await readFileText(file)
    const r = parseOutcomes(text, baseSegs ?? [])
    if (!r.error && r.summary.segments > 0) { if (/架空の見本/.test(text)) setSrcSample(true); else setSrcUser(true) }
    setLoadInfo({ name: file.name, error: r.error, summary: r.summary })
    if (!r.error) addResults(r.results)
  }
  const clearResults = () => {
    setResults(new Map())
    setLoadInfo(null)
    setRoundAdded(0)
    setSrcSample(false)
    setSrcUser(false)
    // 結果を消したら、その結果で決めた重み・順位・回も初めに戻す（結果が無いのに較正済みの表示が残らないように）
    if (round > 1) {
      setW(W0)
      setRound(1)
      setPrev(null)
      setMsg('')
      setFocus(null)
    }
  }
  /** 説明用デモの切替。入れた結果・較正・回は初めからにする（実の結果と架空を混ぜない） */
  const onDemo = async (on: boolean) => {
    let dm = demoData
    if (on && !dm) {
      dm = (await (await fetch(dataUrl('sat-a', 'demo_sim.json'))).json()) as DemoData
      setDemoData(dm)
    }
    setDemo(on)
    setLoadInfo(null)
    setSrcSample(false)
    setSrcUser(false)
    // 選択は残す（過去の調査済みになった区間だけ外す）
    const pastIds = on && dm ? new Set(dm.past) : new Set<string>()
    setSelected((cur) => new Set([...cur].filter((id) => !pastIds.has(id))))
    setW(W0)
    setRound(1)
    setMsg('')
    setPrev(null)
    setRoundAdded(0)
    setResults(on && dm ? new Map(dm.past.map((id) => [id, new Set(dm.hit).has(id)])) : new Map())
  }
  const onDemoScan = () => {
    if (!demo || !demoData) return
    const hit = new Set(demoData.hit)
    addResults(new Map([...selected].map((id) => [id, hit.has(id)])))
  }

  const applyCalib = () => {
    // 反映前の順位（結果が入った区間を除いた候補の順位）を記録して、第2回との比較に使う
    const r = applyOf(segs, cellSat, w, round, calibNow, roundAdded)
    setPrev(r.prev)
    setMsg(r.msg)
    setW(r.newW)
    setRound(round + 1)
    setRoundAdded(0)
    setFocus(null)
  }

  const hasResults = results.size > 0
  const pastIds = useMemo(() => (demo && demoData ? new Set(demoData.past) : undefined), [demo, demoData])
  useAppSteps(
    [
      { id: 'top', title: '候補区間の点数を見る', hint: '表の行を選んで内訳を見る（豊中市の実データ）', action: '表の行を1つ選ぶと完了', done: viewedTop },
      { id: 'weight', title: '衛星指標の重みを変えてみる', hint: 'スライダーで順位が変わる', action: 'スライダーを動かすと完了', optional: true, done: wTouched },
      {
        id: 'pick', title: '予算（走行延長）内で調査対象を選ぶ', hint: '「点数の上位から自動で選ぶ」',
        done: pickedOnce || (selected.size > 0 && totalKm(segs, selected) <= budgetKm + 1e-9),
      },
      { id: 'scan', title: '調査結果（CSV）を入れる', hint: '一次審査後に GMS3 の結果を入れる枠。区間ID または緯度・経度の CSV', action: 'CSV を入れると完了', done: roundAdded > 0 || round > 1 },
      { id: 'apply', title: '較正を反映して第2回へ進む', hint: '結果が入ると重みが更新され順位が作り直される', action: calibNow.w !== null && round === 1 ? 'ボタンを押すと完了' : undefined, done: round > 1 },
      { id: 'round2', title: '第2回の順位を確かめる', hint: '第1回との対比を見る', action: round > 1 ? '第2回の順位ができました。ここを押して確かめる' : undefined, done: round > 1 && viewedR2 },
      { id: 'verify', title: '実データで確かめる（参考）', hint: '陥没の件数との照合・全国の文脈', action: '開いて読むと完了', optional: true, done: viewedVerify },
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
      badge={
        demo ? { kind: 'fictional', label: '架空を含む（説明用デモ）' }
          : srcSample ? { kind: 'fictional', label: srcUser ? '架空を含む（見本 CSV＋利用者の CSV）' : '架空を含む（見本 CSV）' }
            : srcUser ? { kind: 'partial', label: '実データ＋あなたが入れた調査結果（出所はあなたが確認）' }
              : undefined
      }
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
  const focusCell = focusSeg ? cellById[focusSeg.cell] : undefined
  const fake = demo || srcSample ? '（架空）' : ''

  const aside = data ? (
    <div className="flex h-full flex-col">
      <SatMap
        round={round}
        bbox={data.area.bbox}
        palette={data.satellite.palette}
        className="min-h-0 flex-1"
        cells={data.cells}
        ranked={ranked}
        selected={selected}
        focus={focus}
        step={mapStep}
        results={results}
        demo={demo}
        sample={srcSample}
        userCsv={srcUser}
        pastIds={pastIds}
        onSegmentClick={onSegmentClick}
      />
      <div className="shrink-0 border-t bg-card px-3 py-1.5 text-xs" aria-live="polite" data-testid="detail">
        <div className="space-y-0.5">
          {focusSeg ? (
            <>
              <div>
                <b>区間 {focusSeg.id}</b>{focusSeg.name ? `（${focusSeg.name}）` : ''}（{focusSeg.cls === 'arterial' ? '幹線・この調査の対象外' : focusSeg.cls === 'noledger' ? '台帳に管渠が紐づかない道路' : '生活道路'}）／区画 {focusSeg.cell}
                {focusCell ? `（階級 ${focusCell.range[0]}〜${focusCell.range[1]} mm/年）` : ''}／{focusSeg.lenM} m／竣工 {yearTxt(focusSeg.year)}{focusSeg.year != null ? `（経過 ${NOW_YEAR - focusSeg.year}年）` : '（台帳で不明。古さは中立の0.5）'}
              </div>
              <div>
                {focusSeg.cls === 'noledger' ? '点数の対象外' : (
                  <>点数 <b>{focusSeg.score.toFixed(2)}</b> ＝ 衛星 {pct(w)}% × 区画値 {cellSat[focusSeg.cell].toFixed(2)} ＋ 台帳 {pct(1 - w)}% × 古さ {ageNorm(focusSeg.year).toFixed(2)}</>
                )}
                <span className="text-muted-foreground">
                  ／{results.has(focusSeg.id)
                    ? `調査結果${fake}: ${results.get(focusSeg.id) ? '▲ 空洞あり' : '○ 空洞なし'}`
                    : focusSeg.cls === 'arterial' ? '点数の対象外（生活道路が対象）'
                      : selected.has(focusSeg.id) ? '選択中' : '結果は未入力'}
                </span>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">地図の道路、または表の行をタップすると、点数の内訳を表示します。</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-3 py-1.5 text-[11px] [&>*]:shrink-0" data-testid="legend">
        <span className="font-medium">凡例</span>
        <span className="flex items-center gap-1">点数 低<span className="inline-block h-2 w-14 rounded" style={{ background: 'linear-gradient(90deg,#dbe5ec,#f4b942,#8e1b6b)' }} />高</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 border-t-4 border-dashed border-[#6f7d86]" />結果が入った区間{fake}</span>
        <span className="flex items-center gap-1"><span className="inline-block w-6 border-t-2 border-[#9aa5ab]" />幹線（対象外）</span>
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-6 rounded bg-[#00a3c4]" />選択中</span>
        <span className="flex items-center gap-1">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6" fill="#d55e00" stroke="#fff" strokeWidth="2" /></svg>空洞あり{fake}
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="5" fill="#fff" stroke="#0072b2" strokeWidth="2.5" /></svg>空洞なし{fake}
        </span>
        <span className="flex items-center gap-1"><span className="inline-block size-3 rounded bg-[#7fa3c0]" />区画の色＝衛星の階級（この地区は2階級のみ）</span>
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
            {step === 'top' && <TopPanel candidates={candidates} focus={focus} onFocus={focusRow} satShift={topShift(segs, cellSat, w, 20)} />}
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
                exportMsg={exportMsg}
              />
            )}
            {step === 'scan' && (
              <ScanPanel
                sample={srcSample}
                userCsv={srcUser}
                pastCount={pastIds ? [...results.keys()].filter((id) => pastIds.has(id)).length : 0}
                demo={demo}
                onDemo={onDemo}
                selected={selected}
                segs={segs}
                resultsCount={results.size}
                loadInfo={loadInfo}
                onFile={onFile}
                onClear={clearResults}
                onDemoScan={onDemoScan}
                onGoPick={() => setStep('pick')}
              />
            )}
            {step === 'apply' && (
              <ApplyPanel
                sample={srcSample}
                round={round}
                calib={calibNow}
                surveyed={surveyedSet}
                cellSat={cellSat}
                resultsCount={hasResults ? results.size : 0}
                demo={demo}
                applied={round > 1 && roundAdded === 0 ? prev : null}
                previewChanged={previewChanged}
                onApply={applyCalib}
                onGoRound2={() => setStep('round2')}
                onGoScan={() => setStep('scan')}
                onDemoOn={() => onDemo(true)}
              />
            )}
            {step === 'round2' && (
              <Round2Panel demo={demo} sample={srcSample}onGoScan={() => setStep('scan')} onDemoOn={() => onDemo(true)} round={round} msg={msg} prev={prev} candidates={candidates} focus={focus} onFocus={focusRow} onExport={exportRound2} />
            )}
            {step === 'verify' && (verify ? <VerifyPanel v={verify} /> : <Skeleton className="h-40 w-full" />)}
          </>
        )}
      </StepLayout>
    </>
  )
}
