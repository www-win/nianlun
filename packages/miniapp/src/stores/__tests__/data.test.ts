import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'
import { makeRawStore } from '../../adapters/rawStore'
import { createDataStore } from '../data'
import type { Friend, ReportData } from '@nianlun/core'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}

// 内存 rawStore：供测试注入，替代真机 wx 文件系统实现。
function fakeRawStore() {
  const files = new Map<string, string>()
  const dir = '/raw'
  return makeRawStore({
    ensureDir: () => {},
    writeFile: (p, d) => { files.set(p, d) },
    readFile: (p) => { const v = files.get(p); if (v == null) throw new Error('ENOENT'); return v },
    readdir: (d) => [...files.keys()].filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1)),
    size: (p) => (files.get(p) ?? '').length,
    unlink: (p) => { files.delete(p) },
  }, dir)
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

  it('updateFriend 设置与清除 userEdited.mbti', async () => {
    const s = memStorage()
    const d = createDataStore(s)()
    await d.setData([FRIEND], REPORT)
    await d.updateFriend('f1', { mbti: 'INTJ' })
    expect(d.friends.find((f) => f.id === 'f1')!.userEdited.mbti).toBe('INTJ')

    await d.updateFriend('f1', { mbti: null })
    expect(d.friends.find((f) => f.id === 'f1')!.userEdited.mbti).toBeUndefined()
  })

  it('clear 清空 friends/report 并调用 storage.clearAll 与 rawStore.clear', async () => {
    const s = memStorage()
    const rs = fakeRawStore()
    const clearAllSpy = vi.spyOn(s, 'clearAll')
    const rawClearSpy = vi.spyOn(rs, 'clear')
    const d = createDataStore(s, rs)()
    await d.setData([FRIEND], REPORT)
    expect(d.hasData).toBe(true)
    await d.clear()
    expect(d.hasData).toBe(false)
    expect(d.friends).toEqual([])
    expect(d.report).toBe(null)
    expect(clearAllSpy).toHaveBeenCalledTimes(1)
    expect(rawClearSpy).toHaveBeenCalledTimes(1)
  })

  it('setData 后触发 onSaved 回调', async () => {
    const spy = vi.fn()
    const useData = createDataStore(memStorage(), fakeRawStore())
    const d = useData()
    d.setOnSaved(spy)
    await d.setData([FRIEND], REPORT)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('updateFriend 后触发 onSaved 回调', async () => {
    const spy = vi.fn()
    const useData = createDataStore(memStorage(), fakeRawStore())
    const d = useData()
    await d.setData([FRIEND], REPORT)
    d.setOnSaved(spy)
    await d.updateFriend('f1', { alias: '小甲' })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('clear 不触发 onSaved 回调', async () => {
    const spy = vi.fn()
    const useData = createDataStore(memStorage(), fakeRawStore())
    const d = useData()
    await d.setData([FRIEND], REPORT)
    d.setOnSaved(spy)
    await d.clear()
    expect(spy).not.toHaveBeenCalled()
  })

  it('onSaved 回调抛错不影响保存', async () => {
    const s = memStorage()
    const useData = createDataStore(s, fakeRawStore())
    const d = useData()
    d.setOnSaved(() => { throw new Error('backup failed') })
    await expect(d.setData([FRIEND], REPORT)).resolves.toBeUndefined()
    expect(s.loadFriends()[0].id).toBe('f1')
  })
})
