import { forwardRef } from 'react'
import { Check, X, Copy, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { TIPS, Term } from './Term'
import {
  DAY_FULL, DAY_LABEL, PERIOD_LABEL, fmtMin, type Day, type Last, type RegionData, type Status, type Verdict,
} from './lib'

export interface CondState { fi: number; day: Day; per: 'm' | 'd' | 'e'; w: number }

const STATUS_NOTE: Record<Status, string> = {
  walk: '歩いて着ける距離です（バスに乗らなくても行けます）',
  transit: '公共交通（バスなど）に乗って着けます',
  rail: '収録した範囲では着けません（近くに未収録の鉄道駅があります）',
  none: '歩いても、収録した公共交通でも着けません',
}

export interface Nearest { name: string; m: number; wd: number[]; hol: number[] }
export interface NearFacility { name: string; m: number; min: number }

export interface ConclusionProps {
  data: RegionData | null
  cond: CondState
  hasPoint: boolean
  placeLabel: string
  verdict: Verdict | null
  popInfo: { pop: number; pop65: number } | null
  /** 近くの停留所のうち一番遅い最終便 */
  lastWd: Last | null
  lastHol: Last | null
  nearCount: number
  nearest: Nearest | null
  facility: NearFacility | null
  /** 公共交通で着ける時の「N分以内」区分（徒歩・着けない時は null） */
  transitLevel: string | null
  walkInM: number
  copyText: string
  onCopy: () => void
  copied: boolean
  isLocal: boolean
  stations: { label: string; q: string }[]
  onStation: (q: string) => void
  loading: boolean
}

const wdLast = (n: Nearest, k: 'wd' | 'hol') => (n[k][3] > 0 ? fmtMin(n[k][5]) : '運行なし')

/** 「この地点の結論」カード。画面の最上段に置き、住所を入れたらここを見ればよい */
export const Conclusion = forwardRef<HTMLDivElement, ConclusionProps>(function Conclusion(p, ref) {
  const { data, cond, verdict: v } = p
  const fl = data ? data.facility_labels[data.facility_order[cond.fi]] : ''
  const hr = data ? data.params.start_hours[cond.per] : 0
  const condText = `${DAY_FULL[cond.day]}・${PERIOD_LABEL[cond.per]}${hr}時に出発・${cond.w}分以内・${fl}`
  // 一番遅い便が最寄りの停留所と別の停留所・別の時刻のときだけ「少し歩けば」として添える
  const farther = (l: Last | null, day: 'wd' | 'hol') =>
    l && p.nearest && l.t > (p.nearest[day][3] > 0 ? p.nearest[day][5] : -1) ? l : null
  const farWd = farther(p.lastWd, 'wd')
  const farHol = farther(p.lastHol, 'hol')
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
        {!data && (
          <div className="space-y-3" aria-busy="true" aria-label="読み込み中">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        )}
        {data && !p.hasPoint && (
          <div className="space-y-2">
            <p className="font-medium">まだ地点が選ばれていません。</p>
            <p className="text-muted-foreground">場所を決めると、ここに「行けます／行けません」と最終便の時刻が出ます（条件は「{condText}」）。手順は左のサイドバー（スマホは上部）に順に出ています。</p>
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">駅名の例:</span>
              {p.stations.map((s) => (
                <Button key={s.q} variant="outline" size="sm" onClick={() => p.onStation(s.q)} disabled={p.loading}>{s.label}</Button>
              ))}
            </div>
          </div>
        )}
        {data && p.hasPoint && !v && (
          <div className="rounded-md border-2 border-orange-600 bg-orange-50 p-3 text-orange-950">
            <p className="text-lg font-bold">この地点は診断範囲外です</p>
            <p>収録した停留所から{data.params.diag_radius_m}m以内の人口のある区画だけを診断しています（停留所から遠い、または人口データなし）。</p>
          </div>
        )}
        {data && p.hasPoint && v && (
          <>
            <div className={`rounded-md border-2 p-3 ${v.ok ? 'border-blue-700 bg-blue-50 text-blue-950' : 'border-orange-600 bg-orange-50 text-orange-950'}`}>
              <p className="flex items-center gap-2 text-xl font-bold" data-testid="verdict-main">
                {v.ok ? <Check className="size-6" /> : <X className="size-6" />}
                {fl}へ {cond.w}分以内に {v.yesNo}
              </p>
              <p className="mt-1">{STATUS_NOTE[v.status]}。{v.extra}</p>
              <div className="mt-2 border-t border-current/20 pt-2 text-sm" data-testid="verdict-basis">
                <p className="font-medium">根拠</p>
                {p.facility && (
                  <p>
                    いちばん近い{fl}: <b>{p.facility.name}</b>（直線で約{p.facility.m}m・<Term tip={TIPS.walk}>徒歩の目安</Term>約{p.facility.min}分）
                  </p>
                )}
                {v.status === 'walk' && <p>歩きだけで{cond.w}分以内に着ける、と計算した地点です。</p>}
                {v.status === 'transit' && (
                  <p>公共交通（乗り継ぎ・待ち時間を含む）で <b>{p.transitLevel ?? `${cond.w}分以内`}</b> に着ける区分です。乗る路線・経路は元データにないため表示できません（近くの停留所と路線は「近くの停留所」タブ）。</p>
                )}
                {!v.ok && <p>最寄りの{fl}までは、{cond.w}分以内には着けない計算です。</p>}
                <p className="text-xs opacity-80">最寄りの{fl}は直線距離で選んだ目安で、実際に向かう{fl}とは限りません。</p>
              </div>
            </div>

          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <Button size="lg" onClick={p.onCopy} className="h-12 w-full text-base" data-testid="copy-conclusion">
                {p.copied ? <Check className="size-5" /> : <Copy className="size-5" />}
                {p.copied ? 'コピーしました' : '結論とリンクをコピー'}
              </Button>
              <p className="text-sm font-medium text-blue-800" role="status" data-testid="copy-done">
                {p.copied ? 'コピーしました。LINEやメールに貼り付けて送れます。' : '押すと、この結論とこの画面へのリンクがコピーされます（家族に送れます）。'}
              </p>
              <label className="block text-xs text-muted-foreground" htmlFor="odpt-copy-preview">コピーされる文面（自動でコピーできない時は、ここを選んでコピー）</label>
              <Textarea id="odpt-copy-preview" readOnly rows={4} value={p.copyText} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              {p.isLocal && <p className="text-xs text-muted-foreground">※いまは手元の確認用アドレスです。公開後のアドレスで共有すると、相手も開けます。</p>}
            </div>
        

            <div data-testid="compare-days">
              <p className="mb-1 font-medium">平日と休日（日曜ダイヤ）の違い（{PERIOD_LABEL[cond.per]}{hr}時発・{cond.w}分以内）</p>
              <div className="grid grid-cols-2 gap-2">
                {(['wd', 'hol'] as Day[]).map((d) => {
                  const cur = d === cond.day
                  const ok = cur ? v.ok : v.otherOk
                  return (
                    <div key={d} className={`rounded-md border p-2 ${cur ? 'border-2 border-foreground' : ''}`}>
                      <div className="text-xs text-muted-foreground">{DAY_LABEL[d]}{d === 'hol' ? <>（<Term tip={TIPS.sunday}>日曜ダイヤ</Term>）</> : ''}{cur ? '・選択中' : ''}</div>
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

        {data && p.hasPoint && (
          <div data-testid="last-bus">
            <p className="font-medium">いちばん近い停留所の最終便</p>
            {p.nearCount === 0 || !p.nearest ? (
              <p className="text-muted-foreground">半径{p.walkInM}m以内に停留所がありません。公共交通の空白地の可能性があります（収録事業者のみ対象）。</p>
            ) : (
              <>
                <p className="text-base">
                  <b>{p.nearest.name}</b>（約{p.nearest.m}m）
                </p>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-t"><th className="py-1.5 pr-3 text-left font-medium">平日の最終</th><td className="py-1.5"><b className="text-lg">{wdLast(p.nearest, 'wd')}</b>{p.nearest.wd[3] > 0 && ' 発'}</td></tr>
                    <tr className="border-t"><th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">休日（日曜）の最終</th><td className="py-1.5"><b className="text-lg">{wdLast(p.nearest, 'hol')}</b>{p.nearest.hol[3] > 0 && ' 発'}</td></tr>
                  </tbody>
                </table>
                {(farWd || farHol) && (
                  <p className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground" data-testid="far-last-bus">
                    <b>少し歩けば（参考）</b>: 半径{p.walkInM}m以内でもっと遅くまである停留所
                    {farWd && <> 平日 {fmtMin(farWd.t)}（{farWd.name}・約{farWd.m}m）</>}
                    {farWd && farHol && '／'}
                    {farHol && <> 休日 {fmtMin(farHol.t)}（{farHol.name}・約{farHol.m}m）</>}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {data && p.hasPoint && p.popInfo && (
          <p className="text-xs text-muted-foreground">
            この<Term tip={TIPS.mesh}>約500m四方のエリア</Term>の人口 {p.popInfo.pop}人（65歳以上 {p.popInfo.pop65}人）。人数は<Term tip={TIPS.hide}>概数</Term>です。
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          時刻表データによる推計で、実際の運行を保証するものではありません。収録した事業者のバスのみが対象で、鉄道・予約制の便・病院の診療時間は評価していません。
        </p>
      </CardContent>
    </Card>
  )
})
