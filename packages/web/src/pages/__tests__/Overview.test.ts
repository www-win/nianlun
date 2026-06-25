import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import Overview from '../Overview.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/import', '/friends', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
  })
}

describe('Overview page', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('renders hero and step cards linking to import/friends/report', async () => {
    const router = makeRouter(); router.push('/'); await router.isReady()
    const wrapper = mount(Overview, { global: { plugins: [router] } })
    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain('/import')
    expect(hrefs).toContain('/friends')
    expect(hrefs).toContain('/report')
    expect(wrapper.text()).toContain('年轮')
  })
})
