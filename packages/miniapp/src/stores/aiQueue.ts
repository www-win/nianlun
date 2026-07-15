import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend } from '@nianlun/core'
import { useDataStore } from './data'
import { storage } from '../adapters/storage'
import { samples } from '../adapters/samples'
import { aiClient } from '../adapters/aiClient'
import { makeAiQueueRegistry } from './aiQueueRegistry'

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
      // 按好友消息数从多到少入队：聊得多的好友先分析（每个好友内部仍是 FRIEND_FEATURES 顺序）。
      const friends = [...deps.getFriends()].sort((a, b) => b.msgCount - a.msgCount)
      if (friends.length === 0) return
      const fresh = deps.readDoneSets()       // 5 次整表读，构建磁盘 done 集
      // 并入内存里已有的 done（完成但尚未 flush 落盘的，不能被磁盘集覆盖丢失）
      for (const f of FRIEND_FEATURES) for (const id of done.value[f]) fresh[f].add(id)
      done.value = fresh
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

    // 分析失败即刹车：清空待跑队列、不再拉起后续（在跑的自然结束）。
    // 触发条件——runTask 抛错(后端挂了/欠费/上游 RST) 或 返回 false(AI 没抽出内容)。
    // 后端一旦不可用，继续 pump 只会把剩下所有好友逐个失败一遍，白烧电/额度。
    // 停下不是永久放弃：未完成的没标 done，下次回前台 onShow 重扫会自动补跑重试。
    function halt(): void {
      for (const t of order) inQueue.delete(keyOf(t.feature, t.id))
      order.length = 0
      bump()
    }

    function pump(): void {
      while (running.size < concurrency && order.length > 0) {
        const task = order.shift() as Task
        const key = keyOf(task.feature, task.id)
        inQueue.delete(key); running.add(key); bump()
        const friend = deps.getFriends().find((f) => f.id === task.id)
        if (!friend) { running.delete(key); continue }
        void deps.runTask(task.feature, friend)
          .then((ok) => {
            if (ok) done.value[task.feature] = new Set(done.value[task.feature]).add(task.id)
            else halt()             // 空结果视为失败 → 刹车
          })
          .catch(() => halt())      // 抛错 → 刹车
          .finally(() => { running.delete(key); bump(); pump() })
      }
      if (running.size === 0 && order.length === 0) flush()   // 队列排空：把批量结果落盘
    }

    function flush(): void { deps.flush?.() }
    function __setFeaturesForTest(fs: FeatureKey[]): void { features = fs }

    return { scan, prioritize, stateFor, busy, flush, __setFeaturesForTest }
  })
}

// App onShow 回前台补扫的时序决策（抽成纯函数便于单测）：
// 首次 onShow 跳过——交给 onLaunch 云端同步之后那次 scan，避免和它抢跑重复入队；
// 之后每次回前台都 scan，补跑上次失败刹车/没跑完的分析。scan 幂等：已完成的跳过。
export function makeReentryScanner(scan: () => void): () => void {
  let firstShow = true
  return () => {
    if (firstShow) { firstShow = false; return }
    scan()
  }
}

// —— 生产单例：真实 aiClient/storage/samples/data 组装 —— //
const registry = makeAiQueueRegistry({
  ai: aiClient,
  storage,
  loadSamples: samples.loadSamplesFor,
  updateFriendsBatch: (patches) => useDataStore().updateFriendsBatch(patches),
})
export const useAiQueueStore = createAiQueueStore({
  getFriends: () => useDataStore().friends,
  readDoneSets: registry.readDoneSets,
  runTask: registry.runTask,
  flush: registry.flush,
})
