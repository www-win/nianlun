# 四类 AI 分析结果持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把报告文案、全年情绪、好友情绪、好友画像四类 AI 结果持久化到小程序本地存储，命中缓存直接展示、免重复调用 AI，数据变化时软提示可能过时。

**Architecture:** 纯新增、零 core 回归。在 miniapp 的 `adapters/storage.ts` 新增四组 `save*`/`load*`（`load*` 返回 `{ data, stale } | null`，时效由「生成时输入指纹」比对判定），在 `friend-detail.vue`/`report.vue` 进页面读缓存、成功后写盘。完全复刻命理运势 spec 的「持久化 + 时效指纹」范式。

**Tech Stack:** TypeScript、Vue 3（uni-app 微信小程序）、Vitest（fake-indexeddb 环境）、`wx.getStorageSync` 键值存储。

## Global Constraints

- 注释/文案用**中文**。
- **不改 `@nianlun/core`**：四类的 prompt/parse（`buildReportCopyPrompt`、`buildYearSentimentPrompt`、`buildFriendSentimentPrompt`+`parseSentiment`、`buildFriendProfilePrompt`+`parseFriendProfile`）已存在，本次不动，无需 rebuild core。
- 持久化用 `wx.getStorageSync` 键值存储（**非 IndexedDB**），沿用 `nianlun:` 键前缀。
- `wx.getStorageSync` 对缺失键返回 `''`（非 `undefined`），`load*` 必须按类型兜底、**永不抛异常**。
- 复用 core 已导出类型 `Sentiment`（`{ tone?; summary? }`）、`FriendProfile`、`Friend`、`ReportData`，**绝不重定义**。
- 好友级指纹 `fp = \`${friend.msgCount}:${friend.lastContact}\``；报告级指纹 `fp = \`${report.totalMessages}:${report.friendCount}:${report.activeDays}\``。
- 触发方式不变：首次仍由用户手动点；**空结果（AI 无有效内容）不写盘**，允许重试。
- 四个新键并入 `clearAll()`。
- **Windows 上用 PowerShell 跑 build/test**；测试命令 `pnpm --filter @nianlun/miniapp exec vitest run`。

---

## 文件结构

- **Modify** `packages/miniapp/src/adapters/storage.ts` — 新增 4 键常量、指纹辅助、四组 `save*`/`load*`，并入 `clearAll`。
- **Modify** `packages/miniapp/src/adapters/__tests__/storage.test.ts` — 新增四类的往返/新鲜/过期/隔离/清除/容错断言。
- **Modify** `packages/miniapp/src/pages/friend-detail/friend-detail.vue` — 进页读缓存、成功写盘、按钮/过期提示三态。
- **Modify** `packages/miniapp/src/pages/report/report.vue` — `onMounted` 读缓存、成功写盘、过期提示。

存储层（Task 1–2，可纯单测）是全部改动的地基，先做；页面（Task 3–4，靠手测）在其上消费。

---

### Task 1: 存储层——好友级（情绪 / 画像）持久化 + 时效指纹

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `makeStorage(backend)` 现有工厂；core 类型 `Friend`、`Sentiment`、`FriendProfile`。
- Produces（供 Task 3 页面调用）：
  - `friendFp(friend: Friend): string`（内部辅助，返回 `\`${friend.msgCount}:${friend.lastContact}\``）
  - `saveFriendSentiment(id: string, friend: Friend, data: Sentiment): void`
  - `loadFriendSentiment(id: string, friend: Friend): { data: Sentiment; stale: boolean } | null`
  - `saveFriendProfile(id: string, friend: Friend, data: FriendProfile): void`
  - `loadFriendProfile(id: string, friend: Friend): { data: FriendProfile; stale: boolean } | null`
  - 存储形态：键 `nianlun:friendSentiment` / `nianlun:friendProfile`，值为 `{ [id]: { data, fp } }`。

- [ ] **Step 1: 写失败测试**

在 `storage.test.ts` 顶部 `FRIEND` 常量附近补一个带指纹字段的好友常量，然后在 `describe('storage 适配器', ...)` 内追加一个子 describe：

```typescript
// 文件顶部已有 import { makeStorage } from '../storage' 与 type { Friend, ReportData }
const FRIEND_FP = { id: 'f1', name: '张三', msgCount: 100, lastContact: 1700000000000 } as unknown as Friend

describe('好友级 AI 结果持久化', () => {
  it('情绪：save 后 load 往返一致且新鲜', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络', summary: '常聊' })
    const r = s.loadFriendSentiment('f1', FRIEND_FP)
    expect(r).toEqual({ data: { tone: '热络', summary: '常聊' }, stale: false })
  })

  it('情绪：msgCount 变化 → 返回旧缓存 + stale=true，且未清空', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络' })
    const changed = { ...FRIEND_FP, msgCount: 200 } as Friend
    const r = s.loadFriendSentiment('f1', changed)
    expect(r).toEqual({ data: { tone: '热络' }, stale: true })
    // 再用原指纹读，缓存仍在（未被清空）
    expect(s.loadFriendSentiment('f1', FRIEND_FP)!.stale).toBe(false)
  })

  it('情绪：lastContact 变化也判过期', () => {
    const s = makeStorage(memBackend())
    s.saveFriendSentiment('f1', FRIEND_FP, { tone: '热络' })
    const changed = { ...FRIEND_FP, lastContact: 1800000000000 } as Friend
    expect(s.loadFriendSentiment('f1', changed)!.stale).toBe(true)
  })

  it('情绪：无缓存返回 null', () => {
    const s = makeStorage(memBackend())
    expect(s.loadFriendSentiment('f1', FRIEND_FP)).toBeNull()
  })

  it('好友级 map 隔离：写 A 不影响 B', () => {
    const s = makeStorage(memBackend())
    const A = { ...FRIEND_FP, id: 'A' } as Friend
    const B = { ...FRIEND_FP, id: 'B' } as Friend
    s.saveFriendSentiment('A', A, { tone: 'A调' })
    expect(s.loadFriendSentiment('B', B)).toBeNull()
    expect(s.loadFriendSentiment('A', A)!.data.tone).toBe('A调')
  })

  it('画像：save/load 往返 + 过期判定', () => {
    const s = makeStorage(memBackend())
    s.saveFriendProfile('f1', FRIEND_FP, { identity: '医生' })
    expect(s.loadFriendProfile('f1', FRIEND_FP)).toEqual({ data: { identity: '医生' }, stale: false })
    const changed = { ...FRIEND_FP, msgCount: 300 } as Friend
    expect(s.loadFriendProfile('f1', changed)!.stale).toBe(true)
  })

  it('缺失键返回空字符串时安全兜底（模拟 wx.getStorageSync）', () => {
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s = makeStorage(wxLike)
    expect(s.loadFriendSentiment('f1', FRIEND_FP)).toBeNull()
    expect(s.loadFriendProfile('f1', FRIEND_FP)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL —`s.saveFriendSentiment is not a function`。

- [ ] **Step 3: 实现存储层好友级方法**

在 `storage.ts` 键常量区（`K_ANALYZED` 附近）新增：

```typescript
const K_FRIEND_SENTIMENT = 'nianlun:friendSentiment'
const K_FRIEND_PROFILE = 'nianlun:friendProfile'
```

在 `makeStorage` 的 `return { ... }` 之前新增指纹辅助与通用好友级读写（放在 `return` 上方的函数区，与 `rawChunkCount` 等并列）：

```typescript
  // ── AI 结果持久化：指纹 + 好友级/报告级通用读写 ──────────────────
  function friendFp(friend: Friend): string {
    return `${friend.msgCount}:${friend.lastContact}`
  }
  // 好友级：键存 { [id]: { data, fp } }。读时按当前 friend 现算 fp 比对新鲜度。
  function loadFriendMap(key: string): Record<string, { data: unknown; fp: string }> {
    const raw = backend.get(key)
    return raw && typeof raw === 'object' ? (raw as Record<string, { data: unknown; fp: string }>) : {}
  }
  function saveFriendEntry(key: string, id: string, friend: Friend, data: unknown): void {
    const all = loadFriendMap(key)
    all[id] = { data, fp: friendFp(friend) }
    backend.set(key, all)
  }
  function loadFriendEntry<T>(key: string, id: string, friend: Friend): { data: T; stale: boolean } | null {
    const entry = loadFriendMap(key)[id]
    if (!entry || typeof entry !== 'object') return null
    return { data: entry.data as T, stale: entry.fp !== friendFp(friend) }
  }
```

在 `return { ... }` 对象里新增四个方法（放在 `loadAnalyzedIds` 之后）：

```typescript
    saveFriendSentiment(id: string, friend: Friend, data: Sentiment): void {
      saveFriendEntry(K_FRIEND_SENTIMENT, id, friend, data)
    },
    loadFriendSentiment(id: string, friend: Friend): { data: Sentiment; stale: boolean } | null {
      return loadFriendEntry<Sentiment>(K_FRIEND_SENTIMENT, id, friend)
    },
    saveFriendProfile(id: string, friend: Friend, data: FriendProfile): void {
      saveFriendEntry(K_FRIEND_PROFILE, id, friend, data)
    },
    loadFriendProfile(id: string, friend: Friend): { data: FriendProfile; stale: boolean } | null {
      return loadFriendEntry<FriendProfile>(K_FRIEND_PROFILE, id, friend)
    },
```

在文件顶部的 import 里补类型（现有为 `import type { Friend, ReportData } from '@nianlun/core'`，改成）：

```typescript
import type { Friend, ReportData, Sentiment, FriendProfile } from '@nianlun/core'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（新增 7 条全绿，原有用例不受影响）。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): 好友级AI结果(情绪/画像)持久化+时效指纹"
```

---

### Task 2: 存储层——报告级（文案 / 全年情绪）持久化 + 并入 clearAll

**Files:**
- Modify: `packages/miniapp/src/adapters/storage.ts`
- Test: `packages/miniapp/src/adapters/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `loadFriendMap`/`saveFriendEntry` 无关；本任务新增报告级单键读写。core 类型 `ReportData`。
- Produces（供 Task 4 页面调用）：
  - `saveReportCopy(report: ReportData, text: string): void`
  - `loadReportCopy(report: ReportData): { data: string; stale: boolean } | null`
  - `saveYearMood(report: ReportData, text: string): void`
  - `loadYearMood(report: ReportData): { data: string; stale: boolean } | null`
  - 存储形态：键 `nianlun:reportCopy` / `nianlun:yearMood`，值为 `{ text, fp }`。
  - `clearAll()` 额外清除 4 个新键（含 Task 1 的两个）。

- [ ] **Step 1: 写失败测试**

在 `storage.test.ts` 追加报告级子 describe，并**扩充现有 `clearAll` 用例**覆盖四新键：

```typescript
const REPORT_FP = { year: 2025, totalMessages: 5000, friendCount: 50, activeDays: 200 } as unknown as ReportData

describe('报告级 AI 结果持久化', () => {
  it('文案：save/load 往返新鲜', () => {
    const s = makeStorage(memBackend())
    s.saveReportCopy(REPORT_FP, '这一年很温暖')
    expect(s.loadReportCopy(REPORT_FP)).toEqual({ data: '这一年很温暖', stale: false })
  })

  it('文案：totalMessages 变化 → stale=true 且保留旧值', () => {
    const s = makeStorage(memBackend())
    s.saveReportCopy(REPORT_FP, '旧文案')
    const changed = { ...REPORT_FP, totalMessages: 6000 } as ReportData
    expect(s.loadReportCopy(changed)).toEqual({ data: '旧文案', stale: true })
  })

  it('全年情绪：save/load 往返 + friendCount 变化判过期', () => {
    const s = makeStorage(memBackend())
    s.saveYearMood(REPORT_FP, '整体热络')
    expect(s.loadYearMood(REPORT_FP)).toEqual({ data: '整体热络', stale: false })
    const changed = { ...REPORT_FP, friendCount: 60 } as ReportData
    expect(s.loadYearMood(changed)!.stale).toBe(true)
  })

  it('无缓存返回 null，缺键空串兜底不抛', () => {
    const s = makeStorage(memBackend())
    expect(s.loadReportCopy(REPORT_FP)).toBeNull()
    expect(s.loadYearMood(REPORT_FP)).toBeNull()
    const wxLike = { get: (_k: string) => '', set: () => {}, remove: () => {} }
    const s2 = makeStorage(wxLike)
    expect(s2.loadReportCopy(REPORT_FP)).toBeNull()
    expect(s2.loadYearMood(REPORT_FP)).toBeNull()
  })
})
```

把现有 `it('clearAll 清空全部键', ...)` 用例改为额外断言四新键被清（在其 `s.clearAll()` 之前写入、之后断言为 null）：

```typescript
  it('clearAll 清空全部键（含四类 AI 结果）', () => {
    const s = makeStorage(memBackend())
    s.saveFriends([FRIEND]); s.saveReport(REPORT)
    s.saveRecentInsights({ f1: { keywords: [], weekHour: [] } })
    s.saveRecentSamples({ f1: ['我：在'] })
    const F = { id: 'f1', name: '张三', msgCount: 1, lastContact: 1 } as unknown as Friend
    const R = { year: 2025, totalMessages: 1, friendCount: 1, activeDays: 1 } as unknown as ReportData
    s.saveFriendSentiment('f1', F, { tone: 'x' }); s.saveFriendProfile('f1', F, { identity: 'y' })
    s.saveReportCopy(R, 'c'); s.saveYearMood(R, 'm')
    s.clearAll()
    expect(s.loadFriends()).toEqual([])
    expect(s.loadReport()).toBeNull()
    expect(s.loadRecentInsights()).toEqual({})
    expect(s.loadRecentSamples()).toEqual({})
    expect(s.loadFriendSentiment('f1', F)).toBeNull()
    expect(s.loadFriendProfile('f1', F)).toBeNull()
    expect(s.loadReportCopy(R)).toBeNull()
    expect(s.loadYearMood(R)).toBeNull()
  })
```

（删除原来的 `it('clearAll 清空全部键', ...)`，用上面这版替换，避免重复。）

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: FAIL —`s.saveReportCopy is not a function`，以及 clearAll 新断言失败。

- [ ] **Step 3: 实现报告级方法 + 扩充 clearAll**

在 `storage.ts` 键常量区新增：

```typescript
const K_REPORT_COPY = 'nianlun:reportCopy'
const K_YEAR_MOOD = 'nianlun:yearMood'
```

在 `return` 上方函数区新增报告级辅助（紧接 Task 1 的 `loadFriendEntry` 之后）：

```typescript
  function reportFp(report: ReportData): string {
    return `${report.totalMessages}:${report.friendCount}:${report.activeDays}`
  }
  function saveReportEntry(key: string, report: ReportData, text: string): void {
    backend.set(key, { text, fp: reportFp(report) })
  }
  function loadReportEntry(key: string, report: ReportData): { data: string; stale: boolean } | null {
    const raw = backend.get(key)
    if (!raw || typeof raw !== 'object') return null
    const e = raw as { text?: unknown; fp?: unknown }
    if (typeof e.text !== 'string') return null
    return { data: e.text, stale: e.fp !== reportFp(report) }
  }
```

在 `return { ... }` 里新增四个方法（放在 Task 1 的好友级方法之后）：

```typescript
    saveReportCopy(report: ReportData, text: string): void { saveReportEntry(K_REPORT_COPY, report, text) },
    loadReportCopy(report: ReportData): { data: string; stale: boolean } | null {
      return loadReportEntry(K_REPORT_COPY, report)
    },
    saveYearMood(report: ReportData, text: string): void { saveReportEntry(K_YEAR_MOOD, report, text) },
    loadYearMood(report: ReportData): { data: string; stale: boolean } | null {
      return loadReportEntry(K_YEAR_MOOD, report)
    },
```

在 `clearAll()` 方法体末尾（`clearRawImpl()` 之前或之后）追加四键清除：

```typescript
      backend.remove(K_FRIEND_SENTIMENT); backend.remove(K_FRIEND_PROFILE)
      backend.remove(K_REPORT_COPY); backend.remove(K_YEAR_MOOD)
```

- [ ] **Step 4: 运行全量 storage 测试确认通过**

Run: `pnpm --filter @nianlun/miniapp exec vitest run src/adapters/__tests__/storage.test.ts`
Expected: PASS（含 clearAll 扩充断言）。

- [ ] **Step 5: 运行 miniapp 全量测试确认零回归**

Run: `pnpm --filter @nianlun/miniapp exec vitest run`
Expected: PASS（全部既有测试不受影响）。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/adapters/storage.ts packages/miniapp/src/adapters/__tests__/storage.test.ts
git commit -m "feat(miniapp): 报告级AI结果(文案/全年情绪)持久化 + clearAll清四键"
```

---

### Task 3: 好友详情页读缓存/写盘/三态

**Files:**
- Modify: `packages/miniapp/src/pages/friend-detail/friend-detail.vue`

**Interfaces:**
- Consumes: Task 1 的 `storage.saveFriendSentiment/loadFriendSentiment/saveFriendProfile/loadFriendProfile`。
- Produces: 页面行为——进页命中缓存直接渲染；成功分析后写盘；过期显示刷新提示。无被下游任务消费的导出。

> 说明：页面无单测（小程序惯例），本任务靠 `build:mp-weixin` + 微信开发者工具手测。每步给出确切代码。

- [ ] **Step 1: 引入 storage 并在进页时回填缓存**

在 `<script setup>` 顶部 import 区新增（`friend-detail.vue` 现有 import 见文件头）：

```typescript
import { storage } from '../../adapters/storage'
```

新增两个 stale 标志 ref（放在现有 `const sentiment = ref(...)` 附近）：

```typescript
const sentimentStale = ref(false)
const profileStale = ref(false)
```

现有 `onLoad((q) => { id.value = ... })` 只设了 id。改为在拿到 id 后回填缓存（`friend` 是 computed，此时 data 已 hydrate，可直接取）：

```typescript
onLoad((q) => {
  id.value = decodeURIComponent((q?.id as string) || '')
  const f = friend.value
  if (!f) return
  const sent = storage.loadFriendSentiment(f.id, f)
  if (sent) { sentiment.value = sent.data; sentimentStale.value = sent.stale }
  const prof = storage.loadFriendProfile(f.id, f)
  if (prof) { profile.value = prof.data; profileStale.value = prof.stale }
})
```

- [ ] **Step 2: 分析成功后写盘（仅有效结果）**

把 `analyzeSentiment` 的 try 块改为：仅当拿到有效 `tone||summary` 才写盘并清 stale；空结果不写盘（沿用现有占位展示）：

```typescript
  try {
    const r = await aiClient.analyzeFriendSentiment(f, s)
    if (r.tone || r.summary) {
      sentiment.value = r
      storage.saveFriendSentiment(f.id, f, r)
      sentimentStale.value = false
    } else {
      sentiment.value = { summary: 'AI 无法判断情绪' }  // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingSent.value = false
  }
```

同样把 `analyzeProfile` 的 try 块改为：

```typescript
  try {
    const r = await aiClient.analyzeFriendProfile(f, s)
    if (r.identity || r.family || r.romance || r.lifestyle || r.investment) {
      profile.value = r
      storage.saveFriendProfile(f.id, f, r)
      profileStale.value = false
    } else {
      profile.value = { identity: 'AI 无法生成画像' }  // 空结果不写盘，允许重试
    }
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingProfile.value = false
  }
```

- [ ] **Step 3: 模板——按钮文案随缓存态变 + 过期提示**

现有情绪按钮（`friend-detail.vue` 模板里 `@click="analyzeSentiment"`，文案 `✦ 情绪分析`）改为随缓存态：

```html
<text class="act act-ai" @click="analyzeSentiment">
  {{ loadingSent ? '分析中…' : (sentiment ? '↻ 重新分析' : '✦ 情绪分析') }}
</text>
```

在情绪结果块顶部（结果 `v-if` 容器内、内容之前）加过期提示：

```html
<view v-if="sentimentStale" class="stale-hint" @click="analyzeSentiment">数据已更新，点击刷新</view>
```

画像同理：生成按钮文案改为 `{{ loadingProfile ? '生成中…' : (profile ? '↻ 重新生成' : '生成画像') }}`（按现有画像按钮实际文案套用同一三元），并在画像结果块顶加：

```html
<view v-if="profileStale" class="stale-hint" @click="analyzeProfile">数据已更新，点击刷新</view>
```

在 `<style>` 末尾加提示样式（复用现有色变量，不新造设计语言）：

```css
.stale-hint {
  font-size: 24rpx;
  color: var(--muted);
  padding: 8rpx 0;
  text-decoration: underline;
}
```

- [ ] **Step 4: 类型检查 + 构建冒烟**

Run: `pnpm --filter @nianlun/miniapp exec vitest run`（确认无回归；本页无专测）
然后 Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无 TS 报错。

- [ ] **Step 5: 微信开发者工具手测**

打开微信开发者工具，进入某好友详情页：
1. 点「✦ 情绪分析」→ 出结果；退出该页再进入 → 结果**直接显示**、按钮变「↻ 重新分析」，未再弹网络调用。
2. 画像同样验证「首次生成 → 重进直接显示」。
3. （可选）重新导入使该好友 msgCount 变化后进入 → 顶部出现「数据已更新，点击刷新」，点它重算覆盖。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/friend-detail/friend-detail.vue
git commit -m "feat(miniapp): 好友详情页情绪/画像读缓存直显+过期软提示"
```

---

### Task 4: 报告页读缓存/写盘/过期提示

**Files:**
- Modify: `packages/miniapp/src/pages/report/report.vue`

**Interfaces:**
- Consumes: Task 2 的 `storage.saveReportCopy/loadReportCopy/saveYearMood/loadYearMood`。
- Produces: 页面行为——`onMounted` 命中缓存直接渲染（`copy` 命中触发一次出图），成功后写盘，过期软提示。

> 页面无单测，靠构建 + 手测。

- [ ] **Step 1: 引入 storage 并在 onMounted 回填缓存**

`report.vue` 现有 `import { ref, computed, onMounted } from 'vue'`。在 import 区新增：

```typescript
import { storage } from '../../adapters/storage'
```

新增两个 stale ref（放在 `const copy = ref('')`、`const mood = ref('')` 附近）：

```typescript
const copyStale = ref(false)
const moodStale = ref(false)
```

现有 `onMounted` 里（`report.vue` 已有 onMounted 做初始绘制，找到它）追加回填逻辑；若无 onMounted 则新增一个，读缓存后对 `copy` 命中触发 `draw()`：

```typescript
onMounted(() => {
  const r = report.value
  if (!r) return
  const c = storage.loadReportCopy(r)
  if (c) { copy.value = c.data; copyStale.value = c.stale; draw() }
  const m = storage.loadYearMood(r)
  if (m) { mood.value = m.data; moodStale.value = m.stale }
})
```

（若文件已有 `onMounted(() => { ... })`，把上面 body 合并进去，不要重复注册。`draw()` 与 `report`/`copy` 均为本文件已有符号。）

- [ ] **Step 2: 生成成功后写盘**

`genCopy` 的 try 块在 `copy.value = ...; draw()` 后追加写盘与清 stale：

```typescript
  try {
    copy.value = await aiClient.generateReportCopy(report.value, data.friends)
    storage.saveReportCopy(report.value, copy.value)
    copyStale.value = false
    draw()
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingCopy.value = false
  }
```

`genMood` 的 try 块在 `mood.value = ...` 后追加：

```typescript
  try {
    mood.value = await aiClient.analyzeYearSentiment(report.value, lines)
    storage.saveYearMood(report.value, mood.value)
    moodStale.value = false
  } catch (e) {
    uni.showToast({ title: (e as Error).message, icon: 'none' })
  } finally {
    loadingMood.value = false
  }
```

- [ ] **Step 3: 模板加过期提示**

在文案展示块顶加（点提示即触发现有 `genCopy`）：

```html
<view v-if="copyStale" class="stale-hint" @click="genCopy">数据已更新，点击刷新</view>
```

在全年情绪展示块顶加：

```html
<view v-if="moodStale" class="stale-hint" @click="genMood">数据已更新，点击刷新</view>
```

在 `<style>` 末尾加（若与 friend-detail 不共享样式则各自定义）：

```css
.stale-hint {
  font-size: 24rpx;
  color: var(--muted);
  padding: 8rpx 0;
  text-decoration: underline;
}
```

- [ ] **Step 4: 构建冒烟**

Run: `pnpm --filter @nianlun/miniapp exec vitest run`（无回归）
Run: `pnpm --filter @nianlun/miniapp build:mp-weixin`
Expected: 构建成功、无 TS 报错。

- [ ] **Step 5: 微信开发者工具手测**

进入报告页：
1. 点生成文案 → 海报出图；退出报告页再进 → 文案**直接回填并出图**，未再调 AI。
2. 点全年情绪（确认弹窗后生成）→ 出文本；重进 → **直接显示**、**不再弹确认**（未发起新调用）。
3. （可选）重新导入改变全局统计后进报告页 → 两处顶部出现「数据已更新，点击刷新」。

- [ ] **Step 6: 提交**

```bash
git add packages/miniapp/src/pages/report/report.vue
git commit -m "feat(miniapp): 报告页文案/全年情绪读缓存直显+过期软提示"
```

---

## Self-Review

**Spec coverage：**
- §3 存储键（4 键、好友级 map / 报告级单键）→ Task 1（2 键）+ Task 2（2 键）✓
- §3 并入 clearAll → Task 2 Step 3 + 测试 Step 1 ✓
- §4 指纹（好友级 `msgCount:lastContact`、报告级 `totalMessages:friendCount:activeDays`）→ Task 1 `friendFp` / Task 2 `reportFp` ✓
- §4 三态（无缓存 null / 新鲜直显 / 过期软提示不清空）→ Task 1、2 测试断言 + Task 3、4 页面 ✓
- §4 读取接口形态（`{ data, stale } | null`）→ Task 1、2 Produces ✓
- §5.1 好友详情页读缓存/写盘/按钮态/过期提示 → Task 3 ✓
- §5.1 空结果不写盘 → Task 3 Step 2 有效性判断 ✓
- §5.2 报告页 onMounted 回填、copy 命中出图、写盘、过期提示 → Task 4 ✓
- §6 测试（往返/新鲜/过期不清空/无缓存/map 隔离/clearAll/容错）→ Task 1、2 测试 ✓
- 全局约束 不改 core、复用类型、`nianlun:` 前缀、空串兜底 → 各 Task 遵守 ✓

**Placeholder scan：** 无 TBD/TODO；每个代码步给出完整代码。页面模板改动指明「现有块顶部/按钮」并给出确切片段——因原页面模板较长未逐字贴全文，实现时按锚点（`@click="analyzeSentiment"` 等）定位插入，属可执行指令而非占位。

**Type consistency：**
- `friendFp`/`reportFp` 命名前后一致；`saveFriendEntry`/`loadFriendEntry`/`saveReportEntry`/`loadReportEntry` 私有辅助一致。
- 返回类型 `{ data, stale } | null` 在 Task 1/2 Produces 与页面消费处一致。
- 键常量 `K_FRIEND_SENTIMENT`/`K_FRIEND_PROFILE`/`K_REPORT_COPY`/`K_YEAR_MOOD` 在定义、方法、clearAll 三处一致。
- core 类型 `Sentiment`/`FriendProfile`/`Friend`/`ReportData` 均为已导出、直接 import。
