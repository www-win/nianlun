import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts,
} from '@nianlun/core'
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

        // 分流：welive 联系人对照表（contacts.json）vs 聊天记录文件
        const isContacts = (f: LocalFile) => isWeliveContacts(f.content.slice(0, 2000))
        const contactNames = files.filter(isContacts).flatMap((f) => parseWeliveContacts(f.content))
        const chatFiles = files.filter((f) => !isContacts(f))

        const appliedCount = (fs: { id: string }[]) => {
          const ids = new Set(contactNames.map((n) => n.id))
          return fs.filter((f) => ids.has(f.id)).length
        }
        const contactWarn = (n: number) => (contactNames.length ? [`已套用联系人名字 ${n} 个`] : [])

        if (chatFiles.length) {
          const outcome = parseLocal(chatFiles, year, (p) => { progress.value = p })
          // 合并好友 → 套用联系人真名（无联系人则 no-op）
          const merged = mergeFriends(data.friends, outcome.friends).friends
          const named = applyContactNames(merged, contactNames)
          // 报告计数从套名后的全部好友重算，保证概览/报告与好友列表一致、空导入不清零。
          const report = {
            ...outcome.report,
            year,
            friendCount: named.length,
            totalMessages: named.reduce((sum, f) => sum + (f.msgCount || 0), 0),
            activeDays: Math.max(prevReport?.activeDays ?? 0, outcome.report.activeDays),
          }
          await data.setData(named, report)
          const prevSamples = storage.loadSamples()
          storage.saveSamples({ ...prevSamples, ...outcome.samples })
          warnings.value = [...outcome.warnings, ...contactWarn(appliedCount(named))]
        } else if (contactNames.length) {
          // 只导入了 contacts.json：给已有好友套真名，报告不变
          if (!prevReport) {
            throw new Error('请先导入聊天记录，再导入联系人 contacts.json。')
          }
          const named = applyContactNames(data.friends, contactNames)
          await data.setData(named, prevReport)
          warnings.value = contactWarn(appliedCount(named))
        } else {
          warnings.value = ['未从所选文件解析到聊天记录或联系人。']
        }
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
