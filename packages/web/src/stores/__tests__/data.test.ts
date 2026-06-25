import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../data'
import { clearAll, loadFriends } from '../../adapters/storage'
import { createFriend } from '@nianlun/core'
import type { ReportData } from '@nianlun/core'

const report: ReportData = {
  year: 2025, totalMessages: 1, friendCount: 1, activeDays: 1,
  topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [],
}

describe('dataStore', () => {
  beforeEach(async () => { setActivePinia(createPinia()); await clearAll() })

  it('setData persists and updates state', async () => {
    const store = useDataStore()
    await store.setData([createFriend('周彤', '周彤')], report)
    expect(store.hasData).toBe(true)
    expect(await loadFriends()).toHaveLength(1)
  })

  it('updateFriend records userEdited and persists', async () => {
    const store = useDataStore()
    await store.setData([createFriend('周彤', '周彤')], report)
    await store.updateFriend('周彤', { role: '大学室友', rel: '挚友' })
    expect(store.friends[0].role).toBe('大学室友')
    expect(store.friends[0].userEdited.role).toBe('大学室友')
    expect((await loadFriends())[0].userEdited.rel).toBe('挚友')
  })

  it('clear wipes state and storage', async () => {
    const store = useDataStore()
    await store.setData([createFriend('周彤', '周彤')], report)
    await store.clear()
    expect(store.hasData).toBe(false)
    expect(await loadFriends()).toEqual([])
  })

  it('hydrate loads persisted data into state', async () => {
    const seed = useDataStore()
    await seed.setData([createFriend('周彤', '周彤')], report)
    setActivePinia(createPinia())
    const store = useDataStore()
    await store.hydrate()
    expect(store.friends).toHaveLength(1)
    expect(store.report?.totalMessages).toBe(1)
  })
})
