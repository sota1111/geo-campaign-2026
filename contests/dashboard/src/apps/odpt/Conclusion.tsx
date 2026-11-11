import { Check, X, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TIPS, Term } from './Term'
import {
  DAY_FULL, DAY_LABEL, PERIOD_LABEL, fmtMin, type Day, type Last, type RegionData, type Status, type Verdict,
} from './lib'

export interface CondState { fi: number; day: Day; per: 'm' | 'd' | 'e'; w: number }
export interface Nearest { name: string; m: number; wd: number[]; hol: number[] }
export interface NearFacility { name: string; m: number; min: number }

const STATUS_NOTE: Record<Status, string> = {
  walk: '歩いて着ける距離です（バスに乗らなくても行けます）',
  transit: '公共交通（バスなど）に乗って着けます',
  rail: '収録した範囲では着けません（近くに未収録の鉄道駅があります）',
  none: '歩いても、収録した公共交通でも着けません',
}

export interface DiagView {
  data: RegionData
  cond: CondState
  placeLabel: string
  verdict: Verdict | null
  popInfo: { pop: number; pop65: number } | null
  lastWd: Last | null
  lastHol: Last | null
  nearCount: number
  nearest: Nearest | null
  facility: NearFacility | null
  transitLevel: string | null
  walkInM: number
}

export const condText = (data: RegionData, c: CondState) =>
  `${DAY_FULL[c.day]}・${PERIOD_LABEL[c.per]}${data.params.start_hours[c.per]}時に出発・${c.w}分以内・${data.facility_labels[data.facility_order[c.fi]]}`

/** 地点が未選択のときの案内（各手順パネルの先頭） */
export function NoPoint({ text = '先に「場所を決める」で地点を選んでください。' }: { text?: string }) {
  return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{text}</p>
}

/** 地図上の小さな要点（全手順で見える1か所） */
export function MapSummary({ d, hasPoint }: { d: DiagView | null; hasPoint: boolean }) {
  if (!d) return null
  const v = d.verdict
  const fl = d.data.facility_labels[d.data.facility_order[d.cond.fi]]
  return (
    <div className="pointer-events-none absolute left-2 top-12 z-10 max-w-[min(20rem,calc(100%-1rem))] rounded-md border bg-white/95 px-2.5 py-1.5 text-xs shadow" data-testid="map-summary" aria-live="polite">
      <div className="text-muted-foreground">{DAY_LABEL[d.cond.day]}・{PERIOD_LABEL[d.cond.per]}{d.data.params.start_hours[d.cond.per]}時・{d.cond.w}分以内・{fl}</div>
      {!hasPoint && <div className="font-medium">地点を選ぶと結論がここに出ます</div>}
      {hasPoint && !v && <div className="font-bold text-orange-800">診断範囲外の地点</div>}
      {hasPoint && v && (
        <div className={`flex items-center gap-1 text-sm font-bold ${v.ok ? 'text-blue-900' : 'text-orange-800'}`}>
          {v.ok ? <Check className="size-4" /> : <X className="size-4" />}{v.yesNo}
        </div>
      )}
    </div>
  )
}

/** 手順3: 結論 */
export function VerdictPanel({ d }: { d: DiagView }) {
  const { data, cond, verdict: v } = d
  const fl = data.facility_labels[data.facility_order[cond.fi]]
  if (!v) {
    return (
      <div className="rounded-md border-2 border-orange-600 bg-orange-50 p-3 text-orange-950">
        <p className="text-lg font-bold">この地点は診断範囲外です</p>
        <p className="text-sm">収録した停留所から{data.params.diag_radius_m}m以内の人口のある区画だけを診断しています（停留所から遠い、または人口データなし）。</p>
      </div>
    )
  }
  return (
    <div className="space-y-3 text-sm">
      {d.placeLabel && <p className="text-xs text-muted-foreground">場所: {d.placeLabel}</p>}
      <div className={`rounded-md border-2 p-3 ${v.ok ? 'border-blue-700 bg-blue-50 text-blue-950' : 'border-orange-600 bg-orange-50 text-orange-950'}`}>
        <p className="flex items-center gap-2 text-xl font-bold" data-testid="verdict-main">
          {v.ok ? <Check className="size-6 shrink-0" /> : <X className="size-6 shrink-0" />}
          <span>{fl}へ {cond.w}分以内に {v.yesNo}</span>
        </p>
        <p className="mt-1">{STATUS_NOTE[v.status]}。{v.extra}</p>
        <div className="mt-2 border-t border-current/20 pt-2" data-testid="verdict-basis">
          <p className="font-medium">根拠</p>
          {d.facility && (
            <p>いちばん近い{fl}: <b>{d.facility.name}</b>（直線で約{d.facility.m}m・<Term tip={TIPS.walk}>徒歩の目安</Term>約{d.facility.min}分）</p>
          )}
          {v.status === 'walk' && <p>歩きだけで{cond.w}分以内に着ける、と計算した地点です。</p>}
          {v.status === 'transit' && (
            <p>公共交通（乗り継ぎ・待ち時間を含む）で <b>{d.transitLevel ?? `${cond.w}分以内`}</b> に着ける区分です。乗る路線・経路は元データにないため表示できません。</p>
          )}
          {!v.ok && <p>最寄りの{fl}までは、{cond.w}分以内には着けない計算です。</p>}
          <p className="text-xs opacity-80">最寄りの{fl}は直線距離で選んだ目安で、実際に向かう{fl}とは限りません。</p>
        </div>
      </div>
      {d.popInfo && (
        <p className="text-xs text-muted-foreground">
          この<Term tip={TIPS.mesh}>約500m四方のエリア</Term>の人口 {d.popInfo.pop}人（65歳以上 {d.popInfo.pop65}人）。人数は<Term tip={TIPS.hide}>概数</Term>です。
        </p>
      )}
      <p className="text-xs text-muted-foreground">時刻表データによる推計で、実際の運行を保証するものではありません。収録した事業者のバスのみが対象で、鉄道・予約制の便・病院の診療時間は評価していません。</p>
    </div>
  )
}

/** 手順4: 平日と休日の比較 */
export function HolPanel({ d }: { d: DiagView }) {
  const { data, cond, verdict: v } = d
  if (!v) return <NoPoint text="この地点は診断範囲外のため、比べられません。別の地点を選んでください。" />
  const hr = data.params.start_hours[cond.per]
  return (
    <div className="space-y-2 text-sm" data-testid="compare-days">
      <p className="font-medium">{PERIOD_LABEL[cond.per]}{hr}時発・{cond.w}分以内・{data.facility_labels[data.facility_order[cond.fi]]}</p>
      <div className="grid grid-cols-2 gap-2">
        {(['wd', 'hol'] as Day[]).map((day) => {
          const cur = day === cond.day
          const ok = cur ? v.ok : v.otherOk
          return (
            <div key={day} className={`rounded-md border p-2 ${cur ? 'border-2 border-foreground' : ''}`}>
              <div className="text-xs text-muted-foreground">{DAY_LABEL[day]}{day === 'hol' ? <>（<Term tip={TIPS.sunday}>日曜ダイヤ</Term>）</> : ''}{cur ? '・選択中' : ''}</div>
              <div className="flex items-center gap-1 font-bold">
                {ok ? <Check className="size-4 text-blue-700" /> : <X className="size-4 text-orange-700" />}
                {cur ? v.yesNo : v.otherYesNo}
              </div>
            </div>
          )
        })}
      </div>
      <p className="text-muted-foreground">{v.cmp}</p>
    </div>
  )
}

const wdLast = (n: Nearest, k: 'wd' | 'hol') => (n[k][3] > 0 ? fmtMin(n[k][5]) : '運行なし')

/** 手順5: 最寄りの停留所の最終便（一覧と診断表は別コンポーネントで続ける） */
export function LastPanel({ d }: { d: DiagView }) {
  const farther = (l: Last | null, day: 'wd' | 'hol') =>
    l && d.nearest && l.t > (d.nearest[day][3] > 0 ? d.nearest[day][5] : -1) ? l : null
  const farWd = farther(d.lastWd, 'wd')
  const farHol = farther(d.lastHol, 'hol')
  return (
    <div className="text-sm" data-testid="last-bus">
      <p className="font-medium">いちばん近い停留所の最終便</p>
      {d.nearCount === 0 || !d.nearest ? (
        <p className="text-muted-foreground">半径{d.walkInM}m以内に停留所がありません。公共交通の空白地の可能性があります（収録事業者のみ対象）。</p>
      ) : (
        <>
          <p className="text-base"><b>{d.nearest.name}</b>（約{d.nearest.m}m）</p>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-t"><th className="py-1.5 pr-3 text-left font-medium">平日の最終</th><td className="py-1.5"><b className="text-lg">{wdLast(d.nearest, 'wd')}</b>{d.nearest.wd[3] > 0 && ' 発'}</td></tr>
              <tr className="border-t"><th className="py-1.5 pr-3 text-left font-medium whitespace-nowrap">休日（日曜）の最終</th><td className="py-1.5"><b className="text-lg">{wdLast(d.nearest, 'hol')}</b>{d.nearest.hol[3] > 0 && ' 発'}</td></tr>
            </tbody>
          </table>
          {(farWd || farHol) && (
            <p className="mt-1 rounded bg-muted p-2 text-xs text-muted-foreground" data-testid="far-last-bus">
              <b>少し歩けば（参考）</b>: 半径{d.walkInM}m以内でもっと遅くまである停留所
              {farWd && <> 平日 {fmtMin(farWd.t)}（{farWd.name}・約{farWd.m}m）</>}
              {farWd && farHol && '／'}
              {farHol && <> 休日 {fmtMin(farHol.t)}（{farHol.name}・約{farHol.m}m）</>}
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** 手順6: コピー */
export function CopyPanel({
  copyText, onCopy, copied, isLocal,
}: { copyText: string; onCopy: () => void; copied: boolean; isLocal: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      <Button size="lg" onClick={onCopy} className="h-12 w-full text-base" data-testid="copy-conclusion">
        {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
        {copied ? 'コピーしました' : '結論とリンクをコピー'}
      </Button>
      <p className="font-medium text-blue-800" role="status" data-testid="copy-done">
        {copied ? 'コピーしました。LINEやメールに貼り付けて送れます。' : '押すと、この結論とこの画面へのリンクがコピーされます（家族に送れます）。'}
      </p>
      <label className="block text-xs text-muted-foreground" htmlFor="odpt-copy-preview">コピーされる文面（自動でコピーできない時は、ここを選んでコピー）</label>
      <Textarea id="odpt-copy-preview" readOnly rows={5} value={copyText} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
      {isLocal && <p className="text-xs text-muted-foreground">※いまは手元の確認用アドレスです。公開後のアドレスで共有すると、相手も開けます。</p>}
    </div>
  )
}
