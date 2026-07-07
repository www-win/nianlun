# AI 职务分析改手动 + 好友列表分析按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 取消 AI 自动推断好友关系/职务，改为在好友列表每行手动点按钮分析单个好友。

**Architecture:** 移除两处自动触发（App 启动后、导入完成后）。在 `import` store 新增纯逻辑方法 `analyzeOne(id)`（不触碰 `uni`，返回结果枚举），friends.vue 每行加按钮调用它并按返回枚举 `uni.showToast`。现有批量机制 `analyzePendingRoles`/`analyzeRolesForNew` 保留在代码里但不再被调用。

**Tech Stack:** Vue 3 + uni-app（微信小程序）、Pinia setup store（工厂 `createImportStore(deps)`）、Vitest（node 环境）、`@nianlun/core` 提供类型。

## Global Constraints

- 所有回答与代码注释用**中文**；UI 文案中文。
- 用 **pnpm**，不用 npm/yarn。
- `stores/`、`adapters/` 属纯逻辑层，**不得触碰 `uni`/DOM**，必须在 node（vitest）环境可单测。
- 遵循现有 Pinia setup store 工厂模式 `createImportStore(deps)`；依赖经 `deps` 注入以便测试。
- 类型从 `@nianlun/core` import，不重新定义（`Friend`、`FriendSuggestion`、`Relation`）。
- 运行全部测试：`pnpm --filter @nianlun/miniapp test`
- 运行单文件：`pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`

---

## 文件结构

- `packages/miniapp/src/stores/import.ts` — 移除 `run()` 里的自动触发；新增 `AnalyzeOneStatus`/`AnalyzeOneResult` 类型、`analyzingIds` 状态、`analyzeOne(id)` 方法。
- `packages/miniapp/src/App.vue` — 移除启动后自动分析调用与随之失效的 import。
- `packages/miniapp/src/pages/friends/friends.vue` — 每行加「AI分析」按钮，接线 `analyzeOne` + toast。
- `packages/miniapp/src/stores/__tests__/import.test.ts` — 替换依赖自动触发的旧测试；新增 `analyzeOne` 测试。

---

### Task 1: 移除自动分析触发

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`（删 `run()` 内导入完成后的 `await analyzePendingRoles()` 调用及其行内注释，约第 122-123 行）
- Modify: `packages/miniapp/src/App.vue`（删启动后 `void useImportStore().analyzePendingRoles()` 及注释；删因此失效的 `import { useImportStore }`）
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`（替换 `describe('run 导入后非阻塞触发分析')` 整块）

**Interfaces:**
- Consumes: 现有 `run(files, year)`、`analyzePendingRoles()`（后者保留，仅不再自动调用）。
- Produces: `run()` 完成后**不触发任何分析**；`suggest` 不被 `run` 调用；`analyzedIds` 集合不因 `run` 变化。

- [ ] **Step 1: 改测试 —— 替换 `run 导入后非阻塞触发分析` 整个 describe（原第 185-218 行）**

把原来断言「导入后自动分析写入 role」的 describe 整块替换为：

```ts
describe('run 导入后不再自动分析（改为手动）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('导入达标好友：status done，但不自动分析（role 空、suggest 未调用、集合空）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: 'PM' })
    const useImport = createImportStore({
      useData, storage: s, suggest,
      loadSamples: makeSamples(s).loadSamplesFor,
    })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: BIG_TXT }], 2025)
    expect(imp.status).toBe('done')
    const big = useData().friends[0]
    expect(big.role).toBe('')                 // 不再自动写入
    expect(suggest).not.toHaveBeenCalled()    // run 不再触发分析
    expect(s.loadAnalyzedIds()).toEqual([])   // 集合不变
  })
})
```

> 注意：保留文件顶部已有的 `makeSamples` import 与 `BIG_TXT` 常量（本测试仍用到）。`describe('analyzePendingRoles（门槛 + 后台分析）')` 整块**保持不动**——该函数保留，直接调用它的测试仍应通过。

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL —— 新测试断言 `suggest` 未被调用/`role===''`，但当前 `run` 仍会自动分析，故失败。

- [ ] **Step 3: 删 `import.ts` 中 `run()` 的自动触发**

在 [import.ts:122-123](../../../packages/miniapp/src/stores/import.ts#L122) 处，删除这两行：

```ts
          status.value = 'done'                 // 导入完成：好友列表立即可用
          await analyzePendingRoles()            // 之后后台补分析（达标未分析的），UI 已解锁
```

替换为（只保留置 done，去掉自动分析）：

```ts
          status.value = 'done'                 // 导入完成：好友列表立即可用（分析改为好友列表手动触发）
```

> `analyzePendingRoles` 函数定义、`analyzeRolesForNew` import、store 返回里的 `analyzePendingRoles` 导出**都保留不动**。

- [ ] **Step 4: 删 `App.vue` 的启动触发与失效 import**

在 `App.vue` 删除第 26-27 行：

```ts
  // 启动后台补分析：存量里「消息达标且未分析」的好友，串行渐进补关系/职务，不阻塞启动。
  void useImportStore().analyzePendingRoles()
```

并删除文件顶部第 4 行已不再使用的 import：

```ts
import { useImportStore } from './stores/import'
```

> `App.vue` 其余（`useDataStore().hydrate()` 等）保持不动。删除后确认文件内不再有 `useImportStore` 的引用。

- [ ] **Step 5: 跑测试确认绿**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS（全部通过，含 `analyzePendingRoles` describe 原样绿）

- [ ] **Step 6: Commit**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/App.vue packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "refactor(miniapp): 移除导入后/启动后自动分析,改为手动触发"
```

---

### Task 2: store 新增 `analyzeOne(id)`

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`（新增类型、`analyzingIds` 状态、`analyzeOne` 方法与导出）
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`（新增 `describe('analyzeOne（手动单个分析）')`）

**Interfaces:**
- Consumes: `deps.suggest`（`(f: Friend, s: string[]) => Promise<FriendSuggestion>`）、`deps.loadSamples`（`(id) => string[]`）、`useData().updateFriend`、`storage.loadAnalyzedIds`/`saveAnalyzedIds`。
- Produces:
  - `type AnalyzeOneStatus = 'ok' | 'empty' | 'error' | 'skipped'`
  - `interface AnalyzeOneResult { status: AnalyzeOneStatus; error?: string }`
  - `analyzeOne(id: string): Promise<AnalyzeOneResult>`
  - `analyzingIds: Ref<Set<string>>`（响应式，正在分析中的好友 id 集合）

- [ ] **Step 1: 写失败测试 —— 新增 `analyzeOne` describe（追加到 import.test.ts 末尾）**

```ts
describe('analyzeOne（手动单个分析）', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('成功：写入 rel/role、计入 analyzedIds、返回 ok（不受门槛限制）', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({ rel: '同事', role: '产品经理' })
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => ['我：hi'] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 5)], REPORT)     // 5 条 < 20，验证手动不套门槛
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('ok')
    expect(suggest).toHaveBeenCalledTimes(1)
    expect(useData().friends[0].role).toBe('产品经理')
    expect(useData().friends[0].rel).toBe('同事')
    expect(s.loadAnalyzedIds()).toContain('a')
    expect(imp.analyzingIds.has('a')).toBe(false)           // 收尾清空
  })

  it('AI 无结果：返回 empty，不写入、不计集合', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockResolvedValue({})
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('empty')
    expect(useData().friends[0].role).toBe('')
    expect(s.loadAnalyzedIds()).toEqual([])
  })

  it('suggest 抛异常：返回 error 带 message、不 reject、状态复位', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn().mockRejectedValue(new Error('云函数超时'))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('a')
    expect(r.status).toBe('error')
    expect(r.error).toContain('云函数超时')
    expect(imp.analyzingIds.has('a')).toBe(false)
  })

  it('重入保护：该好友分析中再次调用返回 skipped、不重复触发 suggest', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    let release!: (v: unknown) => void
    const suggest = vi.fn(() => new Promise((res) => { release = res }))
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const p1 = imp.analyzeOne('a')            // 挂起中（suggest 未 resolve）
    const r2 = await imp.analyzeOne('a')      // 同一好友：立即 skipped
    expect(r2.status).toBe('skipped')
    expect(suggest).toHaveBeenCalledTimes(1)
    release({ role: 'PM' })
    await p1
  })

  it('好友不存在：返回 skipped、不触发 suggest', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const suggest = vi.fn()
    const useImport = createImportStore({ useData, storage: s, suggest, loadSamples: () => [] })
    const imp = useImport()
    await useData().setData([mkFriend('a', 30)], REPORT)
    const r = await imp.analyzeOne('missing')
    expect(r.status).toBe('skipped')
    expect(suggest).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL —— `imp.analyzeOne is not a function` / `imp.analyzingIds` 未定义。

- [ ] **Step 3: 实现 —— 在 import.ts 新增类型（文件顶部类型区，紧接 `AnalyzeRolesResult` 相关 import 之后、`createImportStore` 之前）**

```ts
/** 单个好友手动分析的结果状态。store 不触碰 uni，toast 交页面按此枚举处理。 */
export type AnalyzeOneStatus = 'ok' | 'empty' | 'error' | 'skipped'
export interface AnalyzeOneResult {
  status: AnalyzeOneStatus
  /** status==='error' 时的错误信息，供页面 toast。 */
  error?: string
}
```

- [ ] **Step 4: 实现 —— 在 `createImportStore` 的 setup 内新增状态与方法**

在 `analyzePendingRoles` 定义之后、`run` 之前（或任意 setup 内位置），加入：

```ts
    // 好友列表「手动分析」正在进行的好友 id（按钮 loading + 防重复点击）。替换新 Set 触发响应式。
    const analyzingIds = ref<Set<string>>(new Set())

    /**
     * 手动分析单个好友：推断关系/职务并写入。手动触发，不套用消息数门槛。
     * store 保持纯逻辑、不碰 uni；返回结果枚举，由页面 toast。重入保护（同一好友分析中返回 skipped）。
     */
    async function analyzeOne(id: string): Promise<AnalyzeOneResult> {
      if (analyzingIds.value.has(id)) return { status: 'skipped' }
      const d = useData()
      const f = d.friends.find((x) => x.id === id)
      if (!f) return { status: 'skipped' }
      analyzingIds.value = new Set(analyzingIds.value).add(id)   // await 前置位守卫
      try {
        const sug = await suggest(f, loadSamples(f.id))
        if (sug.rel || sug.role) {
          await d.updateFriend(id, { rel: sug.rel, role: sug.role })
          storage.saveAnalyzedIds([...new Set([...storage.loadAnalyzedIds(), id])])
          return { status: 'ok' }
        }
        return { status: 'empty' }
      } catch (e) {
        return { status: 'error', error: (e as Error)?.message ?? String(e) }
      } finally {
        const next = new Set(analyzingIds.value); next.delete(id); analyzingIds.value = next
      }
    }
```

- [ ] **Step 5: 实现 —— 把 `analyzingIds` 与 `analyzeOne` 加入 store 的 return**

把 `createImportStore` 末尾的 return（原第 190-193 行）改为包含新成员：

```ts
    return {
      status, progress, warnings, error, analyzing, analyzingStocks, stocksSavedCount,
      analyzingIds,
      run, analyzePendingRoles, analyzeOne, analyzeStocks, reset,
    }
```

- [ ] **Step 6: 跑测试确认绿**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS（新增 5 个 analyzeOne 测试全绿，其余不受影响）

- [ ] **Step 7: Commit**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): import store 新增 analyzeOne 单个好友手动分析"
```

---

### Task 3: friends.vue 加「AI分析」按钮

**Files:**
- Modify: `packages/miniapp/src/pages/friends/friends.vue`（script 引 store + `onAnalyze`；template `.acts` 加按钮；style 加 `.busy`）

**Interfaces:**
- Consumes: `useImportStore().analyzeOne(id)`、`useImportStore().analyzingIds`（来自 Task 2）；`uni.showToast`。
- Produces: 好友卡片可点击「🪄 AI分析」触发单个分析，分析中显示「分析中…」，结果经 toast 反馈。

- [ ] **Step 1: script —— 引入 import store 与 onAnalyze**

在 `friends.vue` 的 `<script setup>` 顶部 import 区加：

```ts
import { useImportStore } from '../../stores/import'
```

在 `const data = useDataStore()` 之后加：

```ts
const imp = useImportStore()

// 手动分析单个好友：调 store，按返回枚举 toast（uni 仅在页面层用，store 保持纯）。
async function onAnalyze(id: string) {
  const f = data.friends.find((x) => x.id === id)
  const r = await imp.analyzeOne(id)
  if (r.status === 'ok') {
    uni.showToast({ title: `已分析：${f?.alias || f?.name || ''}`, icon: 'none' })
  } else if (r.status === 'empty') {
    uni.showToast({ title: '未分析出结果', icon: 'none' })
  } else if (r.status === 'error') {
    uni.showToast({ title: `分析失败：${r.error ?? ''}`, icon: 'none' })
  }
  // skipped（重入/无此人）：不提示
}
```

- [ ] **Step 2: template —— 在 `.acts` 行 picker 之后、role-input 之前加按钮**

把 `.acts` 块（原第 75-83 行）改为：

```html
        <view class="acts">
          <picker class="act" :range="RELS" @change="(e) => onRel(f.id, e)">
            <text class="act-t">改关系</text>
          </picker>
          <view
            class="act act-ai" :class="{ busy: imp.analyzingIds.has(f.id) }"
            @click="onAnalyze(f.id)"
          >
            <text class="act-t">{{ imp.analyzingIds.has(f.id) ? '分析中…' : '🪄 AI分析' }}</text>
          </view>
          <input
            class="role-input" :value="f.role" placeholder="职务 / 备注"
            placeholder-class="ph" @blur="(e) => onRole(f.id, e)"
          />
        </view>
```

- [ ] **Step 3: style —— 加 `.busy` 态（`.act-ai` 已存在，只补 loading 态）**

在 `<style scoped>` 里 `.act-ai` 规则（原第 134 行 `.act-ai { color: var(--accent-strong); background: var(--accent-wash); }`）之后加：

```css
.act-ai.busy { opacity: 0.5; }
```

- [ ] **Step 4: 跑整包测试确认未破坏其它**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（friends.vue 无单测，此步确保 store/其它测试仍全绿）

- [ ] **Step 5: 手动验证（页面无单测，靠真机/开发预览）**

用项目的启动方式跑起来（`/start_skill` 或 `pnpm --filter @nianlun/miniapp dev:mp-weixin` 用微信开发者工具打开），进入「好友」页：
- 确认每张好友卡片底部出现「🪄 AI分析」按钮。
- 点一下：按钮变「分析中…」并变淡；结束后 toast 提示「已分析：<名字>」或「未分析出结果」/「分析失败：…」。
- 成功时该好友的关系标签/职务标签随之更新。

- [ ] **Step 6: Commit**

```bash
git add packages/miniapp/src/pages/friends/friends.vue
git commit -m "feat(miniapp): 好友列表每行加 AI分析 按钮,手动分析单个好友"
```

---

## Self-Review 记录

- **Spec 覆盖**：移除自动触发(Task 1)✓；单个 analyzeOne(Task 2)✓；不套门槛(Task 2 Step1 用 5 条好友)✓；保留批量机制(Task 1 保留 analyzePendingRoles/analyzeRolesForNew)✓；friends.vue 按钮 + toast(Task 3)✓；store 不碰 uni(Task 2 返回枚举、Task 3 页面 toast)✓。
- **占位符**：无 TBD/TODO；所有步骤含完整代码。
- **类型一致**：`AnalyzeOneStatus`/`AnalyzeOneResult`/`analyzeOne`/`analyzingIds` 在 Task 2 定义并在 Task 3 消费，命名一致。
- **命令一致**：单文件 `exec vitest run <path>`、整包 `pnpm --filter @nianlun/miniapp test`，与 package.json scripts 对齐。
