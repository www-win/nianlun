import { describe, it, expect } from 'vitest'
import { buildBaziChart } from '../chart'

describe('buildBaziChart', () => {
  it('含时辰：四柱齐全、日主为日柱首字、生肖星座正确、五行合计为8', () => {
    const c = buildBaziChart({ year: 1990, month: 8, day: 15, hour: 14 })
    expect(c.pillars.year).toHaveLength(2)
    expect(c.pillars.hour).toHaveLength(2)
    expect(c.dayMaster).toBe(c.pillars.day.charAt(0))
    expect(c.zodiac).toContain('马')          // 1990 马年
    expect(c.constellation).toContain('狮子')  // 8/15 狮子座
    const sum = Object.values(c.fiveElements).reduce((a, b) => a + b, 0)
    expect(sum).toBe(8)                        // 四柱天干+地支共8字
    expect(Object.keys(c.fiveElements).sort()).toEqual(['土', '木', '水', '火', '金'].sort())
  })

  it('缺时辰：省略 hour 柱、只出三柱、五行合计为6', () => {
    const c = buildBaziChart({ year: 1990, month: 8, day: 15 })
    expect(c.pillars.hour).toBeUndefined()
    const sum = Object.values(c.fiveElements).reduce((a, b) => a + b, 0)
    expect(sum).toBe(6)
  })
})
