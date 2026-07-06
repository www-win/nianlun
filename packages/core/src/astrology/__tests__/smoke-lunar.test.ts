import { describe, it, expect } from 'vitest'
import { Solar } from 'lunar-javascript'

describe('lunar-javascript 冒烟', () => {
  it('能排出八字四柱、生肖、星座、当日干支', () => {
    const solar = Solar.fromYmdHms(1990, 8, 15, 14, 0, 0)
    const lunar = solar.getLunar()
    const ec = lunar.getEightChar()
    // 四柱应为两字干支字符串
    expect(ec.getYear()).toHaveLength(2)
    expect(ec.getMonth()).toHaveLength(2)
    expect(ec.getDay()).toHaveLength(2)
    expect(ec.getTime()).toHaveLength(2)
    // 1990 为马年
    expect(lunar.getYearShengXiao()).toContain('马')
    // 8/15 为狮子座
    expect(solar.getXingZuo()).toContain('狮子')
    // 当日干支两字
    expect(lunar.getDayInGanZhi()).toHaveLength(2)
  })
})
