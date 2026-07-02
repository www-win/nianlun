import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts,
} from '@nianlun/core'
import type { Friend, FriendSuggestion } from '@nianlun/core'
import { parseLocal, type LocalFile } from '../adapters/parseLocal'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'
import { aiClient } from '../adapters/aiClient'
import { samples as defaultSamples } from '../adapters/samples'
import { analyzeRolesForNew } from '../adapters/roleAnalysis'

type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
  suggest?: (f: Friend, s: string[]) => Promise<FriendSuggestion>
  loadSamples?: (id: string) => string[]
}
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export function createImportStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const storage = deps.storage ?? defaultStorage
  const suggest = deps.suggest ?? aiClient.suggestFriend
  const loadSamples = deps.loadSamples ?? defaultSamples.loadSamplesFor
  return defineStore('import', () => {
    const status = ref<ImportStatus>('idle')
    const progress = ref(0)
    const warnings = ref<string[]>([])
    const error = ref('')
    const analyzing = ref<{ done: number; total: number } | null>(null)

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
          // 导入成功后：对新好友（不在已分析集合）自动推断关系/职务并写入
          const updatedIds = await analyzeRolesForNew({
            friends: named,
            analyzedIds: storage.loadAnalyzedIds(),
            loadSamples,
            suggest,
            applyRole: (id, patch) => data.updateFriend(id, patch),
            onProgress: (done, total) => { analyzing.value = total ? { done, total } : null },
          })
          storage.saveAnalyzedIds(updatedIds)
          analyzing.value = null
          // 好友详情页「最近一个月」数据：按 id 合并，新批次覆盖同 id 旧值。
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
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
        analyzing.value = null
      }
    }
    function reset() { status.value = 'idle'; progress.value = 0; warnings.value = []; error.value = ''; analyzing.value = null }
    return { status, progress, warnings, error, analyzing, run, reset }
  })
}

export const useImportStore = createImportStore()
