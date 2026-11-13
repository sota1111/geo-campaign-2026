import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  libPrintLine, buildDigest, buildSheet, glossaryFor, pickSearchHit, classifyFlood, demElevation, findZone, haversine, inPolygon, lonLatToWorld, SAMPLE_ANSWERS, sheetToText,
  summarize, tileOf, transitAround, worldToLonLat, type AreaData, type Facts,
} from './lib'
import { analyze, reverseGeocode, REVERSE_GEOCODE_TIMEOUT_MS } from './collect'
import {
  aggregateTrade, extractDivision, extractLandPoints, isReinfolibData, lookupLibrary, MIN_TRADES, townOf, GENERATOR, type ReinfolibData,
  REINFOLIB_ATTRIBUTION, REINFOLIB_CREDIT, REINFOLIB_PROCESSED, REINFOLIB_RESPONSIBILITY,
} from './reinfolib'
import { existsSync } from 'node:fs'

describe('距離の言い方', () => {
  it('50m未満は「直線約0m」ではなく「すぐ近く（50m未満）」', () => {
    const f = base({ transit: { radius: 500, busNames: 1, bus: { name: 'A', dist: 20 }, rail: { name: '徳島', dist: 4 } } })
    const r = summarize(f).find((x) => x.key === 'rail')!
    expect(r.value).toBe('徳島まですぐ近く（50m未満）')
    expect(JSON.stringify(buildSheet(f, {}))).not.toMatch(/直線約0m|直線約10m/)
    expect(summarize(base({ transit: { radius: 500, busNames: 1, bus: null, rail: { name: 'B', dist: 190 } } })).find((x) => x.key === 'rail')!.value).toBe('Bまで直線約190m')
  })
})

describe('検索結果の選び方', () => {
  const hits = [
    { lon: 140.6, lat: 35.9, title: '茨城県潮来市徳島' },
    { lon: 134.5547, lat: 34.0701, title: '徳島県徳島市' },
    { lon: 134.5485, lat: 34.0735, title: '徳島駅前郵便局' },
    { lon: 134.5518, lat: 34.0762, title: '徳島駅' },
  ]
  it('駅名検索は同梱の駅データの座標を優先（GSIの「徳島駅」＝城山公園付近のラベルは使わない）', () => {
    const h = pickSearchHit('徳島駅', hits, data)!
    const rail = data.rail.find((s) => s[2] === '徳島')!
    expect([h.title, h.lon, h.lat]).toEqual(['徳島駅', rail[0], rail[1]])
  })
  it('駅データにない駅名は GSI の title が「〜駅」の候補を使う', () => {
    const h = pickSearchHit('架空の駅', [{ lon: 134.5, lat: 34.05, title: '架空の駅' }], data)!
    expect(h.title).toBe('架空の駅')
    expect(h.lon).toBe(134.5)
  })
  it('用語集: 国庫帰属などを検出する', () => {
    const g = glossaryFor('国庫帰属の申請。市街化調整区域。用途地域は')
    expect(g.map((x) => x.term).join()).toMatch(/国庫帰属.*用途地域.*市街化調整区域/)
    expect(g[0].text).toContain('国に引き取って')
  })
  it('駅候補がなければ同梱の駅データの座標', () => {
    const h = pickSearchHit('徳島駅', hits.slice(0, 3), data)
    expect(h?.title).toBe('徳島駅')
    expect(Math.abs(h!.lat - 34.07)).toBeLessThan(0.02)
  })
  it('駅を含まない語は徳島市周辺の候補を優先', () => {
    expect(pickSearchHit('徳島市', hits, data)?.title).toBe('徳島県徳島市')
  })
})

describe('要約', () => {
  it('注意項目と相談先の候補を最大3行で出す', () => {
    const f = base({ flood: { status: 'inside', depth: '0.5〜3m' }, hightide: { status: 'inside' }, tsunami: { status: 'inside' } })
    const d = buildDigest(f, buildSheet(f, { building: 'あり' }))
    expect(d.length).toBeGreaterThan(0)
    expect(d.length).toBeLessThanOrEqual(3)
    expect(d[0]).toMatch(/洪水.*高潮.*津波/)
    expect(d.join('')).toMatch(/不動産会社|市役所/)
    expect(d.join('')).not.toMatch(/すべき|おすすめ/)
  })
  it('通信失敗は「取得できなかった」と出す', () => {
    const f = base({ flood: { status: 'error' } })
    expect(buildDigest(f, buildSheet(f, {})).join('')).toMatch(/取得できなかった項目/)
  })
})

describe('逆ジオコーダ', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('町名まで返す', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: { muniCd: '36201', lv01Nm: '徳島町城内' } }) }))
    expect(await reverseGeocode(134.5518, 34.0762)).toBe('徳島県徳島市徳島町城内')
  })
  it('失敗時は null（画面は「住所を取得できなかった」）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('x')))
    expect(await reverseGeocode(1, 1)).toBeNull()
  })
  it('応答がない時は時間切れで null（土地の条件の表示を止めない）', async () => {
    vi.useFakeTimers()
    // AbortSignal.timeout はネイティブのタイマーで動くので、偽タイマー上で同じ働きをするものに差し替える
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('timeout', 'TimeoutError')), ms); return c.signal })
    try {
      // 中断の合図（signal）が来るまで返さない fetch
      vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)))))
      const p = reverseGeocode(1, 1)
      await vi.advanceTimersByTimeAsync(REVERSE_GEOCODE_TIMEOUT_MS + 10)
      expect(await p).toBeNull()
      expect(spy).toHaveBeenCalledWith(REVERSE_GEOCODE_TIMEOUT_MS)
    } finally {
      spy.mockRestore()
      vi.useRealTimers()
    }
  })
})

const data = JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/biz-realestate/tokushima.json'), 'utf8')) as AreaData

const base = (o: Partial<Facts> = {}): Facts => ({
  place: 't', inArea: true, zone: null, flood: { status: 'outside' }, hightide: { status: 'outside' }, tsunami: { status: 'outside' },
  sediment: { kyukeisha: 'outside', dosekiryu: 'outside', jisuberi: 'outside' }, elevation: null, transit: null, ...o,
})
const text = (s: unknown) => JSON.stringify(s)
const exit = (s: ReturnType<typeof buildSheet>, k: string) => s.exits.find((e) => e.key === k)

describe('地理', () => {
  it('タイル座標: 徳島市役所付近は z16 で 57262/26164', () => {
    const t = tileOf(134.5548, 34.0703, 16)
    expect([t.x, t.y]).toEqual([57262, 26164])
  })
  it('世界座標の往復', () => {
    const w = lonLatToWorld(134.5, 34.0, 15), b = worldToLonLat(w.x, w.y, 15)
    expect(Math.abs(b.lon - 134.5)).toBeLessThan(1e-9)
    expect(Math.abs(b.lat - 34.0)).toBeLessThan(1e-9)
  })
  it('距離: 経度0.01度 (北緯34度) は約920m', () => {
    const d = haversine(134.5, 34, 134.51, 34)
    expect(d).toBeGreaterThan(900)
    expect(d).toBeLessThan(940)
  })
  it('多角形の内外判定と穴', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    const hole: [number, number][] = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
    expect(inPolygon(1, 1, [sq])).toBe(true)
    expect(inPolygon(11, 1, [sq])).toBe(false)
    expect(inPolygon(5, 5, [sq, hole])).toBe(false)
  })
})

describe('同梱データ', () => {
  it('徳島駅付近（北緯34.0742 東経134.5515）で用途地域が見つかる', () => {
    const z = findZone(data.zones, 134.5515, 34.0742)
    expect(z).not.toBeNull()
    expect(typeof z!.name).toBe('string')
  })
  it('交通: 最寄り停留所と駅', () => {
    const t = transitAround(data, 134.5548, 34.0703, 500)
    expect(t.bus && t.bus.dist).toBeLessThan(2000)
    expect(t.rail && t.rail.dist).toBeLessThan(5000)
  })
})

describe('画素の分類', () => {
  it('洪水', () => {
    expect(classifyFlood([0, 0, 0, 0]).inside).toBe(false)
    const c = classifyFlood([255, 216, 192, 255])
    expect(c.inside).toBe(true)
    expect(c.depth).toBe('0.5〜3m')
    expect(classifyFlood([10, 200, 10, 255]).depth).toBeNull()
  })
  it('標高タイル', () => {
    expect(demElevation(0, 0, 100)).toBe(1)
    expect(demElevation(128, 0, 0)).toBeNull()
  })
})

describe('1枚シート', () => {
  it('4つの出口があり、建物ありは手放すに国庫帰属と司法書士', () => {
    const s = buildSheet(base(), { building: 'あり' })
    expect(s.exits.map((e) => e.label)).toEqual(['売る', '貸す', '活かす', '手放す'])
    expect(text(exit(s, 'release'))).toMatch(/国庫帰属/)
    expect(text(exit(s, 'release'))).toMatch(/司法書士/)
  })
  it('洪水想定区域内なら貸すに借り手への説明を聞く項目', () => {
    const s = buildSheet(base({ flood: { status: 'inside', depth: '0.5〜3m' } }), {})
    expect(text(exit(s, 'rent'))).toMatch(/洪水浸水想定区域/)
    expect(text(exit(s, 'rent'))).toMatch(/借り手に何を説明すべきか/)
  })
  it('用途地域あり: 売る・貸す・活かすに用途地域名', () => {
    const s = buildSheet(base({ zone: { name: '商業地域', bcr: 80, far: 400, polys: [] } }), {})
    for (const k of ['sell', 'rent', 'use']) expect(text(exit(s, k))).toMatch(/商業地域/)
  })
  it('用途地域の指定がない場合は区域区分を聞く（断定しない）', () => {
    const s = buildSheet(base(), {})
    expect(text(exit(s, 'sell'))).toMatch(/市街化調整区域か/)
    expect(text(s)).toMatch(/可能性/)
  })
  it('データ範囲外は「データにない項目」に用途地域', () => {
    const s = buildSheet(base({ inArea: false }), {})
    expect(s.missing.some((m) => m.includes('用途地域'))).toBe(true)
  })
  it('通信失敗は「該当しなかった」ではなく取得できなかった（土砂も）', () => {
    for (const o of [{ flood: { status: 'error' as const } }, { sediment: { kyukeisha: 'error' as const, dosekiryu: 'outside' as const, jisuberi: 'outside' as const } }]) {
      const f = base(o)
      const s = buildSheet(f, {})
      expect(s.missing.some((m) => m.includes('取得できませんでした'))).toBe(true)
      expect(text(s)).not.toMatch(/該当しなかった/)
      expect(summarize(f).some((r) => r.value.includes('取得できなかった') && r.tone === 'unknown')).toBe(true)
    }
  })
  it('例（徳島駅付近）: 実データの用途地域を使い、調整区域の前提は置かない。回答は例（架空）と明記', () => {
    const f = base({ example: true, zone: { name: '商業地域', bcr: 80, far: 600, polys: [] } })
    const s = buildSheet(f, SAMPLE_ANSWERS)
    expect(s.example).toBe(true)
    expect(s.title).toContain('徳島駅付近')
    expect(text(exit(s, 'sell'))).toMatch(/商業地域/)
    expect(text(s)).not.toMatch(/市街化調整区域にある|サンプルの前提|〇〇バス停|△△駅/)
    expect(text(exit(s, 'sell'))).toMatch(/相続登記/)
  })
  it('農地・接道なし・登記未の回答が反映される', () => {
    const s = buildSheet(base(), { landUse: '農地', road: 'なし', registered: '未' })
    expect(text(exit(s, 'rent'))).toMatch(/農業委員会/)
    expect(text(exit(s, 'use'))).toMatch(/建築指導/)
    expect(text(exit(s, 'release'))).toMatch(/登記/)
  })
  it('価格・査定額・断定表現を出さない', () => {
    const f = base({ zone: { name: '第一種住居地域', bcr: 60, far: 200, polys: [] }, flood: { status: 'inside', depth: '3〜5m' }, elevation: 2.3,
      transit: { radius: 500, busNames: 2, bus: { name: 'A', dist: 120 }, rail: { name: 'B', dist: 900 } } })
    const t = text([buildSheet(f, { building: 'あり', landUse: '農地', road: 'なし', registered: '未' }), summarize(f)])
    expect(t).not.toMatch(/円|万円|査定額|評価額|売るべき|貸すべき|手放すべき|おすすめ/)
    expect(t).not.toMatch(/不動産情報ライブラリ/)
  })
})

describe('summarize', () => {
  it('用途地域名と洪水の可否が先頭付近に出る', () => {
    const r = summarize(base({ zone: { name: '商業地域', bcr: 80, far: 400, polys: [] }, flood: { status: 'inside', depth: '0.5〜3m' } }))
    expect(r[0].value).toContain('商業地域')
    expect(r.find((x) => x.key === 'flood')!.value).toContain('入る')
    expect(r.find((x) => x.key === 'flood')!.tone).toBe('warn')
  })
  it('範囲外は出せないと言う', () => {
    expect(summarize(base({ inArea: false }))[0].value).toContain('出せない')
  })
})

describe('収集（通信失敗）', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('fetch が全部失敗しても「区域外」とは言わず error になる', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const f = await analyze(data, 134.5515, 34.0742, 't')
    expect(f.flood?.status).toBe('error')
    expect(f.hightide?.status).toBe('error')
    expect(f.sediment.kyukeisha).toBe('error')
    expect(f.zone).not.toBeNull() // 同梱データは通信不要
  })
  it('404 はタイルなし＝区域外', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
    const f = await analyze(data, 134.5515, 34.0742, 't')
    expect(f.flood?.status).toBe('outside')
  })
})

// ---- 不動産情報ライブラリ（フィクスチャ。テスト用の値で、画面には出ない。実データではない） ----
describe('不動産情報ライブラリ: 取得結果の整形', () => {
  const rows = (district: string, prices: number[], type = '宅地(土地)') =>
    prices.map((p, i) => ({ Type: type, DistrictName: district, UnitPrice: String(p), Period: `2025年第${(i % 4) + 1}四半期` }))
  it('町名ごとの㎡単価の中央値。MIN_TRADES件未満の町名は出さない。個別の取引は残らない', () => {
    const t = aggregateTrade([...rows('A町', [100, 300, 200]), ...rows('B町', [50, 60]), ...rows('C町', [10], '中古マンション等')])!
    expect(t.districts).toEqual([{ name: 'A町', n: 3, medianUnitPrice: 200 }])
    expect(t.city).toEqual({ name: '市全体', n: 5, medianUnitPrice: 100 })
    expect(t.total).toBe(5)
    expect(t.period).toBe('2025年第1四半期〜2025年第3四半期')
    expect(JSON.stringify(t)).not.toMatch(/TradePrice|Area|Remarks/)
    expect(MIN_TRADES).toBe(3)
  })
  it('全角括弧の「宅地（土地）」も数える。土地以外・単価なしだけなら null', () => {
    expect(aggregateTrade(rows('A', [1, 2, 3], '宅地（土地）'))?.total).toBe(3)
    expect(aggregateTrade(rows('A', [1, 2, 3], '宅地(土地と建物)'))).toBeNull()
    expect(aggregateTrade([{ Type: '宅地(土地)', DistrictName: 'A', UnitPrice: '' }])).toBeNull()
  })
  it('地価公示: 点を取り出し、point_id で重複を除く（タイル境界）', () => {
    const f = (id: number, lon: number) => ({ geometry: { type: 'Point', coordinates: [lon, 34.07] }, properties: { point_id: id, u_current_years_price_ja: '1,234,000(円/㎡)', standard_lot_number_ja: '徳島5-1', use_category_name_ja: '4,商業地', target_year_name_ja: '令和7年7月1日', land_price_type: 0, location: '徳島市X' } })
    const pts = extractLandPoints([f(1, 134.55), f(1, 134.55), f(2, 134.56), { geometry: { type: 'Point', coordinates: [1, 1] }, properties: { point_id: 3 } }])
    expect(pts.map((p) => p.id)).toEqual([1, 2])
    expect(pts[0]).toMatchObject({ price: 1234000, use: '商業地', kind: '地価公示', lot: '徳島5-1' })
  })
  it('区域区分: Polygon と MultiPolygon を多角形にし、座標を丸める', () => {
    const sq = [[[0, 0], [1, 0], [1, 1.123456789], [0, 0]]]
    const out = extractDivision([
      { geometry: { type: 'Polygon', coordinates: sq }, properties: { area_classification_ja: '市街化区域' } },
      { geometry: { type: 'MultiPolygon', coordinates: [sq] }, properties: { area_classification_ja: '市街化調整区域' } },
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { area_classification_ja: '無視' } },
    ])
    expect(out.map((o) => o.cls)).toEqual(['市街化区域', '市街化調整区域'])
    expect(out[0].polys[0][0][2]).toEqual([1, 1.12346])
  })
})

describe('不動産情報ライブラリ: 検証・照合・表示', () => {
  const fixture: ReinfolibData = {
    generator: GENERATOR, source: '国土交通省 不動産情報ライブラリ', fetchedAt: '2026-11-20', city: { code: '36201', name: '徳島市' },
    trade: { period: '2025年第1四半期〜2025年第4四半期', total: 40, city: { name: '市全体', n: 40, medianUnitPrice: 111000 }, districts: [{ name: '寺島本町東', n: 5, medianUnitPrice: 222000 }] },
    landPrice: { year: 2025, points: [{ id: 1, lon: 134.5515, lat: 34.0745, lot: '徳島5-1', use: '商業地', price: 333000, year: '令和7年7月1日', location: '徳島市X', kind: '地価公示' }, { id: 2, lon: 134.7, lat: 34.2, lot: '遠い', use: '', price: 1, year: '', location: '', kind: '' }] },
    division: { features: [{ cls: '市街化区域', polys: [[[[134.5, 34.0], [134.6, 34.0], [134.6, 34.1], [134.5, 34.1], [134.5, 34.0]]]] }] },
  }
  it('検証: 作成者・出典・取得日の形が違うものは読み込まない（手書きの偽ファイルを通さない）', () => {
    expect(isReinfolibData(fixture)).not.toBeNull()
    expect(isReinfolibData({ ...fixture, generator: 'hand' })).toBeNull()
    expect(isReinfolibData({ ...fixture, fetchedAt: '' })).toBeNull()
    expect(isReinfolibData({ ...fixture, source: 'x' })).toBeNull()
    expect(isReinfolibData(null)).toBeNull()
    expect(isReinfolibData('<!doctype html>')).toBeNull()
    expect(isReinfolibData({ ...fixture, trade: undefined, landPrice: undefined, division: undefined })).toBeNull()
  })
  it('検証: MIN_TRADES 未満の集計・価格0の標準地は捨てる', () => {
    const d = isReinfolibData({ ...fixture, trade: { ...fixture.trade!, city: { name: '市全体', n: 2, medianUnitPrice: 5 }, districts: [] }, landPrice: { year: 2025, points: [{ ...fixture.landPrice!.points[0], price: 0 }] } })!
    expect(d.trade).toBeUndefined()
    expect(d.landPrice).toBeUndefined()
    expect(d.division).toBeDefined()
  })
  it('町名の取り出し: 丁目を除く', () => {
    expect(townOf('徳島県徳島市寺島本町東三丁目付近', '徳島市')).toBe('寺島本町東')
    expect(townOf(null, '徳島市')).toBeNull()
    expect(townOf('徳島県鳴門市撫養町', '徳島市')).toBeNull()
  })
  it('照合: 区域内・近い標準地・町名一致。遠い標準地は使わない', () => {
    const l = lookupLibrary(fixture, 134.5515, 34.0745, '徳島県徳島市寺島本町東三丁目付近')!
    expect(l.division?.main).toBe('市街化区域')
    expect(l.landPrice?.point.id).toBe(1)
    expect(l.trade).toMatchObject({ scope: 'district', stat: { name: '寺島本町東' } })
  })
  it('照合: 町名が集計にない時は市全体。住所なし・他市町村は取引なし。範囲外は null。取得結果なしは null', () => {
    expect(lookupLibrary(fixture, 134.5515, 34.0745, '徳島県徳島市別の町')!.trade?.scope).toBe('city')
    expect(lookupLibrary(fixture, 134.5515, 34.0745, null)!.trade).toBeUndefined() // 住所が取れない時は取引の数値を当てない
    expect(lookupLibrary(fixture, 134.5515, 34.0745, '徳島県鳴門市撫養町')!.trade).toBeUndefined() // 他市町村
    expect(lookupLibrary(fixture, 135.5, 35.0, null)).toBeNull()
    expect(lookupLibrary(null, 134.5515, 34.0745, 'x')).toBeNull()
  })
  it('取得結果がなければ、シート・要約に「ライブラリ由来」も金額も出ない（偽の由来を出さない）', () => {
    const f = base({ zone: { name: '商業地域', bcr: 80, far: 600, polys: [] }, lib: null })
    const s = buildSheet(f, {})
    expect(s.libSections).toEqual([])
    expect(text([s, summarize(f)])).not.toMatch(/ライブラリ由来|不動産情報ライブラリ|円/)
    expect(s.otherItems.join()).toMatch(/取引価格.*地価公示.*区域区分/)
  })
  it('取得結果があれば、売るの聞くことと要約に由来つきで出て、「確認する項目」から外れる。価格は参考値・個別でないと明記', () => {
    const lib = lookupLibrary(fixture, 134.5515, 34.0745, '徳島県徳島市寺島本町東三丁目付近')!
    const f = base({ zone: { name: '商業地域', bcr: 80, far: 600, polys: [] }, lib })
    const s = buildSheet(f, {})
    expect(s.libSections).toEqual(['division', 'landPrice', 'trade'])
    const sell = exit(s, 'sell')!.items.filter((i) => i.basis === 'library' && i.media !== 'print')
    expect(sell).toHaveLength(2) // 市街化区域で用途地域が分かっている時、区域区分は用途地域の項目と同じ問いになるので売るには重ねない（行には出る）
    expect(exit(buildSheet(base({ zone: null, lib }), {}), 'sell')!.items.filter((i) => i.basis === 'library' && i.media !== 'print')).toHaveLength(3)
    expect(text(sell)).toMatch(/333,000円/)
    expect(text(sell)).toMatch(/この土地の価格ではない/)
    expect(text(sell)).toMatch(/個別の物件の価格ではない/)
    expect(text(sell)).not.toMatch(/売るべき|査定額|評価額|おすすめ/)
    const rows = summarize(f).filter((r) => r.lib)
    expect(rows.map((r) => r.key)).toEqual(['lib-division', 'lib-land', 'lib-trade'])
    expect(summarize(f).filter((r) => !r.lib).every((r) => !/円/.test(r.value))).toBe(true)
    expect(s.otherItems.join()).not.toMatch(/取引価格|地価公示|区域区分/)
    expect(sheetToText(s, summarize(f), [], '', [])).toMatch(/ライブラリ由来/)
    expect(rows.find((r) => r.key === 'lib-land')!.value).toMatch(/地価公示・商業地/) // 標準地の用途を併記（住宅地の土地に商業地の価格を当てたと誤読させない）
  })
  it('印刷用: 地価と取引は売るで1項目（印刷だけ）にまとめ、条件の行も1行にまとめる。テキストのコピーには印刷用の項目を入れない', () => {
    const lib = lookupLibrary(fixture, 134.5515, 34.0745, '徳島県徳島市寺島本町東三丁目付近')!
    const f = base({ zone: null, lib })
    const s = buildSheet(f, {})
    const sell = exit(s, 'sell')!.items
    expect(sell.filter((i) => i.media === 'screen').map((i) => i.libKey)).toEqual(['landPrice', 'trade'])
    const merged = sell.filter((i) => i.media === 'print')
    expect(merged).toHaveLength(1)
    expect(merged[0].fact).toMatch(/333,000円\/㎡（この土地の価格ではない）.*寺島本町東.*個別の物件の価格ではない/)
    const line = libPrintLine(f)!
    expect(line).toMatch(/^市街化区域／標準地 .*333,000円\/㎡.*／寺島本町東の取引 中央値/)
    expect(sheetToText(s, summarize(f), [], '', [])).not.toContain(merged[0].fact)
    expect(libPrintLine(base({ lib: null }))).toBeNull()
  })
  it('取引価格のデータは取得済みで、この地点に当てられない時: 「？」の行を出し、「確認する項目」には入れない（取得していないと誤読させない）', () => {
    const lib = lookupLibrary(fixture, 134.5515, 34.0745, null)!
    expect(lib.trade).toBeUndefined()
    expect(lib.tradeUnmatched).toMatch(/町名が分からず/)
    const f = base({ lib })
    const row = summarize(f).find((r) => r.key === 'lib-trade-none')!
    expect(row).toMatchObject({ tone: 'unknown', label: '取引価格の傾向' })
    expect(row.lib).toBeFalsy()
    expect(row.value).toMatch(/取得済み/)
    expect(row.value).not.toMatch(/円/)
    expect(buildSheet(f, {}).otherItems.join()).not.toMatch(/取引価格/)
    expect(libPrintLine(f)).toMatch(/取引価格: 町名が分からず/)
    expect(lookupLibrary(fixture, 134.5515, 34.0745, '徳島県鳴門市撫養町')!.tradeUnmatched).toMatch(/徳島市内の住所と確認できず/)
  })
  it('利用規約の表示: API利用規約第7条のクレジットは規約の文言のまま。出典は記載例どおり', () => {
    expect(REINFOLIB_CREDIT).toBe('このサービスは、国土交通省の不動産情報ライブラリのAPI機能を使用していますが、提供情報の最新性、正確性、完全性等が保証されたものではありません')
    expect(REINFOLIB_ATTRIBUTION).toBe('出典：国土交通省　不動産情報ライブラリ（https://www.reinfolib.mlit.go.jp/）')
    expect(REINFOLIB_PROCESSED).toMatch(/をもとに作成者が.*作成/) // 加工した旨
    expect(REINFOLIB_RESPONSIBILITY).toMatch(/作成者が負います.*国が作成・監修したものではありません/) // 国が作成したかのような態様にしない
  })
  it('テキストでコピー: ライブラリ由来の行がある時だけ、出典・加工の明記・クレジット・責任の所在が入る', () => {
    const withLib = base({ lib: lookupLibrary(fixture, 134.5515, 34.0745, '徳島県徳島市寺島本町東三丁目付近') })
    const t1 = sheetToText(buildSheet(withLib, {}), summarize(withLib), [], '', [])
    for (const x of [REINFOLIB_ATTRIBUTION, REINFOLIB_PROCESSED, REINFOLIB_CREDIT, REINFOLIB_RESPONSIBILITY]) expect(t1).toContain(x)
    const noLib = base({ lib: null })
    expect(sheetToText(buildSheet(noLib, {}), summarize(noLib), [], '', [])).not.toMatch(/不動産情報ライブラリ/)
  })
  it('区域区分の行: 都市計画区域は市街化区域と重なるだけなので併記しない', () => {
    const lib: ReinfolibData = { ...fixture, division: { features: [{ cls: '都市計画区域', polys: fixture.division!.features[0].polys }, ...fixture.division!.features] } }
    const row = summarize(base({ lib: lookupLibrary(lib, 134.55, 34.05, null) })).find((r) => r.key === 'lib-division')!
    expect(row.value).toBe('市街化区域')
  })
  it('調整区域のときは売る・活かすに市役所への聞くことが付く', () => {
    const lib: ReinfolibData = { ...fixture, trade: undefined, landPrice: undefined, division: { features: [{ cls: '市街化調整区域', polys: fixture.division!.features[0].polys }] } }
    const s = buildSheet(base({ lib: lookupLibrary(lib, 134.55, 34.05, null) }), {})
    expect(text(exit(s, 'sell'))).toMatch(/市街化調整区域/)
    expect(text(exit(s, 'use'))).toMatch(/必要な手続き/)
  })
})

// ---- 実際に取得した結果（同梱データ contests/ichibiz-2026/app/realestate/web/data/reinfolib.json。無い環境では飛ばす） ----
const REAL = resolve(__dirname, '../../../../ichibiz-2026/app/realestate/web/data/reinfolib.json')
describe.skipIf(!existsSync(REAL))('不動産情報ライブラリ: 取得済みの実データ', () => {
  const raw = existsSync(REAL) ? readFileSync(REAL, 'utf8') : '{}'
  const d = isReinfolibData(JSON.parse(raw))
  it('検証を通り、3項目（取引価格・地価公示/地価調査・区域区分）が揃っている', () => {
    expect(d).not.toBeNull()
    expect(d!.city).toEqual({ code: '36201', name: '徳島市' })
    expect(d!.trade?.city?.n).toBeGreaterThanOrEqual(MIN_TRADES)
    expect(d!.trade!.districts.every((x) => x.n >= MIN_TRADES)).toBe(true)
    expect(d!.landPrice!.points.length).toBeGreaterThan(0)
    expect(d!.division!.features.length).toBeGreaterThan(0)
  })
  it('個別の取引やキーらしき項目を含まない（集計値だけ）', () => {
    expect(raw).not.toMatch(/Ocp-Apim|[Ss]ubscription|apiKey|api_key/)
    for (const x of d!.trade!.districts) expect(Object.keys(x).sort()).toEqual(['medianUnitPrice', 'n', 'name'])
  })
  it('徳島駅付近: 区域区分・近くの標準地・取引価格（町名の集計がなければ市全体）が出る', () => {
    const l = lookupLibrary(d, 134.5515, 34.07451, '徳島県徳島市寺島本町西一丁目')!
    expect(l.division?.main).toBe('市街化区域')
    expect(l.landPrice).toBeDefined()
    expect(l.trade?.stat.n).toBeGreaterThanOrEqual(MIN_TRADES)
  })
})
