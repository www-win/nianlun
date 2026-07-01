import { describe, it, expect } from 'vitest'
import type { Friend, ReportData } from '../../model/types'
import { buildFriendSentimentPrompt, buildYearSentimentPrompt, parseSentiment } from '../sentiment'

const friend: Friend = {
  id: 'f1', name: '小美', alias: '', rel: '挚友', role: '大学室友',
  firstContact: 0, lastContact: 0, msgCount: 300, sentRatio: 55,
  peakPeriod: '深夜', maxStreak: 9, monthly: new Array(12).fill(0), userEdited: {},
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
}

describe('buildFriendSentimentPrompt', () => {
  it('含好友名与备注，并要求输出 JSON 的 tone/summary', () => {
    const p = buildFriendSentimentPrompt(friend, ['我：在吗', '对方：在的~'])
    expect(p).toContain('小美')
    expect(p).toContain('大学室友')
    expect(p).toContain('tone')
    expect(p).toContain('summary')
  })
})

describe('parseSentiment', () => {
  it('解析正常 JSON', () => {
    const r = parseSentiment('{"tone":"热络","summary":"你们无话不谈"}')
    expect(r.tone).toBe('热络')
    expect(r.summary).toBe('你们无话不谈')
  })
  it('剥除代码围栏后仍能解析', () => {
    const r = parseSentiment('```json\n{"tone":"渐远","summary":"最近少了"}\n```')
    expect(r.tone).toBe('渐远')
  })
  it('垃圾输入返回空对象、不抛异常', () => {
    expect(parseSentiment('这不是 JSON')).toEqual({})
    expect(parseSentiment('')).toEqual({})
  })
})

describe('buildYearSentimentPrompt', () => {
  const report: ReportData = {
    year: 2025, totalMessages: 1000, friendCount: 20, activeDays: 150,
    topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [],
  }
  it('含年份与样本行，要求输出一段话', () => {
    const p = buildYearSentimentPrompt(report, ['对方：新年快乐', '我：一起加油'])
    expect(p).toContain('2025')
    expect(p).toContain('新年快乐')
    expect(p).toContain('一段')
  })
})
