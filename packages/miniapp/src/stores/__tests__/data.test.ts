import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'
import { createDataStore } from '../data'
import type { Friend, ReportData } from '@nianlun/core'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}
const FRIEND = { id: 'f1', name: '张三', rel: '其他', role: '', alias: '', userEdited: {}, msgCount: 1, monthly: [], sentRatio: 0, peakPeriod: '', maxStreak: 0, firstContact: 0, lastContact: 0 } as unknown as Friend
const REPORT = { year: 2025 } as unknown as ReportData

describe('data store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('setData 写入并 hasData 为真', async () => {
    const useData = createDataStore(memStorage())
    const d = useData()
    await d.setData([FRIEND], REPORT)
    expect(d.hasData).toBe(true)
    expect(d.report?.year).toBe(2025)
  })

  it('hydrate 从存储恢复', async () => {
    const s = memStorage()
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    const d = createDataStore(s)()
    await d.hydrate()
    expect(d.friends[0].id).toBe('f1')
  })

  it('updateFriend 记录 userEdited 并落盘', async () => {
    const s = memStorage()
    const d = createDataStore(s)()
    await d.setData([FRIEND], REPORT)
    await d.updateFriend('f1', { rel: '同事', role: '产品经理' })
    expect(d.friends[0].rel).toBe('同事')
    expect(d.friends[0].userEdited.rel).toBe('同事')
    expect(s.loadFriends()[0].role).toBe('产品经理')
  })
})
