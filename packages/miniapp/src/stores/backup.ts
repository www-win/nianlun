import { defineStore } from 'pinia'
import { ref } from 'vue'

type CloudBackup = { backup(): Promise<{ bytes: number }>; restore(): Promise<boolean> }
type LastAtStore = { saveLastBackupAt(t: number): void; loadLastBackupAt(): number | null }
type ScheduleFn = (fn: () => void) => void

export interface BackupDeps {
  cloudBackup: CloudBackup
  storage: LastAtStore
  /** 防抖调度器；默认 setTimeout(delayMs)。测试注入可控实现。 */
  schedule?: ScheduleFn
  delayMs?: number
}

export function createBackupStore(deps: BackupDeps) {
  const delayMs = deps.delayMs ?? 5000
  let timer: ReturnType<typeof setTimeout> | null = null
  const schedule: ScheduleFn = deps.schedule ?? ((fn) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, delayMs)
  })

  return defineStore('backup', () => {
    const status = ref<'idle' | 'backing' | 'restoring' | 'error'>('idle')
    const lastBackupAt = ref<number | null>(deps.storage.loadLastBackupAt())
    const error = ref('')

    async function doBackup(): Promise<void> {
      if (status.value === 'backing' || status.value === 'restoring') return // 重入保护
      status.value = 'backing'; error.value = ''
      try {
        await deps.cloudBackup.backup()
        const now = Date.now()
        deps.storage.saveLastBackupAt(now); lastBackupAt.value = now
        status.value = 'idle'
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e); status.value = 'error'
      }
    }

    function scheduleBackup(): void { schedule(() => { void doBackup() }) }
    async function backupNow(): Promise<void> { await doBackup() }

    async function restoreNow(): Promise<boolean> {
      if (status.value === 'backing' || status.value === 'restoring') return false
      status.value = 'restoring'; error.value = ''
      try {
        const ok = await deps.cloudBackup.restore()
        status.value = 'idle'
        return ok
      } catch (e) {
        error.value = e instanceof Error ? e.message : String(e); status.value = 'error'
        return false
      }
    }

    return { status, lastBackupAt, error, scheduleBackup, backupNow, restoreNow }
  })
}

import { cloudBackup } from '../adapters/cloudBackup'
import { storage } from '../adapters/storage'
export const useBackupStore = createBackupStore({ cloudBackup, storage })
