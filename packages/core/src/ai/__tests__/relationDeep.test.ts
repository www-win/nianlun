import { describe, it, expect } from 'vitest'
import { buildRelationDeepPrompt, parseRelationDeep } from '../relationDeep'
import type { Friend } from '../../model/types'

const FRIEND = {
  id: 'f1', name: '张三', alias: '', rel: '挚友', role: '产品经理',
  msgCount: 1200, sentRatio: 55, peakPeriod: '晚上',
  monthly: [10, 20, 0, 30, 40, 5, 0, 12, 22, 33, 8, 15],
} as unknown as Friend

describe('buildRelationDeepPrompt', () => {
  it('prompt 含好友名、样本行与 10 块关键字段名', () => {
    const p = buildRelationDeepPrompt(FRIEND, ['我：在吗', '对方：在'])
    expect(p).toContain('张三')
    expect(p).toContain('我：在吗')
    // 10 块字段名都要在格式说明里出现
    for (const key of ['overall', 'attachment', 'interaction', 'needs', 'uniqueness',
      'security', 'power', 'triggers', 'language', 'suggestions']) {
      expect(p).toContain(key)
    }
  })

  it('prompt 要求引原句、无线索填占位、禁止臆测', () => {
    const p = buildRelationDeepPrompt(FRIEND, [])
    expect(p).toContain('暂无足够线索')
    expect(p).toContain('原句')
    expect(p).toContain('（本次无可用聊天样本）')
  })
})

describe('parseRelationDeep', () => {
  it('解析完整 JSON 的所有嵌套块', () => {
    const json = JSON.stringify({
      overall: '一场追逐-回避之舞',
      attachment: { me: { style: '焦虑型', desc: '渴求回应' }, other: { style: '回避型', desc: '重视独处' } },
      interaction: { initiative: '你主动', expression: '你直接 TA 克制', conflict: '追逐-回避循环' },
      needs: { me: '在场感', other: '自主性' },
      uniqueness: { sharedMemory: '并购案', ritual: '妈妈闺女互称' },
      security: { summary: '前高后低', turningPoints: [{ month: 9, event: '冷战', direction: '下降' }] },
      power: { summary: '你更投入', whoLeads: '你', dependency: '你依赖 TA' },
      triggers: { me: [{ trigger: '被已读不回', reaction: '追问' }], other: [{ trigger: '被逼表态', reaction: '沉默' }] },
      language: { appellation: '妈妈/闺女', catchphrases: '在忙什么', emoji: '拥抱', latency: 'TA 慢半拍' },
      suggestions: [{ topic: '沟通模式', problem: '追逐-回避', advice: '设暂停信号' }],
    })
    const r = parseRelationDeep(json)
    expect(r.overall).toBe('一场追逐-回避之舞')
    expect(r.attachment?.me?.style).toBe('焦虑型')
    expect(r.interaction?.conflict).toBe('追逐-回避循环')
    expect(r.needs?.other).toBe('自主性')
    expect(r.security?.turningPoints?.[0]).toEqual({ month: 9, event: '冷战', direction: '下降' })
    expect(r.power?.whoLeads).toBe('你')
    expect(r.triggers?.me?.[0]).toEqual({ trigger: '被已读不回', reaction: '追问' })
    expect(r.language?.emoji).toBe('拥抱')
    expect(r.suggestions?.[0]?.advice).toBe('设暂停信号')
  })

  it('剥代码围栏后仍能解析', () => {
    const r = parseRelationDeep('```json\n{"overall":"很好"}\n```')
    expect(r.overall).toBe('很好')
  })

  it('缺块只产出有值的字段', () => {
    const r = parseRelationDeep('{"overall":"仅此一段"}')
    expect(r.overall).toBe('仅此一段')
    expect(r.attachment).toBeUndefined()
    expect(r.suggestions).toBeUndefined()
  })

  it('坏 JSON / 非字符串入参返回 {} 且不抛异常', () => {
    expect(parseRelationDeep('not json at all')).toEqual({})
    expect(parseRelationDeep('{oops')).toEqual({})
    expect(parseRelationDeep(123 as unknown as string)).toEqual({})
    expect(parseRelationDeep('')).toEqual({})
  })

  it('脏数组元素被过滤，空块被省略', () => {
    const r = parseRelationDeep(JSON.stringify({
      triggers: { me: [{ trigger: '', reaction: '' }, { trigger: '雷区', reaction: '' }] },
      suggestions: [{ topic: '', problem: '', advice: '' }],
    }))
    expect(r.triggers?.me).toEqual([{ trigger: '雷区' }])
    expect(r.suggestions).toBeUndefined()  // 全空建议被过滤后数组为空 → 省略
  })
})
