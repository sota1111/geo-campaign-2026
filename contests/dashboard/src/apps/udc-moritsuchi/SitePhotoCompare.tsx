/* 盛土造成地の「昔の写真と今」の見比べ（主画面）。
   - 選んだ造成地の輪郭を固定し、範囲外を薄くして、旧写真（1961〜69／1974〜78）と現在写真を境界で比べる
   - 画像は地理院タイル（加工）。事前生成（CLAHE 補正あり）は偵察で使った3地点のみ。その他の地点はタイルを並べて補正なしで表示する
   - 写真の見え方の記述は目視の観察であり、谷の位置・盛土の厚さ・危険度を示すものではない */
import { useMemo, useState } from 'react'
import { CompareFrame, PhotoCompare, TileMosaic, WIN, ringsToPath, viewAround, type View } from '@/components/shared/PhotoCompare'
import type { FillFeature } from './lib'
import { SITE_VIEW } from './sites'

const IMGS = import.meta.glob('./img/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const img = (name: string) => IMGS[`./img/${name}.jpg`]

type Era = '61' | '74'
const ERA_LABEL: Record<Era, string> = { '61': '1961〜69年', '74': '1974〜78年' }
const ERA_LAYER: Record<Era, { layer: string; ext: string }> = { '61': { layer: 'ort_old10', ext: 'png' }, '74': { layer: 'gazo1', ext: 'jpg' } }

/** 偵察隊（2026-11-13）が3地点の写真を目視した観察。pre=false は、その年代の写真に既に宅地・道路が見え、造成前を確認できないもの */
const OBS: Record<string, Record<Era, { pre: boolean; text: string }>> = {
  熱海市0001: {
    '61': { pre: false, text: '範囲の周りに宅地の列が見えます。' },
    '74': { pre: false, text: '範囲の周りに宅地の列が見えます。' },
  },
  伊東市0003: {
    '61': { pre: true, text: '範囲内は樹木のような模様に見えます。現在側は道路や建物の列が見えます。' },
    '74': { pre: true, text: '範囲内は樹木のような模様に見えます。' },
  },
  伊東市0004: {
    '61': { pre: true, text: '範囲内は樹木のような模様に見えます。現在側は道路や建物の列が見えます。' },
    '74': { pre: false, text: '範囲内に道路や建物の列が見えます。' },
  },
}

function viewFor(f: FillFeature): { view: View; prepared: string | null } {
  const sv = SITE_VIEW[f.properties.id]
  if (sv) return { view: { z: 17, ox: sv.ox, oy: sv.oy }, prepared: sv.key }
  const ring = f.geometry.coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const cx = (Math.min(...lons) + Math.max(...lons)) / 2
  const cy = (Math.min(...lats) + Math.max(...lats)) / 2
  let v = viewAround(cx, cy, 17)
  // 範囲が窓に収まらない大きさなら、1段引く
  const xs = ring.map((p) => viewAround(p[0], p[1], 17).ox - v.ox + WIN / 2)
  const ys = ring.map((p) => viewAround(p[0], p[1], 17).oy - v.oy + WIN / 2)
  if (Math.min(...xs) < 30 || Math.max(...xs) > WIN - 30 || Math.min(...ys) < 30 || Math.max(...ys) > WIN - 30) v = viewAround(cx, cy, 16)
  return { view: v, prepared: null }
}

export function SitePhotoCompare({ fill, onInteract }: { fill: FillFeature; onInteract?: () => void }) {
  const [era, setEra] = useState<Era>('61')
  const [clahe, setClahe] = useState(false)
  const [hill, setHill] = useState(false)
  const [oldMissing, setOldMissing] = useState(false)
  const { view, prepared } = useMemo(() => viewFor(fill), [fill])
  const id = fill.properties.id
  const path = useMemo(() => ringsToPath(view, fill.geometry.coordinates, 'Polygon'), [view, fill])
  const obs = OBS[id]?.[era]
  const claheOn = clahe && !!prepared

  const oldNode = prepared
    ? <img src={img(`${prepared}-old${era}${claheOn ? '-clahe' : ''}`)} alt={`${ERA_LABEL[era]}の写真${claheOn ? '（コントラスト補正）' : ''}`} draggable={false} className="absolute inset-0 size-full select-none" />
    : <TileMosaic layer={ERA_LAYER[era].layer} ext={ERA_LAYER[era].ext} view={view} onMissing={setOldMissing} />
  const newNode = hill
    ? (prepared
      ? <img src={img(`${prepared}-hill`)} alt="現在の陰影起伏図" draggable={false} className="absolute inset-0 size-full select-none" />
      : <TileMosaic layer="hillshademap" ext="png" view={view} tz={16} />)
    : (prepared
      ? <img src={img(`${prepared}-new`)} alt="現在側の写真（全国最新写真）" draggable={false} className="absolute inset-0 size-full select-none" />
      : <TileMosaic layer="seamlessphoto" ext="jpg" view={view} />)

  const overlay = (
    <CompareFrame>
      {path && (
        <>
          {/* 範囲外を薄くする（evenodd で輪郭の内側だけ抜く） */}
          <path d={`M0 0H${WIN}V${WIN}H0Z${path}`} fill="#eef2f4" fillOpacity={0.62} fillRule="evenodd" />
          <path d={path} fill="none" stroke="#102332" strokeWidth={6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path d={path} fill="none" stroke="#ffdf40" strokeWidth={3} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </CompareFrame>
  )
  const btn = 'rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent aria-pressed:border-2 aria-pressed:border-black aria-pressed:bg-accent aria-pressed:font-bold disabled:opacity-50'
  return (
    <div className="space-y-2" data-testid="site-compare">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="昔の写真の年代">
        <span className="text-xs text-muted-foreground">昔の写真:</span>
        {(['61', '74'] as const).map((e) => (
          <button key={e} type="button" aria-pressed={era === e} className={btn} onClick={() => { setEra(e); onInteract?.() }}>{ERA_LABEL[e]}</button>
        ))}
      </div>
      <div className="space-y-0.5 rounded-md border bg-accent/40 p-2 text-xs" data-testid="site-compare-note">
        <p><b>黄色い線の内側</b>が{id}の範囲（A54・概ねの位置）。範囲内の昔と今で、樹木・田畑・道路・建物の見え方を見比べます。</p>
        {obs && (
          <p data-testid="site-obs">
            {obs.pre ? `見えること（目視）: ${obs.text}` : `${obs.text}この年代では造成前を確認できません。`}
            {obs.pre && 'ただし写真から谷や沢の位置・盛土の厚さは分かりません。'}
          </p>
        )}
        {!obs && <p>見えること: この地点の読み取りは未実施です。写真は目視で見比べ、昔の様子は断定しません。</p>}
        {hill && <p>陰影起伏は<b>現在の</b>地形を陰影で表した図です。昔の地形は分かりません（写真より粗く表示されます）。</p>}
      </div>
      <PhotoCompare
        ariaLabel={`${id}の昔の写真と今の比較`}
        onInteract={onInteract}
        left={{ label: `昔 ${ERA_LABEL[era]}${claheOn ? '（補正）' : ''}`, node: oldNode }}
        right={{ label: hill ? '今の陰影起伏' : '今（全国最新写真）', node: newNode }}
        overlay={overlay}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={claheOn} disabled={!prepared} className={btn} onClick={() => { setClahe(!clahe); onInteract?.() }}>
          コントラスト補正 {claheOn ? 'オン（押すと原画像）' : 'オフ（原画像）'}
        </button>
        <button type="button" aria-pressed={hill} className={btn} onClick={() => { setHill(!hill); onInteract?.() }}>
          {hill ? '陰影起伏を表示中（押すと写真）' : '現在の陰影起伏を見る（補助）'}
        </button>
      </div>
      {!prepared && <p className="text-[11px] text-muted-foreground">この地点は補正なしの原画像だけを表示します（補正は偵察で使った3地点のみ）。</p>}
      {oldMissing && !prepared && <p className="text-xs font-bold" role="status">この年代の写真は、この場所には提供されていません。</p>}
      <p className="text-[11px] leading-snug text-muted-foreground">
        出典：国土地理院 地理院タイル（切出し・{prepared ? 'コントラスト補正・' : ''}輪郭の重ね描きの加工）、国土数値情報 大規模盛土造成地 A54（国土交通省）を加工して作成。
        年代はレイヤに収録された期間で、この場所の個別の撮影年は未確認です。「今」の写真は最新の現況を保証しません。
      </p>
    </div>
  )
}

/** 谷埋め型・腹付け型の一般的な概念図（この地点の復元断面ではない） */
function profile(kind: '谷埋め型' | '腹付け型') {
  if (kind === '谷埋め型') {
    const ground = (t: number): [number, number] => [200 * t, 25 + 210 * t * (1 - t)]
    const pts: [number, number][] = []
    for (let i = 0; i <= 20; i++) pts.push(ground(i / 20))
    const line = 'M' + pts.map((p) => `${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('L')
    const t0 = 0.1053
    const fillPath = `M${(200 * t0).toFixed(0)} 45H${(200 * (1 - t0)).toFixed(0)}` + pts.filter((p) => p[1] > 45).reverse().map((p) => `L${p[0].toFixed(0)} ${p[1].toFixed(0)}`).join('') + 'Z'
    return { line, fillPath, top: 'M0 25H21M179 25H200' }
  }
  return { line: 'M0 30L200 100', fillPath: 'M60 51H112L150 82.5Z', top: '' }
}

export function KindExplain({ kind }: { kind: string }) {
  return (
    <section className="space-y-2 rounded-md border-2 border-primary p-2" data-testid="kind-explain" aria-label="盛土の区分の説明">
      <h3 className="text-sm font-bold">盛土の区分（A54）の見方</h3>
      <div className="grid grid-cols-2 gap-2">
        {(['谷埋め型', '腹付け型'] as const).map((k) => {
          const p = profile(k)
          const on = kind === k
          return (
            <figure key={k} className={`m-0 space-y-1 rounded-md border p-1.5 ${on ? 'border-2 border-black bg-accent' : ''}`}>
              <svg viewBox="0 0 200 120" className="w-full" role="img" aria-label={`${k}の概念図。破線がもとの地面、橙が盛土`}>
                <rect width="200" height="120" fill="#f4f7f8" />
                <path d={p.fillPath} fill="#D55E00" fillOpacity={0.55} stroke="#D55E00" strokeWidth={1.5} />
                <path d={p.line} fill="none" stroke="#333" strokeWidth={2} strokeDasharray="5 4" />
              </svg>
              <figcaption className="text-xs leading-snug">
                <b>{k}{on && '（選択中の区分）'}</b><br />
                {k === '谷埋め型' ? 'くぼみ（谷や沢）を埋める造成' : '斜面に盛土をして平らな面を広げる造成'}
              </figcaption>
            </figure>
          )
        })}
      </div>
      {kind === '区分なし' && <p className="text-xs">この地点はデータ上、区分がありません（写真や地形から区分を補うことはしません）。</p>}
      <p className="text-[11px] leading-snug">破線＝もとの地面（イメージ）、橙＝盛土。<b>これは一般的な概念図で、この地点の復元断面ではありません。</b>区分は国土数値情報 A54 の分類で、写真の画像処理で判定したものではありません。</p>
      <p className="text-[11px] leading-snug text-muted-foreground">A54 は大規模盛土造成地の概ねの位置を示すもので、<b>直ちに危険な盛土造成地という意味ではありません</b>。すべての盛土を網羅せず、重要事項説明などの根拠にはなりません。</p>
    </section>
  )
}
