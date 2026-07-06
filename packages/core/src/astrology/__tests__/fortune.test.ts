import { describe, it, expect } from 'vitest'
import { wuxingRelation, getDayFortune } from '../fortune'
import { buildBaziChart } from '../chart'

describe('wuxingRelation（以 base 为我）', () => {
  it('同五行=比', () => expect(wuxingRelation('木', '木')).toBe('比'))
  it('生我=生（水生木）', () => expect(wuxingRelation('木', '水')).toBe('生'))
  it('我生=泄（木生火）', () => expect(wuxingRelation('木', '火')).toBe('泄'))
  it('克我=克（金克木）', () => expect(wuxingRelation('木', '金')).toBe('克'))
  it('我克=耗（木克土）', () => expect(wuxingRelation('木', '土')).toBe('耗'))
})

describe('getDayFortune', () => {
  it('返回当日两字干支与一个生克关系', () => {
    const chart = buildBaziChart({ year: 1990, month: 8, day: 15, hour: 14 })
    const f = getDayFortune({ year: 2026, month: 7, day: 6 }, chart)
    expect(f.ganzhi).toHaveLength(2)
    expect(['比', '生', '泄', '克', '耗', '平']).toContain(f.relation)
  })
})
