import { describe, it, expect } from 'vitest'
import { wordCloudItems, weekHourHeatmap, monthlyTrend } from '../insights'
import type { Friend } from '@nianlun/core'

const mkFriend = (monthly: number[]): Friend => ({ monthly } as unknown as Friend)

describe('wordCloudItems', () => {
  it('空数组返回空', () => {
    expect(wordCloudItems([])).toEqual([])
  })

  it('词数少于上限时全部返回，且保留 word/count', () => {
    const out = wordCloudItems([{ word: '基金', count: 10 }, { word: '行情', count: 4 }])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ word: '基金', count: 10 })
  })

  it('截断到 maxItems', () => {
    const kws = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, count: 40 - i }))
    expect(wordCloudItems(kws, 30)).toHaveLength(30)
  })

  it('全部同频时给中间档 tier=3', () => {
    const out = wordCloudItems([{ word: 'a', count: 5 }, { word: 'b', count: 5 }])
    expect(out.every((x) => x.tier === 3)).toBe(true)
  })

  it('最高频 tier=5、最低频 tier=1，tier 落在 1–5', () => {
    const out = wordCloudItems([
      { word: 'hi', count: 100 },
      { word: 'mid', count: 50 },
      { word: 'lo', count: 1 },
    ])
    expect(out[0].tier).toBe(5)
    expect(out[2].tier).toBe(1)
    expect(out.every((x) => x.tier >= 1 && x.tier <= 5)).toBe(true)
  })
})

describe('weekHourHeatmap', () => {
  it('全 0 时 peak 为 null、max 为 0、7 行每行 24 格', () => {
    const r = weekHourHeatmap(new Array(168).fill(0))
    expect(r.max).toBe(0)
    expect(r.peak).toBeNull()
    expect(r.rows).toHaveLength(7)
    expect(r.rows.every((row) => row.cells.length === 24)).toBe(true)
  })

  it('按周一→周日重排（首行「一」末行「日」）', () => {
    const r = weekHourHeatmap(new Array(168).fill(0))
    expect(r.rows[0].label).toBe('一')
    expect(r.rows[6].label).toBe('日')
  })

  it('正确定位峰值（周一 20 点）并把该天数据放到首行', () => {
    const wh = new Array(168).fill(0)
    wh[1 * 24 + 20] = 5 // 周一(getDay=1) 20:00
    wh[0 * 24 + 9] = 3 // 周日(getDay=0) 9:00
    const r = weekHourHeatmap(wh)
    expect(r.max).toBe(5)
    expect(r.peak).toEqual({ label: '一', hour: 20, count: 5 })
    // 首行是周一，第 20 格应为 5
    expect(r.rows[0].label).toBe('一')
    expect(r.rows[0].cells[20]).toBe(5)
    // 末行是周日，第 9 格应为 3
    expect(r.rows[6].cells[9]).toBe(3)
  })
})

describe('monthlyTrend', () => {
  it('无好友时 12 个月全 0、max/total 为 0、peak 为 null', () => {
    const r = monthlyTrend([])
    expect(r.months).toHaveLength(12)
    expect(r.months[0]).toMatchObject({ label: '1月', count: 0 })
    expect(r.max).toBe(0)
    expect(r.total).toBe(0)
    expect(r.peak).toBeNull()
  })

  it('跨好友按月累加，算出 pct/total/peak', () => {
    const a = mkFriend([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]) // 1月10, 12月5
    const b = mkFriend([0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0]) // 3月20
    const r = monthlyTrend([a, b])
    expect(r.months[0].count).toBe(10) // 1月
    expect(r.months[2].count).toBe(20) // 3月
    expect(r.months[11].count).toBe(5) // 12月
    expect(r.total).toBe(35)
    expect(r.max).toBe(20)
    expect(r.months[2].pct).toBe(100) // 3月是峰值
    expect(r.months[0].pct).toBe(50) // 10/20
    expect(r.peak).toEqual({ label: '3月', count: 20 })
  })
})
