import { ArrowDown, Download, Radar, Wand2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { dataUrl } from '@/lib/data'
import {
  LINK_MAX_M, aucAt, totalKm, type Calibration, type CellSat, type Exclusion, type OutcomeSummary, type Scanned, type Scored, type Segment,
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
export type CalibResult = Calibration & { ex0: Exclusion | null; ex1: Exclusion | null; n: number }

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
          {!prev && <TableHead>区画</TableHead>}
          <TableHead className="text-right">布設年</TableHead>
          <TableHead className="text-right">点数</TableHead>
          {prev && <TableHead className="text-right">第1回からの変化</TableHead>}
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
              {!prev && <TableCell>{s.cell}</TableCell>}
              <TableCell className="text-right">{s.year ?? '不明'}</TableCell>
              <TableCell className="text-right font-medium">
                {s.score.toFixed(2)}
                {/* 小数2桁で前後と同じなら「同点」（表の並びは小数3桁以下の差か、区間IDの順） */}
                {(rows[i - 1]?.score.toFixed(2) === s.score.toFixed(2) || rows[i + 1]?.score.toFixed(2) === s.score.toFixed(2)) && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground" data-testid="tie-mark">同点</span>
                )}
              </TableCell>
              {prev && (
                <TableCell className="whitespace-normal text-right text-xs">{p ? (d > 0 ? `${d}位上がった` : d < 0 ? `${-d}位下がった` : '変わらず') : '—'}{p ? <span className="block text-muted-foreground">（{p}位→{i + 1}位）</span> : null}</TableCell>
              )}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/** 衛星指標の作り方（どの衛星データから、どう区画の値と点数にするか）。実データの部分と、まだ使っていない部分を印で分ける */
const INDICATOR_STAGES: { no: string; title: string; body: string; mark: string; real: boolean }[] = [
  {
    no: '1', title: '衛星データ: 国土地理院の干渉SAR成果（だいち2号・4号）',
    body: '提案書は Sentinel-1（欧州宇宙機関、観測幅250km、無料）の解析を主に想定しています。この画面は Sentinel-1 の解析結果ではなく、公開済みの国土地理院の成果（ALOS-2/4、Lバンド、約90m）で代用しています。',
    mark: '実データ（代用）', real: true,
  },
  {
    no: '2', title: '階級に戻す: 地表の動き（mm/年）',
    body: '地理院タイルの色を凡例の16階級（1階級 3.75 mm/年幅）に戻し、約90mの区画ごとに階級の中央値を取りました。値は階級の幅でしか言えず、小数の精度はありません。InSAR処理そのものは実装していません。',
    mark: '実データ（加工）', real: true,
  },
  {
    no: '3', title: '区画値: 0〜1 にそろえる',
    body: '区画ごとに、沈下が −8mm/年以下で1、動きなしで0（デモ上の便宜的な正規化）。この地区の階級は2種類だけで、差は階級幅以内。沈下の兆候とは言えず、点数は最大でも 0.23 です。',
    mark: 'この画面で計算', real: true,
  },
  {
    no: '4', title: '点数: 台帳と合わせる',
    body: '点数 ＝ 衛星の重み × 区画値 ＋ 台帳の重み × 管の古さ（60年で1）。台帳は豊中市の下水道管渠の竣工日（CC BY 4.0）。点数の高い区間から、地中レーダの調査対象を選ぶ。',
    mark: '実データ（台帳）', real: true,
  },
]
function IndicatorFlow() {
  return (
    <section className="space-y-1 rounded-md border bg-muted/30 p-2.5" aria-label="衛星指標の作り方" data-testid="indicator-flow">
      <h3 className="text-xs font-bold">衛星指標の作り方（4段階）</h3>
      <ol className="space-y-0.5">
        {INDICATOR_STAGES.map((st, i) => (
          <li key={st.no}>
            <div className={cn('rounded border bg-background px-2 py-1 text-xs', !st.real && 'border-dashed border-amber-500')}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-medium">{st.no}. {st.title}</span>
                <span className={cn('text-[10px]', st.real ? 'text-muted-foreground' : 'font-medium text-amber-800')}>◆ {st.mark}</span>
              </div>
              <p className="text-muted-foreground">{st.body}</p>
            </div>
            {i < INDICATOR_STAGES.length - 1 && <ArrowDown className="mx-auto my-0.5 size-3 text-muted-foreground" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-muted-foreground">
        衛星の階級は、この地区ではほぼ一様（-3.75〜+3.75 mm/年）で、衛星では絞れません。地理院成果の利用条件は要確認（出典・限界を参照）。
      </p>
    </section>
  )
}

/* ---------- 1 候補区間の点数を見る ---------- */
export function TopPanel({
  candidates, focus, onFocus,
}: { candidates: Scored[]; focus: string | null; onFocus: (id: string) => void }) {
  const km = candidates.reduce((a, s) => a + s.lenM, 0) / 1000
  const best = candidates[0]
  // 表示（小数2桁）で同点の区間
  const ties = best ? candidates.filter((s) => s.score.toFixed(2) === best.score.toFixed(2)) : []
  const tieIds = ties.slice(0, 3).map((s) => s.id).join('・') + (ties.length > 3 ? ` ほか${ties.length - 3}` : '')
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        点数 ＝ 衛星の指標と、下水道台帳の布設年の古さの重み付き和。衛星は空洞を直接見つけず、調べる順番を決める入口です。
      </p>
      <IndicatorFlow />
      <div className="grid grid-cols-2 gap-2">
        <Metric label="未調査の生活道路" value={`${candidates.length} 区間`} sub={`合計 ${fmt1(km)} km`} testId="m-count" />
        <Metric
          label={ties.length > 1 ? `点数が最も高い区間（同点 ${ties.length} 区間）` : '点数が最も高い区間'}
          value={best ? (ties.length > 1 ? tieIds : best.id) : '—'}
          sub={best ? `点数 ${best.score.toFixed(2)}${ties.length > 1 ? `（小数2桁で同点。表の1位は ${best.id}）` : `／区画 ${best.cell}／竣工 ${best.year ?? '不明'}${best.year == null ? '' : '年'}`}` : ''}
          testId="m-top"
        />
      </div>
      <div className="text-sm font-medium">点数の高い順 上位10区間（<b>行を1つ選ぶ</b>と地図に表示され、この手順が完了します）</div>
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
  budgetKm, setBudgetKm, segs, candidates, selected, toggle, focus, onFocus, onAuto, onClear, onExport,
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
  onExport: () => void
}) {
  const km = totalKm(segs, selected)
  const over = km > budgetKm + 1e-9
  const rows = candidates.filter((s, i) => i < 15 || selected.has(s.id))
  const top15 = new Set(candidates.slice(0, 15).map((s) => s.id))
  const inTop = [...selected].filter((id) => top15.has(id)).length
  return (
    <div className="space-y-3">
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 mb-1 space-y-1 border-b bg-background px-4 pb-2 pt-3 shadow-sm" aria-live="polite" data-testid="sel-sticky">
        <div className="flex items-baseline justify-between text-sm">
          <span>選択中 <b className="text-lg" data-testid="sel-count">{selected.size}</b> 区間</span>
          <span className={cn('font-medium', over && 'text-[#b45309]')} data-testid="sel-km">{fmt1(km)} / {fmt1(budgetKm)} km</span>
        </div>
        <Progress value={Math.min(100, (km / budgetKm) * 100)} className={over ? '[&>div]:bg-[#b45309]' : ''} />
        <div className="min-h-4 text-xs leading-4 text-muted-foreground" data-testid="sel-breakdown">
          {selected.size > 0 ? `上位15区間のうち ${inTop} 区間＋それ以外 ${selected.size - inTop} 区間を選びました。` : 'まだ区間を選んでいません。'}
        </div>
        {over && <div className="text-sm font-medium text-[#b45309]">▲ 上限を超えています。区間を外すか、延長を増やしてください。</div>}
      </div>

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
        <Button size="sm" variant="outline" onClick={onExport} disabled={selected.size === 0} data-testid="export-targets"><Download />調査対象をCSVで書き出す</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        延長の上限（{fmt1(budgetKm)}km）まで点数順に選ぶため、表の上位15に入らない区間も含まれます。地図の道路のタップでも選択／解除できます。
      </p>

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
          {rows.map((s, i) => (
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
              <TableCell className="text-right font-medium">
                {s.score.toFixed(2)}
                {/* 小数2桁で前後と同じなら「同点」（表の並びは小数3桁以下の差か、区間IDの順） */}
                {(rows[i - 1]?.score.toFixed(2) === s.score.toFixed(2) || rows[i + 1]?.score.toFixed(2) === s.score.toFixed(2)) && (
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground" data-testid="tie-mark">同点</span>
                )}
              </TableCell>
              <TableCell className="text-right">{s.lenM} m</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/* ---------- 4 調査結果を入れる ---------- */
export interface LoadInfo {
  name: string
  error: string | null
  summary: OutcomeSummary
}

const FORMATS: [string, string, string][] = [
  ['A. 区間ID', 'segment_id,cavity', 'この画面の区間ID（例 S0312）と、空洞あり／なし'],
  ['B. 緯度・経度の点', 'lat,lon,cavity', `点から ${LINK_MAX_M} m 以内で最も近い区間に結び付け（台帳なしの道路は除く）。同じ区間に複数点あれば「1つでもあり」ならあり`],
]

/** CSV の書式と見本。デモ中は入れられないので、閉じた details にまとめる */
function FormatBox({ demo, children }: { demo: boolean; children: React.ReactNode }) {
  if (demo) {
    return (
      <details className="rounded-md border p-2 text-sm" data-testid="fmt-box">
        <summary className="cursor-pointer font-medium">CSV の書式と見本（デモ中は入れられません）</summary>
        <div className="mt-2 space-y-1.5">{children}</div>
      </details>
    )
  }
  return <div className="space-y-1.5">{children}</div>
}

export function ScanPanel({
  demo, sample, userCsv, pastCount, onDemo, selected, segs, resultsCount, loadInfo, onFile, onClear, onDemoScan, onGoPick,
}: {
  demo: boolean
  sample?: boolean
  userCsv?: boolean
  pastCount?: number
  onDemo: (on: boolean) => void
  selected: Set<string>
  segs: Segment[]
  resultsCount: number
  loadInfo: LoadInfo | null
  onFile: (file: File) => void
  onClear: () => void
  onDemoScan: () => void
  onGoPick: () => void
}) {
  const km = totalKm(segs, selected)
  const sm = loadInfo?.summary
  const bad: string[] = []
  if (sm?.invalid) bad.push(`空洞の有無や座標が読めない行 ${sm.invalid}`)
  if (sm?.unknownId) bad.push(`存在しない区間ID ${sm.unknownId}`)
  if (sm?.unmatched) bad.push(`${LINK_MAX_M} m 以内に区間が無い点 ${sm.unmatched}`)
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <b>一次審査を通った後、地中レーダ探査車（GMS3）のデータで較正します。</b>この手順はその結果を受け取る枠です。GMS3 のデータは現時点で手元になく、この画面は使っていません。同梱している実データに空洞の結果はありません。
      </p>

      {demo ? (
        <div className="space-y-2 rounded-md border-l-4 border-amber-600 bg-amber-50 p-2.5 text-sm text-amber-950" data-testid="demo-on">
          <b>説明用デモ中（結果は架空）。</b>デモをオフにするまで、CSV は入れられません。
          <p>
            <b>過去の調査</b>（設定: 幹線すべてと生活道路の約6%を調査済みとした架空の結果）が最初から入っています。今回の走査は、手順2で選んだ <b data-testid="s3-count">{selected.size}</b> 区間（{fmt1(km)} km）が対象です。
          </p>
          {selected.size === 0 && resultsCount - (pastCount ?? 0) > 0 && (
            <p className="text-xs" data-testid="scan-done">今回の走査 {resultsCount - (pastCount ?? 0)} 区間を入れました。続けて、手順4で「較正を反映して次の回へ進む」を押します。</p>
          )}
          {selected.size === 0 && resultsCount - (pastCount ?? 0) <= 0 && (
            <p className="text-xs" data-testid="scan-hint">区間を選んでいないので、走査できません。<Button size="sm" variant="link" className="h-auto p-0 underline" onClick={onGoPick}>手順2で区間を選ぶ</Button></p>
          )}
          <Button variant={selected.size ? 'default' : 'outline'} size="sm" onClick={onDemoScan} disabled={selected.size === 0} data-testid="demo-scan"><Radar />走査結果を入れる（架空）</Button>
        </div>
      ) : (
        <div className="space-y-1.5 rounded-md border border-dashed border-primary/60 bg-background p-2.5">
          <label className="text-sm font-medium" htmlFor="csv-file">調査結果の CSV を選ぶ（累計で入ります。同じ区間は上書き）</label>
          <input
            id="csv-file"
            data-testid="csv-file"
            type="file"
            accept=".csv,.tsv,.txt,text/csv"
            className="block w-full text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-3 file:py-2"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
          <p className="text-xs text-muted-foreground">
            結果の CSV がなければ、見本（下の書式の説明にあります。架空の値）を入れるか、
            <Button size="sm" variant="link" className="h-auto p-0 text-xs underline" onClick={() => onDemo(true)} data-testid="demo-go">説明用デモで動きを見る（架空の結果）</Button>
            を押してください。
          </p>
        </div>
      )}

      <div aria-live="polite" data-testid="load-msg">
        {loadInfo?.error && <p className="text-sm font-bold text-red-800" data-testid="load-error">読み込めませんでした: {loadInfo.error}</p>}
        {loadInfo && !loadInfo.error && sm && sm.segments === 0 && (
          <p className="text-sm font-bold text-red-800" data-testid="load-error">
            読み込めませんでした: 使える行がありません（{sm.rows} 行のうち、{bad.length ? bad.join('、') : '空洞の有無・区間が読めない行'}）。
          </p>
        )}
        {loadInfo && !loadInfo.error && sm && sm.segments > 0 && (
          <p className="text-sm" data-testid="load-ok">
            「{loadInfo.name}」を読み込みました（{sm.rows} 行）: 区間IDで {sm.byId} 行、緯度・経度の点で {sm.byPoint} 行を区間に結び付け、<b>{sm.segments} 区間</b>の結果（空洞あり {sm.hit}・なし {sm.none}）。
            {sm.merged > 0 && `同じ区間への複数行 ${sm.merged} 行は「1つでもあり」ならありにまとめました${sm.conflicts ? `（あり・なしが食い違った区間 ${sm.conflicts}）` : ''}。`}
            {bad.length > 0 && <span className="block text-amber-800">使えなかった行: {bad.join('、')}。</span>}
          </p>
        )}
      </div>

      <p className="text-sm" data-testid="res-total">
        調査結果が入った区間: <b>{resultsCount}</b>{demo ? `（架空。過去の調査 ${pastCount ?? 0} 区間＋今回の走査 ${resultsCount - (pastCount ?? 0)} 区間）` : sample ? `（見本 CSV の架空の値${userCsv ? '。利用者の CSV を含む' : ''}）` : userCsv ? '（利用者の調査結果。実データかは利用者の責任）' : ''}
        {resultsCount > 0 && <Button size="sm" variant="outline" className="ml-2" onClick={onClear} data-testid="clear-res">結果を消す</Button>}
      </p>

      <FormatBox demo={demo}>
        <p className="text-xs text-muted-foreground">
          GMS3 の出力の書式は<b>未確認</b>です。そこで次の<b>2つの書き方のどちらの CSV でも</b>受け付け、同じように較正します（1行目は見出し。区切りはカンマかタブ。処理はこのブラウザの中だけで、外へは送りません）。
        </p>
        <Table>
          <TableHeader><TableRow><TableHead>書き方</TableHead><TableHead>見出しの例</TableHead><TableHead>内容</TableHead></TableRow></TableHeader>
          <TableBody>
            {FORMATS.map(([a, b, c]) => (
              <TableRow key={a}><TableCell className="whitespace-normal">{a}</TableCell><TableCell><code className="text-xs">{b}</code></TableCell><TableCell className="whitespace-normal text-xs">{c}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          空洞の列の値は「あり／なし」「1／0」「true／false」「空洞あり／空洞なし」「疑い／異常なし」を読めます。見本:{' '}
          <a className="text-primary underline" href={dataUrl('sat-a', 'format_sample_by_segment.csv')} download>区間IDの見本</a>・
          <a className="text-primary underline" href={dataUrl('sat-a', 'format_sample_by_point.csv')} download>緯度・経度の見本</a>
          （書式を示すだけの仮の値で、調査結果ではありません）。
        </p>
      </FormatBox>

      <div className="rounded-md border p-2.5 text-xs">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 size-4" checked={demo} onChange={(e) => onDemo(e.target.checked)} data-testid="demo-toggle" />
          <span>
            <b>説明用デモをオンにする（架空の結果で動きを見る）。既定はオフ。</b>
            <span className="block text-muted-foreground">
              実データには空洞の結果が無いため、動きを見せるためだけの機能です。オンにすると<b>地中レーダの結果が乱数（架空）</b>になり、オンの間は地図に「架空」と出し続けます。オン・オフを切り替えると、入れた結果と較正は初めからになります。
            </span>
          </span>
        </label>
      </div>
    </div>
  )
}

/* ---------- 5 較正を反映して第2回へ ---------- */
export function ApplyPanel({
  round, calib, surveyed, cellSat, resultsCount, demo, sample, applied, onApply, onGoRound2, onGoScan, onDemoOn,
}: {
  sample?: boolean
  round: number
  calib: CalibResult
  surveyed: Scanned[]
  cellSat: CellSat
  resultsCount: number
  demo: boolean
  applied: PrevInfo | null
  onApply: () => void
  onGoRound2?: () => void
  onGoScan: () => void
  onDemoOn: () => void
}) {
  return (
    <div className="space-y-3">
      {applied && (
        <Alert className="border-primary/40 bg-primary/5">
          <AlertTitle>第{round}回に反映済みです</AlertTitle>
          <AlertDescription className="text-foreground">
            衛星指標の重みは {pct(applied.oldW)}% → {pct(applied.newW)}%。結果は、左の手順リストの「第2回の順位を確かめる」を押すと見られます。
          </AlertDescription>
        </Alert>
      )}
      {resultsCount === 0 && (
        <Alert data-testid="apply-empty">
          <AlertDescription className="space-y-2">
            <p>まだ調査結果がないので、較正はしません（重みは変えません）。</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onGoScan} data-testid="goto-scan">手順3で CSV を入れる</Button>
              <Button size="sm" variant="outline" onClick={onDemoOn} data-testid="apply-demo-on">説明用デモで動きを見る（架空の結果）</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {resultsCount > 0 && calib.w === null && (
        <Alert className="border-amber-500 bg-amber-50 text-amber-950">
          <AlertTitle>較正に使える結果が不足しています</AlertTitle>
          <AlertDescription className="space-y-2 text-amber-900">
            <p>空洞あり {calib.pos} 件・なし {calib.neg} 件（各3件以上で較正）。重みは変えません。</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onGoScan} data-testid="goto-scan">手順3で CSV を足す</Button>
              {!demo && <Button size="sm" variant="outline" onClick={onDemoOn} data-testid="apply-demo-on">説明用デモで動きを見る（架空の結果）</Button>}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {calib.w !== null && (
        <>
          <p className="text-sm">
            入った結果（{calib.n} 区間）に照らして、重みを探しました。{(demo || sample) && <b>空洞の有無はすべて架空です。</b>}
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
            AUC: 空洞のあった区間が、なかった区間より高い点数になる確率。0.5＝でたらめ（当てずっぽう）と同じ、1.0＝完全に当たる。
            {calib.ex1 && `点数が下位の半分とした区間（${calib.ex1.n}区間）のうち空洞なしだった割合は ${pct(calib.ex1.rate)}%${calib.ex0 ? `（現在の重みでは ${pct(calib.ex0.rate)}%）` : ''}。`}
            {demo || sample
              ? '空洞の有無が架空のため、仕組みを見せる数字であり、実際の精度や提案の効果を示しません。'
              : '調査した区間は点数の高い所に偏って選ばれやすく、この数字は調査した区間の中での比較です。実際の精度・効果を示すものではありません。'}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {applied && onGoRound2 && <Button size="sm" onClick={onGoRound2} data-testid="goto-round2">第{round}回の順位を見る（手順5へ）</Button>}
        <Button size="sm" variant={applied && onGoRound2 ? 'outline' : 'default'} onClick={onApply} disabled={calib.w === null} data-testid="apply">較正を反映して第{round + 1}回へ進む</Button>
      </div>
    </div>
  )
}

/* ---------- 6 第2回の順位を確かめる ---------- */
export function Round2Panel({
  round, msg, prev, candidates, focus, onFocus, onExport, demo, sample, onGoScan, onDemoOn,
}: {
  demo: boolean
  sample?: boolean
  onGoScan: () => void
  onDemoOn: () => void
  round: number
  msg: string
  prev: PrevInfo | null
  candidates: Scored[]
  focus: string | null
  onFocus: (id: string) => void
  onExport: () => void
}) {
  if (!prev || round < 2) {
    return (
      <Alert data-testid="round2-empty">
        <AlertDescription className="space-y-2">
          <p>第2回の順位はまだありません。「較正を反映して第2回へ進む」まで済ませると、ここに第1回との対比が出ます。</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onGoScan} data-testid="goto-scan">手順3へ戻って CSV を入れる</Button>
            <Button size="sm" variant="outline" onClick={onDemoOn} data-testid="round2-demo-on">説明用デモで動きを見る（架空の結果）</Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="space-y-3">
      {demo && (
        <div className="rounded-md border-l-4 border-amber-600 bg-amber-50 p-2 text-sm font-bold text-amber-950" data-testid="round2-fake">
          架空の結果による第{round}回です（説明用デモ。地中レーダの結果は乱数で、実際の調査結果ではありません）。
        </div>
      )}
      {!demo && sample && (
        <div className="rounded-md border-l-4 border-amber-600 bg-amber-50 p-2 text-sm font-bold text-amber-950" data-testid="round2-fake">
          見本 CSV（架空の値）による第{round}回です。地中レーダの結果は書式を示す仮の値で、実際の調査結果ではありません。
        </div>
      )}
      <p className="text-sm font-medium" data-testid="what-changed">
        {prev.calibrated
          ? prev.newW === prev.oldW
          ? `何が変わったか: 調査結果に照らしても重み（衛星${pct(prev.newW)}%）は変わらず、調査した${prev.scanned}区間を除いた順位を作り直しました。`
          : `何が変わったか: 調査結果に照らして当たりやすい重み（衛星${pct(prev.newW)}%）に更新し、調査した${prev.scanned}区間を除いた順位を作り直しました。`
          : `何が変わったか: 結果が不足していたため重みは据え置き、調査した${prev.scanned}区間を除いた順位を作り直しました。`}
      </p>
      <p className="text-xs text-muted-foreground" data-testid="calib-msg">{msg}</p>
      <p className="text-xs text-muted-foreground">下の表の1位は、第{prev.round}回の重みのままの1位と、反映後の1位を比べたものです。</p>
      <Table>
        <TableHeader>
          <TableRow><TableHead>項目</TableHead><TableHead className="text-right">第{prev.round}回</TableHead><TableHead className="text-right">第{round}回</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          <TableRow><TableCell>衛星指標の重み</TableCell><TableCell className="text-right">{pct(prev.oldW)}%</TableCell><TableCell className="text-right">{pct(prev.newW)}%</TableCell></TableRow>
          <TableRow>
            <TableCell className="whitespace-normal">調査した区間を除いた候補の1位</TableCell>
            <TableCell className="text-right">{prev.topId}</TableCell>
            <TableCell className="text-right">{prev.topId === prev.newTopId ? `${prev.newTopId}（同じ）` : prev.newTopId}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>上位10の入れ替わり</TableCell><TableCell className="text-right">—</TableCell>
            <TableCell className="text-right" data-testid="changed">{prev.changed} 区間</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div className="text-sm font-medium">第{round}回の順位 上位10区間（「第1回からの変化」は、第{prev.round}回の重みのまま調査した区間を除いて並べ直した順位との比較です）</div>
      <RankTable rows={candidates.slice(0, 10)} focus={focus} onFocus={onFocus} prev={prev} />
      <Button size="sm" variant="outline" onClick={onExport} data-testid="export-round2"><Download />第{round}回の順位をCSVで書き出す</Button>
    </div>
  )
}
