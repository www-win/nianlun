import { describe, it, expect, vi } from 'vitest'
import { makeAiQueueRegistry } from '../aiQueueRegistry'
import type { Friend } from '@nianlun/core'

const F = (id: string): Friend => ({ id, name: id, alias: '', rel: '其他', role: '', msgCount: 30 } as any)

function fakeDeps(over: Partial<any> = {}) {
  const rolePatches: any[] = []
  const analyzed: string[] = []
  return {
    rolePatches, analyzed,
    ai: {
      suggestFriend: vi.fn(async () => ({ rel: '同事', role: '产品' })),
      analyzeFriendSentiment: vi.fn(async () => ({ tone: '暖', summary: 's' })),
      analyzeFriendProfile: vi.fn(async () => ({ identity: 'x' })),
      analyzeFriendMbti: vi.fn(async () => ({ code: 'INTJ' })),
      analyzeRelationDeep: vi.fn(async () => ({ overall: 'o' })),
      ...(over.ai ?? {}),
    },
    storage: {
      loadAnalyzedIds: () => analyzed,
      loadFriendSentimentMap: () => ({}), loadFriendProfileMap: () => ({}),
      loadFriendMbtiMap: () => ({}), loadRelationDeepMap: () => ({}),
      saveFriendSentiment: vi.fn(), saveFriendProfile: vi.fn(),
      saveFriendMbti: vi.fn(), saveRelationDeep: vi.fn(),
      addAnalyzedIds: (ids: string[]) => analyzed.push(...ids),
      flushNow: vi.fn(),
      ...(over.storage ?? {}),
    },
    loadSamples: () => ['s1', 's2'],
    updateFriendsBatch: (p: any[]) => rolePatches.push(...p),
  }
}

describe('aiQueueRegistry', () => {
  it('sentiment runTask：有效结果落盘、返回 true', async () => {
    const d = fakeDeps()
    const reg = makeAiQueueRegistry(d as any)
    const ok = await reg.runTask('sentiment', F('a'))
    expect(ok).toBe(true)
    expect(d.storage.saveFriendSentiment).toHaveBeenCalled()
  })

  it('sentiment 空结果：不落盘、返回 false', async () => {
    const d = fakeDeps({ ai: { analyzeFriendSentiment: vi.fn(async () => ({})) } })
    const reg = makeAiQueueRegistry(d as any)
    const ok = await reg.runTask('sentiment', F('a'))
    expect(ok).toBe(false)
    expect(d.storage.saveFriendSentiment).not.toHaveBeenCalled()
  })

  it('role runTask：暂存 patch、返回 true；flush 时批量写好友+analyzedIds', async () => {
    const d = fakeDeps()
    const reg = makeAiQueueRegistry(d as any)
    const ok = await reg.runTask('role', F('a'))
    expect(ok).toBe(true)
    reg.flush()
    expect(d.rolePatches).toEqual([{ id: 'a', rel: '同事', role: '产品' }])
    expect(d.analyzed).toContain('a')
    expect(d.storage.flushNow).toHaveBeenCalled()
  })

  it('role 空结果（无 rel/role）：不暂存、返回 false', async () => {
    const d = fakeDeps({ ai: { suggestFriend: vi.fn(async () => ({})) } })
    const reg = makeAiQueueRegistry(d as any)
    const ok = await reg.runTask('role', F('a'))
    expect(ok).toBe(false)
    reg.flush()
    expect(d.rolePatches).toEqual([])
  })

  it('readDoneSets：把各表 id 汇成集合', () => {
    const d = fakeDeps({ storage: {
      loadAnalyzedIds: () => ['a'],
      loadFriendSentimentMap: () => ({ b: {} }), loadFriendProfileMap: () => ({}),
      loadFriendMbtiMap: () => ({ c: {} }), loadRelationDeepMap: () => ({}),
      saveFriendSentiment: vi.fn(), saveFriendProfile: vi.fn(), saveFriendMbti: vi.fn(),
      saveRelationDeep: vi.fn(), addAnalyzedIds: vi.fn(), flushNow: vi.fn(),
    } })
    const reg = makeAiQueueRegistry(d as any)
    const sets = reg.readDoneSets()
    expect(sets.role.has('a')).toBe(true)
    expect(sets.sentiment.has('b')).toBe(true)
    expect(sets.mbti.has('c')).toBe(true)
  })
})
