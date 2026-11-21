import type { PrizeInfo } from '@/apps/contests-info'

/** 賞金の内訳（賞の名前・金額・件数・出典）。トップのポップオーバーとコンペ概要ページで共通 */
export function PrizeBreakdown({ prize }: { prize: PrizeInfo }) {
  return (
    <div data-testid="prize-breakdown" className="text-sm">
      {prize.total && <p className="font-bold">{prize.total}</p>}
      <ul className="list-disc pl-4">
        {prize.items.map((it) => (
          <li key={it.name} data-testid="prize-item">
            <span className="font-bold">{it.name}</span>　{it.unconfirmed && <span aria-hidden>？ </span>}
            {it.amount}
            {it.count && <span>（{it.count}）</span>}
            {it.note && <span className="text-slate-700">　{it.note}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-700">出典: {prize.source}</p>
    </div>
  )
}
