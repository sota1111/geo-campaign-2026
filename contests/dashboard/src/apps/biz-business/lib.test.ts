// @vitest-environment node
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as L from './lib'
import type { Cell, RegionData, WhatIf } from './lib'

const require = createRequire(import.meta.url)
// 元アプリ（変更しない・読むだけ）
const Orig = require(path.resolve(import.meta.dirname, '../../../../ichibiz-2026/app/business/web/lib.js'))
const dataDir = path.resolve(import.meta.dirname, '../../../public/data/biz-business')
const readJson = <T,>(f: string) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')) as T

describe('合成データ', () => {
  // levels は 2施設×(平日/休日)×(朝/昼/夕)=12桁。need=2 以上で「行ける」
  const lv = (v: string) => v.padEnd(12, '0')
  const cells: Cell[] = [
    ['503472583', 100, 40, lv('222222'), '00', 0], // 0: 病院へ行ける
    ['503472584', 50, 20, lv('222222'), '00', 0], // 1: 病院へ行ける
    ['503472593', 30, 10, lv('222222'), '20', 0], // 2: 歩いて行ける（影響なし）
    ['503472594', 7, 3, lv('000000'), '00', 0], // 3: 元から行けない
  ]
  const none = lv('000000')
  const W: WhatIf = {
    routes: {
      '0': [[0, none], [1, none], [2, none], [3, none]],
      '1': [[1, none], [2, none]],
      '2': [[0, none]],
    },
  }
  it('単独停止は徒歩圏・元から行けない地区を数えない', () => {
    const l = L.planLoss(cells, W, [0], 0, 'wd', 'm', 2)
    expect(l.cells).toEqual([0, 1])
    expect(l.lost).toBe(150)
    expect(l.lost65).toBe(60)
    expect(l.exact).toBe(true)
  })
  it('複数路線は重複を1回だけ数える下限（単純な足し合わせではない）', () => {
    const l = L.planLoss(cells, W, [0, 1], 0, 'wd', 'm', 2)
    expect(l.lost).toBe(150) // 150+50 ではない
    expect(l.exact).toBe(false)
  })
  it('空の案は0人', () => {
    expect(L.planLoss(cells, W, [], 0, 'wd', 'm', 2).lost).toBe(0)
  })
  it('影響が小さい案: 人数、同数なら65歳以上、完全同数は複数', () => {
    expect(L.pickSmaller([{ lost: 10, lost65: 5 }, { lost: 8, lost65: 7 }])).toEqual([1])
    expect(L.pickSmaller([{ lost: 8, lost65: 7 }, { lost: 8, lost65: 2 }])).toEqual([1])
    expect(L.pickSmaller([{ lost: 8, lost65: 2 }, { lost: 8, lost65: 2 }])).toEqual([0, 1])
  })
  it('CSVは数式として解釈される先頭文字を無効化する', () => {
    expect(L.csvCell('=1+1')).toBe("'=1+1")
    expect(L.csvCell(-5)).toBe('-5')
    expect(L.csvCell('a,b')).toBe('"a,b"')
  })
})

describe('元アプリ lib.js との一致（実データ）', () => {
  for (const id of ['tokushima', 'toyama']) {
    it(`${id}: 全路線×条件で人数・メッシュ・基準値・地区集計が一致`, () => {
      const d = readJson<RegionData>(`${id}.json`)
      const W = readJson<WhatIf>(`whatif_${id}.json`)
      const conds: [L.Day, L.Period, number][] = [['wd', 'm', 20], ['hol', 'e', 30], ['wd', 'd', 60]]
      const ids = d.routes.map((_, i) => i).filter((i) => d.routes[i][3] + d.routes[i][4] > 0)
      for (const [day, per, w] of conds) {
        const need = L.needLevel(d.params.thresholds, w)
        expect(need).toBe(Orig.needLevel(d.params.thresholds, w))
        for (let fi = 0; fi < d.facility_order.length; fi++) {
          expect(L.baseline(d.cells, fi, day, per, need)).toEqual(Orig.baseline(d.cells, fi, day, per, need))
          for (const r of ids) {
            expect(L.planLoss(d.cells, W, [r], fi, day, per, need)).toEqual(Orig.planLoss(d.cells, W, [r], fi, day, per, need))
          }
          const trio = ids.slice(0, 3)
          const a = L.planLoss(d.cells, W, trio, fi, day, per, need)
          expect(a).toEqual(Orig.planLoss(d.cells, W, trio, fi, day, per, need))
          expect(L.groupByNearestStop(d.cells, a.cells, d.nodes)).toEqual(Orig.groupByNearestStop(d.cells, a.cells, d.nodes))
        }
      }
    })
  }
  it('メッシュ範囲・CSVが一致', () => {
    expect(L.meshBounds('503472583')).toEqual(Orig.meshBounds('503472583'))
    expect(L.toCsvText([['a', '=x', 3]])).toBe('﻿' + Orig.toCsv([['a', '=x', 3]]))
  })
})
