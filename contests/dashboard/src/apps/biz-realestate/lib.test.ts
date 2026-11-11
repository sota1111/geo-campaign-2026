import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDigest, buildSheet, glossaryFor, pickSearchHit, classifyFlood, demElevation, findZone, haversine, inPolygon, lonLatToWorld, SAMPLE_ANSWERS, SAMPLE_FACTS,
  summarize, tileOf, transitAround, worldToLonLat, type AreaData, type Facts,
} from './lib'
import { analyze, reverseGeocode } from './collect'

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
  it('サンプル: 架空と明記、調整区域の前提', () => {
    const s = buildSheet(SAMPLE_FACTS, SAMPLE_ANSWERS)
    expect(s.sample).toBe(true)
    expect(s.title).toContain('架空')
    expect(text(exit(s, 'sell'))).toMatch(/市街化調整区域/)
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
