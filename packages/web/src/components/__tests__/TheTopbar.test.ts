import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import TheTopbar from '../TheTopbar.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/import', '/friends', '/network', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
  })
}

describe('TheTopbar', () => {
  it('renders the five nav links to the right routes', async () => {
    const router = makeRouter()
    router.push('/'); await router.isReady()
    const wrapper = mount(TheTopbar, { global: { plugins: [router] } })
    const hrefs = wrapper.findAll('nav a').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/', '/import', '/friends', '/network', '/report'])
    expect(wrapper.text()).toContain('概览')
    expect(wrapper.text()).toContain('年度报告')
  })
})
