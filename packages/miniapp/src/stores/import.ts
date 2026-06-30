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
        const outcome = parseLocal(files, year, (p) => { progress.value = p })
        const merged = mergeFriends(data.friends, outcome.friends)
        await data.setData(merged.friends, outcome.report)
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
