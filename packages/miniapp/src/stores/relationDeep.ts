import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, RelationDeep } from '@nianlun/core'
import { aiClient } from '../adapters/aiClient'
import { storage as defaultStorage } from '../adapters/storage'
import { stepProgress } from '../components/progressBarLogic'

export type Completion = { id: string; status: 'ok' | 'empty' | 'error'; message?: string }
type AnalyzeFn = (friend: Friend, samples: string[]) => Promise<RelationDeep>
type StorageDep = { saveRelationDeep: (id: string, friend: Friend, data: RelationDeep) => void }
type TabBadge = { show: () => void; hide: () => void }
type Deps = { ai?: AnalyzeFn; storage?: StorageDep; tabBadge?: TabBadge; tick?: number }

// 「好友」tab 在 pages.json tabBar.list 里的下标（导入0/概览1/好友2/二级市场3/报告4）。
const FRIENDS_TAB_INDEX = 2

// 默认全局提示：好友 tab 红点。uni tabBar API 在非预期时机可能抛错 → try/catch 兜底，不影响分析主流程。
const defaultTabBadge: TabBadge = {
  show: () => { try { uni.showTabBarRedDot({ index: FRIENDS_TAB_INDEX }) } catch { /* 忽略 */ } },
  hide: () => { try { uni.hideTabBarRedDot({ index: FRIENDS_TAB_INDEX }) } catch { /* 忽略 */ } },
}

// 工厂：测试注入 fake ai/storage/tabBadge/tick；运行时用真实依赖。
// 跨页面存活的单例，托管「单任务」深度分析生命周期——离开页面分析继续跑、跑完落盘。
export function createRelationDeepStore(deps: Deps = {}) {
  const ai: AnalyzeFn = deps.ai ?? aiClient.analyzeRelationDeep
  const store: StorageDep = deps.storage ?? defaultStorage
  const tabBadge: TabBadge = deps.tabBadge ?? defaultTabBadge
  const tick = deps.tick ?? 400

  return defineStore('relationDeep', () => {
    const activeId = ref<string | null>(null)
    const progress = ref(0)
    const completion = ref<Completion | null>(null)
    const busy = computed(() => activeId.value !== null)
    function runningFor(id: string) { return activeId.value === id }

    let timer: ReturnType<typeof setInterval> | null = null
    function startProgress() {
      progress.value = 0
      stopProgress()
      timer = setInterval(() => { progress.value = stepProgress(progress.value) }, tick)
    }
    function stopProgress() { if (timer) { clearInterval(timer); timer = null } }

    // 单任务：忙则拒绝，不打断正在跑的那个。返回 'started' | 'busy'。
    function start(friend: Friend, samples: string[]): 'started' | 'busy' {
      if (busy.value) return 'busy'
      const id = friend.id
      activeId.value = id
      completion.value = null
      startProgress()
      tabBadge.show()
      void run(id, friend, samples)
      return 'started'
    }

    async function run(id: string, friend: Friend, samples: string[]) {
      try {
        const deep = await ai(friend, samples)
        if (Object.keys(deep).length > 0) {
          store.saveRelationDeep(id, friend, deep)   // 仅有效结果落盘
          completion.value = { id, status: 'ok' }
        } else {
          completion.value = { id, status: 'empty' } // 空结果不落盘，允许重试
        }
      } catch (e) {
        completion.value = { id, status: 'error', message: (e as Error).message }
      } finally {
        stopProgress()
        progress.value = 100
        tabBadge.hide()
        activeId.value = null
      }
    }

    return { activeId, progress, completion, busy, runningFor, start }
  })
}

export const useRelationDeepStore = createRelationDeepStore()
