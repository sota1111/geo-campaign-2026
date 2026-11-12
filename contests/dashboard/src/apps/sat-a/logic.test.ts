import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ageNorm, satNorm, segScore, rank, selectByBudget, totalKm, auc, calibrate, exclusionAccuracy, candidatesOf,
  type SampleData, type Segment,
} from './logic'

const data: SampleData = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../../../public/data/sat-a/sample.json'), 'utf8'),
)
const cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]))

describe('sat-a logic', () => {
  it('正規化は0〜1に収まる', () => {
    expect(ageNorm(2026)).toBe(0)
    expect(ageNorm(1900)).toBe(1)
    expect(ageNorm(1996)).toBe(0.5)
    expect(satNorm(0)).toBe(0)
    expect(satNorm(-20)).toBe(1)
    expect(satNorm(4)).toBe(0)
    expect(satNorm(-4)).toBe(0.5)
  })
  it('点数: w=0で台帳のみ、w=1で衛星のみ', () => {
    const s = { cell: 'A3', year: 1966 }
    expect(segScore(s, cellSat, 0)).toBe(1)
    expect(segScore(s, cellSat, 1)).toBe(cellSat.A3)
    expect(segScore(s, { A3: 0.5 }, 0.5)).toBe(0.75)
  })
  it('rank は降順で安定', () => {
    const r = rank(data.segments, cellSat, 0.5)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
    expect(rank(data.segments, cellSat, 0.5).map((x) => x.id)).toEqual(r.map((x) => x.id))
  })
  it('selectByBudget: 未調査の生活道路のみ・予算内・最上位を含む', () => {
    const r = rank(data.segments, cellSat, 0.5)
    const ids = selectByBudget(r, 3)
    const set = new Set(ids)
    expect(ids.length).toBeGreaterThan(0)
    expect(totalKm(data.segments, set)).toBeLessThanOrEqual(3)
    for (const id of ids) {
      const s = data.segments.find((x) => x.id === id) as Segment
      expect(s.cls).toBe('life')
      expect(s.surveyed).toBe(false)
    }
    expect(selectByBudget(r, 0)).toHaveLength(0)
    expect(set.has(candidatesOf(r)[0].id)).toBe(true)
  })
  it('auc', () => {
    expect(auc([{ hit: true, score: 2 }, { hit: false, score: 1 }])).toBe(1)
    expect(auc([{ hit: true, score: 1 }, { hit: false, score: 2 }])).toBe(0)
    expect(auc([{ hit: true, score: 1 }, { hit: false, score: 1 }])).toBe(0.5)
    expect(auc([{ hit: true, score: 1 }])).toBeNull()
  })
  it('calibrate: 衛星が当たるなら重み大、データ不足はnull', () => {
    const cs = { A: 1, B: 0 }
    const sc = []
    for (let i = 0; i < 5; i++) {
      sc.push({ cell: 'A', year: 1990 + i, hit: true })
      sc.push({ cell: 'B', year: 1990 + i, hit: false })
    }
    const c = calibrate(sc, cs)
    expect(c.w).toBeGreaterThanOrEqual(0.5)
    expect(c.satOnly).toBe(1)
    const few = calibrate(sc.slice(0, 4), cs)
    expect(few.w).toBeNull()
    expect(few.reason).toBe('データ不足')
  })
  it('calibrate: 台帳が当たるなら重み小', () => {
    const cs = { A: 0.5, B: 0.5 }
    const sc = []
    for (let i = 0; i < 5; i++) {
      sc.push({ cell: 'A', year: 1962, hit: true })
      sc.push({ cell: 'B', year: 2020, hit: false })
    }
    expect(calibrate(sc, cs).w as number).toBeLessThanOrEqual(0.5)
  })
  it('exclusionAccuracy', () => {
    const sc = []
    for (let i = 0; i < 10; i++) sc.push({ cell: 'A', year: 1970 + i * 4, hit: i < 5 })
    const e = exclusionAccuracy(sc, { A: 0 }, 0)
    expect(e?.n).toBe(5)
    expect(e?.rate).toBe(1)
    expect(exclusionAccuracy(sc.slice(0, 6), { A: 0 }, 0)).toBeNull()
  })
  it('サンプルデータの整合性', () => {
    expect(data.note).toContain('架空')
    expect(new Set(data.segments.map((s) => s.id)).size).toBe(data.segments.length)
    const cells = new Set(data.cells.map((c) => c.id))
    for (const s of data.segments) {
      expect(cells.has(s.cell)).toBe(true)
      expect(s.lenM).toBeGreaterThan(0)
    }
    expect(candidatesOf(rank(data.segments, cellSat, 0.5)).length).toBeGreaterThan(50)
  })
})
