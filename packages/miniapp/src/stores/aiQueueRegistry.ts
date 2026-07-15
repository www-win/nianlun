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
      // 立即写入好友对象（role 即好友页/详情页显示的「职务/备注」值）+ 记 analyzedIds，
      // 而非攒到队列排空才 flush——否则全量自动分析时职务/备注长时间不显示。
      deps.updateFriendsBatch([{ id: friend.id, rel: sug.rel as Relation | undefined, role: sug.role }])
      deps.storage.addAnalyzedIds([friend.id])
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
    deps.storage.flushNow()   // 好友级四表 debounce 缓冲一并落盘（role 已即时写入，无需在此处理）
  }

  return { readDoneSets, runTask, flush }
}
