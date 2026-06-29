import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportStore } from '../import'
import { useDataStore } from '../data'
import { clearAll, saveSamples, loadSamples } from '../../adapters/storage'

// stub parseClient so no real worker is needed
vi.mock('../../adapters/parseClient', () => ({
  parseFiles: vi.fn(async (_files, _year, opts) => {
    opts?.onProgress?.(1)
    return {
      friends: [{ id: '周彤', name: '周彤', rel: '其他', role: '', alias: '', msgCount: 5,
        sentRatio: 0, firstContact: 0, lastContact: 0, peakPeriod: '', maxStreak: 0,
        monthly: new Array(12).fill(0), userEdited: {} }],
      report: { year: 2025, totalMessages: 5, friendCount: 1, activeDays: 1,
        topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [] },
      warnings: ['a.txt: 1 行无法识别'],
      samples: { '周彤': ['对方：在吗', '我：在的'] },
    }
  }),
}))

vi.mock('../../adapters/imageOcr', () => ({
  isImageFile: vi.fn((f: File) => f.name.endsWith('.png')),
  ocrImage: vi.fn(async (f: File) => {
    if (f.name === 'bad.png') throw new Error('OCR 失败')
    return { name: f.name, content: '2024-01-01 10:00:00 我\n你好' }
  }),
}))

vi.mock('../settings', () => ({
  useSettingsStore: vi.fn(() => ({
    isConfigured: true,
    baseUrl: '/__ai',
    apiKey: 'test-key',
    model: 'claude-opus-4-8',
  })),
}))

describe('importStore', () => {
  beforeEach(async () => { setActivePinia(createPinia()); await clearAll() })

  it('run parses files and pushes data into dataStore', async () => {
    const imp = useImportStore()
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    await imp.run([file], 2025)
    expect(imp.status).toBe('done')
    expect(imp.progress).toBe(1)
    expect(imp.warnings).toHaveLength(1)
    const data = useDataStore()
    expect(data.friends).toHaveLength(1)
    expect(data.hasData).toBe(true)
  })

  it('run 后样本存于内存，可经 samplesFor 读取', async () => {
    const imp = useImportStore()
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    await imp.run([file], 2025)
    expect(imp.samplesFor('周彤')).toEqual(['对方：在吗', '我：在的'])
    expect(imp.samplesFor('不存在')).toEqual([])
  })

  it('导入后样本持久化到 IndexedDB', async () => {
    const imp = useImportStore()
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    await imp.run([file], 2025)
    expect(await loadSamples()).toEqual({ '周彤': ['对方：在吗', '我：在的'] })
  })

  it('hydrateSamples 从 IndexedDB 恢复样本（刷新后 AI 建议仍可用）', async () => {
    await saveSamples({ '周彤': ['对方：在吗'] })
    // 模拟刷新：重建 pinia，import store 重新实例化后注水
    setActivePinia(createPinia())
    const fresh = useImportStore()
    expect(fresh.samplesFor('周彤')).toEqual([]) // 注水前为空
    await fresh.hydrateSamples()
    expect(fresh.samplesFor('周彤')).toEqual(['对方：在吗'])
  })

  it('OCR 失败的图片只产生 warning，不中断整体导入', async () => {
    const imp = useImportStore()
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' })
    const bad = new File([''], 'bad.png', { type: 'image/png' })
    await imp.run([txt, bad], 2025)
    expect(imp.status).toBe('done')
    expect(imp.warnings.some((w) => w.includes('bad.png'))).toBe(true)
  })

  const contactsJson = JSON.stringify([
    { username: '周彤', user_name: '周彤', remark: '周老师', nick_name: '彤彤', alias: '', local_type: 1 },
  ])

  it('聊天文件 + contacts.json 一起导入：好友显示真名', async () => {
    const imp = useImportStore()
    const chat = new File(['x'], 'a.txt', { type: 'text/plain' })
    const contacts = new File([contactsJson], 'contacts.json', { type: 'application/json' })
    await imp.run([chat, contacts], 2025)
    expect(imp.status).toBe('done')
    const data = useDataStore()
    expect(data.friends).toHaveLength(1)
    expect(data.friends[0].name).toBe('周老师')          // remark 优先
    expect(data.friends[0].userEdited.name).toBe('周老师') // 记入 userEdited
  })

  it('只导 contacts.json：给已有好友套名', async () => {
    const imp = useImportStore()
    await imp.run([new File(['x'], 'a.txt', { type: 'text/plain' })], 2025) // 先有好友 周彤(name=周彤)
    const data = useDataStore()
    expect(data.friends[0].name).toBe('周彤')
    const contacts = new File([contactsJson], 'contacts.json', { type: 'application/json' })
    await imp.run([contacts], 2025)
    expect(imp.status).toBe('done')
    expect(data.friends[0].name).toBe('周老师')
  })
})
