import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from '../App.vue'
import Overview from '../pages/Overview.vue'

describe('App shell', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('renders the overview route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Overview },
        ...['/import', '/friends', '/network', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })),
      ],
    })
    router.push('/')
    await router.isReady()
    const wrapper = mount(App, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('概览')
  })
})
