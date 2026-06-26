# 截图 OCR 导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户导入微信聊天截图（.png/.jpg/.jpeg/.webp），由云端多模态大模型读成现有 txt 解析器认识的纯文本，自动并入好友统计。

**Architecture:** OCR 是 web 适配器层的"另一种文件读取器"：图片 → 多模态 AI → `{ name, content }`（与 `readTextFile` 同形状的 `ReadFile`），之后完全走现有 `parseFiles → aggregate → report` 链路。`@nianlun/core` 一行不改；`txtParser` 已能解析目标格式。

**Tech Stack:** Vue 3 + Pinia + TypeScript，Vitest（jsdom + @vue/test-utils），Anthropic Messages API（经同源代理 `/__ai`）。

## Global Constraints

- **单向依赖**：`web → core`，core 不得 import web、不得碰 DOM/网络/图片。本功能**只动 `packages/web`**。
- **隐私**：这是项目里第一个上传用户内容的功能。仅在用户主动导入图片时上传；UI 必须显著告知"图片会上传到 AI 服务"。
- **容错风格**：单张图片识别失败只收集 warning、不中断其余导入；永不向用户抛未捕获异常。
- **测试模式**：网络调用经可注入的 `FetchLike` 测试；store 经 `vi.mock('../../adapters/...')` 模拟。
- **AI 调用约定**：`generateText(prompt, { baseUrl, apiKey, model }, fetchImpl?)`，URL = `settings.baseUrl.replace(/\/+$/,'') + '/v1/messages'`，头含 `x-api-key` / `anthropic-version: 2023-06-01` / `anthropic-dangerous-direct-browser-access: true`。
- **ReadFile 形状**：`{ name: string; content: string }`（见 `adapters/fileReader.ts`）。
- **txt 格式**：每条消息块为 `YYYY-MM-DD HH:MM:SS 发送者` 头行 + 若干正文行，块间空行分隔；发送者 `我` ⇒ 自己。

---

## File Structure

| 文件 | 责任 | 动作 |
|------|------|------|
| `packages/core/*` | 纯逻辑 | **不动** |
| `packages/web/src/adapters/aiClient.ts` | AI 调用 | 修改：抽出私有 `requestMessages`；新增 `extractFromImage` |
| `packages/web/src/adapters/imageOcr.ts` | 图片→ReadFile | **新建** |
| `packages/web/src/stores/import.ts` | 导入编排 | 修改：图片/文本分流 + 失败告警 + 未配置阻断 |
| `packages/web/src/pages/ImportPage.vue` | 导入 UI | 修改：accept 加图片、加标签、加隐私提示 |
| 对应 `__tests__/*.test.ts` | 测试 | 新建/修改 |

---

## Task 1: aiClient — 多模态 extractFromImage

**Files:**
- Modify: `packages/web/src/adapters/aiClient.ts`
- Test: `packages/web/src/adapters/__tests__/aiClient.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `AiSettings { baseUrl; apiKey; model }`、`FetchLike` 类型。
- Produces:
  - `extractFromImage(image: { base64: string; mediaType: string }, prompt: string, settings: AiSettings, fetchImpl?: FetchLike): Promise<string>` — 返回模型文本。
  - 现有 `generateText` 签名与行为保持不变。

- [ ] **Step 1: 写失败测试**

新建 `packages/web/src/adapters/__tests__/aiClient.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { extractFromImage } from '../aiClient'

const settings = { baseUrl: '/__ai', apiKey: 'k', model: 'claude-opus-4-8' }

function fakeFetch(captured: any[], resp: any) {
  return vi.fn(async (url: string, init: any) => {
    captured.push({ url, body: JSON.parse(init.body) })
    return resp
  })
}

describe('extractFromImage', () => {
  it('sends an image block + prompt and returns the text', async () => {
    const captured: any[] = []
    const fetchImpl = fakeFetch(captured, {
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '2025-01-01 10:00:00 我\n你好' }] }),
    })
    const out = await extractFromImage(
      { base64: 'AAAA', mediaType: 'image/png' }, '提取对话', settings, fetchImpl as any,
    )
    expect(out).toBe('2025-01-01 10:00:00 我\n你好')
    expect(captured[0].url).toBe('/__ai/v1/messages')
    const content = captured[0].body.messages[0].content
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    })
    expect(content[1]).toEqual({ type: 'text', text: '提取对话' })
    expect(captured[0].body.max_tokens).toBeGreaterThanOrEqual(4096)
  })

  it('maps HTTP 401 to a friendly error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    await expect(
      extractFromImage({ base64: 'A', mediaType: 'image/png' }, 'p', settings, fetchImpl as any),
    ).rejects.toThrow('API Key 无效，请检查设置中的密钥')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: FAIL —— `extractFromImage` is not exported / not a function。

- [ ] **Step 3: 实现（抽公共请求逻辑 + 新增函数）**

把 `packages/web/src/adapters/aiClient.ts` 改为：

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

type Content =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >

async function requestMessages(
  content: Content,
  maxTokens: number,
  settings: AiSettings,
  fetchImpl: FetchLike,
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
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
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

export async function generateText(
  prompt: string,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  return requestMessages(prompt, 1024, settings, fetchImpl)
}

export async function extractFromImage(
  image: { base64: string; mediaType: string },
  prompt: string,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const content: Content = [
    { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
    { type: 'text', text: prompt },
  ]
  return requestMessages(content, 4096, settings, fetchImpl)
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/aiClient.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 5: 回归 —— generateText 现有用法未变**

Run: `pnpm --filter @nianlun/web exec vitest run`
Expected: PASS（既有用例全绿；AiPanel/FriendSuggestPanel 调用方式不变）。

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/adapters/aiClient.ts packages/web/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(web): add extractFromImage multimodal AI call"
```

---

## Task 2: imageOcr 适配器

**Files:**
- Create: `packages/web/src/adapters/imageOcr.ts`
- Test: `packages/web/src/adapters/__tests__/imageOcr.test.ts`（新建）

**Interfaces:**
- Consumes: `extractFromImage`（Task 1）、`AiSettings`、`FetchLike`、`ReadFile`（`adapters/fileReader.ts`）。
- Produces:
  - `isImageFile(file: File): boolean`
  - `ocrImage(file: File, year: number, settings: AiSettings, fetchImpl?: FetchLike): Promise<ReadFile>`

**说明：** 用 `FileReader.readAsDataURL` 把图片转成 data URL（jsdom 支持），从中取 `mediaType` 与 base64；提示词内嵌 `year`；对模型可能包裹的 ```\`\`\```` 代码围栏做剥离。

- [ ] **Step 1: 写失败测试**

新建 `packages/web/src/adapters/__tests__/imageOcr.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { isImageFile, ocrImage } from '../imageOcr'

const settings = { baseUrl: '/__ai', apiKey: 'k', model: 'claude-opus-4-8' }

describe('isImageFile', () => {
  it('recognizes image extensions case-insensitively', () => {
    expect(isImageFile(new File([''], 'a.PNG'))).toBe(true)
    expect(isImageFile(new File([''], 'b.jpg'))).toBe(true)
    expect(isImageFile(new File([''], 'c.jpeg'))).toBe(true)
    expect(isImageFile(new File([''], 'd.webp'))).toBe(true)
    expect(isImageFile(new File([''], 'e.txt'))).toBe(false)
  })
})

describe('ocrImage', () => {
  it('returns a ReadFile whose content is the model text, year woven into prompt', async () => {
    const captured: any[] = []
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      captured.push(JSON.parse(init.body))
      return {
        ok: true, status: 200,
        json: async () => ({ content: [{ type: 'text', text: '2024-05-01 09:00:00 我\n在吗' }] }),
      }
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'chat.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)
    expect(out.name).toBe('chat.png')
    expect(out.content).toBe('2024-05-01 09:00:00 我\n在吗')
    const sent = captured[0].messages[0].content
    expect(sent[0].source.media_type).toBe('image/png')
    expect(typeof sent[0].source.data).toBe('string')
    expect(sent[1].text).toContain('2024') // year woven in
  })

  it('strips Markdown code fences the model may wrap output in', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: '```\n2024-05-01 09:00:00 我\n在吗\n```' }] }),
    }))
    const file = new File([new Uint8Array([1])], 'c.png', { type: 'image/png' })
    const out = await ocrImage(file, 2024, settings, fetchImpl as any)
    expect(out.content).toBe('2024-05-01 09:00:00 我\n在吗')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/imageOcr.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 imageOcr.ts**

新建 `packages/web/src/adapters/imageOcr.ts`：

```ts
import { extractFromImage, type AiSettings, type FetchLike } from './aiClient'
import type { ReadFile } from './fileReader'

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i

export function isImageFile(file: File): boolean {
  return IMAGE_EXT.test(file.name) || file.type.startsWith('image/')
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function buildPrompt(year: number): string {
  return [
    '这是一张微信聊天截图。请把其中的对话逐条提取成纯文本。',
    '严格按以下格式输出，不要任何解释或前后缀：',
    '每条消息一个块，首行是 `YYYY-MM-DD HH:MM:SS 发送者`，下一行起是正文，块之间用一个空行分隔。',
    '右侧气泡的发送者写「我」；左侧气泡写对方昵称（取自顶部标题栏）。',
    `时间用截图中可见的日期/时间；若某条看不到日期，用 ${year} 年并沿用最近一次可见的时间。`,
    '只输出符合上述格式的文本。',
  ].join('\n')
}

function stripFences(text: string): string {
  const t = text.trim()
  const fenced = t.match(/^```[\w]*\n([\s\S]*?)\n```$/)
  return (fenced ? fenced[1] : t).trim()
}

export async function ocrImage(
  file: File,
  year: number,
  settings: AiSettings,
  fetchImpl: FetchLike = fetch,
): Promise<ReadFile> {
  const dataUrl = await fileToDataUrl(file)
  const comma = dataUrl.indexOf(',')
  const meta = dataUrl.slice(0, comma)
  const base64 = dataUrl.slice(comma + 1)
  const mediaType = meta.match(/data:(.*?);base64/)?.[1] || 'image/png'

  const text = await extractFromImage({ base64, mediaType }, buildPrompt(year), settings, fetchImpl)
  return { name: file.name, content: stripFences(text) }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/adapters/__tests__/imageOcr.test.ts`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/adapters/imageOcr.ts packages/web/src/adapters/__tests__/imageOcr.test.ts
git commit -m "feat(web): add imageOcr adapter (screenshot -> txt-format ReadFile)"
```

---

## Task 3: import store —— 图片/文本分流

**Files:**
- Modify: `packages/web/src/stores/import.ts`
- Test: `packages/web/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `isImageFile` / `ocrImage`（Task 2）、`readTextFile`、`parseFiles`、`useSettingsStore`（`baseUrl`/`apiKey`/`model`/`isConfigured`）。
- Produces: `run(files, year)` 行为扩展 —— 图片走 OCR，单张失败收 warning，未配置 AI + 含图片时阻断报错。`warnings` 为 OCR 告警 + 解析告警之和。

- [ ] **Step 1: 写失败测试（追加到现有文件）**

在 `packages/web/src/stores/__tests__/import.test.ts` 顶部追加对两个适配器的 mock，并新增用例。把文件开头的 `vi.mock('../../adapters/parseClient', ...)` 之后补：

```ts
vi.mock('../../adapters/imageOcr', () => ({
  isImageFile: (f: File) => /\.(png|jpe?g|webp)$/i.test(f.name),
  ocrImage: vi.fn(async (f: File) => {
    if (f.name.includes('bad')) throw new Error('AI 返回内容为空')
    return { name: f.name, content: '2025-01-01 10:00:00 我\n你好' }
  }),
}))

// settings 默认已配置（避免阻断）；按需在单个用例内覆盖
vi.mock('../settings', () => ({
  useSettingsStore: () => ({ baseUrl: '/__ai', apiKey: 'k', model: 'm', isConfigured: true }),
}))
```

在 `describe('importStore', ...)` 内新增：

```ts
it('OCR 失败的图片只产生 warning，不中断', async () => {
  const imp = useImportStore()
  const good = new File([new Uint8Array([1])], 'ok.png', { type: 'image/png' })
  const bad = new File([new Uint8Array([1])], 'bad.png', { type: 'image/png' })
  await imp.run([good, bad], 2025)
  expect(imp.status).toBe('done')
  expect(imp.warnings.some((w) => w.includes('bad.png'))).toBe(true)
})
```

> 注：本任务把 settings mock 成"已配置"。"未配置 + 含图片"的阻断分支用一条单独的测试覆盖（见 Step 1b）。

- [ ] **Step 1b: 未配置阻断的测试**

新增 `packages/web/src/stores/__tests__/import.unconfigured.test.ts`（独立文件，便于单独 mock settings 为未配置）：

```ts
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../../adapters/parseClient', () => ({ parseFiles: vi.fn() }))
vi.mock('../../adapters/imageOcr', () => ({
  isImageFile: (f: File) => /\.(png|jpe?g|webp)$/i.test(f.name),
  ocrImage: vi.fn(),
}))
vi.mock('../settings', () => ({
  useSettingsStore: () => ({ baseUrl: '', apiKey: '', model: 'm', isConfigured: false }),
}))

import { useImportStore } from '../import'

describe('importStore 未配置 AI 时导入图片', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('阻断并给出指向设置的错误', async () => {
    const imp = useImportStore()
    const img = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
    await imp.run([img], 2025)
    expect(imp.status).toBe('error')
    expect(imp.error).toContain('设置')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/stores/__tests__/import.test.ts src/stores/__tests__/import.unconfigured.test.ts`
Expected: FAIL —— 新分支未实现（图片未走 OCR / 无阻断）。

- [ ] **Step 3: 实现 import.ts**

把 `packages/web/src/stores/import.ts` 的 import 区与 `run` 改为：

```ts
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mergeFriends } from '@nianlun/core'
import { readTextFile } from '../adapters/fileReader'
import { isImageFile, ocrImage } from '../adapters/imageOcr'
import { parseFiles } from '../adapters/parseClient'
import { useDataStore } from './data'
import { useSettingsStore } from './settings'

export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export const useImportStore = defineStore('import', () => {
  const status = ref<ImportStatus>('idle')
  const progress = ref(0)
  const warnings = ref<string[]>([])
  const error = ref('')
  // 聊天样本仅存内存（键为 friend id），绝不写入 IndexedDB；刷新即失。
  const friendSamples = ref<Record<string, string[]>>({})

  async function run(files: File[], year: number) {
    status.value = 'parsing'
    progress.value = 0
    warnings.value = []
    error.value = ''
    try {
      const images = files.filter(isImageFile)
      const texts = files.filter((f) => !isImageFile(f))

      const settings = useSettingsStore()
      if (images.length && !settings.isConfigured) {
        throw new Error('图片识别需要先在“设置”里配置 AI（视觉模型）后再试。')
      }

      const ocrWarnings: string[] = []
      const aiSettings = { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model }
      const imageReads = []
      for (const img of images) {
        try {
          imageReads.push(await ocrImage(img, year, aiSettings))
        } catch (e) {
          ocrWarnings.push(`${img.name}: 识别失败（${(e as Error).message}）`)
        }
      }

      const textReads = await Promise.all(texts.map(readTextFile))
      const read = [...textReads, ...imageReads]

      const outcome = await parseFiles(read, year, { onProgress: (p) => { progress.value = p } })
      const data = useDataStore()
      // 合并进已有好友,保留用户编辑
      const merged = mergeFriends(data.friends, outcome.friends)
      await data.setData(merged.friends, outcome.report)
      // 合并本次样本进内存（后到的覆盖同 id 的旧样本），不持久化。
      friendSamples.value = { ...friendSamples.value, ...outcome.samples }
      warnings.value = [...ocrWarnings, ...outcome.warnings]
      status.value = 'done'
    } catch (e) {
      error.value = (e as Error).message
      status.value = 'error'
    }
  }

  function reset() {
    status.value = 'idle'
    progress.value = 0
    warnings.value = []
    error.value = ''
  }

  function samplesFor(friendId: string): string[] {
    return friendSamples.value[friendId] ?? []
  }

  return { status, progress, warnings, error, friendSamples, run, reset, samplesFor }
})
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/stores/__tests__/import.test.ts src/stores/__tests__/import.unconfigured.test.ts`
Expected: PASS（含既有 3 个 + 新增 2 个用例）。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/stores/import.ts packages/web/src/stores/__tests__/import.test.ts packages/web/src/stores/__tests__/import.unconfigured.test.ts
git commit -m "feat(web): route image files through OCR in import store"
```

---

## Task 4: ImportPage —— accept 图片 + 隐私提示

**Files:**
- Modify: `packages/web/src/pages/ImportPage.vue`
- Test: `packages/web/src/pages/__tests__/ImportPage.test.ts`

**Interfaces:**
- Consumes: 现有 `imp.run`。无新增导出。
- Produces: 文件 `<input accept>` 含图片类型；模板出现隐私提示文案。

- [ ] **Step 1: 写失败测试（追加用例）**

在 `packages/web/src/pages/__tests__/ImportPage.test.ts` 内新增（沿用文件已有的 mount/setup 方式）：

```ts
it('accepts image files and shows an upload-privacy notice', () => {
  const wrapper = mount(ImportPage)
  const input = wrapper.find('input[type="file"]')
  const accept = input.attributes('accept') ?? ''
  expect(accept).toContain('.png')
  expect(accept).toContain('.jpg')
  expect(wrapper.text()).toContain('上传')
})
```

> 若该测试文件未导入 `mount`，从 `@vue/test-utils` 引入；组件 `import ImportPage from '../ImportPage.vue'`（参照文件现有顶部）。

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/ImportPage.test.ts`
Expected: FAIL —— accept 不含 `.png` 且无"上传"文案。

- [ ] **Step 3: 修改 ImportPage.vue**

1）把文件 `<input>` 的 `accept` 改为含图片：

```html
            accept=".txt,.html,.csv,.json,.png,.jpg,.jpeg,.webp"
```

2）把 dropzone 里的格式标签那行（`.txt .html .csv .bak`）改为加入图片标签并修正（`.bak` 暂无解析器，替换为图片标签）：

```html
            <div class="fmts">
              <span class="tag">.txt</span><span class="tag">.html</span><span class="tag">.csv</span><span class="tag">.png</span><span class="tag">.jpg</span>
            </div>
```

3）在 `<div class="or">最大约 500 MB · 多个文件可一次拖入</div>` 之后插入隐私提示：

```html
            <div class="or" style="margin-top:6px; color:#b4690e;">
              导入聊天截图（.png/.jpg）会调用 AI 识别，图片将上传到所配置的 AI 服务——不再是纯本地处理。
            </div>
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm --filter @nianlun/web exec vitest run src/pages/__tests__/ImportPage.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查 + 全量测试 + 构建**

Run: `pnpm --filter @nianlun/web test`
Expected: 全绿。

Run: `pnpm --filter @nianlun/web build`
Expected: `vue-tsc --noEmit && vite build` 通过（无类型错误）。

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/ImportPage.vue packages/web/src/pages/__tests__/ImportPage.test.ts
git commit -m "feat(web): accept chat screenshots with upload-privacy notice"
```

---

## Self-Review

**Spec coverage：**
- 云端多模态识别 → Task 1（`extractFromImage`）。✓
- OCR 作为图片版文件读取器、core 不动 → Task 2（`ocrImage` 返回 `ReadFile`）。✓
- 自动导入、无预览 → Task 3 直接进 `parseFiles`，无预览 UI。✓
- 单张失败收 warning 不中断 → Task 3 用例。✓
- 未配置 AI + 图片 → 阻断报错指向设置 → Task 3 Step 1b。✓
- accept 加图片 + 隐私提示 → Task 4。✓
- 提示词要点（右=我、左=昵称、缺日期用 year）→ Task 2 `buildPrompt`。✓
- 已知边界#3（不合格式时间戳）→ 以提示词严格约束 + `stripFences` 缓解；不在 core 加守卫（守住单向依赖）。✓

**Placeholder scan：** 无 TBD/TODO；每个代码步骤含完整代码。✓

**Type consistency：** `extractFromImage(image:{base64,mediaType}, prompt, settings, fetchImpl?)` 在 Task 1 定义、Task 2 调用一致；`ocrImage(file, year, settings, fetchImpl?)` 在 Task 2 定义、Task 3 调用一致；`isImageFile(file)` 一致；`ReadFile {name,content}` 一致。✓

**已知测试环境前提：** `FileReader.readAsDataURL` 在 jsdom 可用（Task 2 依赖）。若个别 jsdom 版本不支持，退路是改用 `await file.arrayBuffer()` + 手写 base64；执行时若 Task 2 Step 4 因此失败，按该退路调整 `fileToDataUrl`。
