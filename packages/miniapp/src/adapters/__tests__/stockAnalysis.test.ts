import { describe, it, expect, vi } from 'vitest'
import { analyzeStocks, isFinanceRole } from '../stockAnalysis'
import type { Conversation, Friend, StockPick } from '@nianlun/core'

const F = (id: string, role = ''): Friend => ({
  id, name: id, alias: '', rel: '其他', role, firstContact: 0, lastContact: 0,
  msgCount: 1, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})
const conv = (id: string, texts: string[]): Conversation => ({
  id, peerName: id, isGroup: false,
  messages: texts.map((t, i) => ({ ts: 1000 + i, from: 'them' as const, type: 'text' as const, text: t })),
})
const pick = (over: Partial<StockPick> = {}): StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: 'x', recommender: 'x',
  ts: 1, logics: [], companyNotes: [], ...over,
})

describe('isFinanceRole', () => {
  it('role 命中金融关键词 → true；否则 false', () => {
    expect(isFinanceRole(F('a', '首席'))).toBe(true)
    expect(isFinanceRole(F('b', '家人'))).toBe(false)
  })
})

describe('analyzeStocks', () => {
  it('无白名单时仅金融类好友被抽取', async () => {
    const extract = vi.fn().mockResolvedValue([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', ['江化微看2倍']), conv('b', ['吃饭没'])],
      friends: [F('a', '首席'), F('b', '同学')],
      extract,
    })
    expect(extract).toHaveBeenCalledTimes(1)      // 只 a
    expect(r.analyzed).toBe(1)
    expect(r.withPicks).toBe(1)
    expect(r.picks).toHaveLength(1)
  })
  it('白名单优先于金融启发式', async () => {
    const extract = vi.fn().mockResolvedValue([])
    await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '同学')],
      targetIds: ['b'], extract,
    })
    expect(extract).toHaveBeenCalledTimes(1)
    expect(extract.mock.calls[0][0].id).toBe('b')  // 抽的是白名单里的 b
  })
  it('超长会话分块多次抽取并 merge 去重', async () => {
    const long = Array.from({ length: 200 }, (_, i) => '这是一条很长很长很长很长很长很长的消息' + i)
    const extract = vi.fn().mockResolvedValue([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', long)], friends: [F('a', '首席')], extract,
    })
    expect(extract.mock.calls.length).toBeGreaterThan(1)  // 分了多块
    expect(r.picks).toHaveLength(1)                        // 相同 pick 被 merge 去重
  })
  it('extract 抛异常 → 计入 failed、不中断、记录 firstError', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('云函数超时'))
      .mockResolvedValueOnce([pick()])
    const r = await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '基金经理')], extract,
    })
    expect(r.failed).toBe(1)
    expect(r.firstError).toBe('云函数超时')
    expect(r.picks).toHaveLength(1)
  })
  it('候选好友在本次 conversations 无匹配会话时不计入 analyzed/total，且不调用 extract', async () => {
    const extract = vi.fn().mockResolvedValue([pick()])
    const calls: Array<[number, number]> = []
    const r = await analyzeStocks({
      // 只有 a 的会话在本次重选文件里；b 是金融候选但本次未匹配到会话
      conversations: [conv('a', ['江化微看2倍'])],
      friends: [F('a', '首席'), F('b', '基金经理')],
      extract,
      onProgress: (d, t) => calls.push([d, t]),
    })
    expect(extract).toHaveBeenCalledTimes(1)   // 只 a 被抽取，b 未匹配会话不参与
    expect(r.analyzed).toBe(1)                 // 不把无会话的 b 算进已分析
    expect(r.picks).toHaveLength(1)
    // total（经 onProgress 暴露）只覆盖真正处理的 1 位好友，而非候选总数 2
    expect(calls[0]).toEqual([0, 1])
    expect(calls[calls.length - 1]).toEqual([1, 1])
  })

  it('onProgress 从 0 起、到 total 结束', async () => {
    const extract = vi.fn().mockResolvedValue([])
    const calls: Array<[number, number]> = []
    await analyzeStocks({
      conversations: [conv('a', ['x']), conv('b', ['y'])],
      friends: [F('a', '首席'), F('b', '券商')],
      extract, onProgress: (d, t) => calls.push([d, t]),
    })
    expect(calls[0]).toEqual([0, 2])
    expect(calls[calls.length - 1]).toEqual([2, 2])
  })
})
