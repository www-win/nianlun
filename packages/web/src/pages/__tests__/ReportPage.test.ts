import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ReportPage from '../ReportPage.vue'
import { useDataStore } from '../../stores/data'
import { useUiStore } from '../../stores/ui'
import { createFriend } from '@nianlun/core'

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: ['/', '/import', '/friends', '/network', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })) })
}
function seed() {
  const data = useDataStore()
  const a = createFriend('周彤', '周彤'); a.msgCount = 9670
  data.friends = [a]
  data.report = { year: 2025, totalMessages: 87000, friendCount: 16, activeDays: 238,
    topContacts: [{ friendId: '周彤', msgCount: 9670 }], latestMessage: null, keywords: [],
    relationBreakdown: [{ rel: '挚友', percent: 100 }] }
}

describe('ReportPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows empty state with import link when no report', async () => {
    const router = makeRouter(); router.push('/report'); await router.isReady()
    const wrapper = mount(ReportPage, { global: { plugins: [router] } })
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toContain('/import')
  })

  it('renders report numbers and the friend count', async () => {
    const router = makeRouter(); router.push('/report'); await router.isReady()
    seed()
    const wrapper = mount(ReportPage, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('2025')
    expect(wrapper.text()).toContain('16')   // friendCount
    expect(wrapper.text()).toContain('238')  // activeDays
  })

  it('theme button updates the ui store and poster data-theme', async () => {
    const router = makeRouter(); router.push('/report'); await router.isReady()
    seed()
    const wrapper = mount(ReportPage, { global: { plugins: [router] } })
    const ui = useUiStore()
    await wrapper.find('[data-theme-btn="ink"]').trigger('click')
    expect(ui.reportTheme).toBe('ink')
    expect(wrapper.find('.poster').attributes('data-theme')).toBe('ink')
  })

  it('渲染全局时段柱状图与周×时热力图，并展示年度关键词', async () => {
    const data = useDataStore()
    const f = createFriend('A', 'A'); f.msgCount = 10; f.hourly[9] = 4; f.weekHour[34] = 4
    data.friends = [f]
    data.report = { year: 2025, totalMessages: 10, friendCount: 1, activeDays: 1, topContacts: [], latestMessage: null, keywords: [{ word: '开会', count: 4 }], relationBreakdown: [] }
    const router = makeRouter(); router.push('/report'); await router.isReady()
    const w = mount(ReportPage, { global: { plugins: [router] } })
    expect(w.findAll('[data-h]')).toHaveLength(24)      // HourBars
    expect(w.findAll('[data-cell]')).toHaveLength(168)  // 热力图
    expect(w.text()).toContain('开会')                   // 既有年度关键词区块
  })
})
