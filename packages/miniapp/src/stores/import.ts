import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  mergeFriends, applyContactNames, parseWeliveContacts, isWeliveContacts,
  parseFile, mergeConversations, mergeStockPicks, friendReportFields,
} from '@nianlun/core'
import type { Friend, FriendSuggestion, Conversation, StockPick, ExtractCtx } from '@nianlun/core'
import { parseLocal, type LocalFile } from '../adapters/parseLocal'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'
import { aiClient } from '../adapters/aiClient'
import { samples as defaultSamples } from '../adapters/samples'
import { analyzeRolesForNew, type AnalyzeRolesResult } from '../adapters/roleAnalysis'
import { analyzeStocks as runAnalyzeStocks } from '../adapters/stockAnalysis'

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
  suggest?: (f: Friend, s: string[]) => Promise<FriendSuggestion>
  loadSamples?: (id: string) => string[]
  extractStocks?: (f: Friend, samples: string[], ctx: ExtractCtx) => Promise<StockPick[]>
}
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'
/** 导入子阶段：读取/解压 → 解析 → 聚合建报告。用于进度条形态与三步指示器。 */
export type ImportPhase = 'idle' | 'reading' | 'parsing' | 'aggregating'

/** 单个好友手动分析的结果状态。store 不触碰 uni，toast 交页面按此枚举处理。 */
export type AnalyzeOneStatus = 'ok' | 'empty' | 'error' | 'skipped'
export interface AnalyzeOneResult {
  status: AnalyzeOneStatus
  /** status==='error' 时的错误信息，供页面 toast。 */
  error?: string
}

export function createImportStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const storage = deps.storage ?? defaultStorage
  const suggest = deps.suggest ?? aiClient.suggestFriend
  const loadSamples = deps.loadSamples ?? defaultSamples.loadSamplesFor
  const extractStocks = deps.extractStocks ?? aiClient.extractStocks
  return defineStore('import', () => {
    const status = ref<ImportStatus>('idle')
    const progress = ref(0)
    const phase = ref<ImportPhase>('idle')
    const warnings = ref<string[]>([])
    const error = ref('')
    const analyzing = ref<{ done: number; total: number } | null>(null)
    const analyzingStocks = ref<{ done: number; total: number } | null>(null)
    const stocksSavedCount = ref(0)

    /** 页面在选文件/解压之前调用：让①读取阶段可见（此段无子进度，页面用动画条）。 */
    function beginReading() {
      status.value = 'parsing'
      phase.value = 'reading'
      progress.value = 0
      warnings.value = []
      error.value = ''
    }

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

    // 好友列表「手动分析」正在进行的好友 id（按钮 loading + 防重复点击）。替换新 Set 触发响应式。
    const analyzingIds = ref<Set<string>>(new Set())

    /**
     * 手动分析单个好友：推断关系/职务并写入。手动触发，不套用消息数门槛。
     * store 保持纯逻辑、不碰 uni；返回结果枚举，由页面 toast。重入保护（同一好友分析中返回 skipped）。
     */
    async function analyzeOne(id: string): Promise<AnalyzeOneResult> {
      if (analyzingIds.value.has(id)) return { status: 'skipped' }
      const d = useData()
      const f = d.friends.find((x) => x.id === id)
      if (!f) return { status: 'skipped' }
      analyzingIds.value = new Set(analyzingIds.value).add(id)   // await 前置位守卫
      try {
        const sug = await suggest(f, loadSamples(f.id))
        if (sug.rel || sug.role) {
          await d.updateFriend(id, { rel: sug.rel, role: sug.role })
          storage.saveAnalyzedIds([...new Set([...storage.loadAnalyzedIds(), id])])
          return { status: 'ok' }
        }
        return { status: 'empty' }
      } catch (e) {
        return { status: 'error', error: (e as Error)?.message ?? String(e) }
      } finally {
        const next = new Set(analyzingIds.value); next.delete(id); analyzingIds.value = next
      }
    }

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
          phase.value = 'parsing'
          const outcome = await parseLocal(chatFiles, year, (p) => {
            phase.value = p.phase
            if (p.phase === 'parsing') progress.value = p.total ? p.done / p.total : 0
          })
          // 合并好友 → 套用联系人真名（无联系人则 no-op）
          const merged = mergeFriends(data.friends, outcome.friends).friends
          const named = applyContactNames(merged, contactNames)
          // 报告的好友派生字段（计数、聊得最多、关系分布）全部从套名后的「全量好友」重算，
          // 保证概览/报告与好友列表口径一致（否则 topContacts 只反映本批次，会与列表榜首对不上）。
          const report = {
            ...outcome.report,
            year,
            friendCount: named.length,
            totalMessages: named.reduce((sum, f) => sum + (f.msgCount || 0), 0),
            activeDays: Math.max(prevReport?.activeDays ?? 0, outcome.report.activeDays),
            ...friendReportFields(named),
          }
          await data.setData(named, report)
          const prevSamples = storage.loadSamples()
          storage.saveSamples({ ...prevSamples, ...outcome.samples })
          // 好友详情页「最近一个月」数据：按 id 合并，新批次覆盖同 id 旧值。
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
          warnings.value = [...outcome.warnings, ...contactWarn(appliedCount(named))]
          status.value = 'done'                 // 导入完成：好友列表立即可用（分析改为好友列表手动触发）
        } else if (contactNames.length) {
          phase.value = 'aggregating'
          // 只导入了 contacts.json：给已有好友套真名，报告不变
          if (!prevReport) {
            throw new Error('请先导入聊天记录，再导入联系人 contacts.json。')
          }
          const named = applyContactNames(data.friends, contactNames)
          await data.setData(named, prevReport)
          warnings.value = contactWarn(appliedCount(named))
        } else {
          phase.value = 'aggregating'
          warnings.value = ['未从所选文件解析到聊天记录或联系人。']
        }
        status.value = 'done'
        phase.value = 'idle'
      } catch (e) {
        error.value = (e as Error).message
        status.value = 'error'
        phase.value = 'idle'
        analyzing.value = null
      }
    }
    function stocksWarn(r: { analyzed: number; withPicks: number; failed: number; firstError?: string }): string {
      const parts = [`已从 ${r.analyzed} 位好友抽取荐股，${r.withPicks} 位有结果`]
      if (r.failed) parts.push(`${r.failed} 位失败${r.firstError ? '：' + r.firstError : ''}`)
      return parts.join('；')
    }

    /** 重新导入的原文 → 对金融候选好友当场抽取荐股 → 持久化结果。重入保护。 */
    async function analyzeStocks(files: LocalFile[]): Promise<void> {
      if (analyzingStocks.value) return
      try {
        const chatFiles = files.filter((f) => !isWeliveContacts(f.content.slice(0, 2000)))
        if (!chatFiles.length) {
          warnings.value = [...warnings.value, '未选择聊天记录文件，无法分析荐股。']
          return
        }
        let convs: Conversation[] = []
        const parseWarnings: string[] = []
        for (const f of chatFiles) {
          const r = parseFile(f.name, f.content)
          convs = mergeConversations(convs, r.conversations)
          r.warnings.forEach((w) => parseWarnings.push(`${f.name}: ${w.reason}`))
        }
        const d = useData()
        // 初始进度占位＝本次会话里能匹配到的好友数(真实候选数，与 stockAnalysis 一致)，
        // 随后由 runAnalyzeStocks 的 onProgress 覆盖为准。不再依赖 role(真机常为空)。
        const convIds = new Set(convs.map((c) => c.id))
        const candCount = d.friends.filter((f) => convIds.has(f.id)).length
        analyzingStocks.value = { done: 0, total: candCount }   // await 前置位守卫
        const result = await runAnalyzeStocks({
          conversations: convs,
          friends: d.friends,
          extract: extractStocks,
          onProgress: (done, total) => { analyzingStocks.value = { done, total } },
        })
        // 候选取全部历史累积的金融好友，result.picks 只含本次重选文件命中会话的子集；
        // 与已存合并去重，避免部分重选冲掉之前已保存的荐股。
        const merged = mergeStockPicks(storage.loadStockPicks(), result.picks)
        storage.saveStockPicks(merged)
        stocksSavedCount.value = storage.loadStockPicks().length
        warnings.value = [...warnings.value, ...parseWarnings, stocksWarn(result)]
      } catch (e) {
        warnings.value = [...warnings.value, `荐股分析未完成：${(e as Error).message}`]
      } finally {
        analyzingStocks.value = null
      }
    }

    function reset() { status.value = 'idle'; phase.value = 'idle'; progress.value = 0; warnings.value = []; error.value = ''; analyzing.value = null; analyzingStocks.value = null; stocksSavedCount.value = 0 }
    return {
      status, phase, progress, warnings, error, analyzing, analyzingStocks, stocksSavedCount,
      analyzingIds,
      run, beginReading, analyzePendingRoles, analyzeOne, analyzeStocks, reset,
    }
  })
}

export const useImportStore = createImportStore()
