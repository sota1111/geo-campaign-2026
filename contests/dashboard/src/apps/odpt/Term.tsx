import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** 用語に点線の下線を付け、押す／触れる／フォーカスすると短い説明を出す */
export function Term({ children, tip }: { children: ReactNode; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help underline decoration-dotted underline-offset-2">{children}</button>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  )
}

export const TIPS = {
  mesh: '地図を約500m四方に区切った区画。人口はこの単位で数えています。',
  gtfs: 'バスなどの時刻表・停留所を、決まった形式で公開したオープンデータ。',
  hide: '個人が特定されないよう、人数の少ない区画の数値を近くの区画に合算する国の処理。実際の人数と少しずれることがあります。',
  none: '歩いても、収録した公共交通でも許容時間内に着けないこと。収録していない便（鉄道・予約制の便など）は含みません。',
  walk: '直線距離×1.25（道のりの目安）÷分速80m で計算した目安です。坂や信号は考慮していません。',
  sunday: '休日は日曜のダイヤで計算しています（祝日・臨時ダイヤは未反映）。',
}
