/* 新旧写真の比較表示（スワイプ／並列）。写真は100%の濃さで表示し、地図の文字と混ぜない。
   - 境界はドラッグ、またはキーボード（← →、Shift で大きく、Home／End）で動かせる
   - TileMosaic: 地理院タイル（ズーム固定）を画素位置に並べる。画像が無い年代は「この年代の画像なし」を出す（空白で済ませない）
   - ringsToPath: 輪郭（経緯度のリング）を画素座標のパスにする */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

export const WIN = 512
const TILE_BASE = 'https://cyberjapandata.gsi.go.jp/xyz/'

/** Web Mercator の世界画素座標（ズーム z、タイル256画素） */
export function worldPx(lon: number, lat: number, z: number): [number, number] {
  const n = 256 * 2 ** z
  const s = Math.sin((lat * Math.PI) / 180)
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}

export interface View { z: number; ox: number; oy: number }
/** 経緯度を中心にした 512 画素の窓 */
export function viewAround(lon: number, lat: number, z: number): View {
  const [x, y] = worldPx(lon, lat, z)
  return { z, ox: Math.round(x - WIN / 2), oy: Math.round(y - WIN / 2) }
}
export function toView(v: View, lon: number, lat: number): [number, number] {
  const [x, y] = worldPx(lon, lat, v.z)
  return [x - v.ox, y - v.oy]
}
/** GeoJSON の Polygon／MultiPolygon の座標を、窓の画素座標のパス（evenodd 用）にする。ring が無ければ空文字 */
export function ringsToPath(v: View, coords: unknown, type: string): string {
  const polys = (type === 'Polygon' ? [coords] : coords) as number[][][][]
  let d = ''
  for (const poly of polys) {
    for (const ring of poly) {
      d += ring.map((p, i) => {
        const [x, y] = toView(v, p[0], p[1])
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
      }).join('') + 'Z'
    }
  }
  return d
}

/** tz: 取得するタイルのズーム（既定は view.z。陰影起伏のようにズームが低い層は拡大して同じ範囲に合わせる） */
export function TileMosaic({ layer, ext, view, tz, onMissing }: { layer: string; ext: string; view: View; tz?: number; onMissing?: (missing: boolean) => void }) {
  const z = tz ?? view.z
  const sz = 256 * 2 ** (view.z - z) // タイル1枚の、view 画素での大きさ
  const x0 = Math.floor(view.ox / sz)
  const x1 = Math.floor((view.ox + WIN - 1) / sz)
  const y0 = Math.floor(view.oy / sz)
  const y1 = Math.floor((view.oy + WIN - 1) / sz)
  const total = (x1 - x0 + 1) * (y1 - y0 + 1)
  const [failed, setFailed] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const key = `${layer}/${z}/${view.z}/${view.ox}/${view.oy}`
  useEffect(() => { setFailed(0); setLoaded(0) }, [key])
  const missing = failed >= total
  useEffect(() => { onMissing?.(missing) }, [missing, onMissing])
  const tiles: ReactNode[] = []
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      tiles.push(
        <img
          key={`${key}/${tx}/${ty}`} alt="" draggable={false}
          src={`${TILE_BASE}${layer}/${z}/${tx}/${ty}.${ext}`}
          onLoad={() => setLoaded((n) => n + 1)} onError={() => setFailed((n) => n + 1)}
          className="absolute select-none"
          style={{ left: `${((tx * sz - view.ox) / WIN) * 100}%`, top: `${((ty * sz - view.oy) / WIN) * 100}%`, width: `${(sz / WIN) * 100}%`, height: `${(sz / WIN) * 100}%` }}
        />,
      )
    }
  }
  return (
    <div className="absolute inset-0 bg-neutral-200" data-loaded={loaded} data-failed={failed}>
      {tiles}
      {missing && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-100 p-4 text-center text-sm font-bold text-neutral-800" role="status">
          この年代の画像なし（この場所は提供範囲外です）
        </div>
      )}
    </div>
  )
}

export interface CompareSide { label: string; node: ReactNode }

/** 輪郭などを重ねる SVG 層（viewBox は WIN×WIN）。両側に同じものを置く */
export function CompareFrame({ children }: { children: ReactNode }) {
  return <svg viewBox={`0 0 ${WIN} ${WIN}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">{children}</svg>
}

export function PhotoCompare({
  left, right, overlay, caption, ariaLabel, onInteract, testId = 'photo-compare', defaultMode = 'swipe',
}: {
  left: CompareSide; right: CompareSide; overlay?: ReactNode; /** 写真の直下に常に出す説明（例: 重ねている輪郭の資料名） */ caption?: ReactNode; ariaLabel: string; onInteract?: () => void; testId?: string; defaultMode?: 'swipe' | 'side'
}) {
  const [mode, setMode] = useState<'swipe' | 'side'>(defaultMode)
  const [pos, setPos] = useState(50)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const [boxW, setBoxW] = useState(360)
  useLayoutEffect(() => {
    const e = box.current
    if (!e) return
    setBoxW(e.getBoundingClientRect().width || 360)
    const ro = new ResizeObserver(() => setBoxW(e.getBoundingClientRect().width || 360))
    ro.observe(e)
    return () => ro.disconnect()
  }, [mode])
  // 年代ラベルは、その側の写真がラベルの幅より広く見えているときだけ出す（見えていない側の年代を写真の上に残さない）
  const labelW = (t: string) => t.length * 11 + 16
  const showLeft = (pos / 100) * boxW >= labelW(left.label) + 8
  const showRight = ((100 - pos) / 100) * boxW >= labelW(right.label) + 8
  const move = useCallback((clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    setPos(Math.max(0, Math.min(100, Math.round(((clientX - r.left) / r.width) * 100))))
  }, [])
  const down = (e: PointerEvent) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); onInteract?.() }
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    let v: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = pos - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = pos + step
    else if (e.key === 'Home') v = 0
    else if (e.key === 'End') v = 100
    if (v === null) return
    e.preventDefault()
    setPos(Math.max(0, Math.min(100, v)))
    onInteract?.()
  }
  const badge = 'pointer-events-none absolute top-1 z-20 max-w-[48%] rounded bg-neutral-900/85 px-1.5 py-0.5 text-[11px] font-bold leading-tight text-white'
  return (
    <div className="space-y-1.5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <div role="group" aria-label="表示のしかた" className="inline-flex overflow-hidden rounded-md border text-xs">
          {([['swipe', '境界を動かす'], ['side', '左右に並べる']] as const).map(([m, t]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); onInteract?.() }}
              className="px-2.5 py-1.5 hover:bg-accent aria-pressed:bg-primary aria-pressed:font-bold aria-pressed:text-primary-foreground">{t}</button>
          ))}
        </div>
        {mode === 'swipe' && <span className="text-[11px] text-muted-foreground">← → キーでも動かせます</span>}
      </div>
      {mode === 'swipe' ? (
        <div
          ref={box} data-testid={`${testId}-swipe`}
          className="relative aspect-square w-full touch-pan-y select-none overflow-hidden rounded-md border-2 border-black bg-neutral-200"
          onPointerMove={(e) => { if (drag.current) move(e.clientX) }}
          onPointerUp={() => { drag.current = false }} onPointerCancel={() => { drag.current = false }}
          onPointerDown={down}
        >
          <div className="absolute inset-0">{right.node}{overlay}</div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>{left.node}{overlay}</div>
          {pos > 0 && pos < 100 && showLeft && <span className={`${badge} left-1`} data-testid="label-left">{left.label}</span>}
          {pos > 0 && pos < 100 && showRight && <span className={`${badge} right-1 text-right`} data-testid="label-right">{right.label}</span>}
          {(pos <= 0 || pos >= 100 || (!showLeft && !showRight)) && (
            <span className={`${badge} left-1 !max-w-[70%]`} data-testid="label-state">
              {pos <= 0 ? `全面：${right.label}` : pos >= 100 ? `全面：${left.label}` : '境界を広げると年代が出ます'}
            </span>
          )}
          <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.7)]" style={{ left: `${pos}%` }} />
          <div
            role="slider" tabIndex={0} aria-label="新旧の境界。左右の矢印キーで動かす" aria-orientation="horizontal"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={pos} aria-valuetext={`左の ${pos}% が「${left.label}」、残りが「${right.label}」`}
            onKeyDown={key}
            className="absolute top-9 z-20 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border-2 border-black bg-white text-sm font-bold shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0072B2]"
            style={{ left: `${pos}%` }}
          >⇔</div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1" data-testid={`${testId}-side`}>
          {[left, right].map((s) => (
            <figure key={s.label} className="m-0 space-y-0.5">
              <div className="relative aspect-square w-full overflow-hidden rounded-md border-2 border-black bg-neutral-200">{s.node}{overlay}</div>
              <figcaption className="text-[11px] font-bold leading-tight">{s.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {caption}
    </div>
  )
}
