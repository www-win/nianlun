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
  // 聊天样本仅存内存（键为 friend id），绝不写入 IndexedDB；刷新即失。
  const friendSamples = ref<Record<string, string[]>>({})

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
      // 合并本次样本进内存（后到的覆盖同 id 的旧样本），不持久化。
      friendSamples.value = { ...friendSamples.value, ...outcome.samples }
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

  function samplesFor(friendId: string): string[] {
    return friendSamples.value[friendId] ?? []
  }

  return { status, progress, warnings, error, friendSamples, run, reset, samplesFor }
})
