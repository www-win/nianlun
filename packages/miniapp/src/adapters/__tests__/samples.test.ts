import { describe, it, expect } from 'vitest'
import { makeSamples } from '../samples'
import { makeStorage } from '../storage'
import type { Friend } from '@nianlun/core'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}
const mkFriend = (id: string, msgCount: number): Friend => ({ id, msgCount } as unknown as Friend)

describe('samples 读取', () => {
  it('按 friend id 取样本，缺失返回空数组', () => {
    const s = memStorage()
    s.saveSamples({ f1: ['我：在吗', '对方：在'] })
    const sm = makeSamples(s)
    expect(sm.loadSamplesFor('f1')).toEqual(['我：在吗', '对方：在'])
    expect(sm.loadSamplesFor('nope')).toEqual([])
  })

  it('gatherTopSamples 按 msgCount 排序取样、限量截断', () => {
    const s = memStorage()
    s.saveSamples({
      a: ['a1', 'a2', 'a3'],
      b: ['b1', 'b2'],
      c: ['c1'],
    })
    const sm = makeSamples(s)
    const friends = [mkFriend('c', 5), mkFriend('a', 100), mkFriend('b', 50)]
    // 取前 2 位好友(a,b)，各前 2 条
    const out = sm.gatherTopSamples(friends, { maxFriends: 2, perFriend: 2, maxTotal: 10 })
    expect(out).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('gatherTopSamples 到 maxTotal 即停', () => {
    const s = memStorage()
    s.saveSamples({ a: ['a1', 'a2', 'a3', 'a4'] })
    const sm = makeSamples(s)
    const out = sm.gatherTopSamples([mkFriend('a', 10)], { perFriend: 10, maxTotal: 2 })
    expect(out).toEqual(['a1', 'a2'])
  })
})

describe('最近一个月读取（含回退）', () => {
  it('最近月存储整体为空时 loadRecent* 返回 null（触发页面回退到全年）', () => {
    const s = memStorage()
    const sm = makeSamples(s)
    expect(sm.loadRecentInsightsFor('f1')).toBeNull()
    expect(sm.loadRecentSamplesFor('f1')).toBeNull()
  })

  it('存储非空时按 id 返回；该好友近期无往来则返回空默认（区块隐藏）', () => {
    const s = memStorage()
    s.saveRecentInsights({ f1: { keywords: [{ word: '近期', count: 2 }], weekHour: new Array(168).fill(0) } })
    s.saveRecentSamples({ f1: ['我：最近在忙'] })
    const sm = makeSamples(s)
    // 有记录的好友
    expect(sm.loadRecentInsightsFor('f1')!.keywords[0].word).toBe('近期')
    expect(sm.loadRecentSamplesFor('f1')).toEqual(['我：最近在忙'])
    // 存储非空但该 id 无记录（近期无往来）→ 空默认，不再回退全年
    expect(sm.loadRecentInsightsFor('f2')).toEqual({ keywords: [], weekHour: new Array(168).fill(0) })
    expect(sm.loadRecentSamplesFor('f2')).toEqual([])
  })
})
