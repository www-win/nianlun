import { describe, it, expect, vi } from 'vitest'
import { makeAiClient } from '../aiClient'
import type { Friend, ReportData, BaziChart, DayFortune, Compatibility, ExtractCtx } from '@nianlun/core'

const REPORT = { year: 2025, totalMessages: 10, friendCount: 1, activeDays: 3, topContacts: [], relationBreakdown: [] } as unknown as ReportData
const FRIEND = { id: 'f1', name: '张三', alias: '', rel: '其他', role: '', msgCount: 9, sentRatio: 50, peakPeriod: '晚上', maxStreak: 2 } as unknown as Friend

describe('aiClient', () => {
  it('generateReportCopy 把 prompt 交给 transport 并回传文本', async () => {
    const transport = vi.fn().mockResolvedValue('这一年你们很热闹。')
    const out = await makeAiClient(transport).generateReportCopy(REPORT, [FRIEND])
    expect(out).toBe('这一年你们很热闹。')
    expect(transport.mock.calls[0][0]).toContain('2025')   // prompt 含年份
  })

  it('suggestFriend 解析模型 JSON 为结构化建议', async () => {
    const transport = vi.fn().mockResolvedValue('{"rel":"同事","role":"产品经理","reason":"工作日白天聊得多"}')
    const out = await makeAiClient(transport).suggestFriend(FRIEND, ['我：在吗', '对方：在'])
    expect(out.rel).toBe('同事')
    expect(out.role).toBe('产品经理')
  })

  it('analyzeFriendSentiment 解析 tone/summary', async () => {
    const transport = vi.fn().mockResolvedValue('{"tone":"热络","summary":"你们无话不谈"}')
    const out = await makeAiClient(transport).analyzeFriendSentiment(FRIEND, ['我：哈哈', '对方：笑死'])
    expect(out.tone).toBe('热络')
    expect(out.summary).toBe('你们无话不谈')
    expect(transport.mock.calls[0][0]).toContain('张三')
  })

  it('analyzeFriendProfile 走画像 prompt 并解析 5 侧面 + 投资子维度', async () => {
    const transport = vi.fn().mockResolvedValue(JSON.stringify({
      identity: '某城商行支行长', family: '已婚有一子', romance: '婚姻稳定',
      lifestyle: '爱打高尔夫', investment: {
        summary: '整体稳健', risk: '稳健型', categories: '基金、理财',
        wealth: '资金充裕', style: '长线为主',
      },
    }))
    const out = await makeAiClient(transport).analyzeFriendProfile(FRIEND, ['我：最近买基金了', '对方：稳健点好'])
    expect(out.identity).toBe('某城商行支行长')
    expect(out.investment?.risk).toBe('稳健型')
    expect(out.investment?.style).toBe('长线为主')
    expect(transport.mock.calls[0][0]).toContain('investment')
    expect(transport.mock.calls[0][0]).toContain('张三')
  })

  it('analyzeFriendMbti：transport 返回 JSON → MbtiResult；脏输出 → null', async () => {
    const good = makeAiClient(async () => '{"code":"INTJ","summary":"理性。"}')
    const r = await good.analyzeFriendMbti(FRIEND, ['我：hi'])
    expect(r?.code).toBe('INTJ')

    const bad = makeAiClient(async () => '不是 JSON')
    expect(await bad.analyzeFriendMbti(FRIEND, [])).toBeNull()
  })

  it('analyzeYearSentiment 回传整段文本', async () => {
    const transport = vi.fn().mockResolvedValue('这一年整体热络、以正向互动为主。')
    const out = await makeAiClient(transport).analyzeYearSentiment(REPORT, ['对方：新年快乐'])
    expect(out).toContain('热络')
    expect(transport.mock.calls[0][0]).toContain('2025')
  })

  it('analyzeRelationDeep 拆 3 段并行调用并合并结果', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce('{"overall":"追逐-回避","attachment":{"me":{"style":"焦虑型"}}}')          // part 1
      .mockResolvedValueOnce('{"interaction":{"conflict":"追逐-回避循环"},"security":{"summary":"前高后低"}}') // part 2
      .mockResolvedValueOnce('{"power":{"whoLeads":"我"},"suggestions":[{"topic":"沟通","advice":"设暂停"}]}') // part 3
    const out = await makeAiClient(transport).analyzeRelationDeep(FRIEND, ['我：在吗', '对方：在'])
    expect(transport).toHaveBeenCalledTimes(3)
    expect(out.overall).toBe('追逐-回避')             // part 1
    expect(out.attachment?.me?.style).toBe('焦虑型')   // part 1
    expect(out.interaction?.conflict).toBe('追逐-回避循环') // part 2
    expect(out.security?.summary).toBe('前高后低')      // part 2
    expect(out.power?.whoLeads).toBe('我')            // part 3
    expect(out.suggestions?.[0]?.advice).toBe('设暂停')  // part 3，合并后仍在
    // 三段都不指定模型（走云函数默认），且各只请求自己那段的块
    for (const call of transport.mock.calls) expect(call[2]).toBeUndefined()
    expect(transport.mock.calls[0][0]).toContain('张三')      // prompt 含好友名
    expect(transport.mock.calls[0][0]).toContain('"overall"')      // part 1 有
    expect(transport.mock.calls[0][0]).not.toContain('"suggestions"') // part 3 的不在 part 1
    expect(transport.mock.calls[2][0]).toContain('"suggestions"')  // part 3 有
    expect(transport.mock.calls[2][0]).not.toContain('"overall"')  // part 1 的不在 part 3
  })

  it('analyzeRelationDeep 样本限量到 20 条（避免话痨好友 prompt 过大致 60s 超时）', async () => {
    const transport = vi.fn().mockResolvedValue('{"overall":"x"}')
    const many = Array.from({ length: 25 }, (_, i) => `样本S${i}X`)
    await makeAiClient(transport).analyzeRelationDeep(FRIEND, many)
    const prompt = transport.mock.calls[0][0] as string
    expect(prompt).toContain('样本S19X')      // 第 20 条，保留
    expect(prompt).not.toContain('样本S20X')  // 第 21 条，超出上限被丢弃
  })

  it('其它分析不指定模型（model 参数为 undefined，走云函数默认）', async () => {
    const transport = vi.fn().mockResolvedValue('{"tone":"热络"}')
    await makeAiClient(transport).analyzeFriendSentiment(FRIEND, ['我：哈哈'])
    expect(transport.mock.calls[0][2]).toBeUndefined()
  })
})

const astroFriend = { id: 'f1', name: '小美', alias: '', rel: '客户', role: '' } as any
const astroChart: BaziChart = {
  pillars: { year: '庚午', month: '甲申', day: '丙子', hour: '乙未' },
  dayMaster: '丙', fiveElements: { 木: 2, 火: 2, 土: 1, 金: 2, 水: 1 }, zodiac: '马', constellation: '狮子',
}
const astroFortune: DayFortune = { ganzhi: '戊寅', relation: '泄' }
const astroCompat: Compatibility = { harmonies: [], clashes: ['生肖相冲（鼠 ↔ 马）'] }

describe('aiClient 命理', () => {
  it('analyzeAstro：prompt 含盘数据，解析出四段', async () => {
    let seen = ''
    const client = makeAiClient(async (prompt: string) => {
      seen = prompt
      return JSON.stringify({ personality: '稳', fortune: '顺', affinity: '合', advice: '可正常往来' })
    })
    const r = await client.analyzeAstro(astroFriend, astroChart, astroFortune, astroCompat)
    expect(seen).toContain('丙子')
    expect(r.personality).toBe('稳')
    expect(r.advice).toBe('可正常往来')
  })

  it('extractBirth：解析出生辰；无则 null', async () => {
    const ok = makeAiClient(async () => JSON.stringify({ year: 1990, month: 8, day: 15 }))
    expect(await ok.extractBirth(astroFriend, ['对方：我1990年8月15号'])).toEqual({ year: 1990, month: 8, day: 15 })
    const none = makeAiClient(async () => JSON.stringify({ found: false }))
    expect(await none.extractBirth(astroFriend, [])).toBeNull()
  })

  it('extractStocks 走荐股 prompt 并解析为 StockPick[]', async () => {
    const transport = vi.fn().mockResolvedValue('[{"stock":"江化微","logics":["MOC涨价"],"companyNotes":[]}]')
    const ctx: ExtractCtx = { recommenderId: 'f1', recommender: '张三', fallbackTs: 100 }
    const out = await makeAiClient(transport).extractStocks(FRIEND, ['2026-03-05 对方：江化微看2倍'], ctx)
    expect(out).toHaveLength(1)
    expect(out[0].stock).toBe('江化微')
    expect(out[0].recommenderId).toBe('f1')       // ctx 注入
    expect(transport.mock.calls[0][0]).toContain('JSON 数组')
  })

  it('answerChatQa 把 prompt 交给 transport、回传 trim 后文本', async () => {
    const transport = vi.fn().mockResolvedValue('  你和张三聊了火锅。  ')
    const ctx = { statsSummary: '年份2024', samples: [], rawExcerpts: [{ friend: '张三', lines: ['2024-03-01 张三：吃火锅'] }] }
    const out = await makeAiClient(transport).answerChatQa('聊了啥', [], ctx as any)
    expect(out).toBe('你和张三聊了火锅。')                 // 已 trim
    expect(transport.mock.calls[0][0]).toContain('张三')   // prompt 含原文
    expect(transport.mock.calls[0][1]).toBe(2048)          // maxTokens
  })
})
