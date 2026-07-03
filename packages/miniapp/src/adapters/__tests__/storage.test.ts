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

  describe('原始聊天文本存储', () => {
    it('saveRawFiles/loadRawFiles 小数据往返一致', () => {
      const s = makeStorage(memBackend())
      const files = [{ name: 'a.txt', content: '你好' }, { name: 'b.txt', content: '世界' }]
      s.saveRawFiles(files)
      expect(s.loadRawFiles()).toEqual(files)
    })

    it('无数据时 loadRawFiles 返回 []', () => {
      const s = makeStorage(memBackend())
      expect(s.loadRawFiles()).toEqual([])
    })

    it('超过单块阈值的大数据正确分块并完整读回', () => {
      const m = new Map<string, unknown>()
      const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
      const big = '甲'.repeat(500_000) // > 20万字符阈值，强制多块
      s.saveRawFiles([{ name: 'big.txt', content: big }])
      // 确实产生了多个数据块
      const idx = m.get('nianlun:rawIndex') as { count: number }
      expect(idx.count).toBeGreaterThan(1)
      const back = s.loadRawFiles()
      expect(back).toHaveLength(1)
      expect(back[0].content).toBe(big)
    })

    it('appendRawFiles 累加多次导入，内容相同则去重', () => {
      const s = makeStorage(memBackend())
      s.appendRawFiles([{ name: 'a.txt', content: 'AAA' }])
      s.appendRawFiles([{ name: 'a.txt', content: 'AAA' }]) // 重复内容，应去重
      s.appendRawFiles([{ name: 'b.txt', content: 'BBB' }])
      expect(s.loadRawFiles()).toEqual([
        { name: 'a.txt', content: 'AAA' },
        { name: 'b.txt', content: 'BBB' },
      ])
    })

    it('缺块时 loadRawFiles 容错返回 []', () => {
      const m = new Map<string, unknown>()
      const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
      s.saveRawFiles([{ name: 'a.txt', content: 'x'.repeat(500_000) }])
      m.delete('nianlun:raw:1') // 删掉一块模拟损坏
      expect(s.loadRawFiles()).toEqual([])
    })

    it('缩小后不残留旧块：saveRawFiles 覆盖式写入', () => {
      const m = new Map<string, unknown>()
      const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
      s.saveRawFiles([{ name: 'big.txt', content: '乙'.repeat(500_000) }]) // 多块
      s.saveRawFiles([{ name: 'small.txt', content: 'hi' }]) // 单块
      expect(m.has('nianlun:raw:1')).toBe(false) // 旧的第2块已清除
      expect(s.loadRawFiles()).toEqual([{ name: 'small.txt', content: 'hi' }])
    })

    it('clearAll 清除原文', () => {
      const s = makeStorage(memBackend())
      s.saveRawFiles([{ name: 'a.txt', content: 'AAA' }])
      s.clearAll()
      expect(s.loadRawFiles()).toEqual([])
    })
  })
})
