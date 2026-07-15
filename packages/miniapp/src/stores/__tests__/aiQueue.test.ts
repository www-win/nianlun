import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createAiQueueStore, type FeatureKey } from '../aiQueue'
import type { Friend } from '@nianlun/core'

const F = (id: string): Friend => ({ id, name: id, alias: '', rel: '其他', role: '', msgCount: 10 } as any)
const emptyDone = () => ({ role: new Set<string>(), sentiment: new Set<string>(), profile: new Set<string>(), mbti: new Set<string>(), relationDeep: new Set<string>() })

function defer() {
  let resolve!: (v: boolean) => void
  const promise = new Promise<boolean>((r) => { resolve = r })
  return { promise, resolve }
}

describe('aiQueue 引擎', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('scan 入队未完成的；并发上限 2，最多 2 个同时 running', async () => {
    const friends = [F('a'), F('b'), F('c')]
    const gates = [defer(), defer(), defer()]
    let started = 0
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => {
      started++
      return gates[friends.findIndex((x) => x.id === fr.id)].promise
    })
    const useStore = createAiQueueStore({
      getFriends: () => friends,
      readDoneSets: emptyDone,
      runTask,
      concurrency: 2,
    })
    const s = useStore()
    // 只保留一个功能便于计数：用 stubFeatures 让 scan 只排 'role'
    s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(started).toBe(2))
    expect(started).toBe(2)                 // 3 个任务，但同时只起 2
    gates[0].resolve(true)
    await vi.waitFor(() => expect(started).toBe(3))
    expect(started).toBe(3)                 // 腾位后第 3 个才起
    gates[1].resolve(true); gates[2].resolve(true)
  })

  it('已完成的不入队（stateFor=done），idle→queued→running→done', async () => {
    const friends = [F('a')]
    const done = emptyDone(); done.role.add('a')
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: () => done, runTask: async () => true })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    expect(s.stateFor('role', 'a')).toBe('done')
  })

  it('prioritize 对 running 中的任务是 no-op（不再次调用 runTask）', async () => {
    const friends = [F('a')]
    const gate = defer()
    const runTask = vi.fn(async () => gate.promise)
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 2 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan(); await Promise.resolve()
    expect(runTask).toHaveBeenCalledTimes(1)
    s.prioritize('role', 'a')               // 已在 running
    expect(runTask).toHaveBeenCalledTimes(1) // 未再调用
    gate.resolve(true)
  })

  it('prioritize 把队列中的任务移到队首', async () => {
    const friends = [F('a'), F('b'), F('c')]
    const order: string[] = []
    const gates: Record<string, ReturnType<typeof defer>> = { a: defer(), b: defer(), c: defer() }
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => { order.push(fr.id); return gates[fr.id].promise })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 1 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(order).toEqual(['a']))   // a 起跑，b、c 在队列
    s.prioritize('role', 'c')                // c 提到 b 前
    gates['a'].resolve(true)
    await vi.waitFor(() => expect(order).toEqual(['a', 'c']))
    expect(order).toEqual(['a', 'c'])        // a 之后是 c 不是 b
    gates['c'].resolve(true); gates['b'].resolve(true)
  })
})
