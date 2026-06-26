# 年轮 AI 好友分析 实施计划（第一期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「年轮」好友详情抽屉加一个「✨ AI 分析」功能：根据单个好友的现有统计数据，调用已接入的 AI 服务生成一段中文关系画像，临时显示在抽屉里。

**Architecture:** 把已完成的「AI 报告文案」功能平移到单个好友身上。`core` 加一个纯函数把单个 `Friend` 转成提示词；`web` 加一个组件复用现有 `aiClient.generateText` 与 `settings` store，接入好友抽屉。遵循铁律 `web → core`、`core` 不碰网络/DOM；结果只临时显示，不持久化。

**Tech Stack:** TypeScript、Vue 3（组合式 API）、Pinia、Vitest、@vue/test-utils（jsdom）。pnpm workspace。

## Global Constraints

- `core` 必须保持纯净：不 import `web`，不碰 `window`/`document`/`fetch`/网络。提示词逻辑放 `core`。
- 关系类型 `Relation`、`Friend` 类型从 `@nianlun/core` import，绝不重定义。
- AI 只接收单个 `Friend` 的聚合统计字段，绝不接收聊天原文。
- 显示名优先级：`alias || name`（与现有 `buildReportCopyPrompt` 一致）。
- 隐私提示文案（逐字）：`使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。`
- key 只存 localStorage，绝不写进代码 / 不进 git。
- 复用现有 `generateText(prompt, settings, fetchImpl?)`（`packages/web/src/adapters/aiClient.ts`）与 `useSettingsStore()`（`packages/web/src/stores/settings.ts`），不改它们。
- 测试命令：core 用 `pnpm --filter @nianlun/core exec vitest run`；web 用 `pnpm --filter @nianlun/web exec vitest run`。

---

### Task 1: core — 构建好友分析提示词

**Files:**
- Modify: `packages/core/src/ai/prompts.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/prompts.test.ts`（已存在，追加 describe 块）

**Interfaces:**
- Consumes: `Friend`（来自 `../model/types`）。
- Produces: `buildFriendAnalysisPrompt(friend: Friend): string`，从 `@nianlun/core` 导出。

- [ ] **Step 1: 写失败测试**

在 `packages/core/src/ai/__tests__/prompts.test.ts` 文件**末尾追加**以下内容（文件顶部已有 `import { describe, it, expect } from 'vitest'` 与 `Friend` 类型 import，无需重复；若文件顶部未 import `buildFriendAnalysisPrompt`，把它加到现有的 `from '../prompts'` import 中）：

```ts
import { buildFriendAnalysisPrompt } from '../prompts'

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

> 注意：若 `prompts.test.ts` 顶部已有 `import type { ReportData, Friend } from '../../model/types'`，不要重复 import `Friend`；只需把 `buildFriendAnalysisPrompt` 加进已有的 `'../prompts'` import 行，并把上面新增的常量与 `describe` 块追加到文件末尾。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: FAIL（`buildFriendAnalysisPrompt` 未导出 / 不是函数）。

- [ ] **Step 3: 写实现**

在 `packages/core/src/ai/prompts.ts` 文件**末尾追加**（保留现有 `buildReportCopyPrompt`，文件顶部已 import `Friend`）：

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

Modify `packages/core/src/index.ts`，在现有 `export { buildReportCopyPrompt } from './ai/prompts'` 那行改为同时导出两个（或在其后补一行）：

```ts
export { buildReportCopyPrompt, buildFriendAnalysisPrompt } from './ai/prompts'
```

> 若原文件是 `export { buildReportCopyPrompt } from './ai/prompts'`，直接把 `buildFriendAnalysisPrompt` 加进花括号即可；不要新增重复的 `from './ai/prompts'` 语句。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: PASS（含原有 2 个 + 新增 3 个，共 5 个测试）。

- [ ] **Step 6: 构建 core（web 依赖其 dist）**

Run: `pnpm --filter @nianlun/core build`
Expected: tsup 成功输出 dist/，无类型错误。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/ai/prompts.ts packages/core/src/ai/__tests__/prompts.test.ts packages/core/src/index.ts
git commit -m "feat(core): add buildFriendAnalysisPrompt for AI friend analysis"
```

---

### Task 2: web — AiFriendPanel 组件（设置 + 分析按钮 + 结果）

**Files:**
- Create: `packages/web/src/components/AiFriendPanel.vue`
- Test: `packages/web/src/components/__tests__/AiFriendPanel.test.ts`

**Interfaces:**
- Consumes: `buildFriendAnalysisPrompt`（core，Task 1）、`generateText`（`../adapters/aiClient`，现有）、`useSettingsStore`（`../stores/settings`，现有）。
- Produces: 组件 `AiFriendPanel`，props `{ friend: Friend }`。

- [ ] **Step 1: 写失败测试**

Create `packages/web/src/components/__tests__/AiFriendPanel.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Friend } from '@nianlun/core'
import AiFriendPanel from '../AiFriendPanel.vue'
import { useSettingsStore } from '../../stores/settings'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '这是一段 AI 生成的好友画像。'),
}))
import { generateText } from '../../adapters/aiClient'

const friend: Friend = {
  id: 'f1', name: '小明', alias: '', rel: '挚友', role: '',
  firstContact: 1700000000000, lastContact: 1730000000000, msgCount: 500, sentRatio: 55,
  peakPeriod: '晚上', maxStreak: 7, monthly: new Array(12).fill(10), userEdited: {},
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AiFriendPanel', () => {
  it('未配置时分析按钮禁用', () => {
    const w = mount(AiFriendPanel, { props: { friend } })
    expect(w.find('[data-test="analyze"]').attributes('disabled')).toBeDefined()
  })

  it('显示隐私提示', () => {
    const w = mount(AiFriendPanel, { props: { friend } })
    expect(w.text()).toContain('相关统计数据会发送至 AI 服务进行处理')
  })

  it('配置后点击分析，显示结果并调用 generateText', async () => {
    useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
    const w = mount(AiFriendPanel, { props: { friend } })
    await w.find('[data-test="analyze"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(generateText).toHaveBeenCalledOnce()
    expect(w.find('[data-test="result"]').text()).toContain('AI 生成的好友画像')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiFriendPanel.test.ts`
Expected: FAIL（找不到 `../AiFriendPanel.vue`）。

- [ ] **Step 3: 写实现**

Create `packages/web/src/components/AiFriendPanel.vue`（结构与现有 `AiCopyPanel.vue` 对称）：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Friend } from '@nianlun/core'
import { buildFriendAnalysisPrompt } from '@nianlun/core'
import { useSettingsStore } from '../stores/settings'
import { generateText } from '../adapters/aiClient'

const props = defineProps<{ friend: Friend }>()
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

async function analyze() {
  error.value = ''
  result.value = ''
  loading.value = true
  try {
    const prompt = buildFriendAnalysisPrompt(props.friend)
    result.value = await generateText(prompt, {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '分析失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <section class="ai-friend-panel">
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
      data-test="analyze"
      :disabled="!isConfigured || loading"
      @click="analyze"
    >
      {{ loading ? '分析中…' : '✨ AI 分析' }}
    </button>
    <p class="ai-privacy">使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。</p>

    <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
    <p v-if="result" class="ai-result" data-test="result">{{ result }}</p>
  </section>
</template>

<style scoped>
.ai-friend-panel { display: grid; gap: 10px; }
.ai-settings { font-size: 13px; }
.ai-settings label { display: block; margin: 8px 0; font-size: 12px; color: var(--muted); }
.ai-settings input { display: block; width: 100%; margin-top: 4px; }
.ai-privacy { font-size: 11.5px; color: var(--faint); }
.ai-error { font-size: 13px; color: oklch(55% 0.18 25); }
.ai-result { font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
</style>
```

> 说明：测试只断言 `data-test="analyze"` / `data-test="result"` / 隐私文案，样式可按项目既有变量自由调整，不影响测试。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiFriendPanel.test.ts`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/AiFriendPanel.vue packages/web/src/components/__tests__/AiFriendPanel.test.ts
git commit -m "feat(web): add AiFriendPanel component (per-friend AI analysis)"
```

---

### Task 3: web — 把 AiFriendPanel 接入好友抽屉

**Files:**
- Modify: `packages/web/src/pages/FriendsPage.vue`

**Interfaces:**
- Consumes: `AiFriendPanel`（props `friend`）、`drawerFriend`（已有 ref，类型 `Friend | null`）。

- [ ] **Step 1: 引入组件**

Modify `packages/web/src/pages/FriendsPage.vue`，在 `<script setup>` 的 import 区（`TheFooter` 那行下面）加：

```ts
import AiFriendPanel from '../components/AiFriendPanel.vue'
```

- [ ] **Step 2: 在抽屉里插入面板**

在 `FriendsPage.vue` 模板的抽屉 `.drawer-body` 内，「编辑信息」整块（`<div class="d-sec-title">编辑信息</div>` 到其对应 `<div class="d-edit">…</div>` 结束）**之前**，插入：

```html
      <div class="d-sec-title">AI 分析</div>
      <AiFriendPanel :key="drawerFriend.id" :friend="drawerFriend" />
```

> `:key="drawerFriend.id"` 让切换好友时组件重建、清空上一位的分析结果（实现「临时显示、关掉即丢弃」）。此处位于 `v-if="drawerFriend"` 的 `.drawer-body` 内，`drawerFriend` 已非空。

- [ ] **Step 3: 类型检查 + 构建通过**

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 与 `vite build` 都成功，无类型错误。

- [ ] **Step 4: 全量 web 测试通过**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: 全部 PASS（含新增 AiFriendPanel 测试与既有全部测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/pages/FriendsPage.vue
git commit -m "feat(web): wire AiFriendPanel into friend detail drawer"
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

---

## Self-Review

**1. Spec coverage（对照设计文档逐节核对）：**
- §1 仅喂聚合统计、不含原文 → Task 1 提示词仅取 `Friend` 字段 ✅
- §2 架构（core 纯函数 / web 复用 aiClient+settings / 新增组件 / 接入抽屉）→ Task 1、2、3 ✅
- §3.1 `buildFriendAnalysisPrompt(friend)` 契约 → Task 1 ✅
- §3.2 `AiFriendPanel` 三态 + 内置 AI 设置 + 隐私提示 → Task 2 ✅
- §3.3 接入 FriendsPage 抽屉、仅 drawerFriend 非空渲染 → Task 3 ✅
- §4 数据流不触 IndexedDB / 不调 updateFriend → Task 2/3 均未涉及 ✅
- §5 错误处理继承 generateText 语义 → Task 2 catch 分支 + Task 4 Step 2 ✅
- §6 测试（core 单测 / web mock 组件测 / 全量 + build）→ Task 1 Step 1、Task 2 Step 1、Task 3 Step 3-4 ✅
- §7 范围之外（写回/批量/持久化/原文/streaming 不做）→ 计划未涉及 ✅
- §8 与报告文案对称 → Task 命名与结构对称 ✅

**2. Placeholder scan：** 无 TBD/TODO，每个代码步骤都给了完整代码与命令。✅

**3. Type consistency：** `buildFriendAnalysisPrompt(friend: Friend): string`（Task 1）签名与 Task 2 组件调用一致；`AiFriendPanel` props `{ friend: Friend }`（Task 2）与 Task 3 接入 `:friend="drawerFriend"` 一致；复用的 `generateText`、`useSettingsStore` 签名与现有代码一致。✅
