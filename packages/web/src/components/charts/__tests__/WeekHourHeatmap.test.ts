import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WeekHourHeatmap from '../WeekHourHeatmap.vue'

describe('WeekHourHeatmap', () => {
  it('渲染 168 个格子', () => {
    const w = mount(WeekHourHeatmap, { props: { weekHour: new Array(168).fill(0) } })
    expect(w.findAll('[data-cell]')).toHaveLength(168)
  })

  it('周一开头：存储索引 34（周一10点）落在显示行0、10点格', () => {
    const data = new Array(168).fill(0); data[34] = 5 // getDay 1 *24+10
    const w = mount(WeekHourHeatmap, { props: { weekHour: data } })
    const cell = w.find('[data-cell="0-10"]') // row0=周一
    expect(cell.attributes('title')).toContain('5')
  })

  it('周日（存储索引 0..23）排到显示最后一行 row6', () => {
    const data = new Array(168).fill(0); data[10] = 7 // getDay 0(周日) 10点
    const w = mount(WeekHourHeatmap, { props: { weekHour: data } })
    expect(w.find('[data-cell="6-10"]').attributes('title')).toContain('7')
  })
})
