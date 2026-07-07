import { describe, it, expect } from 'vitest'
import { MBTI_CODES, mbtiTitle, detectMbtiFromText } from '../mbti'

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
