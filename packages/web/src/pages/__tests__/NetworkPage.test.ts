import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import NetworkPage from '../NetworkPage.vue'
import { useDataStore } from '../../stores/data'
import type { Friend, Relation } from '@nianlun/core'

function makeFriend(id: string, rel: Relation, msgCount: number): Friend {
  return {
    id, name: id, alias: '', rel, role: '',
    firstContact: 0, lastContact: 0, msgCount, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: Array(12).fill(0),
    hourly: Array(24).fill(0), weekHour: Array(168).fill(0), keywords: [],
    userEdited: {},
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/import', '/friends', '/report', '/network'].map((p) => ({
      path: p, name: p === '/' ? 'overview' : p.slice(1), component: { template: '<div/>' },
    })),
  })
}

async function mountWith(friends: Friend[]) {
  const router = makeRouter(); router.push('/network'); await router.isReady()
  const store = useDataStore()
  store.friends = friends
  const wrapper = mount(NetworkPage, { global: { plugins: [router] } })
  return { wrapper, router }
}

describe('NetworkPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('无数据时显示去导入引导', async () => {
    const { wrapper } = await mountWith([])
    expect(wrapper.text()).toContain('还没有数据')
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/import')
    expect(wrapper.findAll('circle.node').length).toBe(0)
  })

  it('有数据时每个好友渲染一个节点', async () => {
    const { wrapper } = await mountWith([
      makeFriend('a', '家人', 10),
      makeFriend('b', '同事', 20),
      makeFriend('c', '同学', 30),
    ])
    expect(wrapper.findAll('circle.node').length).toBe(3)
  })

  it('点击图例隐藏对应关系的节点', async () => {
    const { wrapper } = await mountWith([
      makeFriend('a', '家人', 10),
      makeFriend('b', '家人', 20),
      makeFriend('c', '同事', 30),
    ])
    expect(wrapper.findAll('circle.node').length).toBe(3)
    // 找到「同事」图例按钮并点击
    const chip = wrapper.findAll('button.chip').find((b) => b.text().includes('同事'))!
    await chip.trigger('click')
    expect(wrapper.findAll('circle.node').length).toBe(2)
  })

  it('点击节点跳转到好友表并带 focus 查询参数', async () => {
    const { wrapper, router } = await mountWith([makeFriend('a', '家人', 10)])
    await wrapper.find('circle.node').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('friends')
    expect(router.currentRoute.value.query.focus).toBe('a')
  })
})
