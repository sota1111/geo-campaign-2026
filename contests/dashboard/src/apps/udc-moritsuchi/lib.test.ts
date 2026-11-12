import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ATAMI_STATION, fillCenter, fromGeoJSON, inCoverage, makeRecord, nearbyFills, nearestFill, pointInRing,
  reportText, sanitizeRecords, toCSV, toGeoJSON, distText, type FillFeature,
} from './lib'

const fills = (JSON.parse(readFileSync('public/data/udc-moritsuchi/fills.geojson', 'utf8')) as { features: FillFeature[] }).features
const sq: FillFeature = {
  type: 'Feature', properties: { id: 'T1', city: '熱海市', kind: '谷埋め型' },
  geometry: { type: 'Polygon', coordinates: [[[139.0, 35.0], [139.01, 35.0], [139.01, 35.01], [139.0, 35.01], [139.0, 35.0]]] },
}
const rec = (o = {}) => makeRecord({ id: 'a', lng: 139.0777, lat: 35.1039, kind: 'crack', memo: 'm', observedAt: '2026-11-11 10:00', ...o })

describe('範囲・距離', () => {
  it('対象範囲の内外を判定する', () => {
    expect(inCoverage(139.07, 35.1)).toBe(true)
    expect(inCoverage(139.7, 35.68)).toBe(false)
  })
  it('点が多角形の内側か判定し、外側なら辺までの距離を返す', () => {
    expect(pointInRing(139.005, 35.005, sq.geometry.coordinates[0])).toBe(true)
    expect(nearestFill(139.005, 35.005, [sq])).toMatchObject({ inside: true, distM: 0 })
    const out = nearestFill(139.0, 35.011, [sq])!
    expect(out.inside).toBe(false)
    expect(out.distM).toBeGreaterThan(90)
    expect(out.distM).toBeLessThan(130)
  })
  it('実データ: 27か所を読め、熱海駅に近い順に並ぶ', () => {
    expect(fills).toHaveLength(27)
    const l = nearbyFills(ATAMI_STATION.lng, ATAMI_STATION.lat, fills, 5, '熱海市')
    expect(l).toHaveLength(5)
    expect(l.every((x) => x.city === '熱海市')).toBe(true)
    for (let i = 1; i < l.length; i++) expect(l[i].distM).toBeGreaterThanOrEqual(l[i - 1].distM)
    expect(['谷埋め型', '腹付け型', '区分なし']).toContain(l[0].kind)
  })
  it('fillCenter は多角形の bbox 内', () => {
    const c = fillCenter(sq)
    expect(c[0]).toBeGreaterThan(139.0)
    expect(c[0]).toBeLessThan(139.01)
  })
})

describe('記録', () => {
  it('ぼかしは小数3桁、範囲外フラグが付く', () => {
    const r = rec({ lng: 139.07777, lat: 35.10399, blurred: true })
    expect(r.lng).toBe(139.078)
    expect(r.lat).toBe(35.104)
    expect(rec({ lng: 139.7, lat: 35.68 }).outOfCoverage).toBe(true)
  })
  it('不明な種類は other、メモは500字まで', () => {
    const r = rec({ kind: 'zzz', memo: 'あ'.repeat(600) })
    expect(r.kind).toBe('other')
    expect(r.memo).toHaveLength(500)
  })
  it('GeoJSON の書き出し→読み込みで往復でき、不正な点は除外する', () => {
    const fc = toGeoJSON([rec(), rec({ id: 'b', blurred: true })])
    const back = fromGeoJSON(fc)
    expect(back.records).toHaveLength(2)
    expect(back.records[0]).toEqual(rec())
    const bad = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [999, 0] }, properties: {} }, { type: 'Feature', geometry: null }] }
    expect(fromGeoJSON(bad)).toEqual({ records: [], skipped: 2 })
    expect(fromGeoJSON('x')).toEqual({ records: [], skipped: 0 })
  })
  it('保存データの形が壊れていても空配列になる', () => {
    expect(sanitizeRecords({ a: 1 })).toEqual([])
    expect(sanitizeRecords(null)).toEqual([])
  })
  it('CSV: BOM付き・式の先頭文字を無効化・引用符を二重化', () => {
    const csv = toCSV([rec({ memo: '=SUM(1)"x"' })])
    expect(csv.startsWith('﻿"id"')).toBe(true)
    expect(csv).toContain(`"'=SUM(1)""x"""`)
    expect(csv.split('\r\n')[0]).toContain('"nearFillDistM"')
  })
})

describe('通報文', () => {
  it('日時・位置・内容・位置関係・注意を含む', () => {
    const nf = nearestFill(139.005, 35.005, [sq])
    const t = reportText(rec({ nearFill: nf }))
    expect(t).toContain('気づいた日時: 2026-11-11 10:00')
    expect(t).toContain('https://maps.gsi.go.jp/#17/35.1039/139.0777/')
    expect(t).toContain('気づいた内容: 亀裂・段差')
    expect(t).toContain('「T1」（谷埋め型）の範囲内')
    expect(t).toContain('直ちに危険であることを意味しません')
    expect(t).not.toContain('対象範囲の外')
  })
  it('ぼかし・範囲外は注記される', () => {
    const t = reportText(rec({ lng: 139.7, lat: 35.68, blurred: true, memo: '' }))
    expect(t).toContain('ぼかした位置')
    expect(t).toContain('対象範囲（熱海市・伊東市）の外')
    expect(t).toContain('（記入なし）')
  })
  it('距離表記は丸める', () => {
    expect(distText(null)).toContain('ありません')
    expect(distText({ id: 'X', kind: '腹付け型', city: '', inside: false, distM: 234 })).toContain('約250m')
    expect(distText({ id: 'X', kind: '腹付け型', city: '', inside: false, distM: 44 })).toContain('約40m')
  })
})
