# 开机全自动 AI 分析队列 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开机后台自动把「还没 AI 分析过」的好友级功能（关系职务/情绪/画像/MBTI/深度关系）全部分析完，全程不卡 UI、不重复分析，已分析的功能不再显示任何分析按钮。

**Architecture:** 新建单例 `aiQueue` store，作为小程序里所有 AI 分析（自动+手动）的唯一入口与执行者：持并发上限 2、任务队列、内存 done 集合、`scan/pump/prioritize/stateFor`。开机 `hydrate` 后与每次导入成功后 `scan()` 把缺口入队；页面用 `stateFor` 决定按钮渲染、手动点用 `prioritize()` 插队。防卡靠 storage 层的整表批量读 + debounce 合并写。退休原 `relationDeep` store，把 `import` 里的自动 role 分析并入队列。

**Tech Stack:** uni-app（mp-weixin）、Vue 3 `<script setup>`、Pinia、TypeScript、Vitest。依赖既有 `@nianlun/core` 的 `aiClient` 封装与 `storage`/`data` 适配层。

## Global Constraints

- **单向依赖**：miniapp 依赖 `@nianlun/core`，`core` 绝不反向依赖、绝不碰 DOM/wx。本计划只改 miniapp，不改 core。
- **隐私**：原始聊天全文（`Conversation[]`）绝不落盘；只用已落盘的有界样本 `storage.loadSamples()`。
- **store 纯净**：store 不碰 `uni.*`/`wx.*` UI（toast/tabBar 等）；这些留在页面层。store 依赖用工厂参数注入以便测试（沿用 `createDataStore`/`createRelationDeepStore` 模式）。
- **并发上限**：`CONCURRENCY = 2`（常量）。
- **范围**：仅好友级 5 功能纳入自动；报告页（年度文案/全年情绪）、命理、股票**不改、不纳入**。
- **测试**：miniapp 用 Vitest（`pnpm --filter @nianlun/miniapp test`）。`.vue` 页面不做单元测试（沿用仓库惯例：逻辑抽到 store/lib 测，页面为薄接线），页面改动由构建 `pnpm --filter @nianlun/miniapp build:mp-weixin` 与最终 `verify` 把关。
- **「已分析」唯一标准**：对应结果缓存非 null（`loadAnalyzedIds` 含 id / `loadFriendXxx(id,f)!==null`）；空结果/失败不落盘、可重试。

---

### Task 1: storage 增三个整表批量读（防卡①）

现有只有 `loadFriendMbtiMap()`。`scan` 判定「已分析」需一次性读整张表，避免每好友每功能各一次 `getStorageSync`。补齐情绪/画像/深度关系的整表读。

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`（在 `loadFriendMbtiMap` 之后新增三个方法）
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Produces:
  - `storage.loadFriendSentimentMap(): Record<string, Sentiment>`
  - `storage.loadFriendProfileMap(): Record<string, FriendProfile>`
  - `storage.loadRelationDeepMap(): Record<string, RelationDeep>`
  - 语义同 `loadFriendMbtiMap`：一次 `backend.get`，返回 `{ [id]: data }`（丢弃 fp 元数据）。

- [ ] **Step 1: Write the failing test**

在 `storage.test.ts` 末尾追加：

```ts
it('loadFriendSentimentMap/ProfileMap/RelationDeepMap 整表一次读，返回 {id:data}', () => {
  const s = makeStorage(makeMemBackend())
  const f = (id: string): Friend => ({ ...baseFriend, id, msgCount: 30 })
  s.saveFriendSentiment('a', f('a'), { tone: '暖', summary: 's' } as any)
  s.saveFriendProfile('b', f('b'), { identity: 'x' } as any)
  s.saveRelationDeep('c', f('c'), { overall: 'o' } as any)
  s.flushNow?.()   // Task 2 引入 flushNow 后需要；本任务此行可先删（见下方说明）
  expect(s.loadFriendSentimentMap()['a']).toEqual({ tone: '暖', summary: 's' })
  expect(s.loadFriendProfileMap()['b']).toEqual({ identity: 'x' })
  expect(s.loadRelationDeepMap()['c']).toEqual({ overall: 'o' })
})
```

> 说明：本任务先于 Task 2，此时 `saveFriendXxx` 仍是同步写、无 `flushNow`。请在本步把 `s.flushNow?.()` 那行**删除**（同步写立即可读）；Task 2 完成后不需回改，因为 `?.` 可选链在无该方法时是 no-op——但为避免困惑，本任务提交时删掉该行，Task 2 的测试自带 flush 用例。`baseFriend`/`makeMemBackend` 沿用该测试文件已有的辅助（若无 `baseFriend`，用文件顶部既有的 Friend 构造方式）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts -t "整表一次读"`
Expected: FAIL（`loadFriendSentimentMap is not a function`）

- [ ] **Step 3: Write minimal implementation**

在 `storage.ts` 的 `loadFriendMbtiMap()` 方法之后新增：

```ts
    loadFriendSentimentMap(): Record<string, Sentiment> {
      const all = loadFriendMap(K_FRIEND_SENTIMENT)
      const out: Record<string, Sentiment> = {}
      for (const id in all) out[id] = all[id].data as Sentiment
      return out
    },
    loadFriendProfileMap(): Record<string, FriendProfile> {
      const all = loadFriendMap(K_FRIEND_PROFILE)
      const out: Record<string, FriendProfile> = {}
      for (const id in all) out[id] = all[id].data as FriendProfile
      return out
    },
    loadRelationDeepMap(): Record<string, RelationDeep> {
      const all = loadFriendMap(K_FRIEND_RELATION_DEEP)
      const out: Record<string, RelationDeep> = {}
      for (const id in all) out[id] = all[id].data as RelationDeep
      return out
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts -t "整表一次读"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): storage 增情绪/画像/深度关系整表批量读"
```

---

### Task 2: storage 好友级 AI 结果改 debounce 合并写（防卡②）

四张好友级结果表（情绪/画像/MBTI/深度关系）从「每结果整表同步写」改为「进内存缓冲 + debounce 合并写」，读走 read-through（缓冲叠加已存），并暴露 `flushNow()` 供 App 退后台/队列排空时落盘。

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: 现有 `saveFriendSentiment/Profile/Mbti/saveRelationDeep`（签名不变）、`loadFriendXxx`、`loadFriendXxxMap`（Task 1）。
- Produces:
  - `storage.flushNow(): void`（把所有缓冲立即写盘，触发一次 `fireChanged`）。
  - 行为变化：`saveFriendXxx` 不再立即写 `backend`，改为缓冲 + 800ms 后 flush；`loadFriendXxx`/`loadFriendXxxMap` read-through 缓冲。
  - `makeStorage` 新增可选第三参 `now: () => number` 与第四参 `schedule`（默认用 `setTimeout`），用于测试注入假定时器；不传则用真实 `setTimeout`。

- [ ] **Step 1: Write the failing test**

```ts
import { vi } from 'vitest'

it('saveFriendSentiment 缓冲：debounce 窗口内多次写只触发一次 backend.set；flushNow 立即写', () => {
  const mem = makeMemBackend()
  const setSpy = vi.spyOn(mem, 'set')
  const s = makeStorage(mem)
  const f = (id: string): Friend => ({ ...baseFriend, id, msgCount: 30 })
  const before = setSpy.mock.calls.filter((c) => c[0] === 'nianlun:friendSentiment').length
  s.saveFriendSentiment('a', f('a'), { tone: '暖' } as any)
  s.saveFriendSentiment('b', f('b'), { tone: '冷' } as any)
  // flush 前：read-through 能读到；backend 尚未写入这张表
  expect(s.loadFriendSentiment('a', f('a'))?.data).toEqual({ tone: '暖' })
  expect(setSpy.mock.calls.filter((c) => c[0] === 'nianlun:friendSentiment').length).toBe(before)
  s.flushNow()
  const merged = mem.get('nianlun:friendSentiment') as Record<string, { data: unknown }>
  expect(merged.a.data).toEqual({ tone: '暖' })
  expect(merged.b.data).toEqual({ tone: '冷' })
})
```

> 若 `storage.test.ts` 里没有 `makeMemBackend`，用文件里既有的内存 backend 构造（该文件已有大量 `makeStorage(...)` 测试，复用其 backend 工厂）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts -t "缓冲"`
Expected: FAIL（`flushNow is not a function`，或断言 backend.set 未被推迟）

- [ ] **Step 3: Write minimal implementation**

在 `makeStorage` 内、`saveFriendEntry` 定义附近新增缓冲层，并把四个 `saveFriendXxx` 改为走缓冲。具体：

1. `makeStorage` 签名加参数：

```ts
export function makeStorage(
  backend: StorageBackend,
  fs: FsJsonBackend = makeKvFsJson(backend),
  schedule: (fn: () => void, ms: number) => { cancel: () => void } =
    (fn, ms) => { const t = setTimeout(fn, ms); return { cancel: () => clearTimeout(t) } },
) {
```

2. 在 `friendFp` 等定义之后加缓冲状态与函数：

```ts
  const FLUSH_MS = 800
  // 四张好友级表的写缓冲：key -> { id -> {data, fp} }。read-through：读时叠加在已存之上。
  const pending: Record<string, Record<string, { data: unknown; fp: string }>> = {}
  let flushHandle: { cancel: () => void } | null = null
  function scheduleFlush() {
    if (flushHandle) return
    flushHandle = schedule(() => { flushHandle = null; flushNow() }, FLUSH_MS)
  }
  function bufferFriendEntry(key: string, id: string, friend: Friend, data: unknown): void {
    const bucket = pending[key] ?? (pending[key] = {})
    bucket[id] = { data, fp: friendFp(friend) }
    scheduleFlush()
  }
  function flushNow(): void {
    const keys = Object.keys(pending)
    if (keys.length === 0) return
    for (const key of keys) {
      const merged = { ...loadFriendMap(key), ...pending[key] }
      backend.set(key, merged)
      delete pending[key]
    }
    if (flushHandle) { flushHandle.cancel(); flushHandle = null }
    fireChanged()   // 合并后的一次落盘 → 排一次防抖备份
  }
```

3. 让 `loadFriendMap` read-through 缓冲（改现有实现）：

```ts
  function loadFriendMap(key: string): Record<string, { data: unknown; fp: string }> {
    const raw = backend.get(key)
    const stored = raw && typeof raw === 'object' ? (raw as Record<string, { data: unknown; fp: string }>) : {}
    const buf = pending[key]
    return buf ? { ...stored, ...buf } : stored
  }
```

4. 把 `saveFriendEntry` 内部改为缓冲（替换其 body 里的 `backend.set(key, all)` 一段），或直接让四个 `saveFriendXxx` 调 `bufferFriendEntry`。最小改动：把 `saveFriendEntry` 重写为：

```ts
  function saveFriendEntry(key: string, id: string, friend: Friend, data: unknown): void {
    bufferFriendEntry(key, id, friend, data)   // 缓冲 + debounce flush（原整表同步写已下沉到 flushNow）
  }
```

5. 在 `return { ... }` 里暴露 `flushNow`：

```ts
    flushNow(): void { flushNow() },
```

> 注意：`saveReportEntry`（年度文案/全年情绪）与 `saveStockPicks` **不改**，仍立即写（不在本次范围）。`fireChanged` 从 `saveFriendEntry` 移到 `flushNow`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（新用例 + 既有用例。若既有用例直接断言 `backend.get('nianlun:friendXxx')` 而非经 `loadFriendXxx` 读，需在其 `save` 后补一句 `s.flushNow()`——按失败提示定位修正。）

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): 好友级 AI 结果改 debounce 合并写 + read-through 缓冲"
```

---

### Task 3: data 批量改好友 + storage 批量记 analyzedIds（防卡③）

role 自动分析要批量落盘，避免每人一次 `updateFriend` 的全数组深拷贝。新增一次改多人的批量方法，和一次记多个 analyzedIds 的方法。

**Files:**
- Modify: `packages/miniapp/src/stores/data.ts`
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/stores/__tests__/data.test.ts`、`packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Produces:
  - `data.updateFriendsBatch(patches: Array<{ id: string; role?: string; rel?: Relation }>): void`——对多个好友原地改 `role`/`rel` 并写 `userEdited`，**只做一次**深拷贝 + `saveFriends` + `fireSaved`。
  - `storage.addAnalyzedIds(ids: string[]): void`——把多个 id 并入 `analyzedIds`（去重）后一次写。

- [ ] **Step 1: Write the failing test**

`data.test.ts` 追加：

```ts
it('updateFriendsBatch 一次改多人 role/rel、写 userEdited，只保存一次', () => {
  const saveSpy = vi.fn()
  const storage = { ...memStorage, saveFriends: saveSpy } as any
  const useStore = createDataStore(storage, memRawStore)
  const s = useStore()
  s.friends = [mkFriend('a'), mkFriend('b'), mkFriend('c')] as any
  s.updateFriendsBatch([{ id: 'a', role: '同事' }, { id: 'b', rel: '挚友' }])
  expect(s.friends.find((f: any) => f.id === 'a').role).toBe('同事')
  expect(s.friends.find((f: any) => f.id === 'a').userEdited.role).toBe('同事')
  expect(s.friends.find((f: any) => f.id === 'b').rel).toBe('挚友')
  expect(saveSpy).toHaveBeenCalledTimes(1)   // 批量只写一次
})
```

`storage.test.ts` 追加：

```ts
it('addAnalyzedIds 并入去重后一次写', () => {
  const s = makeStorage(makeMemBackend())
  s.saveAnalyzedIds(['a'])
  s.addAnalyzedIds(['b', 'a', 'c'])
  expect(s.loadAnalyzedIds().sort()).toEqual(['a', 'b', 'c'])
})
```

> `memStorage`/`memRawStore`/`mkFriend` 沿用 `data.test.ts` 既有辅助。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/data.test.ts -t "updateFriendsBatch" src/adapters/__tests__/storage.test.ts -t "addAnalyzedIds"`
Expected: FAIL（方法不存在）

- [ ] **Step 3: Write minimal implementation**

`data.ts` 在 `updateFriend` 之后新增：

```ts
    function updateFriendsBatch(patches: Array<{ id: string; role?: string; rel?: Relation }>): void {
      let changed = false
      for (const p of patches) {
        const f = friends.value.find((x) => x.id === p.id)
        if (!f) continue
        if (p.role !== undefined) { f.role = p.role; f.userEdited.role = p.role; changed = true }
        if (p.rel !== undefined) { f.rel = p.rel; f.userEdited.rel = p.rel; changed = true }
      }
      if (!changed) return
      storage.saveFriends(JSON.parse(JSON.stringify(friends.value)))   // 整批只深拷贝+写一次
      fireSaved()
    }
```

并在 `return { ... }` 里加 `updateFriendsBatch`。

`storage.ts` 在 `saveAnalyzedIds`/`loadAnalyzedIds` 之后新增：

```ts
    addAnalyzedIds(ids: string[]): void {
      const cur = this.loadAnalyzedIds ? this.loadAnalyzedIds() : []
      const raw = backend.get(K_ANALYZED)
      const base = Array.isArray(raw) ? (raw as string[]) : []
      backend.set(K_ANALYZED, [...new Set([...base, ...ids])])
    },
```

> `addAnalyzedIds` 用 `backend.get(K_ANALYZED)` 自读，避免依赖 `this`；上面 `cur` 那行删掉，直接：

```ts
    addAnalyzedIds(ids: string[]): void {
      const raw = backend.get(K_ANALYZED)
      const base = Array.isArray(raw) ? (raw as string[]) : []
      backend.set(K_ANALYZED, [...new Set([...base, ...ids])])
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/data.test.ts src/adapters/__tests__/storage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/stores/data.ts packages/miniapp/src/adapters/storage.ts packages/miniapp/src/stores/__tests__/data.test.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): data 批量改好友 + storage 批量记 analyzedIds"
```

---

### Task 4: aiQueue 引擎（队列/并发/去重/插队/状态）

纯引擎，不认识具体功能：只调注入的 registry。核心是并发上限、去重、`prioritize` 对 running 为 no-op、`scan` 幂等、`stateFor` 从内存 done 集合读（不碰 storage）。

**Files:**
- Create: `packages/miniapp/src/stores/aiQueue.ts`
- Test: `packages/miniapp/src/stores/__tests__/aiQueue.test.ts`

**Interfaces:**
- Produces（引擎对外）：
  - `FeatureKey = 'role' | 'sentiment' | 'profile' | 'mbti' | 'relationDeep'`
  - `TaskState = 'idle' | 'queued' | 'running' | 'done'`
  - `createAiQueueStore(deps)` → Pinia store，暴露：
    - `scan(): void`
    - `prioritize(feature: FeatureKey, id: string): void`
    - `stateFor(feature: FeatureKey, id: string): TaskState`
    - `busy: ComputedRef<boolean>`
    - `flush(): void`（转调 deps.flush，供 App 退后台）
  - `deps: { getFriends: () => Friend[]; readDoneSets: () => Record<FeatureKey, Set<string>>; runTask: (feature: FeatureKey, friend: Friend) => Promise<boolean>; flush?: () => void; concurrency?: number }`
    - `readDoneSets`：一次性读全部 done 集合（内部用 Task 1 的整表读）。`runTask` 返回 `true`=有效结果已落盘。

- [ ] **Step 1: Write the failing test**

创建 `aiQueue.test.ts`：

```ts
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
    await Promise.resolve()
    expect(started).toBe(2)                 // 3 个任务，但同时只起 2
    gates[0].resolve(true); await Promise.resolve(); await Promise.resolve()
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
    s.scan(); await Promise.resolve()        // a 起跑，b、c 在队列
    s.prioritize('role', 'c')                // c 提到 b 前
    gates['a'].resolve(true); await Promise.resolve(); await Promise.resolve()
    expect(order).toEqual(['a', 'c'])        // a 之后是 c 不是 b
    gates['c'].resolve(true); gates['b'].resolve(true)
  })
})
```

> 引擎需暴露一个仅测试用的 `__setFeaturesForTest(features: FeatureKey[])`，让 `scan` 只对给定功能子集排队（生产用全 5 个）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/aiQueue.test.ts`
Expected: FAIL（`aiQueue` 模块不存在）

- [ ] **Step 3: Write minimal implementation**

创建 `aiQueue.ts`：

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/aiQueue.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/stores/aiQueue.ts packages/miniapp/src/stores/__tests__/aiQueue.test.ts
git commit -m "feat(miniapp): aiQueue 引擎（队列/并发/去重/插队/状态）"
```

---

### Task 5: aiQueue 登记表（5 功能真实接线）

把 5 个功能的「done 判定 / AI 调用 / 落盘」接到真实 `aiClient`、`storage`、`data`，并组装出生产单例 `useAiQueueStore`。role 走批量缓冲 + flush 时批量落盘。

**Files:**
- Create: `packages/miniapp/src/stores/aiQueueRegistry.ts`（纯函数：done 判定 + runTask 实现 + flush）
- Modify: `packages/miniapp/src/stores/aiQueue.ts`（导出生产单例 `useAiQueueStore`）
- Test: `packages/miniapp/src/stores/__tests__/aiQueueRegistry.test.ts`

**Interfaces:**
- Consumes: `aiClient.suggestFriend/analyzeFriendSentiment/analyzeFriendProfile/analyzeFriendMbti/analyzeRelationDeep`；`storage.loadAnalyzedIds/loadFriendSentimentMap/loadFriendProfileMap/loadFriendMbtiMap/loadRelationDeepMap/saveFriendSentiment/saveFriendProfile/saveFriendMbti/saveRelationDeep/addAnalyzedIds/flushNow`；`samples.loadSamplesFor`；`data.updateFriendsBatch`。
- Produces:
  - `makeAiQueueRegistry(deps) → { readDoneSets(): Record<FeatureKey,Set<string>>; runTask(feature, friend): Promise<boolean>; flush(): void }`
  - `useAiQueueStore`（生产单例，`createAiQueueStore` + 真实 registry + `getFriends: () => useDataStore().friends`）。

- [ ] **Step 1: Write the failing test**

创建 `aiQueueRegistry.test.ts`：

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/aiQueueRegistry.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

创建 `aiQueueRegistry.ts`：

```ts
import type { Friend } from '@nianlun/core'
import type { FeatureKey } from './aiQueue'

// 依赖以接口注入，便于测试；生产在 aiQueue.ts 里用真实 aiClient/storage/samples/data 组装。
export type RegistryDeps = {
  ai: {
    suggestFriend: (f: Friend, s: string[]) => Promise<{ rel?: string; role?: string }>
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
  updateFriendsBatch: (patches: Array<{ id: string; role?: string; rel?: any }>) => void
}

export function makeAiQueueRegistry(deps: RegistryDeps) {
  // role 批量缓冲：runTask 只暂存，flush 时一次落盘（防③全数组深拷贝频繁触发）。
  const rolePending: Array<{ id: string; role?: string; rel?: any }> = []
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
```

在 `aiQueue.ts` 末尾追加生产单例装配：

```ts
import { useDataStore } from './data'
import { storage } from '../adapters/storage'
import { samples } from '../adapters/samples'
import { aiClient } from '../adapters/aiClient'
import { makeAiQueueRegistry } from './aiQueueRegistry'

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
```

> `runTask` 完成后引擎会 `pump`；但 `flush`（把 role 批量与好友级缓冲落盘）由「队列排空」与「App 退后台」触发——见 Task 6，在引擎 `pump` 发现 `running.size===0 && order.length===0` 时调 `deps.flush?.()`。为此在 Task 4 的 `pump` 的 `finally` 之后补一行收尾 flush：把 `aiQueue.ts` 的 `pump()` 结尾改为：

```ts
    function pump(): void {
      while (running.size < concurrency && order.length > 0) { /* …如 Task 4… */ }
      if (running.size === 0 && order.length === 0) flush()   // 队列排空：把批量结果落盘
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/aiQueueRegistry.test.ts src/stores/__tests__/aiQueue.test.ts`
Expected: PASS（若队列排空 flush 影响了 Task 4 用例，给那些用例的 deps 传 `flush: () => {}` 即可——本任务顺带补齐）

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/stores/aiQueueRegistry.ts packages/miniapp/src/stores/aiQueue.ts packages/miniapp/src/stores/__tests__/
git commit -m "feat(miniapp): aiQueue 登记表 + 生产单例（5 功能接线，role 批量落盘）"
```

---

### Task 6: 接线触发——App 启动/导入后 scan，退后台 flush

**Files:**
- Modify: `packages/miniapp/src/App.vue`
- Modify: `packages/miniapp/src/stores/import.ts`（`run` 成功后 `scan`；移除自动 role，见 Task 10 先做最小接线）
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `useAiQueueStore().scan/flush`。
- Produces: 开机 `hydrate` 后触发 `scan()`；`import.run` 成功后触发 `scan()`；App `onHide` 触发 `storage.flushNow()`。

- [ ] **Step 1: Write the failing test**

`import.test.ts` 追加（注入一个 spy scan，断言导入成功后被调用）：

```ts
it('run 成功后触发 aiQueue.scan', async () => {
  const scan = vi.fn()
  const s = makeImportStore({ /* 既有注入 */ } as any)
  s.__setOnImported?.(scan)     // 见实现：import store 暴露一个可注入的 onImported 钩子
  await s.run([{ name: 'a.txt', content: SAMPLE_TXT }] as any, 2026)
  expect(scan).toHaveBeenCalled()
})
```

> 若不想给 import store 加钩子，另一种更简单做法：把「导入成功后 scan」放在**页面层**（`import.vue` 在 `imp.run` 成功后调 `useAiQueueStore().scan()`），则本测试改为不在 store 测、只在 Task 后用 `verify` 验证。**选定实现：走页面层**（store 保持纯、不引 aiQueue）。因此本 Step 的 store 测试**删除**，改为在 import.vue 接线（见 Step 3）。

- [ ] **Step 2: Run test to verify it fails**

（本任务无 store 单测；直接进入接线 + 构建验证。）
Run: `pnpm --filter @nianlun/miniapp exec vitest run`
Expected: PASS（现有测试不回归）

- [ ] **Step 3: Write minimal implementation**

`App.vue`：`hydrate` 之后启动 scan；`onHide` 时 flush。改 `<script setup>`：

```ts
import { onLaunch, onHide } from '@dcloudio/uni-app'
import { useAiQueueStore } from './stores/aiQueue'
// …既有 import…

onLaunch(async () => {
  // …既有清理 + wx.cloud.init…
  await useDataStore().hydrate()
  setTimeout(() => {
    // …既有备份接线/自动恢复…
    useAiQueueStore().scan()   // hydrate 完成后：把未分析的好友级功能入队后台跑
  }, 0)
})

onHide(() => { storage.flushNow() })   // App 退后台：把 debounce 缓冲立即落盘，避免丢结果
```

> 自动恢复分支里 `data.hydrate()` 之后也补一次 `useAiQueueStore().scan()`（云端恢复出好友后同样要排队）。在既有 `.then((ok) => { if (ok) return data.hydrate() })` 改为 `.then((ok) => ok ? data.hydrate().then(() => useAiQueueStore().scan()) : undefined)`。

`import.vue`：在导入成功后调 scan。找到调用 `imp.run(...)` 之后的成功处理，追加：

```ts
import { useAiQueueStore } from '../../stores/aiQueue'
// …run 成功（imp.status === 'done'）后：
useAiQueueStore().scan()
```

（具体位置：`import.vue` 里 `await imp.run(files, year)` 之后、`imp.status==='done'` 分支中追加一行 `useAiQueueStore().scan()`。）

- [ ] **Step 4: Run + build to verify**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（无回归）
Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无 TS 报错。

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/App.vue packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 开机 hydrate 后与导入成功后触发 aiQueue.scan，退后台 flush"
```

---

### Task 7: 好友列表页接入队列（role 按钮）

`friends.vue` 的「🪄 AI分析」（role）改走 `aiQueue`：按 `stateFor` 渲染、点击 `prioritize`、行内红点跟随 running。移除对 `imp.analyzeOne`/`imp.analyzingIds` 的依赖与 `useRelationDeepStore`。

**Files:**
- Modify: `packages/miniapp/src/pages/friends/friends.vue`
- 验证：构建 + verify（页面不做单测）

**Interfaces:**
- Consumes: `useAiQueueStore().stateFor('role', id)`、`prioritize('role', id)`、`busy`。

- [ ] **Step 1: 改 `<script setup>`**

替换顶部对 relationDeep/analyzeOne 的引用：

```ts
import { useAiQueueStore } from '../../stores/aiQueue'
// 删除：useRelationDeepBadge / useRelationDeepStore / 相关 rd
const queue = useAiQueueStore()

// role 按钮文案：idle→🪄 AI分析；queued→排队中…；running→分析中…；done→（不渲染）
function roleState(id: string) { return queue.stateFor('role', id) }
function onAnalyze(id: string) { queue.prioritize('role', id) }
```

> 红点/badge：本任务先移除 `useRelationDeepBadge()` 调用（Task 9 会给 badge 换到 aiQueue）。行内「正在分析」点用 `queue.stateFor('relationDeep', f.id) === 'running' || roleState(f.id) === 'running'` 决定是否显示，简化为：`queue.busy` 时不逐行显示，交由 Task 9 统一。**本任务先删除 `rd.activeId === f.id` 的行内红点**（避免悬空引用），Task 9 再补回基于 aiQueue 的行内态。

- [ ] **Step 2: 改模板 role 按钮块**

把原 `<view class="act act-ai" ...>AI分析</view>` 替换为按状态渲染：

```html
<view
  v-if="roleState(f.id) !== 'done'"
  class="act act-ai" :class="{ busy: roleState(f.id) !== 'idle' }"
  @click="onAnalyze(f.id)"
>
  <text class="act-t">{{ roleState(f.id) === 'running' ? '分析中…' : roleState(f.id) === 'queued' ? '排队中…' : '🪄 AI分析' }}</text>
</view>
```

删除模板里引用 `imp.analyzing`/`imp.analyzingIds`/`rd.activeId` 的块（顶部两个 ProgressBar 与行内 `deep-dot`）。顶部保留一个总进度提示（可选）：

```html
<ProgressBar v-if="queue.busy" indeterminate label="AI 分析进行中…" />
```

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无对已删符号（`imp.analyzeOne`/`rd`）的引用报错。

- [ ] **Step 4: Commit**

```bash
git add packages/miniapp/src/pages/friends/friends.vue
git commit -m "feat(miniapp): 好友列表 role 按钮接入 aiQueue（状态渲染+插队），已完成隐藏"
```

---

### Task 8: 好友详情页接入队列（情绪/画像/MBTI/深度关系）

四处手动分析改走 `aiQueue`：按 `stateFor` 渲染按钮、点击 `prioritize`、结果仍从 storage 读；**已完成（含过期）零按钮、零 stale 刷新入口**。命理运势整块不动。

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`
- 验证：构建 + verify

**Interfaces:**
- Consumes: `useAiQueueStore().stateFor(feature, id)`、`prioritize(feature, id)`。

- [ ] **Step 1: 改 `<script setup>`**

- 删除 `analyzeSentiment`/`analyzeProfile`/`analyzeMbti` 里「调 aiClient + save + loading ref」的逻辑；改为薄封装：

```ts
import { useAiQueueStore } from '../../stores/aiQueue'
const queue = useAiQueueStore()
const sentState = computed(() => queue.stateFor('sentiment', id.value))
const profState = computed(() => queue.stateFor('profile', id.value))
const mbtiState = computed(() => queue.stateFor('mbti', id.value))
const deepState = computed(() => queue.stateFor('relationDeep', id.value))
function analyzeSentiment() { queue.prioritize('sentiment', id.value) }
function analyzeProfile() { queue.prioritize('profile', id.value) }
function analyzeMbti() { queue.prioritize('mbti', id.value) }
function openRelationDeep() { uni.navigateTo({ url: `/pages/relation-deep/relation-deep?id=${encodeURIComponent(id.value)}` }) }
```

- 结果读取保持：`loadAiCache()`/`onShow` 里的 `storage.loadFriendSentiment/Profile/Mbti` 不变（read-through 会看到刚落盘或缓冲中的结果）。删除 `sentimentStale`/`profileStale`/`mbtiStale` 及其模板用途（已完成不再显示 stale 入口）。删除 `loadingSent`/`loadingProfile`/`loadingMbti`（改用 state computed）。
- `onShow` 里增补一句：分析进行中或完成后要刷新显示，可在 `watch(() => queue.busy, () => loadAiCache())` 里重载缓存（分析完成 → busy 变化 → 重读结果显示）。

- [ ] **Step 2: 改模板——情绪/画像 按钮行**

把 `edit-row` 里两个 act-ai 改为：

```html
<text v-if="sentState === 'idle'" class="act act-ai" @click="analyzeSentiment">✦ 情绪分析</text>
<text v-else-if="sentState !== 'done'" class="act act-ai busy">{{ sentState === 'running' ? '分析中…' : '排队中…' }}</text>
<!-- done：不渲染任何按钮 -->

<text v-if="profState === 'idle'" class="act act-ai" @click="analyzeProfile">✦ 好友画像</text>
<text v-else-if="profState !== 'done'" class="act act-ai busy">{{ profState === 'running' ? '生成中…' : '排队中…' }}</text>

<text v-if="deepState === 'idle'" class="act act-ai" @click="openRelationDeep">✦ 深度关系分析</text>
<text v-else-if="deepState === 'running'" class="act act-ai busy">分析中…</text>
<text v-else-if="deepState === 'queued'" class="act act-ai busy">排队中…</text>
<!-- deep done：入口消失（结果在 relation-deep 页看） -->
```

进度条块 `v-if="loadingSent || loadingProfile"` 改为 `v-if="sentState === 'running' || profState === 'running'"`。

- [ ] **Step 3: 改模板——情绪结果/画像结果/MBTI 块**

- 情绪结果块：删除 `<text v-if="sentimentStale" ...>数据已更新…</text>` 那行；其余按 `v-if="sentiment"` 展示不变。
- 画像块：删除 `<text v-if="profileStale" ...>`。
- MBTI 块：删除 `<text v-if="mbtiStale ..." ...>` stale 行；把底部 `mbti-acts` 里的 AI 按钮改为：

```html
<text
  v-if="(mbtiEff.source === 'none') && mbtiState === 'idle'"
  class="act act-ai" @click="analyzeMbti"
>✦ AI 分析 MBTI</text>
<text
  v-else-if="mbtiEff.source !== 'ai' && (mbtiState === 'running' || mbtiState === 'queued')"
  class="act act-ai busy"
>{{ mbtiState === 'running' ? '分析中…' : '排队中…' }}</text>
<!-- 已有 AI 结果（source==='ai'，即 done）或手动设定：不显示 AI 分析按钮 -->
```

「✎ 手动设置」picker 保留不变（那是手动编辑，非 AI 分析按钮）。MBTI 进度条 `v-if="loadingMbti"` 改 `v-if="mbtiState === 'running'"`。

> 命理运势整块（含「AI 从聊天抽取」「生成/刷新」）**保持原样不动**。

- [ ] **Step 4: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无对已删 ref（`loadingSent`/`sentimentStale` 等）的引用残留。

- [ ] **Step 5: Commit**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情四项分析接入 aiQueue，已完成/过期零按钮"
```

---

### Task 9: 深度关系页接入队列 + 退休 relationDeep store + badge 换源

`relation-deep.vue` 改读 `aiQueue`（`prioritize('relationDeep', id)` + `stateFor` + 结果从 storage 读）；`useRelationDeepBadge` 改监听 `aiQueue.busy`；删除 `stores/relationDeep.ts` 及其测试。

**Files:**
- Modify: `packages/miniapp/src/pages/relation-deep/relation-deep.vue`
- Modify: `packages/miniapp/src/composables/useRelationDeepBadge.ts`
- Modify: `packages/miniapp/src/pages/friends/friends.vue`（补回基于 aiQueue 的红点 + 恢复 badge 调用）
- Delete: `packages/miniapp/src/stores/relationDeep.ts`、`packages/miniapp/src/stores/__tests__/relationDeep.test.ts`
- 验证：构建 + verify

**Interfaces:**
- Consumes: `useAiQueueStore().stateFor('relationDeep', id)`、`prioritize('relationDeep', id)`、`busy`。

- [ ] **Step 1: 改 `relation-deep.vue`**

替换 `rd`（relationDeep store）相关：

```ts
import { useAiQueueStore } from '../../stores/aiQueue'
const queue = useAiQueueStore()
const state = computed(() => queue.stateFor('relationDeep', friend.value?.id ?? ''))
const loading = computed(() => state.value === 'running' || state.value === 'queued')

function generate() {
  const f = friend.value
  if (!f) return
  queue.prioritize('relationDeep', f.id)   // 插队优先跑
}
// 完成后重载缓存显示：分析结束（busy 变化）时若本好友已 done → loadCache
watch(() => queue.busy, () => { loadCache(); nextTick(drawSecurity) })
```

删除对 `rd.progress`/`rd.completion`/`rd.runningFor`/`rd.start` 的使用；模板里 `ProgressBar` 改 `indeterminate`：

```html
<ProgressBar v-if="loading" indeterminate :label="state === 'queued' ? '排队中…' : '分析中…'" />
```

按钮区（`head`）按「已完成隐藏」规则：

```html
<text v-if="!deep && state === 'idle'" class="act" @click="generate">✦ 生成深度关系分析</text>
<text v-else-if="!deep && state !== 'done'" class="act">{{ state === 'queued' ? '排队中…' : '分析中…' }}</text>
<!-- 有结果(deep)：不显示「重新生成」；删除 stale 行；保留「📥 保存长海报」 -->
<text v-if="deep" class="act" @click="drawPoster">📥 保存长海报</text>
```

删除 `<text v-if="stale" ...>数据已更新…</text>` 行与 `stale` ref。

- [ ] **Step 2: 改 `useRelationDeepBadge.ts`**

把数据源从 `useRelationDeepStore().busy` 换成 `useAiQueueStore().busy`：

```ts
import { useAiQueueStore } from '../stores/aiQueue'
export function useRelationDeepBadge() {
  const queue = useAiQueueStore()
  const visible = ref(false)
  function apply() {
    if (!visible.value) return
    try {
      if (queue.busy) uni.showTabBarRedDot({ index: FRIENDS_TAB_INDEX })
      else uni.hideTabBarRedDot({ index: FRIENDS_TAB_INDEX })
    } catch { /* 兜底 */ }
  }
  onShow(() => { visible.value = true; apply() })
  onHide(() => { visible.value = false })
  watch(() => queue.busy, apply)
}
```

（可顺带把文件/函数名保留不变，避免连锁改名；仅换内部数据源。）

- [ ] **Step 3: `friends.vue` 恢复 badge + 行内红点换源**

在 Task 7 里临时删掉的 `useRelationDeepBadge()` 调用恢复；行内「正在分析该好友」红点改判 aiQueue：

```ts
import { useRelationDeepBadge } from '../../composables/useRelationDeepBadge'
useRelationDeepBadge()
function analyzingRow(id: string) {
  return ['role','sentiment','profile','mbti','relationDeep'].some(
    (f) => queue.stateFor(f as any, id) === 'running',
  )
}
```

模板行内红点：`<view v-if="analyzingRow(f.id)" class="deep-dot" />`。

- [ ] **Step 4: 删除 relationDeep store 及测试**

```bash
git rm packages/miniapp/src/stores/relationDeep.ts packages/miniapp/src/stores/__tests__/relationDeep.test.ts
```

全局搜索确认无残留引用：

Run: `pnpm --filter @nianlun/miniapp exec vitest run` 前先 grep。
Grep: `useRelationDeepStore|createRelationDeepStore|stores/relationDeep` 应无命中（除已改的 badge 文件已换源）。

- [ ] **Step 5: 测试 + 构建验证**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（relationDeep.test.ts 已删；其余不回归）
Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功。

- [ ] **Step 6: Commit**

```bash
git add -A packages/miniapp/src/pages/relation-deep packages/miniapp/src/composables packages/miniapp/src/pages/friends packages/miniapp/src/stores
git commit -m "feat(miniapp): 深度关系页接入 aiQueue，退休 relationDeep store，badge 换源"
```

---

### Task 10: import store 清理——移除自动 role/手动 analyzeOne 与门槛

role 分析已并入 aiQueue，`import.ts` 里 `analyzePendingRoles`、`analyzeOne`、`ROLE_MIN_MSGS` 及 `analyzing`/`analyzingIds` 状态不再需要（股票相关保留）。同步清掉引用它们的测试。

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`
- Modify: `packages/miniapp/src/stores/__tests__/import.test.ts`（删除 role 相关用例，保留股票/导入用例）
- 验证：测试 + 构建

**Interfaces:**
- Produces: `import` store 不再暴露 `analyzePendingRoles`/`analyzeOne`/`analyzing`/`analyzingIds`；保留 `run`/`beginReading`/`analyzeStocks`/`analyzingStocks`/`reset` 等。

- [ ] **Step 1: 删测试再看红**

在 `import.test.ts` 删除所有针对 `analyzePendingRoles`/`analyzeOne`/`analyzedIds` 门槛（`ROLE_MIN_MSGS`）的用例（保留 `run` 导入流程、`analyzeStocks` 用例）。

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: 可能 FAIL（引用了将删的方法）——即将删实现使之一致。

- [ ] **Step 2: 删实现**

从 `import.ts` 移除：`ROLE_MIN_MSGS`、`analysisWarn`、`analyzePendingRoles`、`analyzeOne`、`analyzing`、`analyzingIds`、`roleAnalysis` import、`suggest`/`loadSamples` 若仅被上述使用则一并移除（`extractStocks` 仍需 `loadSamples`？核对：`analyzeStocks` 用 `runAnalyzeStocks` 自取会话，不依赖 `loadSamples`；`suggest` 只被 role 用 → 删）。`return { ... }` 去掉 `analyzing`/`analyzingIds`/`analyzePendingRoles`/`analyzeOne`。

> `roleAnalysis.ts` 适配器：若已无引用可一并 `git rm`（连同其测试）。先 grep `analyzeRolesForNew|roleAnalysis`，无其它引用则删除 `packages/miniapp/src/adapters/roleAnalysis.ts` 与 `__tests__/roleAnalysis.test.ts`。

- [ ] **Step 3: 测试 + 构建**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS
Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无对已删符号的引用（尤其 `friends.vue` 已在 Task 7 去掉 `imp.analyzeOne`）。

- [ ] **Step 4: Commit**

```bash
git add -A packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts packages/miniapp/src/adapters
git commit -m "refactor(miniapp): role 分析并入 aiQueue，移除 import 自动/手动 role 与门槛"
```

---

### Task 11: 全量回归 + 真机/开发者工具 verify

**Files:** 无（验证任务）

- [ ] **Step 1: 全仓测试**

Run: `pnpm -r test`
Expected: 全绿。

- [ ] **Step 2: 构建**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 成功。

- [ ] **Step 3: verify（微信开发者工具 / 真机）**

用 `verify` skill 驱动真实流程，逐条确认：
1. 有历史数据时**打开小程序**：后台开始自动分析（好友 tab 出现红点），不卡、可正常滑动/点按。
2. **进入好友详情页**：已分析的功能直接显示结果、**无分析按钮**；未分析的显示【✦ 分析】。
3. **手动点某未分析功能**：该功能变【分析中…】，插队优先完成；不产生重复调用（对同一功能连点无效）。
4. **过期场景**（重新导入后进已分析好友）：旧结果静态显示、**无任何刷新按钮**。
5. **关掉再开**：已完成的不重跑，未跑完的继续。
6. 报告页（年度文案/全年情绪）、命理、股票**行为一如既往**。

- [ ] **Step 4: 若发现卡顿**

按 `[perf]` 插桩定位是否仍有高频整表写/深拷贝；确认 `flushNow` 生效（`onHide`/队列排空）、`scan` 只 5 次整表读。修正后回到 Step 1。

- [ ] **Step 5: 收尾**

清理排查用 `[perf]` 插桩（若本次触碰到）。提交：

```bash
git add -A
git commit -m "chore(miniapp): 自动分析队列全量回归与真机验证收尾"
```

---

## Self-Review

**Spec coverage：**
- 范围（好友级 5 功能纳入、报告/命理/股票排除）→ Task 4/5（FRIEND_FEATURES）、Task 8（命理不动）、Task 10（股票保留）。✅
- 单例 aiQueue + 并发 2 + scan/pump/prioritize/stateFor → Task 4/5。✅
- 去重三道防线（持久缓存 done、队列 key、prioritize 对 running no-op）→ Task 4（用例覆盖）+ Task 5（readDoneSets/落盘）。✅
- 空/失败不落盘可重试 → Task 5（runTask 返回 false 不计 done）。✅
- 过期不重跑 → done 判定用「缓存非 null」，Task 5 readDoneSets 用 map keys（含过期项）。✅
- 按钮规则：idle 显示 / queued/running 状态字 / done 零按钮（含过期零 stale 入口）→ Task 7/8/9。✅
- 防卡①整表批量读 → Task 1 + Task 4 scan。防卡② debounce 合并写 → Task 2。防卡③ role 批量写 → Task 3 + Task 5。防卡④细粒度 setData（stateFor 读内存 done 集、不碰 storage）→ Task 4。✅
- 触发：hydrate 后 scan、导入后 scan、退后台 flush → Task 6。✅
- 归并：退休 relationDeep store（Task 9）、role 并入去门槛（Task 10）、页面改 prioritize（Task 7/8/9）。✅
- 验收 verify → Task 11。✅

**Placeholder scan：** 各步含真实代码/命令；无 TBD/TODO。Task 6 Step 1 明确「改走页面层、删除该 store 测试」而非留空。✅

**Type consistency：** `FeatureKey`（Task 4）在 5/7/8/9 一致；`stateFor(feature,id): TaskState`、`prioritize(feature,id)`、`readDoneSets(): Record<FeatureKey,Set<string>>`、`runTask(feature,friend): Promise<boolean>`、`flush()`、`storage.flushNow()`、`data.updateFriendsBatch(patches)`、`storage.addAnalyzedIds(ids)` 全篇一致。✅

**已知风险 / 实现时注意：**
- Task 2 read-through 与既有 storage 测试可能冲突（直接断言 backend 的用例需补 `flushNow()`）——Step 4 已提示按失败定位修正。
- Task 6 决定「导入后 scan 放页面层」，故 import store 保持不引 aiQueue，避免循环依赖（aiQueue 已 import data/samples/aiClient；不引 import）。
- `friends.vue` role 完成后标签（rel/role）在 role 批量 flush（队列排空或退后台）后才更新，≤ 一次 flush 延迟，属预期。
