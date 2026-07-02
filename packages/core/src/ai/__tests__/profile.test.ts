import { describe, it, expect } from 'vitest'
import type { Friend } from '../../model/types'
import { buildFriendProfilePrompt } from '../profile'

const friend: Friend = {
  id: 'f1', name: '小美', alias: '', rel: '客户', role: '支行长',
  firstContact: 0, lastContact: 0, msgCount: 300, sentRatio: 55,
  peakPeriod: '晚上', maxStreak: 9, monthly: new Array(12).fill(0), userEdited: {},
  hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0), keywords: [],
}

describe('buildFriendProfilePrompt', () => {
  it('含好友名、5 个侧面字段、投资 4 子维度与「暂无足够线索」约束', () => {
    const p = buildFriendProfilePrompt(friend, ['我：最近买基金了', '对方：稳健点好'])
    expect(p).toContain('小美')
    expect(p).toContain('identity')
    expect(p).toContain('family')
    expect(p).toContain('romance')
    expect(p).toContain('lifestyle')
    expect(p).toContain('investment')
    expect(p).toContain('risk')
    expect(p).toContain('categories')
    expect(p).toContain('wealth')
    expect(p).toContain('style')
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('我：最近买基金了')
  })
})
