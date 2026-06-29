import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HourBars from '../HourBars.vue'

describe('HourBars', () => {
  it('渲染 24 根柱子', () => {
    const hourly = Array.from({ length: 24 }, (_, i) => i)
    const w = mount(HourBars, { props: { hourly } })
    expect(w.findAll('[data-h]')).toHaveLength(24)
  })

  it('峰值柱子高度最高', () => {
    const hourly = new Array(24).fill(0); hourly[10] = 100
    const w = mount(HourBars, { props: { hourly } })
    const bar = w.find('[data-h="10"]')
    expect(bar.attributes('style')).toContain('height: 100%')
  })
})
