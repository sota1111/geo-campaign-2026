import { useMemo, useState } from 'react'
import { FlaskConical } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Slider } from '@/components/ui/slider'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DEFAULT_WEIGHTS, clone, rank, type Dataset } from './lib'

/**
 * 衛星由来の変化量が入ると、点数と順位がどう変わるかを、架空の12地点で比べる。
 * 実データ（横須賀市の716か所）には触れない。変化の種類・検出日・配点はすべて架空・仮置き。
 * 倍率 0% ＝ 実データ版の今の状態（衛星由来の変化量が未接続）と同じ作り。
 */
export function SatContrast({ fictional, onTouched }: { fictional: Dataset; onTouched: () => void }) {
  const [pctV, setPctV] = useState(100)
  const base = useMemo(() => {
    const w = clone(DEFAULT_WEIGHTS)
    w.change = { 新設: 0, 拡大: 0, 変位: 0, 植生消失: 0 }
    return rank(fictional.sites, w, fictional.refDate, [], 'sample')
  }, [fictional])
  const withSat = useMemo(() => {
    const w = clone(DEFAULT_WEIGHTS)
    for (const k of Object.keys(w.change)) w.change[k] = Math.round((w.change[k] * pctV) / 100)
    return rank(fictional.sites, w, fictional.refDate, [], 'sample')
  }, [fictional, pctV])
  const baseRank = new Map(base.map((s) => [s.id, s]))
  const moved = withSat.filter((s) => baseRank.get(s.id)?.rank !== s.rank).length
  const top5Base = new Set(base.slice(0, 5).map((s) => s.id))
  const top5Changed = withSat.slice(0, 5).filter((s) => !top5Base.has(s.id)).length

  return (
    <div className="space-y-3 text-sm" data-testid="sat-contrast">
      <Alert className="border-dashed border-amber-500 bg-amber-50">
        <FlaskConical className="size-4" />
        <AlertTitle>架空の地点での比較です</AlertTitle>
        <AlertDescription className="text-amber-950">
          <p>
            実データではありません。ここの地点名・変化の種類・検出日・配点はすべて架空・仮置きで、横須賀市の実データとは無関係です。実際の衛星解析の結果でもありません。
            「衛星由来の変化量が点数に入る」と順位がどう動くかの仕組みだけを見せています。
          </p>
        </AlertDescription>
      </Alert>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium" id="sat-contrast-label">衛星由来の変化量の配点（架空）</label>
          <span className="text-lg font-bold" data-testid="sat-contrast-out">{pctV}%</span>
        </div>
        <Slider
          value={[pctV]} min={0} max={100} step={25} aria-labelledby="sat-contrast-label"
          onValueChange={([v]) => { setPctV(v); onTouched() }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0% 未接続と同じ（実データ版の今）</span>
          <span>100% 仮置きの配点どおり</span>
        </div>
      </div>
      <p className="text-xs" aria-live="polite" data-testid="sat-contrast-summary">
        {pctV === 0
          ? '変化量を点数に入れていない状態です。順位は「変化なし」の列と同じです。'
          : `順位が変わった地点は ${moved} か所、上位5か所に新しく入った地点は ${top5Changed} か所です（架空値）。`}
      </p>
      <div className="overflow-x-auto rounded-md border [&_td]:px-1.5 [&_th]:px-1.5">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>順位<div className="text-[10px] font-normal text-muted-foreground">変化なし→今</div></TableHead>
              <TableHead>架空の地点（変化の種類）</TableHead>
              <TableHead className="text-right">点数<div className="text-[10px] font-normal text-muted-foreground">変化なし→今</div></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {withSat.map((s) => {
              const b = baseRank.get(s.id)!
              const d = b.rank - s.rank
              return (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {b.rank}位 → <b>{s.rank}位</b>{' '}
                    <span className="text-muted-foreground">{d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : '→'}</span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs">{s.name}<span className="text-muted-foreground">（{s.change}）</span></TableCell>
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
