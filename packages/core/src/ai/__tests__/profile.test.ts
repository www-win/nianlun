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

  // —— 值内含未转义半角双引号（模型引用对方原话），整段 JSON 非法 → 退回 salvage —— //
  it('值内未转义双引号：仍能救回完整字段而非只到第一个引号', () => {
    const r = parseFriendProfile(
      '{\n  "identity": "普通上班族",\n  "lifestyle": "常把"随缘"挂嘴边，周末爱爬山，作息规律"\n}',
    )
    expect(r.identity).toBe('普通上班族')
    expect(r.lifestyle).toBe('常把"随缘"挂嘴边，周末爱爬山，作息规律')
  })

  it('多字段里某字段含内嵌引号：其余字段不受牵连、该字段也完整', () => {
    const r = parseFriendProfile([
      '{',
      '  "identity": "某公司做"技术顾问"，负责后端",',
      '  "family": "已婚有一子",',
      '  "romance": "婚姻稳定",',
      '  "lifestyle": "爱爬山"',
      '}',
    ].join('\n'))
    expect(r.identity).toBe('某公司做"技术顾问"，负责后端')
    expect(r.family).toBe('已婚有一子')
    expect(r.romance).toBe('婚姻稳定')
    expect(r.lifestyle).toBe('爱爬山')
  })

  it('investment 子字段含内嵌引号也能完整救回', () => {
    const r = parseFriendProfile([
      '{',
      '  "investment": {',
      '    "summary": "常说"稳字当头"，偏保守",',
      '    "risk": "稳健型"',
      '  }',
      '}',
    ].join('\n'))
    expect(r.investment?.summary).toBe('常说"稳字当头"，偏保守')
    expect(r.investment?.risk).toBe('稳健型')
  })
})
