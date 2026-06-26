import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useSettingsStore', () => {
  it('默认未配置，模型有默认值', () => {
    const s = useSettingsStore()
    expect(s.isConfigured).toBe(false)
    expect(s.model).toBe('claude-opus-4-8')
  })

  it('update 写入并标记已配置', () => {
    const s = useSettingsStore()
    s.update({ baseUrl: 'https://x', apiKey: 'k' })
    expect(s.isConfigured).toBe(true)
    expect(JSON.parse(localStorage.getItem('nianlun.ai.settings')!).baseUrl).toBe('https://x')
  })

  it('hydrate 从 localStorage 恢复', () => {
    localStorage.setItem('nianlun.ai.settings', JSON.stringify({ baseUrl: 'https://y', apiKey: 'k2', model: 'm' }))
    const s = useSettingsStore()
    s.hydrate()
    expect(s.baseUrl).toBe('https://y')
    expect(s.model).toBe('m')
  })
})
