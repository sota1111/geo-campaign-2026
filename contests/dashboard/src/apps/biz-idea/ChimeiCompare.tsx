/* 地名の記憶マップ「昔の地図・写真と重ねる」: 新旧写真の比較（初期表示）と、主題図の旧河道の確認（任意）。
   - 写真は100%で表示し、地図の文字とは混ぜない（現在の地名は地図で確認する）
   - s1（サンプル地名）は注目枠A・Bと、CLAHE 補正の事前生成画像つき。任意の地点は補正なしで表示し、画像が無い年代は「この年代の画像なし」
   - 旧河道の輪郭は治水地形分類図の記号色から作った目安で、「ここが昔の川」を示さない。原図に戻せる
   - 年代はレイヤに収録された期間で、個別の撮影年は未確認 */
import { useState } from 'react'
import { CompareFrame, PhotoCompare, TileMosaic, WIN, toView, viewAround, type View } from '@/components/shared/PhotoCompare'
import { S1_OLD_CHANNEL } from './oldchannel'
import s1Old from './img/s1-old.jpg'
import s1OldClahe from './img/s1-old-clahe.jpg'
import s1New from './img/s1-new.jpg'

/** s1 の比較画像の範囲（z16、x=56886〜 の左から250画素、y=26073〜）。偵察 2026-11-13 の取得範囲 */
export const S1_VIEW: View = { z: 16, ox: 56886 * 256 + 250, oy: 26073 * 256 }
const S1_LON = 132.495
const S1_LAT = 34.4785
/** 注目枠（画像上の画素。目視で置いた比較用の目印で、土地利用や地名の境界ではない） */
const FRAME_A = { x: 190, y: 125, width: 130, height: 110 }
const FRAME_B = { x: 155, y: 290, width: 110, height: 55 }

type Era = 'ort_old10' | 'ort_USA10'
const ERAS: Record<Era, { label: string; short: string }> = {
  ort_old10: { label: '空中写真 1961〜69年', short: '昔 1961〜69年' },
  ort_USA10: { label: '空中写真 1945〜50年', short: '昔 1945〜50年' },
}
export type ChannelMode = 'off' | 'outline' | 'orig'

const btn = 'rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent aria-pressed:border-2 aria-pressed:border-black aria-pressed:bg-accent aria-pressed:font-bold disabled:opacity-50'

const haloText = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 4, strokeLinejoin: 'round' } as const

export function inS1Area(lon: number, lat: number) {
  const [x, y] = toView(S1_VIEW, lon, lat)
  return x > 20 && x < WIN - 20 && y > 20 && y < WIN - 20
}

export function ChimeiCompare({
  lon, lat, isSample, channel, onChannel, onInteract,
}: {
  lon: number; lat: number
  /** サンプル地名 s1 か（注目枠と補正画像を使う） */
  isSample: boolean
  channel: ChannelMode
  onChannel: (m: ChannelMode) => void
  onInteract?: () => void
}) {
  const [era, setEra] = useState<Era>('ort_old10')
  const [clahe, setClahe] = useState(false)
  const [missing, setMissing] = useState(false)
  const s1 = isSample && inS1Area(lon, lat)
  const view = s1 ? S1_VIEW : viewAround(lon, lat, 16)
  const claheOn = clahe && s1 && era === 'ort_old10'
  const [px, py] = toView(view, s1 ? S1_LON : lon, s1 ? S1_LAT : lat)
  const outlineOk = inS1Area(lon, lat)
  const showOutline = channel === 'outline' && outlineOk

  const oldNode = s1 && era === 'ort_old10'
    ? <img src={claheOn ? s1OldClahe : s1Old} alt={`${ERAS[era].label}の写真${claheOn ? '（コントラスト補正）' : ''}`} draggable={false} className="absolute inset-0 size-full select-none" />
    : <TileMosaic layer={era} ext="png" view={view} onMissing={setMissing} />
  const newNode = s1
    ? <img src={s1New} alt="全国最新写真" draggable={false} className="absolute inset-0 size-full select-none" />
    : <TileMosaic layer="seamlessphoto" ext="jpg" view={view} />

  const overlay = (
    <CompareFrame>
      {showOutline && S1_OLD_CHANNEL.features.map((f, i) => (
        <g key={i}>
          <path d={'M' + f.geometry.coordinates.map((c) => toView(view, c[0], c[1]).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z'} fill="none" stroke="#fff" strokeWidth={6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={'M' + f.geometry.coordinates.map((c) => toView(view, c[0], c[1]).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z'} fill="none" stroke="#0054c8" strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {s1 && (
        <>
          <rect {...FRAME_A} fill="none" stroke="#222" strokeWidth={7} vectorEffect="non-scaling-stroke" />
          <rect {...FRAME_A} fill="none" stroke="#ffcf33" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <text x={FRAME_A.x + 5} y={FRAME_A.y + 24} fontSize={24} fontWeight={700} fill="#111" style={haloText}>A</text>
          <rect {...FRAME_B} fill="none" stroke="#222" strokeWidth={6} vectorEffect="non-scaling-stroke" />
          <rect {...FRAME_B} fill="none" stroke="#fff" strokeWidth={3} vectorEffect="non-scaling-stroke" />
          <text x={FRAME_B.x + 5} y={FRAME_B.y + 24} fontSize={24} fontWeight={700} fill="#111" style={haloText}>B</text>
        </>
      )}
      <circle cx={px} cy={py} r={6} fill="#d55e00" stroke="#000" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <text x={px + 10} y={py + 5} fontSize={16} fontWeight={700} fill="#111" style={haloText}>{s1 ? 's1（架空）' : '選んだ位置'}</text>
    </CompareFrame>
  )

  return (
    <div className="space-y-2" data-testid="chimei-compare">
      <div className="space-y-0.5 rounded-md border-2 border-black bg-yellow-50 p-2 text-sm">
        {s1 ? (
          <>
            <p className="font-bold">黄枠Aの区画と、同じ場所の建物・道路を比べる</p>
            <p className="text-xs">昔（左）は区画の並びのような模様、今（右）は建物や道路が並んで見えます。白枠Bは、帯状の樹林のような模様と今を比べる目印です。</p>
          </>
        ) : (
          <>
            <p className="font-bold">赤丸の場所を、昔と今で見比べる</p>
            <p className="text-xs">選んだ位置の周り（約1km四方）を、境界を動かして比べます。何が変わったかは自分の目で読み取ります。</p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="昔の写真の年代">
        <span className="text-xs text-muted-foreground">昔の写真:</span>
        {(Object.keys(ERAS) as Era[]).map((e) => (
          <button key={e} type="button" aria-pressed={era === e} className={btn} onClick={() => { setEra(e); onInteract?.() }}>{ERAS[e].label.replace('空中写真 ', '')}</button>
        ))}
      </div>

      <PhotoCompare
        ariaLabel="昔の写真と全国最新写真の比較"
        onInteract={onInteract}
        left={{ label: `${ERAS[era].short}${claheOn ? '（補正）' : ''}`, node: oldNode }}
        right={{ label: '今（全国最新写真）', node: newNode }}
        overlay={overlay}
      />
      {missing && !(s1 && era === 'ort_old10') && <p className="text-xs font-bold" role="status">この年代の画像なし（この場所の昔の写真は提供されていません）。</p>}

      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={claheOn} disabled={!s1 || era !== 'ort_old10'} className={btn} onClick={() => { setClahe(!clahe); onInteract?.() }}>
          コントラスト補正 {claheOn ? 'オン（押すと原画像）' : 'オフ（原画像）'}
        </button>
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {s1
          ? '補正は s1 の1961〜69年だけです（作成済みの画像を表示）。補正は見やすくするための加工で、これだけで昔の土地の使われ方は分かりません。任意の地点は補正なしの原画像です。'
          : 'この地点は補正なしの原画像です（補正は s1 のデモだけ）。'}
        {' '}地名や地図の文字は、右（上）の地図で確認します。
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        出典：国土地理院 地理院タイル（{s1 ? '切出し・コントラスト補正・枠の重ね描きの加工' : '地理院タイルをそのまま並べて表示'}）。
        年代はレイヤに収録された期間で、この場所の個別の撮影年は未確認です。「全国最新写真」は2026年撮影を意味しません。
        {s1 && '枠A・Bは目視で置いた目印で、水田かどうか・土地利用の境界を示しません。s1の地名と話は架空です。'}
      </p>

      <section className="space-y-1.5 rounded-md border p-2" data-testid="channel-switch" aria-label="主題図の旧河道">
        <h3 className="text-sm font-bold">主題図の旧河道を確かめる（任意）</h3>
        <p className="text-xs">写真だけでは分からない、土地の成り立ちの資料です。治水地形分類図が「旧河道」と分類した場所を、今の写真の上で見ます。</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="旧河道の表示">
          <button type="button" className={btn} aria-pressed={channel === 'outline'} disabled={!outlineOk} onClick={() => { onChannel(channel === 'outline' ? 'off' : 'outline'); onInteract?.() }}>
            {channel === 'outline' ? '旧河道の輪郭を表示中（押すと消す）' : '旧河道の輪郭を重ねる'}
          </button>
          <button type="button" className={btn} aria-pressed={channel === 'orig'} onClick={() => { onChannel(channel === 'orig' ? 'off' : 'orig'); onInteract?.() }}>
            {channel === 'orig' ? '原図（治水地形分類図）を地図に表示中' : '原図に戻す（地図に治水地形分類図）'}
          </button>
        </div>
        {!outlineOk && <p className="text-[11px] text-muted-foreground">輪郭データは s1 周辺（約1km四方）だけです。この場所では原図のみ表示できます。</p>}
        {showOutline && (
          <p className="text-xs" data-testid="channel-label">
            <span className="mr-1 inline-block h-1 w-6 -translate-y-0.5 bg-[#0054c8] align-middle" />
            <b>治水地形分類図の旧河道（輪郭は目安）</b>。写真や地図に重ねて、今の街区との位置関係を見ます。
          </p>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          輪郭は、治水地形分類図の旧河道の記号（青い横線）を色で拾って囲んだ近似で、公式の境界データではありません。細部の欠けや、他の青い記号の混ざりがあり得ます。
          「旧河道」は昔の川筋だった地形の分類で、<b>1960年代に水が流れていたという意味ではなく</b>、ここが昔の川だったと断定するものでも、危険度を示すものでもありません。
          出典：国土地理院 治水地形分類図（地理院タイル。色抽出・輪郭化の加工）。
        </p>
      </section>
    </div>
  )
}
