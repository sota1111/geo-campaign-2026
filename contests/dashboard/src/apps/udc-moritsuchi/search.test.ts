import { describe, expect, it } from 'vitest'
import { NEAR_M, nearSummary, parseGsiSearch } from './search'

describe('住所検索・近さの説明', () => {
  it('地名検索の応答: 範囲内を先に、重複・不正を除く', () => {
    const j = [
      { geometry: { coordinates: [139.7, 35.68] }, properties: { title: '東京駅' } },
      { geometry: { coordinates: [139.0777, 35.1039] }, properties: { title: '熱海駅' } },
      { geometry: { coordinates: [139.0777, 35.1039] }, properties: { title: '熱海駅' } },
      { geometry: { coordinates: ['x', 1] }, properties: { title: '壊れ' } },
    ]
    const r = parseGsiSearch(j)
    expect(r.map((x) => x.title)).toEqual(['熱海駅', '東京駅'])
    expect(r[0].inArea).toBe(true)
    expect(parseGsiSearch({})).toEqual([])
  })
  it('最寄りまでの距離と「近く」の基準を書く', () => {
    const far = nearSummary([{ id: '熱海市0012', kind: '腹付け型', city: '熱海市', inside: false, distM: 1100 }])
    expect(far).toContain('約1100m（直線）')
    expect(far).toContain(`${NEAR_M}m以内`)
    expect(far).toContain('500m以内に登録された造成地はありません')
    expect(nearSummary([{ id: 'A', kind: '谷埋め型', city: '', inside: true, distM: 0 }])).toContain('範囲内')
    expect(nearSummary([{ id: 'A', kind: '谷埋め型', city: '', inside: false, distM: 200 }])).not.toContain('ありません')
    expect(nearSummary([])).toContain('ありません')
  })
})
