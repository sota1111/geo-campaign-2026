import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  OVERLAYS, circlePoly, createRecord, crossCheck, distanceM, fmtDist, isPublishable, kindsOf, nearby,
  overlayTileUrl, setVerified, toGeoJSON, validateRecord, type LoreItem, type SamplePlace,
} from './logic'

const read = (f: string) => JSON.parse(readFileSync(`public/data/biz-idea/${f}`, 'utf8'))
const lore: LoreItem[] = read('lore.json').items
const places: SamplePlace[] = read('samples.json').places

const good = () => ({
  placeName: 'テスト地名（架空）', placeType: '旧地名', teller: '語り手Z（架空）', heardOn: '2026-11-11',
  story: 'テスト用の話（架空）', basis: '（架空）語り手Zの話', claimedKinds: ['洪水'], certainty: '不明',
  visibility: 'public', license: 'CC BY 4.0', lon: 132.49, lat: 34.48, checked: ['x'],
})

describe('距離・近傍・突き合わせ', () => {
  it('distanceM: 同一点は0、緯度1度は約111km', () => {
    expect(distanceM(132, 34, 132, 34)).toBe(0)
    const d = distanceM(132, 34, 132, 35)
    expect(d).toBeGreaterThan(110500)
    expect(d).toBeLessThan(111800)
  })
  it('kindsOf: 区切り表記を分解し、未知はその他', () => {
    expect(kindsOf('洪水・土砂災害')).toEqual(['洪水', '土砂災害'])
    expect(kindsOf('雪害')).toEqual(['その他'])
    expect(kindsOf('')).toEqual([])
  })
  it('nearby: 半径内のみ・近い順', () => {
    const r = nearby(lore, 132.495, 34.4785, 1000)
    expect(r.length).toBeGreaterThanOrEqual(1)
    r.forEach((x, i) => {
      expect(x.dist).toBeLessThanOrEqual(1000)
      if (i) expect(r[i - 1].dist).toBeLessThanOrEqual(x.dist)
    })
    expect(nearby(lore, 132.495, 34.4785, 1)).toHaveLength(0)
  })
  it('crossCheck: 種類が合えば clue、合わなければ none（危険度は返さない）', () => {
    const near = nearby(lore, 132.495, 34.4785, 1000)
    const a = crossCheck(['洪水'], near)
    expect(a.level).toBe('clue')
    expect(a).not.toHaveProperty('risk')
    const b = crossCheck(['地震'], near)
    expect(b.level).toBe('none')
    expect(b.missingKinds).toEqual(['地震'])
  })
  it('サンプル地名: すべて架空表記。s1〜s3 は手がかりあり、s4/s5 は見つからず', () => {
    const lv: Record<string, string> = {}
    places.forEach((p) => {
      expect(p.name).toMatch(/架空/)
      expect(p.teller).toMatch(/架空/)
      lv[p.id] = crossCheck(p.claimedKinds, nearby(lore, p.lon, p.lat, 1000)).level
    })
    expect(lv).toEqual({ s1: 'clue', s2: 'clue', s3: 'clue', s4: 'none', s5: 'none' })
  })
})

describe('記録・確認・書き出し', () => {
  it('validateRecord: 必須項目と位置の検証', () => {
    expect(validateRecord(good())).toEqual([])
    expect(validateRecord({ ...good(), placeName: ' ' })).toHaveLength(1)
    expect(validateRecord({ ...good(), lon: null })).toContain('地図で位置を選んでください')
    expect(validateRecord({ ...good(), lat: 100 })).toContain('位置が範囲外です')
    expect(validateRecord({ ...good(), license: 'x' })).toContain('利用条件を選んでください')
  })
  it('createRecord: 新規は必ず未確認・非公開分扱い', () => {
    const r = createRecord(good(), '2026-11-11T00:00:00.000Z')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.verified).toBe(false)
      expect(isPublishable(r.record)).toBe(false)
    }
    expect(createRecord({ ...good(), story: '' }, 'x').ok).toBe(false)
  })
  it('公開条件: 確認済み・公開・利用条件あり。非公開/利用不可/サンプルは対象外', () => {
    const r = createRecord(good(), '2026-11-11T00:00:00.000Z')
    if (!r.ok) throw new Error('x')
    const v = setVerified(r.record, '', '2026-11-12T00:00:00.000Z')
    expect(v.verifiedBy).toBe('（確認役）')
    expect(isPublishable(v)).toBe(true)
    expect(isPublishable({ ...v, visibility: 'private' })).toBe(false)
    expect(isPublishable({ ...v, license: 'none' })).toBe(false)
    expect(isPublishable({ ...v, sample: true })).toBe(false)
  })
  it('toGeoJSON: 公開分は確認済みのみ、全件は非公開を除く', () => {
    const a = createRecord(good(), '2026-11-11T00:00:00.000Z')
    const b = createRecord({ ...good(), visibility: 'private' }, '2026-11-11T00:00:01.000Z')
    if (!a.ok || !b.ok) throw new Error('x')
    const recs = [a.record, b.record]
    expect(toGeoJSON(recs, { onlyPublishable: true }).features).toHaveLength(0)
    expect(toGeoJSON(recs).features).toHaveLength(1)
    const pub = toGeoJSON([setVerified(a.record, 'x', 'y'), b.record], { onlyPublishable: true })
    expect(pub.features).toHaveLength(1)
    expect(pub.features[0].geometry.coordinates).toEqual([132.49, 34.48])
  })
})

describe('その他', () => {
  it('fmtDist / circlePoly', () => {
    expect(fmtDist(500)).toBe('500 m')
    expect(fmtDist(1000)).toBe('1.0 km')
    expect(circlePoly(132.5, 34.5, 1000).geometry.coordinates[0]).toHaveLength(49)
  })
  it('重ね合わせの地理院タイルURLとズーム範囲は元アプリと同じ', () => {
    const o = OVERLAYS.find((x) => x.id === 'ort_USA10')!
    expect(overlayTileUrl(o)).toBe('https://cyberjapandata.gsi.go.jp/xyz/ort_USA10/{z}/{x}/{y}.png')
    expect([o.minzoom, o.maxzoom]).toEqual([10, 17])
    expect(OVERLAYS.map((x) => x.id)).toEqual(['none', 'ort_USA10', 'ort_old10', 'swale', 'lcmfc2', 'relief'])
  })
})
