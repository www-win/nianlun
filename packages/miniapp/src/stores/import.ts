import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts,
} from '@nianlun/core'
import type { Friend, FriendSuggestion } from '@nianlun/core'
import { parseLocal, type LocalFile } from '../adapters/parseLocal'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'
import { rawStore as defaultRawStore, makeRawStore } from '../adapters/rawStore'
import { aiClient } from '../adapters/aiClient'
import { samples as defaultSamples } from '../adapters/samples'
import { analyzeRolesForNew, type AnalyzeRolesResult } from '../adapters/roleAnalysis'

/** 把批量分析统计拼成一条导入页提示，让失败/无结果现形。全 0（无新好友）时返回空数组。 */
function analysisWarn(r: AnalyzeRolesResult): string[] {
  const { succeeded, failed, empty, firstError } = r
  if (!succeeded && !failed && !empty) return []
  const parts = [`已自动分析 ${succeeded} 位好友的关系/职务`]
  if (empty) parts.push(`${empty} 位无结果`)
  if (failed) parts.push(`${failed} 位失败${firstError ? '：' + firstError : ''}`)
  return [parts.join('；')]
}

/** 只自动分析全年消息数达到该门槛的好友，过滤上千联系人里的长尾噪声。 */
const ROLE_MIN_MSGS = 20

type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
  rawStore?: ReturnType<typeof makeRawStore>
  suggest?: (f: Friend, s: string[]) => Promise<FriendSuggestion>
  loadSamples?: (id: string) => string[]
}
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export function createImportStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const storage = deps.storage ?? defaultStorage
  const rawStore = deps.rawStore ?? defaultRawStore
  const suggest = deps.suggest ?? aiClient.suggestFriend
  const loadSamples = deps.loadSamples ?? defaultSamples.loadSamplesFor
  return defineStore('import', () => {
    const status = ref<ImportStatus>('idle')
    const progress = ref(0)
    const warnings = ref<string[]>([])
    const error = ref('')
    const analyzing = ref<{ done: number; total: number } | null>(null)
    // 本机已留存的原始聊天文件数（供导入页显示「已留存原文 X 个」，真机联调可见）。
    const rawSavedCount = ref(0)

    /**
     * 对「消息数达标且不在已分析集合」的好友后台串行推断关系/职务并写入。
     * 供「导入完成后」与「App 启动 hydrate 后」共用。重入保护避免并发重复。
     */
    async function analyzePendingRoles(): Promise<void> {
      if (analyzing.value) return                              // 重入保护
      try {
        const d = useData()
        const analyzedSet = new Set(storage.loadAnalyzedIds())
        const candidates = d.friends.filter(
          (f) => f.msgCount >= ROLE_MIN_MSGS && !analyzedSet.has(f.id),
        )
        if (candidates.length === 0) return
        analyzing.value = { done: 0, total: candidates.length }  // await 前置位守卫
        const result = await analyzeRolesForNew({
          friends: candidates,
          analyzedIds: [...analyzedSet],
          loadSamples,
          suggest,
          applyRole: (id, patch) => d.updateFriend(id, patch),
          onProgress: (done, total) => { analyzing.value = { done, total } },
        })
        storage.saveAnalyzedIds(result.analyzedIds)
        warnings.value = [...warnings.value, ...analysisWarn(result)]
      } catch (e) {
        // 自动分析属后台增补，任何异常都不应影响已完成的导入/启动
        warnings.value = [...warnings.value, `自动分析未完成：${(e as Error).message}`]
      } finally {
        analyzing.value = null
      }
    }

    async function run(files: LocalFile[], year: number) {
      status.value = 'parsing'; progress.value = 0; warnings.value = []; error.value = ''; rawSavedCount.value = 0
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
          // 好友详情页「最近一个月」数据：按 id 合并，新批次覆盖同 id 旧值。
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
          warnings.value = [...outcome.warnings, ...contactWarn(appliedCount(named))]
          // 最后留存原文到文件系统：过滤公众号、写满即停，绝不阻断已完成的导入。
          try {
            const r = rawStore.appendFiles(chatFiles)
            rawSavedCount.value = rawStore.count()
            if (r.skipped > 0) {
              warnings.value = [...warnings.value, `原文留存已达存储上限，已保留 ${r.saved} 个、跳过 ${r.skipped} 个`]
            }
          } catch (e) {
            warnings.value = [...warnings.value, `原文留存未完成：${(e as Error).message}`]
          }
          status.value = 'done'                 // 导入完成：好友列表立即可用
          await analyzePendingRoles()            // 之后后台补分析（达标未分析的），UI 已解锁
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
    function reset() { status.value = 'idle'; progress.value = 0; warnings.value = []; error.value = ''; analyzing.value = null; rawSavedCount.value = 0 }
    return { status, progress, warnings, error, analyzing, rawSavedCount, run, analyzePendingRoles, reset }
  })
}

export const useImportStore = createImportStore()
