# 统一进度条 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 miniapp 各页面的等待操作（尤其云函数/AI 拉取）加统一进度条：可测的用真进度条、不可测的用滑动动画条，复用一个共享 `<ProgressBar>` 组件。

**Architecture:** 显示逻辑抽成纯函数 `resolveProgress()`（node 环境可单测，符合本仓库"纯逻辑抽出来测、薄视图不测"的既有模式），`ProgressBar.vue` 只是调用它的薄模板并承载迁移过来的 `.bar` CSS。各页面按自己的 store 状态内联该组件。

**Tech Stack:** uni-app (Vue 3 SFC) + Pinia + Vitest（`environment: 'node'`，无 jsdom/@vue/test-utils）。

## Global Constraints

- 包路径：`packages/miniapp`。命令一律用 `pnpm --filter @nianlun/miniapp ...`。
- 测试环境是 **node**，**不可**挂载 SFC；只对纯函数写单测。视图正确性靠 `build`（`vue-tsc`）+ 复用现有 CSS 保证。
- 组件手动 import（本仓库未启用 easycom）。
- 视觉 token 沿用现有：填充 `var(--accent)`、轨道 `var(--surface-2)`、条高 `12rpx`、圆角 `999rpx`、`transition: width .2s`、`@keyframes indet`（1.1s 单向扫动，`.bar-in` 宽 40%）。
- import.vue 改动**仅限模板/样式**，不碰 import store；现有 `import.test.ts` / `data.test.ts` 必须继续通过（它们只测 store）。
- 提交信息结尾附：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: `resolveProgress` 纯函数 + 单测

**Files:**
- Create: `packages/miniapp/src/components/progressBar.ts`
- Test: `packages/miniapp/src/components/__tests__/progressBar.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `interface ProgressBarProps { percent?: number; indeterminate?: boolean; label?: string }`
  - `interface ProgressBarView { mode: 'determinate' | 'indeterminate' | 'empty'; width: number; showLabel: boolean }`
  - `function resolveProgress(props: ProgressBarProps): ProgressBarView`
  - 规则：传了 `percent`（`typeof === 'number'`）→ `determinate`，`width = clamp(0,100,percent)`；否则 `indeterminate` 为真 → `indeterminate`，`width = 40`；都无 → `empty`，`width = 0`。`showLabel = !!label`（非空字符串）。

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/components/__tests__/progressBar.test.ts`
```ts
import { describe, it, expect } from 'vitest'
import { resolveProgress } from '../progressBar'

describe('resolveProgress', () => {
  it('传 percent → determinate，width 为该值', () => {
    expect(resolveProgress({ percent: 40 })).toEqual({ mode: 'determinate', width: 40, showLabel: false })
  })
  it('percent 越界被夹到 0..100', () => {
    expect(resolveProgress({ percent: -5 }).width).toBe(0)
    expect(resolveProgress({ percent: 150 }).width).toBe(100)
  })
  it('percent 优先于 indeterminate', () => {
    expect(resolveProgress({ percent: 20, indeterminate: true }).mode).toBe('determinate')
  })
  it('只有 indeterminate → 动画态，width 40', () => {
    expect(resolveProgress({ indeterminate: true })).toEqual({ mode: 'indeterminate', width: 40, showLabel: false })
  })
  it('都不传 → empty', () => {
    expect(resolveProgress({}).mode).toBe('empty')
  })
  it('label 非空 → showLabel true', () => {
    expect(resolveProgress({ percent: 10, label: '分析中 1/3' }).showLabel).toBe(true)
    expect(resolveProgress({ percent: 10, label: '' }).showLabel).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/components/__tests__/progressBar.test.ts`
Expected: FAIL（`Cannot find module '../progressBar'`）

- [ ] **Step 3: 写实现**

`packages/miniapp/src/components/progressBar.ts`
```ts
export interface ProgressBarProps {
  percent?: number
  indeterminate?: boolean
  label?: string
}

export interface ProgressBarView {
  mode: 'determinate' | 'indeterminate' | 'empty'
  /** 0–100，仅 determinate 时有意义（indeterminate 的 40% 由 CSS 控制）。 */
  width: number
  showLabel: boolean
}

/** 由 props 推导进度条展示状态。percent 优先于 indeterminate。 */
export function resolveProgress(props: ProgressBarProps): ProgressBarView {
  const showLabel = !!props.label
  if (typeof props.percent === 'number') {
    const width = Math.max(0, Math.min(100, props.percent))
    return { mode: 'determinate', width, showLabel }
  }
  if (props.indeterminate) {
    return { mode: 'indeterminate', width: 40, showLabel }
  }
  return { mode: 'empty', width: 0, showLabel }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/components/__tests__/progressBar.test.ts`
Expected: PASS（6 个用例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/components/progressBar.ts packages/miniapp/src/components/__tests__/progressBar.test.ts
git commit -m "feat(miniapp): resolveProgress 纯函数（进度条展示逻辑）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `ProgressBar.vue` 组件

**Files:**
- Create: `packages/miniapp/src/components/ProgressBar.vue`

**Interfaces:**
- Consumes: `resolveProgress`、`ProgressBarProps`（Task 1）。
- Produces: 组件 `<ProgressBar :percent :indeterminate :label />`。DOM 结构：外层 `.pbar-wrap` → `.bar`（indeterminate 时加 `.indet` 类）内含 `.bar-in`（determinate 时内联 `width`），可选 `.pbar-label`。

- [ ] **Step 1: 写组件**

`packages/miniapp/src/components/ProgressBar.vue`
```vue
<script setup lang="ts">
import { computed } from 'vue'
import { resolveProgress } from './progressBar'

const props = defineProps<{ percent?: number; indeterminate?: boolean; label?: string }>()
const view = computed(() => resolveProgress(props))
</script>

<template>
  <view class="pbar-wrap">
    <view class="bar" :class="{ indet: view.mode === 'indeterminate' }">
      <view class="bar-in" :style="view.mode === 'determinate' ? { width: view.width + '%' } : undefined"></view>
    </view>
    <text v-if="view.showLabel" class="pbar-label">{{ props.label }}</text>
  </view>
</template>

<style scoped>
.bar { height: 12rpx; border-radius: 999rpx; background: var(--surface-2); overflow: hidden; }
.bar-in { height: 100%; background: var(--accent); border-radius: 999rpx; transition: width .2s; }
/* 不确定态：一段高亮块单向循环扫动。动画跑在渲染线程，逻辑线程阻塞时仍持续滑动。 */
.bar.indet .bar-in { width: 40%; animation: indet 1.1s ease-in-out infinite; }
@keyframes indet {
  0%   { margin-left: -40%; }
  100% { margin-left: 100%; }
}
.pbar-label { display: block; margin-top: 14rpx; font-size: 24rpx; color: var(--muted); }
</style>
```

- [ ] **Step 2: 类型检查通过**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建/`vue-tsc` 无错误（组件被打包收录，无类型报错）。

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/components/ProgressBar.vue
git commit -m "feat(miniapp): ProgressBar 组件（可测/动画两态，复用 import 视觉）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: import.vue 改用 ProgressBar

**Files:**
- Modify: `packages/miniapp/src/pages/import/import.vue`

**Interfaces:**
- Consumes: `ProgressBar`（Task 2）。
- Produces: 无新接口。行为不变：`parsing` 阶段真进度、其余阶段动画条、`.steps3` 与 `phaseLabel` 文字保留。

- [ ] **Step 1: 引入组件**

在 `<script setup>` 顶部其它组件 import 旁加：
```ts
import ProgressBar from '../../components/ProgressBar.vue'
```

- [ ] **Step 2: 替换模板里的进度条**

把这段：
```html
        <view class="bar" :class="{ indet: imp.phase !== 'parsing' }">
          <view class="bar-in" :style="imp.phase === 'parsing' ? { width: pct + '%' } : undefined"></view>
        </view>
```
替换为：
```html
        <ProgressBar
          :percent="imp.phase === 'parsing' ? pct : undefined"
          :indeterminate="imp.phase !== 'parsing'" />
```
（`.steps3` 三步指示器与下面的 `<text class="status-t muted">{{ phaseLabel }}</text>` 原样保留。）

- [ ] **Step 3: 删除已迁走的 CSS**

从 import.vue `<style>` 删除这 3 处（已在组件内）：
```css
.bar { height: 12rpx; border-radius: 999rpx; background: var(--surface-2); overflow: hidden; }
.bar-in { height: 100%; background: var(--accent); border-radius: 999rpx; transition: width .2s; }
```
以及：
```css
.bar.indet .bar-in { width: 40%; animation: indet 1.1s ease-in-out infinite; }
@keyframes indet {
  0%   { margin-left: -40%; }
  100% { margin-left: 100%; }
}
```
保留 `.status-t`、`.steps3`、`.s3*` 等其它样式。

- [ ] **Step 4: 回归 store 测试 + 构建**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts src/stores/__tests__/data.test.ts`
Expected: PASS（store 未改，应仍全绿）
Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 无类型/编译错误

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/pages/import/import.vue
git commit -m "refactor(miniapp): import 进度条改用 ProgressBar 组件（行为不变）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: stock.vue 荐股分析真进度条

**Files:**
- Modify: `packages/miniapp/src/pages/stock/stock.vue`

**Interfaces:**
- Consumes: `ProgressBar`（Task 2）、`imp.analyzingStocks: { done: number; total: number } | null`（现有 import store 字段）。
- Produces: 无。

- [ ] **Step 1: 引入组件**

在 `<script setup>` import 区加：
```ts
import ProgressBar from '../../components/ProgressBar.vue'
```

- [ ] **Step 2: 在分析按钮下方插入进度条**

在触发 `onAnalyze` 的按钮元素之后（同一容器内）加：
```html
      <ProgressBar
        v-if="imp.analyzingStocks"
        :percent="imp.analyzingStocks.total
          ? Math.round(imp.analyzingStocks.done / imp.analyzingStocks.total * 100) : 0"
        :label="`分析荐股 ${imp.analyzingStocks.done}/${imp.analyzingStocks.total}`" />
```
（若不确定按钮确切位置，用 Grep 找到调用 `onAnalyze` 的 `<button ... @click="onAnalyze">`，紧随其后插入。）

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/stock/stock.vue
git commit -m "feat(miniapp): stock 荐股分析显示真进度条 done/total

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: chat-qa 思考气泡内嵌动画条

**Files:**
- Modify: `packages/miniapp/src/pages/chat-qa/chat-qa.vue`

**Interfaces:**
- Consumes: `ProgressBar`（Task 2）、`store.loading: boolean`（现有 chatQa store 字段）。
- Produces: 无。

- [ ] **Step 1: 引入组件**

在 `<script setup>` import 区加：
```ts
import ProgressBar from '../../components/ProgressBar.vue'
```

- [ ] **Step 2: 在"思考中"气泡内加动画条**

现有模板（约 41 行）为：
```html
      <view v-if="store.loading" class="bubble-row ai">
```
在该 `bubble-row` 内的气泡内容里加一条动画条（气泡原有"思考中"文字保留）：
```html
        <ProgressBar indeterminate />
```
放在该气泡内容元素之后。若该行是自闭合或结构不清，用 Read 打开 35–52 行确认气泡内层结构再插入到气泡 `<view>` 内部。

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/chat-qa/chat-qa.vue
git commit -m "feat(miniapp): chat-qa 思考气泡内嵌不确定进度条

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: overview 云备份/恢复动画条

**Files:**
- Modify: `packages/miniapp/src/pages/overview/overview.vue`

**Interfaces:**
- Consumes: `ProgressBar`（Task 2）、`backup.status: 'idle' | 'backing' | 'restoring' | 'error'`（现有 backup store 字段）。
- Produces: 无。

- [ ] **Step 1: 引入组件**

在 `<script setup>` import 区加：
```ts
import ProgressBar from '../../components/ProgressBar.vue'
```

- [ ] **Step 2: 备份按钮行下方加动画条**

现有按钮行（约 200–202 行）：
```html
        <button class="btn-primary" style="flex:1" :loading="backup.status==='backing'" @click="onBackup">立即备份到云</button>
        <button class="btn-ghost" style="flex:1" :loading="backup.status==='restoring'" @click="onRestore">从云端恢复</button>
```
在包住这两个按钮的容器 `</view>` 之后（同级）插入：
```html
      <ProgressBar
        v-if="backup.status === 'backing' || backup.status === 'restoring'"
        indeterminate
        :label="backup.status === 'backing' ? '正在备份到云…' : '正在从云端恢复…'" />
```
（按钮原生 `:loading` 转圈保留不动。）

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/overview/overview.vue
git commit -m "feat(miniapp): overview 云备份/恢复显示不确定进度条

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: friends 批量角色分析进度条

**Files:**
- Modify: `packages/miniapp/src/pages/friends/friends.vue`

**Interfaces:**
- Consumes: `ProgressBar`（Task 2）、`imp.analyzing: { done: number; total: number } | null`（现有 import store 字段）。
- Produces: 无。

- [ ] **Step 1: 引入组件**

在 `<script setup>` import 区加：
```ts
import ProgressBar from '../../components/ProgressBar.vue'
```
（若 friends.vue 尚未引用 import store，需一并加 `import { useImportStore } from '../../stores/import'` 并 `const imp = useImportStore()`；用 Grep 确认页面里是否已有 `imp` —— Task 调研显示 friends.vue 已调用 `imp.analyzeOne`/`imp.analyzingIds`，故 `imp` 应已存在，只需确认。）

- [ ] **Step 2: 列表顶部加批量进度条**

在好友列表容器起始处（列表首个 `v-for` 所在容器之前）插入：
```html
      <ProgressBar
        v-if="imp.analyzing"
        :percent="imp.analyzing.total
          ? Math.round(imp.analyzing.done / imp.analyzing.total * 100) : 0"
        :label="`分析关系/职务 ${imp.analyzing.done}/${imp.analyzing.total}`" />
```
（每行的 `imp.analyzingIds.has(f.id)` "分析中…"文字保留不动。）

- [ ] **Step 3: 构建验证**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/pages/friends/friends.vue
git commit -m "feat(miniapp): friends 批量角色分析显示进度条 done/total

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 收尾验证（全部任务后）

- [ ] Run: `pnpm --filter @nianlun/miniapp test`（全部单测绿，含新增 progressBar.test）
- [ ] Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`（uni 编译无错误）
- [ ] 可选真机/开发者工具冒烟：import 解析、stock 分析、chat-qa 提问、overview 备份 各出现对应进度条。
