import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mergeFriends } from '@nianlun/core'
import { readTextFile } from '../adapters/fileReader'
import { parseFiles } from '../adapters/parseClient'
import { useDataStore } from './data'

export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export const useImportStore = defineStore('import', () => {
  const status = ref<ImportStatus>('idle')
  const progress = ref(0)
  const warnings = ref<string[]>([])
  const error = ref('')

  async function run(files: File[], year: number) {
    status.value = 'parsing'
    progress.value = 0
    warnings.value = []
    error.value = ''
    try {
      const read = await Promise.all(files.map(readTextFile))
      const outcome = await parseFiles(read, year, { onProgress: (p) => { progress.value = p } })
      const data = useDataStore()
      // 合并进已有好友,保留用户编辑
      const merged = mergeFriends(data.friends, outcome.friends)
      await data.setData(merged.friends, outcome.report)
      warnings.value = outcome.warnings
      status.value = 'done'
    } catch (e) {
      error.value = (e as Error).message
      status.value = 'error'
    }
  }

  function reset() {
    status.value = 'idle'
    progress.value = 0
    warnings.value = []
    error.value = ''
  }

  return { status, progress, warnings, error, run, reset }
})
