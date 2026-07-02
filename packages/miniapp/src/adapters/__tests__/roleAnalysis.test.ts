import { describe, it, expect, vi } from 'vitest'
import { analyzeRolesForNew } from '../roleAnalysis'
import type { Friend } from '@nianlun/core'

const F = (id: string): Friend => ({
  id, name: id, alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
  msgCount: 1, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})

describe('analyzeRolesForNew', () => {
  it('只分析不在 analyzedIds 里的好友，成功者写入且计入集合', async () => {
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: 'PM' })
    const applied: Array<[string, unknown]> = []
    const r = await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: ['a'],
      loadSamples: () => [], suggest, applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(suggest).toHaveBeenCalledTimes(1)               // 只分析 b
    expect(applied).toEqual([['b', { rel: '同事', role: 'PM' }]])
    expect([...r.analyzedIds].sort()).toEqual(['a', 'b'])
    expect(r.succeeded).toBe(1)
    expect(r.empty).toBe(0)
    expect(r.failed).toBe(0)
  })
  it('空结果 → 不写入、id 不入集合，计入 empty', async () => {
    const suggest = vi.fn().mockResolvedValue({})
    const applied: unknown[] = []
    const r = await analyzeRolesForNew({
      friends: [F('a')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(applied).toEqual([])
    expect(r.analyzedIds).toEqual([])
    expect(r.empty).toBe(1)
    expect(r.succeeded).toBe(0)
  })
  it('suggest 抛异常 → 跳过、继续后续、不入集合，计入 failed 并记第一条错误', async () => {
    const suggest = vi.fn()
      .mockRejectedValueOnce(new Error('云函数超时'))
      .mockResolvedValueOnce({ role: 'PM' })
    const applied: Array<[string, unknown]> = []
    const r = await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(applied).toEqual([['b', { rel: undefined, role: 'PM' }]])
    expect(r.analyzedIds).toEqual(['b'])
    expect(r.failed).toBe(1)
    expect(r.succeeded).toBe(1)
    expect(r.firstError).toBe('云函数超时')
  })
  it('onProgress 报告 done/total（0 起、total 结束）', async () => {
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const calls: Array<[number, number]> = []
    await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: () => {}, onProgress: (d, t) => calls.push([d, t]),
    })
    expect(calls[0]).toEqual([0, 2])
    expect(calls[calls.length - 1]).toEqual([2, 2])
  })
  it('无新好友（全在集合里）→ 不调用 suggest、不触发 onProgress', async () => {
    const suggest = vi.fn()
    const onProgress = vi.fn()
    const r = await analyzeRolesForNew({
      friends: [F('a')], analyzedIds: ['a'], loadSamples: () => [], suggest,
      applyRole: () => {}, onProgress,
    })
    expect(suggest).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
    expect(r.analyzedIds).toEqual(['a'])
    expect(r.succeeded).toBe(0)
    expect(r.failed).toBe(0)
    expect(r.empty).toBe(0)
  })
})
