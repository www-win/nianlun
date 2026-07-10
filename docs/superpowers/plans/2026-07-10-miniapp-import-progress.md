# 导入进度条（全流程三阶段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让小程序导入全程（读取/解压 → 解析 → 聚合）都有可见、诚实的进度反馈，消除"卡住感"。

**Architecture:** 引入显式 `phase` 阶段状态。解析循环每 20 个文件让渲染线程刷新以得到真百分比；解压与聚合是单次同步调用、切不开，用不确定态 CSS 动画条覆盖（逻辑线程阻塞时它在渲染线程仍滑动）。页面用三步指示器 + 按阶段切换的进度条呈现。

**Tech Stack:** Vue 3 (uni-app mp-weixin)、Pinia、TypeScript、Vitest（jsdom）。

## Global Constraints

- 包管理用 **pnpm**，命令一律 `pnpm --filter @nianlun/miniapp ...`（不要 npm/yarn）。
- `@nianlun/core` 纯逻辑不改；本计划只动 `packages/miniapp`。
- 不改导入的合并/统计口径，不改 `run` 对外签名与既有 done/error 行为，不加取消按钮（YAGNI）。
- 阶段值恰为：`ImportPhase = 'idle' | 'reading' | 'parsing' | 'aggregating'`；`ParsePhase = 'parsing' | 'aggregating'`。命名逐字沿用，勿另造。
- `status` 语义不变：`'idle' | 'parsing' | 'done' | 'error'`。
- 所有回答/注释用中文（项目规范）。

---

### Task 1: `parseLocal` 改 async + 阶段化进度回调

**Files:**
- Modify: `packages/miniapp/src/adapters/parseLocal.ts:56-74`（`parseLocal` 函数）
- Test: `packages/miniapp/src/adapters/__tests__/parseLocal.test.ts:13-45`（`describe('parseLocal')` 块）

**Interfaces:**
- Produces:
  - `export type ParsePhase = 'parsing' | 'aggregating'`
  - `export interface ParseProgress { phase: ParsePhase; done: number; total: number }`
  - `export async function parseLocal(files: LocalFile[], year: number, onProgress?: (p: ParseProgress) => void): Promise<ParseOutcome>`
- 回调时序保证：先若干次 `{ phase:'parsing', done:i+1, total }`（`done` 从 1 递增到 `total`），最后一次为 `{ phase:'aggregating', done:0, total:1 }`。
- Consumes（Task 2 依赖）：`run` 需 `await parseLocal(...)` 且回调按上面时序。

- [ ] **Step 1: 改测试为 async 并断言阶段序列**

把 `describe('parseLocal', ...)` 里 4 个用例改为 `await parseLocal(...)`，并替换 progress 用例。改后的整块如下（其余 `describe('computeRecentInsights')` 不动）：

```ts
import { describe, it, expect } from 'vitest'
import type { Conversation } from '@nianlun/core'
import { parseLocal, computeRecentInsights, type ParseProgress } from '../parseLocal'

const DAY = 86400000

const TXT = `2025-01-02 10:00:00 张三
你好

2025-01-02 10:01:00 我
在的`

describe('parseLocal', () => {
  it('解析 txt 聚合出好友并产出报告与样本', async () => {
    const out = await parseLocal([{ name: 'chat.txt', content: TXT }], 2025)
    expect(out.report.year).toBe(2025)
    expect(out.friends.length).toBe(1)
    expect(out.friends[0].msgCount).toBe(2)
    expect(Object.keys(out.samples).length).toBe(1)
  })

  it('progress 回调带阶段推进：解析到满，末尾聚合', async () => {
    const calls: ParseProgress[] = []
    await parseLocal([{ name: 'a.txt', content: TXT }], 2025, (p) => calls.push(p))
    expect(calls).toContainEqual({ phase: 'parsing', done: 1, total: 1 })
    expect(calls[calls.length - 1].phase).toBe('aggregating')
  })

  it('无法识别的文件把告警收集进 warnings 而不抛', async () => {
    const out = await parseLocal([{ name: 'x.bin', content: '%%%' }], 2025)
    expect(out.warnings.some((w) => w.includes('x.bin'))).toBe(true)
  })

  it('样本每人上限 60 条，单条不超过 120 字', async () => {
    const lines: string[] = []
    for (let i = 0; i < 80; i++) {
      lines.push(`2025-03-01 10:${String(i % 60).padStart(2, '0')}:00 张三`)
      lines.push('内'.repeat(200)) // 200 字，超过 120
      lines.push('')
    }
    const out = await parseLocal([{ name: '张三.txt', content: lines.join('\n') }], 2025)
    const s = Object.values(out.samples)[0]
    expect(s.length).toBeLessThanOrEqual(60)
    expect(s.length).toBeGreaterThan(30) // 证明确实放大了（默认 30 会正好卡 30）
    for (const line of s) expect(line.length).toBeLessThanOrEqual(120 + 3) // 「对方：」前缀约 3 字
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/parseLocal.test.ts`
Expected: FAIL —— `parseLocal(...)` 现返回同步值而非 Promise（旧签名），`ParseProgress` 未导出，`progress 回调带阶段推进` 断言不满足。

- [ ] **Step 3: 实现 async + 阶段化 parseLocal**

把 `packages/miniapp/src/adapters/parseLocal.ts` 中 `export function parseLocal(...) { ... }`（第 56-74 行）整体替换为：

```ts
/** parseLocal 进度阶段：解析逐文件推进 / 聚合建报告（单次同步、无子进度）。 */
export type ParsePhase = 'parsing' | 'aggregating'
export interface ParseProgress { phase: ParsePhase; done: number; total: number }

/** 让渲染线程刷新一拍：中间进度必须靠宏任务让渡才能被 setData 刷出来（微信双线程）。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))
/** 每解析这么多文件让渡一次渲染线程，兼顾"进度可见"与"让渡开销"。 */
const YIELD_EVERY = 20

export async function parseLocal(
  files: LocalFile[],
  year: number,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseOutcome> {
  let conversations: Conversation[] = []
  const warnings: string[] = []
  const total = files.length
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const r = parseFile(f.name, f.content)
    conversations = mergeConversations(conversations, r.conversations)
    r.warnings.forEach((w) => warnings.push(`${f.name}: ${w.reason}`))
    onProgress?.({ phase: 'parsing', done: i + 1, total })
    if ((i + 1) % YIELD_EVERY === 0) await tick()   // 让渲染线程刷出中间百分比
  }
  // 聚合前先报阶段并让一拍："生成报告"文案与动画条得以先渲染，再跑同步聚合
  onProgress?.({ phase: 'aggregating', done: 0, total: 1 })
  await tick()
  const friends = aggregate(conversations)
  const report = buildReport(conversations, friends, year)
  const samples = extractFriendSamples(conversations, SAMPLE_OPTS)
  const { recentInsights, recentSamples } = computeRecentInsights(conversations)
  return { friends, report, warnings, samples, recentInsights, recentSamples }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/parseLocal.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/parseLocal.ts packages/miniapp/src/adapters/__tests__/parseLocal.test.ts
git commit -m "feat(miniapp): parseLocal 改 async + 阶段化进度回调

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: import store 新增 `phase` 状态与 `beginReading`

**Files:**
- Modify: `packages/miniapp/src/stores/import.ts`（新增类型/ref/方法；改 `run` 里的 `parseLocal` 调用与收尾；改 `reset`；改 return）
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`（新增用例，追加到首个 `describe('import store')` 块内）

**Interfaces:**
- Consumes：Task 1 的 `await parseLocal(files, year, (p: ParseProgress) => ...)`。
- Produces（Task 3 依赖）：
  - store 暴露 `phase`（`Ref<ImportPhase>`）、`beginReading(): void`。
  - `beginReading()` 置 `status='parsing'`、`phase='reading'`、`progress=0`、清空 `warnings`/`error`。
  - `run` 正常完成后 `phase='idle'`、`status='done'`；catch 时 `phase='idle'`、`status='error'`。
  - `reset()` 复位 `phase='idle'`。

- [ ] **Step 1: 写失败测试**

在 `import.test.ts` 顶部 `describe('import store', () => { ... })` 块**内**（如放在最后一个 `it` 之后、`})` 之前）追加 3 个用例：

```ts
  it('beginReading 置读取阶段并清空提示', () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    imp.warnings = ['旧提示']; imp.error = '旧错误'
    imp.beginReading()
    expect(imp.status).toBe('parsing')
    expect(imp.phase).toBe('reading')
    expect(imp.progress).toBe(0)
    expect(imp.warnings).toEqual([])
    expect(imp.error).toBe('')
  })

  it('run 正常完成后 phase 归 idle、status done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.phase).toBe('idle')
  })

  it('reset 复位 phase 与 status', () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s, suggest: async () => ({}), loadSamples: () => [] })
    const imp = useImport()
    imp.beginReading()
    imp.reset()
    expect(imp.phase).toBe('idle')
    expect(imp.status).toBe('idle')
  })
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL —— `imp.beginReading` 不是函数、`imp.phase` 为 `undefined`。

- [ ] **Step 3: 实现 store 改动**

改动 `packages/miniapp/src/stores/import.ts`，四处：

3a. 在 `export type ImportStatus = ...`（第 36 行）下方新增阶段类型：

```ts
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'
/** 导入子阶段：读取/解压 → 解析 → 聚合建报告。用于进度条形态与三步指示器。 */
export type ImportPhase = 'idle' | 'reading' | 'parsing' | 'aggregating'
```

3b. 在 `const progress = ref(0)`（第 54 行）下方新增：

```ts
    const phase = ref<ImportPhase>('idle')

    /** 页面在选文件/解压之前调用：让①读取阶段可见（此段无子进度，页面用动画条）。 */
    function beginReading() {
      status.value = 'parsing'
      phase.value = 'reading'
      progress.value = 0
      warnings.value = []
      error.value = ''
    }
```

3c. 改 `run` 里 `if (chatFiles.length) {` 分支的 `parseLocal` 调用（第 138-139 行附近）。把：

```ts
        if (chatFiles.length) {
          const outcome = parseLocal(chatFiles, year, (p) => { progress.value = p })
```

替换为：

```ts
        if (chatFiles.length) {
          phase.value = 'parsing'
          const outcome = await parseLocal(chatFiles, year, (p) => {
            phase.value = p.phase
            if (p.phase === 'parsing') progress.value = p.total ? p.done / p.total : 0
          })
```

3d. 在 `run` 收尾处置 `phase='idle'`。把成功路径末尾（第 170 行）：

```ts
        status.value = 'done'
      } catch (e) {
        error.value = (e as Error).message
        status.value = 'error'
        analyzing.value = null
      }
```

替换为：

```ts
        status.value = 'done'
        phase.value = 'idle'
      } catch (e) {
        error.value = (e as Error).message
        status.value = 'error'
        phase.value = 'idle'
        analyzing.value = null
      }
```

3e. 改 `reset`（第 224 行）加入 `phase`：

```ts
    function reset() { status.value = 'idle'; phase.value = 'idle'; progress.value = 0; warnings.value = []; error.value = ''; analyzing.value = null; analyzingStocks.value = null; stocksSavedCount.value = 0 }
```

3f. 改 return（第 225-229 行）暴露 `phase`、`beginReading`：

```ts
    return {
      status, phase, progress, warnings, error, analyzing, analyzingStocks, stocksSavedCount,
      analyzingIds,
      run, beginReading, analyzePendingRoles, analyzeOne, analyzeStocks, reset,
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS（新 3 例 + 原有全部）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): import store 新增 phase 阶段状态与 beginReading

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 导入页三步指示器 + 分阶段进度条 UI

**Files:**
- Modify: `packages/miniapp/src/pages/import/import.vue`（`<script setup>`、`<template>` 进度块、`<style>`）

**Interfaces:**
- Consumes：Task 2 的 `imp.phase`、`imp.beginReading()`、`imp.reset()`、`imp.run()`。
- Produces：无下游依赖（末端 UI）。

**说明：** 该页无单元测试（纯展示性绑定）。验证靠"整包测试不回归 + 微信开发者工具人工冒烟"。

- [ ] **Step 1: 改 `<script setup>` —— onImport 接入 beginReading/reset，新增阶段计算**

在 `import.vue` 中，把 `const pct = computed(...)` 与 `onImport` 一段（第 24-48 行）替换为：

```ts
const pct = computed(() => Math.round(imp.progress * 100))

const STEP_ORDER = ['reading', 'parsing', 'aggregating'] as const
/** 三步指示器某一步相对当前 phase 的类：已过→done，当前→active，未到→''。 */
function stepCls(step: (typeof STEP_ORDER)[number]) {
  const cur = STEP_ORDER.indexOf(imp.phase as (typeof STEP_ORDER)[number])
  if (cur < 0) return ''
  const me = STEP_ORDER.indexOf(step)
  if (me < cur) return 'done'
  if (me === cur) return 'active'
  return ''
}
const phaseLabel = computed(() => {
  switch (imp.phase) {
    case 'reading': return '正在读取文件…（解压中）'
    case 'parsing': return `正在解析… ${pct.value}%`
    case 'aggregating': return '正在生成报告…'
    default: return '处理中…'
  }
})

async function onImport() {
  imp.beginReading()                       // 选文件/解压前先亮①读取阶段
  try {
    // chooseMessageFile 的 count 是「最多可选」上限；原先写死 10 会让多文件导出只能选一小部分（好友大量丢失）。
    // 设 500 放宽上限（真机实际可选数仍受微信客户端限制）；超量时可分多次导入，mergeFriends 会自动累加合并。
    const files = await fileReader.pickAndRead(500)
    if (!files.length) { imp.reset(); return }   // 用户取消：清掉读取进度块
    const a = assessImportSize(files)
    if (a.warn) {
      const ok = await new Promise<boolean>((resolve) => {
        uni.showModal({
          title: '数据较大',
          content: `本次约 ${a.sizeMB.toFixed(0)} MB / ${a.count} 个文件，建议分批导入以免卡顿。仍要继续吗？`,
          success: (r) => resolve(r.confirm),
        })
      })
      if (!ok) { imp.reset(); return }           // 放弃导入：清掉读取进度块
    }
    await imp.run(files, year.value)
  } catch (e) {
    // 读文件/解压阶段的异常以前被静默吞掉（表现为「选完文件没反应」），这里显式提示
    imp.reset()                                  // 清掉卡在读取阶段的进度块
    uni.showToast({ title: (e as Error).message || '导入失败', icon: 'none' })
  }
}
```

- [ ] **Step 2: 改 `<template>` 进度块 —— 三步指示器 + 分阶段进度条**

把模板里（第 79-82 行）：

```html
      <view v-if="imp.status === 'parsing'" class="status">
        <view class="bar"><view class="bar-in" :style="{ width: pct + '%' }"></view></view>
        <text class="status-t muted">解析中… {{ pct }}%</text>
      </view>
```

替换为：

```html
      <view v-if="imp.status === 'parsing'" class="status">
        <view class="steps3">
          <text class="s3" :class="stepCls('reading')">① 读取</text>
          <text class="s3-sep">›</text>
          <text class="s3" :class="stepCls('parsing')">② 解析</text>
          <text class="s3-sep">›</text>
          <text class="s3" :class="stepCls('aggregating')">③ 生成报告</text>
        </view>
        <view class="bar" :class="{ indet: imp.phase !== 'parsing' }">
          <view class="bar-in" :style="imp.phase === 'parsing' ? { width: pct + '%' } : undefined"></view>
        </view>
        <text class="status-t muted">{{ phaseLabel }}</text>
      </view>
```

- [ ] **Step 3: 加 CSS —— 三步指示器样式 + 不确定态动画条**

在 `<style scoped>` 中，`.bar-in { ... }` 规则（第 165 行）之后追加：

```css
.steps3 { display: flex; align-items: center; gap: 10rpx; margin-bottom: 16rpx; }
.s3 { font-size: 22rpx; color: var(--faint); }
.s3.active { color: var(--accent-strong); font-weight: 600; }
.s3.done { color: var(--muted); }
.s3-sep { color: var(--faint); font-size: 20rpx; }
/* 不确定态：一段高亮块来回滑动。动画跑在渲染线程，逻辑线程解压/聚合阻塞时仍持续滑动。 */
.bar.indet .bar-in { width: 40%; animation: indet 1.1s ease-in-out infinite; }
@keyframes indet {
  0%   { margin-left: -40%; }
  100% { margin-left: 100%; }
}
```

- [ ] **Step 4: 整包测试确认无回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（全部测试文件通过，无因页面改动引入的 TS 报错）。

- [ ] **Step 5: 人工冒烟（微信开发者工具）**

Run: `pnpm --filter @nianlun/miniapp dev:mp-weixin`，在微信开发者工具打开 `dist/dev/mp-weixin`，进入导入页点「从文件传输助手导入」。
Expected：
- 选文件/解压时：三步指示器①高亮，进度条为来回滑动的动画条，文案「正在读取文件…（解压中）」。
- 解析时：②高亮、①置灰勾，进度条百分比逐格上涨，文案「正在解析… x%」。
- 生成报告时：③高亮，进度条回到滑动动画条，文案「正在生成报告…」。
- 完成后进度块消失、显示「✅ 已导入」。
- 选文件弹窗点取消：进度块立即消失、无残留。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 导入页三步指示器 + 分阶段进度条

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage：**
  - 三阶段模型（reading/parsing/aggregating）→ Task 1（parsing/aggregating 回调）、Task 2（phase 状态 + reading）、Task 3（三步 UI）。✅
  - 解析真百分比（每 20 文件 yield）→ Task 1 Step 3。✅
  - 不确定态动画条（reading/aggregating）→ Task 3 Step 3 `@keyframes indet`。✅
  - `beginReading` + 取消/异常复位 → Task 2（方法）、Task 3 Step 1（onImport 三处 reset）。✅
  - 测试：parseLocal 改 async + 阶段序列（Task 1）、store phase/beginReading/reset（Task 2）、既有 run 测试保持（Task 2 内部改 await）。✅
- **Placeholder scan：** 无 TBD/TODO；每个改动步骤含完整代码。✅
- **Type consistency：** `ImportPhase`/`ParsePhase`/`ParseProgress` 全程一致；`beginReading`、`stepCls`、`phaseLabel`、`STEP_ORDER`、`YIELD_EVERY`、`tick` 命名前后一致；store return 暴露 `phase`+`beginReading` 与 Task 3 引用一致。✅
