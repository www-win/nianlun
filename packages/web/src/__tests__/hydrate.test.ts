import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDataStore } from '../stores/data'
import { saveFriends, saveReport, clearAll } from '../adapters/storage'
import { createFriend } from '@nianlun/core'
import type { ReportData } from '@nianlun/core'

const report: ReportData = {
  year: 2025, totalMessages: 7, friendCount: 1, activeDays: 1,
  topContacts: [], latestMessage: null, keywords: [], relationBreakdown: [],
}

describe('startup hydrate', () => {
  beforeEach(async () => { setActivePinia(createPinia()); await clearAll() })

  it('a fresh store reflects previously persisted data after hydrate', async () => {
    await saveFriends([createFriend('周彤', '周彤')])
    await saveReport(report)
    const store = useDataStore()
    expect(store.hasData).toBe(false) // before hydrate
    await store.hydrate()
    expect(store.hasData).toBe(true)
    expect(store.report?.totalMessages).toBe(7)
  })
})
