import type { Friend } from '@nianlun/core'
import type { RecentInsight } from './parseLocal'
import { storage as defaultStorage, makeStorage } from './storage'

export interface GatherOptions { maxFriends?: number; perFriend?: number; maxTotal?: number }

export function makeSamples(storage: ReturnType<typeof makeStorage> = defaultStorage) {
  return {
    loadSamplesFor(id: string): string[] {
      return storage.loadSamples()[id] ?? []
    },
    /**
     * 好友详情页「最近一个月」高频词 + 活跃时段。
     * 存储整体为空（老数据/功能未跑过）→ 返回 null，由页面回退到全年字段；
     * 否则返回该 id 的记录，近期无往来的好友返回空默认（对应区块按 v-if 隐藏）。
     */
    loadRecentInsightsFor(id: string): RecentInsight | null {
      const all = storage.loadRecentInsights()
      if (Object.keys(all).length === 0) return null
      return all[id] ?? { keywords: [], weekHour: new Array(168).fill(0) }
    },
    /** 好友详情页「最近一个月」样本；语义同 loadRecentInsightsFor：空存储回退（null），否则按 id 取。 */
    loadRecentSamplesFor(id: string): string[] | null {
      const all = storage.loadRecentSamples()
      if (Object.keys(all).length === 0) return null
      return all[id] ?? []
    },
    /** 全年情绪用：按 msgCount 取前 maxFriends 位好友，各取前 perFriend 条样本，展平并截断到 maxTotal。 */
    gatherTopSamples(friends: Friend[], opts: GatherOptions = {}): string[] {
      const maxFriends = opts.maxFriends ?? 10
      const perFriend = opts.perFriend ?? 4
      const maxTotal = opts.maxTotal ?? 60
      const all = storage.loadSamples()
      const top = [...friends].sort((a, b) => b.msgCount - a.msgCount).slice(0, maxFriends)
      const out: string[] = []
      for (const f of top) {
        for (const s of (all[f.id] ?? []).slice(0, perFriend)) {
          out.push(s)
          if (out.length >= maxTotal) return out
        }
      }
      return out
    },
  }
}

export const samples = makeSamples()
