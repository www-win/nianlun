import { describe, it, expect } from 'vitest'
import { MBTI_CODES, mbtiTitle, detectMbtiFromText, buildMbtiPrompt, parseMbti, effectiveMbtiCode } from '../mbti'
import type { Friend } from '../../model/types'

describe('MBTI 常量与识别', () => {
  it('MBTI_CODES 恰好 16 型且全大写', () => {
    expect(MBTI_CODES).toHaveLength(16)
    expect(new Set(MBTI_CODES).size).toBe(16)
    expect(MBTI_CODES.every((c) => c === c.toUpperCase())).toBe(true)
  })

  it('mbtiTitle 每型都有非空中文别名', () => {
    for (const c of MBTI_CODES) expect(mbtiTitle(c).length).toBeGreaterThan(0)
  })

  it('detectMbtiFromText 从备注文本识别类型码（大小写不敏感，返回大写）', () => {
    expect(detectMbtiFromText('老王 intj 客户')).toBe('INTJ')
    expect(detectMbtiFromText('我是ENFP型的')).toBe('ENFP')
    expect(detectMbtiFromText('(ISTP)')).toBe('ISTP')
  })

  it('detectMbtiFromText 词边界：紧贴字母不误匹配', () => {
    expect(detectMbtiFromText('aINTJ')).toBeNull()
    expect(detectMbtiFromText('INTJX')).toBeNull()
    expect(detectMbtiFromText('POINTJUMP')).toBeNull()
  })

  it('detectMbtiFromText 非 16 型串返回 null', () => {
    expect(detectMbtiFromText('INTX')).toBeNull()
    expect(detectMbtiFromText('老王')).toBeNull()
    expect(detectMbtiFromText('')).toBeNull()
  })

  it('detectMbtiFromText 非字符串安全返回 null', () => {
    // @ts-expect-error 故意传非字符串
    expect(detectMbtiFromText(null)).toBeNull()
  })
})

function fakeFriend(over: Partial<Friend> = {}): Friend {
  return {
    id: 'u1', name: '老王', alias: '', rel: '客户', role: '',
    firstContact: 0, lastContact: 0, msgCount: 100, sentRatio: 50,
    peakPeriod: '晚上', maxStreak: 3, monthly: new Array(12).fill(0),
    hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
    keywords: [], userEdited: {},
    ...over,
  }
}

describe('buildMbtiPrompt', () => {
  it('含好友名、关系与 JSON 契约要点', () => {
    const p = buildMbtiPrompt(fakeFriend({ alias: '王工' }), ['我：在吗', '对方：在'])
    expect(p).toContain('王工')
    expect(p).toContain('客户')
    expect(p).toContain('code')
    expect(p).toContain('dimensions')
    expect(p).toContain('我：在吗')
  })
  it('无样本时给占位而非崩溃', () => {
    expect(buildMbtiPrompt(fakeFriend(), [])).toContain('无可用聊天样本')
  })
})

describe('parseMbti', () => {
  it('解析完整 JSON（含代码围栏）', () => {
    const text = '```json\n{"code":"INTJ","title":"建筑师","summary":"理性独立。","dimensions":[' +
      '{"axis":"EI","pole":"I","strength":70,"note":"少主动"},' +
      '{"axis":"SN","pole":"N","strength":65},' +
      '{"axis":"TF","pole":"T","strength":80},' +
      '{"axis":"JP","pole":"J","strength":60}]}\n```'
    const r = parseMbti(text)!
    expect(r.code).toBe('INTJ')
    expect(r.title).toBe('建筑师')
    expect(r.dimensions).toHaveLength(4)
    expect(r.dimensions.map((d) => d.axis)).toEqual(['EI', 'SN', 'TF', 'JP'])
    expect(r.dimensions[0]).toMatchObject({ pole: 'I', strength: 70, note: '少主动' })
  })

  it('title 缺失用别名补，dimensions 缺失按 code 反推补齐', () => {
    const r = parseMbti('{"code":"enfp","summary":"热情。"}')!
    expect(r.code).toBe('ENFP')
    expect(r.title).toBe('竞选者')
    expect(r.dimensions.map((d) => d.pole)).toEqual(['E', 'N', 'F', 'P'])
    expect(r.dimensions.every((d) => d.strength >= 0 && d.strength <= 100)).toBe(true)
  })

  it('非法/缺失 code 返回 null', () => {
    expect(parseMbti('{"code":"INTX","summary":"x"}')).toBeNull()
    expect(parseMbti('{"summary":"无 code"}')).toBeNull()
  })

  it('脏文本/无花括号返回 null', () => {
    expect(parseMbti('这不是 JSON')).toBeNull()
    expect(parseMbti('')).toBeNull()
  })

  it('JSON 被 maxTokens 截断（整体不闭合）时逐字段抢救出 code 与已写维度', () => {
    const truncated =
      '{"code":"INTJ","title":"建筑师","summary":"理性独立，逻辑清晰。","dimensions":[' +
      '{"axis":"EI","pole":"I","strength":72,"note":"很少主动发起"},' +
      '{"axis":"SN","pole":"N","strength":65,"note":"偏好抽象与' // 从这里被截断
    const r = parseMbti(truncated)!
    expect(r).not.toBeNull()
    expect(r.code).toBe('INTJ')
    expect(r.title).toBe('建筑师')
    expect(r.summary).toBe('理性独立，逻辑清晰。')
    expect(r.dimensions).toHaveLength(4)
    const ei = r.dimensions.find((d) => d.axis === 'EI')!
    expect(ei.strength).toBe(72)
    expect(ei.note).toBe('很少主动发起')
    const sn = r.dimensions.find((d) => d.axis === 'SN')!
    expect(sn.strength).toBe(65) // 强度已写出，note 半截未闭合则忽略
  })

  it('summary/note 含未转义半角引号（整段 JSON 非法→salvage）仍完整救回', () => {
    const bad = '{"code":"INTJ","title":"建筑师",' +
      '"summary":"常说"谋定后动"，不打无准备的仗","dimensions":[' +
      '{"axis":"EI","pole":"I","strength":72,"note":"口头禅是"再想想""}]}'
    const r = parseMbti(bad)!
    expect(r.code).toBe('INTJ')
    expect(r.summary).toBe('常说"谋定后动"，不打无准备的仗')
    const ei = r.dimensions.find((d) => d.axis === 'EI')!
    expect(ei.note).toBe('口头禅是"再想想"')
  })

  it('无任何闭合括号（早截断）仍能救回 code 并补齐 4 维度', () => {
    const r = parseMbti('{"code":"ENFP","title":"竞选者","summary":"热情外向')!
    expect(r.code).toBe('ENFP')
    expect(r.title).toBe('竞选者')
    expect(r.dimensions.map((d) => d.pole)).toEqual(['E', 'N', 'F', 'P'])
  })

  it('截断且 code 尚未写出则仍返回 null', () => {
    expect(parseMbti('{"title":"建筑师","summary":"理性')).toBeNull()
  })
})

describe('effectiveMbtiCode 优先级', () => {
  it('手改优先', () => {
    const f = fakeFriend({ alias: 'ENFP', userEdited: { mbti: 'INTJ' } })
    expect(effectiveMbtiCode(f, 'ISTP')).toEqual({ code: 'INTJ', source: 'manual' })
  })
  it('无手改则备注识别（alias > role > name）', () => {
    const f = fakeFriend({ alias: '王工 ENFP' })
    expect(effectiveMbtiCode(f, 'ISTP')).toEqual({ code: 'ENFP', source: 'remark' })
  })
  it('无手改无备注则用 AI 码', () => {
    expect(effectiveMbtiCode(fakeFriend(), 'ISTP')).toEqual({ code: 'ISTP', source: 'ai' })
  })
  it('全无则 none', () => {
    expect(effectiveMbtiCode(fakeFriend(), null)).toEqual({ code: null, source: 'none' })
  })
})
