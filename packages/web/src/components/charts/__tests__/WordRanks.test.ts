import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WordRanks from '../WordRanks.vue'

describe('WordRanks', () => {
  it('每个词一行，显示词与次数', () => {
    const w = mount(WordRanks, { props: { keywords: [{ word: '开会', count: 5 }, { word: '吃饭', count: 2 }] } })
    expect(w.findAll('[data-word]')).toHaveLength(2)
    expect(w.text()).toContain('开会')
    expect(w.text()).toContain('5')
  })

  it('空时显示占位', () => {
    const w = mount(WordRanks, { props: { keywords: [] } })
    expect(w.text()).toMatch(/暂无|没有/)
  })
})
