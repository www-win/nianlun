# 小程序原文留存改用文件系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把小程序「导入时留存原始聊天文本」从 10MB Storage 搬到 `USER_DATA_PATH` 文件系统，让大数据导入不再撑爆、不再失败。

**Architecture:** 新建 `adapters/rawStore.ts`（注入文件系统接口，可 mock），把原文逻辑从 `storage.ts` 剥离；导入时先存好小的聚合结果、最后逐个写原文并在写满时优雅降级；只留真人会话原文（跳过 `gh_`/系统会话）；一次选太多时软提示分批。

**Tech Stack:** pnpm monorepo、TypeScript、Vue3(uni-app)、Vitest(jsdom)、`@nianlun/core`。

## Global Constraints

- 包管理器用 **pnpm**，不用 npm/yarn。
- `@nianlun/core` 是纯逻辑库，**不得**触碰 `wx`/DOM/文件系统；文件系统只在 `packages/miniapp` 内。
- 原文根目录固定为 `${wx.env.USER_DATA_PATH}/nianlun_raw`。
- 软保护阈值：有效原文**总字节 > 50 MB** 或 **有效文件数 > 50** 时提示（`WARN_MB=50`、`WARN_COUNT=50`）。
- 铁律：核心聚合数据先存且必成功；原文留存失败只告警、绝不抛出中断导入。
- 单文件测试命令：`pnpm --filter @nianlun/miniapp exec vitest run <path>`；core 用 `pnpm --filter @nianlun/core exec vitest run <path>`。
- 提交信息用中文，结尾加 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: core 导出会话判定函数

**Files:**
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/__tests__/exports.test.ts` (create)

**Interfaces:**
- Produces: `isServiceSession(sessionId: string): boolean`、`sessionIdFromFileName(fileName: string): string`（经 `@nianlun/core` 入口导出，供 miniapp 使用）。

- [ ] **Step 1: 写失败测试**

创建 `packages/core/src/__tests__/exports.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import * as core from '../index'

describe('core 入口导出会话判定函数', () => {
  it('导出 isServiceSession 且逻辑正确', () => {
    expect(typeof core.isServiceSession).toBe('function')
    expect(core.isServiceSession('gh_abc')).toBe(true)
    expect(core.isServiceSession('wxid_x')).toBe(false)
  })
  it('导出 sessionIdFromFileName 且逻辑正确', () => {
    expect(typeof core.sessionIdFromFileName).toBe('function')
    expect(core.sessionIdFromFileName('17657663110@chatroom_00000001.jsonl'))
      .toBe('17657663110@chatroom')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/core exec vitest run src/__tests__/exports.test.ts`
Expected: FAIL —— `core.isServiceSession is not a function`（入口未导出）。

- [ ] **Step 3: 在入口补导出**

在 `packages/core/src/index.ts` 末尾追加（紧邻已有的 welive-contacts 导出）：

```ts
export { isServiceSession, sessionIdFromFileName } from './parsers/welive'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/core exec vitest run src/__tests__/exports.test.ts`
Expected: PASS（2 个测试）。

- [ ] **Step 5: 重新构建 core（miniapp 依赖其 dist）**

Run: `pnpm --filter @nianlun/core build`
Expected: 构建成功，`packages/core/dist` 更新。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/index.ts packages/core/src/__tests__/exports.test.ts packages/core/dist
git commit -m "feat(core): 入口导出 isServiceSession/sessionIdFromFileName 供小程序过滤会话

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: rawStore 基础存取（文件系统仓库骨架）

**Files:**
- Modify: `packages/miniapp/src/types/wx.d.ts`
- Create: `packages/miniapp/src/adapters/rawStore.ts`
- Test: `packages/miniapp/src/adapters/__tests__/rawStore.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `isServiceSession`/`sessionIdFromFileName`（本任务先不用，Task 3 用）。
- Produces:
  - `interface RawChatFile { name: string; content: string }`
  - `interface RawFsBackend { ensureDir(dir): void; writeFile(path, data): void; readFile(path): string; readdir(dir): string[]; size(path): number; unlink(path): void; exists(path): boolean }`
  - `makeRawStore(fs: RawFsBackend, baseDir?: string)` 返回对象，含 `count(): number`、`list(): {name:string;size:number}[]`、`read(name:string): string`、`readAll(): RawChatFile[]`、`clear(): void`（`appendFiles` 在 Task 3 加）。

- [ ] **Step 1: 补 wx 文件系统写入类 API 声明**

修改 `packages/miniapp/src/types/wx.d.ts` 的 `FileSystemManager` 接口，在 `readFileSync` 后补入以下方法，并把 `WxStat` 加上 `size`：

```ts
export interface WxStat { isDirectory(): boolean; size: number }
export interface FileSystemManager {
  readFile(opts: {
    filePath: string; encoding?: string
    success?: (res: { data: string }) => void
    fail?: (err: { errMsg: string }) => void
  }): void
  unzip(opts: {
    zipFilePath: string; targetPath: string
    success?: () => void
    fail?: (err: { errMsg: string }) => void
  }): void
  readdirSync(dirPath: string): string[]
  statSync(path: string): WxStat
  readFileSync(path: string, encoding: string): string
  writeFileSync(filePath: string, data: string, encoding: string): void
  mkdirSync(dirPath: string, recursive?: boolean): void
  unlinkSync(filePath: string): void
  accessSync(path: string): void
}
```

- [ ] **Step 2: 写失败测试（内存 fs 往返/覆盖/清理/计数）**

创建 `packages/miniapp/src/adapters/__tests__/rawStore.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { makeRawStore, type RawFsBackend } from '../rawStore'

// 内存文件系统：路径 → 内容
function memFs(): RawFsBackend {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return {
    ensureDir: (d) => { dirs.add(d) },
    writeFile: (p, data) => { files.set(p, data) },
    readFile: (p) => { const v = files.get(p); if (v == null) throw new Error('ENOENT'); return v },
    readdir: (d) => [...files.keys()].filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1)),
    size: (p) => (files.get(p) ?? '').length,
    unlink: (p) => { files.delete(p) },
    exists: (p) => files.has(p) || dirs.has(p),
  }
}

const DIR = '/raw'

describe('rawStore 基础存取', () => {
  it('写入后 count/list/read/readAll 一致', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'AAA' }, { name: 'b.jsonl', content: 'BBB' }])
    expect(s.count()).toBe(2)
    expect(s.list()).toEqual([{ name: 'a.jsonl', size: 3 }, { name: 'b.jsonl', size: 3 }])
    expect(s.read('a.jsonl')).toBe('AAA')
    expect(s.readAll()).toEqual([{ name: 'a.jsonl', content: 'AAA' }, { name: 'b.jsonl', content: 'BBB' }])
  })

  it('同名覆盖：重复写同名文件只留最新一份', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'v1' }])
    s.write([{ name: 'a.jsonl', content: 'v2' }])
    expect(s.count()).toBe(1)
    expect(s.read('a.jsonl')).toBe('v2')
  })

  it('分片不同名各存一份，不互相覆盖', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([
      { name: 'g@chatroom_00000000.jsonl', content: 'p0' },
      { name: 'g@chatroom_00000001.jsonl', content: 'p1' },
    ])
    expect(s.count()).toBe(2)
  })

  it('文件名带路径分隔符被清洗，不越目录', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: '../evil.jsonl', content: 'x' }])
    expect(s.list()[0].name).not.toContain('/')
    expect(s.list()[0].name).not.toContain('..')
  })

  it('空目录时 count=0、list/readAll 为空、read 缺失返回空串', () => {
    const s = makeRawStore(memFs(), DIR)
    expect(s.count()).toBe(0)
    expect(s.list()).toEqual([])
    expect(s.readAll()).toEqual([])
    expect(s.read('nope.jsonl')).toBe('')
  })

  it('clear 删空目录内全部文件', () => {
    const s = makeRawStore(memFs(), DIR)
    s.write([{ name: 'a.jsonl', content: 'A' }, { name: 'b.jsonl', content: 'B' }])
    s.clear()
    expect(s.count()).toBe(0)
  })
})
```

> 注：`write()` 是本任务的直写方法（不过滤、用于测试基础存取）；Task 3 会加带过滤+降级的 `appendFiles()`。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/rawStore.test.ts`
Expected: FAIL —— 找不到模块 `../rawStore`。

- [ ] **Step 4: 实现 rawStore.ts**

创建 `packages/miniapp/src/adapters/rawStore.ts`：

```ts
/** 导入的原始聊天文件（名字 + 原文），供将来二级分析重解析。 */
export interface RawChatFile { name: string; content: string }

/** 文件系统后端抽象：真机用 wx.getFileSystemManager()，测试注入内存实现。 */
export interface RawFsBackend {
  ensureDir(dir: string): void
  writeFile(path: string, data: string): void
  readFile(path: string): string
  readdir(dir: string): string[]
  size(path: string): number
  unlink(path: string): void
  exists(path: string): boolean
}

// 文件名清洗：去掉路径分隔符与上跳，避免写到目录外
function safeName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/\.\./g, '_')
}

export function makeRawStore(fs: RawFsBackend, baseDir: string) {
  const path = (name: string) => `${baseDir}/${safeName(name)}`

  return {
    /** 直写（覆盖式，不过滤）——基础存取，供测试与内部复用。 */
    write(files: RawChatFile[]): void {
      fs.ensureDir(baseDir)
      for (const f of files) fs.writeFile(path(f.name), f.content)
    },
    count(): number {
      return fs.readdir(baseDir).length
    },
    list(): { name: string; size: number }[] {
      return fs.readdir(baseDir).map((name) => ({ name, size: fs.size(`${baseDir}/${name}`) }))
    },
    read(name: string): string {
      try { return fs.readFile(path(name)) } catch { return '' }
    },
    readAll(): RawChatFile[] {
      return fs.readdir(baseDir).map((name) => {
        try { return { name, content: fs.readFile(`${baseDir}/${name}`) } } catch { return { name, content: '' } }
      })
    },
    clear(): void {
      for (const name of fs.readdir(baseDir)) fs.unlink(`${baseDir}/${name}`)
    },
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/rawStore.test.ts`
Expected: PASS（6 个测试）。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/types/wx.d.ts packages/miniapp/src/adapters/rawStore.ts packages/miniapp/src/adapters/__tests__/rawStore.test.ts
git commit -m "feat(miniapp): 新增 rawStore 文件系统原文仓库(基础存取)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: rawStore 留存过滤 + 写满即停降级

**Files:**
- Modify: `packages/miniapp/src/adapters/rawStore.ts`
- Test: `packages/miniapp/src/adapters/__tests__/rawStore.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 的 `isServiceSession`/`sessionIdFromFileName`。
- Produces: `appendFiles(files: RawChatFile[]): { saved: number; skipped: number }` —— 过滤掉 `gh_`/系统会话；逐个写入，某个写失败即停止后续、计入 `skipped`，**绝不抛异常**。

- [ ] **Step 1: 追加失败测试**

在 `rawStore.test.ts` 末尾追加：

```ts
describe('rawStore.appendFiles 过滤 + 降级', () => {
  it('跳过 gh_ 公众号与系统会话，只留真人会话', () => {
    const s = makeRawStore(memFs(), DIR)
    const r = s.appendFiles([
      { name: 'gh_abc.jsonl', content: 'x' },
      { name: 'weixin.jsonl', content: 'x' },
      { name: 'wxid_real.jsonl', content: 'hello' },
      { name: '123@chatroom.jsonl', content: 'hi' },
    ])
    expect(r).toEqual({ saved: 2, skipped: 0 })
    expect(s.count()).toBe(2)
    expect(s.read('wxid_real.jsonl')).toBe('hello')
  })

  it('写入失败即停止后续并计入 skipped，绝不抛', () => {
    let n = 0
    const base = memFs()
    const failing: RawFsBackend = {
      ...base,
      writeFile: (p, d) => { if (++n >= 2) throw new Error('exceed max size'); base.writeFile(p, d) },
    }
    const s = makeRawStore(failing, DIR)
    const r = s.appendFiles([
      { name: 'a.jsonl', content: 'A' },
      { name: 'b.jsonl', content: 'B' },
      { name: 'c.jsonl', content: 'C' },
    ])
    expect(r.saved).toBe(1)
    expect(r.skipped).toBeGreaterThanOrEqual(1)
    expect(s.count()).toBe(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/rawStore.test.ts`
Expected: FAIL —— `s.appendFiles is not a function`。

- [ ] **Step 3: 实现 appendFiles**

在 `rawStore.ts` 顶部加导入：

```ts
import { isServiceSession, sessionIdFromFileName } from '@nianlun/core'
```

在 `makeRawStore` 返回对象里加入（放在 `write` 之后）：

```ts
    /**
     * 留存原文：跳过公众号/系统会话；逐个写入，写满(异常)即停并计入 skipped，绝不抛。
     * 供导入流程在核心数据存好后调用。
     */
    appendFiles(files: RawChatFile[]): { saved: number; skipped: number } {
      fs.ensureDir(baseDir)
      let saved = 0
      let skipped = 0
      const keep = files.filter((f) => !isServiceSession(sessionIdFromFileName(f.name)))
      for (let i = 0; i < keep.length; i++) {
        try {
          fs.writeFile(path(keep[i].name), keep[i].content)
          saved++
        } catch {
          skipped = keep.length - i // 剩余全部算跳过
          break
        }
      }
      return { saved, skipped }
    },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/rawStore.test.ts`
Expected: PASS（8 个测试）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/rawStore.ts packages/miniapp/src/adapters/__tests__/rawStore.test.ts
git commit -m "feat(miniapp): rawStore.appendFiles 过滤公众号 + 写满即停降级

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 导入流程接入 rawStore（顺序调整 + 计数 + 清理）

**Files:**
- Modify: `packages/miniapp/src/adapters/rawStore.ts`（导出真机单例）
- Modify: `packages/miniapp/src/stores/import.ts`
- Modify: `packages/miniapp/src/stores/data.ts`
- Test: `packages/miniapp/src/stores/__tests__/import.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 `makeRawStore`/`appendFiles`/`count`/`clear`。
- Produces: `rawStore` 真机单例；`createImportStore` 的 `Deps` 新增可选 `rawStore`；`data` store 的 `clear()` 一并清原文。

- [ ] **Step 1: 在 rawStore.ts 末尾导出真机单例**

在 `packages/miniapp/src/adapters/rawStore.ts` 末尾追加：

```ts
const RAW_DIR = `${wx.env.USER_DATA_PATH}/nianlun_raw`
const fsm = () => wx.getFileSystemManager()
const wxRawFs: RawFsBackend = {
  ensureDir: (dir) => { try { fsm().accessSync(dir) } catch { fsm().mkdirSync(dir, true) } },
  writeFile: (p, data) => fsm().writeFileSync(p, data, 'utf8'),
  readFile: (p) => fsm().readFileSync(p, 'utf8'),
  readdir: (dir) => { try { return fsm().readdirSync(dir) } catch { return [] } },
  size: (p) => { try { return fsm().statSync(p).size } catch { return 0 } },
  unlink: (p) => { try { fsm().unlinkSync(p) } catch { /* 已不存在 */ } },
  exists: (p) => { try { fsm().accessSync(p); return true } catch { return false } },
}

export const rawStore = makeRawStore(wxRawFs, RAW_DIR)
```

- [ ] **Step 2: 改写 import.test.ts 中原文相关断言（失败测试）**

在 `packages/miniapp/src/stores/__tests__/import.test.ts` 中，为被测的 `createImportStore` 注入一个内存 rawStore，并把原来 `s.loadRawFiles()`（storage 上的）改为断言注入的 rawStore。定位原断言（约 52-53 行）：

```ts
    expect(s.loadRawFiles()).toEqual([{ name: 'c.txt', content: TXT }])
    expect(imp.rawSavedCount).toBe(1) // 供导入页显示「已留存原文 X 个」
```

替换为（同时在该测试构造 import store 处传入 `rawStore: fakeRaw`）：

```ts
    expect(fakeRaw.readAll()).toEqual([{ name: 'c.txt', content: TXT }])
    expect(imp.rawSavedCount).toBe(1) // 供导入页显示「已留存原文 X 个」
```

在该测试文件顶部/相应用例内加一个内存 rawStore 工厂（复用 rawStore.test 的 memFs 思路）：

```ts
import { makeRawStore } from '../../adapters/rawStore'
function fakeRawStore() {
  const files = new Map<string, string>()
  const dir = '/raw'
  return makeRawStore({
    ensureDir: () => {},
    writeFile: (p, d) => { files.set(p, d) },
    readFile: (p) => { const v = files.get(p); if (v == null) throw new Error('ENOENT'); return v },
    readdir: (d) => [...files.keys()].filter((p) => p.startsWith(d + '/')).map((p) => p.slice(d.length + 1)),
    size: (p) => (files.get(p) ?? '').length,
    unlink: (p) => { files.delete(p) },
    exists: (p) => files.has(p),
  }, dir)
}
```

在构造被测 store 的那一处，改为：`const fakeRaw = fakeRawStore()` 并把 `rawStore: fakeRaw` 加进 `createImportStore({ ... })` 的入参。

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: FAIL —— `createImportStore` 尚不接受 `rawStore`，`fakeRaw.readAll()` 为空/`rawSavedCount` 不符。

- [ ] **Step 4: 改 import.ts —— 接入 rawStore、调整存储顺序**

在 `packages/miniapp/src/stores/import.ts`：

顶部导入：

```ts
import { rawStore as defaultRawStore, makeRawStore } from '../adapters/rawStore'
```

`Deps` 类型加一行：

```ts
  rawStore?: ReturnType<typeof makeRawStore>
```

`createImportStore` 顶部解析默认值处加：

```ts
  const rawStore = deps.rawStore ?? defaultRawStore
```

把 `run()` 中原来的这段（核心存储 + 原文留存 + 最近数据）：

```ts
          await data.setData(named, report)
          const prevSamples = storage.loadSamples()
          storage.saveSamples({ ...prevSamples, ...outcome.samples })
          // 留存原始聊天文本(仅本机)，供将来二级荐股分析重解析、免客户重导。
          // 存储失败(如超配额)只告警，绝不阻断已完成的导入。
          try {
            storage.appendRawFiles(chatFiles)
            rawSavedCount.value = storage.loadRawFiles().length
          } catch (e) {
            warnings.value = [...warnings.value, `原文留存未完成：${(e as Error).message}`]
          }
          // 好友详情页「最近一个月」数据：按 id 合并，新批次覆盖同 id 旧值。
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
```

替换为（核心数据全部先存，原文留存挪到最后）：

```ts
          await data.setData(named, report)
          const prevSamples = storage.loadSamples()
          storage.saveSamples({ ...prevSamples, ...outcome.samples })
          // 好友详情页「最近一个月」数据：按 id 合并，新批次覆盖同 id 旧值。
          storage.saveRecentInsights({ ...storage.loadRecentInsights(), ...outcome.recentInsights })
          storage.saveRecentSamples({ ...storage.loadRecentSamples(), ...outcome.recentSamples })
          // 最后留存原文到文件系统：过滤公众号、写满即停，绝不阻断已完成的导入。
          try {
            const r = rawStore.appendFiles(chatFiles)
            rawSavedCount.value = rawStore.count()
            if (r.skipped > 0) {
              warnings.value = [...warnings.value, `原文留存已达存储上限，已保留 ${r.saved} 个、跳过 ${r.skipped} 个`]
            }
          } catch (e) {
            warnings.value = [...warnings.value, `原文留存未完成：${(e as Error).message}`]
          }
```

- [ ] **Step 5: 改 data.ts —— clear 一并清原文**

在 `packages/miniapp/src/stores/data.ts` 顶部导入：

```ts
import { rawStore as defaultRawStore } from '../adapters/rawStore'
```

把 `clear()` 改为：

```ts
    async function clear() {
      friends.value = []; report.value = null; storage.clearAll(); defaultRawStore.clear()
    }
```

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/stores/__tests__/import.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/miniapp/src/adapters/rawStore.ts packages/miniapp/src/stores/import.ts packages/miniapp/src/stores/data.ts packages/miniapp/src/stores/__tests__/import.test.ts
git commit -m "feat(miniapp): 导入接入文件系统 rawStore + 核心数据先存、原文最后留存

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 从 storage.ts 移除原文相关逻辑

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Modify: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Produces: `storage` 不再含 `saveRawFiles/loadRawFiles/appendRawFiles/clearRaw`；`clearAll` 只清聚合数据。

- [ ] **Step 1: 删除 storage.test.ts 中原文相关用例（失败测试→变绿）**

在 `packages/miniapp/src/adapters/__tests__/storage.test.ts` 中，删除整个针对原文的 `describe`（约 83–140 行，覆盖 `saveRawFiles/loadRawFiles/appendRawFiles/缺块容错/覆盖式写入/clearAll 清 raw` 的那些用例）。若 `clearAll` 用例里断言了 raw 被清，改为只断言聚合键被清。

- [ ] **Step 2: 删除 storage.ts 中原文实现**

在 `packages/miniapp/src/adapters/storage.ts`：
- 删除常量 `K_RAW_INDEX`、`K_RAW`、`RAW_CHUNK_CHARS` 与 `export interface RawChatFile`（`RawChatFile` 已在 `rawStore.ts` 定义）。
- 删除 `makeStorage` 内的 `rawChunkCount`/`clearRawImpl`/`loadRawFilesImpl`/`saveRawFilesImpl`/`appendRawFilesImpl` 五个内部函数。
- 删除返回对象里的 `saveRawFiles`/`loadRawFiles`/`appendRawFiles`/`clearRaw` 四个方法。
- 把 `clearAll` 改回不含 raw：

```ts
    clearAll(): void {
      backend.remove(K_FRIENDS); backend.remove(K_REPORT); backend.remove(K_SAMPLES)
      backend.remove(K_RECENT_INSIGHTS); backend.remove(K_RECENT_SAMPLES); backend.remove(K_ANALYZED)
    },
```

- [ ] **Step 3: 运行 storage 测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（原文用例已移除，其余聚合数据用例仍绿）。

- [ ] **Step 4: 全量测试确认无残留引用**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全部 PASS（无 `loadRawFiles` 等悬空引用）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "refactor(miniapp): storage 移除原文分块逻辑(已迁至 rawStore)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 大数据软保护提示

**Files:**
- Create: `packages/miniapp/src/lib/importGuard.ts`
- Test: `packages/miniapp/src/lib/__tests__/importGuard.test.ts`
- Modify: `packages/miniapp/src/pages/import/import.vue`

**Interfaces:**
- Consumes: Task 1 的 `isServiceSession`/`sessionIdFromFileName`。
- Produces: `assessImportSize(files: {name:string;content:string}[]): { warn: boolean; sizeMB: number; count: number }`。

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/lib/__tests__/importGuard.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { assessImportSize } from '../importGuard'

describe('assessImportSize', () => {
  it('小数据不触发提示', () => {
    const r = assessImportSize([{ name: 'wxid_a.jsonl', content: 'x'.repeat(1000) }])
    expect(r.warn).toBe(false)
    expect(r.count).toBe(1)
  })
  it('总字节超 50MB 触发提示', () => {
    const big = 'x'.repeat(51 * 1024 * 1024)
    const r = assessImportSize([{ name: 'wxid_a.jsonl', content: big }])
    expect(r.warn).toBe(true)
    expect(Math.round(r.sizeMB)).toBe(51)
  })
  it('有效文件数超 50 触发提示', () => {
    const files = Array.from({ length: 51 }, (_, i) => ({ name: `wxid_${i}.jsonl`, content: 'x' }))
    const r = assessImportSize(files)
    expect(r.warn).toBe(true)
    expect(r.count).toBe(51)
  })
  it('公众号/系统会话不计入体量', () => {
    const files = Array.from({ length: 60 }, (_, i) => ({ name: `gh_${i}.jsonl`, content: 'x' }))
    const r = assessImportSize(files)
    expect(r.warn).toBe(false)
    expect(r.count).toBe(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/importGuard.test.ts`
Expected: FAIL —— 找不到 `../importGuard`。

- [ ] **Step 3: 实现 importGuard.ts**

创建 `packages/miniapp/src/lib/importGuard.ts`：

```ts
import { isServiceSession, sessionIdFromFileName } from '@nianlun/core'

const WARN_MB = 50
const WARN_COUNT = 50

/** 评估本次导入体量：只统计会被留存的有效会话文件（跳过公众号/系统会话）。 */
export function assessImportSize(
  files: { name: string; content: string }[],
): { warn: boolean; sizeMB: number; count: number } {
  const effective = files.filter((f) => !isServiceSession(sessionIdFromFileName(f.name)))
  const bytes = effective.reduce((s, f) => s + f.content.length, 0)
  const sizeMB = bytes / (1024 * 1024)
  return { warn: sizeMB > WARN_MB || effective.length > WARN_COUNT, sizeMB, count: effective.length }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/lib/__tests__/importGuard.test.ts`
Expected: PASS（4 个测试）。

- [ ] **Step 5: 在 import.vue 接入软保护**

在 `packages/miniapp/src/pages/import/import.vue` `<script setup>` 加导入：

```ts
import { assessImportSize } from '../../lib/importGuard'
```

把 `onImport` 改为（在读入文件后、`imp.run` 前评估）：

```ts
async function onImport() {
  try {
    const files = await fileReader.pickAndRead(500)
    if (!files.length) return
    const a = assessImportSize(files)
    if (a.warn) {
      const ok = await new Promise<boolean>((resolve) => {
        uni.showModal({
          title: '数据较大',
          content: `本次约 ${a.sizeMB.toFixed(0)} MB / ${a.count} 个文件，建议分批导入以免卡顿。仍要继续吗？`,
          success: (r) => resolve(r.confirm),
        })
      })
      if (!ok) return
    }
    await imp.run(files, year.value)
  } catch (e) {
    uni.showToast({ title: (e as Error).message || '导入失败', icon: 'none' })
  }
}
```

- [ ] **Step 6: 运行全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add packages/miniapp/src/lib/importGuard.ts packages/miniapp/src/lib/__tests__/importGuard.test.ts packages/miniapp/src/pages/import/import.vue
git commit -m "feat(miniapp): 一次导入体量过大时软提示分批(不强制拦截)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 移除启动诊断插桩

**Files:**
- Modify: `packages/miniapp/src/App.vue`
- Modify: `packages/miniapp/src/pages/import/import.vue`

**Interfaces:**
- 无对外接口变化；仅删除排查用的 `[boot]` 计时日志。

- [ ] **Step 1: 恢复 App.vue onLaunch（删插桩）**

把 `packages/miniapp/src/App.vue` 的 `onLaunch` 改回无日志版本：

```ts
onLaunch(async () => {
  // 后端 A（云函数）需要云开发初始化；部署前把 env 换成你的云开发环境 ID。
  // 用后端 B（公司反代）时无需此步，可删。
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

- [ ] **Step 2: 删 import.vue 的 setup 插桩**

删除 `packages/miniapp/src/pages/import/import.vue` 中这一行：

```ts
console.log('[boot] 导入页 setup 执行', Date.now())  // [诊断插桩] 排查完删
```

- [ ] **Step 3: 运行全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add packages/miniapp/src/App.vue packages/miniapp/src/pages/import/import.vue
git commit -m "chore(miniapp): 移除启动诊断插桩

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 收尾验证（全部任务完成后）

- [ ] `pnpm --filter @nianlun/core test` 与 `pnpm --filter @nianlun/miniapp test` 全绿。
- [ ] 真机/开发者工具：先 `wx.clearStorageSync()` 清旧数据，再导入 `batch_01.zip`：应导入成功、好友数正确、界面显示「已留存原文 N 个」，`USER_DATA_PATH/nianlun_raw/` 下出现对应 jsonl 文件、无 `gh_` 公众号文件。
- [ ] 连导多个 batch：好友累加合并；原文写到文件系统上限时出现「已达存储上限」提示但导入仍成功。
- [ ] 传 `contacts.json`：真名套用照常。
```
