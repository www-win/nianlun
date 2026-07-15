import type { Friend, Relation } from '@nianlun/core'
import type { FeatureKey } from './aiQueue'

// 依赖以接口注入，便于测试；生产在 aiQueue.ts 里用真实 aiClient/storage/samples/data 组装。
export type RegistryDeps = {
  ai: {
    suggestFriend: (f: Friend, s: string[]) => Promise<{ rel?: Relation; role?: string }>
    analyzeFriendSentiment: (f: Friend, s: string[]) => Promise<{ tone?: string; summary?: string }>
    analyzeFriendProfile: (f: Friend, s: string[]) => Promise<Record<string, unknown>>
    analyzeFriendMbti: (f: Friend, s: string[]) => Promise<unknown | null>
    analyzeRelationDeep: (f: Friend, s: string[]) => Promise<Record<string, unknown>>
  }
  storage: {
    loadAnalyzedIds: () => string[]
    loadFriendSentimentMap: () => Record<string, unknown>
    loadFriendProfileMap: () => Record<string, unknown>
    loadFriendMbtiMap: () => Record<string, unknown>
    loadRelationDeepMap: () => Record<string, unknown>
    saveFriendSentiment: (id: string, f: Friend, d: unknown) => void
    saveFriendProfile: (id: string, f: Friend, d: unknown) => void
    saveFriendMbti: (id: string, f: Friend, d: unknown) => void
    saveRelationDeep: (id: string, f: Friend, d: unknown) => void
    addAnalyzedIds: (ids: string[]) => void
    flushNow: () => void
  }
  loadSamples: (id: string) => string[]
  updateFriendsBatch: (patches: Array<{ id: string; role?: string; rel?: Relation }>) => void
}

export function makeAiQueueRegistry(deps: RegistryDeps) {
  // role 批量缓冲：runTask 只暂存，flush 时一次落盘（防③全数组深拷贝频繁触发）。
  const rolePending: Array<{ id: string; role?: string; rel?: Relation }> = []
  const roleDoneIds: string[] = []

  function readDoneSets(): Record<FeatureKey, Set<string>> {
    return {
      role: new Set(deps.storage.loadAnalyzedIds()),
      sentiment: new Set(Object.keys(deps.storage.loadFriendSentimentMap())),
      profile: new Set(Object.keys(deps.storage.loadFriendProfileMap())),
      mbti: new Set(Object.keys(deps.storage.loadFriendMbtiMap())),
      relationDeep: new Set(Object.keys(deps.storage.loadRelationDeepMap())),
    }
  }

  async function runTask(feature: FeatureKey, friend: Friend): Promise<boolean> {
    const s = deps.loadSamples(friend.id)
    if (feature === 'role') {
      const sug = await deps.ai.suggestFriend(friend, s)
      if (!(sug.rel || sug.role)) return false
      rolePending.push({ id: friend.id, rel: sug.rel, role: sug.role })
      roleDoneIds.push(friend.id)
      return true
    }
    if (feature === 'sentiment') {
      const r = await deps.ai.analyzeFriendSentiment(friend, s)
      if (!(r.tone || r.summary)) return false
      deps.storage.saveFriendSentiment(friend.id, friend, r)
      return true
    }
    if (feature === 'profile') {
      const r = await deps.ai.analyzeFriendProfile(friend, s)
      if (!(r.identity || r.family || r.romance || r.lifestyle || r.investment)) return false
      deps.storage.saveFriendProfile(friend.id, friend, r)
      return true
    }
    if (feature === 'mbti') {
      const r = await deps.ai.analyzeFriendMbti(friend, s)
      if (!r) return false
      deps.storage.saveFriendMbti(friend.id, friend, r)
      return true
    }
    // relationDeep
    const r = await deps.ai.analyzeRelationDeep(friend, s)
    if (Object.keys(r).length === 0) return false
    deps.storage.saveRelationDeep(friend.id, friend, r)
    return true
  }

  function flush(): void {
    if (rolePending.length) { deps.updateFriendsBatch([...rolePending]); rolePending.length = 0 }
    if (roleDoneIds.length) { deps.storage.addAnalyzedIds([...roleDoneIds]); roleDoneIds.length = 0 }
    deps.storage.flushNow()   // 好友级四表 debounce 缓冲一并落盘
  }

  return { readDoneSets, runTask, flush }
}
