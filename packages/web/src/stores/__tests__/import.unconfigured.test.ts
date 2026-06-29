import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportStore } from '../import'
import { clearAll } from '../../adapters/storage'

vi.mock('../../adapters/parseClient', () => ({
  parseFiles: vi.fn(async (_files, _year, opts) => {
    opts?.onProgress?.(1)
    return {
      friends: [],
      report: { year: 2025, totalMessages: 0, friendCount: 0, activeDays: 0,
        topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] },
      warnings: [],
      samples: {},
    }
  }),
}))

vi.mock('../../adapters/imageOcr', () => ({
  isImageFile: vi.fn((f: File) => f.name.endsWith('.png')),
  ocrImage: vi.fn(async () => { throw new Error('should not be called') }),
}))

vi.mock('../settings', () => ({
  useSettingsStore: vi.fn(() => ({
    isConfigured: false,
    baseUrl: '',
    apiKey: '',
    model: 'claude-opus-4-8',
  })),
}))

describe('importStore — AI 未配置', () => {
  beforeEach(async () => { setActivePinia(createPinia()); await clearAll() })

  it('含图片但 AI 未配置时阻断并给出指向设置的错误', async () => {
    const imp = useImportStore()
    const img = new File([''], 'screen.png', { type: 'image/png' })
    await imp.run([img], 2025)
    expect(imp.status).toBe('error')
    expect(imp.error).toContain('设置')
  })
})
