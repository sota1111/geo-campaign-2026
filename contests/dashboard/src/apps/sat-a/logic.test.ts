import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ageNorm, satNorm, segScore, rank, selectByBudget, totalKm, auc, calibrate, exclusionAccuracy, candidatesOf, topShift,
  parseCsv, parseCavity, parseOutcomes, distToSegM, nearestSegment, scannedFrom,
  type DataFile, type DemoData, type Segment,
} from './logic'

// 元アプリ（contests/satellite-2026/app/proposal-a/data）の実データを直接読む（public/data へのコピーに依存しない）
const dir = path.resolve(import.meta.dirname, '../../../../satellite-2026/app/proposal-a/data')
const data: DataFile = JSON.parse(fs.readFileSync(path.join(dir, 'toyonaka.json'), 'utf8'))
const demo: DemoData = JSON.parse(fs.readFileSync(path.join(dir, 'demo_sim.json'), 'utf8'))
const cellSat = Object.fromEntries(data.cells.map((c) => [c.id, satNorm(c.disp)]))
const life = data.segments.filter((s) => s.cls === 'life')
const mid = (s: Segment): [number, number] => [(s.coords[0][0] + s.coords[1][0]) / 2, (s.coords[0][1] + s.coords[1][1]) / 2]

describe('sat-a logic', () => {
  it('正規化は0〜1に収まる。竣工年が不明の古さは中立の0.5', () => {
    expect(ageNorm(2026)).toBe(0)
    expect(ageNorm(1900)).toBe(1)
    expect(ageNorm(1996)).toBe(0.5)
    expect(ageNorm(null)).toBe(0.5)
    expect(satNorm(0)).toBe(0)
    expect(satNorm(-20)).toBe(1)
    expect(satNorm(4)).toBe(0)
    expect(satNorm(-4)).toBe(0.5)
  })
  it('点数: w=0で台帳のみ、w=1で衛星のみ', () => {
    const s = { cell: 'A3', year: 1966 }
    expect(segScore(s, { A3: 0.2 }, 0)).toBe(1)
    expect(segScore(s, { A3: 0.2 }, 1)).toBe(0.2)
    expect(segScore(s, { A3: 0.5 }, 0.5)).toBe(0.75)
  })
  it('rank は降順で安定', () => {
    const r = rank(data.segments, cellSat, 0.5)
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score)
    expect(rank(data.segments, cellSat, 0.5).map((x) => x.id)).toEqual(r.map((x) => x.id))
  })
  it('selectByBudget: 結果が未入力の生活道路のみ・予算内・最上位を含む', () => {
    const r = rank(data.segments, cellSat, 0.5)
    const ids = selectByBudget(r, 3)
    const set = new Set(ids)
    expect(ids.length).toBeGreaterThan(0)
    expect(totalKm(data.segments, set)).toBeLessThanOrEqual(3)
    for (const id of ids) expect(data.segments.find((x) => x.id === id)!.cls).toBe('life')
    expect(selectByBudget(r, 0)).toHaveLength(0)
    expect(set.has(candidatesOf(r)[0].id)).toBe(true)
    // 結果が入った区間は選ばれない
    const r2 = rank(data.segments.map((s) => (s.id === ids[0] ? { ...s, surveyed: true } : s)), cellSat, 0.5)
    expect(selectByBudget(r2, 3)).not.toContain(ids[0])
  })
  it('auc', () => {
    expect(auc([{ hit: true, score: 2 }, { hit: false, score: 1 }])).toBe(1)
    expect(auc([{ hit: true, score: 1 }, { hit: false, score: 2 }])).toBe(0)
    expect(auc([{ hit: true, score: 1 }, { hit: false, score: 1 }])).toBe(0.5)
    expect(auc([{ hit: true, score: 1 }])).toBeNull()
  })
  it('calibrate: 衛星が当たるなら重み大、データ不足はnull、台帳が当たるなら重み小', () => {
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
    const cs2 = { A: 0.5, B: 0.5 }
    const sc2 = []
    for (let i = 0; i < 5; i++) {
      sc2.push({ cell: 'A', year: 1962, hit: true })
      sc2.push({ cell: 'B', year: 2020, hit: false })
    }
    expect(calibrate(sc2, cs2).w as number).toBeLessThanOrEqual(0.5)
  })
  it('exclusionAccuracy', () => {
    const sc = []
    for (let i = 0; i < 10; i++) sc.push({ cell: 'A', year: 1970 + i * 4, hit: i < 5 })
    const e = exclusionAccuracy(sc, { A: 0 }, 0)
    expect(e?.n).toBe(5)
    expect(e?.rate).toBe(1)
    expect(exclusionAccuracy(sc.slice(0, 6), { A: 0 }, 0)).toBeNull()
  })
})

describe('sat-a 実データ（豊中市北東部）の整合性', () => {
  it('実データのファイルに架空の結果（sim_cavity・調査済み）が入っていない', () => {
    expect(data.note).toContain('実データ')
    expect(JSON.stringify(data)).not.toContain('sim_cavity')
    expect(data.segments.every((s) => !('surveyed' in s))).toBe(true)
    expect(new Set(data.segments.map((s) => s.id)).size).toBe(data.segments.length)
    const cells = new Set(data.cells.map((c) => c.id))
    for (const s of data.segments) {
      expect(cells.has(s.cell)).toBe(true)
      expect(s.lenM).toBeGreaterThan(0)
      expect(['life', 'arterial', 'noledger']).toContain(s.cls)
    }
    expect(life.length).toBeGreaterThan(500)
  })
  it('衛星の階級は2種類で、どの区画も衛星の点数は小さい（この地区は衛星で絞れない）', () => {
    expect(new Set(data.cells.map((c) => c.k)).size).toBeLessThanOrEqual(3)
    expect(Math.max(...Object.values(cellSat))).toBeLessThan(0.5)
    expect(data.satellite.class_width_mm_yr).toBe(3.75)
    expect(JSON.stringify(data.satellite)).not.toContain('Sentinel')
    // 衛星のみ(100%)の点数は階級の数しかなく、同点だらけ
    const sc = candidatesOf(rank(data.segments, cellSat, 1))
    expect(new Set(sc.map((s) => s.score)).size).toBeLessThanOrEqual(3)
    expect(topShift(data.segments, cellSat, 1, 20)).toBeGreaterThanOrEqual(0)
  })
  it('説明用デモの架空データは別ファイルで、区間IDだけを指す', () => {
    expect(demo.note).toContain('架空')
    const ids = new Set(data.segments.map((s) => s.id))
    for (const id of [...demo.past, ...demo.hit]) expect(ids.has(id)).toBe(true)
  })
})

describe('sat-a 調査結果 CSV の取り込み（GMS3 の書式は未確認。区間ID と 緯度・経度 の2通り）', () => {
  it('parseCsv: 引用符・BOM・CRLF・タブ区切り', () => {
    expect(parseCsv('﻿a,b\r\n"x,y",2\r\n')).toEqual([['a', 'b'], ['x,y', '2']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('parseCavity: 表記ゆれ', () => {
    for (const v of ['あり', '1', 'true', 'TRUE', '空洞あり', '疑い', ' 有 ', 'yes']) expect(parseCavity(v)).toBe(true)
    for (const v of ['なし', '0', 'false', '空洞なし', '異常なし', '無', 'no']) expect(parseCavity(v)).toBe(false)
    for (const v of ['', '不明', '？', null]) expect(parseCavity(v)).toBeNull()
  })
  it('区間IDの書き方', () => {
    const [a, b, c] = life
    const r = parseOutcomes(`segment_id,cavity\n${a.id},あり\n${b.id},なし\n${c.id},1\nXXXX,あり\n${a.id},?\n`, data.segments)
    expect(r.error).toBeNull()
    expect(r.results.size).toBe(3)
    expect(r.results.get(a.id)).toBe(true)
    expect(r.results.get(b.id)).toBe(false)
    expect(r.summary).toMatchObject({ unknownId: 1, invalid: 1, byId: 3 })
  })
  it('緯度・経度の書き方（近い区間に結び付け、遠い点は使わない）', () => {
    const [a, b] = life
    const [la, lb] = [mid(a), mid(b)]
    const r = parseOutcomes(`緯度,経度,空洞\n${la[1]},${la[0]},あり\n${lb[1]},${lb[0]},なし\n34.9,135.9,あり\n`, data.segments)
    expect(r.error).toBeNull()
    expect(r.summary).toMatchObject({ byPoint: 2, unmatched: 1 })
    expect(r.results.get(a.id)).toBe(true)
    expect(r.results.get(b.id)).toBe(false)
  })
  it('同じ区間の複数行は「1つでもあり」ならあり', () => {
    const a = life[5]
    const r = parseOutcomes(`segment_id,cavity\n${a.id},なし\n${a.id},あり\n`, data.segments)
    expect(r.results.get(a.id)).toBe(true)
    expect(r.summary).toMatchObject({ merged: 1, conflicts: 1 })
  })
  it('見出しの誤り・空はエラー', () => {
    expect(parseOutcomes('foo,bar\n1,2\n', data.segments).error).toBeTruthy()
    expect(parseOutcomes('segment_id,foo\nS0001,1\n', data.segments).error).toBeTruthy()
    expect(parseOutcomes('segment_id,cavity\n', data.segments).error).toBeTruthy()
  })
  it('2つの書き方で、同じ結果なら同じ較正になる', () => {
    const pick = life.filter((_, i) => i % 40 === 0).slice(0, 40)
    const hitOf = (s: Segment) => s.year != null && s.year <= 1975
    const byId = 'segment_id,cavity\n' + pick.map((s) => `${s.id},${hitOf(s) ? 'あり' : 'なし'}`).join('\n')
    const byPt = 'lat,lon,cavity\n' + pick.map((s) => `${(mid(s)[1] + 0.00002).toFixed(6)},${mid(s)[0].toFixed(6)},${hitOf(s) ? 1 : 0}`).join('\n')
    const r1 = parseOutcomes(byId, data.segments)
    const r2 = parseOutcomes(byPt, data.segments)
    expect(r1.results.size).toBe(pick.length)
    expect([...r2.results].sort()).toEqual([...r1.results].sort())
    const c1 = calibrate(scannedFrom(data.segments, r1.results), cellSat)
    const c2 = calibrate(scannedFrom(data.segments, r2.results), cellSat)
    expect(c1).toEqual(c2)
    expect(c1.w).not.toBeNull()
  })
  it('距離と最寄り区間', () => {
    const s = life[0]
    const [lo, la] = mid(s)
    expect(distToSegM(lo, la, s.coords)).toBeLessThan(0.01)
    const d = distToSegM(lo, la + 0.0003, [[lo - 0.01, la], [lo + 0.01, la]])
    expect(d).toBeGreaterThan(30)
    expect(d).toBeLessThan(36)
    expect(nearestSegment(lo, la + 0.5, data.segments)).toBeNull()
  })
  it('同梱の書式見本が読める', () => {
    for (const f of ['format_sample_by_segment.csv', 'format_sample_by_point.csv']) {
      const r = parseOutcomes(fs.readFileSync(path.join(dir, f), 'utf8'), data.segments)
      expect(r.error).toBeNull()
      expect(r.results.size).toBeGreaterThanOrEqual(10)
      expect(r.summary.hit).toBeGreaterThanOrEqual(3)
      expect(r.summary.none).toBeGreaterThanOrEqual(3)
    }
  })
})
