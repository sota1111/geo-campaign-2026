import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { toCsv } from '@/components/shared/downloadText'
import { parseHashQuery, withHashQuery } from '@/components/shared/hashState'
import { useLocalStorage } from '@/components/shared/useLocalStorage'
import { useHashState } from '@/components/shared/useHashState'
import { GSI_BASEMAPS, buildStyle, type BasemapId } from '@/components/shared/mapStyle'
import { APPS, appsByContest, getApp } from '@/apps/registry'

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
  it('7アプリが登録され id が一意', () => {
    expect(APPS).toHaveLength(7)
    expect(new Set(APPS.map((a) => a.id)).size).toBe(7)
    expect(getApp('sat-a')?.dataKind).toBe('fictional')
    expect(appsByContest('ichibiz-2026')).toHaveLength(3)
  })
})
