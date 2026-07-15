import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'
import { createAiQueueStore, makeReentryScanner, type FeatureKey } from '../aiQueue'
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

  it('scan 合并而非覆盖内存 done：已完成但未 flush 落盘的 role 不会被磁盘空集覆盖而重新入队', async () => {
    const friends = [F('a')]
    const runTask = vi.fn(async () => true)
    // 模拟磁盘 done 集始终为空（尚未 flush 落盘）
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 2 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('done'))
    expect(runTask).toHaveBeenCalledTimes(1)
    // 再次 scan：readDoneSets 仍返回空集，但内存里 'a' 已完成，不应被重新入队再跑一次
    s.scan()
    await Promise.resolve()
    expect(s.stateFor('role', 'a')).toBe('done')
    expect(runTask).toHaveBeenCalledTimes(1)   // 未被重复调用
  })

  it('AI 失败(返回 false)的任务不计入 done；再次 scan 会重新入队重试', async () => {
    const friends = [F('a')]
    let attempt = 0
    // 第一次失败(AI 偶发抽风返回空)，第二次成功
    const runTask = vi.fn(async () => { attempt++; return attempt >= 2 })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 2 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('idle'))  // 失败 → 回 idle，未标 done
    // 重扫(模拟再次进入 app)：未完成的 'a' 应被重新入队并重试
    s.scan()
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('done'))  // 第二次成功
  })

  it('AI 抛错的任务同样不计入 done；再次 scan 会重试', async () => {
    const friends = [F('a')]
    let attempt = 0
    const runTask = vi.fn(async () => { attempt++; if (attempt < 2) throw new Error('上游 RST'); return true })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 2 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('idle'))  // 抛错 → 回 idle
    s.scan()
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('done'))  // 重扫后重试成功
  })

  it('某任务返回 false 即刹车：不再拉起队列里剩下的（等回前台重扫）', async () => {
    const friends = [F('a'), F('b'), F('c')]
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => fr.id !== 'a')  // a 失败(空)，b/c 若跑会成功
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 1 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1))  // 只跑了 a
    await vi.waitFor(() => expect(s.busy).toBe(false))                // 刹车后不再 busy
    expect(runTask).toHaveBeenCalledTimes(1)                         // b、c 没被拉起
    expect(s.stateFor('role', 'b')).toBe('idle')                    // 剩下的回 idle，等重扫重试
    expect(s.stateFor('role', 'c')).toBe('idle')
  })

  it('某任务抛错即刹车：并发中的另一个跑完后不再继续队列', async () => {
    const friends = [F('a'), F('b'), F('c')]
    const gates: Record<string, ReturnType<typeof defer>> = { a: defer(), b: defer() }
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => {
      if (fr.id === 'a') throw new Error('上游 RST')   // a 立刻抛错 → 刹车
      return gates[fr.id]?.promise ?? true
    })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 2 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()                                            // a、b 并发起跑；a 抛错清空队列(含 c)
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2))  // a、b 已起，c 被刹车拦下
    gates['b'].resolve(true)                            // b 跑完
    await vi.waitFor(() => expect(s.busy).toBe(false))
    expect(runTask).toHaveBeenCalledTimes(2)            // c 始终没跑
    expect(s.stateFor('role', 'c')).toBe('idle')
  })

  it('刹车后重扫可继续：失败的重试成功、被拦下的接着跑', async () => {
    const friends = [F('a'), F('b')]
    let aAttempt = 0
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => {
      if (fr.id === 'a') { aAttempt++; return aAttempt >= 2 }  // a 第一次失败、第二次成功
      return true
    })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 1 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()                                            // a 先跑(msgCount 相等按序 a)→失败刹车，b 被拦
    await vi.waitFor(() => expect(s.busy).toBe(false))
    expect(s.stateFor('role', 'b')).toBe('idle')       // b 没跑
    s.scan()                                            // 重扫：a 重试成功、b 接着跑
    await vi.waitFor(() => expect(s.stateFor('role', 'a')).toBe('done'))
    await vi.waitFor(() => expect(s.stateFor('role', 'b')).toBe('done'))
  })

  it('scan 按好友消息数从多到少入队（聊得多的先分析）', async () => {
    const mk = (id: string, msgCount: number): Friend => ({ ...F(id), msgCount } as any)
    const friends = [mk('a', 5), mk('b', 100), mk('c', 50)]   // 存储顺序 a,b,c；期望按 msgCount 跑 b,c,a
    const order: string[] = []
    const gates: Record<string, ReturnType<typeof defer>> = { a: defer(), b: defer(), c: defer() }
    const runTask = vi.fn(async (_f: FeatureKey, fr: Friend) => { order.push(fr.id); return gates[fr.id].promise })
    const useStore = createAiQueueStore({ getFriends: () => friends, readDoneSets: emptyDone, runTask, concurrency: 1 })
    const s = useStore(); s.__setFeaturesForTest(['role'])
    s.scan()
    await vi.waitFor(() => expect(order).toEqual(['b']))          // 消息最多的 b 先跑
    gates['b'].resolve(true)
    await vi.waitFor(() => expect(order).toEqual(['b', 'c']))     // 再 c
    gates['c'].resolve(true)
    await vi.waitFor(() => expect(order).toEqual(['b', 'c', 'a'])) // 最后最少的 a
    gates['a'].resolve(true)
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

describe('makeReentryScanner（App onShow 补扫时序）', () => {
  it('首次 onShow 不重扫（交给 onLaunch 云同步后那次 scan）', () => {
    const scan = vi.fn()
    const onShow = makeReentryScanner(scan)
    onShow()
    expect(scan).toHaveBeenCalledTimes(0)
  })

  it('之后每次回前台都重扫，补跑上次失败/没跑完的分析', () => {
    const scan = vi.fn()
    const onShow = makeReentryScanner(scan)
    onShow()                                  // 首次：跳过
    onShow(); expect(scan).toHaveBeenCalledTimes(1)  // 再次进入：重扫
    onShow(); expect(scan).toHaveBeenCalledTimes(2)  // 每次进入都重扫
    onShow(); expect(scan).toHaveBeenCalledTimes(3)
  })

  it('各实例独立计数（firstShow 不串台）', () => {
    const a = vi.fn(); const b = vi.fn()
    const onShowA = makeReentryScanner(a)
    const onShowB = makeReentryScanner(b)
    onShowA(); onShowA()                       // A 第二次触发
    onShowB()                                  // B 仍是首次
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(0)
  })
})
