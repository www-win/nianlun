import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ImportPage from '../ImportPage.vue'
import { useImportStore } from '../../stores/import'

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: ['/', '/import', '/friends', '/network', '/report'].map((p) => ({ path: p, component: { template: '<div/>' } })) })
}

describe('ImportPage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('selecting a file calls importStore.run', async () => {
    const router = makeRouter(); router.push('/import'); await router.isReady()
    const imp = useImportStore()
    const runSpy = vi.spyOn(imp, 'run').mockResolvedValue(undefined)
    const wrapper = mount(ImportPage, { global: { plugins: [router] } })
    const input = wrapper.find('input[type="file"]')
    const file = new File(['x'], 'chat.txt', { type: 'text/plain' })
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
    expect(runSpy).toHaveBeenCalled()
    expect((runSpy.mock.calls[0][0] as File[])[0].name).toBe('chat.txt')
  })

  it('shows parsing progress from the store', async () => {
    const router = makeRouter(); router.push('/import'); await router.isReady()
    const imp = useImportStore()
    imp.status = 'parsing'; imp.progress = 0.5
    const wrapper = mount(ImportPage, { global: { plugins: [router] } })
    await flushPromises()
    expect(wrapper.text()).toContain('50')
  })

  it('accepts image files and shows an upload-privacy notice', async () => {
    const router = makeRouter(); router.push('/import'); await router.isReady()
    const wrapper = mount(ImportPage, { global: { plugins: [router] } })
    const input = wrapper.find('input[type="file"]')
    expect(input.attributes('accept')).toContain('.png')
    expect(input.attributes('accept')).toContain('.jpg')
    expect(wrapper.text()).toContain('上传')
    expect(wrapper.text()).toContain('不再是纯本地处理')
  })
})
