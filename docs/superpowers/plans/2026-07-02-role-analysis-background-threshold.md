# 自动分析改造：后台非阻塞 + 消息门槛 + 启动补跑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「导入后自动分析关系/职务」改成后台非阻塞、只分析全年消息 ≥20 条的好友、并在导入后与每次 App 启动都补跑未分析的达标好友。

**Architecture:** 全在 miniapp（core 不改）。import store 抽出共用 action `analyzePendingRoles`（门槛过滤 + 重入保护 + 复用诊断版 `analyzeRolesForNew`），`run()` 改为「先完成导入再后台分析」，`App.vue` 启动 hydrate 后触发，`import.vue` 把分析进度横幅独立于 status。

**Tech Stack:** TypeScript、Vitest、Vue 3（uni-app mp-weixin）。

## Global Constraints

- 注释/文案用**中文**。
- 不改 `@nianlun/core`；复用 `aiClient.suggestFriend`；严格 miniapp → core 单向依赖。
- 只用有界样本（`loadSamplesFor`），不落聊天原文。
- **串行**分析（不并发）；增量：只分析 `msgCount>=ROLE_MIN_MSGS` 且 `id∉analyzedIds` 的好友；失败/无结果不计入集合、下次重试。
- `ROLE_MIN_MSGS = 20`。
- mp-weixin 模板不用可选链 `?.`。
- **Windows 上用 PowerShell 跑 build/test**。

## 现状锚点（改造前，均在 fix/role-analysis-surface-failures 分支）

- `import.ts` 顶部已 import `analyzeRolesForNew, type AnalyzeRolesResult`，并已有模块级 `analysisWarn(r)` 辅助函数；`Deps` 有 `suggest?`/`loadSamples?`；`createImportStore` 有 `suggest`/`loadSamples` 默认；store 有 `status/progress/warnings/error/analyzing` 五个 ref；`run()` 的 chatFiles 分支当前顺序为 `setData → saveSamples → analyzeRolesForNew(内联) → saveAnalyzedIds → analyzing=null → saveRecentInsights/Samples → warnings(含 analysisWarn)`；`reset()` 已清 analyzing；`return { status, progress, warnings, error, analyzing, run, reset }`。
- `roleAnalysis.ts` 的 `analyzeRolesForNew` 返回 `{ analyzedIds, succeeded, failed, empty, firstError }`（诊断版，不改）。
- `App.vue` 的 `onLaunch(() => { …cloud.init…; useDataStore().hydrate() })`。
- `import.vue` 的进度块：`<view v-if="imp.status === 'parsing'" class="status"><template v-if="imp.analyzing">…</template><template v-else>…bar…解析中…</template></view>`。

---

### Task 1: import store — ROLE_MIN_MSGS + analyzePendingRoles + run() 非阻塞

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `analyzeRolesForNew`（返回 `AnalyzeRolesResult`）、`analysisWarn`、`storage.load/saveAnalyzedIds`、`aiClient.suggestFriend`、`samples.loadSamplesFor`、`data.updateFriend`。
- Produces: 导出常量思想 `ROLE_MIN_MSGS = 20`（模块内）；store 新增并暴露 `analyzePendingRoles(): Promise<void>`；`run()` 改为完成导入后调用它。

- [ ] **Step 1: 写失败测试**

在 `import.test.ts` 顶部（`memStorage`/`TXT` 附近）加一个「≥20 条消息」的夹具与好友工厂：

```typescript
import type { Friend, ReportData } from '@nianlun/core'

// 造一位 ≥20 条消息的好友，触发分析门槛（李四发 20 条）
const BIG_TXT = Array.from({ length: 20 }, (_, i) =>
  `2025-03-0${(i % 9) + 1} 09:${String(i).padStart(2, '0')}:00 李四\n消息${i}`,
).join('\n\n')

const mkFriend = (id: string, msgCount: number): Friend => ({
  id, name: id, alias: '', rel: '其他', role: '', firstContact: 0, lastContact: 0,
  msgCount, sentRatio: 0, peakPeriod: '', maxStreak: 0,
  monthly: new Array(12).fill(0), hourly: new Array(24).fill(0), weekHour: new Array(168).fill(0),
  keywords: [], userEdited: {},
})
const REPORT = { year: 2025, totalMessages: 0, friendCount: 0, activeDays: 0, topContacts: [], relationBreakdown: [] } as unknown as ReportData
```

**替换**旧的三个分析相关用例（`导入后自动分析新好友…`、`分析新好友时已能读到刚导入的样本…`、`分析失败时在 warnings 里现形…`）为下面这组；其余解析/联系人用例保持不变（它们用 2 条消息的小 TXT，低于门槛、不再触发分析，断言依旧成立）：

```typescript
describe('analyzePendingRoles（门槛 + 后台分析）', () => {
  it('只分析 msgCount>=20 且未分析的好友，写入 rel/role 并计入集合', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: '产品经理' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：在吗'] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30), mkFriend('small', 5)], REPORT)
    await imp.analyzePendingRoles()
    expect(suggest).toHaveBeenCalledTimes(1)                     // 只 big（small 低于门槛）
    expect(useData().friends.find((f) => f.id === 'big')!.role).toBe('产品经理')
    expect(useData().friends.find((f) => f.id === 'big')!.rel).toBe('同事')
    expect(useData().friends.find((f) => f.id === 'small')!.role).toBe('')
    expect(s.loadAnalyzedIds()).toEqual(['big'])
    expect(imp.analyzing).toBe(null)
  })

  it('已在集合里的达标好友不再分析', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    s.saveAnalyzedIds(['big'])
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    await imp.analyzePendingRoles()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('重入保护：analyzing 非 null 时直接返回、不分析', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    imp.analyzing = { done: 1, total: 5 } // 模拟已有分析在跑（Pinia setup store 属性可直接赋值）
    await imp.analyzePendingRoles()
    expect(suggest).not.toHaveBeenCalled()
  })

  it('失败在 warnings 里现形（不再静默）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockRejectedValue(new Error('AI 服务未部署'))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('big', 30)], REPORT)
    await imp.analyzePendingRoles()
    expect(imp.warnings.some((w) => w.includes('失败') && w.includes('AI 服务未部署'))).toBe(true)
    expect(s.loadAnalyzedIds()).toEqual([])       // 失败不入集合
    expect(imp.analyzing).toBe(null)
  })
})

describe('run 导入后非阻塞触发分析', () => {
  it('导入达标好友：status 先 done，分析在其后写入且样本已就绪（非空）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const seen: string[][] = []
    const suggest = vi.fn(async (_f: unknown, samples: string[]) => { seen.push(samples); return { rel: '同事', role: 'PM' } })
    const useImport = createImportStore({
      useData, storage: s, suggest,
      loadSamples: makeSamples(s).loadSamplesFor,     // 真实：读回同一 memStorage
    })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: BIG_TXT }], 2025)
    expect(imp.status).toBe('done')
    const big = useData().friends[0]
    expect(big.role).toBe('PM')                       // 后台分析已写入
    expect(seen.length).toBe(1)
    expect(seen[0].length).toBeGreaterThan(0)         // 分析时样本已落盘、非空（保留 Critical 回归）
    expect(s.loadAnalyzedIds()).toContain(big.id)
  })

  it('导入的好友都低于门槛：不分析、集合为空、status done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ role: 'PM' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025) // 小 TXT：李四 2 条 < 20
    expect(imp.status).toBe('done')
    expect(suggest).not.toHaveBeenCalled()
    expect(s.loadAnalyzedIds()).toEqual([])
  })
})
```

同时把顶部 import 补上 `makeSamples`（若尚未引入）：`import { makeStorage, ... }` 附近加 `import { makeSamples } from '../../adapters/samples'`（Task 前置：上一版已加过则跳过）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL（`imp.analyzePendingRoles is not a function` 等）

- [ ] **Step 3: 实现**（`import.ts`）

顶部（模块级，`analysisWarn` 附近）加常量：
```typescript
/** 只自动分析全年消息数达到该门槛的好友，过滤上千联系人里的长尾噪声。 */
const ROLE_MIN_MSGS = 20
```

在 `createImportStore` 的 `defineStore('import', () => { ... })` 内，`analyzing` ref 之后、`run` 之前，加共用 action：
```typescript
    /**
     * 对「消息数达标且不在已分析集合」的好友后台串行推断关系/职务并写入。
     * 供「导入完成后」与「App 启动 hydrate 后」共用。重入保护避免并发重复。
     */
    async function analyzePendingRoles(): Promise<void> {
      if (analyzing.value) return                              // 重入保护
      const d = useData()
      const analyzedSet = new Set(storage.loadAnalyzedIds())
      const candidates = d.friends.filter(
        (f) => f.msgCount >= ROLE_MIN_MSGS && !analyzedSet.has(f.id),
      )
      if (candidates.length === 0) return
      analyzing.value = { done: 0, total: candidates.length }  // await 前置位守卫
      try {
        const result = await analyzeRolesForNew({
          friends: candidates,
          analyzedIds: [...analyzedSet],
          loadSamples,
          suggest,
          applyRole: (id, patch) => d.updateFriend(id, patch),
          onProgress: (done, total) => { analyzing.value = { done, total } },
        })
        storage.saveAnalyzedIds(result.analyzedIds)
        warnings.value = [...warnings.value, ...analysisWarn(result)]
      } finally {
        analyzing.value = null
      }
    }
```

把 `run()` 的 `if (chatFiles.length) { ... }` 分支中「分析内联段」替换为「先完成导入、再后台分析」。即把现有的
```typescript
          await data.setData(named, report)
          // 导入成功后：对新好友…内联 analyzeRolesForNew…
          const analysis = await analyzeRolesForNew({ ... })
          storage.saveAnalyzedIds(analysis.analyzedIds)
          analyzing.value = null
          storage.saveRecentInsights({ ... })
          storage.saveRecentSamples({ ... })
          warnings.value = [...outcome.warnings, ...contactWarn(appliedCount(named)), ...analysisWarn(analysis)]
```
整段替换为：
```typescript
          await data.setData(named, report)
          const prevSamples = storage.loadSamples()
          storage.saveSamples({ ...prevSamples, ...outcome.samples })
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
          warnings.value = [...outcome.warnings, ...contactWarn(appliedCount(named))]
          status.value = 'done'                 // 导入完成：好友列表立即可用
          await analyzePendingRoles()            // 之后后台补分析（达标未分析的），UI 已解锁
```
（注意：原先在 `analyzeRolesForNew` 之前的 `const prevSamples/saveSamples` 保持在 `setData` 之后、分析之前——样本先落盘的 Critical 修复不能回退。）

在 `run()` 末尾 `status.value = 'done'` 保持不变（覆盖其它分支；chatFiles 分支已提前置位，重复赋值无害）。

`return { ... }` 追加 `analyzePendingRoles`：
```typescript
    return { status, progress, warnings, error, analyzing, run, analyzePendingRoles, reset }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS（新用例 + 保留的解析/联系人用例）

- [ ] **Step 5: 全套回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): 分析改后台非阻塞 + 消息门槛(>=20) + analyzePendingRoles 共用 action"
```

---

### Task 2: App 启动触发 + 导入页进度横幅独立

**Files:**
- Modify: `packages/miniapp/src/App.vue`
- Modify: `packages/miniapp/src/pages/import/import.vue`

无单测（启动时序/模板），以 PowerShell `build:mp-weixin` 编译 + 人工验证。

**Interfaces:**
- Consumes: `useImportStore().analyzePendingRoles`（Task 1）、`useDataStore().hydrate`、`imp.analyzing`。

- [ ] **Step 1: App.vue 启动补跑**

把 `App.vue` 的 `<script setup>` 改为（在 hydrate 之后后台触发分析，不 await、不阻塞启动）：
```typescript
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './stores/data'
import { useImportStore } from './stores/import'
onLaunch(async () => {
  // @ts-ignore wx 由微信小程序运行时提供
  if (typeof wx !== 'undefined' && wx.cloud) {
    // @ts-ignore
    wx.cloud.init({ env: 'cloud1-d4gzww8dp909b47cb' })
  }
  await useDataStore().hydrate()
  // 启动后台补分析：存量里「消息达标且未分析」的好友，串行渐进补关系/职务，不阻塞启动。
  void useImportStore().analyzePendingRoles()
})
```

- [ ] **Step 2: import.vue 进度横幅独立于 status**

当前 `parsing` 块内嵌了 analyzing 分支。改为：`parsing` 块只显示解析进度，另起一个独立块显示分析进度（这样 `status==='done'` 期间横幅仍可见）。

把现有
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
替换为
```html
      <view v-if="imp.status === 'parsing'" class="status">
        <view class="bar"><view class="bar-in" :style="{ width: pct + '%' }"></view></view>
        <text class="status-t muted">解析中… {{ pct }}%</text>
      </view>
      <view v-if="imp.analyzing" class="status">
        <text class="status-t muted">正在分析关系/职务… {{ imp.analyzing.done }}/{{ imp.analyzing.total }}</text>
      </view>
```
（`imp.analyzing.done` 处于 `v-if="imp.analyzing"` 保护下，无 `?.`。其余 done/error/warnings 块不动。）

- [ ] **Step 3: 构建并回归**

Run（PowerShell）: `pnpm --filter @nianlun/miniapp test`（应仍全绿）
Run（PowerShell）: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 编译通过。

人工验证（微信开发者工具，导入 `dist/build/mp-weixin`）：
- 导入含 ≥20 条消息好友的数据 → 导入页**立即**显示「✅ 已导入 · 好友 N 位」，好友页马上能看到全部好友；导入页出现「正在分析关系/职务 x/M」横幅，关系/职务逐个补上；跑完横幅消失、提示追加「已自动分析…」。
- 杀掉小程序重进 → 启动后（存量里达标未分析的）自动补跑一次；已分析的不重复。
- 好友页/详情页无「✦ 智能建议」按钮（上一功能）。

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/App.vue packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): App 启动补跑分析 + 导入页分析进度横幅独立于 status"
```

---

## 边界与说明

- **非阻塞**：`status='done'` 在分析之前置位；`run()` 内部仍 await 分析（测试可确定性等待），UI 早已解锁。
- **门槛**：`ROLE_MIN_MSGS=20`，只分析达标好友；将来消息涨过门槛、再次导入/启动会纳入。
- **两处触发共用** `analyzePendingRoles`，同一 `analyzedIds` 去重、同一门槛；重入保护避免并发重复。
- **失败现形**：沿用诊断版统计，导入页 warnings 显示「M 位失败：<firstError>」。
- **不改 core、不加并发**（YAGNI）。
