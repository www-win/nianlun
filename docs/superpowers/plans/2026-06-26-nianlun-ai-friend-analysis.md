# 年轮 AI 好友分析 实施计划（第一期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「年轮」好友详情抽屉加一个「✨ AI 分析」功能：根据单个好友的现有统计数据，调用已接入的 AI 服务生成一段中文关系画像，临时显示在抽屉里。

**Architecture:** 把已完成的「AI 报告文案」面板抽成一个共享组件 `AiPanel`，由报告页与好友页复用。`core` 加一个纯函数把单个 `Friend` 转成提示词；`AiPanel` 复用现有 `aiClient.generateText` 与 `settings` store。遵循铁律 `web → core`、`core` 不碰网络/DOM；结果只临时显示，不持久化。

**Tech Stack:** TypeScript、Vue 3（组合式 API）、Pinia、Vitest、@vue/test-utils（jsdom）。pnpm workspace。

## Global Constraints

- `core` 必须保持纯净：不 import `web`，不碰 `window`/`document`/`fetch`/网络。提示词逻辑放 `core`。
- 关系类型 `Relation`、`Friend` 类型从 `@nianlun/core` import，绝不重定义。
- AI 只接收单个 `Friend` 的聚合统计字段，绝不接收聊天原文。
- 显示名优先级：`alias || name`（与现有 `buildReportCopyPrompt` 一致）。
- 隐私提示文案（逐字）：`使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。`
- key 只存 localStorage，绝不写进代码 / 不进 git。
- 复用现有 `generateText(prompt, settings, fetchImpl?)`（`packages/web/src/adapters/aiClient.ts`）与 `useSettingsStore()`（`packages/web/src/stores/settings.ts`），不改它们。
- DRY：报告页与好友页共用一个 `AiPanel.vue`，不各写一份重复面板。
- 测试命令：core 用 `pnpm --filter @nianlun/core exec vitest run`；web 用 `pnpm --filter @nianlun/web exec vitest run`。

## File Structure

- `packages/core/src/ai/prompts.ts`（改）— 追加 `buildFriendAnalysisPrompt`。
- `packages/core/src/index.ts`（改）— 导出新函数。
- `packages/web/src/components/AiPanel.vue`（新）— 通用 AI 面板，props 驱动。
- `packages/web/src/components/AiCopyPanel.vue`（删）— 被 `AiPanel` 取代。
- `packages/web/src/pages/ReportPage.vue`（改）— 改用 `AiPanel`。
- `packages/web/src/pages/FriendsPage.vue`（改）— 抽屉里接入 `AiPanel`。
- 测试：新增 `__tests__/AiPanel.test.ts`、`ai/__tests__/prompts.test.ts`（追加）；删 `__tests__/AiCopyPanel.test.ts`。

---

### Task 1: core — 构建好友分析提示词

**Files:**
- Modify: `packages/core/src/ai/prompts.ts`
- Modify: `packages/core/src/index.ts`（当前第 13 行为 `export { buildReportCopyPrompt } from './ai/prompts'`）
- Test: `packages/core/src/ai/__tests__/prompts.test.ts`（已存在，追加 describe 块）

**Interfaces:**
- Consumes: `Friend`（来自 `../model/types`）。
- Produces: `buildFriendAnalysisPrompt(friend: Friend): string`，从 `@nianlun/core` 导出。

- [ ] **Step 1: 写失败测试**

`prompts.test.ts` 顶部现有 import 为：
```ts
import { describe, it, expect } from 'vitest'
import type { ReportData, Friend } from '../../model/types'
import { buildReportCopyPrompt } from '../prompts'
```
把第三行改为同时引入两个函数：
```ts
import { buildReportCopyPrompt, buildFriendAnalysisPrompt } from '../prompts'
```
然后在文件**末尾追加**：

```ts
const friendForAnalysis: Friend = {
  id: 'f9', name: '阿强', alias: '', rel: '同事', role: '产品经理',
  firstContact: 1700000000000, lastContact: 1730000000000, msgCount: 820, sentRatio: 65,
  peakPeriod: '深夜', maxStreak: 14, monthly: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 130],
  userEdited: {},
}

describe('buildFriendAnalysisPrompt', () => {
  it('提示词里包含该好友的关键统计字段', () => {
    const p = buildFriendAnalysisPrompt(friendForAnalysis)
    expect(p).toContain('阿强')
    expect(p).toContain('同事')
    expect(p).toContain('产品经理')
    expect(p).toContain('820')
    expect(p).toContain('65')
    expect(p).toContain('深夜')
  })

  it('用 alias 优先于 name 显示好友', () => {
    const p = buildFriendAnalysisPrompt({ ...friendForAnalysis, alias: '强哥' })
    expect(p).toContain('强哥')
  })

  it('要求输出中文画像、不罗列数字清单', () => {
    const p = buildFriendAnalysisPrompt(friendForAnalysis)
    expect(p).toContain('画像')
    expect(p).toContain('只输出')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: FAIL（`buildFriendAnalysisPrompt` 未导出 / 不是函数）。

- [ ] **Step 3: 写实现**

在 `packages/core/src/ai/prompts.ts` 文件**末尾追加**（保留现有 `buildReportCopyPrompt`，文件顶部已 `import type { Friend, ReportData } from '../model/types'`）：

```ts
export function buildFriendAnalysisPrompt(friend: Friend): string {
  const displayName = friend.alias || friend.name
  const monthly = friend.monthly.map((n, i) => `${i + 1}月 ${n}`).join('，')

  return [
    '你是一位温暖细腻、擅长观察人际关系的写手。请根据下面这位微信好友的往来统计数据，',
    '写一段 100~200 字、有温度、口语化的中文「关系画像」，适合放进个人年度回顾。',
    '描述你们的关系亲疏、互动节奏、以及值得记住的点。',
    '不要罗列数字清单，把数字自然融进叙述里。只输出画像本身，不要标题、不要解释。',
    '',
    '统计数据（均为聚合统计，不含聊天内容）：',
    `- 好友：${displayName}`,
    `- 关系标签：${friend.rel}`,
    `- 职务/备注：${friend.role || '（未填）'}`,
    `- 全年消息往来：${friend.msgCount} 条`,
    `- 我方发送占比：${friend.sentRatio}%`,
    `- 活跃时段：${friend.peakPeriod || '（无）'}`,
    `- 最长连续聊天：${friend.maxStreak} 天`,
    `- 首次联系时间戳：${friend.firstContact}`,
    `- 最近联系时间戳：${friend.lastContact}`,
    `- 全年月度消息分布：${monthly}`,
  ].join('\n')
}
```

- [ ] **Step 4: 导出**

Modify `packages/core/src/index.ts` 第 13 行，把 `buildFriendAnalysisPrompt` 加进现有花括号（不要新增重复的 `from './ai/prompts'` 语句）：

```ts
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: PASS（原有 2 个 + 新增 3 个，共 5 个测试）。

- [ ] **Step 6: 构建 core（web 依赖其 dist）**

Run: `pnpm --filter @nianlun/core build`
Expected: tsup 成功输出 dist/，无类型错误。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/ai/prompts.ts packages/core/src/ai/__tests__/prompts.test.ts packages/core/src/index.ts
git commit -m "feat(core): add buildFriendAnalysisPrompt for AI friend analysis"
```

---

### Task 2: web — 抽取共享 AiPanel 组件，迁移报告页

把现有 `AiCopyPanel.vue`（设置 + 生成 + 三态 + 隐私提示）抽成通用 `AiPanel.vue`，由 `buildPrompt` 闭包驱动；报告页改用它；删除旧的 `AiCopyPanel.vue` 及其测试。

**Files:**
- Create: `packages/web/src/components/AiPanel.vue`
- Create: `packages/web/src/components/__tests__/AiPanel.test.ts`
- Modify: `packages/web/src/pages/ReportPage.vue`
- Delete: `packages/web/src/components/AiCopyPanel.vue`
- Delete: `packages/web/src/components/__tests__/AiCopyPanel.test.ts`

**Interfaces:**
- Consumes: `generateText`（`../adapters/aiClient`，现有）、`useSettingsStore`（`../stores/settings`，现有）、`buildReportCopyPrompt`（`@nianlun/core`，现有，在 ReportPage 中调用）。
- Produces: 组件 `AiPanel`，props `{ buildPrompt: () => string; buttonLabel: string; busyLabel: string }`。按钮带 `data-test="gen"`，结果带 `data-test="result"`。

> 现有 `AiCopyPanel.vue` 无 `<style>` 块，外观仅靠全局 `.btn/.btn-primary/.btn-sm/.wrap` 类；`AiPanel.vue` 同样不加 scoped 样式，保持零视觉回归。报告页用 `class="wrap"` 传给 `AiPanel` 以保留原 `class="wrap ai-panel"` 的居中布局。

- [ ] **Step 1: 写失败测试**

Create `packages/web/src/components/__tests__/AiPanel.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiPanel from '../AiPanel.vue'
import { useSettingsStore } from '../../stores/settings'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '生成的文案结果。'),
}))
import { generateText } from '../../adapters/aiClient'

const baseProps = {
  buildPrompt: () => '测试提示词',
  buttonLabel: '✨ 生成',
  busyLabel: '生成中…',
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AiPanel', () => {
  it('未配置时按钮禁用', () => {
    const w = mount(AiPanel, { props: baseProps })
    expect(w.find('[data-test="gen"]').attributes('disabled')).toBeDefined()
  })

  it('显示隐私提示与按钮文案', () => {
    const w = mount(AiPanel, { props: baseProps })
    expect(w.text()).toContain('相关统计数据会发送至 AI 服务进行处理')
    expect(w.find('[data-test="gen"]').text()).toContain('✨ 生成')
  })

  it('配置后点击，调用 buildPrompt 与 generateText 并显示结果', async () => {
    useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
    const buildPrompt = vi.fn(() => '我的提示词')
    const w = mount(AiPanel, { props: { ...baseProps, buildPrompt } })
    await w.find('[data-test="gen"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(buildPrompt).toHaveBeenCalled()
    expect(generateText).toHaveBeenCalledOnce()
    expect(generateText).toHaveBeenCalledWith('我的提示词', expect.anything())
    expect(w.find('[data-test="result"]').text()).toContain('生成的文案结果')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiPanel.test.ts`
Expected: FAIL（找不到 `../AiPanel.vue`）。

- [ ] **Step 3: 写实现**

Create `packages/web/src/components/AiPanel.vue`：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { generateText } from '../adapters/aiClient'

const props = defineProps<{
  buildPrompt: () => string
  buttonLabel: string
  busyLabel: string
}>()

const settings = useSettingsStore()

const baseUrl = ref(settings.baseUrl)
const apiKey = ref(settings.apiKey)
const model = ref(settings.model)
function saveSettings() {
  settings.update({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value })
}

const isConfigured = computed(() => settings.isConfigured)

const loading = ref(false)
const error = ref('')
const result = ref('')

async function generate() {
  error.value = ''
  result.value = ''
  loading.value = true
  try {
    const prompt = props.buildPrompt()
    result.value = await generateText(prompt, {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '生成失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="ai-panel">
    <details class="ai-settings">
      <summary>AI 设置</summary>
      <label>接入地址
        <input v-model="baseUrl" placeholder="https://api.gaccode.com" />
      </label>
      <label>API Key
        <input v-model="apiKey" type="password" placeholder="sk-..." />
      </label>
      <label>模型
        <input v-model="model" />
      </label>
      <button type="button" @click="saveSettings">保存</button>
    </details>

    <button
      class="btn btn-primary btn-sm"
      type="button"
      data-test="gen"
      :disabled="!isConfigured || loading"
      @click="generate"
    >
      {{ loading ? busyLabel : buttonLabel }}
    </button>
    <p class="ai-privacy">使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。</p>

    <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
    <p v-if="result" class="ai-result" data-test="result">{{ result }}</p>
  </section>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiPanel.test.ts`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 报告页改用 AiPanel**

Modify `packages/web/src/pages/ReportPage.vue`：

a) `<script setup>` import 区：把
```ts
import AiCopyPanel from '../components/AiCopyPanel.vue'
```
改为
```ts
import AiPanel from '../components/AiPanel.vue'
import { buildReportCopyPrompt } from '@nianlun/core'
```

b) 在 `<script setup>` 内（如 `function save()` 附近）加一个类型安全的提示词闭包：
```ts
function reportPrompt() {
  return report.value ? buildReportCopyPrompt(report.value, data.friends) : ''
}
```
> `report` 是 `computed(() => data.report)`，类型 `ReportData | null`；此守卫保证传给 `buildReportCopyPrompt` 的是非空 `ReportData`，满足 vue-tsc。`AiPanel` 仅在按钮点击时调用 `buildPrompt`，而此处 `AiPanel` 位于 `report` 非空的 `v-else` 块内，空串分支不会实际触发。

c) 模板里把
```html
    <AiCopyPanel :report="report" :friends="data.friends" />
```
改为
```html
    <AiPanel
      class="wrap"
      :build-prompt="reportPrompt"
      button-label="✨ AI 生成文案"
      busy-label="生成中…"
    />
```

- [ ] **Step 6: 删除旧组件与旧测试**

```bash
git rm packages/web/src/components/AiCopyPanel.vue packages/web/src/components/__tests__/AiCopyPanel.test.ts
```

- [ ] **Step 7: 全量 web 测试 + 构建通过**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: 全部 PASS（含新增 AiPanel 测试；旧 AiCopyPanel 测试已删除）。

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 与 `vite build` 成功，无类型错误（报告页 `report.value` 守卫保证类型安全）。

- [ ] **Step 8: 提交**

```bash
git add packages/web/src/components/AiPanel.vue packages/web/src/components/__tests__/AiPanel.test.ts packages/web/src/pages/ReportPage.vue
git commit -m "refactor(web): extract shared AiPanel from AiCopyPanel"
```

---

### Task 3: web — 好友抽屉接入 AiPanel

**Files:**
- Modify: `packages/web/src/pages/FriendsPage.vue`

**Interfaces:**
- Consumes: `AiPanel`（Task 2，props `{ buildPrompt, buttonLabel, busyLabel }`）、`buildFriendAnalysisPrompt`（`@nianlun/core`，Task 1）、`drawerFriend`（已有 ref，类型 `Friend | null`）。

- [ ] **Step 1: 引入组件与函数**

Modify `packages/web/src/pages/FriendsPage.vue` 的 `<script setup>` import 区。现有顶部为：
```ts
import { ref, computed } from 'vue'
import { useDataStore } from '../stores/data'
import type { Friend, Relation } from '@nianlun/core'
import TheTopbar from '../components/TheTopbar.vue'
import TheFooter from '../components/TheFooter.vue'
```
把 `@nianlun/core` 那行改为同时引入函数，并加一行组件 import：
```ts
import type { Friend, Relation } from '@nianlun/core'
import { buildFriendAnalysisPrompt } from '@nianlun/core'
import AiPanel from '../components/AiPanel.vue'
```

- [ ] **Step 2: 加好友提示词闭包**

在 `<script setup>` 内（如 `closeDrawer` 函数附近）加：
```ts
function friendPrompt() {
  return drawerFriend.value ? buildFriendAnalysisPrompt(drawerFriend.value) : ''
}
```
> `drawerFriend` 类型 `Friend | null`，守卫保证传非空 `Friend`，满足 vue-tsc。

- [ ] **Step 3: 在抽屉里插入面板**

在模板抽屉 `.drawer-body`（`v-if="drawerFriend"` 块）内，「编辑信息」小节标题 `<div class="d-sec-title">编辑信息</div>` **之前**，插入：

```html
      <div class="d-sec-title">AI 分析</div>
      <AiPanel
        :key="drawerFriend.id"
        :build-prompt="friendPrompt"
        button-label="✨ AI 分析"
        busy-label="分析中…"
      />
```
> `:key="drawerFriend.id"` 让切换好友时组件重建、清空上一位的分析结果（实现「临时显示、关掉即丢弃」）。此处位于 `v-if="drawerFriend"` 内，`drawerFriend` 已非空。

- [ ] **Step 4: 类型检查 + 构建通过**

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 与 `vite build` 都成功，无类型错误。

- [ ] **Step 5: 全量 web 测试通过**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/FriendsPage.vue
git commit -m "feat(web): add AI friend analysis to friend detail drawer"
```

---

### Task 4: 端到端联调（手动，需真实 key）

**Files:** 无（手动）

> 与第一期一致：此步需要 gaccode 控制台的真实接入地址 + 专用 key；若暂无 key 可跳过，不影响前三个任务的交付。

- [ ] **Step 1: 本机真实联调**

Run: `pnpm --filter @nianlun/web dev`
导入聊天数据 → 进好友页 → 点任意一行打开抽屉 → 展开「AI 设置」填入真实接入地址 + 专用 key（报告页填过则已自动带入）→ 点「✨ AI 分析」。
Expected: 几秒后出现一段中文好友画像；无报错。

- [ ] **Step 2: 错误路径自检**

把 key 改成错误值再点分析。
Expected: 显示「API Key 无效…」红色提示，不崩页。

- [ ] **Step 3: 切换好友自检**

关闭抽屉，打开另一位好友，确认上一位的分析结果不残留（结果区为空，需重新点击才生成）。

- [ ] **Step 4: 报告页回归自检**

进报告页点「✨ AI 生成文案」，确认抽取共享组件后报告文案功能仍正常。

---

## Self-Review

**1. Spec coverage（对照设计文档逐节核对）：**
- §1 仅喂聚合统计、不含原文 → Task 1 提示词仅取 `Friend` 字段 ✅
- §2 架构（core 纯函数 / 抽取共享 AiPanel / 复用 aiClient+settings / 接入抽屉）→ Task 1、2、3 ✅
- §2 DRY 决策（抽共享 AiPanel、取代 AiCopyPanel）→ Task 2 ✅
- §3.1 `buildFriendAnalysisPrompt(friend)` 契约 → Task 1 ✅
- §3.2 `AiPanel` props（buildPrompt/buttonLabel/busyLabel）+ 三态 + 内置设置 + 隐私提示 → Task 2 ✅
- §3.3 接入 FriendsPage 抽屉、`:key` 切换清空、仅 drawerFriend 非空渲染 → Task 3 ✅
- §4 数据流不触 IndexedDB / 不调 updateFriend → Task 2/3 均未涉及 ✅
- §5 错误处理继承 generateText 语义 → Task 2 catch 分支 + Task 4 Step 2 ✅
- §6 测试（core 单测 / web mock 组件测 / 全量 + build）→ Task 1 Step 1、Task 2 Step 1、Task 2/3 build ✅
- §7 范围之外（写回/批量/持久化/原文/streaming 不做）→ 计划未涉及 ✅
- §8 报告页与好友页复用同一 AiPanel → Task 2、3 ✅

**2. Placeholder scan：** 无 TBD/TODO，每个代码步骤都给了完整代码与命令。✅

**3. Type consistency：** `buildFriendAnalysisPrompt(friend: Friend): string`（Task 1）签名与 Task 3 `friendPrompt` 调用一致；`AiPanel` props `{ buildPrompt: () => string; buttonLabel; busyLabel }`（Task 2）与 Task 2 报告页、Task 3 好友页传参一致（`:build-prompt`/`button-label`/`busy-label`）；`data-test="gen"`/`data-test="result"`（Task 2 实现）与 AiPanel 测试断言一致；复用的 `generateText`、`useSettingsStore` 签名与现有代码一致。✅
