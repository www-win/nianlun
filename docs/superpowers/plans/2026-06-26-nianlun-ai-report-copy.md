# 年轮 AI 报告文案集成 实施计划（第一期）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给「年轮」加一个「✨ AI 生成文案」功能：根据已有的年度统计数据，调用 gaccode（兼容 Anthropic Messages API）生成一段中文年度总结文案，显示在报告页。

**Architecture:** 无后端。`core` 加纯函数把统计数据转成提示词；`web` 加一个网络适配器直接从浏览器调 gaccode `/v1/messages`；key 存浏览器 localStorage。遵循项目铁律 `web → core`、`core` 不碰网络/DOM。

**Tech Stack:** TypeScript、Vue 3（组合式 API）、Pinia、Vitest、@vue/test-utils（jsdom）。pnpm workspace。

## Global Constraints

- `core` 必须保持纯净：不 import `web`，不碰 `window`/`document`/`fetch`/网络。提示词逻辑放 `core`，网络请求放 `web`。
- 关系类型 `Relation` 从 `@nianlun/core` import，绝不重定义。
- 请求头固定：`x-api-key`、`anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true`、`content-type: application/json`。
- 模型默认 `claude-opus-4-8`，做成可配置（以 gaccode 控制台实际开放为准）。
- key 只存 localStorage，绝不写进代码 / 不进 git。
- 隐私提示文案（第一期，逐字）：`使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。`
- 测试命令：core 用 `pnpm --filter @nianlun/core exec vitest run`；web 用 `pnpm --filter @nianlun/web exec vitest run`。

---

### Task 1: CORS 连通性验证（手动，先于一切编码）

无服务器方案的命门：浏览器能否直连 gaccode。先验证，再写代码。**此任务不写产品代码、不提交。**

**Files:** 无（手动验证）

- [ ] **Step 1: 启动开发服务器**

Run: `pnpm --filter @nianlun/web dev`
打开浏览器到它输出的地址（通常 `http://localhost:5173`）。

- [ ] **Step 2: 在浏览器控制台粘贴真实请求**

按 F12 打开控制台，粘贴下面代码（把 `BASE_URL` 和 `KEY` 换成 gaccode 控制台里的真实值）：

```js
fetch('BASE_URL/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': 'KEY',
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-opus-4-8',
    max_tokens: 64,
    messages: [{ role: 'user', content: '你好，请回复一个字：好' }],
  }),
}).then(r => r.json()).then(console.log).catch(console.error)
```

- [ ] **Step 3: 判断结果**

- 控制台打印出一个含 `content` 数组的 JSON 对象 → ✅ **gaccode 允许浏览器直连，继续 Task 2。**
- 控制台报 `CORS` / `Failed to fetch` 错误 → ❌ **方案受阻**。停止本计划，回到设计文档第 8 节评估"加极小中转"的退路，与负责人确认后再继续。

---

### Task 2: core — 构建报告文案提示词

**Files:**
- Create: `packages/core/src/ai/prompts.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/ai/__tests__/prompts.test.ts`

**Interfaces:**
- Consumes: `ReportData`、`Friend`（来自 `../model/types`）。
- Produces: `buildReportCopyPrompt(report: ReportData, friends: Friend[]): string`，从 `@nianlun/core` 导出。

- [ ] **Step 1: 写失败测试**

Create `packages/core/src/ai/__tests__/prompts.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import type { ReportData, Friend } from '../../model/types'
import { buildReportCopyPrompt } from '../prompts'

const report: ReportData = {
  year: 2024,
  totalMessages: 1234,
  friendCount: 30,
  activeDays: 200,
  topContacts: [{ friendId: 'f1', msgCount: 500 }],
  latestMessage: null,
  keywords: [],
  relationBreakdown: [{ rel: '挚友', percent: 60 }],
}
const friends: Friend[] = [
  {
    id: 'f1', name: '小明', alias: '', rel: '挚友', role: '',
    firstContact: 0, lastContact: 0, msgCount: 500, sentRatio: 50,
    peakPeriod: '', maxStreak: 0, monthly: new Array(12).fill(0), userEdited: {},
  },
]

describe('buildReportCopyPrompt', () => {
  it('提示词里包含关键统计字段', () => {
    const p = buildReportCopyPrompt(report, friends)
    expect(p).toContain('2024')
    expect(p).toContain('1234')
    expect(p).toContain('小明')
    expect(p).toContain('挚友')
  })

  it('用 alias 优先于 name 显示联系人', () => {
    const aliased = [{ ...friends[0], alias: '明哥' }]
    const p = buildReportCopyPrompt(report, aliased)
    expect(p).toContain('明哥')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: FAIL（找不到模块 `../prompts`）。

- [ ] **Step 3: 写实现**

Create `packages/core/src/ai/prompts.ts`：

```ts
import type { Friend, ReportData } from '../model/types'

export function buildReportCopyPrompt(report: ReportData, friends: Friend[]): string {
  const nameById = new Map(friends.map((f) => [f.id, f.alias || f.name]))
  const top = report.topContacts
    .map((c, i) => `${i + 1}. ${nameById.get(c.friendId) ?? c.friendId}（${c.msgCount} 条）`)
    .join('；')
  const rel = report.relationBreakdown
    .map((r) => `${r.rel} ${r.percent}%`)
    .join('，')

  return [
    '你是一位温暖细腻的文案写手。请根据下面这位用户的微信社交统计数据，',
    '写一段 100~200 字、有温度、口语化的中文年度总结文案，适合放进年度报告海报。',
    '不要罗列数字清单，把数字自然融进叙述里。只输出文案本身，不要标题、不要解释。',
    '',
    '统计数据：',
    `- 年份：${report.year}`,
    `- 全年消息总数：${report.totalMessages}`,
    `- 联系的好友数：${report.friendCount}`,
    `- 活跃聊天天数：${report.activeDays}`,
    `- 聊得最多的人：${top || '（无）'}`,
    `- 关系分布：${rel || '（无）'}`,
  ].join('\n')
}
```

- [ ] **Step 4: 导出**

Modify `packages/core/src/index.ts`，在 `export { buildReport } ...` 之后加一行：

```ts
export { buildReportCopyPrompt } from './ai/prompts'
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/ai/__tests__/prompts.test.ts`
Expected: PASS（2 个测试）。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/ai/prompts.ts packages/core/src/ai/__tests__/prompts.test.ts packages/core/src/index.ts
git commit -m "feat(core): add buildReportCopyPrompt for AI report copy"
```

---

### Task 3: web — AI 网络适配器

**Files:**
- Create: `packages/web/src/adapters/aiClient.ts`
- Test: `packages/web/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Produces:
  - `interface AiSettings { baseUrl: string; apiKey: string; model: string }`
  - `type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>`
  - `generateText(prompt: string, settings: AiSettings, fetchImpl?: FetchLike): Promise<string>`

- [ ] **Step 1: 写失败测试**

Create `packages/web/src/adapters/__tests__/aiClient.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { generateText, type AiSettings } from '../aiClient'

const settings: AiSettings = { baseUrl: 'https://api.x.com', apiKey: 'sk-1', model: 'claude-opus-4-8' }

function fakeFetch(resp: { ok: boolean; status: number; body: any }) {
  return vi.fn(async () => ({ ok: resp.ok, status: resp.status, json: async () => resp.body }))
}

describe('generateText', () => {
  it('成功时返回第一个 text 块', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [{ type: 'text', text: '你好年度文案' }] } })
    const out = await generateText('prompt', settings, f)
    expect(out).toBe('你好年度文案')
  })

  it('请求头与请求体正确', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [{ type: 'text', text: 'x' }] } })
    await generateText('我的提示词', settings, f)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.x.com/v1/messages')
    expect((init as any).headers['x-api-key']).toBe('sk-1')
    expect((init as any).headers['anthropic-version']).toBe('2023-06-01')
    expect((init as any).headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    const sent = JSON.parse((init as any).body)
    expect(sent.model).toBe('claude-opus-4-8')
    expect(sent.messages[0].content).toBe('我的提示词')
  })

  it('401 抛出 key 无效提示', async () => {
    const f = fakeFetch({ ok: false, status: 401, body: {} })
    await expect(generateText('p', settings, f)).rejects.toThrow(/API Key 无效/)
  })

  it('429 抛出限流提示', async () => {
    const f = fakeFetch({ ok: false, status: 429, body: {} })
    await expect(generateText('p', settings, f)).rejects.toThrow(/频繁|额度/)
  })

  it('网络异常抛出连接提示', async () => {
    const f = vi.fn(async () => { throw new Error('boom') })
    await expect(generateText('p', settings, f)).rejects.toThrow(/无法连接|跨域/)
  })

  it('空内容抛出提示', async () => {
    const f = fakeFetch({ ok: true, status: 200, body: { content: [] } })
    await expect(generateText('p', settings, f)).rejects.toThrow(/为空/)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL（找不到模块 `../aiClient`）。

- [ ] **Step 3: 写实现**

Create `packages/web/src/adapters/aiClient.ts`：

```ts
export interface AiSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>

export async function generateText(
  prompt: string,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const url = settings.baseUrl.replace(/\/+$/, '') + '/v1/messages'

  let resp: { ok: boolean; status: number; json: () => Promise<any> }
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch {
    throw new Error('无法连接 AI 服务，请检查网络或接入地址（也可能是跨域 CORS 限制）')
  }

  if (!resp.ok) {
    if (resp.status === 401) throw new Error('API Key 无效，请检查设置中的密钥')
    if (resp.status === 429) throw new Error('调用太频繁或额度已用尽，请稍后再试')
    throw new Error(`AI 服务返回错误（HTTP ${resp.status}）`)
  }

  const data = await resp.json()
  const block = Array.isArray(data?.content)
    ? data.content.find((b: any) => b?.type === 'text')
    : null
  if (!block?.text) throw new Error('AI 返回内容为空')
  return block.text as string
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS（6 个测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/adapters/aiClient.ts packages/web/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(web): add aiClient adapter for browser-direct gaccode calls"
```

---

### Task 4: web — 设置 store（localStorage 持久化）

**Files:**
- Create: `packages/web/src/stores/settings.ts`
- Test: `packages/web/src/stores/__tests__/settings.test.ts`

**Interfaces:**
- Produces: `useSettingsStore()` → `{ baseUrl, apiKey, model, isConfigured, hydrate, update }`
  - `update(patch: { baseUrl?: string; apiKey?: string; model?: string }): void`（写 localStorage）
  - `hydrate(): void`（从 localStorage 读回）
  - `isConfigured: boolean`（baseUrl 与 apiKey 都非空）

- [ ] **Step 1: 写失败测试**

Create `packages/web/src/stores/__tests__/settings.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '../settings'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('useSettingsStore', () => {
  it('默认未配置，模型有默认值', () => {
    const s = useSettingsStore()
    expect(s.isConfigured).toBe(false)
    expect(s.model).toBe('claude-opus-4-8')
  })

  it('update 写入并标记已配置', () => {
    const s = useSettingsStore()
    s.update({ baseUrl: 'https://x', apiKey: 'k' })
    expect(s.isConfigured).toBe(true)
    expect(JSON.parse(localStorage.getItem('nianlun.ai.settings')!).baseUrl).toBe('https://x')
  })

  it('hydrate 从 localStorage 恢复', () => {
    localStorage.setItem('nianlun.ai.settings', JSON.stringify({ baseUrl: 'https://y', apiKey: 'k2', model: 'm' }))
    const s = useSettingsStore()
    s.hydrate()
    expect(s.baseUrl).toBe('https://y')
    expect(s.model).toBe('m')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/stores/__tests__/settings.test.ts`
Expected: FAIL（找不到模块 `../settings`）。

- [ ] **Step 3: 写实现**

Create `packages/web/src/stores/settings.ts`：

```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const STORAGE_KEY = 'nianlun.ai.settings'
const DEFAULT_MODEL = 'claude-opus-4-8'

export const useSettingsStore = defineStore('settings', () => {
  const baseUrl = ref('')
  const apiKey = ref('')
  const model = ref(DEFAULT_MODEL)

  const isConfigured = computed(
    () => baseUrl.value.trim() !== '' && apiKey.value.trim() !== '',
  )

  function hydrate() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      baseUrl.value = s.baseUrl ?? ''
      apiKey.value = s.apiKey ?? ''
      model.value = s.model || DEFAULT_MODEL
    } catch {
      /* 损坏的存储忽略即可 */
    }
  }

  function update(patch: { baseUrl?: string; apiKey?: string; model?: string }) {
    if (patch.baseUrl !== undefined) baseUrl.value = patch.baseUrl
    if (patch.apiKey !== undefined) apiKey.value = patch.apiKey
    if (patch.model !== undefined) model.value = patch.model
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value }),
    )
  }

  return { baseUrl, apiKey, model, isConfigured, hydrate, update }
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/stores/__tests__/settings.test.ts`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 启动时 hydrate**

Modify `packages/web/src/main.ts`：在 `import { useDataStore } ...` 下加一行 import，并在 `useDataStore().hydrate()...` 那行下面加 settings 的 hydrate：

```ts
import { useSettingsStore } from './stores/settings'
```

```ts
useSettingsStore().hydrate()
```

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/stores/settings.ts packages/web/src/stores/__tests__/settings.test.ts packages/web/src/main.ts
git commit -m "feat(web): add settings store persisting AI config to localStorage"
```

---

### Task 5: web — AiCopyPanel 组件（设置 + 生成按钮 + 结果）

**Files:**
- Create: `packages/web/src/components/AiCopyPanel.vue`
- Test: `packages/web/src/components/__tests__/AiCopyPanel.test.ts`

**Interfaces:**
- Consumes: `buildReportCopyPrompt`（core）、`generateText`（aiClient）、`useSettingsStore`。
- Produces: 组件 `AiCopyPanel`，props `{ report: ReportData; friends: Friend[] }`。

- [ ] **Step 1: 写失败测试**

Create `packages/web/src/components/__tests__/AiCopyPanel.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { ReportData, Friend } from '@nianlun/core'
import AiCopyPanel from '../AiCopyPanel.vue'
import { useSettingsStore } from '../../stores/settings'

vi.mock('../../adapters/aiClient', () => ({
  generateText: vi.fn(async () => '这是一段 AI 生成的年度文案。'),
}))
import { generateText } from '../../adapters/aiClient'

const report: ReportData = {
  year: 2024, totalMessages: 1200, friendCount: 30, activeDays: 200,
  topContacts: [{ friendId: 'a', msgCount: 500 }],
  latestMessage: null, keywords: [], relationBreakdown: [{ rel: '挚友', percent: 60 }],
}
const friends: Friend[] = []

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
})

describe('AiCopyPanel', () => {
  it('未配置时生成按钮禁用', () => {
    const w = mount(AiCopyPanel, { props: { report, friends } })
    expect(w.find('[data-test="gen"]').attributes('disabled')).toBeDefined()
  })

  it('显示隐私提示', () => {
    const w = mount(AiCopyPanel, { props: { report, friends } })
    expect(w.text()).toContain('相关统计数据会发送至 AI 服务进行处理')
  })

  it('配置后点击生成，显示结果并调用 generateText', async () => {
    useSettingsStore().update({ baseUrl: 'https://x', apiKey: 'k', model: 'claude-opus-4-8' })
    const w = mount(AiCopyPanel, { props: { report, friends } })
    await w.find('[data-test="gen"]').trigger('click')
    await new Promise((r) => setTimeout(r))
    expect(generateText).toHaveBeenCalledOnce()
    expect(w.find('[data-test="result"]').text()).toContain('AI 生成的年度文案')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiCopyPanel.test.ts`
Expected: FAIL（找不到 `../AiCopyPanel.vue`）。

- [ ] **Step 3: 写实现**

Create `packages/web/src/components/AiCopyPanel.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { Friend, ReportData } from '@nianlun/core'
import { buildReportCopyPrompt } from '@nianlun/core'
import { useSettingsStore } from '../stores/settings'
import { generateText } from '../adapters/aiClient'

const props = defineProps<{ report: ReportData; friends: Friend[] }>()
const settings = useSettingsStore()

const baseUrl = ref(settings.baseUrl)
const apiKey = ref(settings.apiKey)
const model = ref(settings.model)
function saveSettings() {
  settings.update({ baseUrl: baseUrl.value, apiKey: apiKey.value, model: model.value })
}

const loading = ref(false)
const error = ref('')
const result = ref('')

async function generate() {
  error.value = ''
  result.value = ''
  loading.value = true
  try {
    const prompt = buildReportCopyPrompt(props.report, props.friends)
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
  <section class="wrap ai-panel">
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
      :disabled="!settings.isConfigured || loading"
      @click="generate"
    >
      {{ loading ? '生成中…' : '✨ AI 生成文案' }}
    </button>
    <p class="ai-privacy">使用 AI 功能时，相关统计数据会发送至 AI 服务进行处理。</p>

    <p v-if="error" class="ai-error" role="alert">{{ error }}</p>
    <p v-if="result" class="ai-result" data-test="result">{{ result }}</p>
  </section>
</template>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/components/__tests__/AiCopyPanel.test.ts`
Expected: PASS（3 个测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/AiCopyPanel.vue packages/web/src/components/__tests__/AiCopyPanel.test.ts
git commit -m "feat(web): add AiCopyPanel component (settings + generate + privacy)"
```

---

### Task 6: web — 把 AiCopyPanel 接入报告页

**Files:**
- Modify: `packages/web/src/pages/ReportPage.vue`

**Interfaces:**
- Consumes: `AiCopyPanel`（props `report`、`friends`）、`data` store（已有 `report`、`friends`）。

- [ ] **Step 1: 引入组件**

Modify `packages/web/src/pages/ReportPage.vue`，在 `<script setup>` 顶部的 import 区，`TheFooter` 那行下面加：

```ts
import AiCopyPanel from '../components/AiCopyPanel.vue'
```

- [ ] **Step 2: 在报告内容区插入面板**

在模板里 `.actionbar` 的 `</div>` 之后、`<main class="wrap page">` 之前插入（`report` 在此处已非空）：

```html
    <AiCopyPanel :report="report" :friends="data.friends" />
```

- [ ] **Step 3: 类型检查 + 构建通过**

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit` 与 `vite build` 都成功，无类型错误。

- [ ] **Step 4: 全量 web 测试通过**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: 全部 PASS（含本计划新增的 settings / aiClient / AiCopyPanel 测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/pages/ReportPage.vue
git commit -m "feat(web): wire AiCopyPanel into report page"
```

---

### Task 7: 端到端联调与交付

**Files:** 无（手动）

- [ ] **Step 1: 本机真实联调**

Run: `pnpm --filter @nianlun/web dev`
导入一份聊天数据生成报告 → 进报告页 → 展开「AI 设置」填入真实接入地址 + 专用 key → 点「✨ AI 生成文案」。
Expected: 几秒后下方出现一段中文年度总结文案；无报错。

- [ ] **Step 2: 错误路径自检**

把 key 改成错误值再点生成。
Expected: 显示「API Key 无效…」红色提示，不崩页。

- [ ] **Step 3: 交付到客户机**

用向日葵远程连客户电脑，在报告页「AI 设置」里填入 gaccode 控制台新建的**专用、可随时停用的** key（不是开发者主 key），保存后本机点一次生成验证可用。

---

## Self-Review

**1. Spec coverage（对照设计文档逐节核对）：**
- §2.3 CORS 实测 → Task 1 ✅
- §3.1 core 提示词纯函数 → Task 2 ✅
- §3.2 web aiClient（端点/头/体/容错） → Task 3 ✅
- §3.3 设置存储 localStorage → Task 4 ✅
- §3.4 设置界面 + AI 按钮 + 隐私提示 + 三态 → Task 5、Task 6 ✅
- §4 隐私提示文案 → Task 5（逐字）✅
- §5 测试（core 单测、web mock fetch） → Task 2/3/4/5 ✅
- §6 实施顺序 → Task 1–7 一致 ✅
- §7 范围之外（②③④/服务器/streaming 不做） → 计划未涉及 ✅

**2. Placeholder scan：** 无 TBD/TODO，每个代码步骤都给了完整代码与命令。✅

**3. Type consistency：** `AiSettings`/`FetchLike`/`generateText`（Task 3）在 Task 5 被一致引用；`buildReportCopyPrompt(report, friends)`（Task 2）签名与 Task 5 调用一致；`useSettingsStore` 暴露的 `baseUrl/apiKey/model/isConfigured/hydrate/update`（Task 4）与 Task 5、main.ts 用法一致。✅
