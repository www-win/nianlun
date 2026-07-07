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
})
