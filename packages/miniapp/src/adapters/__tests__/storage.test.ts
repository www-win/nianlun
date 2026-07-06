import { describe, it, expect } from 'vitest'
import { makeStorage } from '../storage'
import type { Friend, ReportData } from '@nianlun/core'

function memBackend() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
}

const FRIEND = { id: 'f1', name: '张三' } as unknown as Friend
const REPORT = { year: 2025 } as unknown as ReportData

describe('storage 适配器', () => {
  it('saveFriends/loadFriends 往返', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])
    expect(s.loadFriends()[0].id).toBe('f1')
  })

  it('loadFriends 给缺失字段补默认值', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])                 // 没有 hourly/weekHour/keywords
    const f = s.loadFriends()[0]
    expect(f.hourly).toHaveLength(24)
    expect(f.weekHour).toHaveLength(168)
    expect(f.keywords).toEqual([])
  })

  it('loadReport 无数据时返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadReport()).toBeNull()
  })

  it('clearAll 清空全部键', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    s.saveRecentInsights({ f1: { keywords: [], weekHour: [] } })
    s.saveRecentSamples({ f1: ['我：在'] })
    s.clearAll()
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadRecentInsights()).toEqual({})
    expect(s.loadRecentSamples()).toEqual({})
  })

  it('saveRecentInsights/loadRecentInsights 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRecentInsights()).toEqual({})
    s.saveRecentInsights({ f1: { keywords: [{ word: '你好', count: 3 }], weekHour: [1, 2] } })
    expect(s.loadRecentInsights().f1.keywords[0].word).toBe('你好')
  })

  it('saveRecentSamples/loadRecentSamples 往返，缺失返回空对象', () => {
    const s = makeStorage(memBackend())
    expect(s.loadRecentSamples()).toEqual({})
    s.saveRecentSamples({ f1: ['我：在吗'] })
    expect(s.loadRecentSamples().f1).toEqual(['我：在吗'])
  })

  // wx.getStorageSync 对不存在的键返回空字符串 '' 而非 undefined，?? 兜底挡不住，
  // 会导致 ''.map 崩溃。这里模拟该真机行为，确保按类型兜底。
  it('后端对缺失键返回空字符串时安全兜底（模拟 wx.getStorageSync）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadSamples()).toEqual({})
    expect(s.loadRecentInsights()).toEqual({})
    expect(s.loadRecentSamples()).toEqual({})
  })

  it('analyzedIds 存取；缺键返回 []，clearAll 清除', () => {
    const m = new Map<string, unknown>()
    const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
    expect(s.loadAnalyzedIds()).toEqual([])
    s.saveAnalyzedIds(['a', 'b'])
    expect(s.loadAnalyzedIds()).toEqual(['a', 'b'])
    s.clearAll()
    expect(s.loadAnalyzedIds()).toEqual([])
  })

  it('purgeLegacyRaw 用 keys 精确清 raw 残留键、保留其它数据', () => {
    const m = new Map<string, unknown>([
      ['nianlun:rawIndex', { count: 2 }],
      ['nianlun:raw:0', 'x'], ['nianlun:raw:1', 'y'],
      ['nianlun:friends', [FRIEND]],
    ])
    const s = makeStorage({
      get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k),
      keys: () => [...m.keys()],
    })
    s.purgeLegacyRaw()
    expect(m.has('nianlun:rawIndex')).toBe(false)
    expect(m.has('nianlun:raw:0')).toBe(false)
    expect(m.has('nianlun:raw:1')).toBe(false)
    expect(m.has('nianlun:friends')).toBe(true) // 聚合数据保留
  })

  it('purgeLegacyRaw 在 backend 无 keys 时按 rawIndex.count 兜底删块', () => {
    const m = new Map<string, unknown>([
      ['nianlun:rawIndex', { count: 3 }],
      ['nianlun:raw:0', 'a'], ['nianlun:raw:1', 'b'], ['nianlun:raw:2', 'c'],
      ['nianlun:friends', [FRIEND]],
    ])
    const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
    s.purgeLegacyRaw()
    expect(m.has('nianlun:raw:0')).toBe(false)
    expect(m.has('nianlun:raw:2')).toBe(false)
    expect(m.has('nianlun:rawIndex')).toBe(false)
    expect(m.has('nianlun:friends')).toBe(true)
  })
})
