import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mergeFriends } from '@nianlun/core'
import { parseLocal, type LocalFile } from '../adapters/parseLocal'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'

type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
}
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export function createImportStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const storage = deps.storage ?? defaultStorage
  return defineStore('import', () => {
    const status = ref<ImportStatus>('idle')
    const progress = ref(0)
    const warnings = ref<string[]>([])
    const error = ref('')

    async function run(files: LocalFile[], year: number) {
      status.value = 'parsing'; progress.value = 0; warnings.value = []; error.value = ''
      try {
        const data = useData()
        const prevReport = data.report
        const outcome = parseLocal(files, year, (p) => { progress.value = p })
        const merged = mergeFriends(data.friends, outcome.friends)
        // 报告的计数维度从「合并后的全部好友」重算，保证概览/报告与好友列表一致，
        // 并且一次「没解析出聊天记录」的导入不会用空报告清零已有数据。
        // activeDays/最新消息无法跨次精确并集，取已有报告与本次的较优值。
        const report = {
          ...outcome.report,
          year,
          friendCount: merged.friends.length,
          totalMessages: merged.friends.reduce((sum, f) => sum + (f.msgCount || 0), 0),
          activeDays: Math.max(prevReport?.activeDays ?? 0, outcome.report.activeDays),
        }
        await data.setData(merged.friends, report)
        const prevSamples = storage.loadSamples()
        storage.saveSamples({ ...prevSamples, ...outcome.samples })
        warnings.value = outcome.warnings
        status.value = 'done'
      } catch (e) {
        error.value = (e as Error).message
        status.value = 'error'
      }
    }
    function reset() { status.value = 'idle'; progress.value = 0; warnings.value = []; error.value = '' }
    return { status, progress, warnings, error, run, reset }
  })
}

export const useImportStore = createImportStore()
