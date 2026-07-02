# 导入后自动批量分析职务/关系 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉手动「✦ 智能建议」按钮；每次导入完成后自动对「新导入、未分析过」的好友逐个 AI 推断并写入关系+职务，记住已分析、不重复。

**Architecture:** 全部在 miniapp（core 不变，复用 `aiClient.suggestFriend`）。新增 storage 的 analyzedIds 存取、一个纯编排 adapter `roleAnalysis.ts`、import store 在导入成功后调用它并驱动进度、两页删按钮、导入页显示分析进度。

**Tech Stack:** TypeScript、Vitest、Vue 3（uni-app mp-weixin）。

## Global Constraints

- 注释/文案用**中文**。
- `@nianlun/core` 纯函数库：不碰 DOM/window/网络/vue（本计划**不改 core**）。
- 依赖链严格 miniapp → core。
- 只用**有界样本**（`samples.loadSamplesFor`），不改「聊天原文不落盘」铁律。
- **增量**：只分析不在 `analyzedIds` 集合里的好友；空结果/异常不计入集合（下次导入重试）。
- 串行调用，避免并发打爆云函数。
- mp-weixin 模板不用可选链 `?.`，用 `a && a.b`。
- **Windows 上用 PowerShell 跑 build/test**（Git Bash 的 locale 会把产物中文写成 `?`）。

---

### Task 1: miniapp storage — analyzedIds 存取

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Produces: `storage.saveAnalyzedIds(ids: string[]): void`、`storage.loadAnalyzedIds(): string[]`（键 `nianlun:analyzedIds`；缺键/类型不符返回 `[]`）。`clearAll` 也清该键。

- [ ] **Step 1: 写失败测试**（`storage.test.ts` 末尾追加）

```typescript
it('analyzedIds 存取；缺键返回 []，clearAll 清除', () => {
  const m = new Map<string, unknown>()
  const s = makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
  expect(s.loadAnalyzedIds()).toEqual([])
  s.saveAnalyzedIds(['a', 'b'])
  expect(s.loadAnalyzedIds()).toEqual(['a', 'b'])
  s.clearAll()
  expect(s.loadAnalyzedIds()).toEqual([])
})
```

（`storage.test.ts` 顶部已 `import { makeStorage } from '../storage'`；若无则加。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL（`loadAnalyzedIds is not a function`）

- [ ] **Step 3: 实现**（`storage.ts`）

顶部常量区加：`const K_ANALYZED = 'nianlun:analyzedIds'`

在 `makeStorage` 返回对象里（`loadRecentSamples` 之后、`clearAll` 之前）加：
```typescript
    saveAnalyzedIds(ids: string[]): void { backend.set(K_ANALYZED, ids) },
    loadAnalyzedIds(): string[] {
      const raw = backend.get(K_ANALYZED)
      return Array.isArray(raw) ? (raw as string[]) : []
    },
```
`clearAll` 内追加：`backend.remove(K_ANALYZED)`

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): storage 增 analyzedIds 存取"
```

---

### Task 2: miniapp adapter — analyzeRolesForNew 批量编排（纯函数）

**Files:**
- Create: `packages/miniapp/src/adapters/roleAnalysis.ts`
- Test: `packages/miniapp/src/adapters/__tests__/roleAnalysis.test.ts`

**Interfaces:**
- Consumes: `Friend`、`FriendSuggestion`、`Relation`（`@nianlun/core`）。
- Produces:
  ```typescript
  export interface AnalyzeRolesDeps {
    friends: Friend[]
    analyzedIds: string[]
    loadSamples: (id: string) => string[]
    suggest: (f: Friend, samples: string[]) => Promise<FriendSuggestion>
    applyRole: (id: string, patch: { rel?: Relation; role?: string }) => void | Promise<void>
    onProgress?: (done: number, total: number) => void
  }
  export function analyzeRolesForNew(deps: AnalyzeRolesDeps): Promise<string[]>
  ```

- [ ] **Step 1: 写失败测试**（新建 `roleAnalysis.test.ts`）

```typescript
import { describe, it, expect, vi } from 'vitest'
import { analyzeRolesForNew } from '../roleAnalysis'
import type { Friend } from '@nianlun/core'

const F = (id: string): Friend => ({
  id, name: id, alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
  msgCount: 1, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})

describe('analyzeRolesForNew', () => {
  it('只分析不在 analyzedIds 里的好友，成功者写入且计入集合', async () => {
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: 'PM' })
    const applied: Array<[string, unknown]> = []
    const ids = await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: ['a'],
      loadSamples: () => [], suggest, applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(suggest).toHaveBeenCalledTimes(1)               // 只分析 b
    expect(applied).toEqual([['b', { rel: '同事', role: 'PM' }]])
    expect([...ids].sort()).toEqual(['a', 'b'])
  })
  it('空结果 → 不写入、id 不入集合', async () => {
    const suggest = vi.fn().mockResolvedValue({})
    const applied: unknown[] = []
    const ids = await analyzeRolesForNew({
      friends: [F('a')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(applied).toEqual([])
    expect(ids).toEqual([])
  })
  it('suggest 抛异常 → 跳过、继续后续、不入集合', async () => {
    const suggest = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ role: 'PM' })
    const applied: Array<[string, unknown]> = []
    const ids = await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: (id, p) => { applied.push([id, p]) },
    })
    expect(applied).toEqual([['b', { rel: undefined, role: 'PM' }]])
    expect(ids).toEqual(['b'])
  })
  it('onProgress 报告 done/total（0 起、total 结束）', async () => {
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const calls: Array<[number, number]> = []
    await analyzeRolesForNew({
      friends: [F('a'), F('b')], analyzedIds: [], loadSamples: () => [], suggest,
      applyRole: () => {}, onProgress: (d, t) => calls.push([d, t]),
    })
    expect(calls[0]).toEqual([0, 2])
    expect(calls[calls.length - 1]).toEqual([2, 2])
  })
  it('无新好友（全在集合里）→ 不调用 suggest、不触发 onProgress', async () => {
    const suggest = vi.fn()
    const onProgress = vi.fn()
    const ids = await analyzeRolesForNew({
      friends: [F('a')], analyzedIds: ['a'], loadSamples: () => [], suggest,
      applyRole: () => {}, onProgress,
    })
    expect(suggest).not.toHaveBeenCalled()
    expect(onProgress).not.toHaveBeenCalled()
    expect(ids).toEqual(['a'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/roleAnalysis.test.ts`
Expected: FAIL（`Cannot find module '../roleAnalysis'`）

- [ ] **Step 3: 实现**（新建 `roleAnalysis.ts`）

```typescript
import type { Friend, FriendSuggestion, Relation } from '@nianlun/core'

export interface AnalyzeRolesDeps {
  friends: Friend[]
  analyzedIds: string[]
  loadSamples: (id: string) => string[]
  suggest: (f: Friend, samples: string[]) => Promise<FriendSuggestion>
  applyRole: (id: string, patch: { rel?: Relation; role?: string }) => void | Promise<void>
  onProgress?: (done: number, total: number) => void
}

/**
 * 对「不在 analyzedIds 里」的好友逐个 AI 推断关系/职务并写入。
 * 成功（rel/role 有值）→ applyRole 且 id 计入已分析；空结果/抛异常 → 跳过、不计入（下次可重试）。
 * 串行执行，避免并发打爆云函数。返回更新后的 analyzedIds（旧 ∪ 成功分析的）。
 */
export async function analyzeRolesForNew(deps: AnalyzeRolesDeps): Promise<string[]> {
  const { friends, analyzedIds, loadSamples, suggest, applyRole, onProgress } = deps
  const done = new Set(analyzedIds)
  const pending = friends.filter((f) => !done.has(f.id))
  const total = pending.length
  if (total) onProgress?.(0, total)
  let count = 0
  for (const f of pending) {
    try {
      const sug = await suggest(f, loadSamples(f.id))
      if (sug.rel || sug.role) {
        await applyRole(f.id, { rel: sug.rel, role: sug.role })
        done.add(f.id)
      }
    } catch {
      // 单个失败：跳过、不计入，下次导入重试
    }
    count++
    onProgress?.(count, total)
  }
  return [...done]
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/roleAnalysis.test.ts`
Expected: PASS（5 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/roleAnalysis.ts packages/miniapp/src/adapters/__tests__/roleAnalysis.test.ts
git commit -m "feat(miniapp): analyzeRolesForNew 增量批量分析关系/职务（纯编排）"
```

---

### Task 3: miniapp import store — 导入后自动批量分析 + 进度字段

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `analyzeRolesForNew`（Task 2）、`storage.loadAnalyzedIds/saveAnalyzedIds`（Task 1）、`aiClient.suggestFriend`、`samples.loadSamplesFor`、`data.updateFriend`。
- Produces: import store 新增响应式 `analyzing: Ref<{ done: number; total: number } | null>`；`Deps` 新增可注入 `suggest?`、`loadSamples?`（默认真实实现），便于测试。

- [ ] **Step 1: 写失败测试**

先把 `import.test.ts` 顶部 import 改为含 `vi`：
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
```

把现有 5 处 `createImportStore({ ... })` 调用**都补上注入**，避免真实 AI/wx 调用（保持现有断言不变）：在每个 `createImportStore({...})` 的对象里加 `suggest: async () => ({}), loadSamples: () => []`。例如：
```typescript
const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
```
（`createImportStore({ useData: createDataStore(s), storage: s })` 这处也同样补上两项。）

末尾追加新用例：
```typescript
it('导入后自动分析新好友的关系/职务并记住，已分析的不重复调用', async () => {
  const s = memStorage()
  const useData = createDataStore(s)
  const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: '产品经理' })
  const useImport = createImportStore({
    useData, storage: s, suggest, loadSamples: () => ['我：在吗', '对方：在'],
  })
  const imp = useImport()
  await imp.run([{ name: 'c.txt', content: TXT }], 2025)
  const f = useData().friends[0]
  expect(f.rel).toBe('同事')
  expect(f.role).toBe('产品经理')
  expect(s.loadAnalyzedIds()).toContain(f.id)
  expect(imp.analyzing).toBe(null)          // 结束后清空
  // 第二次导入同数据：该好友已在集合，不再调用 suggest
  suggest.mockClear()
  await imp.run([{ name: 'c.txt', content: TXT }], 2025)
  expect(suggest).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL（`analyzing` 未定义 / `loadAnalyzedIds` 无 / suggest 未被用）

- [ ] **Step 3: 实现**（`import.ts`）

顶部加 import：
```typescript
import { ref } from 'vue'
import { aiClient } from '../adapters/aiClient'
import { samples as defaultSamples } from '../adapters/samples'
import { analyzeRolesForNew } from '../adapters/roleAnalysis'
import type { Friend, FriendSuggestion } from '@nianlun/core'
```
（`ref` 若已从 vue 引入则合并；`defineStore` 等保持不变。）

`Deps` 类型增补：
```typescript
type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
  suggest?: (f: Friend, s: string[]) => Promise<FriendSuggestion>
  loadSamples?: (id: string) => string[]
}
```
`createImportStore` 顶部取默认：
```typescript
  const suggest = deps.suggest ?? aiClient.suggestFriend
  const loadSamples = deps.loadSamples ?? defaultSamples.loadSamplesFor
```
store 内加响应式并在 return 暴露：
```typescript
    const analyzing = ref<{ done: number; total: number } | null>(null)
```
在 `run()` 的 `if (chatFiles.length) { ... }` 分支里、`await data.setData(named, report)` 之后、`const prevSamples = ...` 之前插入自动分析：
```typescript
          // 导入成功后：对新好友（不在已分析集合）自动推断关系/职务并写入
          const updatedIds = await analyzeRolesForNew({
            friends: named,
            analyzedIds: storage.loadAnalyzedIds(),
            loadSamples,
            suggest,
            applyRole: (id, patch) => data.updateFriend(id, patch),
            onProgress: (done, total) => { analyzing.value = total ? { done, total } : null },
          })
          storage.saveAnalyzedIds(updatedIds)
          analyzing.value = null
```
在 `run()` 内其余分支（只导 contacts、无解析结果）不需要分析。`catch` 分支末尾加 `analyzing.value = null`（保证异常也清空）。
`return { status, progress, warnings, error, run, reset }` 改为 `return { status, progress, warnings, error, analyzing, run, reset }`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS（原 5 用例 + 新用例）

- [ ] **Step 5: 全套回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): 导入后自动批量分析关系/职务 + analyzing 进度"
```

---

### Task 4: miniapp UI — 删「智能建议」按钮 + 导入页显示分析进度

**Files:**
- Modify: `packages/miniapp/src/pages/friends/friends.vue`
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`
- Modify: `packages/miniapp/src/pages/import/import.vue`

无单测（逻辑已在 Task 1–3 覆盖），以 PowerShell `build:mp-weixin` 编译 + 人工验证。

- [ ] **Step 1: friends.vue 删智能建议**

- 删模板按钮行：`<text class="act act-ai" @click="suggest(f)">✦ 智能建议</text>`
- 删整个 `async function suggest(f: { id: string }) { ... }`（含其 `uni.showModal`/`aiClient.suggestFriend` 调用）。
- 删不再使用的两行 import：`import { aiClient } from '../../adapters/aiClient'` 与 `import { samples } from '../../adapters/samples'`（friends.vue 里它们仅被 suggest 使用；删函数后无引用）。
- 保留 `改关系` picker 与 `职务 / 备注` input（`onRel`/`onRole` 不动）。

- [ ] **Step 2: friend-detail.vue 删智能建议**

- 删模板按钮行：`<text class="act act-ai" @click="suggest">✦ 智能建议</text>`
- 删整个 `async function suggest() { ... }`。
- **保留** `aiClient` 与 `samples` 的 import（`analyzeSentiment`/`analyzeProfile` 仍在用）。保留改关系 picker、职务 input、情绪分析、好友画像按钮。

- [ ] **Step 3: import.vue 显示分析进度**

把现有 `parsing` 状态块（`<view v-if="imp.status === 'parsing'" class="status">…</view>`）替换为按 `analyzing` 分流：
```html
      <view v-if="imp.status === 'parsing'" class="status">
        <template v-if="imp.analyzing">
          <text class="status-t muted">正在分析关系/职务… {{ imp.analyzing.done }}/{{ imp.analyzing.total }}</text>
        </template>
        <template v-else>
          <view class="bar"><view class="bar-in" :style="{ width: pct + '%' }"></view></view>
          <text class="status-t muted">解析中… {{ pct }}%</text>
        </template>
      </view>
```
（`<template v-if>` 在 mp-weixin 受支持；`imp.analyzing.done` 处于 `v-if="imp.analyzing"` 保护下，无需可选链。）其余块不动。

- [ ] **Step 4: 构建并回归**

Run（PowerShell）: `pnpm --filter @nianlun/miniapp test`（现有 + 新测试仍全绿）
Run（PowerShell）: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 编译通过，无类型/模板错误。

人工验证（微信开发者工具，导入 `dist/build/mp-weixin`）：导入聊天文件 → 看到「正在分析关系/职务 x/N…」→ 完成后好友列表/详情自动带上关系与职务；好友页与详情页均无「✦ 智能建议」按钮；再次导入同批数据不再重复分析。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/friends/friends.vue packages/miniapp/src/pages/friend-detail/friend-detail.vue packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 删「智能建议」按钮，导入页显示职务分析进度"
```

---

## 边界与说明

- **增量**：`analyzedIds` 持久化保证「只分析新好友、只一次」；空结果/失败不计入 → 下次导入重试。
- **阻塞**：批量分析在 `run()` 内同步跑，期间 `status` 仍为 `parsing`、导入页显示分析进度，跑完才 `done`。好友多时较慢但一次性。
- **不改 core**：复用 `aiClient.suggestFriend`（core 的 prompt/parse 不动）。
- **userEdited**：`updateFriend` 写入会记 `userEdited.rel/role`，再导入时 `mergeFriends` 保留，且 id 已在集合不再分析。
- **旧数据补分析**：本功能上线前导入的好友不在集合，重新导入一次即可触发。
