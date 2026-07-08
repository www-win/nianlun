import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createBackupStore } from '../backup'

function fakeCloud() {
  return { backup: vi.fn(async () => ({ bytes: 10 })), restore: vi.fn(async () => true) }
}
function fakeStorage() {
  let ts: number | null = null
  return { saveLastBackupAt: (t: number) => { ts = t }, loadLastBackupAt: () => ts }
}
/** 手动可控的防抖：记录回调，flush 时执行。 */
function manualSchedule() {
  let pending: (() => void) | null = null
  return { schedule: (fn: () => void) => { pending = fn }, run: () => { const p = pending; pending = null; p?.() } }
}

describe('backup store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('scheduleBackup 多次只在 flush 后备份一次', async () => {
    const cloud = fakeCloud(); const sched = manualSchedule()
    const useStore = createBackupStore({ cloudBackup: cloud, storage: fakeStorage(), schedule: sched.schedule })
    const s = useStore()
    s.scheduleBackup(); s.scheduleBackup(); s.scheduleBackup()
    expect(cloud.backup).not.toHaveBeenCalled()
    sched.run(); await Promise.resolve(); await Promise.resolve()
    expect(cloud.backup).toHaveBeenCalledTimes(1)
  })

  it('backupNow 成功后更新 lastBackupAt', async () => {
    const cloud = fakeCloud(); const storage = fakeStorage()
    const useStore = createBackupStore({ cloudBackup: cloud, storage, schedule: (fn) => fn() })
    const s = useStore()
    await s.backupNow()
    expect(storage.loadLastBackupAt()).not.toBeNull()
    expect(s.status).toBe('idle')
  })

  it('备份进行中，再次 backupNow 被重入保护忽略', async () => {
    let release: () => void = () => {}
    const cloud = { backup: vi.fn(() => new Promise<{ bytes: number }>((r) => { release = () => r({ bytes: 1 }) })), restore: vi.fn() }
    const useStore = createBackupStore({ cloudBackup: cloud as any, storage: fakeStorage(), schedule: (fn) => fn() })
    const s = useStore()
    const p1 = s.backupNow()
    const p2 = s.backupNow() // 应被忽略
    release(); await p1; await p2
    expect(cloud.backup).toHaveBeenCalledTimes(1)
  })

  it('restoreNow 云端无备份返回 false，不报错', async () => {
    const cloud = { backup: vi.fn(), restore: vi.fn(async () => false) }
    const useStore = createBackupStore({ cloudBackup: cloud as any, storage: fakeStorage(), schedule: (fn) => fn() })
    const s = useStore()
    expect(await s.restoreNow()).toBe(false)
    expect(s.status).toBe('idle')
  })
})
