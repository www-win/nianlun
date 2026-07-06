import { describe, it, expect } from 'vitest'
import { normalizeStockName } from '../stock'

describe('normalizeStockName', () => {
  it('去首尾空格与内部空白', () => {
    expect(normalizeStockName(' 江 化微 ')).toBe('江化微')
  })
  it('去括号及其内容（中英文括号）', () => {
    expect(normalizeStockName('国瓷材料(A股)')).toBe('国瓷材料')
    expect(normalizeStockName('和林微纳（688661）')).toBe('和林微纳')
  })
  it('英文统一大写，使同名不同写法归一', () => {
    expect(normalizeStockName('abc')).toBe(normalizeStockName('ABC'))
  })
  it('非字符串返回空串', () => {
    expect(normalizeStockName(undefined as unknown as string)).toBe('')
  })
})
