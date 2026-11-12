// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import * as L from './lib'
import { coverageScope, expiredNote, ODPT_NOTICE, soonNote } from './lib'

const root = path.resolve(import.meta.dirname, '../../..')
const req = createRequire(import.meta.url)
// 元アプリの lib.js（正解の実装）。移植した TypeScript と同じ結果になることを確かめる
const Orig = req(path.resolve(root, '../odpt-2026/app/web/lib.js'))
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(root, 'public/data/odpt', f), 'utf8'))
const toyama = load('toyama.json') as L.RegionData
const whatif = load('whatif_toyama.json') as { routes: Record<string, [number, string][]> }

describe('基本の関数', () => {
  it('fmtMin: 24時を超えたら翌を付ける', () => {
    expect(L.fmtMin(0)).toBe('0:00')
    expect(L.fmtMin(1118)).toBe('18:38')
    expect(L.fmtMin(1450)).toBe('翌0:10')
    expect(L.fmtMin(-1)).toBe('—')
    expect(L.fmtMin(null)).toBe('—')
  })
  it('needLevel: 許容時間が短いほど高い水準が必要', () => {
    expect(L.needLevel([20, 30, 45, 60], 20)).toBe(4)
    expect(L.needLevel([20, 30, 45, 60], 60)).toBe(1)
    expect(() => L.needLevel([20, 30], 99)).toThrow()
  })
  it('pct: 小数1桁、分母0は0', () => {
    expect(L.pct(1, 3)).toBe(33.3)
    expect(L.pct(1, 0)).toBe(0)
  })
  it('meshCodeAt と meshBounds は往復で一致する', () => {
    const c = toyama.cells[100][0]
    const b = L.meshBounds(c)
    expect(L.meshCodeAt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)).toBe(c)
  })
  it('regionForPoint: 富山駅付近は富山市周辺、海の上は null', () => {
    const regions = load('index.json').regions
    expect(L.regionForPoint(regions, 137.213, 36.701)).toBe('toyama')
    expect(L.regionForPoint(regions, 150, 30)).toBeNull()
  })
})

describe('共有リンクの読み書き', () => {
  it('書いたものを読み戻せる', () => {
    const q = L.writeQuery({ region: 'toyama', fi: 0, day: 'wd', per: 'm', w: 30, route: '12', pt: [137.2251, 36.6642] })
    expect(L.parseQuery(q)).toEqual({ region: 'toyama', fi: 0, day: 'wd', per: 'm', w: 30, route: '12', pt: [137.2251, 36.6642] })
  })
  it('不正な値は捨てる', () => {
    expect(L.parseQuery('region=../x&d=sat&p=z&w=abc&pt=1,2&r=x')).toEqual({})
  })
})

describe('地名検索の応答と停留所名検索', () => {
  it('parseGsi は座標のないものを捨てる', () => {
    const r = L.parseGsi([{ geometry: { coordinates: [137.2, 36.7] }, properties: { title: '富山県富山市大町' } }, { geometry: {} }, null])
    expect(r).toEqual([{ lon: 137.2, lat: 36.7, title: '富山県富山市大町' }])
    expect(L.parseGsi({})).toEqual([])
  })
  it('searchStops は同名を1件にまとめる', () => {
    const r = L.searchStops(toyama.nodes, '大町')
    expect(r.length).toBeGreaterThan(0)
    expect(new Set(r.map((x) => x.name)).size).toBe(r.length)
  })
})

describe('元アプリ lib.js と同じ結果（富山市周辺の実データ）', () => {
  const need = L.needLevel(toyama.params.thresholds, 30)
  it('summarize が全条件で一致', () => {
    for (const fi of [0, 1]) for (const day of L.DAYS) for (const per of L.PERIODS) {
      expect(L.summarize(toyama.cells, fi, day, per, need)).toEqual(Orig.summarize(toyama.cells, fi, day, per, need))
    }
  })
  it('lostPopulation が全路線で一致', () => {
    for (const r of Object.keys(whatif.routes)) {
      expect(L.lostPopulation(toyama.cells, whatif.routes[r], 0, 'wd', 'm', need)).toEqual(Orig.lostPopulation(toyama.cells, whatif.routes[r], 0, 'wd', 'm', need))
    }
  })
  it('大町付近: verdict・近くの停留所・最終便が一致し、最終便は近傍の最大値', () => {
    const [lon, lat] = [137.2245, 36.6665]
    const code = L.meshCodeAt(lon, lat)
    const cell = toyama.cells[L.indexCells(toyama.cells)[code]] ?? null
    expect(cell).not.toBeNull()
    const o = { fi: 0, day: 'wd', per: 'm', w: 30, thresholds: toyama.params.thresholds, startHours: toyama.params.start_hours, facLabel: '病院' } as const
    const v = L.verdict(cell, o)!
    const ov = Orig.verdict(cell, o)
    expect(v.main).toBe(ov.main)
    expect(v.cmp).toBe(ov.cmp)
    expect(v.ok).toBe(ov.ok)
    const near = L.nearbyNodes(toyama.nodes, lon, lat, toyama.params.walk_in_m, 6)
    expect(near).toEqual(Orig.nearbyNodes(toyama.nodes, lon, lat, toyama.params.walk_in_m, 6))
    expect(near.length).toBeGreaterThan(0)
    const last = L.lastService(toyama.nodes, near, 'wd')!
    const max = Math.max(...near.map((n) => toyama.nodes[n.i][3][5]))
    expect(last.t).toBe(max)
    expect(toyama.nodes[near.find((n) => toyama.nodes[n.i][2] === last.name)!.i][3][5]).toBe(max)
  })
  it('verdict: 平日と休日で結果が違う地点がある', () => {
    const o = { fi: 0, per: 'm', w: 30, thresholds: toyama.params.thresholds, startHours: toyama.params.start_hours, facLabel: '病院' } as const
    const diff = toyama.cells.find((c) => {
      const a = L.verdict(c, { ...o, day: 'wd' })!
      return a.status !== a.otherStatus
    })
    expect(diff).toBeDefined()
    const a = L.verdict(diff!, { ...o, day: 'wd' })!
    const b = L.verdict(diff!, { ...o, day: 'hol' })!
    expect(a.otherStatus).toBe(b.status)
    expect(a.cmp).toContain('休日（日曜ダイヤ）')
  })
  it('verdict: セルが無ければ null', () => {
    expect(L.verdict(null, { fi: 0, day: 'wd', per: 'm', w: 30, thresholds: [20, 30], startHours: { m: 8, d: 12, e: 17 }, facLabel: '病院' })).toBeNull()
  })
  it('compareRow が一致', () => {
    expect(L.compareRow(toyama, 'hospital', 'wd', 'm', 30)).toEqual(Orig.compareRow(toyama, 'hospital', 'wd', 'm', 30))
    expect(L.compareRow(toyama, 'hospital', 'wd', 'm', 99)).toBeNull()
  })
})

describe('検索の並べ替えと代替条件', () => {
  it('matchRank: 完全一致 < 前方一致 < その他', () => {
    expect(L.matchRank('富山駅', '富山駅')).toBe(0)
    expect(L.matchRank('富山駅前郵便局', '富山駅')).toBe(1)
    expect(L.matchRank('南富山駅', '富山駅')).toBe(2)
    const titles = ['南富山駅', '富山駅前郵便局', '電鉄富山駅', '富山駅']
    expect([...titles].sort((a, b) => L.matchRank(a, '富山駅') - L.matchRank(b, '富山駅'))[0]).toBe('富山駅')
  })
  it('altConditions: 許容時間を延ばして初めて行ける区分を返す', () => {
    const th = [20, 30, 45, 60]
    // 公共交通の水準が 1（60分以内）だけ満たす区画 → 20/30/45分では行けず、60分なら行ける
    const cell: L.Cell = ['00000000', 10, 3, '1'.repeat(12), '000', 0]
    const a = L.altConditions(cell, { fi: 0, day: 'wd', per: 'm', w: 30, thresholds: th })
    expect(a.periods.map((p) => p.per)).toEqual(['d', 'e'])
    expect(a.longerW).toEqual({ w: 60, status: 'transit' })
    expect(L.altConditions(cell, { fi: 0, day: 'wd', per: 'm', w: 60, thresholds: th }).longerW).toBeNull()
  })
})

describe('共有リンクの読み取り・使ったデータの一行', () => {
  it('「,」が %2C に変わったリンクでも地点を読める', () => {
    const q = 'region=toyama&f=0&d=hol&p=m&w=30&pt=137.21307%2C36.70125'
    expect(L.parseQuery(q).pt).toEqual([137.21307, 36.70125])
    expect(L.parseQuery(q).day).toBe('hol')
    expect(L.parseQuery('pt=%E0%A4%A')).toEqual({})
    expect(L.parseQuery('n=%E5%AF%8C%E5%B1%B1%E9%A7%85&pt=137.2,36.7').label).toBe('富山駅')
  })
  it('近くの路線の事業者名と、フィードの公開元・ライセンスだけを使う', () => {
    const i = toyama.nodes.findIndex((n) => n[5].length > 0)
    const line = L.dataUsedLine(toyama, [i])
    const op = toyama.routes[toyama.nodes[i][5][0]][2]
    expect(line).toContain('使ったデータ: ')
    expect(line).toContain(op)
    expect(line).toContain('GTFSデータリポジトリ')
    expect(line).not.toContain('ODPT')
    // 近くに路線がなければ、収録フィードの事業者
    expect(L.dataUsedLine(toyama, [])).toContain(toyama.feeds[0].org)
  })
  it('ODPTセンターのフィードは公共交通オープンデータセンター（ODPT）と書く', () => {
    const tokyo = load('tokyo.json') as L.RegionData
    expect(L.dataUsedLine(tokyo, [])).toContain('公共交通オープンデータセンター（ODPT）')
  })
})

describe('診断の範囲・データの期限の文言（収録データから作る）', () => {
  it('範囲: 東京のように鉄道系を収録した地域で「バスだけ」と言わない', () => {
    expect(coverageScope(['バス', '地下鉄', '路面電車', '鉄道'])).toBe('収録した事業者のバス・地下鉄・路面電車・鉄道（JR・大手私鉄など未収録の鉄道は対象外）')
    expect(coverageScope(['バス'])).toBe('収録した事業者のバス（鉄道は対象外）')
  })
  const feeds = [
    { org: '小田急バス', valid: ['2026-10-01', '2026-11-30'] as [string, string] },
    { org: '京王バス', valid: ['2026-10-01', '2026-12-31'] as [string, string] },
    { org: '東京都交通局', valid: ['2026-10-01', '2027-06-30'] as [string, string] },
  ]
  it('期限切れ: 切れた事業者名と日付を出す。切れていなければ空', () => {
    expect(expiredNote(feeds, '2026-11-12')).toBe('')
    expect(expiredNote(feeds, '2026-12-01')).toBe('この地域の時刻表のうち1件（小田急バス）は2026-11-30で有効期間が切れています。その事業者の路線は古いダイヤで計算しています。')
    expect(expiredNote(feeds, '2027-01-15')).toMatch(/^この地域の時刻表のうち2件（小田急バス・京王バス）は2026-11-30から順に/)
  })
  it('期限前: 利用者向けに「◯日以降、一部の事業者は古いダイヤ」と言う', () => {
    expect(soonNote(feeds, '2026-11-12', '2027-03-12')).toBe('2026-11-30以降、一部の事業者（小田急バスほか1件）は古いダイヤでの計算になります（公開期間中に最新の時刻表で作り直す予定です）。')
    expect(soonNote(feeds, '2027-01-01', '2027-03-12')).toBe('')
  })
  it('ODPTの通知: 出典・無保証・事業者へ問い合わせない、の3点を含む', () => {
    expect(ODPT_NOTICE).toMatch(/公共交通オープンデータセンターにおいて提供/)
    expect(ODPT_NOTICE).toMatch(/正確・完全なものとは限りません/)
    expect(ODPT_NOTICE).toMatch(/公共交通事業者への直接の問合せは行わないでください/)
  })
})
