import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { saveFriends, loadFriends, saveReport, loadReport, saveSamples, loadSamples, clearAll } from '../storage'
import { createFriend } from '@nianlun/core'
import type { ReportData } from '@nianlun/core'

describe('storage adapter', () => {
  beforeEach(async () => { await clearAll() })

  it('saves and loads friends', async () => {
    const f = createFriend('周彤', '周彤')
    f.role = '大学室友'
    await saveFriends([f])
    const loaded = await loadFriends()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].role).toBe('大学室友')
  })

  it('returns [] when no friends stored', async () => {
    expect(await loadFriends()).toEqual([])
  })

  it('saves and loads the report', async () => {
    const report: ReportData = {
      year: 2025, totalMessages: 100, friendCount: 1, activeDays: 10,
      topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [],
    }
    await saveReport(report)
    expect((await loadReport())?.totalMessages).toBe(100)
  })

  it('returns null when no report stored', async () => {
    expect(await loadReport()).toBeNull()
  })

  it('saves and loads friend samples', async () => {
    await saveSamples({ '周彤': ['对方：在吗', '我：在的'] })
    expect(await loadSamples()).toEqual({ '周彤': ['对方：在吗', '我：在的'] })
  })

  it('returns {} when no samples stored', async () => {
    expect(await loadSamples()).toEqual({})
  })

  it('clearAll wipes everything (incl. samples)', async () => {
    await saveFriends([createFriend('a', 'a')])
    await saveSamples({ a: ['x'] })
    await clearAll()
    expect(await loadFriends()).toEqual([])
    expect(await loadSamples()).toEqual({})
  })
})
