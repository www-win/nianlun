import { describe, it, expect, vi } from 'vitest'
import { makeAiClient } from '../aiClient'
import type { Friend, ReportData } from '@nianlun/core'

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

  it('analyzeYearSentiment 回传整段文本', async () => {
    const transport = vi.fn().mockResolvedValue('这一年整体热络、以正向互动为主。')
    const out = await makeAiClient(transport).analyzeYearSentiment(REPORT, ['对方：新年快乐'])
    expect(out).toContain('热络')
    expect(transport.mock.calls[0][0]).toContain('2025')
  })
})
