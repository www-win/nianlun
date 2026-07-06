import { describe, it, expect } from 'vitest'
import { normalizeStockName, parseStockExtraction } from '../stock'
import type { ExtractCtx } from '../stock'

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

const CTX: ExtractCtx = { recommenderId: '张三', recommender: '张三首席', fallbackTs: 1000 }

describe('parseStockExtraction', () => {
  it('解析数组并注入 recommender/stockNorm/ts', () => {
    const text = JSON.stringify([
      { stock: '江化微', date: '2026-03-05', targetMarketCap: '500亿', multiple: '2倍',
        targetTime: '1年内', logics: ['MOC涨价'], companyNotes: ['半导体材料'], quote: '看2倍' },
    ])
    const [p] = parseStockExtraction(text, CTX)
    expect(p.stock).toBe('江化微')
    expect(p.stockNorm).toBe('江化微')
    expect(p.recommenderId).toBe('张三')
    expect(p.recommender).toBe('张三首席')
    expect(p.ts).toBe(Date.UTC(2026, 2, 5))
    expect(p.targetMarketCap).toBe('500亿')
    expect(p.logics).toEqual(['MOC涨价'])
  })
  it('剥离数组前后噪声后仍解析', () => {
    const text = '好的，结果如下：\n[{"stock":"和林微纳","logics":[],"companyNotes":[]}] —— 完毕'
    expect(parseStockExtraction(text, CTX)).toHaveLength(1)
  })
  it('日期解析失败回退 fallbackTs', () => {
    const text = JSON.stringify([{ stock: 'A', date: '前段时间' }])
    expect(parseStockExtraction(text, CTX)[0].ts).toBe(1000)
  })
  it('丢弃无 stock 的元素，logics/companyNotes 归一为字符串数组', () => {
    const text = JSON.stringify([{ date: '2026' }, { stock: 'B', logics: 'x', companyNotes: null }])
    const out = parseStockExtraction(text, CTX)
    expect(out).toHaveLength(1)
    expect(out[0].logics).toEqual([])
    expect(out[0].companyNotes).toEqual([])
  })
  it('坏 JSON / 非数组 → []', () => {
    expect(parseStockExtraction('不是 json', CTX)).toEqual([])
    expect(parseStockExtraction('{"stock":"A"}', CTX)).toEqual([])
  })
})
