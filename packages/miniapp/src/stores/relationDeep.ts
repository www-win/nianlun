import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, RelationDeep } from '@nianlun/core'
import { aiClient } from '../adapters/aiClient'
import { storage as defaultStorage } from '../adapters/storage'
import { stepProgress } from '../components/progressBarLogic'

export type Completion = { id: string; status: 'ok' | 'empty' | 'error'; message?: string }
type AnalyzeFn = (friend: Friend, samples: string[]) => Promise<RelationDeep>
type StorageDep = { saveRelationDeep: (id: string, friend: Friend, data: RelationDeep) => void }
type Deps = { ai?: AnalyzeFn; storage?: StorageDep; tick?: number }

// 注：全局「分析进行中」红点不在此处理。tabBar API 只能在 tab 页上下文调用（否则报
// not TabBar page），而分析从非 tab 页发起——红点改由各 tab 页经 useRelationDeepBadge()
// 监听 busy 自行同步。store 保持 UI 无关，只暴露运行态。

// 工厂：测试注入 fake ai/storage/tick；运行时用真实依赖。
// 跨页面存活的单例，托管「单任务」深度分析生命周期——离开页面分析继续跑、跑完落盘。
export function createRelationDeepStore(deps: Deps = {}) {
  const ai: AnalyzeFn = deps.ai ?? aiClient.analyzeRelationDeep
  const store: StorageDep = deps.storage ?? defaultStorage
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
        activeId.value = null
      }
    }

    return { activeId, progress, completion, busy, runningFor, start }
  })
}

export const useRelationDeepStore = createRelationDeepStore()
