import { describe, it, expect } from 'vitest'
import type { ReportData, Friend } from '../../model/types'
import { buildReportCopyPrompt } from '../prompts'

const report: ReportData = {
  year: 2024,
  totalMessages: 1234,
  friendCount: 30,
  activeDays: 200,
  topContacts: [{ friendId: 'f1', msgCount: 500 }],
  latestMessage: null,
  keywords: [],
  relationBreakdown: [{ rel: '挚友', percent: 60 }],
}
const friends: Friend[] = [
  {
    id: 'f1', name: '小明', alias: '', rel: '挚友', role: '',
    firstContact: 0, lastContact: 0, msgCount: 500, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: new Array(12).fill(0), userEdited: {},
  },
]

describe('buildReportCopyPrompt', () => {
  it('提示词里包含关键统计字段', () => {
    const p = buildReportCopyPrompt(report, friends)
    expect(p).toContain('2024')
    expect(p).toContain('1234')
    expect(p).toContain('小明')
    expect(p).toContain('挚友')
  })

  it('用 alias 优先于 name 显示联系人', () => {
    const aliased = [{ ...friends[0], alias: '明哥' }]
    const p = buildReportCopyPrompt(report, aliased)
    expect(p).toContain('明哥')
  })
})
