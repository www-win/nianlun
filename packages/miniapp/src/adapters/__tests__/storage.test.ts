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
    s.clearAll()
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
  })

  // wx.getStorageSync 对不存在的键返回空字符串 '' 而非 undefined，?? 兜底挡不住，
  // 会导致 ''.map 崩溃。这里模拟该真机行为，确保按类型兜底。
  it('后端对缺失键返回空字符串时安全兜底（模拟 wx.getStorageSync）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadSamples()).toEqual({})
  })
})
