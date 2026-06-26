import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useImportStore } from '../import'
import { useDataStore } from '../data'
import { clearAll } from '../../adapters/storage'

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

  it('样本不持久化：刷新（新 store 实例）后样本为空', async () => {
    const imp = useImportStore()
    const file = new File(['x'], 'a.txt', { type: 'text/plain' })
    await imp.run([file], 2025)
    // 模拟刷新：重建 pinia，import store 重新实例化
    setActivePinia(createPinia())
    const fresh = useImportStore()
    expect(fresh.samplesFor('周彤')).toEqual([])
  })
})
