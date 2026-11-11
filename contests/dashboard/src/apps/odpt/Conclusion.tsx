import { forwardRef } from 'react'
import { Check, X, Copy, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  DAY_FULL, DAY_LABEL, PERIOD_LABEL, fmtMin, type Day, type Last, type RegionData, type Status, type Verdict,
} from './lib'

export interface CondState { fi: number; day: Day; per: 'm' | 'd' | 'e'; w: number }

const STATUS_NOTE: Record<Status, string> = {
  walk: '徒歩で着ける距離です',
  transit: '公共交通（バスなど）に乗って着けます',
  rail: '収録した範囲では着けません（近くに未収録の鉄道駅あり）',
  none: '歩いても、収録した公共交通でも着けません',
}

function LastLine({ day, last }: { day: Day; last: Last | null }) {
  return (
    <tr className="border-t">
      <th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">{DAY_FULL[day]}</th>
      <td className="py-1.5">
        {last ? (
          <>
            <b className="text-base">{fmtMin(last.t)}</b> 発が最終
            <span className="block text-xs text-muted-foreground">{last.name}（約{last.m}m）</span>
          </>
        ) : (
          <span>運行なし</span>
        )}
      </td>
    </tr>
  )
}

export interface ConclusionProps {
  data: RegionData | null
  cond: CondState
  hasPoint: boolean
  placeLabel: string
  verdict: Verdict | null
  popInfo: { pop: number; pop65: number } | null
  lastWd: Last | null
  lastHol: Last | null
  nearCount: number
  nearest: { name: string; m: number; wd: number[]; hol: number[] } | null
  walkInM: number
  copyText: string
  onCopy: () => void
  copied: boolean
  onExample: () => void
  loading: boolean
}

/** 「この地点の結論」カード。画面の最上段に置き、住所を入れたらここを見ればよい */
export const Conclusion = forwardRef<HTMLDivElement, ConclusionProps>(function Conclusion(p, ref) {
  const { data, cond, verdict: v } = p
  const fl = data ? data.facility_labels[data.facility_order[cond.fi]] : ''
  const hr = data ? data.params.start_hours[cond.per] : 0
  const condText = `${DAY_FULL[cond.day]}・${PERIOD_LABEL[cond.per]}${hr}時に出発・${cond.w}分以内・${fl}`
  return (
    <Card ref={ref} className="scroll-mt-2 border-2" aria-live="polite" data-testid="conclusion">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <MapPin className="size-5" />この地点の結論
          {p.hasPoint && p.placeLabel && <Badge variant="secondary" className="max-w-full truncate">{p.placeLabel}</Badge>}
        </CardTitle>
        {data && <p className="text-xs text-muted-foreground">いまの条件: {condText}</p>}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!p.hasPoint && (
          <div className="space-y-2">
            <p className="font-medium">まだ地点が選ばれていません。</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>左（スマホでは上）の「住所・駅名で探す」に場所を入れて「探す」を押す（または地図をタップ）</li>
              <li>行き先・曜日・出発・許容時間を選ぶ（すでに「病院・平日・朝・30分」が選ばれています）</li>
              <li>ここに「行けます／行けません」と最終便の時刻が出ます。「結論とリンクをコピー」で家族に送れます</li>
            </ol>
            <Button variant="outline" size="sm" onClick={p.onExample} disabled={p.loading}>例: 「富山市大町」で試す</Button>
          </div>
        )}
        {p.hasPoint && !v && (
          <div className="rounded-md border-2 border-orange-600 bg-orange-50 p-3 text-orange-950">
            <p className="text-lg font-bold">この地点は診断範囲外です</p>
            <p>収録した停留所から{data?.params.diag_radius_m}m以内の人口メッシュだけを診断しています（停留所から遠い、または人口データなし）。</p>
          </div>
        )}
        {p.hasPoint && v && (
          <>
            <div
              className={`rounded-md border-2 p-3 ${v.ok ? 'border-blue-700 bg-blue-50 text-blue-950' : 'border-orange-600 bg-orange-50 text-orange-950'}`}
            >
              <p className="flex items-center gap-2 text-xl font-bold" data-testid="verdict-main">
                {v.ok ? <Check className="size-6" /> : <X className="size-6" />}
                {fl}へ {cond.w}分以内に {v.yesNo}
              </p>
              <p className="mt-1">{STATUS_NOTE[v.status]}。{v.extra}</p>
            </div>

            <div>
              <p className="mb-1 font-medium">平日と休日（日曜ダイヤ）の違い（{PERIOD_LABEL[cond.per]}{hr}時発・{cond.w}分以内）</p>
              <div className="grid grid-cols-2 gap-2">
                {(['wd', 'hol'] as Day[]).map((d) => {
                  const cur = d === cond.day
                  const ok = cur ? v.ok : v.otherOk
                  return (
                    <div key={d} className={`rounded-md border p-2 ${cur ? 'border-2 border-foreground' : ''}`}>
                      <div className="text-xs text-muted-foreground">{DAY_LABEL[d]}{d === 'hol' ? '（日曜ダイヤ）' : ''}{cur ? '・選択中' : ''}</div>
                      <div className="flex items-center gap-1 font-bold">
                        {ok ? <Check className="size-4 text-blue-700" /> : <X className="size-4 text-orange-700" />}
                        {cur ? v.yesNo : v.otherYesNo}
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-1 text-muted-foreground">{v.cmp}</p>
            </div>
          </>
        )}

        {p.hasPoint && (
          <div>
            <p className="font-medium">近くの停留所の最終便（半径{p.walkInM}m以内で一番遅い発車）</p>
            {p.nearCount === 0 ? (
              <p className="text-muted-foreground">半径{p.walkInM}m以内に停留所がありません。公共交通の空白地の可能性があります（収録事業者のみ対象）。</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  <LastLine day="wd" last={p.lastWd} />
                  <LastLine day="hol" last={p.lastHol} />
                </tbody>
              </table>
            )}
            {p.nearest && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid="nearest-stop">
                いちばん近い停留所: {p.nearest.name}（約{p.nearest.m}m）の最終は 平日 {p.nearest.wd[3] > 0 ? fmtMin(p.nearest.wd[5]) : '運行なし'}／休日（日曜ダイヤ） {p.nearest.hol[3] > 0 ? fmtMin(p.nearest.hol[5]) : '運行なし'}
              </p>
            )}
          </div>
        )}

        {p.hasPoint && p.popInfo && (
          <p className="text-xs text-muted-foreground">
            この500mメッシュの人口 {p.popInfo.pop}人（65歳以上 {p.popInfo.pop65}人。秘匿処理による増減あり）
          </p>
        )}

        {p.hasPoint && (
          <div className="space-y-2 border-t pt-3">
            <Button onClick={p.onCopy} className="w-full sm:w-auto" data-testid="copy-conclusion">
              {p.copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {p.copied ? 'コピーしました' : '結論とリンクをコピー'}
            </Button>
            <label className="block text-xs text-muted-foreground" htmlFor="odpt-copy-preview">
              コピーされる文面（コピーできない端末では、ここを長押し・選択してコピーしてください）
            </label>
            <Textarea id="odpt-copy-preview" readOnly rows={6} value={p.copyText} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          時刻表データによる推計で、実際の運行を保証するものではありません。収録した事業者のバスのみが対象で、鉄道・デマンド交通・施設の診療時間は評価していません。
        </p>
      </CardContent>
    </Card>
  )
})
