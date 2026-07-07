# 大数据存储迁文件系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把随好友数增长的大数据（friends/samples/recentInsights/recentSamples/stocks）从 Storage 单键搬到文件系统，根治几千好友导入时 `setStorageSync:fail:entry size limit reached`。

**Architecture:** 新增 `fsStore.ts` 提供「JSON 文件后端」（真机走 `wx.getFileSystemManager`，缺省退化到 KV）。`makeStorage` 从吃一个 KV 后端改成吃 KV + 可选 JSON 文件后端；大数据方法内部改走文件后端，对外方法名/签名全不变，故 `data.ts`/`import.ts`/页面零改动。缺省退化保证现有测试无需修改。

**Tech Stack:** TypeScript、uni-app 小程序、Vitest、`wx.getFileSystemManager`（同步 API）、复用 `rawStore.ts` 的 `RawFsBackend`。

## Global Constraints

- **平台边界**：`wx` 全局**只能在函数体内引用，绝不能在模块顶层求值**（否则 node 测试收集期 `ReferenceError`）。参考现有 `storage.ts`/`rawStore.ts` 懒加载写法。
- **容错**：文件后端 `read` 遇文件不存在 / 非法 JSON → 返回 `undefined`，绝不抛。各 `loadXxx` 保持现有类型兜底（`Array.isArray`/`typeof === 'object'` + 默认 `[]`/`{}`）。
- **对外接口不变**：`saveFriends/loadFriends/saveSamples/loadSamples/saveRecentInsights/loadRecentInsights/saveRecentSamples/loadRecentSamples/saveStockPicks/loadStockPicks/clearStockPicks/clearAll` 的**名字与签名一律不变**。
- **分层**：大数据（friends/samples/recentInsights/recentSamples/stocks）走文件后端；小元数据（report/analyzedIds/myBazi/births/astro）仍走 KV。
- **不迁移旧数据**：启动清掉旧大 KV 键，用户重新导入。
- **命令**：`pnpm --filter @nianlun/miniapp exec vitest run <file>`；最后 `pnpm --filter @nianlun/miniapp test` 全绿。
- **提交尾注**：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## 文件结构

- Create `packages/miniapp/src/adapters/fsStore.ts` — `FsJsonBackend` 接口 + `makeFsJson`（真机文件系统）+ `makeKvFsJson`（缺省退化到 KV）
- Create `packages/miniapp/src/adapters/__tests__/fsStore.test.ts`
- Modify `packages/miniapp/src/adapters/rawStore.ts` — 导出可共享的真机 `wxRawFs`
- Modify `packages/miniapp/src/adapters/storage.ts` — `makeStorage(kv, fs?)`、大数据走 fs、`clearAll` 清文件、`purgeLegacyBigKeys`、真机实例接线
- Modify `packages/miniapp/src/adapters/__tests__/storage.test.ts` — 增补「大数据落 fs 后端」隔离测试 + `purgeLegacyBigKeys` 测试（现有用例不改）
- Modify `packages/miniapp/src/App.vue` — `onLaunch` 调 `purgeLegacyBigKeys`

---

## Task 1: 文件系统 JSON 后端 `fsStore.ts`

**Files:**
- Create: `packages/miniapp/src/adapters/fsStore.ts`
- Test: `packages/miniapp/src/adapters/__tests__/fsStore.test.ts`

**Interfaces:**
- Consumes: `RawFsBackend`（`../rawStore` 已导出：`ensureDir/writeFile/readFile/readdir/size/unlink`）。
- Produces:
  - `interface FsJsonBackend { read(name: string): unknown; write(name: string, data: unknown): void; remove(name: string): void }`
  - `makeFsJson(fs: RawFsBackend, baseDir: string): FsJsonBackend`（每个 name 存 `${baseDir}/${name}.json`）
  - `makeKvFsJson(kv: { get(k:string):unknown; set(k:string,v:unknown):void; remove(k:string):void }): FsJsonBackend`（缺省退化，把 JSON 对象存进 KV 键 `nianlun:fsjson:<name>`）

- [ ] **Step 1: 写失败测试**

创建 `packages/miniapp/src/adapters/__tests__/fsStore.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { makeFsJson, makeKvFsJson } from '../fsStore'
import type { RawFsBackend } from '../rawStore'

/** 内存版 RawFsBackend：用 Map 当文件系统。 */
function memFs(): RawFsBackend {
  const files = new Map<string, string>()
  return {
    ensureDir: () => {},
    writeFile: (p, data) => { files.set(p, data) },
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)! },
    readdir: () => [...files.keys()],
    size: (p) => (files.get(p)?.length ?? 0),
    unlink: (p) => { files.delete(p) },
  }
}

describe('makeFsJson', () => {
  it('write/read 往返（对象按 name 存成 .json 文件）', () => {
    const j = makeFsJson(memFs(), '/base')
    j.write('friends', [{ id: 'a' }, { id: 'b' }])
    expect(j.read('friends')).toEqual([{ id: 'a' }, { id: 'b' }])
  })
  it('文件不存在 → undefined（不抛）', () => {
    expect(makeFsJson(memFs(), '/base').read('nope')).toBeUndefined()
  })
  it('坏 JSON → undefined（不抛）', () => {
    const fs = memFs()
    fs.writeFile('/base/x.json', '{坏json')
    expect(makeFsJson(fs, '/base').read('x')).toBeUndefined()
  })
  it('remove 后 read → undefined', () => {
    const j = makeFsJson(memFs(), '/base')
    j.write('s', { a: 1 }); j.remove('s')
    expect(j.read('s')).toBeUndefined()
  })
})

describe('makeKvFsJson（缺省退化到 KV）', () => {
  it('write/read 往返，存进 nianlun:fsjson:<name> 键', () => {
    const m = new Map<string, unknown>()
    const kv = { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
    const j = makeKvFsJson(kv)
    j.write('friends', [{ id: 'a' }])
    expect(j.read('friends')).toEqual([{ id: 'a' }])
    expect(m.has('nianlun:fsjson:friends')).toBe(true)
  })
  it('缺失 → undefined（含 wx 空串语义）', () => {
    const kv = { get: () => '', set: () => {}, remove: () => {} }
    expect(makeKvFsJson(kv).read('x')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/fsStore.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

创建 `packages/miniapp/src/adapters/fsStore.ts`：

```ts
import type { RawFsBackend } from './rawStore'

/** 「JSON 键值」后端：每个 name 对应一份 JSON 数据。容错，read 永不抛。 */
export interface FsJsonBackend {
  read(name: string): unknown
  write(name: string, data: unknown): void
  remove(name: string): void
}

/** 真机：把每个 name 存成 `${baseDir}/${name}.json`（文件系统，无 1MB/10MB 限制）。 */
export function makeFsJson(fs: RawFsBackend, baseDir: string): FsJsonBackend {
  const path = (name: string) => `${baseDir}/${name}.json`
  return {
    read(name) {
      try { return JSON.parse(fs.readFile(path(name))) } catch { return undefined }
    },
    write(name, data) {
      fs.ensureDir(baseDir)
      fs.writeFile(path(name), JSON.stringify(data))
    },
    remove(name) {
      try { fs.unlink(path(name)) } catch { /* 不存在，忽略 */ }
    },
  }
}

interface KvLike { get(k: string): unknown; set(k: string, v: unknown): void; remove(k: string): void }

/** 缺省退化：把 JSON 对象直接存进 KV 键（供测试/无文件系统环境；真机不用它）。 */
export function makeKvFsJson(kv: KvLike): FsJsonBackend {
  const key = (name: string) => `nianlun:fsjson:${name}`
  return {
    read(name) {
      const v = kv.get(key(name))
      return v === '' || v === undefined || v === null ? undefined : v
    },
    write(name, data) { kv.set(key(name), data) },
    remove(name) { kv.remove(key(name)) },
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/fsStore.test.ts`
Expected: PASS（6 用例）

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/fsStore.ts packages/miniapp/src/adapters/__tests__/fsStore.test.ts
git commit -m "feat(miniapp): fsStore 文件系统 JSON 后端(含 KV 缺省退化)"
```

---

## Task 2: 导出可共享的真机 `wxRawFs`

**Files:**
- Modify: `packages/miniapp/src/adapters/rawStore.ts`

**Interfaces:**
- Produces: `export const wxRawFs: RawFsBackend`（懒加载 wx 文件系统的真机实现，供 rawStore 与 storage 共用）。

- [ ] **Step 1: 提取并导出 `wxRawFs`**

`rawStore.ts` 现在把真机 `RawFsBackend` 定义在 `realRawStore()` 内部局部变量 `wxRawFs`。改为**模块级导出的懒加载单例**，`realRawStore()` 复用它。

在 `rawStore.ts` 里，把原 `realRawStore` 内的 `const wxRawFs: RawFsBackend = { ... }` 抽到模块级：

```ts
// 真机文件系统后端（懒加载：方法体内才访问 wx，模块顶层不触碰）。
function fsm() { return wx.getFileSystemManager() }
export const wxRawFs: RawFsBackend = {
  ensureDir: (d) => { try { fsm().accessSync(d) } catch { fsm().mkdirSync(d, true) } },
  writeFile: (p, data) => fsm().writeFileSync(p, data, 'utf8'),
  readFile: (p) => fsm().readFileSync(p, 'utf8'),
  readdir: (d) => { try { return fsm().readdirSync(d) } catch { return [] } },
  size: (p) => { try { return fsm().statSync(p).size } catch { return 0 } },
  unlink: (p) => { try { fsm().unlinkSync(p) } catch { /* 已不存在 */ } },
}
```

并把 `realRawStore()` 内原来构造 `wxRawFs` 的代码删掉、改用这个模块级 `wxRawFs`：

```ts
function realRawStore(): ReturnType<typeof makeRawStore> {
  if (!cachedRawStore) {
    const dir = `${wx.env.USER_DATA_PATH}/nianlun_raw`
    cachedRawStore = makeRawStore(wxRawFs, dir)
  }
  return cachedRawStore
}
```

- [ ] **Step 2: 跑既有 rawStore 测试确认不回归**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/rawStore.test.ts`
Expected: PASS（既有 10 用例；`wxRawFs` 是懒加载、模块顶层不碰 wx，node 收集不报错）

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/adapters/rawStore.ts
git commit -m "refactor(miniapp): 导出可共享的懒加载 wxRawFs"
```

---

## Task 3: `storage.ts` 大数据走文件后端

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `FsJsonBackend`/`makeFsJson`/`makeKvFsJson`（Task 1）、`wxRawFs`（Task 2）、`StockPick`（`@nianlun/core`）。
- Produces:
  - `makeStorage(kv: StorageBackend, fs?: FsJsonBackend)` —— `fs` 缺省 `makeKvFsJson(kv)`。
  - 新增 `storage.purgeLegacyBigKeys(): void`（删除旧的大 KV 键）。
  - 大数据方法（`saveFriends/loadFriends/saveSamples/loadSamples/saveRecentInsights/loadRecentInsights/saveRecentSamples/loadRecentSamples/saveStockPicks/loadStockPicks/clearStockPicks`）内部改走 `fs`。

- [ ] **Step 1: 写失败测试**（追加到 `storage.test.ts`）

```ts
import { makeFsJson } from '../fsStore'
import type { RawFsBackend } from '../rawStore'
import type { Friend } from '@nianlun/core'

function memFsBackend(): RawFsBackend {
  const files = new Map<string, string>()
  return {
    ensureDir: () => {}, writeFile: (p, d) => { files.set(p, d) },
    readFile: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)! },
    readdir: () => [...files.keys()], size: (p) => (files.get(p)?.length ?? 0),
    unlink: (p) => { files.delete(p) },
  }
}

describe('storage 大数据走文件后端', () => {
  it('saveFriends 写文件后端、不写 KV；loadFriends 从文件读回并补默认字段', () => {
    const kvMap = new Map<string, unknown>()
    const kv = { get: (k: string) => kvMap.get(k), set: (k: string, v: unknown) => void kvMap.set(k, v), remove: (k: string) => void kvMap.delete(k) }
    const fs = makeFsJson(memFsBackend(), '/store')
    const s = makeStorage(kv, fs)
    s.saveFriends([{ id: 'f1', name: '张三' } as unknown as Friend])
    // 大数据不落 KV
    expect(kvMap.has('nianlun:friends')).toBe(false)
    const f = s.loadFriends()[0]
    expect(f.id).toBe('f1')
    expect(f.weekHour).toHaveLength(168)   // 补默认字段逻辑保留
  })
  it('saveStockPicks/loadStockPicks 走文件后端往返；clearAll 清文件', () => {
    const kv = { get: () => undefined, set: () => {}, remove: () => {} }
    const fs = makeFsJson(memFsBackend(), '/store')
    const s = makeStorage(kv, fs)
    s.saveStockPicks([{ stock: '江化微', stockNorm: '江化微', recommenderId: 'x', recommender: 'x', ts: 1, logics: [], companyNotes: [] } as never])
    expect(s.loadStockPicks()).toHaveLength(1)
    s.clearAll()
    expect(s.loadStockPicks()).toEqual([])
    expect(s.loadFriends()).toEqual([])
  })
})

describe('purgeLegacyBigKeys', () => {
  it('删除旧大 KV 键、保留其它键', () => {
    const m = new Map<string, unknown>([
      ['nianlun:friends', [1]], ['nianlun:samples', {}], ['nianlun:recentInsights', {}],
      ['nianlun:recentSamples', {}], ['nianlun:stocks', [1]],
      ['nianlun:report', { year: 2026 }], ['nianlun:analyzedIds', ['a']],
    ])
    const kv = { get: (k: string) => m.get(k), set: (k: string, v: unknown) => void m.set(k, v), remove: (k: string) => void m.delete(k) }
    makeStorage(kv).purgeLegacyBigKeys()
    expect(m.has('nianlun:friends')).toBe(false)
    expect(m.has('nianlun:samples')).toBe(false)
    expect(m.has('nianlun:stocks')).toBe(false)
    expect(m.has('nianlun:report')).toBe(true)      // 小元数据保留
    expect(m.has('nianlun:analyzedIds')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL（`makeStorage` 尚不接受 fs 参数 / 大数据仍走 KV / `purgeLegacyBigKeys` 不存在）

- [ ] **Step 3: 改实现**

在 `storage.ts` 顶部 import 追加：

```ts
import { makeFsJson, makeKvFsJson, type FsJsonBackend } from './fsStore'
import { wxRawFs } from './rawStore'
```

保留旧大 KV 键常量用于清理（若已删除请补回）：

```ts
const LEGACY_BIG_KEYS = ['nianlun:friends', 'nianlun:samples', 'nianlun:recentInsights', 'nianlun:recentSamples', 'nianlun:stocks']
```

`makeStorage` 签名与大数据方法改为走 `fs`：

```ts
export function makeStorage(backend: StorageBackend, fs: FsJsonBackend = makeKvFsJson(backend)) {
  return {
    // —— 大数据：文件后端 ——
    saveFriends(friends: Friend[]): void { fs.write('friends', friends) },
    loadFriends(): Friend[] {
      const raw = fs.read('friends')
      const arr = Array.isArray(raw) ? (raw as Friend[]) : []
      return arr.map((f) => ({
        ...f,
        hourly: f.hourly ?? new Array(24).fill(0),
        weekHour: f.weekHour ?? new Array(168).fill(0),
        keywords: f.keywords ?? [],
      }))
    },
    saveSamples(samples: Record<string, string[]>): void { fs.write('samples', samples) },
    loadSamples(): Record<string, string[]> {
      const raw = fs.read('samples')
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    },
    saveRecentInsights(m: Record<string, RecentInsight>): void { fs.write('recentInsights', m) },
    loadRecentInsights(): Record<string, RecentInsight> {
      const raw = fs.read('recentInsights')
      return raw && typeof raw === 'object' ? (raw as Record<string, RecentInsight>) : {}
    },
    saveRecentSamples(m: Record<string, string[]>): void { fs.write('recentSamples', m) },
    loadRecentSamples(): Record<string, string[]> {
      const raw = fs.read('recentSamples')
      return raw && typeof raw === 'object' ? (raw as Record<string, string[]>) : {}
    },
    saveStockPicks(picks: StockPick[]): void { fs.write('stocks', picks) },
    loadStockPicks(): StockPick[] {
      const raw = fs.read('stocks')
      return Array.isArray(raw) ? (raw as StockPick[]) : []
    },
    clearStockPicks(): void { fs.remove('stocks') },

    // —— 小元数据：KV（保持不变）——
    saveReport(report: ReportData): void { backend.set(K_REPORT, report) },
    loadReport(): ReportData | null { const raw = backend.get(K_REPORT); return raw && typeof raw === 'object' ? (raw as ReportData) : null },
    saveAnalyzedIds(ids: string[]): void { backend.set(K_ANALYZED, ids) },
    loadAnalyzedIds(): string[] { const raw = backend.get(K_ANALYZED); return Array.isArray(raw) ? (raw as string[]) : [] },
    saveMyBazi(b: BirthInfo): void { backend.set(K_MY_BAZI, b) },
    loadMyBazi(): BirthInfo | null { const raw = backend.get(K_MY_BAZI); return raw && typeof raw === 'object' ? (raw as BirthInfo) : null },
    saveBirths(m: Record<string, BirthInfo>): void { backend.set(K_BIRTHS, m) },
    loadBirths(): Record<string, BirthInfo> { const raw = backend.get(K_BIRTHS); return raw && typeof raw === 'object' ? (raw as Record<string, BirthInfo>) : {} },
    saveAstroReading(map: Record<string, StoredAstroReading>): void { backend.set(K_ASTRO, map) },
    loadAstroReading(): Record<string, StoredAstroReading> { const raw = backend.get(K_ASTRO); return raw && typeof raw === 'object' ? (raw as Record<string, StoredAstroReading>) : {} },

    clearAll(): void {
      backend.remove(K_REPORT); backend.remove(K_ANALYZED)
      backend.remove(K_MY_BAZI); backend.remove(K_BIRTHS); backend.remove(K_ASTRO)
      fs.remove('friends'); fs.remove('samples'); fs.remove('recentInsights'); fs.remove('recentSamples'); fs.remove('stocks')
    },
    /** 删除旧版本存 KV 单键的大数据（现已迁文件），回收配额。真机启动调用一次。 */
    purgeLegacyBigKeys(): void { for (const k of LEGACY_BIG_KEYS) backend.remove(k) },
    /** 旧原文残留清理：照抄现有 storage.ts 的 purgeLegacyRaw 完整实现，不改动
     *  （依赖 K_RAW_INDEX_LEGACY / K_RAW_PREFIX_LEGACY 两个遗留常量，一并保留）。 */
    purgeLegacyRaw(): void {
      const keys = backend.keys?.()
      if (keys) {
        for (const k of keys) {
          if (k === K_RAW_INDEX_LEGACY || k.startsWith(K_RAW_PREFIX_LEGACY)) backend.remove(k)
        }
        return
      }
      const idx = backend.get(K_RAW_INDEX_LEGACY)
      const count = idx && typeof idx === 'object' && typeof (idx as { count?: unknown }).count === 'number'
        ? (idx as { count: number }).count : 0
      for (let i = 0; i < count; i++) backend.remove(`${K_RAW_PREFIX_LEGACY}${i}`)
      backend.remove(K_RAW_INDEX_LEGACY)
    },
  }
}
```

> 注：`K_FRIENDS`/`K_SAMPLES`/`K_RECENT_INSIGHTS`/`K_RECENT_SAMPLES`/`K_STOCKS` 这些旧 KV 键常量在改造后大数据方法里**不再使用**，可删除（`purgeLegacyBigKeys` 用字面量 `LEGACY_BIG_KEYS`）。但 `K_REPORT`/`K_ANALYZED`/`K_MY_BAZI`/`K_BIRTHS`/`K_ASTRO`（小元数据）与 `K_RAW_INDEX_LEGACY`/`K_RAW_PREFIX_LEGACY`（`purgeLegacyRaw` 用）**必须保留**；`wxBackend` 及其 `keys?()` 也原样保留。

真机实例接线（`storage.ts` 末尾）——文件后端懒加载：

```ts
// 真机文件系统 JSON 后端（懒加载：方法体内才碰 wx）。
let cachedFsJson: FsJsonBackend | undefined
function realFsJson(): FsJsonBackend {
  if (!cachedFsJson) cachedFsJson = makeFsJson(wxRawFs, `${wx.env.USER_DATA_PATH}/nianlun_store`)
  return cachedFsJson
}
const wxFsJson: FsJsonBackend = {
  read: (n) => realFsJson().read(n),
  write: (n, d) => realFsJson().write(n, d),
  remove: (n) => realFsJson().remove(n),
}

export const storage = makeStorage(wxBackend, wxFsJson)
```

- [ ] **Step 4: 跑全量 storage 测试确认通过（含既有用例不回归）**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（既有用例走 `makeStorage(memBackend())` 缺省退化到 KV-FsJson，往返正常；新增隔离与 purge 用例通过）

- [ ] **Step 5: 跑全量 miniapp 测试确认无回归**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（`data.test.ts`/`import.test.ts`/`samples.test.ts` 的 `makeStorage(kv)` 缺省退化，导入 setData→saveFriends→loadFriends 往返正常）

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): 大数据(friends/samples/recent/stocks)改存文件系统，突破 Storage 1MB/10MB"
```

---

## Task 4: 启动清理旧大 KV 键

**Files:**
- Modify: `packages/miniapp/src/App.vue`

**Interfaces:**
- Consumes: `storage.purgeLegacyBigKeys()`（Task 3）。

- [ ] **Step 1: 在 onLaunch 接线**

`App.vue` 的 `onLaunch` 里，`storage.purgeLegacyRaw()` 那一行之后加一行：

```ts
  storage.purgeLegacyRaw()
  storage.purgeLegacyBigKeys()   // ← 新增：清掉旧版存 KV 的大数据(已迁文件系统)，回收配额
```

- [ ] **Step 2: 类型检查 + 全量测试**

Run: `pnpm --filter @nianlun/miniapp test`
Expected: PASS（App.vue 不在单测覆盖内，此步确保无编译/回归）

- [ ] **Step 3: 提交**

```bash
git add packages/miniapp/src/App.vue
git commit -m "feat(miniapp): App 启动清理旧大 KV 键(数据已迁文件系统)"
```

---

## 收尾验证

- [ ] Run: `pnpm --filter @nianlun/miniapp test` → 全绿
- [ ] Run: `pnpm --filter @nianlun/miniapp build:mp-weixin` → 成功
- [ ] 真机验收：几千好友导入**不报 `entry size limit`**、好友列表正常、重启后仍在。

## 全局自查记录

- **Spec 覆盖**：4.1 文件后端(Task1) · 4.2 makeStorage 双后端(Task3) · 4.3 大数据走 fs(Task3) · 4.4 真机接线+wxRawFs(Task2/3) · 4.5 purgeLegacyBigKeys(Task3/4) · 4.6 clearAll/容错(Task3)。
- **命名一致**：`FsJsonBackend`/`makeFsJson`/`makeKvFsJson`/`wxRawFs`/`purgeLegacyBigKeys`、文件名 `friends`/`samples`/`recentInsights`/`recentSamples`/`stocks` 在各任务间一致。
- **零改动验证**：`data.ts`/`import.ts`/页面/`samples.ts` 均不改；现有测试靠 `fs` 缺省退化免改。
