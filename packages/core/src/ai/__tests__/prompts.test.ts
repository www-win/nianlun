import { describe, it, expect } from 'vitest'
import type { ReportData, Friend } from '../../model/types'
import { buildReportCopyPrompt, buildFriendAnalysisPrompt } from '../prompts'

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

const friendForAnalysis: Friend = {
  id: 'f9', name: '阿强', alias: '', rel: '同事', role: '产品经理',
  firstContact: 1700000000000, lastContact: 1730000000000, msgCount: 820, sentRatio: 65,
  peakPeriod: '深夜', maxStreak: 14, monthly: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 130],
  userEdited: {},
}

describe('buildFriendAnalysisPrompt', () => {
  it('提示词里包含该好友的关键统计字段', () => {
    const p = buildFriendAnalysisPrompt(friendForAnalysis)
    expect(p).toContain('阿强')
    expect(p).toContain('同事')
    expect(p).toContain('产品经理')
    expect(p).toContain('820')
    expect(p).toContain('65')
    expect(p).toContain('深夜')
    expect(p).toContain('2023-11-14')
  })

  it('用 alias 优先于 name 显示好友', () => {
    const p = buildFriendAnalysisPrompt({ ...friendForAnalysis, alias: '强哥' })
    expect(p).toContain('强哥')
  })

  it('要求输出中文画像、不罗列数字清单', () => {
    const p = buildFriendAnalysisPrompt(friendForAnalysis)
    expect(p).toContain('画像')
    expect(p).toContain('只输出')
  })
})
