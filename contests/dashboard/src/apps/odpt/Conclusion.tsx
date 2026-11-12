import { Check, X, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TIPS, Term } from './Term'
import {
  coverageScope, DAY_FULL, DAY_LABEL, PERIOD_LABEL, fmtMin, type Alternatives, type Day, type Last, type RegionData, type Status, type Verdict,
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
  alts: Alternatives | null
  /** 「使ったデータ: ○○の時刻表（…）」の一行（lib の dataUsedLine） */
  dataLine: string
  /** 共有リンクから開いた直後か */
  fromLink: boolean
  /** 有効期間が切れた時刻表がある時の注意（lib の expiredNote。なければ ''） */
  expiredNote?: string
}

export const condText = (data: RegionData, c: CondState) =>
  `${DAY_FULL[c.day]}・${PERIOD_LABEL[c.per]}${data.params.start_hours[c.per]}時に出発・${c.w}分以内・${data.facility_labels[data.facility_order[c.fi]]}`

/** 地点が未選択のときの案内（各手順パネルの先頭） */
export function NoPoint({ text = '先に「場所を決める」で地点を選んでください。' }: { text?: string }) {
  return <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{text}</p>
}

/** 地図上の小さな条件表示（結論は左のパネルだけに出す） */
export function MapSummary({ d }: { d: DiagView | null }) {
  if (!d) return null
  const fl = d.data.facility_labels[d.data.facility_order[d.cond.fi]]
  return (
    <div className="pointer-events-none absolute left-2 top-12 z-10 rounded-md border bg-white/95 px-2 py-1 text-xs text-muted-foreground shadow" data-testid="map-summary">
      {DAY_LABEL[d.cond.day]}・{PERIOD_LABEL[d.cond.per]}{d.data.params.start_hours[d.cond.per]}時・{d.cond.w}分以内・{fl}
    </div>
  )
}

/** 「行けません」のときの次の一歩。画面にある事実（近い停留所・最終便・ほかの時間帯・許容時間・休日）だけを使う */
function NextSteps({ d, fl }: { d: DiagView; fl: string }) {
  const { data, cond, verdict: v, nearest, alts } = d
  if (!v) return null
  const hr = (p: 'm' | 'd' | 'e') => `${PERIOD_LABEL[p]}${data.params.start_hours[p]}時発`
  const okPeriods = alts?.periods.filter((p) => p.ok) ?? []
  const lastTxt = nearest
    ? `最終は 平日 ${nearest.wd[3] > 0 ? fmtMin(nearest.wd[5]) : '運行なし'}・休日 ${nearest.hol[3] > 0 ? fmtMin(nearest.hol[5]) : '運行なし'}`
    : ''
  return (
    <div className="rounded-md border border-orange-300 bg-white p-3 text-sm" data-testid="next-steps">
      <p className="font-medium">行けないときの次の一歩（この画面の計算結果から）</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        <li>
          {nearest
            ? <>いちばん近い停留所は <b>{nearest.name}</b>（約{nearest.m}m）。{lastTxt}。時刻を確かめて、乗れる便から逆算して出かけます。</>
            : <>半径{d.walkInM}m以内に、収録した事業者の停留所はありません。家族の送迎や、収録していない交通（タクシー・予約制の便など）を検討する目安になります。</>}
        </li>
        {okPeriods.length > 0
          ? <li>{DAY_FULL[cond.day]}でも <b>{okPeriods.map((p) => hr(p.per)).join('・')}</b> なら、{cond.w}分以内に{fl}へ行けます。受診や外出の時間を変えられるか確かめます。</li>
          : <li>{DAY_FULL[cond.day]}の朝・昼・夕のどれで出発しても、{cond.w}分以内には行けない計算です。</li>}
        {alts?.longerW && <li>許容時間を <b>{alts.longerW.w}分</b> まで延ばすと行けます。時間に余裕のある日なら、この条件で確かめます。</li>}
        {v.otherOk && <li>{DAY_FULL[v.otherDay]}なら行けます（{v.otherYesNo}）。</li>}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">条件を変えるには、サイドバーの「条件を確認する」を開きます。行けるかどうかは時刻表データによる推計です。</p>
    </div>
  )
}

/** 結論（手順「行けるか結論を見る」） */
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
  const hospital = fl === '病院'
  const nr = d.nearest
  const lastOf = (k: 'wd' | 'hol') => (nr && nr[k][3] > 0 ? fmtMin(nr[k][5]) : '運行なし')
  return (
    <div className="space-y-3 text-sm">
      {d.fromLink && (
        <p className="rounded-md border border-blue-300 bg-blue-50 p-2 text-xs text-blue-950" data-testid="from-link">
          共有リンクから開きました。送り主が選んだ地点・条件の結論です。条件はサイドバーの「条件を確認する」で変えて確かめ直せます。
        </p>
      )}
      {d.expiredNote && (
        <p className="rounded-md border border-amber-500 bg-amber-50 p-2 text-xs text-amber-950" role="note" data-testid="expired-note">
          <b>データの期限:</b> {d.expiredNote}（家族に送る文面にも入ります）
        </p>
      )}
      <section aria-label="家族に送る1枚" data-testid="family-sheet" className="overflow-hidden rounded-md border-2 border-foreground/70 bg-white">
        <div className="flex items-center justify-between gap-2 bg-foreground px-3 py-1 text-xs font-bold text-background">
          <span>家族に送る1枚</span>
          <span className="font-normal">「1枚をコピーして家族に送る」でコピーできます</span>
        </div>
        <div className="space-y-2 p-3">
          <p className="text-xs text-muted-foreground" data-testid="sheet-cond">{d.placeLabel || '選んだ地点'}から ／ {condText(data, cond)}</p>
          <div className={`rounded-md border-2 p-3 ${v.ok ? 'border-blue-700 bg-blue-50 text-blue-950' : 'border-orange-600 bg-orange-50 text-orange-950'}`}>
            <p className="flex items-center gap-2 text-xl font-bold" data-testid="verdict-main">
              {v.ok ? <Check className="size-6 shrink-0" /> : <X className="size-6 shrink-0" />}
              <span>{fl}へ {cond.w}分以内に {v.yesNo}</span>
            </p>
            <p className="mt-1">{STATUS_NOTE[v.status]}。{v.extra}</p>
          </div>
          <p data-testid="sheet-last">
            <b>最終便</b>　{nr ? `最寄りの停留所 ${nr.name}（約${nr.m}m）の最終: 平日 ${lastOf('wd')}・休日 ${lastOf('hol')}` : `半径${d.walkInM}m以内に停留所がありません`}
          </p>
          {!v.ok && <NextSteps d={d} fl={fl} />}
          <p className="text-xs" data-testid="data-used">{d.dataLine}</p>
          {hospital && <p className="text-xs" data-testid="phone-note">病院の診療時間・予約は確認できていません。出かける前に、病院へ電話で確認してください。</p>}
        </div>
      </section>
      <div className="space-y-1 rounded-md border p-2" data-testid="verdict-basis">
        <p className="font-medium">くわしい根拠</p>
        {d.facility && (
          <p>いちばん近い{fl}: <b>{d.facility.name}</b>（直線で約{d.facility.m}m・<Term tip={TIPS.walk}>徒歩の目安</Term>約{d.facility.min}分）</p>
        )}
        {v.status === 'walk' && <p>歩きだけで{cond.w}分以内に着ける、と計算した地点です。</p>}
        {v.status === 'transit' && (
          <p>公共交通（乗り継ぎ・待ち時間を含む）で <b>{d.transitLevel ?? `${cond.w}分以内`}</b> に着ける区分です。乗る路線・経路は元データにないため表示できません。</p>
        )}
        {!v.ok && <p>最寄りの{fl}までは、{cond.w}分以内には着けない計算です。</p>}
        <p className="text-xs text-muted-foreground">最寄りの{fl}は直線距離で選んだ目安で、実際に向かう{fl}とは限りません。</p>
        {d.popInfo && (
          <p className="text-xs text-muted-foreground">
            この<Term tip={TIPS.mesh}>約500m四方のエリア</Term>の人口 {d.popInfo.pop}人（65歳以上 {d.popInfo.pop65}人）。人数は<Term tip={TIPS.hide}>概数</Term>です。
          </p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">時刻表データによる推計で、実際の運行を保証するものではありません。{coverageScope(data.coverage.modes)}だけが対象で、予約制の便・病院の診療時間は評価していません。</p>
    </div>
  )
}

/** 手順4: 平日と休日の比較 */
export function HolPanel({ d, onPickDay }: { d: DiagView; onPickDay: (day: Day) => void }) {
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
            <button key={day} type="button" aria-pressed={cur} onClick={() => onPickDay(day)} data-testid={`pick-${day}`}
              className={`rounded-md border p-2 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${cur ? 'border-2 border-foreground' : ''}`}>
              <div className="text-xs text-muted-foreground">{DAY_LABEL[day]}{day === 'hol' ? <>（<Term tip={TIPS.sunday}>日曜ダイヤ</Term>）</> : ''}{cur ? '・選択中' : ''}</div>
              <div className="flex items-center gap-1 font-bold">
                {ok ? <Check className="size-4 text-blue-700" /> : <X className="size-4 text-orange-700" />}
                {cur ? v.yesNo : v.otherYesNo}
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-muted-foreground">{v.cmp}</p>
      <p className="text-xs text-muted-foreground" data-testid="compare-hint">選んでいない側の枠を押すと、結論を切り替えて見比べられます（切り替えると、この手順が済になります）。</p>
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

/** 手順5: コピー。コピー済みかどうかは、いまの文面と一致するかで表示する（手順を戻っても保持） */
export function CopyPanel({
  copyText, onCopy, copied, isLocal, expiry,
}: { copyText: string; onCopy: () => void; copied: boolean; isLocal: boolean; expiry: string }) {
  return (
    <div className="space-y-2 text-sm">
      <Button size="lg" onClick={onCopy} className="h-12 w-full text-base" data-testid="copy-conclusion">
        {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
        {copied ? 'コピー済み（もう一度コピーする）' : '結論とリンクをコピー'}
      </Button>
      <p className="font-medium text-blue-800" role="status" data-testid="copy-done">
        {copied ? 'コピーしました。LINEやメールに貼り付けて送れます。' : '押すと、この結論とこの画面へのリンクがコピーされます（家族に送れます）。'}
      </p>
      <label className="block text-xs text-muted-foreground" htmlFor="odpt-copy-preview">家族に送る文面（「行けるか結論を見る」の1枚と同じ内容。自動でコピーできない時は、ここを選んでコピー）</label>
      <Textarea id="odpt-copy-preview" readOnly rows={7} value={copyText} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
      {isLocal && <p className="text-xs text-muted-foreground">※いまは手元の確認用アドレスです。公開後のアドレスで共有すると、相手も開けます。</p>}
      <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="sustain-note">
        <p className="font-medium text-foreground">データの更新と、使う人たち（想定）</p>
        <ul className="mt-1 list-disc space-y-1 pl-4">
          <li>時刻表は、事業者がGTFSデータリポジトリ・公共交通オープンデータセンターに公開するデータです。ダイヤが変わると診断も古くなるため、有効期間が切れる前に最新のGTFSで作り直します（現在は開発者が前処理で作り直す方式で、この画面からは更新できません）。{expiry}</li>
          <li>家族に送る使い方のほか、自治体職員・議員・住民が同じ画面で現状と路線変更の影響（「参考: 路線を止めたら？」）を話し合う材料にすることを想定しています。自治体との連携や導入の実績は、まだありません。</li>
        </ul>
      </div>
    </div>
  )
}
