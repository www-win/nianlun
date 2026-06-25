import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import FriendsPage from '../FriendsPage.vue'
import { useDataStore } from '../../stores/data'
import { createFriend } from '@nianlun/core'

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: ['/', '/import', '/friends', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })) })
}
function seed() {
  const data = useDataStore()
  const a = createFriend('周彤', '周彤'); a.rel = '挚友'; a.role = '大学室友'; a.msgCount = 9670
  const b = createFriend('陈志远', '陈志远'); b.rel = '同事'; b.msgCount = 12880
  data.friends = [a, b]
  data.report = { year: 2025, totalMessages: 22550, friendCount: 2, activeDays: 100, topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] }
  return data
}

describe('FriendsPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('shows an empty state with a link to import when no data', async () => {
    const router = makeRouter(); router.push('/friends'); await router.isReady()
    const wrapper = mount(FriendsPage, { global: { plugins: [router] } })
    expect(wrapper.text()).toMatch(/还没有数据|导入/)
    expect(wrapper.findAll('a').map((a) => a.attributes('href'))).toContain('/import')
  })

  it('renders one row per friend from the store', async () => {
    const router = makeRouter(); router.push('/friends'); await router.isReady()
    seed()
    const wrapper = mount(FriendsPage, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('周彤')
    expect(wrapper.text()).toContain('陈志远')
    expect(wrapper.findAll('tbody tr').length).toBe(2)
  })

  it('search filters rows', async () => {
    const router = makeRouter(); router.push('/friends'); await router.isReady()
    seed()
    const wrapper = mount(FriendsPage, { global: { plugins: [router] } })
    await wrapper.find('input[type="search"]').setValue('周彤')
    expect(wrapper.findAll('tbody tr').length).toBe(1)
    expect(wrapper.text()).toContain('周彤')
  })
})
