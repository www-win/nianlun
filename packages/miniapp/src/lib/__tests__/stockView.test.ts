import { describe, it, expect } from 'vitest'
import { sortStockCards, sortRecommenders, stockStats } from '../stockView'
import type { StockCard, RecommenderPicks, StockPick } from '@nianlun/core'

const card = (norm: string, rc: number, pc: number): StockCard => ({
  stockNorm: norm, displayName: norm, recommenderCount: rc, pickCount: pc,
  logics: [], companyNotes: [], picks: [],
})
const rp = (id: string, sc: number, pn: number): RecommenderPicks => ({
  recommenderId: id, recommender: id, stockCount: sc,
  picks: Array.from({ length: pn }, () => ({} as StockPick)),
})
const pick = (stockNorm: string, rid: string): StockPick => ({
  stock: stockNorm, stockNorm, recommenderId: rid, recommender: rid, ts: 0, logics: [], companyNotes: [],
})

describe('sortStockCards', () => {
  it('按 recommenderCount 降序，tie 用 pickCount', () => {
    const out = sortStockCards([card('A', 1, 9), card('B', 3, 1), card('C', 3, 5)])
    expect(out.map((c) => c.stockNorm)).toEqual(['C', 'B', 'A'])  // B/C 同 rc=3，C pickCount 大在前
  })
})
describe('sortRecommenders', () => {
  it('按 stockCount 降序', () => {
    const out = sortRecommenders([rp('a', 1, 1), rp('b', 4, 1)])
    expect(out.map((r) => r.recommenderId)).toEqual(['b', 'a'])
  })
})
describe('stockStats', () => {
  it('统计条数 / 不同票数 / 不同人数', () => {
    const s = stockStats([pick('A', 'x'), pick('A', 'y'), pick('B', 'x')])
    expect(s).toEqual({ pickCount: 3, stockCount: 2, personCount: 2 })
  })
  it('空 → 全 0', () => {
    expect(stockStats([])).toEqual({ pickCount: 0, stockCount: 0, personCount: 0 })
  })
})
