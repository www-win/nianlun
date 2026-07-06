import { describe, it, expect } from 'vitest'
import { scoreMessage, classify, toValue, wordPolarity } from '../emotion'

describe('scoreMessage', () => {
  it('正面词得正分', () => {
    expect(scoreMessage('今天好开心谢谢你')).toBeGreaterThan(0)
  })
  it('负面词得负分', () => {
    expect(scoreMessage('好难受心情烦')).toBeLessThan(0)
  })
  it('正面 emoji 加正分', () => {
    expect(scoreMessage('😄')).toBeGreaterThan(0)
    expect(scoreMessage('😭')).toBeLessThan(0)
  })
  it('哈哈哈算正、呜呜呜算负', () => {
    expect(scoreMessage('哈哈哈哈')).toBeGreaterThan(0)
    expect(scoreMessage('呜呜呜')).toBeLessThan(0)
  })
  it('否定词翻转极性：不开心 → 负', () => {
    expect(scoreMessage('我不开心')).toBeLessThan(0)
  })
  it('「别烦」作为整词命中，不被内部「烦」的否定翻转抵消 → 负', () => {
    expect(scoreMessage('别烦你')).toBeLessThan(0)
    expect(scoreMessage('你别烦我')).toBeLessThan(0)
  })
  it('子串不重复计分：太棒了(+2) 不叠加内部「棒」(+1)', () => {
    // 最长优先、不重叠扫描后「太棒了」仅计强烈正词单次权重(+2)，
    // 上界 2 验证子串「棒」不再重复叠加（旧实现会得 +3）。
    expect(scoreMessage('太棒了')).toBeLessThanOrEqual(2)
    expect(scoreMessage('太棒了')).toBeGreaterThan(0)
  })
  it('感叹号放大同号强度', () => {
    expect(Math.abs(scoreMessage('太棒了！！！'))).toBeGreaterThan(Math.abs(scoreMessage('太棒了')))
  })
  it('空串/纯符号得 0，永不抛异常', () => {
    expect(scoreMessage('')).toBe(0)
    expect(scoreMessage('。。。')).toBe(0)
  })
})

describe('classify', () => {
  it('按 ±0.5 阈值分三档', () => {
    expect(classify(1)).toBe('开心')
    expect(classify(-1)).toBe('难过')
    expect(classify(0)).toBe('平淡')
    expect(classify(0.5)).toBe('平淡')   // 边界不含
  })
})

describe('toValue', () => {
  it('中性 raw=0 → 0.5', () => {
    expect(toValue(0)).toBeCloseTo(0.5)
  })
  it('强正 → 趋近 1，强负 → 趋近 0，且落在 [0,1]', () => {
    expect(toValue(10)).toBeCloseTo(1)
    expect(toValue(-10)).toBeCloseTo(0)
    expect(toValue(3)).toBeGreaterThan(0.5)
    expect(toValue(-3)).toBeLessThan(0.5)
  })
})

describe('wordPolarity', () => {
  it('正词>0、负词<0、未收录=0', () => {
    expect(wordPolarity('开心')).toBeGreaterThan(0)
    expect(wordPolarity('难受')).toBeLessThan(0)
    expect(wordPolarity('桌子')).toBe(0)
  })
})
