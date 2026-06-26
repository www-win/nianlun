import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  // 让测试不受本地 .env 预置的 AI 接入信息影响
  vi.stubEnv('VITE_AI_BASE_URL', '')
  vi.stubEnv('VITE_AI_API_KEY', '')
  vi.stubEnv('VITE_AI_MODEL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
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
