import { describe, it, expect } from 'vitest'
import { normalizeStockName, parseStockExtraction, mergeStockPicks, aggregateByStock, aggregateByRecommender, buildStockExtractionPrompt } from '../stock'
import type { ExtractCtx } from '../stock'
import type { Friend } from '../../model/types'

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

const mk = (over: Partial<import('../stock').StockPick> = {}): import('../stock').StockPick => ({
  stock: '江化微', stockNorm: '江化微', recommenderId: '张三', recommender: '张三首席',
  ts: 100, logics: [], companyNotes: [], ...over,
})

describe('mergeStockPicks', () => {
  it('同键去重、保序追加', () => {
    const a = [mk()]
    const b = [mk(), mk({ quote: '另一条' })]
    const out = mergeStockPicks(a, b)
    expect(out).toHaveLength(2)
    expect(out[1].quote).toBe('另一条')
  })
  it('不同票/不同人/不同时间视为不同记录', () => {
    const out = mergeStockPicks([mk()], [mk({ stockNorm: 'B' }), mk({ recommenderId: '李四' }), mk({ ts: 200 })])
    expect(out).toHaveLength(4)
  })
})

describe('aggregateByStock', () => {
  it('按 stockNorm 聚合：recommenderCount 计不同人、displayName 取高频写法、latest 取最新非空', () => {
    const picks = [
      mk({ stock: '江化微', recommenderId: '张三', ts: 100, targetMarketCap: '500亿', logics: ['L1'] }),
      mk({ stock: '江化微', recommenderId: '李四', ts: 300, multiple: '3倍', logics: ['L1', 'L2'] }),
      mk({ stock: '江化微科技', recommenderId: '李四', ts: 200 }),
    ]
    const [card] = aggregateByStock(picks)
    expect(card.stockNorm).toBe('江化微')            // 中文 toUpperCase 不变
    expect(card.recommenderCount).toBe(2)
    expect(card.pickCount).toBe(3)
    expect(card.displayName).toBe('江化微')          // 出现 2 次 > 江化微科技 1 次
    expect(card.latestMultiple).toBe('3倍')          // ts=300 那条
    expect(card.latestTargetMarketCap).toBe('500亿') // ts=300 无市值 → 回退到有值的最新(ts=100)
    expect(card.logics).toEqual(['L1', 'L2'])        // 去重合并
  })
})

describe('aggregateByRecommender', () => {
  it('按 recommenderId 聚合，stockCount 计不同 stockNorm', () => {
    const picks = [
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'A' }),
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'B' }),
      mk({ recommenderId: '张三', recommender: '张三首席', stockNorm: 'A', ts: 999 }),
      mk({ recommenderId: '李四', recommender: '李四', stockNorm: 'A' }),
    ]
    const out = aggregateByRecommender(picks).sort((a, b) => a.recommenderId.localeCompare(b.recommenderId))
    expect(out).toHaveLength(2)
    const zhang = out.find((r) => r.recommenderId === '张三')!
    expect(zhang.recommender).toBe('张三首席')
    expect(zhang.picks).toHaveLength(3)
    expect(zhang.stockCount).toBe(2)   // A、B
  })
})

const FR = { id: '张三', name: '张三', alias: '张三首席', rel: '客户', role: '首席',
  firstContact: 0, lastContact: 0, msgCount: 9, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: [], hourly: [], weekHour: [], keywords: [], userEdited: {} } as unknown as Friend

describe('buildStockExtractionPrompt', () => {
  it('含关键约束、空数组指示、好友名与编号样本', () => {
    const p = buildStockExtractionPrompt(FR, ['2026-03-05 对方：江化微看2倍'])
    expect(p).toContain('张三首席')
    expect(p).toContain('JSON 数组')
    expect(p).toContain('[]')
    expect(p).toContain('1. 2026-03-05 对方：江化微看2倍')
  })
  it('无样本给占位', () => {
    expect(buildStockExtractionPrompt(FR, [])).toContain('（本次无可用聊天样本）')
  })
})
