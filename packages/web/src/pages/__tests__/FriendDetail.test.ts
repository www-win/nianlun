import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import FriendDetail from '../FriendDetail.vue'
import { useDataStore } from '../../stores/data'
import { createFriend } from '@nianlun/core'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/friends/:id', name: 'friend-detail', component: FriendDetail }],
  })
}

describe('FriendDetail', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('按 id 渲染好友与三图', async () => {
    const data = useDataStore()
    const f = createFriend('周彤', '周彤'); f.msgCount = 100; f.hourly[9] = 5
    f.keywords = [{ word: '开会', count: 3 }]
    data.friends = [f]
    const router = makeRouter(); router.push('/friends/周彤'); await router.isReady()
    const w = mount(FriendDetail, { global: { plugins: [router] } })
    expect(w.text()).toContain('周彤')
    expect(w.findAll('[data-h]')).toHaveLength(24)        // HourBars
    expect(w.findAll('[data-cell]')).toHaveLength(168)    // 热力图
    expect(w.text()).toContain('开会')                     // 词频
  })

  it('未知 id 显示空态', async () => {
    useDataStore().friends = []
    const router = makeRouter(); router.push('/friends/none'); await router.isReady()
    const w = mount(FriendDetail, { global: { plugins: [router] } })
    expect(w.text()).toMatch(/没有|未找到|不存在/)
  })
})
