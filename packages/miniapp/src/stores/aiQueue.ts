import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend } from '@nianlun/core'

export type FeatureKey = 'role' | 'sentiment' | 'profile' | 'mbti' | 'relationDeep'
export type TaskState = 'idle' | 'queued' | 'running' | 'done'
export const FRIEND_FEATURES: FeatureKey[] = ['role', 'sentiment', 'profile', 'mbti', 'relationDeep']

type Task = { feature: FeatureKey; id: string }
export type AiQueueDeps = {
  getFriends: () => Friend[]
  readDoneSets: () => Record<FeatureKey, Set<string>>
  runTask: (feature: FeatureKey, friend: Friend) => Promise<boolean>
  flush?: () => void
  concurrency?: number
}

const keyOf = (feature: FeatureKey, id: string) => `${feature}:${id}`

export function createAiQueueStore(deps: AiQueueDeps) {
  const concurrency = deps.concurrency ?? 2
  return defineStore('aiQueue', () => {
    const order: Task[] = []                 // 待跑（非响应式，配 tick 触发重算）
    const inQueue = new Set<string>()
    const running = new Set<string>()
    const done = ref<Record<FeatureKey, Set<string>>>({
      role: new Set(), sentiment: new Set(), profile: new Set(), mbti: new Set(), relationDeep: new Set(),
    })
    const tick = ref(0)
    const bump = () => { tick.value++ }
    let features: FeatureKey[] = FRIEND_FEATURES

    const busy = computed(() => { tick.value; return running.size > 0 || order.length > 0 })

    function stateFor(feature: FeatureKey, id: string): TaskState {
      tick.value                              // 建立响应式依赖
      const key = keyOf(feature, id)
      if (running.has(key)) return 'running'
      if (inQueue.has(key)) return 'queued'
      if (done.value[feature].has(id)) return 'done'
      return 'idle'
    }

    function scan(): void {
      const friends = deps.getFriends()
      if (friends.length === 0) return
      done.value = deps.readDoneSets()        // 5 次整表读，构建内存 done 集
      for (const f of friends) {
        for (const feature of features) {
          const key = keyOf(feature, f.id)
          if (done.value[feature].has(f.id) || inQueue.has(key) || running.has(key)) continue
          order.push({ feature, id: f.id }); inQueue.add(key)
        }
      }
      bump(); pump()
    }

    function prioritize(feature: FeatureKey, id: string): void {
      const key = keyOf(feature, id)
      if (running.has(key) || done.value[feature].has(id)) return   // 正在跑/已完成：no-op
      const idx = order.findIndex((t) => keyOf(t.feature, t.id) === key)
      if (idx >= 0) order.splice(idx, 1)
      else inQueue.add(key)
      order.unshift({ feature, id })
      bump(); pump()
    }

    function pump(): void {
      while (running.size < concurrency && order.length > 0) {
        const task = order.shift() as Task
        const key = keyOf(task.feature, task.id)
        inQueue.delete(key); running.add(key); bump()
        const friend = deps.getFriends().find((f) => f.id === task.id)
        if (!friend) { running.delete(key); continue }
        void deps.runTask(task.feature, friend)
          .then((ok) => { if (ok) done.value[task.feature] = new Set(done.value[task.feature]).add(task.id) })
          .catch(() => { /* 失败：不计入 done，下次开机/手动重试 */ })
          .finally(() => { running.delete(key); bump(); pump() })
      }
    }

    function flush(): void { deps.flush?.() }
    function __setFeaturesForTest(fs: FeatureKey[]): void { features = fs }

    return { scan, prioritize, stateFor, busy, flush, __setFeaturesForTest }
  })
}
