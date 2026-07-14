# 深度关系分析后台化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把深度关系分析的发起/进度/结果状态从页面提升到跨页面存活的全局单例，离开页面分析继续跑、跑完落盘，并在「好友」tab 用红点做全局提示。

**Architecture:** 新增 Pinia 工厂单例 `stores/relationDeep.ts`（依赖注入 `ai`/`storage`/`tabBadge`/`tick`）托管单任务分析生命周期；页面 `relation-deep.vue` 删除本地 loading/进度/定时器，改绑 store 状态并 `watch` 完成信号。

**Tech Stack:** Vue 3 (`<script setup>`) + Pinia + uni-app（`@dcloudio/uni-app` 生命周期）+ Vitest（`vi.useFakeTimers`）。

## Global Constraints

- 只改 miniapp 层，**不动** `@nianlun/core`、`aiClient`、云函数、storage 接口（复用现有 `saveRelationDeep`/`loadRelationDeep`）。
- 所有代码注释与文案用中文，匹配现有代码风格。
- 单任务：全局同一时刻只跑一个深度分析；正在跑时对另一好友 `start` 返回 `'busy'`。
- store 用工厂 + 依赖注入模式（参照 [chatQa.ts](../../../packages/miniapp/src/stores/chatQa.ts)），单例导出 `useRelationDeepStore`。
- store 单测不得触真 `uni`/云函数/wx；`ai`/`storage`/`tabBadge` 全部注入 fake。
- 进度用现成 `stepProgress`（[progressBarLogic.ts](../../../packages/miniapp/src/components/progressBarLogic.ts)），完成补 100。
- 全局提示 = 「好友」tab（tabBar index **2**）红点：`start` 亮、完成/失败清；uni tabBar 调用 try/catch 兜底。
- 现有 `storage.saveRelationDeep(id, friend, data)` / `loadRelationDeep(id, friend)` 签名不变。
- 现有 `aiClient.analyzeRelationDeep(friend, samples): Promise<RelationDeep>` 签名不变，三段串行逻辑保留在 aiClient。
- 提交信息末尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

## File Structure

- **Create** `packages/miniapp/src/stores/relationDeep.ts` — 分析生命周期单例 store。
- **Create** `packages/miniapp/src/stores/__tests__/relationDeep.test.ts` — store 单测。
- **Modify** `packages/miniapp/src/pages/relation-deep/relation-deep.vue` — 删本地状态，改绑 store。

---

## Task 1: `relationDeep` store（含单测）

**Files:**
- Create: `packages/miniapp/src/stores/relationDeep.ts`
- Test: `packages/miniapp/src/stores/__tests__/relationDeep.test.ts`

**Interfaces:**
- Consumes:
  - `aiClient.analyzeRelationDeep(friend: Friend, samples: string[]): Promise<RelationDeep>` from `../adapters/aiClient`
  - `storage.saveRelationDeep(id: string, friend: Friend, data: RelationDeep): void` from `../adapters/storage`
  - `stepProgress(current: number, cap?: number, k?: number): number` from `../components/progressBarLogic`
- Produces（页面依赖，签名固定）：
  - `createRelationDeepStore(deps?: Deps): StoreDefinition`
  - `useRelationDeepStore` = `createRelationDeepStore()`
  - 实例字段：`activeId: string | null`、`progress: number`、`completion: Completion | null`
  - 实例方法：`runningFor(id: string): boolean`、`busy: boolean`（getter）、`start(friend: Friend, samples: string[]): 'started' | 'busy'`
  - 类型：
    ```ts
    type Completion = { id: string; status: 'ok' | 'empty' | 'error'; message?: string }
    type AnalyzeFn = (friend: Friend, samples: string[]) => Promise<RelationDeep>
    type StorageDep = { saveRelationDeep: (id: string, friend: Friend, data: RelationDeep) => void }
    type TabBadge = { show: () => void; hide: () => void }
    type Deps = { ai?: AnalyzeFn; storage?: StorageDep; tabBadge?: TabBadge; tick?: number }
    ```

- [ ] **Step 1: 写失败测试**

Create `packages/miniapp/src/stores/__tests__/relationDeep.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createRelationDeepStore } from '../relationDeep'
import type { Friend, RelationDeep } from '@nianlun/core'

const friend = (id: string) => ({ id, name: id } as unknown as Friend)

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function setup(ai: (f: Friend, s: string[]) => Promise<RelationDeep>) {
  const saveRelationDeep = vi.fn()
  const tabBadge = { show: vi.fn(), hide: vi.fn() }
  const store = createRelationDeepStore({ ai, storage: { saveRelationDeep }, tabBadge, tick: 10 })()
  return { store, saveRelationDeep, tabBadge }
}

describe('relationDeep store', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('start 设 activeId、runningFor 命中、亮红点', () => {
    const { store, tabBadge } = setup(() => deferred<RelationDeep>().promise)
    const r = store.start(friend('a'), [])
    expect(r).toBe('started')
    expect(store.activeId).toBe('a')
    expect(store.runningFor('a')).toBe(true)
    expect(store.runningFor('b')).toBe(false)
    expect(store.busy).toBe(true)
    expect(tabBadge.show).toHaveBeenCalledTimes(1)
  })

  it('正在跑时再 start 另一好友 → busy、不调 ai 第二次', () => {
    const ai = vi.fn(() => deferred<RelationDeep>().promise)
    const { store } = setup(ai)
    store.start(friend('a'), [])
    const r = store.start(friend('b'), [])
    expect(r).toBe('busy')
    expect(store.activeId).toBe('a')
    expect(ai).toHaveBeenCalledTimes(1)
  })

  it('成功：落盘、completion=ok、清 activeId、灭红点', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep, tabBadge } = setup(() => d.promise)
    const f = friend('a')
    store.start(f, ['s1'])
    d.resolve({ overall: '整体不错' })
    await vi.waitFor(() => expect(store.completion?.status).toBe('ok'))
    expect(saveRelationDeep).toHaveBeenCalledWith('a', f, { overall: '整体不错' })
    expect(store.completion).toEqual({ id: 'a', status: 'ok' })
    expect(store.activeId).toBe(null)
    expect(store.progress).toBe(100)
    expect(tabBadge.hide).toHaveBeenCalledTimes(1)
  })

  it('空结果：不落盘、completion=empty', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep } = setup(() => d.promise)
    store.start(friend('a'), [])
    d.resolve({})
    await vi.waitFor(() => expect(store.completion?.status).toBe('empty'))
    expect(saveRelationDeep).not.toHaveBeenCalled()
    expect(store.completion).toEqual({ id: 'a', status: 'empty' })
    expect(store.activeId).toBe(null)
  })

  it('异常：completion=error 带 message、不落盘、灭红点', async () => {
    const d = deferred<RelationDeep>()
    const { store, saveRelationDeep, tabBadge } = setup(() => d.promise)
    store.start(friend('a'), [])
    d.reject(new Error('上游挂了'))
    await vi.waitFor(() => expect(store.completion?.status).toBe('error'))
    expect(store.completion).toEqual({ id: 'a', status: 'error', message: '上游挂了' })
    expect(saveRelationDeep).not.toHaveBeenCalled()
    expect(store.activeId).toBe(null)
    expect(tabBadge.hide).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/relationDeep.test.ts`
Expected: FAIL —— 报 `Failed to resolve import "../relationDeep"` 或 `createRelationDeepStore is not a function`。

- [ ] **Step 3: 写最小实现**

Create `packages/miniapp/src/stores/relationDeep.ts`:

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, RelationDeep } from '@nianlun/core'
import { aiClient } from '../adapters/aiClient'
import { storage as defaultStorage } from '../adapters/storage'
import { stepProgress } from '../components/progressBarLogic'

export type Completion = { id: string; status: 'ok' | 'empty' | 'error'; message?: string }
type AnalyzeFn = (friend: Friend, samples: string[]) => Promise<RelationDeep>
type StorageDep = { saveRelationDeep: (id: string, friend: Friend, data: RelationDeep) => void }
type TabBadge = { show: () => void; hide: () => void }
type Deps = { ai?: AnalyzeFn; storage?: StorageDep; tabBadge?: TabBadge; tick?: number }

// 「好友」tab 在 pages.json tabBar.list 里的下标（导入0/概览1/好友2/二级市场3/报告4）。
const FRIENDS_TAB_INDEX = 2

// 默认全局提示：好友 tab 红点。uni tabBar API 在非预期时机可能抛错 → try/catch 兜底，不影响分析主流程。
const defaultTabBadge: TabBadge = {
  show: () => { try { uni.showTabBarRedDot({ index: FRIENDS_TAB_INDEX }) } catch { /* 忽略 */ } },
  hide: () => { try { uni.hideTabBarRedDot({ index: FRIENDS_TAB_INDEX }) } catch { /* 忽略 */ } },
}

// 工厂：测试注入 fake ai/storage/tabBadge/tick；运行时用真实依赖。
// 跨页面存活的单例，托管「单任务」深度分析生命周期——离开页面分析继续跑、跑完落盘。
export function createRelationDeepStore(deps: Deps = {}) {
  const ai: AnalyzeFn = deps.ai ?? aiClient.analyzeRelationDeep
  const store: StorageDep = deps.storage ?? defaultStorage
  const tabBadge: TabBadge = deps.tabBadge ?? defaultTabBadge
  const tick = deps.tick ?? 400

  return defineStore('relationDeep', () => {
    const activeId = ref<string | null>(null)
    const progress = ref(0)
    const completion = ref<Completion | null>(null)
    const busy = computed(() => activeId.value !== null)
    function runningFor(id: string) { return activeId.value === id }

    let timer: ReturnType<typeof setInterval> | null = null
    function startProgress() {
      progress.value = 0
      stopProgress()
      timer = setInterval(() => { progress.value = stepProgress(progress.value) }, tick)
    }
    function stopProgress() { if (timer) { clearInterval(timer); timer = null } }

    // 单任务：忙则拒绝，不打断正在跑的那个。返回 'started' | 'busy'。
    function start(friend: Friend, samples: string[]): 'started' | 'busy' {
      if (busy.value) return 'busy'
      const id = friend.id
      activeId.value = id
      completion.value = null
      startProgress()
      tabBadge.show()
      void run(id, friend, samples)
      return 'started'
    }

    async function run(id: string, friend: Friend, samples: string[]) {
      try {
        const deep = await ai(friend, samples)
        if (Object.keys(deep).length > 0) {
          store.saveRelationDeep(id, friend, deep)   // 仅有效结果落盘
          completion.value = { id, status: 'ok' }
        } else {
          completion.value = { id, status: 'empty' } // 空结果不落盘，允许重试
        }
      } catch (e) {
        completion.value = { id, status: 'error', message: (e as Error).message }
      } finally {
        stopProgress()
        progress.value = 100
        tabBadge.hide()
        activeId.value = null
      }
    }

    return { activeId, progress, completion, busy, runningFor, start }
  })
}

export const useRelationDeepStore = createRelationDeepStore()
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/relationDeep.test.ts`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/stores/relationDeep.ts packages/miniapp/src/stores/__tests__/relationDeep.test.ts
git commit -m "feat(miniapp): 新增 relationDeep store 托管深度分析后台生命周期"
```

---

## Task 2: 页面改绑 store

**Files:**
- Modify: `packages/miniapp/src/pages/relation-deep/relation-deep.vue`

**Interfaces:**
- Consumes: `useRelationDeepStore`（Task 1 产出）的 `activeId` / `progress` / `completion` / `runningFor(id)` / `start(friend, samples)`。

> 本任务改动集中在 `<script setup>` 顶部逻辑与模板的进度条/按钮绑定；`drawSecurity` / 海报导出等其它逻辑不动。relation-deep.vue 现无组件测试，本任务靠 Task 1 的 store 单测 + Task 3 的手动验证保障。

- [ ] **Step 1: 引入 store、删除本地进度状态**

在 `packages/miniapp/src/pages/relation-deep/relation-deep.vue` 的 `<script setup>` 中：

改导入（第 2-3 行区域）——把 `nextTick` 保留，`onUnload` 用不到了可留可删；新增 `watch`，并 import store：

```ts
import { ref, computed, nextTick, watch } from 'vue'
import { onLoad, onReady, onShow } from '@dcloudio/uni-app'
```

在 `import { storage } from '../../adapters/storage'` 附近新增：

```ts
import { useRelationDeepStore } from '../../stores/relationDeep'
```

删除这段本地进度实现（原 [relation-deep.vue:21-35](../../../packages/miniapp/src/pages/relation-deep/relation-deep.vue#L21-L35)）：

```ts
const loading = ref(false)

// 深度分析是两次并行 AI 调用……（整段注释）
const progress = ref(0)
let progressTimer: ReturnType<typeof setInterval> | null = null
function startProgress() {
  progress.value = 0
  stopProgress()
  progressTimer = setInterval(() => { progress.value = stepProgress(progress.value) }, 400)
}
function stopProgress() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
}
onUnload(stopProgress)
```

替换为（进度/loading 改由 store 提供）：

```ts
const rd = useRelationDeepStore()
const loading = computed(() => rd.runningFor(friend.value?.id ?? ''))
const progress = computed(() => rd.progress)
```

同时删掉不再需要的 import：`stepProgress` from `'../../components/progressBarLogic'` 已无本地使用，删除该行 import。

- [ ] **Step 2: 改写 `generate()`，交给 store，并 watch 完成信号**

把原 `generate()`（原 [relation-deep.vue:44-67](../../../packages/miniapp/src/pages/relation-deep/relation-deep.vue#L44-L67)）整段替换为：

```ts
function generate() {
  const f = friend.value
  if (!f) return
  const s = samples.loadSamplesFor(f.id)
  const r = rd.start(f, s)
  if (r === 'busy') {
    uni.showToast({ title: '已有分析进行中，请稍候', icon: 'none' })
  }
}

// 记录本页是否可见，避免完成信号在别的页面误弹 toast。
const visible = ref(false)

// 后台分析完成信号：命中当前好友时按状态反应。
watch(() => rd.completion, (c) => {
  const f = friend.value
  if (!c || !f || c.id !== f.id) return
  if (c.status === 'ok') { loadCache(); nextTick(drawSecurity) }
  else if (c.status === 'empty') { deep.value = { overall: 'AI 无法生成深度关系分析' } }
  else if (c.status === 'error' && visible.value) { uni.showToast({ title: c.message, icon: 'none' }) }
})
```

- [ ] **Step 3: 维护 `visible`，`onShow` 保留 loadCache**

把原 `onShow(...)`（原 [relation-deep.vue:102](../../../packages/miniapp/src/pages/relation-deep/relation-deep.vue#L102)）替换为：

```ts
onShow(() => { visible.value = true; loadCache(); nextTick(drawSecurity) })
onHide(() => { visible.value = false })
```

并把 `onHide` 加入 `@dcloudio/uni-app` 的 import：

```ts
import { onLoad, onReady, onShow, onHide } from '@dcloudio/uni-app'
```

- [ ] **Step 4: 类型检查 + 跑现有 miniapp 测试确保无回归**

Run: `pnpm --filter @nianlun/miniapp exec vitest run`
Expected: PASS（含 Task 1 新增用例，其余原有用例不受影响）。

若项目配了类型检查脚本，另跑一次构建期类型检查（可选）：
Run: `pnpm --filter @nianlun/miniapp build`
Expected: 无 TS 报错（若本机无 uni 构建环境跳过，交由 Task 3 真机/开发者工具验证）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/relation-deep/relation-deep.vue
git commit -m "feat(miniapp): 深度分析页改绑 relationDeep store，离开页面继续跑"
```

---

## Task 3: 手动验证（微信开发者工具/真机）

**Files:** 无（验证任务）。

> 自动化测试覆盖 store 逻辑，但「离开页面继续跑 + tabBar 红点 + 回来看结果」是运行时行为，需在微信开发者工具或真机走一遍。

- [ ] **Step 1: 构建并在微信开发者工具打开**

Run: `pnpm --filter @nianlun/miniapp build`（或项目既有的 dev 构建命令），用微信开发者工具打开 `dist/dev/mp-weixin`（以项目实际产物路径为准）。

- [ ] **Step 2: 逐项验证清单**

- [ ] 进入某好友的「深度关系分析」页，点「生成」→ 进度条从 0 开始爬升。
- [ ] 生成过程中返回到「好友」tab → 观察 tabBar「好友」项出现**红点**。
- [ ] 等待约几十秒后再进入该好友深度分析页 → 结果已显示（或进度条仍在、随后自动填结果），红点消失。
- [ ] 分析进行中，进入**另一**好友深度分析页点「生成」→ toast「已有分析进行中，请稍候」，不打断第一个。
- [ ] 断网或触发失败 → 页面 toast 错误信息，红点消失，可重试。

- [ ] **Step 3: 记录结果**

若全部通过，在此打勾并结束。若发现问题，回到对应 Task 修复后重跑本清单。

---

## Self-Review

- **Spec 覆盖**：单任务 store（Task 1）✓；页面改绑 + busy toast + watch 完成信号 + onShow（Task 2）✓；tabBar 红点全局提示（Task 1 `defaultTabBadge` + `start/finally`）✓；error toast 仅本页可见（Task 2 `visible`）✓；不改 core/aiClient/云函数（Global Constraints）✓；测试覆盖 started/busy/ok/empty/error + 落盘（Task 1 Step 1）✓。
- **占位符扫描**：无 TBD/TODO，所有代码步骤含完整代码。
- **类型一致性**：`createRelationDeepStore`/`useRelationDeepStore`/`start`/`runningFor`/`activeId`/`progress`/`completion` 在 Task 1 定义、Task 2 消费，命名一致；`Completion` 三态 `ok|empty|error` 全链路一致；`saveRelationDeep(id, friend, data)` 与 storage 实际签名一致。
