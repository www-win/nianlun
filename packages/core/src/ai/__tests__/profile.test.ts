import { describe, it, expect } from 'vitest'
import type { Friend } from '../../model/types'
import { buildFriendProfilePrompt, parseFriendProfile } from '../profile'

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

describe('parseFriendProfile', () => {
  it('解析完整对象（含嵌套 investment）', () => {
    const r = parseFriendProfile(JSON.stringify({
      identity: '某城商行支行长', family: '已婚有一子', romance: '婚姻稳定',
      lifestyle: '爱打高尔夫、常聊出差', investment: {
        summary: '整体稳健偏保守', risk: '稳健型', categories: '基金、银行理财',
        wealth: '可投资金较充裕', style: '偏自主、长线为主',
      },
    }))
    expect(r.identity).toBe('某城商行支行长')
    expect(r.lifestyle).toBe('爱打高尔夫、常聊出差')
    expect(r.investment?.risk).toBe('稳健型')
    expect(r.investment?.style).toBe('偏自主、长线为主')
  })
  it('剥代码围栏后仍能解析', () => {
    const r = parseFriendProfile('```json\n{"identity":"中学老师"}\n```')
    expect(r.identity).toBe('中学老师')
  })
  it('缺字段时省略该字段', () => {
    const r = parseFriendProfile('{"identity":"程序员"}')
    expect(r.identity).toBe('程序员')
    expect(r.family).toBeUndefined()
    expect(r.investment).toBeUndefined()
  })
  it('investment 部分子字段缺失时只保留有值的', () => {
    const r = parseFriendProfile(JSON.stringify({ investment: { risk: '进取型', categories: '' } }))
    expect(r.investment).toEqual({ risk: '进取型' })
  })
  it('investment 全空时整块省略', () => {
    const r = parseFriendProfile(JSON.stringify({ investment: { risk: '', summary: '  ' } }))
    expect(r.investment).toBeUndefined()
  })
  it('空串字段被过滤', () => {
    const r = parseFriendProfile('{"identity":"  ","family":"有娃"}')
    expect(r.identity).toBeUndefined()
    expect(r.family).toBe('有娃')
  })
  it('垃圾输入 / 空串返回 {}，不抛异常', () => {
    expect(parseFriendProfile('不是 JSON')).toEqual({})
    expect(parseFriendProfile('')).toEqual({})
  })
})
