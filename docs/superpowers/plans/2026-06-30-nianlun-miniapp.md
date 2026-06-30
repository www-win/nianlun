# 年轮微信小程序版（MVP）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 monorepo 新增 `packages/miniapp`（uni-app + Vue3 + Pinia），复用 `@nianlun/core`，做出「文件传输助手手动导入 → 概览/好友表/报告 + AI 分析」的微信小程序，web 版完全不动。

**Architecture:** 复用 core 纯函数大脑；web 的适配器层（文件读取、解析执行、持久化、AI 调用）逐一替换为小程序对应物。解析在主线程同步跑，存储用 `wx.storage`，AI 经可插拔后端（云函数 A / 公司服务器反代 B）。

**Tech Stack:** uni-app（Vue3 编译到微信小程序）、Pinia、Vitest、`@nianlun/core`、微信云开发（后端 A）、`wx.request`（后端 B）。

设计文档：`docs/superpowers/specs/2026-06-30-nianlun-miniapp-design.md`

## Global Constraints

- **包管理**：pnpm workspace，禁用 npm/yarn。新增包名 `@nianlun/miniapp`。
- **依赖方向**：`miniapp → core` 单向；`core` 永不 import web/miniapp，不碰 DOM/window/wx。
- **core 边界**：`packages/core/tsconfig.json` 设 `"lib": ["ES2020"]`、`"types": []`，任何 DOM/wx API 在 core 中编译失败。core 只接受字符串/普通数据，输出普通数据。
- **关系类型**：`Relation` 恰为 `'家人' | '挚友' | '同事' | '同学' | '客户' | '其他'`，从 core import，绝不重定义。时间戳为毫秒 `number`。
- **隐私**：完整 `Conversation[]` 绝不落盘；只持久化聚合 `Friend[]` + `ReportData` + 有界 `samples`。AI 仅用户主动触发时发送，发送聊天样本前需用户确认。
- **测试**：Vitest。逻辑层（适配器/store/parseLocal/aiClient）必须可注入依赖并单测；`wx.*` 一律经可注入封装，测试传 mock。UI 页面靠微信开发者工具真机预览验证。
- **适配器对齐**：storage 接口对齐 web 现有 `saveFriends/loadFriends/saveReport/loadReport/saveSamples/loadSamples/clearAll` 签名；fileReader 输出 `{ name, content }`。
- **向后兼容**：`loadFriends` 读取时对缺失的 `hourly/weekHour/keywords` 补默认值。

---

## Phase A — core 可移植化（不破坏 web）

### Task 1: 分词懒加载 + bigram 降级

把 `Intl.Segmenter` 从模块级实例化改为首次调用时懒加载，缺失时回退到中文二元分词，保证小程序 JS 引擎缺 `Intl.Segmenter` 时不崩。

**Files:**
- Modify: `packages/core/src/stats/segment.ts`
- Test: `packages/core/src/stats/__tests__/segment.test.ts`（已存在，追加用例）

**Interfaces:**
- Consumes: `STOPWORDS` from `./stopwords`
- Produces: `tokenize(text: string): string[]`、`countWords(texts, topN)` 签名不变（对外行为兼容）。新增内部 `getSegmenter(): ((t: string) => string[])`，不导出。

- [ ] **Step 1: 写失败测试（降级路径）**

在 `packages/core/src/stats/__tests__/segment.test.ts` 末尾追加：

```typescript
import { describe, it, expect, afterEach, vi } from 'vitest'
import { tokenize } from '../segment'

describe('tokenize 降级（无 Intl.Segmenter）', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('Intl.Segmenter 缺失时用 bigram 仍能切出 CJK 词', async () => {
    vi.stubGlobal('Intl', {})            // 模拟引擎不支持 Segmenter
    vi.resetModules()
    const { tokenize: t } = await import('../segment')
    const out = t('我们一起去北京')
    expect(out.length).toBeGreaterThan(0)
    expect(out).toContain('北京')        // 二元相邻字组合应包含「北京」
    expect(out.every((w) => w.length === 2)).toBe(true)
  })

  it('bigram 跳过停用词与纯符号', async () => {
    vi.stubGlobal('Intl', {})
    vi.resetModules()
    const { tokenize: t } = await import('../segment')
    const out = t('哈哈哈，，，')
    expect(out).not.toContain('，，')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run -t "降级"`
Expected: FAIL（当前模块顶层 `new Intl.Segmenter` 在 stub 后抛错或行为不符）

- [ ] **Step 3: 改写 segment.ts 为懒加载 + 降级**

把 `packages/core/src/stats/segment.ts` 顶部的 `const SEGMENTER = new Intl.Segmenter(...)` 替换为懒加载工厂；`tokenize` 改用工厂：

```typescript
import { STOPWORDS } from './stopwords'

const HAS_CJK = /[一-鿿]/
const EN_WORD = /^[a-zA-Z]{2,}$/

type TokFn = (text: string) => string[]
let cached: TokFn | null = null

function makeTokenizer(): TokFn {
  // 优先用 Intl.Segmenter（更准）；引擎不支持则降级 bigram。
  const Seg = (globalThis as any).Intl?.Segmenter
  if (typeof Seg === 'function') {
    try {
      const seg = new Seg('zh', { granularity: 'word' })
      return (text: string) => {
        const out: string[] = []
        for (const s of seg.segment(text)) {
          if (!s.isWordLike) continue
          const w = s.segment
          if (w.length < 2) continue
          if (!HAS_CJK.test(w) && !EN_WORD.test(w)) continue
          if (STOPWORDS.has(w)) continue
          out.push(w)
        }
        return out
      }
    } catch { /* 落到 bigram */ }
  }
  return bigramTokenize
}

// 中文二元降级：相邻两个 CJK 字成词；英文整词单独保留。
function bigramTokenize(text: string): string[] {
  const out: string[] = []
  // 英文整词
  const en = text.match(/[a-zA-Z]{2,}/g) ?? []
  for (const w of en) if (!STOPWORDS.has(w)) out.push(w)
  // CJK 二元
  const cjk = text.replace(/[^一-鿿]+/g, ' ').trim().split(/\s+/).filter(Boolean)
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i++) {
      const w = run.slice(i, i + 2)
      if (STOPWORDS.has(w)) continue
      out.push(w)
    }
  }
  return out
}

export function tokenize(text: string): string[] {
  if (!cached) cached = makeTokenizer()
  return cached(text)
}

export function countWords(
  texts: Iterable<string>,
  topN: number,
): Array<{ word: string; count: number }> {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const w of tokenize(text)) counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
```

- [ ] **Step 4: 运行全部 segment 测试 + core 全量**

Run: `pnpm --filter @nianlun/core test`
Expected: PASS（原有 Intl.Segmenter 用例 + 新降级用例全绿）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/stats/segment.ts packages/core/src/stats/__tests__/segment.test.ts
git commit -m "feat(core): lazy Intl.Segmenter with bigram fallback for portability"
```

---

## Phase B — miniapp 工程骨架 + 导入闭环

### Task 2: 新建 `packages/miniapp` 骨架与测试工具链

建一个能 `import @nianlun/core`、能跑 vitest 的 uni-app 包；先不接真实 wx，只把工程立起来。

**Files:**
- Create: `packages/miniapp/package.json`
- Create: `packages/miniapp/tsconfig.json`
- Create: `packages/miniapp/vitest.config.ts`
- Create: `packages/miniapp/src/types/wx.d.ts`
- Create: `packages/miniapp/src/__tests__/smoke.test.ts`
- Modify: `pnpm-workspace.yaml`（确认 `packages/*` 已覆盖；当前已是）

**Interfaces:**
- Produces: 可用 `pnpm --filter @nianlun/miniapp test` 跑 vitest；可 import `@nianlun/core`。

- [ ] **Step 1: 写 package.json**

`packages/miniapp/package.json`：

```json
{
  "name": "@nianlun/miniapp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@nianlun/core": "workspace:*",
    "pinia": "^2.1.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig 与 vitest 配置**

`packages/miniapp/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

`packages/miniapp/vitest.config.ts`：

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { globals: true, environment: 'node' },
})
```

- [ ] **Step 3: 写最小 wx 类型声明（仅声明本项目用到的 API）**

`packages/miniapp/src/types/wx.d.ts`：

```typescript
// 仅声明本项目用到的 wx API，避免引入完整 @types/wechat。
export interface ChosenFile { path: string; name: string; size: number }
export interface FileSystemManager {
  readFile(opts: {
    filePath: string; encoding?: string
    success?: (res: { data: string }) => void
    fail?: (err: { errMsg: string }) => void
  }): void
}
declare global {
  const wx: {
    chooseMessageFile(opts: {
      count: number; type?: 'all' | 'file'
      success?: (res: { tempFiles: ChosenFile[] }) => void
      fail?: (err: { errMsg: string }) => void
    }): void
    getFileSystemManager(): FileSystemManager
    setStorageSync(key: string, data: unknown): void
    getStorageSync(key: string): unknown
    removeStorageSync(key: string): void
    cloud: {
      callFunction(opts: { name: string; data: unknown }): Promise<{ result: unknown }>
    }
    request(opts: {
      url: string; method?: string; data?: unknown; header?: Record<string, string>
      success?: (res: { statusCode: number; data: unknown }) => void
      fail?: (err: { errMsg: string }) => void
    }): void
    canvasToTempFilePath(opts: object, comp?: unknown): void
    saveImageToPhotosAlbum(opts: { filePath: string; success?: () => void; fail?: (e: unknown) => void }): void
    showModal(opts: { title?: string; content: string; success?: (r: { confirm: boolean }) => void }): void
  }
}
```

- [ ] **Step 4: 写冒烟测试**

`packages/miniapp/src/__tests__/smoke.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { aggregate, buildReport } from '@nianlun/core'

describe('miniapp 能消费 core', () => {
  it('aggregate 空会话返回空数组', () => {
    expect(aggregate([])).toEqual([])
  })
  it('buildReport 返回带 year 的报告', () => {
    const r = buildReport([], [], 2025)
    expect(r.year).toBe(2025)
  })
})
```

- [ ] **Step 5: 安装依赖并跑测试**

Run: `pnpm install && pnpm --filter @nianlun/core build && pnpm --filter @nianlun/miniapp test`
Expected: PASS（2 个用例）。注：core 需先 build 出 dist，miniapp 才能解析 `@nianlun/core`。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp pnpm-workspace.yaml
git commit -m "chore(miniapp): scaffold @nianlun/miniapp package with vitest + core dep"
```

---

### Task 3: `parseLocal` —— 主线程解析编排（对应 web 的 worker）

把 web worker 里的 `parse→merge→aggregate→buildReport→extractFriendSamples` 逻辑搬成小程序主线程同步函数，纯逻辑、可单测。

**Files:**
- Create: `packages/miniapp/src/adapters/parseLocal.ts`
- Test: `packages/miniapp/src/adapters/__tests__/parseLocal.test.ts`

**Interfaces:**
- Consumes: `parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples` from `@nianlun/core`
- Produces:
  ```typescript
  interface LocalFile { name: string; content: string }
  interface ParseOutcome { friends: Friend[]; report: ReportData; warnings: string[]; samples: Record<string, string[]> }
  function parseLocal(files: LocalFile[], year: number, onProgress?: (p: number) => void): ParseOutcome
  ```

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/adapters/__tests__/parseLocal.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { parseLocal } from '../parseLocal'

const TXT = `2025-01-02 10:00:00 张三
你好

2025-01-02 10:01:00 我
在的`

describe('parseLocal', () => {
  it('解析 txt 聚合出好友并产出报告与样本', () => {
    const out = parseLocal([{ name: 'chat.txt', content: TXT }], 2025)
    expect(out.report.year).toBe(2025)
    expect(out.friends.length).toBe(1)
    expect(out.friends[0].msgCount).toBe(2)
    expect(Object.keys(out.samples).length).toBe(1)
  })

  it('progress 回调随文件推进', () => {
    const onProgress = vi.fn()
    parseLocal([{ name: 'a.txt', content: TXT }], 2025, onProgress)
    expect(onProgress).toHaveBeenCalledWith(1)
  })

  it('无法识别的文件把告警收集进 warnings 而不抛', () => {
    const out = parseLocal([{ name: 'x.bin', content: '%%%' }], 2025)
    expect(out.warnings.some((w) => w.includes('x.bin'))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run parseLocal`
Expected: FAIL（`parseLocal` 未定义）

- [ ] **Step 3: 实现 parseLocal**

`packages/miniapp/src/adapters/parseLocal.ts`：

```typescript
import {
  parseFile, aggregate, buildReport, mergeConversations, extractFriendSamples,
} from '@nianlun/core'
import type { Conversation, Friend, ReportData } from '@nianlun/core'

export interface LocalFile { name: string; content: string }

export interface ParseOutcome {
  friends: Friend[]
  report: ReportData
  warnings: string[]
  /** 有界聊天样本（键为 friend id）；绝不持久化原始会话。 */
  samples: Record<string, string[]>
}

export function parseLocal(
  files: LocalFile[],
  year: number,
  onProgress?: (p: number) => void,
): ParseOutcome {
  let conversations: Conversation[] = []
  const warnings: string[] = []
  files.forEach((f, i) => {
    const r = parseFile(f.name, f.content)
    conversations = mergeConversations(conversations, r.conversations)
    r.warnings.forEach((w) => warnings.push(`${f.name}: ${w.reason}`))
    onProgress?.((i + 1) / files.length)
  })
  const friends = aggregate(conversations)
  const report = buildReport(conversations, friends, year)
  const samples = extractFriendSamples(conversations)
  return { friends, report, warnings, samples }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run parseLocal`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/parseLocal.ts packages/miniapp/src/adapters/__tests__/parseLocal.test.ts
git commit -m "feat(miniapp): parseLocal — main-thread parse/aggregate/report orchestration"
```

---

### Task 4: `storage` 适配器（wx.storage，可注入）

对齐 web storage 接口，但用同步 `wx.*StorageSync`。把 wx 存储读写抽成可注入的 `StorageBackend`，测试用内存 mock。

**Files:**
- Create: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface StorageBackend { get(k: string): unknown; set(k: string, v: unknown): void; remove(k: string): void }
  function makeStorage(backend: StorageBackend): {
    saveFriends(f: Friend[]): void; loadFriends(): Friend[]
    saveReport(r: ReportData): void; loadReport(): ReportData | null
    saveSamples(s: Record<string,string[]>): void; loadSamples(): Record<string,string[]>
    clearAll(): void
  }
  const storage: ReturnType<typeof makeStorage>   // 默认绑定 wx 后端
  ```
- Keys: `'nianlun:friends'`、`'nianlun:report'`、`'nianlun:samples'`

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/adapters/__tests__/storage.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { makeStorage } from '../storage'
import type { Friend, ReportData } from '@nianlun/core'

function memBackend() {
  const m = new Map<string, unknown>()
  return { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
}

const FRIEND = { id: 'f1', name: '张三' } as unknown as Friend
const REPORT = { year: 2025 } as unknown as ReportData

describe('storage 适配器', () => {
  it('saveFriends/loadFriends 往返', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])
    expect(s.loadFriends()[0].id).toBe('f1')
  })

  it('loadFriends 给缺失字段补默认值', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND])                 // 没有 hourly/weekHour/keywords
    const f = s.loadFriends()[0]
    expect(f.hourly).toHaveLength(24)
    expect(f.weekHour).toHaveLength(168)
    expect(f.keywords).toEqual([])
  })

  it('loadReport 无数据时返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadReport()).toBeNull()
  })

  it('clearAll 清空全部键', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    s.clearAll()
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run storage`
Expected: FAIL（`makeStorage` 未定义）

- [ ] **Step 3: 实现 storage.ts**

`packages/miniapp/src/adapters/storage.ts`：

```typescript
import type { Friend, ReportData } from '@nianlun/core'

const K_FRIENDS = 'nianlun:friends'
const K_REPORT = 'nianlun:report'
const K_SAMPLES = 'nianlun:samples'

export interface StorageBackend {
  get(key: string): unknown
  set(key: string, value: unknown): void
  remove(key: string): void
}

export function makeStorage(backend: StorageBackend) {
  return {
    saveFriends(friends: Friend[]): void { backend.set(K_FRIENDS, friends) },
    loadFriends(): Friend[] {
      const raw = (backend.get(K_FRIENDS) as Friend[] | undefined) ?? []
      return raw.map((f) => ({
        ...f,
        hourly: f.hourly ?? new Array(24).fill(0),
        weekHour: f.weekHour ?? new Array(168).fill(0),
        keywords: f.keywords ?? [],
      }))
    },
    saveReport(report: ReportData): void { backend.set(K_REPORT, report) },
    loadReport(): ReportData | null {
      return (backend.get(K_REPORT) as ReportData | undefined) ?? null
    },
    saveSamples(samples: Record<string, string[]>): void { backend.set(K_SAMPLES, samples) },
    loadSamples(): Record<string, string[]> {
      return (backend.get(K_SAMPLES) as Record<string, string[]> | undefined) ?? {}
    },
    clearAll(): void { backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES) },
  }
}

const wxBackend: StorageBackend = {
  get: (k) => wx.getStorageSync(k),
  set: (k, v) => wx.setStorageSync(k, v),
  remove: (k) => wx.removeStorageSync(k),
}

export const storage = makeStorage(wxBackend)
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run storage`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): wx.storage adapter with injectable backend + back-compat fill"
```

---

### Task 5: `fileReader` 适配器（chooseMessageFile + readFile，可注入）

把「选文件 + 读文件」抽成可注入封装，返回 `{ name, content }[]`，测试用 mock 驱动。

**Files:**
- Create: `packages/miniapp/src/adapters/fileReader.ts`
- Test: `packages/miniapp/src/adapters/__tests__/fileReader.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface WxFileIO {
    choose(count: number): Promise<{ path: string; name: string }[]>
    read(path: string): Promise<string>
  }
  function makeFileReader(io: WxFileIO): { pickAndRead(count?: number): Promise<{ name: string; content: string }[]> }
  const fileReader: ReturnType<typeof makeFileReader>   // 默认绑定 wx
  ```

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/adapters/__tests__/fileReader.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { makeFileReader } from '../fileReader'

describe('fileReader 适配器', () => {
  it('选中文件后逐个读出内容', async () => {
    const io = {
      choose: vi.fn().mockResolvedValue([{ path: '/a', name: 'a.txt' }, { path: '/b', name: 'b.txt' }]),
      read: vi.fn(async (p: string) => (p === '/a' ? 'AAA' : 'BBB')),
    }
    const fr = makeFileReader(io)
    const out = await fr.pickAndRead(2)
    expect(out).toEqual([{ name: 'a.txt', content: 'AAA' }, { name: 'b.txt', content: 'BBB' }])
    expect(io.choose).toHaveBeenCalledWith(2)
  })

  it('未选文件返回空数组', async () => {
    const io = { choose: vi.fn().mockResolvedValue([]), read: vi.fn() }
    const out = await makeFileReader(io).pickAndRead()
    expect(out).toEqual([])
    expect(io.read).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run fileReader`
Expected: FAIL（`makeFileReader` 未定义）

- [ ] **Step 3: 实现 fileReader.ts**

`packages/miniapp/src/adapters/fileReader.ts`：

```typescript
export interface WxFileIO {
  choose(count: number): Promise<{ path: string; name: string }[]>
  read(path: string): Promise<string>
}

export function makeFileReader(io: WxFileIO) {
  return {
    async pickAndRead(count = 5): Promise<{ name: string; content: string }[]> {
      const files = await io.choose(count)
      const out: { name: string; content: string }[] = []
      for (const f of files) out.push({ name: f.name, content: await io.read(f.path) })
      return out
    },
  }
}

const wxIO: WxFileIO = {
  choose: (count) => new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count, type: 'file',
      success: (res) => resolve(res.tempFiles.map((t) => ({ path: t.path, name: t.name }))),
      fail: (err) => (/cancel/.test(err.errMsg) ? resolve([]) : reject(new Error(err.errMsg))),
    })
  }),
  read: (path) => new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: path, encoding: 'utf8',
      success: (res) => resolve(res.data),
      fail: (err) => reject(new Error(`无法读取文件: ${err.errMsg}`)),
    })
  }),
}

export const fileReader = makeFileReader(wxIO)
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run fileReader`
Expected: PASS（2 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/fileReader.ts packages/miniapp/src/adapters/__tests__/fileReader.test.ts
git commit -m "feat(miniapp): chooseMessageFile + readFile adapter (injectable)"
```

---

### Task 6: `data` store（Pinia）

页面唯一数据源。`hydrate/setData/updateFriend/clear`，全部经 `storage`（注入，便于测试）。

**Files:**
- Create: `packages/miniapp/src/stores/data.ts`
- Test: `packages/miniapp/src/stores/__tests__/data.test.ts`

**Interfaces:**
- Consumes: `makeStorage` from `../adapters/storage`
- Produces: `useDataStore()` 暴露 `friends, report, hasData, hydrate(), setData(friends, report), updateFriend(id, patch), clear()`；`patch: { role?; rel?; alias? }`，写入时记 `userEdited`。store 工厂接受可选注入的 storage。

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/stores/__tests__/data.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'
import { createDataStore } from '../data'
import type { Friend, ReportData } from '@nianlun/core'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}
const FRIEND = { id: 'f1', name: '张三', rel: '其他', role: '', alias: '', userEdited: {}, msgCount: 1, monthly: [], sentRatio: 0, peakPeriod: '', maxStreak: 0, firstContact: 0, lastContact: 0 } as unknown as Friend
const REPORT = { year: 2025 } as unknown as ReportData

describe('data store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('setData 写入并 hasData 为真', async () => {
    const useData = createDataStore(memStorage())
    const d = useData()
    await d.setData([FRIEND], REPORT)
    expect(d.hasData).toBe(true)
    expect(d.report?.year).toBe(2025)
  })

  it('hydrate 从存储恢复', async () => {
    const s = memStorage()
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    const d = createDataStore(s)()
    await d.hydrate()
    expect(d.friends[0].id).toBe('f1')
  })

  it('updateFriend 记录 userEdited 并落盘', async () => {
    const s = memStorage()
    const d = createDataStore(s)()
    await d.setData([FRIEND], REPORT)
    await d.updateFriend('f1', { rel: '同事', role: '产品经理' })
    expect(d.friends[0].rel).toBe('同事')
    expect(d.friends[0].userEdited.rel).toBe('同事')
    expect(s.loadFriends()[0].role).toBe('产品经理')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run stores/__tests__/data`
Expected: FAIL（`createDataStore` 未定义）

- [ ] **Step 3: 实现 data.ts**

`packages/miniapp/src/stores/data.ts`：

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Friend, ReportData, Relation } from '@nianlun/core'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'

type Storage = ReturnType<typeof makeStorage>

// 工厂：测试注入内存 storage；运行时用默认 wx storage。
export function createDataStore(storage: Storage = defaultStorage) {
  return defineStore('data', () => {
    const friends = ref<Friend[]>([])
    const report = ref<ReportData | null>(null)
    const hasData = computed(() => friends.value.length > 0)

    async function hydrate() {
      friends.value = storage.loadFriends()
      report.value = storage.loadReport()
    }
    async function setData(newFriends: Friend[], newReport: ReportData) {
      friends.value = newFriends
      report.value = newReport
      storage.saveFriends(JSON.parse(JSON.stringify(newFriends)))
      storage.saveReport(JSON.parse(JSON.stringify(newReport)))
    }
    async function updateFriend(id: string, patch: { role?: string; rel?: Relation; alias?: string }) {
      const f = friends.value.find((x) => x.id === id)
      if (!f) return
      if (patch.role !== undefined) { f.role = patch.role; f.userEdited.role = patch.role }
      if (patch.rel !== undefined) { f.rel = patch.rel; f.userEdited.rel = patch.rel }
      if (patch.alias !== undefined) { f.alias = patch.alias; f.userEdited.alias = patch.alias }
      storage.saveFriends(JSON.parse(JSON.stringify(friends.value)))
    }
    async function clear() {
      friends.value = []; report.value = null; storage.clearAll()
    }
    return { friends, report, hasData, hydrate, setData, updateFriend, clear }
  })
}

export const useDataStore = createDataStore()
```

> 注：用 `JSON.parse(JSON.stringify(...))` 去掉 Vue 响应式代理后再入 `wx.storage`（代理无法被序列化克隆），与 web 用 `toRaw()` 同理。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run stores/__tests__/data`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/stores/data.ts packages/miniapp/src/stores/__tests__/data.test.ts
git commit -m "feat(miniapp): data store (hydrate/setData/updateFriend/clear)"
```

---

### Task 7: `import` store（编排导入）

`run(localFiles, year)`：parseLocal → mergeFriends 进已有数据 → setData → 合并并存样本。复用 core 的 `mergeFriends`。

**Files:**
- Create: `packages/miniapp/src/stores/import.ts`
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: `parseLocal` from `../adapters/parseLocal`、`mergeFriends` from `@nianlun/core`、`useDataStore`、`storage.saveSamples/loadSamples`
- Produces: `useImportStore()` 暴露 `status, progress, warnings, error, run(files, year), reset()`；`status: 'idle'|'parsing'|'done'|'error'`。store 工厂接受注入的 dataStore + storage 便于测试。

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/stores/__tests__/import.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { makeStorage } from '../../adapters/storage'
import { createDataStore } from '../data'
import { createImportStore } from '../import'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}
const TXT = `2025-03-01 09:00:00 李四\n早\n\n2025-03-01 09:01:00 我\n早呀`

describe('import store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('run 解析并写入 data store，status 变 done', async () => {
    const s = memStorage()
    const useData = createDataStore(s)
    const useImport = createImportStore({ useData, storage: s })
    const imp = useImport()
    await imp.run([{ name: 'c.txt', content: TXT }], 2025)
    expect(imp.status).toBe('done')
    expect(useData().friends.length).toBe(1)
    const saved = s.loadSamples()
    expect(Object.keys(saved).length).toBe(1)
    const only = Object.values(saved)[0]
    expect(Array.isArray(only)).toBe(true)
    expect(only.length).toBeGreaterThan(0)
  })

  it('无法识别文件时 warnings 非空但不抛、status 仍 done', async () => {
    const s = memStorage()
    const useImport = createImportStore({ useData: createDataStore(s), storage: s })
    const imp = useImport()
    await imp.run([{ name: 'x.bin', content: '###' }], 2025)
    expect(imp.status).toBe('done')
    expect(imp.warnings.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run stores/__tests__/import`
Expected: FAIL（`createImportStore` 未定义）

- [ ] **Step 3: 实现 import.ts**

`packages/miniapp/src/stores/import.ts`：

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { mergeFriends } from '@nianlun/core'
import { parseLocal, type LocalFile } from '../adapters/parseLocal'
import { useDataStore as defaultUseData, createDataStore } from './data'
import { storage as defaultStorage, makeStorage } from '../adapters/storage'

type Deps = {
  useData?: ReturnType<typeof createDataStore>
  storage?: ReturnType<typeof makeStorage>
}
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'error'

export function createImportStore(deps: Deps = {}) {
  const useData = deps.useData ?? defaultUseData
  const storage = deps.storage ?? defaultStorage
  return defineStore('import', () => {
    const status = ref<ImportStatus>('idle')
    const progress = ref(0)
    const warnings = ref<string[]>([])
    const error = ref('')

    async function run(files: LocalFile[], year: number) {
      status.value = 'parsing'; progress.value = 0; warnings.value = []; error.value = ''
      try {
        const data = useData()
        const outcome = parseLocal(files, year, (p) => { progress.value = p })
        const merged = mergeFriends(data.friends, outcome.friends)
        await data.setData(merged.friends, outcome.report)
        const prevSamples = storage.loadSamples()
        storage.saveSamples({ ...prevSamples, ...outcome.samples })
        warnings.value = outcome.warnings
        status.value = 'done'
      } catch (e) {
        error.value = (e as Error).message
        status.value = 'error'
      }
    }
    function reset() { status.value = 'idle'; progress.value = 0; warnings.value = []; error.value = '' }
    return { status, progress, warnings, error, run, reset }
  })
}

export const useImportStore = createImportStore()
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run stores/__tests__/import`
Expected: PASS（2 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): import store orchestrating parseLocal + mergeFriends"
```

---

## Phase C — uni-app 应用与页面

> 本阶段开始接入真实 uni-app 运行时与微信开发者工具。逻辑已在 Phase B 单测覆盖；页面任务以「真机预览验证」为主，每个页面给出可运行的 `.vue` 骨架与明确验证点。

### Task 8: 接入 uni-app 运行时 + 应用入口 + 导入页

**Files:**
- Create: `packages/miniapp/pages.json`、`packages/miniapp/manifest.json`、`packages/miniapp/main.ts`、`packages/miniapp/App.vue`
- Create: `packages/miniapp/src/pages/import/import.vue`
- Modify: `packages/miniapp/package.json`（加 uni-app 依赖与 `dev:mp-weixin`/`build:mp-weixin` 脚本）

**Interfaces:**
- Consumes: `useImportStore`、`fileReader.pickAndRead`、`useDataStore`
- Produces: 微信小程序工程可在开发者工具打开；导入页能选文件→解析→落库。

- [ ] **Step 1: 加 uni-app 依赖与脚本**

在 `packages/miniapp/package.json` 的 `dependencies` 增加 `"@dcloudio/uni-app": "^3.0.0"`、`"vue": "^3.4.0"`；`devDependencies` 增加 `"@dcloudio/uni-mp-weixin": "^3.0.0"`、`"@dcloudio/vite-plugin-uni": "^3.0.0"`、`"vite": "^5.0.0"`；`scripts` 增加：

```json
"dev:mp-weixin": "uni -p mp-weixin",
"build:mp-weixin": "uni build -p mp-weixin"
```

Run: `pnpm install`
Expected: 安装成功。

> 说明：uni-app 版本号以安装时最新 3.x 为准；若 `uni` CLI 名称不同，按 `@dcloudio/uni-app` 文档对齐。

- [ ] **Step 2: 写 pages.json / manifest.json / main.ts / App.vue**

`packages/miniapp/pages.json`：

```json
{
  "pages": [
    { "path": "src/pages/import/import", "style": { "navigationBarTitleText": "导入" } },
    { "path": "src/pages/overview/overview", "style": { "navigationBarTitleText": "概览" } },
    { "path": "src/pages/friends/friends", "style": { "navigationBarTitleText": "好友" } },
    { "path": "src/pages/report/report", "style": { "navigationBarTitleText": "年度报告" } }
  ],
  "tabBar": {
    "list": [
      { "pagePath": "src/pages/import/import", "text": "导入" },
      { "pagePath": "src/pages/overview/overview", "text": "概览" },
      { "pagePath": "src/pages/friends/friends", "text": "好友" },
      { "pagePath": "src/pages/report/report", "text": "报告" }
    ]
  }
}
```

`packages/miniapp/manifest.json`（关键字段，`appid` 留空待填测试号/正式号）：

```json
{
  "name": "年轮",
  "appid": "",
  "mp-weixin": { "appid": "", "setting": { "urlCheck": false }, "usingComponents": true }
}
```

`packages/miniapp/main.ts`：

```typescript
import { createSSRApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  return { app }
}
```

`packages/miniapp/App.vue`：

```vue
<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useDataStore } from './src/stores/data'
onLaunch(() => { useDataStore().hydrate() })
</script>
<template><slot /></template>
```

- [ ] **Step 3: 写导入页（含「如何导出」引导）**

`packages/miniapp/src/pages/import/import.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { fileReader } from '../../adapters/fileReader'
import { useImportStore } from '../../stores/import'
import { useDataStore } from '../../stores/data'

const imp = useImportStore()
const data = useDataStore()
const year = ref(new Date().getFullYear())
const showHelp = ref(false)

async function onImport() {
  const files = await fileReader.pickAndRead(10)
  if (!files.length) return
  await imp.run(files, year.value)
}
</script>

<template>
  <view class="page">
    <button type="primary" @click="onImport">从文件传输助手导入</button>
    <view v-if="imp.status === 'parsing'">解析中… {{ Math.round(imp.progress * 100) }}%</view>
    <view v-if="imp.status === 'done'">已导入，好友 {{ data.friends.length }} 位，告警 {{ imp.warnings.length }} 条</view>
    <view v-if="imp.status === 'error'" class="err">导入失败：{{ imp.error }}</view>

    <view class="help-toggle" @click="showHelp = !showHelp">如何导出？</view>
    <view v-if="showHelp" class="help">
      <view>① 手机微信 → 设置 → 通用 → 聊天记录迁移与备份 → 迁移到电脑微信</view>
      <view>② 电脑上用 WeFlow / WeLive 导出 CSV / JSON</view>
      <view>③ 把导出文件发到「文件传输助手」</view>
      <view>④ 回到这里点「从文件传输助手导入」，选中该文件</view>
    </view>
  </view>
</template>

<style>
.page { padding: 32rpx; }
.help-toggle { margin-top: 40rpx; color: #576b95; }
.help { margin-top: 16rpx; color: #888; line-height: 1.8; }
.err { color: #e64340; }
</style>
```

- [ ] **Step 4: 开发者工具验证（手动）**

1. Run: `pnpm --filter @nianlun/miniapp dev:mp-weixin`
2. 微信开发者工具「导入项目」选 `packages/miniapp/dist/dev/mp-weixin`，AppID 填测试号。
3. 准备一个内容形如 `2025-01-02 10:00:00 张三\n你好\n\n2025-01-02 10:01:00 我\n在的` 的 `.txt`，发到文件传输助手。
4. 点「从文件传输助手导入」→ 选中该文件。
Expected: 显示「已导入，好友 1 位」；「如何导出？」可展开四步引导。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/pages.json packages/miniapp/manifest.json packages/miniapp/main.ts packages/miniapp/App.vue packages/miniapp/src/pages/import packages/miniapp/package.json
git commit -m "feat(miniapp): uni-app entry + tabBar + import page with export guide"
```

---

### Task 9: 概览页

**Files:**
- Create: `packages/miniapp/src/pages/overview/overview.vue`

**Interfaces:**
- Consumes: `useDataStore().report`

- [ ] **Step 1: 写概览页**

`packages/miniapp/src/pages/overview/overview.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useDataStore } from '../../stores/data'
const data = useDataStore()
const cards = computed(() => {
  const r = data.report
  if (!r) return []
  return [
    { label: '好友数', value: r.friendCount },
    { label: '全年消息', value: r.totalMessages },
    { label: '活跃天数', value: r.activeDays },
  ]
})
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">还没有数据，请先到「导入」页导入。</view>
    <view v-else class="grid">
      <view v-for="c in cards" :key="c.label" class="card">
        <view class="num">{{ c.value }}</view>
        <view class="lbl">{{ c.label }}</view>
      </view>
    </view>
  </view>
</template>

<style>
.page { padding: 32rpx; }
.grid { display: flex; flex-wrap: wrap; gap: 24rpx; }
.card { width: 200rpx; padding: 32rpx; background: #f7f7f7; border-radius: 16rpx; text-align: center; }
.num { font-size: 48rpx; font-weight: 700; }
.lbl { color: #888; margin-top: 8rpx; }
.empty { color: #888; }
</style>
```

- [ ] **Step 2: 开发者工具验证（手动）**

导入数据后切到「概览」Tab。
Expected: 三张卡片显示好友数/消息数/活跃天数；无数据时显示空态文案。

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/overview
git commit -m "feat(miniapp): overview page with summary cards"
```

---

### Task 10: 好友表页（搜索 / 排序 / 行内编辑）

**Files:**
- Create: `packages/miniapp/src/pages/friends/friends.vue`

**Interfaces:**
- Consumes: `useDataStore().friends`、`useDataStore().updateFriend`

- [ ] **Step 1: 写好友表页**

`packages/miniapp/src/pages/friends/friends.vue`：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useDataStore } from '../../stores/data'
import type { Relation } from '@nianlun/core'

const data = useDataStore()
const kw = ref('')
const sortKey = ref<'msgCount' | 'lastContact'>('msgCount')
const RELS: Relation[] = ['家人', '挚友', '同事', '同学', '客户', '其他']

const rows = computed(() => {
  const q = kw.value.trim()
  return data.friends
    .filter((f) => !q || (f.alias || f.name).includes(q))
    .slice()
    .sort((a, b) => (b[sortKey.value] as number) - (a[sortKey.value] as number))
})

function onRel(id: string, e: { detail: { value: number } }) {
  data.updateFriend(id, { rel: RELS[e.detail.value] })
}
function onRole(id: string, e: { detail: { value: string } }) {
  data.updateFriend(id, { role: e.detail.value })
}
</script>

<template>
  <view class="page">
    <input v-model="kw" placeholder="搜索好友" class="search" />
    <view class="sort">
      <text :class="{ on: sortKey === 'msgCount' }" @click="sortKey = 'msgCount'">按消息数</text>
      <text :class="{ on: sortKey === 'lastContact' }" @click="sortKey = 'lastContact'">按最近联系</text>
    </view>
    <view v-for="f in rows" :key="f.id" class="row">
      <view class="name">{{ f.alias || f.name }}</view>
      <view class="meta">{{ f.msgCount }} 条 · {{ f.rel }}</view>
      <picker :range="RELS" @change="(e) => onRel(f.id, e)"><text class="edit">改关系</text></picker>
      <input class="role" :value="f.role" placeholder="职务/备注" @blur="(e) => onRole(f.id, e)" />
    </view>
  </view>
</template>

<style>
.page { padding: 24rpx; }
.search { border: 1rpx solid #ddd; padding: 16rpx; border-radius: 12rpx; }
.sort { display: flex; gap: 32rpx; margin: 16rpx 0; color: #888; }
.sort .on { color: #07c160; }
.row { padding: 20rpx 0; border-bottom: 1rpx solid #eee; }
.name { font-weight: 600; }
.meta { color: #888; font-size: 24rpx; }
.edit { color: #576b95; }
.role { border: 1rpx solid #eee; padding: 8rpx; margin-top: 8rpx; }
</style>
```

- [ ] **Step 2: 开发者工具验证（手动）**

切到「好友」Tab。
Expected: 列表按消息数倒序；搜索框过滤生效；切换排序生效；改关系/填职务后切走再回来仍保留（已落盘）。

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/friends
git commit -m "feat(miniapp): friends page with search/sort/inline-edit"
```

---

### Task 11: 报告页（canvas 海报 + 保存到相册）

**Files:**
- Create: `packages/miniapp/src/pages/report/report.vue`

**Interfaces:**
- Consumes: `useDataStore().report`、`useDataStore().friends`

- [ ] **Step 1: 写报告页（canvas 绘制 + 存相册）**

`packages/miniapp/src/pages/report/report.vue`：

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useDataStore } from '../../stores/data'

const data = useDataStore()

function draw() {
  const r = data.report
  if (!r) return
  const ctx = uni.createCanvasContext('poster')
  ctx.setFillStyle('#faf6ef'); ctx.fillRect(0, 0, 320, 480)
  ctx.setFillStyle('#333'); ctx.setFontSize(24)
  ctx.fillText(`${r.year} 年度报告`, 24, 60)
  ctx.setFontSize(16)
  ctx.fillText(`好友 ${r.friendCount} 位`, 24, 120)
  ctx.fillText(`全年消息 ${r.totalMessages} 条`, 24, 160)
  ctx.fillText(`活跃 ${r.activeDays} 天`, 24, 200)
  ctx.draw()
}

function save() {
  uni.canvasToTempFilePath({
    canvasId: 'poster',
    success: (res: { tempFilePath: string }) => {
      uni.saveImageToPhotosAlbum({
        filePath: res.tempFilePath,
        success: () => uni.showToast({ title: '已保存到相册' }),
        fail: () => uni.showToast({ title: '保存失败，请授权相册', icon: 'none' }),
      })
    },
  })
}

onMounted(draw)
</script>

<template>
  <view class="page">
    <view v-if="!data.report" class="empty">还没有数据，请先导入。</view>
    <template v-else>
      <canvas canvas-id="poster" style="width: 320px; height: 480px;" />
      <button type="primary" @click="save">保存到相册</button>
    </template>
  </view>
</template>

<style>
.page { padding: 24rpx; }
.empty { color: #888; }
</style>
```

> 注：`uni.createCanvasContext`/`canvasToTempFilePath`/`saveImageToPhotosAlbum` 为 uni-app 封装（内部即 `wx.*`）。保存需用户授权 `scope.writePhotosAlbum`，失败时给提示。

- [ ] **Step 2: 开发者工具验证（手动）**

切到「报告」Tab。
Expected: 渲染出年度海报（年份 + 三项数字）；点「保存到相册」首次弹授权，授权后提示「已保存到相册」。

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/pages/report
git commit -m "feat(miniapp): report page with canvas poster + save to album"
```

---

## Phase D — AI 分析（可插拔后端 A/B）

### Task 12: `aiClient` 抽象 + 后端选择（构建期 env）

统一上层接口，内部按 `AI_BACKEND` 选实现；先实现「transport」抽象 + 报告文案/好友建议两个方法，transport 注入便于测试。

**Files:**
- Create: `packages/miniapp/src/adapters/aiClient.ts`
- Test: `packages/miniapp/src/adapters/__tests__/aiClient.test.ts`

**Interfaces:**
- Consumes: `buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion` from `@nianlun/core`
- Produces:
  ```typescript
  type Transport = (prompt: string, maxTokens: number) => Promise<string>   // 返回模型文本
  function makeAiClient(transport: Transport): {
    generateReportCopy(report: ReportData, friends: Friend[]): Promise<string>
    suggestFriend(friend: Friend, samples: string[]): Promise<FriendSuggestion>
  }
  const aiClient: ReturnType<typeof makeAiClient>   // 默认按 env 选 transport
  ```

- [ ] **Step 1: 写失败测试**

`packages/miniapp/src/adapters/__tests__/aiClient.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { makeAiClient } from '../aiClient'
import type { Friend, ReportData } from '@nianlun/core'

const REPORT = { year: 2025, totalMessages: 10, friendCount: 1, activeDays: 3, topContacts: [], relationBreakdown: [] } as unknown as ReportData
const FRIEND = { id: 'f1', name: '张三', alias: '', rel: '其他', role: '', msgCount: 9, sentRatio: 50, peakPeriod: '晚上', maxStreak: 2 } as unknown as Friend

describe('aiClient', () => {
  it('generateReportCopy 把 prompt 交给 transport 并回传文本', async () => {
    const transport = vi.fn().mockResolvedValue('这一年你们很热闹。')
    const out = await makeAiClient(transport).generateReportCopy(REPORT, [FRIEND])
    expect(out).toBe('这一年你们很热闹。')
    expect(transport.mock.calls[0][0]).toContain('2025')   // prompt 含年份
  })

  it('suggestFriend 解析模型 JSON 为结构化建议', async () => {
    const transport = vi.fn().mockResolvedValue('{"rel":"同事","role":"产品经理","reason":"工作日白天聊得多"}')
    const out = await makeAiClient(transport).suggestFriend(FRIEND, ['我：在吗', '对方：在'])
    expect(out.rel).toBe('同事')
    expect(out.role).toBe('产品经理')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run aiClient`
Expected: FAIL（`makeAiClient` 未定义）

- [ ] **Step 3: 实现 aiClient.ts（含两种 transport）**

`packages/miniapp/src/adapters/aiClient.ts`：

```typescript
import {
  buildReportCopyPrompt, buildFriendSuggestionPrompt, parseFriendSuggestion,
} from '@nianlun/core'
import type { Friend, ReportData, FriendSuggestion } from '@nianlun/core'

export type Transport = (prompt: string, maxTokens: number) => Promise<string>

export function makeAiClient(transport: Transport) {
  return {
    async generateReportCopy(report: ReportData, friends: Friend[]): Promise<string> {
      return transport(buildReportCopyPrompt(report, friends), 1024)
    },
    async suggestFriend(friend: Friend, samples: string[]): Promise<FriendSuggestion> {
      const text = await transport(buildFriendSuggestionPrompt(friend, samples), 1024)
      return parseFriendSuggestion(text)
    },
  }
}

// —— 后端 A：云函数 —— //
const cloudTransport: Transport = async (prompt, maxTokens) => {
  const res = await wx.cloud.callFunction({ name: 'aiProxy', data: { prompt, maxTokens } })
  const r = res.result as { text?: string; error?: string }
  if (r.error) throw new Error(r.error)
  return r.text ?? ''
}

// —— 后端 B：公司服务器 HTTPS 反代 —— //
const PROXY_URL = (globalThis as any).__AI_PROXY_URL__ ?? ''
const proxyTransport: Transport = (prompt, maxTokens) => new Promise((resolve, reject) => {
  wx.request({
    url: PROXY_URL, method: 'POST',
    header: { 'content-type': 'application/json' },
    data: { prompt, maxTokens },
    success: (res) => {
      if (res.statusCode !== 200) return reject(new Error(`AI 服务错误 HTTP ${res.statusCode}`))
      const d = res.data as { text?: string; error?: string }
      if (d.error) return reject(new Error(d.error))
      resolve(d.text ?? '')
    },
    fail: (err) => reject(new Error(`无法连接 AI 服务：${err.errMsg}`)),
  })
})

// 构建期注入（uni-app 用 import.meta.env / define）。默认 cloud。
const BACKEND = (import.meta as any).env?.VITE_AI_BACKEND ?? 'cloud'
export const aiClient = makeAiClient(BACKEND === 'proxy' ? proxyTransport : cloudTransport)
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run aiClient`
Expected: PASS（2 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/aiClient.ts packages/miniapp/src/adapters/__tests__/aiClient.test.ts
git commit -m "feat(miniapp): aiClient with pluggable cloud/proxy transport"
```

---

### Task 13: 云函数 `aiProxy`（后端 A）

云开发云函数：持有 gaccode Key，转发 `/v1/messages`，返回 `{ text }`。

**Files:**
- Create: `packages/miniapp/cloudfunctions/aiProxy/index.js`
- Create: `packages/miniapp/cloudfunctions/aiProxy/package.json`

**Interfaces:**
- Consumes: `event.prompt: string`、`event.maxTokens: number`
- Produces: `{ text: string }` 或 `{ error: string }`

- [ ] **Step 1: 写云函数 package.json**

`packages/miniapp/cloudfunctions/aiProxy/package.json`：

```json
{
  "name": "aiProxy",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {}
}
```

- [ ] **Step 2: 写云函数实现**

`packages/miniapp/cloudfunctions/aiProxy/index.js`（Node 18 运行时，用全局 `fetch`）：

```javascript
// 环境变量（在云开发控制台配置）：GACCODE_BASE_URL、GACCODE_API_KEY、GACCODE_MODEL
exports.main = async (event) => {
  const { prompt, maxTokens = 1024 } = event || {}
  if (!prompt) return { error: '缺少 prompt' }
  const base = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
  try {
    const resp = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.GACCODE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GACCODE_MODEL || 'claude-opus-4-8',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!resp.ok) return { error: `AI 服务返回 HTTP ${resp.status}` }
    const data = await resp.json()
    const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
    return { text: (block && block.text) || '' }
  } catch (e) {
    return { error: '云函数调用 AI 失败：' + e.message }
  }
}
```

- [ ] **Step 3: 部署与验证（手动）**

1. 在 `manifest.json` 填正式 AppID；微信开发者工具开通云开发、新建环境。
2. 右键 `cloudfunctions/aiProxy` → 上传并部署；在云开发控制台为该函数配置环境变量 `GACCODE_BASE_URL/GACCODE_API_KEY/GACCODE_MODEL`。
3. 在 `main.ts` 初始化云开发：`wx.cloud.init({ env: '<你的环境ID>' })`（uni-app 中可在 `App.vue` onLaunch 调用）。
4. 云开发控制台「云函数 → 测试」，传 `{ "prompt": "用一句话夸夸我", "maxTokens": 100 }`。
Expected: 返回 `{ text: "..." }` 非空。

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/cloudfunctions/aiProxy
git commit -m "feat(miniapp): aiProxy cloud function forwarding to gaccode"
```

---

### Task 14: 公司服务器反代（后端 B，参考实现）

提供一份可部署到公司备案域名的最小反代，作为后端 B 的服务端。语言用 Node（与项目一致），保持薄转发。

**Files:**
- Create: `packages/miniapp/server/proxy.mjs`
- Create: `packages/miniapp/server/README.md`

**Interfaces:**
- Consumes: `POST { prompt, maxTokens }`
- Produces: `{ text }` 或 `{ error }`；与云函数返回形状一致，故前端 transport 通用。

- [ ] **Step 1: 写反代实现**

`packages/miniapp/server/proxy.mjs`（零依赖，Node 18+）：

```javascript
import http from 'node:http'

const PORT = process.env.PORT || 8787
const BASE = (process.env.GACCODE_BASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.GACCODE_API_KEY
const MODEL = process.env.GACCODE_MODEL || 'claude-opus-4-8'

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method not allowed' })) }
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
  req.on('end', async () => {
    try {
      const { prompt, maxTokens = 1024 } = JSON.parse(body || '{}')
      if (!prompt) { res.statusCode = 400; return res.end(JSON.stringify({ error: '缺少 prompt' })) }
      const r = await fetch(BASE + '/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!r.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: `AI HTTP ${r.status}` })) }
      const data = await r.json()
      const block = Array.isArray(data.content) ? data.content.find((b) => b.type === 'text') : null
      res.end(JSON.stringify({ text: (block && block.text) || '' }))
    } catch (e) {
      res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
    }
  })
})
server.listen(PORT, () => console.log(`ai proxy on :${PORT}`))
```

- [ ] **Step 2: 写部署说明**

`packages/miniapp/server/README.md`：

```markdown
# AI 反代（后端 B）

放到公司**已备案** HTTPS 域名后面（如 nginx 反代到本进程），把该域名加入小程序后台
「开发 → 开发设置 → 服务器域名 → request 合法域名」。

## 运行
GACCODE_BASE_URL=... GACCODE_API_KEY=... GACCODE_MODEL=claude-opus-4-8 node proxy.mjs

## 前端切到后端 B
在 miniapp 构建期设 VITE_AI_BACKEND=proxy，并通过 vite define 注入 __AI_PROXY_URL__ 为你的 HTTPS 接口地址。

## 注意
- 必须 HTTPS（小程序只允许 https 的 request 合法域名）。
- 加基本限流（按来源/频率），保护 gaccode Key 与额度。
- 不要记录 prompt 正文日志（含聊天样本）。
```

- [ ] **Step 3: 本地验证（手动）**

Run: `GACCODE_BASE_URL=<base> GACCODE_API_KEY=<key> node packages/miniapp/server/proxy.mjs`
然后另开终端：`curl -s -XPOST localhost:8787 -d '{"prompt":"用一句话夸夸我","maxTokens":80}'`
Expected: 返回 `{"text":"..."}` 非空。

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/server
git commit -m "feat(miniapp): company-server reverse proxy (AI backend B) + docs"
```

---

### Task 15: 页面接 AI（报告文案 + 好友建议 + 发送前确认）

报告页加「AI 生成文案」；好友页加「智能建议」，发送聊天样本前用 `showModal` 确认。

**Files:**
- Modify: `packages/miniapp/src/pages/report/report.vue`
- Modify: `packages/miniapp/src/pages/friends/friends.vue`
- Create: `packages/miniapp/src/adapters/samples.ts`（读 `nianlun:samples`）
- Test: `packages/miniapp/src/adapters/__tests__/samples.test.ts`

**Interfaces:**
- Consumes: `aiClient.generateReportCopy`、`aiClient.suggestFriend`、`storage.loadSamples`
- Produces: `loadSamplesFor(id: string): string[]`

- [ ] **Step 1: 写 samples 读取的失败测试**

`packages/miniapp/src/adapters/__tests__/samples.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { makeSamples } from '../samples'
import { makeStorage } from '../storage'

function memStorage() {
  const m = new Map<string, unknown>()
  return makeStorage({ get: (k) => m.get(k), set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) })
}

describe('samples 读取', () => {
  it('按 friend id 取样本，缺失返回空数组', () => {
    const s = memStorage()
    s.saveSamples({ f1: ['我：在吗', '对方：在'] })
    const sm = makeSamples(s)
    expect(sm.loadSamplesFor('f1')).toEqual(['我：在吗', '对方：在'])
    expect(sm.loadSamplesFor('nope')).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run samples`
Expected: FAIL（`makeSamples` 未定义）

- [ ] **Step 3: 实现 samples.ts**

`packages/miniapp/src/adapters/samples.ts`：

```typescript
import { storage as defaultStorage, makeStorage } from './storage'

export function makeSamples(storage: ReturnType<typeof makeStorage> = defaultStorage) {
  return {
    loadSamplesFor(id: string): string[] {
      return storage.loadSamples()[id] ?? []
    },
  }
}

export const samples = makeSamples()
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run samples`
Expected: PASS（1 个用例）

- [ ] **Step 5: 报告页接 AI 文案**

在 `packages/miniapp/src/pages/report/report.vue` 的 `<script setup>` 增加：

```typescript
import { ref } from 'vue'
import { aiClient } from '../../adapters/aiClient'
const copy = ref('')
const loadingCopy = ref(false)
async function genCopy() {
  if (!data.report) return
  loadingCopy.value = true
  try { copy.value = await aiClient.generateReportCopy(data.report, data.friends) }
  catch (e) { uni.showToast({ title: (e as Error).message, icon: 'none' }) }
  finally { loadingCopy.value = false }
}
```

在 `<template>` 的 `v-else` 块内、`canvas` 上方加：

```html
<button size="mini" :loading="loadingCopy" @click="genCopy">AI 生成年度文案</button>
<view v-if="copy" class="copy">{{ copy }}</view>
```

（报告文案仅用聚合统计，无聊天原文，无需确认弹窗。）

- [ ] **Step 6: 好友页接「智能建议」+ 发送前确认**

在 `packages/miniapp/src/pages/friends/friends.vue` 的 `<script setup>` 增加：

```typescript
import { aiClient } from '../../adapters/aiClient'
import { samples } from '../../adapters/samples'

async function suggest(f: { id: string }) {
  const s = samples.loadSamplesFor(f.id)
  const ok = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '使用 AI 智能建议',
      content: `将发送约 ${s.length} 条聊天片段到 AI 服务用于推断关系，是否继续？`,
      success: (r) => resolve(r.confirm),
    })
  })
  if (!ok) return
  const friend = data.friends.find((x) => x.id === f.id)
  if (!friend) return
  try {
    const sug = await aiClient.suggestFriend(friend, s)
    if (sug.rel || sug.role) {
      await data.updateFriend(f.id, { rel: sug.rel, role: sug.role })
      uni.showToast({ title: '已应用建议' })
    } else {
      uni.showToast({ title: 'AI 无法判断', icon: 'none' })
    }
  } catch (e) { uni.showToast({ title: (e as Error).message, icon: 'none' }) }
}
```

在 `.row` 内加按钮：`<text class="edit" @click="suggest(f)">智能建议</text>`

- [ ] **Step 7: 开发者工具验证（手动，需后端就绪）**

1. 后端 A：开通云开发并部署 `aiProxy`（Task 13）；或后端 B：本地起反代 + 构建期 `VITE_AI_BACKEND=proxy`。
2. 报告页点「AI 生成年度文案」→ 显示一段文案。
3. 好友页点「智能建议」→ 先弹确认（写明约 N 条片段）→ 确认后关系/职务被更新。
Expected: 文案生成成功；建议确认弹窗出现；同意后字段更新并落盘。

- [ ] **Step 8: 提交**

```bash
git add packages/miniapp/src/adapters/samples.ts packages/miniapp/src/adapters/__tests__/samples.test.ts packages/miniapp/src/pages/report/report.vue packages/miniapp/src/pages/friends/friends.vue
git commit -m "feat(miniapp): wire AI report copy + friend suggestion with pre-send consent"
```

---

## 收尾验证

- [ ] **全量测试**

Run: `pnpm --filter @nianlun/core test && pnpm --filter @nianlun/miniapp test`
Expected: 两个包测试全绿。

- [ ] **构建小程序产物**

Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 生成 `dist/build/mp-weixin`，开发者工具可上传体验版。

- [ ] **回归 web 未受影响**

Run: `pnpm --filter @nianlun/web test`
Expected: web 测试不受 core 改动影响，全绿。

---

## 任务清单总览

| # | 任务 | 可独立验证的交付 |
|---|---|---|
| 1 | core 分词降级 | core 全测绿（含降级用例） |
| 2 | miniapp 骨架 | `pnpm --filter @nianlun/miniapp test` 跑通冒烟 |
| 3 | parseLocal | 主线程解析编排单测 |
| 4 | storage 适配器 | wx.storage 往返 + 兼容补默认值 |
| 5 | fileReader 适配器 | 选/读文件单测 |
| 6 | data store | hydrate/setData/updateFriend 单测 |
| 7 | import store | 导入编排单测 |
| 8 | uni-app 入口 + 导入页 | 真机：选文件→落库，引导可展开 |
| 9 | 概览页 | 真机：三卡片/空态 |
| 10 | 好友表页 | 真机：搜索/排序/行内编辑持久化 |
| 11 | 报告页 | 真机：canvas 海报 + 存相册 |
| 12 | aiClient 双 transport | 单测：报告文案/好友建议 |
| 13 | 云函数 aiProxy（后端A） | 云开发控制台测试返回 text |
| 14 | 公司反代（后端B） | 本地 curl 返回 text |
| 15 | 页面接 AI + 发送前确认 | 真机：文案生成、建议确认弹窗 |
