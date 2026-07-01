import type { Friend } from '@nianlun/core'
import { storage as defaultStorage, makeStorage } from './storage'

export interface GatherOptions { maxFriends?: number; perFriend?: number; maxTotal?: number }

export function makeSamples(storage: ReturnType<typeof makeStorage> = defaultStorage) {
  return {
    loadSamplesFor(id: string): string[] {
      return storage.loadSamples()[id] ?? []
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
