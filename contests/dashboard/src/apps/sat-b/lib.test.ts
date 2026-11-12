import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS, DEFAULT_WEIGHTS_REAL, buildReal, buildSample, clone, csvCell, filterSites, hitStats, planRoute,
  rank, scoreReal, scoreSite, tileOf, toCSV, type RealRaw, type SampleRaw,
} from './lib'

const load = <T,>(f: string) => JSON.parse(readFileSync(`${process.cwd()}/public/data/sat-b/${f}`, 'utf8')) as T
const real = buildReal(load<RealRaw>('real.json'))
const sample = buildSample(load<SampleRaw>('sample.json'))

describe('実データ', () => {
  it('横須賀市716か所・ID一意・必須項目あり', () => {
    expect(real.sites.length).toBe(716)
    expect(new Set(real.sites.map((s) => s.id)).size).toBe(716)
    real.sites.forEach((s) => {
      expect(s.id.startsWith('横須賀市')).toBe(true)
      expect(['谷埋め型', '腹付け型', '区分なし']).toContain(s.type)
    })
  })
  it('衛星由来の変化量は null で、点数の合計に含まれない', () => {
    const s = real.sites.find((x) => x.reliefM != null)!
    const r = scoreReal(s)
    expect(r.parts[0][1]).toBeNull()
    expect(r.parts[0][0]).toContain('未接続')
    expect(r.score).toBe(r.parts.reduce((a, p) => a + (p[1] ?? 0), 0))
    expect(scoreReal({ id: 'x', x: 0, y: 0, type: '区分なし', zone: '区域外', areaM2: 100 }).score).toBe(0)
  })
  it('順位は点数降順・連番・同点は面積→IDで安定', () => {
    const r = rank(real.sites, DEFAULT_WEIGHTS_REAL, real.refDate, [], 'real')
    r.forEach((s, i) => {
      expect(s.rank).toBe(i + 1)
      if (i) expect(r[i - 1].score).toBeGreaterThanOrEqual(s.score)
    })
    expect(rank(real.sites, DEFAULT_WEIGHTS_REAL, real.refDate, [], 'real').map((s) => s.id)).toEqual(r.map((s) => s.id))
  })
})

describe('巡視計画', () => {
  it('上位N件を一度ずつ訪れ、N=0 は空', () => {
    const r = rank(real.sites, DEFAULT_WEIGHTS_REAL, real.refDate, [], 'real')
    const p = planRoute(r, real.origin, 5)
    expect(p.route.map((s) => s.id).sort()).toEqual(r.slice(0, 5).map((s) => s.id).sort())
    expect(p.total).toBeGreaterThan(0)
    expect(planRoute(r, real.origin, 0).route).toHaveLength(0)
  })
  it('周回距離の目安は km 単位として妥当（市内）', () => {
    const r = rank(real.sites, DEFAULT_WEIGHTS_REAL, real.refDate, [], 'real')
    const km = planRoute(r, real.origin, 5).total / 1000
    expect(km).toBeGreaterThan(0)
    expect(km).toBeLessThan(100)
  })
})

describe('記録・重み・集計', () => {
  it('巡視結果が台帳（最新の巡視）に戻り、未巡視のみ絞り込みから外れる', () => {
    const res = [
      { siteId: 'A-01', date: '2026-11-11', who: 'x', result: '要継続観察', memo: '' },
      { siteId: 'A-01', date: '2026-11-12', who: 'x', result: '是正対象', memo: '' },
    ]
    const r = rank(sample.sites, DEFAULT_WEIGHTS, sample.refDate, res, 'sample')
    expect(r.find((s) => s.id === 'A-01')!.latest!.result).toBe('是正対象')
    const un = filterSites(r, 'sample', { zone: '', second: '', unvisited: true })
    expect(un.some((s) => s.id === 'A-01')).toBe(false)
    expect(un.length).toBe(sample.sites.length - 1)
  })
  it('重みの変更が点数に反映される', () => {
    const w = clone(DEFAULT_WEIGHTS)
    w.change['変位'] = 50
    const a = rank(sample.sites, DEFAULT_WEIGHTS, sample.refDate, [], 'sample').find((s) => s.id === 'A-03')!.score
    const b = rank(sample.sites, w, sample.refDate, [], 'sample').find((s) => s.id === 'A-03')!.score
    expect(b - a).toBe(30)
  })
  it('実データの型の重みを変えると点数が変わる', () => {
    const w = clone(DEFAULT_WEIGHTS_REAL)
    w.type['腹付け型'] = 50
    const a = rank(real.sites, DEFAULT_WEIGHTS_REAL, real.refDate, [], 'real').find((s) => s.type === '腹付け型')!
    const b = rank(real.sites, w, real.refDate, [], 'real').find((s) => s.id === a.id)!
    expect(b.score - a.score).toBe(35)
  })
  it('サンプルのスコアは負にならない', () => {
    const low = { id: 'z', x: 0, y: 0, change: '植生消失', terrain: '平地', permit: '許可・届出あり', zone: '区域外', detected: sample.refDate, seasonal: true, areaM2: 1 }
    expect(scoreSite(low, DEFAULT_WEIGHTS, sample.refDate).score).toBe(0)
  })
  it('区分ごとの集計', () => {
    const st = hitStats(sample.sites, [
      { siteId: 'A-01', date: '', who: '', memo: '', result: '是正対象' },
      { siteId: 'B-03', date: '', who: '', memo: '', result: '問題なし' },
      { siteId: 'XX', date: '', who: '', memo: '', result: '是正対象' },
    ], 'change')
    expect(st['新設']).toEqual({ n: 2, hit: 1 })
  })
})

describe('CSV・タイル', () => {
  it('BOM・引用符・数式の無効化', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('x"y')).toBe('"x""y"')
    expect(toCSV(['a'], [['b']]).startsWith('﻿')).toBe(true)
  })
  it('地理院タイル座標（横須賀は z17 で妥当な範囲）', () => {
    const t = tileOf(139.6722, 35.2814, 17)
    expect(t.x).toBeGreaterThan(116000)
    expect(t.x).toBeLessThan(117500)
    expect(t.px).toBeGreaterThanOrEqual(0)
    expect(t.px).toBeLessThan(256)
  })
  it('架空サンプルは架空と明記', () => {
    expect(sample.raw!.notice).toContain('架空')
    expect(sample.sites.length).toBe(12)
  })
})
