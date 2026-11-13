import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toCsv } from '@/components/shared/downloadText'
import { parseHashQuery, withHashQuery } from '@/components/shared/hashState'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { useHashState } from '@/components/shared/useHashState'
import { GSI_BASEMAPS, buildStyle, type BasemapId } from '@/components/shared/mapStyle'
import { APPS, CARDS_ONLY, CURRENT_APPS, appsByContest, getApp, isNewPlan, newPlansOf } from '@/apps/registry'

describe('toCsv', () => {
  it('BOM付きで、カンマ・引用符・改行をエスケープする', () => {
    const s = toCsv([['a', 'b,c'], ['"q"', 'x\ny'], [1, null]])
    expect(s.startsWith('﻿')).toBe(true)
    expect(s.slice(1)).toBe('a,"b,c"\r\n"""q""","x\ny"\r\n1,')
  })
})

describe('hashState', () => {
  it('クエリを読み書きする', () => {
    expect(parseHashQuery('#/apps/odpt?a=1&b=x').get('b')).toBe('x')
    expect(parseHashQuery('#/apps/odpt').get('a')).toBeNull()
    const p = new URLSearchParams({ a: '1' })
    expect(withHashQuery('#/apps/odpt?z=9', p)).toBe('#/apps/odpt?a=1')
    expect(withHashQuery('#/apps/odpt?z=9', new URLSearchParams())).toBe('#/apps/odpt')
  })
})

describe('useLocalStorage', () => {
  beforeEach(() => window.localStorage.clear())
  it('保存と復元ができる', () => {
    const { result, unmount } = renderHook(() => useLocalStorage('t:k', 1))
    act(() => result.current[1](5))
    expect(window.localStorage.getItem('t:k')).toBe('5')
    unmount()
    const again = renderHook(() => useLocalStorage('t:k', 1))
    expect(again.result.current[0]).toBe(5)
  })
})

describe('useHashState', () => {
  it('URLハッシュに保存し、既定値ならキーを消す', () => {
    window.location.hash = '#/apps/odpt'
    const { result } = renderHook(() => useHashState('q', 'def'))
    expect(result.current[0]).toBe('def')
    act(() => result.current[1]('hello'))
    expect(window.location.hash).toBe('#/apps/odpt?q=hello')
    act(() => result.current[1]('def'))
    expect(window.location.hash).toBe('#/apps/odpt')
  })
})

describe('mapStyle / registry', () => {
  it('3種の地理院タイルを返す', () => {
    for (const k of Object.keys(GSI_BASEMAPS) as BasemapId[]) {
      expect(buildStyle(k).sources.gsi).toBeTruthy()
    }
    expect(GSI_BASEMAPS.photo.url).toContain('seamlessphoto')
  })
  it('今の案7件と新しい案4件が登録され id が一意', () => {
    expect(CURRENT_APPS).toHaveLength(7)
    expect(APPS.filter(isNewPlan)).toHaveLength(4)
    expect(new Set(APPS.map((a) => a.id)).size).toBe(APPS.length)
    expect(getApp('sat-a')?.dataKind).toBe('fictional')
    expect(appsByContest('ichibiz-2026').filter((a) => !isNewPlan(a))).toHaveLength(3)
  })
  it('新しい案は今の案の隣に並ぶ（pairWith が実在する今の案を指し、同じコンペ）', () => {
    for (const a of APPS.filter(isNewPlan)) {
      const pair = getApp(a.pairWith ?? '')
      expect(pair && !isNewPlan(pair)).toBe(true)
      expect(pair?.contest).toBe(a.contest)
      expect(a.embed).toBeTruthy()
    }
    for (const c of CARDS_ONLY) {
      const pair = getApp(c.pairWith)
      expect(pair?.contest).toBe(c.contest)
      expect(c.docs.length).toBeGreaterThan(0)
    }
  })
  it('今の案から新しい案を引ける（見比べるリンク用）。ODPT 定時性カルテの状態の文に数値を書かない', () => {
    expect(newPlansOf('sat-b').map((a) => a.id)).toEqual(['sat-alpha'])
    expect(newPlansOf('sat-a')).toEqual([])
    expect(getApp('odpt-teiji')?.stateNote).toMatch(/まだ遅れの集計はありません/)
    expect(getApp('odpt-teiji')?.stateNote).not.toMatch(/\d+\s*(便|件|%|％)/)
  })
})
