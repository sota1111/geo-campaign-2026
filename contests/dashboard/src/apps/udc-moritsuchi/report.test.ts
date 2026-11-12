import { describe, expect, it } from 'vitest'
import { ledgerSummary, makeRecord, nearLine, reportText } from './lib'

const rec = (o = {}) => makeRecord({ id: 'a', lng: 139.0777, lat: 35.1039, kind: 'crack', observedAt: '2026-11-11 10:00', ...o })
const nf = (distM: number, inside = false) => ({ id: '熱海市0012', kind: '腹付け型', city: '熱海市', inside, distM })

describe('通報文の「500m以内」の一文', () => {
  it('範囲内・500m以内は「あります」', () => {
    expect(nearLine(rec({ nearFill: nf(0, true) }))).toContain('500m以内に登録された大規模盛土造成地: あります')
    expect(nearLine(rec({ nearFill: nf(300) }))).toContain('あります')
    expect(nearLine(rec({ nearFill: nf(500) }))).toContain('あります')
  })
  it('500mより遠い・データなしは「ありません」で最寄りを添える', () => {
    const t = nearLine(rec({ nearFill: nf(1100) }))
    expect(t).toContain('ありません（最寄りは「熱海市0012」（腹付け型）から約1100m')
    expect(nearLine(rec())).toContain('ありません')
  })
  it('対象範囲外は判定できていないと書く', () => {
    expect(nearLine(rec({ lng: 139.7, lat: 35.68, nearFill: nf(10) }))).toContain('判定できていません')
  })
  it('通報文に含まれ、範囲外の注記の位置も崩れない', () => {
    const t = reportText(rec({ nearFill: nf(1100) }))
    expect(t).toContain('500m以内に登録された大規模盛土造成地')
    const o = reportText(rec({ lng: 139.7, lat: 35.68 })).split('\n')
    const i = o.findIndex((l) => l.includes('対象範囲（熱海市・伊東市）の外'))
    expect(o[i + 1]).toContain('撮影は公道')
  })
})

describe('地域の点検台帳の集計', () => {
  it('種類・近くの造成地・範囲外・遠いものを数える（0件の種類は出さない）', () => {
    const s = ledgerSummary([
      rec({ kind: 'crack', nearFill: nf(0, true) }),
      rec({ id: 'b', kind: 'crack', nearFill: nf(300) }),
      rec({ id: 'c', kind: 'water', nearFill: nf(1100) }),
      rec({ id: 'd', kind: 'water', lng: 139.7, lat: 35.68, nearFill: nf(10) }),
    ])
    expect(s.total).toBe(4)
    expect(s.byKind.map((k) => `${k.id}:${k.n}`)).toEqual(['crack:2', 'water:2'])
    expect(s.byFill).toEqual([{ id: '熱海市0012', kind: '腹付け型', n: 2 }])
    expect(s.far).toBe(1)
    expect(s.outside).toBe(1)
  })
  it('記録がなければ全部0', () => {
    expect(ledgerSummary([])).toEqual({ total: 0, byKind: [], byFill: [], outside: 0, far: 0 })
  })
})
